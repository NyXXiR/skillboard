import { isAbsolute, relative, resolve } from "node:path";
import { runAgentLayerUninstallCommand } from "./agent-integration-cli.mjs";
import { initProject } from "./init.mjs";
import { uninstallProject } from "./uninstall.mjs";
import { uninstallUser } from "./user-uninstall.mjs";

export { runSetupCommand } from "./agent-integration-cli.mjs";

export async function runInitCommand(options, stdout, runtime = defaultRuntime()) {
  const root = resolve(options.get("dir") ?? ".");
  const result = await initProject({
    root,
    scanInstalled: options.get("scan-installed") !== "false" && options.get("no-scan-installed") !== "true",
    scanRoots: readCsv(options.get("scan-root"))
  });
  if (result.alreadyInitialized) {
    stdout.write(`SkillBoard already initialized: ${root}\n`);
    return 0;
  }
  stdout.write(`Initialized SkillBoard: ${root}\n`);
  writeList(stdout, "Created", result.created);
  writeList(stdout, "Updated", result.updated);
  if (result.scan.scannedSkills > 0 || result.scan.scannedInstallUnits > 0) {
    stdout.write(`Scanned installed agent skills: ${result.scan.scannedSkills}\n`);
    stdout.write(`Managed install units: ${result.scan.scannedInstallUnits}\n`);
  }
  writeCountedList(stdout, "Added managed skills", result.scan.addedSkills);
  writeList(stdout, "Added install units", result.scan.addedInstallUnits);
  writeList(stdout, "Added workflows", result.scan.addedWorkflows ?? []);
  writeList(stdout, "Added harnesses", result.scan.addedHarnesses ?? []);
  writeList(stdout, "Skipped existing skills", result.scan.skippedSkills);
  writeCountedList(stdout, "Review notes", result.scan.reviewNotes ?? []);
  writeList(stdout, "Scan warnings", result.scan.warnings ?? []);
  writeSafetyDefault(stdout, result.safety);
  writeNextCommands(stdout, {
    command: commandPrefix(runtime),
    dir: options.get("dir"),
    workflows: result.scan.addedWorkflows ?? []
  });
  return 0;
}

export async function runUninstallCommand(options, stdout, runtime = defaultRuntime()) {
  if (options.get("user") === "true") {
    return await runUserUninstallCommand(options, stdout, runtime);
  }
  if (options.get("agent-layer") === "true") {
    return await runAgentLayerUninstallCommand(options, stdout, runtime);
  }
  const removeConfig = options.get("remove-config") === "true";
  const resetConfig = options.get("reset-config") === "true";
  const purge = options.get("purge") === "true";
  const keepSettings = options.get("keep-settings") === "true";
  const removeReports = options.get("remove-reports") === "true";
  const removeHooks = options.get("remove-hooks") === "true";
  if (removeConfig && resetConfig) {
    throw new Error("--remove-config and --reset-config are mutually exclusive");
  }
  if (removeConfig && purge) {
    throw new Error("--remove-config cannot be combined with --purge");
  }
  if (keepSettings && purge) {
    throw new Error("--keep-settings cannot be combined with --purge");
  }
  if (keepSettings && (removeConfig || resetConfig)) {
    throw new Error("--keep-settings cannot be combined with --remove-config or --reset-config");
  }
  const root = resolve(options.get("dir") ?? ".");
  const granularCleanup = removeConfig || resetConfig || removeReports || removeHooks;
  const cleanSettings = !keepSettings && (purge || !granularCleanup);
  const result = await uninstallProject({
    root,
    dryRun: options.get("dry-run") === "true",
    keepBridge: keepSettings,
    removeConfig,
    resetConfig: resetConfig || cleanSettings,
    removeReports: removeReports || cleanSettings,
    removeHooks: removeHooks || cleanSettings,
    removeProjectState: cleanSettings,
    removeEmptyDirs: !keepSettings && options.get("keep-empty-dirs") !== "true"
  });
  stdout.write(`${result.dryRun ? "Dry run: " : ""}Uninstalled SkillBoard: ${root}\n`);
  writeList(stdout, "Removed", result.removed);
  writeList(stdout, "Updated", result.updated);
  writeList(stdout, "Preserved", result.preserved);
  return 0;
}

