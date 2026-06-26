import { isAbsolute, relative, resolve } from "node:path";
import { initProject } from "./init.mjs";
import { uninstallProject } from "./uninstall.mjs";

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
    dir: options.get("dir")
  });
  return 0;
}

export async function runUninstallCommand(options, stdout) {
  if (options.get("remove-config") === "true" && options.get("reset-config") === "true") {
    throw new Error("--remove-config and --reset-config are mutually exclusive");
  }
  const root = resolve(options.get("dir") ?? ".");
  const result = await uninstallProject({
    root,
    dryRun: options.get("dry-run") === "true",
    removeConfig: options.get("remove-config") === "true",
    resetConfig: options.get("reset-config") === "true",
    removeReports: options.get("remove-reports") === "true",
    removeHooks: options.get("remove-hooks") === "true",
    removeEmptyDirs: options.get("keep-empty-dirs") !== "true"
  });
  stdout.write(`${result.dryRun ? "Dry run: " : ""}Uninstalled SkillBoard: ${root}\n`);
  writeList(stdout, "Removed", result.removed);
  writeList(stdout, "Updated", result.updated);
  writeList(stdout, "Preserved", result.preserved);
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
  stdout.write("Safety default:\n");
  stdout.write("- Installed does not mean allowed.\n");
  if (safety.automatic === 0) {
    stdout.write("- No automatic model invocation was enabled.\n");
  } else {
    stdout.write(`- ${safety.automatic} automatic skills enabled by existing policy.\n`);
  }
  stdout.write("- Imported local skills are manual-only.\n");
  stdout.write("- Runtime/plugin/system skills are quarantined until reviewed.\n");
  stdout.write(`- ${safety.automatic} automatic skills enabled\n`);
  stdout.write(`- ${safety.manualOnly} manual-only skills available\n`);
  stdout.write(`- ${safety.routerOnly} router-only skills available\n`);
  stdout.write(`- ${safety.blocked} blocked/quarantined for safety\n`);
}

function writeNextCommands(stdout, next) {
  const dir = next.dir === undefined ? "" : ` --dir ${shellQuote(next.dir)}`;
  stdout.write("Next:\n");
  stdout.write(`- ${next.command} doctor${dir} --summary\n`);
  stdout.write(`- ${next.command} brief${dir}\n`);
  stdout.write(`- ${next.command} brief${dir} --verbose\n`);
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
  const normalized = entrypoint.replaceAll("\\", "/");
  if (normalized.includes("/_npx/")) {
    if (runtime.packageSpec !== undefined && runtime.packageSpec !== "agent-skillboard") {
      return `npm exec --yes --package ${shellQuote(runtime.packageSpec)} -- skillboard`;
    }
    return "npx agent-skillboard";
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
  const normalized = entrypoint.replaceAll("\\", "/");
  return (normalized === "bin/skillboard.mjs" || normalized.endsWith("/bin/skillboard.mjs"))
    && !normalized.includes("/node_modules/")
    && !normalized.includes("/_npx/")
    && !normalized.includes("/.npm/");
}

function sourceTreeEntrypoint(entrypoint, cwd) {
  const absoluteEntrypoint = isAbsolute(entrypoint) ? entrypoint : resolve(cwd, entrypoint);
  const relativeEntrypoint = relative(cwd, absoluteEntrypoint).replaceAll("\\", "/");
  if (!relativeEntrypoint.startsWith("../") && relativeEntrypoint !== ".." && !isAbsolute(relativeEntrypoint)) {
    return shellQuote(relativeEntrypoint);
  }
  return shellQuote(absoluteEntrypoint);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
