import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { auditSources } from "./control.mjs";
import { hasRuntimeComponents, installUnitSourceClass, isModelSelectableInvocation } from "./domain/source-classes.mjs";
import { BRIDGE_END, BRIDGE_START } from "./lifecycle-content.mjs";
import { checkPolicy } from "./policy.mjs";
import { inspectInstallation } from "./install-health.mjs";
import { verifySources } from "./source-verification.mjs";
import { uninstallProject } from "./uninstall.mjs";
import { loadWorkspace } from "./workspace.mjs";

export async function doctorProject(options = {}) {
  const root = resolve(options.root ?? ".");
  const configPath = resolveUnderRoot(root, options.configPath ?? "skillboard.config.yaml");
  const skillsRoot = resolveUnderRoot(root, options.skillsRoot ?? "skills");
  const bridges = await bridgeStatuses(root);
  const installation = options.installation ?? await inspectInstallation({
    entrypointPath: options.entrypointPath,
    env: options.env,
    packageVersion: options.packageVersion
  });
  const uninstall = await uninstallProject({
    root,
    dryRun: true,
    resetConfig: true,
    removeReports: true,
    removeHooks: true,
    removeProjectState: true,
    removeEmptyDirs: true
  });
  const configExists = await exists(configPath);
  const base = {
    ok: false,
    strictOk: false,
    reviewRequired: false,
    mode: "not-initialized",
    root,
    configPath,
    skillsRoot,
    initialized: false,
    config: {
      exists: configExists,
      valid: false,
      version: null,
      error: configExists ? null : "skillboard.config.yaml was not found"
    },
    bridges,
    installation,
    workspace: emptyWorkspaceSummary(),
    inventory: { required: false, ok: true, path: null, errors: [], stalePolicySkills: [] },
    policy: { ok: false, errors: [], warnings: [] },
    sources: { checked: false, verified: options.verifySources === true, ok: false, errors: [], warnings: [], blockingWarnings: [], units: [] },
    uninstall,
    recommendations: [],
    reviewSummary: emptyReviewSummary()
  };

  if (!configExists) {
    return finalizeDoctor(base, ["run skillboard setup once per user/agent install if agents should use SkillBoard for skill priority"]);
  }

  let workspace;
  if (options.workspace !== undefined) {
    workspace = options.workspace;
  } else {
    try {
      workspace = await loadWorkspace({ configPath, skillsRoot });
    } catch (error) {
      return finalizeDoctor({
        ...base,
        config: {
          exists: true,
          valid: false,
          version: null,
          error: error instanceof Error ? error.message : String(error)
        }
      }, ["fix skillboard.config.yaml, then run skillboard check"]);
    }
  }

  const policy = checkPolicy(workspace);
  const sourceAudit = options.verifySources === true
    ? await verifySources(workspace, { configPath, rootDir: root, restrictToRoot: true })
    : auditSources(workspace);
  const blockingWarnings = blockingSourceWarnings(sourceAudit.warnings);
  const workspaceSummary = summarizeWorkspace(workspace);
  const inventory = inventoryHealth(workspace);
  const result = {
    ...base,
    initialized: true,
    config: {
      exists: true,
      valid: true,
      version: workspace.version,
      error: null
    },
    workspace: workspaceSummary,
    inventory,
    policy,
    sources: {
      checked: true,
      verified: options.verifySources === true,
      ok: sourceAudit.ok,
      errors: sourceAudit.errors,
      warnings: sourceAudit.warnings,
      blockingWarnings,
      units: sourceAudit.units
    }
  };

  return finalizeDoctor(result, doctorRecommendations(result));
}

function finalizeDoctor(result, recommendations) {
  const sourceAuditIsInformational = result.config.version === 2;
  const bridgeOk = sourceAuditIsInformational || (
    result.bridges.every((bridge) => bridge.status === "installed" || bridge.status === "absent")
      && result.bridges.some((bridge) => bridge.status === "installed")
  );
  const ok = result.config.valid && bridgeOk && result.policy.ok && result.inventory.ok
    && (sourceAuditIsInformational || result.sources.ok);
  const reviewRequired = sourceAuditIsInformational ? false : ok && reviewRequiredFor(result);
  const strictOk = ok && !reviewRequired;
  return {
    ...result,
    ok,
    strictOk,
    reviewRequired,
    mode: ok ? reviewRequired ? "safe-mode" : "passed" : result.initialized ? "failed" : "not-initialized",
    recommendations: [...new Set([...recommendations, ...result.installation.warnings])],
    reviewSummary: reviewSummaryFor(result)
  };
}

