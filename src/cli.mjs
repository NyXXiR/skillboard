import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  activateSkill,
  addHarness,
  addSkill,
  addWorkflow,
  auditSources,
  blockSkill,
  canUseSkill,
  checkPolicy,
  detectInstallOutput,
  doctorProject,
  explainSkill,
  importSource,
  installGuardHook,
  impactDisable,
  listHarnesses,
  listInstallUnits,
  listSkills,
  listWorkflows,
  loadSourceProfile,
  loadWorkspace,
  mergeImportFragment,
  preferSkill,
  quarantineSkill,
  removeSkill,
  reconcileWorkspace,
  refreshAgentInventory,
  refreshSourcePins,
  renderDashboard,
  renderImportFragment,
  renderReconcilePlan,
  reviewInstallUnit,
  rolloutApply,
  rolloutAudit,
  rolloutPlan,
  rolloutReport,
  rolloutRollback,
  verifySources,
  writeLockfile
} from "./index.mjs";
// SIZE_OK: src/cli.mjs is pre-existing command-router debt; brief behavior delegates to src/brief-cli.mjs and hook planning delegates through src/hook-plan.mjs until a broader router split.
import { runBriefCommand } from "./brief-cli.mjs";
import { planGuardHookInstall } from "./control.mjs";
import { runInitCommand, runUninstallCommand } from "./lifecycle-cli.mjs";

export async function main(argv, stdout, stderr) {
  try {
    return await run(argv, stdout, stderr);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function run(argv, stdout, stderr) {
  const command = argv[0] ?? "help";
  const options = parseOptions(argv.slice(1));
  switch (command) {
    case "init":
      return await runInitCommand(options, stdout);
    case "uninstall":
      return await runUninstallCommand(options, stdout);
    case "inventory":
      return await inventory(argv.slice(1), options, stdout);
    case "sources":
      return await sources(argv.slice(1), options, stdout);
    case "import":
      return await importProfile(options, stdout);
    case "scan":
      return await scan(options, stdout);
    case "check":
      return await check(options, stdout, stderr);
    case "doctor":
    case "status":
      return await doctor(options, stdout);
    case "brief":
      return await runBriefCommand(options, stdout, {
        configPath: configPath(options),
        skillsRoot: skillsRoot(options)
      });
    case "list":
      return await list(argv.slice(1), options, stdout);
    case "explain":
      return await explain(argv.slice(1), options, stdout);
    case "can-use":
      return await canUse(argv.slice(1), options, stdout);
    case "guard":
      return await guard(argv.slice(1), options, stdout);
    case "audit":
      return await audit(argv.slice(1), options, stdout);
    case "hook":
      return await hook(argv.slice(1), options, stdout);
    case "lock":
      return await lock(argv.slice(1), options, stdout);
    case "review":
      return await review(argv.slice(1), options, stdout);
    case "rollout":
      return await rollout(argv.slice(1), options, stdout);
    case "activate":
      return await activate(argv.slice(1), options, stdout);
    case "add":
      return await add(argv.slice(1), options, stdout);
    case "block":
      return await block(argv.slice(1), options, stdout);
    case "quarantine":
      return await quarantine(argv.slice(1), options, stdout);
    case "prefer":
      return await prefer(argv.slice(1), options, stdout);
    case "remove":
      return await remove(argv.slice(1), options, stdout);
    case "dashboard":
      return await dashboard(options, stdout);
    case "reconcile":
      return await reconcile(options, stdout);
    case "impact":
      return await impact(argv.slice(1), options, stdout);
    case "help":
    case "--help":
    case "-h":
      stdout.write(helpText());
      return 0;
    default:
      stderr.write(`Unknown command: ${command}\n`);
      stdout.write(helpText());
      return 1;
  }
}

async function importProfile(options, stdout) {
  const profileRef = options.get("profile");
  const sourceRoot = options.get("source-root");
  if (profileRef === undefined || sourceRoot === undefined) {
    throw new Error("Usage: skillboard import --profile <id-or-path> --source-root <dir>");
  }
  const profile = await loadSourceProfile(profileRef, { profileDirs: readCsv(options.get("profile-dirs")) });
  const imported = await importSource({ profile, sourceRoot });
  if (options.get("merge") === "true") {
    return await mergeImport(options, imported, stdout);
  }
  const fragment = renderImportFragment(imported);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(fragment);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, fragment, "utf8");
  stdout.write(`Import fragment written: ${out}\n`);
  return 0;
}

async function mergeImport(options, imported, stdout) {
  const path = options.get("config");
  if (path === undefined) {
    throw new Error("Usage: skillboard import --profile <id-or-path> --source-root <dir> --config <path> --merge");
  }
  const merged = mergeImportFragment(await readFile(path, "utf8"), imported, { replace: options.get("replace") === "true" });
  const result = {
    message: `Import merged: ${path}`,
    dryRun: options.get("dry-run") === "true",
    changed: merged.changed,
    plan: merged.plan,
    addedSkills: merged.addedSkills,
    addedInstallUnits: merged.addedInstallUnits,
    replacedSkills: merged.replacedSkills,
    replacedInstallUnits: merged.replacedInstallUnits
  };
  if (result.changed && !result.dryRun) {
    await writeFile(path, merged.text, "utf8");
  }
  writeOutput(stdout, result, options, () => renderImportMerge(result));
  return 0;
}

async function inventory(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] === "detect") {
    return await inventoryDetect(options, stdout);
  }
  if (args[0] !== "refresh") {
    throw new Error("Usage: skillboard inventory refresh|detect ...");
  }
  const result = await refreshAgentInventory({
    root: options.get("dir") ?? ".",
    configPath: options.get("config"),
    roots: readCsv(options.get("scan-root")),
    dryRun: options.get("dry-run") === "true"
  });
  writeOutput(stdout, result, options, () => renderInventoryRefresh(result));
  return 0;
}