async function runUserUninstallCommand(options, stdout, runtime) {
  const allowed = new Set(["user", "dry-run", "yes", "json"]);
  for (const option of options.keys()) {
    if (!allowed.has(option)) {
      throw new Error(`Unknown option for uninstall --user: --${option}`);
    }
  }
  const dryRun = options.get("dry-run") === "true";
  if (!dryRun && options.get("yes") !== "true") {
    throw new Error("skillboard uninstall --user requires --yes; preview first with --dry-run");
  }
  const result = await uninstallUser({
    dryRun,
    env: runtime.env ?? process.env,
    runtime
  });
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  stdout.write(`${dryRun ? "Dry run: " : ""}Uninstalled SkillBoard user state.\n`);
  writeList(stdout, "Managed copies", result.managed_copies.map((copy) => copy.path));
  writeList(stdout, "Guidance removed", result.guidance.removed);
  writeList(stdout, "Guidance updated", result.guidance.updated);
  writeList(stdout, "State", result.state_paths);
  writeList(stdout, "Preserved", result.preserved);
  if (dryRun) stdout.write("Run skillboard uninstall --user --yes to apply this plan.\n");
  return 0;
}

function writeList(stdout, label, values) {
  if (values.length > 0) {
    stdout.write(`${label}: ${formatList(values)}\n`);
  }
}

function writeCountedList(stdout, label, values) {
  if (values.length === 0) {
    return;
  }
  stdout.write(`${label}: ${values.length}\n`);
  for (const value of sorted(values).slice(0, 5)) {
    stdout.write(`- \`${value}\`\n`);
  }
  const hidden = values.length - 5;
  if (hidden > 0) {
    stdout.write(`- ... ${hidden} more\n`);
  }
}

function writeSafetyDefault(stdout, safety) {
  stdout.write("Skill selection default:\n");
  stdout.write("- Valid installed skills default to enabled and agent-local.\n");
  stdout.write("- Users may disable a skill or explicitly share that skill across agents.\n");
  stdout.write("- Optional preference ranks candidates and never changes availability.\n");
  stdout.write("- Source and provenance are audit metadata, never availability.\n");
  stdout.write(`- ${safety.enabled} enabled skills\n`);
  stdout.write(`- ${safety.disabled} disabled skills\n`);
}

function writeNextCommands(stdout, next) {
  const dir = next.dir === undefined ? "" : ` --dir ${shellQuote(next.dir)}`;
  const workflows = sorted(next.workflows ?? []);
  stdout.write("Next:\n");
  stdout.write('- Ask your AI: "What skills can you use in this project?"\n');
  stdout.write(`- ${next.command} doctor${dir} --summary\n`);
  if (workflows.length === 0) {
    stdout.write(`- ${next.command} brief${dir}\n`);
    stdout.write(`- ${next.command} brief${dir} --verbose\n`);
    return;
  }
  const workflow = workflows[0];
  stdout.write(`Choose a workflow: ${formatList(workflows)}\n`);
  stdout.write(`Example workflow brief: ${formatList([workflow])}\n`);
  stdout.write(`- ${next.command} brief --workflow ${shellQuote(workflow)}${dir}\n`);
  stdout.write('Example task routing: "write tests before implementation"\n');
  stdout.write(`- ${next.command} brief --workflow ${shellQuote(workflow)} --intent ${shellQuote("write tests before implementation")}${dir}\n`);
  stdout.write(`- ${next.command} brief --workflow ${shellQuote(workflow)}${dir} --verbose\n`);
}

function formatList(values) {
  return values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", ");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function readCsv(value) {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function defaultRuntime() {
  return {
    cwd: process.cwd(),
    entrypointPath: process.argv[1],
    packageSpec: process.env.npm_config_package
  };
}

function commandPrefix(runtime) {
  const entrypoint = runtime.entrypointPath ?? "";
  const normalized = entrypoint.replace(/\\/g, "/");
  if (normalized.includes("/_npx/")) {
    const packageSpec = runtime.packageSpec ?? "agent-skillboard";
    return `npx --yes --package ${shellQuote(packageSpec)} skillboard`;
  }
  if (isSourceTreeEntrypoint(entrypoint)) {
    return `node ${sourceTreeEntrypoint(entrypoint, runtime.cwd ?? process.cwd())}`;
  }
  return "skillboard";
}

function isSourceTreeEntrypoint(entrypoint) {
  if (entrypoint === "") {
    return false;
  }
  const normalized = entrypoint.replace(/\\/g, "/");
  return (normalized === "bin/skillboard.mjs" || normalized.endsWith("/bin/skillboard.mjs"))
    && !normalized.includes("/node_modules/")
    && !normalized.includes("/_npx/")
    && !normalized.includes("/.npm/");
}

function sourceTreeEntrypoint(entrypoint, cwd) {
  const absoluteEntrypoint = isAbsolute(entrypoint) ? entrypoint : resolve(cwd, entrypoint);
  const relativeEntrypoint = relative(cwd, absoluteEntrypoint).replace(/\\/g, "/");
  if (!relativeEntrypoint.startsWith("../") && relativeEntrypoint !== ".." && !isAbsolute(relativeEntrypoint)) {
    return shellQuote(relativeEntrypoint);
  }
  return shellQuote(absoluteEntrypoint);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
