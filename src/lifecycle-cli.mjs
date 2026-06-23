import { resolve } from "node:path";
import { initProject } from "./init.mjs";
import { uninstallProject } from "./uninstall.mjs";

export async function runInitCommand(options, stdout) {
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
  writeList(stdout, "Added managed skills", result.scan.addedSkills);
  writeList(stdout, "Added install units", result.scan.addedInstallUnits);
  writeList(stdout, "Added workflows", result.scan.addedWorkflows ?? []);
  writeList(stdout, "Added harnesses", result.scan.addedHarnesses ?? []);
  writeList(stdout, "Skipped existing skills", result.scan.skippedSkills);
  writeList(stdout, "Review notes", result.scan.reviewNotes ?? []);
  writeList(stdout, "Scan warnings", result.scan.warnings ?? []);
  return 0;
}

export async function runUninstallCommand(options, stdout) {
  const root = resolve(options.get("dir") ?? ".");
  const result = await uninstallProject({
    root,
    dryRun: options.get("dry-run") === "true",
    removeConfig: options.get("remove-config") === "true",
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

function formatList(values) {
  return values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", ");
}

function readCsv(value) {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}