function doctorRecommendations(result) {
  const recommendations = [];
  if (!result.inventory.ok) {
    recommendations.push("run skillboard inventory refresh and fix generated inventory integrity errors");
  }
  for (const skill of result.inventory.stalePolicySkills) {
    recommendations.push(`reinstall ${skill} or run skillboard skill forget ${skill}`);
  }
  if (!result.bridges.some((bridge) => bridge.status === "installed")) {
    recommendations.push("legacy project bridge blocks are absent; run skillboard init only if maintaining deprecated project-local policy");
  }
  if (result.bridges.some((bridge) => bridge.status === "unmanaged")) {
    recommendations.push("legacy project bridge is unmanaged; run skillboard init only if maintaining deprecated project-local policy");
  }
  if (result.bridges.some((bridge) => bridge.status === "broken")) {
    recommendations.push("repair AGENTS.md or CLAUDE.md SkillBoard bridge markers");
  }
  if (!result.policy.ok) {
    recommendations.push("run skillboard check and fix policy errors");
  }
  if (result.config.version === 2) {
    return recommendations;
  }
  if (!result.sources.ok) {
    recommendations.push("run skillboard audit sources --verify and fix source verification errors");
  } else if (result.sources.blockingWarnings.length > 0) {
    recommendations.push("review high-risk runtime extension warnings before enabling automatic invocation");
  } else if (result.sources.warnings.length > 0) {
    recommendations.push("review source audit warnings before enabling automatic invocation");
  }
  if (result.workspace.skills.byStatus.quarantined > 0) {
    recommendations.push("review quarantined skills with skillboard explain before activation");
  }
  if (result.workspace.installUnits.highRisk.length > 0) {
    recommendations.push("review high-risk install units before trusting runtime extensions");
  }
  return recommendations;
}

function inventoryHealth(workspace) {
  if (workspace.version !== 2) {
    return { required: false, ok: true, path: null, errors: [], stalePolicySkills: [] };
  }
  const errors = [...(workspace.inventory?.integrityErrors ?? ["generated inventory is unavailable"])];
  const observed = new Set(workspace.inventory?.skillIds ?? []);
  const stalePolicySkills = errors.length === 0
    ? workspace.skills
      .map((skill) => skill.id)
      .filter((skillId) => !observed.has(skillId))
      .sort((left, right) => left.localeCompare(right))
    : [];
  return {
    required: true,
    ok: errors.length === 0,
    path: workspace.inventory?.path ?? null,
    errors,
    stalePolicySkills
  };
}

function reviewRequiredFor(result) {
  return result.sources.blockingWarnings.length > 0
    || result.sources.warnings.length > 0
    || result.workspace.skills.byStatus.quarantined > 0
    || result.workspace.installUnits.highRisk.length > 0;
}

function reviewSummaryFor(result) {
  if (result.config.version === 2) {
    return {
      ...emptyReviewSummary(),
      runtimeReady: result.workspace.skills.declared === 0 || result.workspace.skills.installed > 0,
      auditInformational: true
    };
  }
  const highRiskReviewUnits = result.sources.units
    .filter((unit) => {
      return unit.permissionRisk === "high" && !["trusted", "reviewed"].includes(unit.trustLevel);
    })
    .map((unit) => unit.id)
    .sort((left, right) => left.localeCompare(right));
  const runtimeReviewUnits = result.sources.units
    .filter((unit) => unit.enabled && unit.trustLevel === "unreviewed" && result.workspace.installUnits.runtimeExtensions.includes(unit.id))
    .map((unit) => unit.id)
    .sort((left, right) => left.localeCompare(right));
  return {
    reviewRequired: reviewRequiredFor(result),
    blockingWarnings: result.sources.blockingWarnings.length,
    warnings: result.sources.warnings.length,
    quarantinedSkills: result.workspace.skills.byStatus.quarantined,
    modelSelectableSkills: result.workspace.skills.modelSelectable,
    highRiskInstallUnits: highRiskReviewUnits,
    runtimeExtensionInstallUnits: runtimeReviewUnits
  };
}

function blockingSourceWarnings(warnings) {
  return warnings.filter((warning) => {
    return warning.includes("high-risk source is not reviewed or trusted")
      || warning.includes("runtime extension source is unreviewed");
  });
}

