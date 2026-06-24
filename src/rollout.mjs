import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { auditSources } from "./control.mjs";
import { checkPolicy } from "./policy.mjs";
import { loadWorkspace } from "./workspace.mjs";
import { hasRuntimeComponents, installUnitSourceClass, isModelSelectableInvocation } from "./domain/source-classes.mjs";

const REDACTED = "[REDACTED]";
const ROLLOUT_DIR = ".skillboard/rollouts";
const STATUS_EXIT_CODES = {
  healthy: 0,
  "safe-mode": 1,
  "strict-failed": 2,
  "apply-failed": 3,
  "rollback-needed": 4
};

export async function rolloutAudit(options = {}) {
  return await buildRolloutResult("rollout audit", options, {
    mutation: { planned: false, applied: false }
  });
}

export async function rolloutPlan(options = {}) {
  return await buildRolloutResult("rollout plan", options, {
    mutation: { planned: false, applied: false },
    transaction: { required: true, state: "not-started" }
  });
}

export async function rolloutReport(options = {}) {
  const result = await buildRolloutResult("rollout report", options, {
    mutation: { planned: false, applied: false }
  });
  return {
    ...result,
    fleet: fleetSummary(result.status)
  };
}

export async function rolloutApply(options = {}) {
  const initial = await buildRolloutResult("rollout apply", options, {
    mutation: { planned: false, applied: false },
    transaction: { required: true, state: "not-started" }
  });
  if (initial.status !== "healthy") {
    return withStatus(
      {
        ...initial,
        command: "rollout apply",
        transaction: { ...initial.transaction, state: "blocked" }
      },
      "apply-failed"
    );
  }

  try {
    const paths = rolloutPaths(options);
    const transaction = await createTransaction(paths, initial);
    return redactResult({
      ...initial,
      command: "rollout apply",
      mutation: { planned: false, applied: true },
      transaction: {
        required: true,
        id: transaction.id,
        state: "committed",
        manifestPath: transaction.manifestPath
      }
    }, paths);
  } catch (error) {
    return withStatus(
      {
        ...initial,
        command: "rollout apply",
        errors: [...initial.errors, messageFor(error)],
        transaction: { required: true, state: "rollback-needed" }
      },
      "rollback-needed"
    );
  }
}

export async function rolloutRollback(options = {}) {
  const paths = rolloutPaths(options);
  const transactionId = options.transaction;
  if (transactionId === undefined || transactionId.trim() === "") {
    throw new Error("Usage: skillboard rollout rollback --transaction <rollout-id>");
  }
  let safeId;
  try {
    safeId = safeTransactionId(transactionId);
  } catch (error) {
    return rolloutFailureResult("rollout rollback", paths, "rollback-needed", [messageFor(error)], {
      required: true,
      state: "rollback-needed"
    });
  }
  const transactionDir = join(paths.rolloutsDir, safeId);
  const manifestPath = join(transactionDir, "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await validateRollbackManifest(manifest, { paths, transactionDir, expectedId: safeId });

    for (const file of manifest.files) {
      if (file.restore === "copy") {
        await writeFile(file.path, await readFile(file.backupPath));
      }
    }

    const result = await buildRolloutResult("rollout rollback", options, {
      mutation: { planned: false, applied: false },
      transaction: {
        required: true,
        id: manifest.id,
        state: "rolled-back",
        manifestPath
      }
    });
    return redactResult({
      ...result,
      command: "rollout rollback",
      status: result.status === "healthy" ? "healthy" : result.status,
      exitCode: result.status === "healthy" ? STATUS_EXIT_CODES.healthy : result.exitCode,
      transaction: {
        required: true,
        id: manifest.id,
        state: "rolled-back",
        manifestPath
      }
    }, paths);
  } catch (error) {
    return rolloutFailureResult("rollout rollback", paths, "rollback-needed", [messageFor(error)], {
      required: true,
      id: safeId,
      state: "rollback-needed",
      manifestPath
    });
  }
}

