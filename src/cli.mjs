import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  activateSkill,
  auditSources,
  blockSkill,
  canUseSkill,
  checkPolicy,
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
  reconcileWorkspace,
  renderDashboard,
  renderImportFragment,
  renderReconcilePlan,
  verifySources,
  writeLockfile
} from "./index.mjs";
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
    case "import":
      return await importProfile(options, stdout);
    case "scan":
      return await scan(options, stdout);
    case "check":
      return await check(options, stdout, stderr);
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
    case "activate":
      return await activate(argv.slice(1), options, stdout);
    case "block":
      return await block(argv.slice(1), options, stdout);
    case "quarantine":
      return await quarantine(argv.slice(1), options, stdout);
    case "prefer":
      return await prefer(argv.slice(1), options, stdout);
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
  await writeFile(path, merged.text, "utf8");
  stdout.write(`Import merged: ${path}\n`);
  stdout.write(`Skills: ${formatList(merged.addedSkills)}\n`);
  stdout.write(`Install units: ${formatList(merged.addedInstallUnits)}\n`);
  if (merged.replacedSkills.length > 0 || merged.replacedInstallUnits.length > 0) {
    stdout.write(`Replaced skills: ${formatList(merged.replacedSkills)}\n`);
    stdout.write(`Replaced install units: ${formatList(merged.replacedInstallUnits)}\n`);
  }
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

async function hook(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] !== "install") {
    throw new Error("Usage: skillboard hook install --workflow <name> [--out <path>] [--skillboard-bin <path>]");
  }
  const workflow = options.get("workflow");
  if (workflow === undefined) {
    throw new Error("Usage: skillboard hook install --workflow <name> [--out <path>] [--skillboard-bin <path>]");
  }
  const result = await installGuardHook({
    workflow,
    out: options.get("out"),
    command: options.get("skillboard-bin"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options)
  });
  writeOutput(stdout, result, options, () => `Installed guard hook: ${result.path}\n`);
  return 0;
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
  stdout.write(`Changed: ${result.changed}\n`);
  stdout.write(`Changed line positions: ${result.plan.changedLineCount}\n`);
  if (warnings.length > 0) {
    stdout.write(`${warnings.join("\n")}\n`);
  }
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

function helpText() {
  return [
    "SkillBoard - workflow-scoped agent skill policy",
    "",
    "Commands:",
    "  init [--dir <path>] [--scan-root <dir>[,<dir>]] [--no-scan-installed]",
    "  uninstall [--dir <path>] [--dry-run] [--remove-config] [--keep-empty-dirs]",
    "  import --profile <id-or-path> --source-root <dir> [--profile-dirs a,b] [--out <path>]",
    "  import --profile <id-or-path> --source-root <dir> --config <path> --merge [--replace]",
    "  scan --config <path>",
    "  check --config <path> --skills <dir>",
    "  list [skills|workflows|harnesses|install-units] --config <path> --skills <dir> [--workflow <name>] [--json]",
    "  explain <skill-id> --config <path> --skills <dir> [--json]",
    "  can-use <skill-id> --workflow <name> --config <path> --skills <dir> [--json]",
    "  guard use <skill-id> --workflow <name> --config <path> --skills <dir> [--json]",
    "  audit sources --config <path> --skills <dir> [--verify] [--json]",
    "  hook install --workflow <name> --config <path> --skills <dir> [--out <path>] [--skillboard-bin <path>] [--json]",
    "  lock write --config <path> --skills <dir> [--out <path>] [--replace] [--allow-unverified] [--json]",
    "  activate <skill-id> --workflow <name> [--mode manual-only|router-only|workflow-auto] --config <path> --skills <dir> [--dry-run] [--json]",
    "  block <skill-id> --workflow <name> --config <path> --skills <dir> [--dry-run] [--json]",
    "  quarantine <skill-id> --config <path> --skills <dir> [--dry-run] [--json]",
    "  prefer <skill-id> --workflow <name> --capability <name> --config <path> --skills <dir> [--dry-run] [--json]",
    "  dashboard --config <path> --skills <dir> [--out <path>]",
    "  reconcile --config <path> --skills <dir> [--actual-harnesses a,b] [--out <path>]",
    "  impact disable <skill-id> --config <path> --skills <dir> [--out <path>]",
    ""
  ].join("\n");
}