async function inventoryDetect(options, stdout) {
  const result = await detectInstallOutput({
    root: options.get("dir") ?? ".",
    configPath: options.get("config"),
    unitId: options.get("unit"),
    installOutputPath: options.get("install-output"),
    configFiles: readCsv(options.get("config-file")),
    kind: options.get("kind"),
    source: options.get("source"),
    scope: options.get("scope"),
    dryRun: options.get("dry-run") === "true"
  });
  writeOutput(stdout, result, options, () => renderInstallDetection(result));
  return 0;
}

async function sources(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] !== "refresh") {
    throw new Error("Usage: skillboard sources refresh [--dir <path>] [--config <path>] [--unit <id>[,<id>]] [--cache-dir <dir>] [--dry-run] [--json]");
  }
  const result = await refreshSourcePins({
    root: options.get("dir") ?? ".",
    configPath: options.get("config"),
    cacheDir: options.get("cache-dir"),
    units: readCsv(options.get("unit")),
    dryRun: options.get("dry-run") === "true"
  });
  writeOutput(stdout, result, options, () => renderSourceRefresh(result));
  return 0;
}

async function scan(options, stdout) {
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  stdout.write(`${JSON.stringify(workspace, null, 2)}\n`);
  return 0;
}

async function check(options, stdout, stderr) {
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = checkPolicy(workspace);
  const output = [...result.errors, ...result.warnings].join("\n");
  if (output.length > 0) {
    (result.ok ? stdout : stderr).write(`${output}\n`);
  }
  stdout.write(result.ok ? "Policy check passed\n" : "Policy check failed\n");
  return result.ok ? 0 : 1;
}

async function doctor(options, stdout) {
  const result = await doctorProject({
    root: options.get("dir") ?? ".",
    configPath: options.get("config"),
    skillsRoot: options.get("skills"),
    verifySources: options.get("verify") === "true"
  });
  writeOutput(stdout, result, options, () => renderDoctor(result));
  return (options.get("strict") === "true" ? result.strictOk : result.ok) ? 0 : 1;
}

async function list(argv, options, stdout) {
  const kind = positionalArgs(argv)[0] ?? "skills";
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  let result;
  if (kind === "skills") {
    result = listSkills(workspace, { workflow: options.get("workflow") });
  } else if (kind === "workflows") {
    result = listWorkflows(workspace);
  } else if (kind === "harnesses") {
    result = listHarnesses(workspace);
  } else if (kind === "install-units") {
    result = listInstallUnits(workspace);
  } else {
    throw new Error("Usage: skillboard list [skills|workflows|harnesses|install-units]");
  }
  writeOutput(stdout, result, options, () => renderList(kind, result));
  return 0;
}