async function buildRolloutResult(command, options, extra = {}) {
  const paths = rolloutPaths(options);
  let workspace;
  try {
    workspace = await loadWorkspace({ configPath: paths.configPath, skillsRoot: paths.skillsRoot });
  } catch (error) {
    return redactResult({
      command,
      status: "strict-failed",
      exitCode: STATUS_EXIT_CODES["strict-failed"],
      nonInteractive: true,
      paths: resultPaths(paths),
      summary: {
        policyErrors: 1,
        sourceErrors: 0,
        sourceWarnings: 0,
        blockingWarnings: 0
      },
      policy: { ok: false, errors: [messageFor(error)], warnings: [] },
      sources: { ok: false, errors: [], warnings: [], blockingWarnings: [], units: [] },
      fleet: fleetSummary("strict-failed"),
      errors: [messageFor(error)],
      ...extra
    }, paths);
  }

  const policy = checkPolicy(workspace);
  const sources = auditSources(workspace);
  const blockingWarnings = blockingSourceWarnings(sources.warnings);
  const sourceGateErrors = sourceGateFailures(workspace, sources.units);
  const status = classifyStatus({ policy, sources, blockingWarnings, sourceGateErrors });
  const result = {
    command,
    status,
    exitCode: STATUS_EXIT_CODES[status],
    nonInteractive: true,
    paths: redactedResultPaths(paths),
    summary: {
      policyErrors: policy.errors.length,
      sourceErrors: sources.errors.length + sourceGateErrors.length,
      sourceWarnings: sources.warnings.length,
      blockingWarnings: blockingWarnings.length + sourceGateErrors.length
    },
    policy,
    sources: {
      ok: sources.ok && sourceGateErrors.length === 0,
      errors: [...sources.errors, ...sourceGateErrors],
      warnings: sources.warnings,
      blockingWarnings: [...blockingWarnings, ...sourceGateErrors],
      units: sources.units.map(redactSourceUnit)
    },
    fleet: fleetSummary(status),
    errors: [...policy.errors, ...sources.errors, ...sourceGateErrors],
    ...extra
  };
  return redactResult(result, paths);
}

function rolloutPaths(options) {
  const root = resolve(options.root ?? ".");
  const configPath = resolve(root, options.configPath ?? "skillboard.config.yaml");
  const skillsRoot = options.skillsRoot === undefined ? undefined : resolve(root, options.skillsRoot);
  const rolloutsDir = resolve(root, options.rolloutsDir ?? ROLLOUT_DIR);
  return { root, configPath, skillsRoot, rolloutsDir };
}

function redactedResultPaths(paths) {
  return {
    root: REDACTED,
    config: REDACTED,
    skills: paths.skillsRoot === undefined ? null : REDACTED,
    rollouts: REDACTED
  };
}

function resultPaths(paths) {
  return {
    root: paths.root,
    config: paths.configPath,
    skills: paths.skillsRoot ?? null,
    rollouts: paths.rolloutsDir
  };
}

function classifyStatus({ policy, sources, blockingWarnings, sourceGateErrors }) {
  if (!policy.ok || !sources.ok || blockingWarnings.length > 0 || sourceGateErrors.length > 0) {
    return "strict-failed";
  }
  return "healthy";
}

function blockingSourceWarnings(warnings) {
  return warnings.filter((warning) => {
    return warning.includes("high-risk source is not reviewed or trusted")
      || warning.includes("runtime extension source is unreviewed");
  });
}

function sourceGateFailures(workspace, sourceUnits) {
  const unitsById = new Map(sourceUnits.map((unit) => [unit.id, unit]));
  const skillsByOwner = new Map();
  for (const skill of workspace.skills) {
    if (skill.ownerInstallUnit === undefined) {
      continue;
    }
    const skills = skillsByOwner.get(skill.ownerInstallUnit) ?? [];
    skills.push(skill);
    skillsByOwner.set(skill.ownerInstallUnit, skills);
  }

  const failures = [];
  for (const unit of workspace.installUnits) {
    const sourceClass = installUnitSourceClass(unit);
    const sourceAudit = unitsById.get(unit.id);
    const automaticSkills = skillsByOwner.get(unit.id)
      ?.filter((skill) => skill.status === "active" && isModelSelectableInvocation(skill.invocation))
      .map((skill) => skill.id)
      .sort((left, right) => left.localeCompare(right)) ?? [];
    const runtimeLike = hasRuntimeComponents(unit) || sourceClass === "external-package" || sourceClass === "runtime-extension";
    if (unit.enabled && runtimeLike && unit.trustLevel !== "reviewed" && unit.trustLevel !== "trusted" && automaticSkills.length > 0) {
      failures.push(`${unit.id}: runtime/plugin/external source cannot activate model-selectable skills without reviewed policy`);
      continue;
    }
    if (unit.enabled && runtimeLike && sourceAudit?.permissionRisk === "high" && unit.trustLevel !== "reviewed" && unit.trustLevel !== "trusted") {
      failures.push(`${unit.id}: high-risk runtime/plugin/external source must be reviewed before rollout`);
    }
  }
  return failures.sort((left, right) => left.localeCompare(right));
}

function withStatus(result, status) {
  return {
    ...result,
    status,
    exitCode: STATUS_EXIT_CODES[status],
    fleet: fleetSummary(status)
  };
}

function rolloutFailureResult(command, paths, status, errors, transaction) {
  return redactResult({
    command,
    status,
    exitCode: STATUS_EXIT_CODES[status],
    nonInteractive: true,
    paths: redactedResultPaths(paths),
    summary: {
      policyErrors: 0,
      sourceErrors: 0,
      sourceWarnings: 0,
      blockingWarnings: 0
    },
    policy: { ok: false, errors, warnings: [] },
    sources: { ok: false, errors: [], warnings: [], blockingWarnings: [], units: [] },
    fleet: fleetSummary(status),
    errors,
    mutation: { planned: false, applied: false },
    transaction
  }, paths);
}