function summarizeWorkspace(workspace) {
  if (workspace.version === 2) {
    const enabled = workspace.skills.filter((skill) => skill.enabled).length;
    return {
      skills: {
        declared: workspace.skills.length, installed: workspace.installedSkills.length,
        enabled, disabled: workspace.skills.length - enabled,
        shared: workspace.skills.filter((skill) => skill.shared).length,
        local: workspace.skills.filter((skill) => !skill.shared).length,
        modelSelectable: enabled, byStatus: {}, byInvocation: {}
      },
      workflows: workspace.workflows.length, harnesses: 0,
      installUnits: { total: 0, bySourceClass: {}, highRisk: [], runtimeExtensions: [] }
    };
  }
  const skillsByStatus = countBy(workspace.skills, (skill) => skill.status);
  const skillsByInvocation = countBy(workspace.skills, (skill) => skill.invocation);
  const installUnitsByClass = countBy(workspace.installUnits, (unit) => installUnitSourceClass(unit));
  const highRisk = workspace.installUnits
    .filter((unit) => unit.permissionRisk === "high")
    .map((unit) => unit.id)
    .sort((left, right) => left.localeCompare(right));
  const runtimeExtensions = workspace.installUnits
    .filter((unit) => hasRuntimeComponents(unit))
    .map((unit) => unit.id)
    .sort((left, right) => left.localeCompare(right));
  const modelSelectable = workspace.skills
    .filter((skill) => isModelSelectableInvocation(skill.invocation))
    .map((skill) => skill.id)
    .sort((left, right) => left.localeCompare(right));

  return {
    skills: {
      declared: workspace.skills.length,
      installed: workspace.installedSkills.length,
      modelSelectable: modelSelectable.length,
      byStatus: withKnownKeys(skillsByStatus, ["active", "candidate", "vendor", "quarantined", "blocked", "deprecated"]),
      byInvocation: withKnownKeys(skillsByInvocation, ["manual-only", "router-only", "workflow-auto", "global-auto", "blocked", "deprecated"])
    },
    workflows: workspace.workflows.length,
    harnesses: workspace.harnesses.length,
    installUnits: {
      total: workspace.installUnits.length,
      bySourceClass: withKnownKeys(installUnitsByClass, ["user", "skill-pack", "workflow-bundle", "harness-bundle", "runtime-extension", "package-manager", "external-package", "unknown"]),
      highRisk,
      runtimeExtensions
    }
  };
}

function emptyWorkspaceSummary() {
  return {
    skills: {
      declared: 0,
      installed: 0,
      modelSelectable: 0,
      byStatus: withKnownKeys({}, ["active", "candidate", "vendor", "quarantined", "blocked", "deprecated"]),
      byInvocation: withKnownKeys({}, ["manual-only", "router-only", "workflow-auto", "global-auto", "blocked", "deprecated"])
    },
    workflows: 0,
    harnesses: 0,
    installUnits: {
      total: 0,
      bySourceClass: withKnownKeys({}, ["user", "skill-pack", "workflow-bundle", "harness-bundle", "runtime-extension", "package-manager", "external-package", "unknown"]),
      highRisk: [],
      runtimeExtensions: []
    }
  };
}

function emptyReviewSummary() {
  return {
    reviewRequired: false,
    blockingWarnings: 0,
    warnings: 0,
    quarantinedSkills: 0,
    modelSelectableSkills: 0,
    highRiskInstallUnits: [],
    runtimeExtensionInstallUnits: []
  };
}

async function bridgeStatuses(root) {
  return await Promise.all(["AGENTS.md", "CLAUDE.md"].map(async (filename) => {
    const path = join(root, filename);
    if (!(await exists(path))) {
      return { file: filename, status: "absent" };
    }
    const text = await readFile(path, "utf8");
    const hasStart = text.includes(BRIDGE_START);
    const hasEnd = text.includes(BRIDGE_END);
    if (hasStart && hasEnd) {
      return { file: filename, status: "installed" };
    }
    if (hasStart || hasEnd) {
      return { file: filename, status: "broken" };
    }
    return { file: filename, status: "unmanaged" };
  }));
}

function countBy(values, keyFor) {
  const counts = {};
  for (const value of values) {
    const key = keyFor(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function withKnownKeys(counts, keys) {
  const next = {};
  for (const key of keys) {
    next[key] = counts[key] ?? 0;
  }
  for (const [key, value] of Object.entries(counts)) {
    if (next[key] === undefined) {
      next[key] = value;
    }
  }
  return next;
}

function resolveUnderRoot(root, path) {
  return isAbsolute(path) ? path : resolve(root, path);
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}