async function explain(argv, options, stdout) {
  const skillId = positionalArgs(argv)[0];
  if (skillId === undefined) {
    throw new Error("Usage: skillboard explain <skill-id>");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = explainSkill(workspace, skillId);
  writeOutput(stdout, result, options, () => renderExplain(result));
  return 0;
}

async function canUse(argv, options, stdout) {
  const skillId = positionalArgs(argv)[0];
  const workflow = options.get("workflow");
  if (skillId === undefined || workflow === undefined) {
    throw new Error("Usage: skillboard can-use <skill-id> --workflow <name>");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = canUseSkill(workspace, skillId, workflow);
  writeOutput(stdout, result, options, () => renderCanUse(result));
  return result.allowed ? 0 : 2;
}

async function guard(argv, options, stdout) {
  const args = positionalArgs(argv);
  const skillId = args[0] === "use" ? args[1] : args[0];
  const workflow = options.get("workflow");
  if (skillId === undefined || workflow === undefined) {
    throw new Error("Usage: skillboard guard use <skill-id> --workflow <name>");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = canUseSkill(workspace, skillId, workflow);
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write(result.allowed ? "allow\n" : `deny\n${result.reasons.map((reason) => `- ${reason}`).join("\n")}\n`);
  }
  return result.allowed ? 0 : 2;
}

async function audit(argv, options, stdout) {
  const args = positionalArgs(argv);
  if ((args[0] ?? "sources") !== "sources") {
    throw new Error("Usage: skillboard audit sources --config <path> --skills <dir> [--json]");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = options.get("verify") === "true"
    ? await verifySources(workspace, { configPath: configPath(options) })
    : auditSources(workspace);
  writeOutput(stdout, result, options, () => renderSourceAudit(result));
  return result.ok ? 0 : 1;
}

async function rollout(argv, options, stdout) {
  const action = positionalArgs(argv)[0] ?? "audit";
  const rolloutOptions = {
    root: options.get("dir") ?? ".",
    configPath: options.get("config"),
    skillsRoot: options.get("skills"),
    rolloutsDir: options.get("rollouts-dir"),
    transaction: options.get("transaction")
  };
  let result;
  if (action === "audit") {
    result = await rolloutAudit(rolloutOptions);
  } else if (action === "plan") {
    result = await rolloutPlan(rolloutOptions);
  } else if (action === "apply") {
    result = await rolloutApply(rolloutOptions);
  } else if (action === "rollback") {
    result = await rolloutRollback(rolloutOptions);
  } else if (action === "report") {
    result = await rolloutReport(rolloutOptions);
  } else {
    throw new Error("Usage: skillboard rollout [audit|plan|apply|rollback|report] [--dir <path>] [--config <path>] [--skills <dir>] [--json]");
  }
  writeOutput(stdout, result, options, () => renderRollout(result));
  return result.exitCode;
}

async function hook(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] !== "install") {
    throw new Error("Usage: skillboard hook install --workflow <name> [--out <path>] [--skillboard-bin <path>] [--dry-run]");
  }
  const workflow = options.get("workflow");
  if (workflow === undefined) {
    throw new Error("Usage: skillboard hook install --workflow <name> [--out <path>] [--skillboard-bin <path>] [--dry-run]");
  }
  const hookOptions = {
    workflow,
    out: options.get("out"),
    command: options.get("skillboard-bin"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options)
  };
  if (options.get("dry-run") === "true") {
    return await dryRunHookInstall(hookOptions, options, stdout);
  }
  return await applyHookInstall(hookOptions, options, stdout);
}

async function dryRunHookInstall(hookOptions, options, stdout) {
  let planned;
  try {
    planned = await planGuardHookInstall(hookOptions);
  } catch (error) {
    return writeHookInstallError(stdout, options, hookInstallError(error));
  }
  if (planned.target_exists) {
    return writeHookInstallError(stdout, options, {
      code: "hook_path_exists",
      message: `Refusing to overwrite existing hook path: ${planned.path}`
    }, planned);
  }
  const result = { ok: true, planned };
  writeOutput(stdout, result, options, () => renderHookInstallDryRun(result));
  return 0;
}

async function applyHookInstall(hookOptions, options, stdout) {
  let planned;
  try {
    planned = await planGuardHookInstall(hookOptions);
    if (planned.target_exists) {
      return writeHookInstallError(stdout, options, {
        code: "hook_path_exists",
        message: `Refusing to overwrite existing hook path: ${planned.path}`
      }, planned);
    }
    const result = await installGuardHook(hookOptions);
    writeOutput(stdout, result, options, () => `Installed guard hook: ${result.path}\n`);
    return 0;
  } catch (error) {
    return writeHookInstallError(stdout, options, hookInstallError(error), planned);
  }
}

async function lock(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] !== "write") {
    throw new Error("Usage: skillboard lock write --config <path> --skills <dir> [--out <path>] [--replace] [--allow-unverified] [--json]");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const out = options.get("out") ?? "skillboard.lock.yaml";
  const result = await writeLockfile(workspace, {
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    out,
    replace: options.get("replace") === "true",
    allowUnverified: options.get("allow-unverified") === "true"
  });
  writeOutput(stdout, result, options, () => `Lockfile written: ${result.path}\n`);
  return 0;
}