async function validateRollbackManifest(manifest, { paths, transactionDir, expectedId }) {
  if (manifest === null || typeof manifest !== "object" || manifest.id !== expectedId || !Array.isArray(manifest.files)) {
    throw new Error("Rollback manifest is invalid or does not match the requested transaction");
  }
  if (!isPathWithin(paths.rolloutsDir, transactionDir)) {
    throw new Error("Rollback manifest transaction is outside the rollout directory");
  }

  let configRestoreCount = 0;
  for (const file of manifest.files) {
    if (file === null || typeof file !== "object" || typeof file.restore !== "string") {
      throw new Error("Rollback manifest file entry is invalid");
    }
    if (file.restore !== "copy") {
      continue;
    }
    if (file.role !== "config") {
      throw new Error("Rollback manifest can only copy-restore the config file");
    }
    const restorePath = resolve(file.path);
    const backupPath = resolve(file.backupPath);
    if (restorePath !== paths.configPath) {
      throw new Error("Rollback manifest target is not the expected config file");
    }
    if (!isPathWithin(transactionDir, backupPath)) {
      throw new Error("Rollback manifest backup is outside the transaction directory");
    }
    const targetStat = await lstat(restorePath);
    const backupStat = await lstat(backupPath);
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || !backupStat.isFile() || backupStat.isSymbolicLink()) {
      throw new Error("Rollback manifest file entries must be regular files");
    }
    configRestoreCount += 1;
  }
  if (configRestoreCount !== 1) {
    throw new Error("Rollback manifest must contain exactly one config restore entry");
  }
}

function isPathWithin(parent, child) {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function createTransaction(paths, result) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
  const id = `rollout-${timestamp}-${randomUUID().slice(0, 8)}`;
  await mkdir(paths.rolloutsDir, { recursive: true });
  const transactionDir = join(paths.rolloutsDir, id);
  await mkdir(transactionDir, { recursive: false });
  const backupsDir = join(transactionDir, "backups");
  await mkdir(backupsDir, { recursive: false });
  const configBackupPath = join(backupsDir, basename(paths.configPath));
  await writeFile(configBackupPath, await readFile(paths.configPath), { flag: "wx" });

  const reportPath = join(transactionDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(redactResult(result, paths), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const statePath = join(transactionDir, "state.json");
  await writeFile(statePath, `${JSON.stringify({ id, status: result.status, committed: true }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

  const manifestPath = join(transactionDir, "manifest.json");
  const manifest = {
    id,
    createdAt: new Date().toISOString(),
    state: "committed",
    files: [
      {
        role: "config",
        path: paths.configPath,
        backupPath: configBackupPath,
        restore: "copy"
      },
      {
        role: "rollout-report",
        path: reportPath,
        backupPath: reportPath,
        restore: "preserve"
      },
      {
        role: "rollout-state",
        path: statePath,
        backupPath: statePath,
        restore: "preserve"
      }
    ]
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { id, manifestPath };
}

function fleetSummary(status) {
  return {
    total: 1,
    byStatus: {
      healthy: status === "healthy" ? 1 : 0,
      "safe-mode": status === "safe-mode" ? 1 : 0,
      "strict-failed": status === "strict-failed" ? 1 : 0,
      "apply-failed": status === "apply-failed" ? 1 : 0,
      "rollback-needed": status === "rollback-needed" ? 1 : 0
    }
  };
}

function safeTransactionId(id) {
  if (!/^rollout-[A-Za-z0-9_-]+$/u.test(id)) {
    throw new Error("Invalid rollout transaction id");
  }
  return id;
}

function redactSourceUnit(unit) {
  return {
    ...unit,
    findings: unit.findings.map((finding) => ({ ...finding, message: redactString(finding.message) }))
  };
}

function redactResult(value, paths) {
  return redactValue(value, [paths.root, paths.configPath, paths.skillsRoot, paths.rolloutsDir].filter(Boolean));
}

function redactValue(value, pathValues) {
  if (typeof value === "string") {
    return redactString(value, pathValues);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, pathValues));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, pathValues)]));
  }
  return value;
}

function redactString(value, pathValues = []) {
  let redacted = value
    .replace(/(token|password|secret|api[_-]?key)=([^\s&]+)/giu, "$1=[REDACTED]")
    .replace(/(ghp|github_pat|sk|xox[baprs])-[-_A-Za-z0-9]+/gu, "[REDACTED]")
    .replace(/SECRET/gu, "[REDACTED]");
  for (const pathValue of pathValues) {
    if (pathValue !== undefined && pathValue.length > 0) {
      redacted = redacted.split(pathValue).join(REDACTED);
    }
  }
  return redacted;
}

function messageFor(error) {
  return error instanceof Error ? error.message : String(error);
}