async function review(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] !== "install-unit" || args[1] === undefined) {
    throw new Error("Usage: skillboard review install-unit <unit-id> [--trust-level trusted|reviewed|unreviewed|blocked] --config <path> --skills <dir> [--dry-run] [--json]");
  }
  const result = await reviewInstallUnit({
    unitId: args[1],
    trustLevel: options.get("trust-level"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function activate(argv, options, stdout) {
  const skillId = positionalArgs(argv)[0];
  const workflow = options.get("workflow");
  if (skillId === undefined || workflow === undefined) {
    throw new Error("Usage: skillboard activate <skill-id> --workflow <name> [--mode manual-only|router-only|workflow-auto]");
  }
  const result = await activateSkill({
    skillId,
    workflow,
    mode: options.get("mode"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function add(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] === "workflow") {
    return await addWorkflowCommand(args, options, stdout);
  }
  if (args[0] === "harness") {
    return await addHarnessCommand(args, options, stdout);
  }
  if (args[0] !== "skill" || args[1] === undefined || options.get("path") === undefined) {
    throw new Error("Usage: skillboard add skill <skill-id> --path <relative-skill-path> --config <path> --skills <dir> [--workflow <name>] [--dry-run] [--json]");
  }
  const result = await addSkill({
    skillId: args[1],
    path: options.get("path"),
    status: options.get("status"),
    invocation: options.get("invocation"),
    exposure: options.get("exposure"),
    category: options.get("category"),
    ownerInstallUnit: options.get("owner-install-unit"),
    workflow: options.get("workflow"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function addWorkflowCommand(args, options, stdout) {
  const workflow = args[1];
  const harness = options.get("harness");
  if (workflow === undefined || harness === undefined) {
    throw new Error("Usage: skillboard add workflow <workflow-name> --harness <harness-name> --config <path> --skills <dir> [--skill <id>[,<id>]] [--harness-status <status>] [--require-existing-harness] [--dry-run] [--json]");
  }
  const result = await addWorkflow({
    workflow,
    harness,
    skills: readCsv(options.get("skill")),
    harnessStatus: options.get("harness-status"),
    requireExistingHarness: options.get("require-existing-harness") === "true",
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function addHarnessCommand(args, options, stdout) {
  const harness = args[1];
  if (harness === undefined) {
    throw new Error("Usage: skillboard add harness <harness-name> --config <path> --skills <dir> [--status <status>] [--command <cmd>[,<cmd>]] [--dry-run] [--json]");
  }
  const result = await addHarness({
    harness,
    status: options.get("status"),
    commands: readCsv(options.get("command")),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function block(argv, options, stdout) {
  const skillId = positionalArgs(argv)[0];
  const workflow = options.get("workflow");
  if (skillId === undefined || workflow === undefined) {
    throw new Error("Usage: skillboard block <skill-id> --workflow <name>");
  }
  const result = await blockSkill({
    skillId,
    workflow,
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function quarantine(argv, options, stdout) {
  const skillId = positionalArgs(argv)[0];
  if (skillId === undefined) {
    throw new Error("Usage: skillboard quarantine <skill-id>");
  }
  const result = await quarantineSkill({
    skillId,
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function prefer(argv, options, stdout) {
  const skillId = positionalArgs(argv)[0];
  const workflow = options.get("workflow");
  const capability = options.get("capability");
  if (skillId === undefined || workflow === undefined || capability === undefined) {
    throw new Error("Usage: skillboard prefer <skill-id> --workflow <name> --capability <name>");
  }
  const result = await preferSkill({
    skillId,
    workflow,
    capability,
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function remove(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] !== "skill" || args[1] === undefined) {
    throw new Error("Usage: skillboard remove skill <skill-id> --config <path> --skills <dir> [--force] [--dry-run] [--json]");
  }
  const result = await removeSkill({
    skillId: args[1],
    force: options.get("force") === "true",
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function dashboard(options, stdout) {
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const markdown = renderDashboard(workspace);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(markdown);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  stdout.write(`Dashboard written: ${out}\n`);
  return 0;
}

async function reconcile(options, stdout) {
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const plan = reconcileWorkspace(workspace, { actualHarnesses: readCsv(options.get("actual-harnesses")) });
  const markdown = renderReconcilePlan(plan);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(markdown);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  stdout.write(`Reconcile plan written: ${out}\n`);
  return 0;
}

async function impact(argv, options, stdout) {
  if (argv[0] !== "disable" || argv[1] === undefined) {
    throw new Error("Usage: skillboard impact disable <skill-id>");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = impactDisable(workspace, argv[1]);
  const markdown = renderImpact(result);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(markdown);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  stdout.write(`Impact report written: ${out}\n`);
  return 0;
}

function renderImpact(result) {
  return [
    `# Disable Impact: ${result.skillId}`,
    "",
    `- Found: \`${result.exists}\``,
    `- Risk: ${result.risk}`,
    `- Affected workflows: ${formatList(result.affectedWorkflows)}`,
    `- Affected required outputs: ${formatList(result.affectedOutputs)}`,
    `- Alternatives: ${formatList(result.alternatives)}`,
    ""
  ].join("\n");
}

function configPath(options) {
  return options.get("config") ?? "skillboard.config.yaml";
}

function skillsRoot(options) {
  return options.get("skills");
}

function parseOptions(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      options.set(key, "true");
      continue;
    }
    options.set(key, value);
    index += 1;
  }
  return options;
}

function formatList(values) {
  return values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", ");
}

function readCsv(value) {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function renderImportMerge(result) {
  const lines = [
    `${result.dryRun ? "Dry run: " : ""}${result.message}`,
    renderChangePlan(result.plan).trimEnd(),
    `Skills: ${formatList(result.addedSkills)}`,
    `Install units: ${formatList(result.addedInstallUnits)}`
  ];
  if (result.replacedSkills.length > 0 || result.replacedInstallUnits.length > 0) {
    lines.push(`Replaced skills: ${formatList(result.replacedSkills)}`);
    lines.push(`Replaced install units: ${formatList(result.replacedInstallUnits)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderInventoryRefresh(result) {
  return [
    `${result.dryRun ? "Dry run: " : ""}Inventory refreshed: ${result.configPath}`,
    renderChangePlan(result.plan).trimEnd(),
    `Scanned skills: ${result.scan.scannedSkills}`,
    `Scanned install units: ${result.scan.scannedInstallUnits}`,
    `Added skills: ${formatList(result.scan.addedSkills)}`,
    `Added install units: ${formatList(result.scan.addedInstallUnits)}`,
    `Updated install units: ${formatList(result.scan.updatedInstallUnits)}`,
    `Added workflows: ${formatList(result.scan.addedWorkflows ?? [])}`,
    `Added harnesses: ${formatList(result.scan.addedHarnesses ?? [])}`,
    `Skipped existing skills: ${formatList(result.scan.skippedSkills)}`,
    `Review notes: ${formatList(result.scan.reviewNotes ?? [])}`,
    `Scan warnings: ${formatList(result.scan.warnings ?? [])}`,
    ""
  ].join("\n");
}

function renderInstallDetection(result) {
  return [
    `${result.dryRun ? "Dry run: " : ""}Detected install metadata: ${result.unitId}`,
    renderChangePlan(result.plan).trimEnd(),
    `Commands: ${formatList(result.detected.commands)}`,
    `Hooks: ${formatList(result.detected.hooks)}`,
    `MCP servers: ${formatList(result.detected.mcpServers)}`,
    `Modified config files: ${formatList(result.detected.modifiedConfigFiles)}`,
    `Changed fields: ${formatList(result.changedFields)}`,
    ""
  ].join("\n");
}

function renderSourceRefresh(result) {
  const lines = [
    `${result.dryRun ? "Dry run: " : ""}Source pins refreshed: ${result.configPath}`,
    renderChangePlan(result.plan).trimEnd(),
    `Refreshed units: ${formatList(result.refreshed.map((unit) => unit.id))}`
  ];
  if (result.skipped.length > 0) {
    lines.push(`Skipped units: ${formatList(result.skipped.map((unit) => `${unit.id}:${unit.reason}`))}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderChangePlan(plan) {
  const lines = [
    `Changed: ${plan.changed}`,
    `Changed line positions: ${plan.changedLineCount}`
  ];
  if (plan.semanticAvailable) {
    const suffix = plan.semanticTruncated ? " (truncated)" : "";
    lines.push(`Semantic changes: ${plan.semanticChangeCount}${suffix}`);
    for (const change of plan.semanticChanges.slice(0, 10)) {
      lines.push(`- ${change.type} ${change.path}: ${change.before} -> ${change.after}`);
    }
  } else {
    lines.push(`Semantic changes: unavailable (${plan.semanticError})`);
  }
  return `${lines.join("\n")}\n`;
}

function positionalArgs(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      values.push(arg);
      continue;
    }
    const value = args[index + 1];
    if (value !== undefined && !value.startsWith("--")) {
      index += 1;
    }
  }
  return values;
}

function writeOutput(stdout, value, options, renderText) {
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  stdout.write(renderText());
}

function writeControlResult(stdout, result, options) {
  const warnings = result.policy.warnings;
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify({
      message: result.message,
      dryRun: result.dryRun,
      changed: result.changed,
      plan: result.plan,
      warnings
    }, null, 2)}\n`);
    return;
  }
  stdout.write(`${result.dryRun ? "Dry run: " : ""}${result.message}\n`);
  stdout.write(renderChangePlan(result.plan));
  if (warnings.length > 0) {
    stdout.write(`${warnings.join("\n")}\n`);
  }
}

function writeHookInstallError(stdout, options, error, planned) {
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify({
      ok: false,
      error,
      ...(planned === undefined ? {} : { planned })
    }, null, 2)}\n`);
    return 1;
  }
  throw new Error(error.message);
}

function hookInstallError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Unknown workflow:")) {
    return { code: "unknown_workflow", message };
  }
  if (message.startsWith("Refusing to overwrite existing hook path:")) {
    return { code: "hook_path_exists", message };
  }
  if (message.startsWith("Unsupported config version:")
    || message.includes("config root")
    || message.includes("must be a")
    || message.includes("Invalid YAML")) {
    return { code: "invalid_config", message };
  }
  if (error?.code === "ENOENT") {
    return { code: "missing_config", message };
  }
  return { code: "hook_install_failed", message };
}

function renderHookInstallDryRun(result) {
  return [
    "Dry run: would install guard hook",
    `Path: ${result.planned.path}`,
    `Workflow: ${result.planned.workflow}`,
    `Command: ${result.planned.command}`,
    `Target exists: ${result.planned.target_exists}`,
    `Planned mode: ${result.planned.planned_mode} (${result.planned.permissions})`,
    `Would be executable: ${result.planned.would_be_executable}`,
    `Preview: ${result.planned.preview.display}`,
    ""
  ].join("\n");
}

function renderList(kind, values) {
  if (values.length === 0) {
    return `${kind}: none\n`;
  }
  if (kind === "skills") {
    return `${values.map((skill) => {
      const roles = skill.workflowRoles.length === 0 ? "none" : skill.workflowRoles.join(",");
      const owner = skill.ownerInstallUnit ?? "direct";
      return `${skill.id}\t${skill.status}\t${skill.invocation}\t${skill.sourceClass}\towner=${owner}\troles=${roles}`;
    }).join("\n")}\n`;
  }
  if (kind === "workflows") {
    return `${values.map((workflow) => {
      return `${workflow.name}\tharness=${workflow.harness}\tactive=${workflow.activeSkills.length}\tblocked=${workflow.blockedSkills.length}\tcapabilities=${workflow.requiredCapabilities.join(",") || "none"}`;
    }).join("\n")}\n`;
  }
  if (kind === "harnesses") {
    return `${values.map((harness) => {
      return `${harness.name}\t${harness.status}\tworkflows=${harness.workflows.join(",") || "none"}\tcommands=${harness.commands.join(",") || "none"}`;
    }).join("\n")}\n`;
  }
  return `${values.map((unit) => {
    return `${unit.id}\t${unit.kind}\t${unit.sourceClass}\tpriority=${unit.priority}\ttrust=${unit.trustLevel}\tenabled=${unit.enabled}\tskills=${unit.skills.length}\trisk=${unit.permissionRisk}`;
  }).join("\n")}\n`;
}

function renderExplain(result) {
  const workflows = result.workflows.length === 0
    ? "none"
    : result.workflows.map((workflow) => `${workflow.workflow}:${workflow.roles.join(",")}`).join(", ");
  const capabilities = result.capabilities.length === 0
    ? "none"
    : result.capabilities.map((capability) => `${capability.name}:${capability.role}`).join(", ");
  return [
    `Skill: ${result.id}`,
    `Status: ${result.status}`,
    `Invocation: ${result.invocation}`,
    `Source: ${result.source.class} (${result.source.detail})`,
    `Trust: ${result.trust.level}${result.trust.pinned ? ", pinned" : ""}${result.trust.signed ? ", signed" : ""}`,
    `Owner install unit: ${result.ownerInstallUnit ?? "direct"}`,
    `Workflows: ${workflows}`,
    `Capabilities: ${capabilities}`,
    `Replaced by: ${result.replacedBy ?? "none"}`,
    ""
  ].join("\n");
}

function renderCanUse(result) {
  const lines = [
    `Allowed: ${result.allowed}`,
    `Automatic allowed: ${result.automaticAllowed}`,
    `Skill: ${result.skill}`,
    `Workflow: ${result.workflow}`,
    `Invocation: ${result.invocation ?? "unknown"}`,
    `Trust: ${result.trust === null ? "unknown" : result.trust.level}`,
    `Roles: ${result.roles.length === 0 ? "none" : result.roles.join(", ")}`
  ];
  if (result.reasons.length > 0) {
    lines.push("Reasons:");
    for (const reason of result.reasons) {
      lines.push(`- ${reason}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderSourceAudit(result) {
  const lines = [
    `Source audit: ${result.ok ? "passed" : "failed"}`,
    `Errors: ${result.errors.length}`,
    `Warnings: ${result.warnings.length}`
  ];
  for (const unit of result.units) {
    const findings = unit.findings.length === 0
      ? "ok"
      : unit.findings.map((finding) => `${finding.severity}:${finding.message}`).join("; ");
    const pinned = unit.pinned ?? unit.digestVerified ?? false;
    const signed = unit.signed ?? unit.signatureVerified ?? false;
    const status = unit.status === undefined ? "" : `\tstatus=${unit.status}`;
    lines.push(`${unit.id}\t${unit.sourceClass}\ttrust=${unit.trustLevel}\trisk=${unit.permissionRisk}\tpinned=${pinned}\tsigned=${signed}${status}\t${findings}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderRollout(result) {
  const lines = [
    `SkillBoard rollout: ${result.status}`,
    `Command: ${result.command}`,
    `Exit code: ${result.exitCode}`,
    `Non-interactive: ${result.nonInteractive}`,
    `Summary: policyErrors=${result.summary.policyErrors}, sourceErrors=${result.summary.sourceErrors}, sourceWarnings=${result.summary.sourceWarnings}, blockingWarnings=${result.summary.blockingWarnings}`,
    `Fleet: healthy=${result.fleet.byStatus.healthy}, safe-mode=${result.fleet.byStatus["safe-mode"]}, strict-failed=${result.fleet.byStatus["strict-failed"]}, apply-failed=${result.fleet.byStatus["apply-failed"]}, rollback-needed=${result.fleet.byStatus["rollback-needed"]}`
  ];
  if (result.transaction !== undefined) {
    lines.push(`Transaction: ${result.transaction.state}${result.transaction.id === undefined ? "" : ` ${result.transaction.id}`}`);
  }
  if (result.errors.length > 0) {
    lines.push("Errors:");
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderDoctor(result) {
  const bridges = result.bridges.map((bridge) => `${bridge.file}=${bridge.status}`).join(", ");
  const sourceMode = result.sources.verified ? "verified" : "audit";
  const status = result.ok ? result.reviewRequired ? "safe mode, review needed" : "passed" : "needs attention";
  const lines = [
    `SkillBoard doctor: ${status}`,
    `Root: ${result.root}`,
    `Config: ${result.config.exists ? result.config.valid ? `valid v${result.config.version}` : `invalid (${result.config.error})` : "missing"}`,
    `Bridge: ${bridges}`,
    `Workspace: ${result.workspace.skills.declared} declared skills, ${result.workspace.skills.installed} installed skills, ${result.workspace.workflows} workflows, ${result.workspace.harnesses} harnesses, ${result.workspace.installUnits.total} install units`,
    `Skill states: ${renderCounts(result.workspace.skills.byStatus)}`,
    `Invocations: ${renderCounts(result.workspace.skills.byInvocation)}`,
    `Source classes: ${renderCounts(result.workspace.installUnits.bySourceClass)}`,
    `Source ${sourceMode}: ${result.sources.ok ? "passed" : "failed"} (${result.sources.errors.length} errors, ${result.sources.warnings.length} warnings, ${result.sources.blockingWarnings.length} blocking warnings)`,
    `Policy: ${result.policy.ok ? "passed" : "failed"} (${result.policy.errors.length} errors, ${result.policy.warnings.length} warnings)`,
    `Strict gate: ${result.strictOk ? "passed" : "review needed"}`,
    `Review required: ${result.reviewRequired}`,
    `High-risk install units: ${formatList(result.workspace.installUnits.highRisk)}`,
    `Runtime extension units: ${formatList(result.workspace.installUnits.runtimeExtensions)}`,
    `Uninstall dry run: remove ${result.uninstall.removed.length}, update ${result.uninstall.updated.length}, preserve ${result.uninstall.preserved.length}`
  ];
  if (result.recommendations.length > 0) {
    lines.push("Recommendations:");
    for (const recommendation of result.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderCounts(counts) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  return entries.length === 0
    ? "none"
    : entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

function helpText() {
  return [
    "SkillBoard - workflow-scoped agent skill policy",
    "",
    "Commands:",
    "  init [--dir <path>] [--scan-root <dir>[,<dir>]] [--no-scan-installed]",
    "  uninstall [--dir <path>] [--dry-run] [--remove-config|--reset-config] [--remove-reports] [--remove-hooks] [--keep-empty-dirs]",
    "  inventory refresh [--dir <path>] [--config <path>] [--scan-root <dir>[,<dir>]] [--dry-run] [--json]",
    "  inventory detect --unit <id> --config <path> [--install-output <path>] [--config-file a,b] [--source <value>] [--kind <kind>] [--scope <scope>] [--dry-run] [--json]",
    "  sources refresh [--dir <path>] [--config <path>] [--unit <id>[,<id>]] [--cache-dir <dir>] [--dry-run] [--json]",
    "  doctor [--dir <path>] [--config <path>] [--skills <dir>] [--verify] [--strict] [--json]",
    "  status [--dir <path>] [--config <path>] [--skills <dir>] [--verify] [--strict] [--json]",
    "  brief [--workflow <name>] [--dir <path>] [--config <path>] [--skills <dir>] [--include-actions] [--json]",
    "  import --profile <id-or-path> --source-root <dir> [--profile-dirs a,b] [--out <path>]",
    "  import --profile <id-or-path> --source-root <dir> --config <path> --merge [--replace] [--dry-run]",
    "  scan --config <path>",
    "  check --config <path> --skills <dir>",
    "  list [skills|workflows|harnesses|install-units] --config <path> --skills <dir> [--workflow <name>] [--json]",
    "  explain <skill-id> --config <path> --skills <dir> [--json]",
    "  can-use <skill-id> --workflow <name> --config <path> --skills <dir> [--json]",
    "  guard use <skill-id> --workflow <name> --config <path> --skills <dir> [--json]",
    "  audit sources --config <path> --skills <dir> [--verify] [--json]",
    "  rollout [audit|plan|apply|rollback|report] [--dir <path>] [--config <path>] [--skills <dir>] [--transaction <id>] [--json]",
    "  hook install --workflow <name> --config <path> --skills <dir> [--out <path>] [--skillboard-bin <path>] [--dry-run] [--json]",
    "  lock write --config <path> --skills <dir> [--out <path>] [--replace] [--allow-unverified] [--json]",
    "  review install-unit <unit-id> [--trust-level trusted|reviewed|unreviewed|blocked] --config <path> --skills <dir> [--dry-run] [--json]",
    "  add skill <skill-id> --path <relative-skill-path> --config <path> --skills <dir> [--status <status>] [--invocation <mode>] [--exposure <exposure>] [--category <name>] [--workflow <name>] [--dry-run] [--json]",
    "  add workflow <workflow-name> --harness <harness-name> --config <path> --skills <dir> [--skill <id>[,<id>]] [--harness-status <status>] [--require-existing-harness] [--dry-run] [--json]",
    "  add harness <harness-name> --config <path> --skills <dir> [--status <status>] [--command <cmd>[,<cmd>]] [--dry-run] [--json]",
    "  activate <skill-id> --workflow <name> [--mode manual-only|router-only|workflow-auto] --config <path> --skills <dir> [--dry-run] [--json]",
    "  block <skill-id> --workflow <name> --config <path> --skills <dir> [--dry-run] [--json]",
    "  quarantine <skill-id> --config <path> --skills <dir> [--dry-run] [--json]",
    "  prefer <skill-id> --workflow <name> --capability <name> --config <path> --skills <dir> [--dry-run] [--json]",
    "  remove skill <skill-id> --config <path> --skills <dir> [--force] [--dry-run] [--json]",
    "  dashboard --config <path> --skills <dir> [--out <path>]",
    "  reconcile --config <path> --skills <dir> [--actual-harnesses a,b] [--out <path>]",
    "  impact disable <skill-id> --config <path> --skills <dir> [--out <path>]",
    ""
  ].join("\n");
}
