// allow: SIZE_OK - uninstall lifecycle split is deferred from the 0.2.7 release gate.
import { access, lstat, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_END, BRIDGE_START, defaultConfig, hookReadme, profileReadme } from "./lifecycle-content.mjs";

export async function uninstallProject(options) {
  const root = options.root;
  const dryRun = options.dryRun === true;
  const removed = [];
  const updated = [];
  const preserved = [];
  const plannedRemovedPaths = new Set();

  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    const path = join(root, filename);
    const result = await removeBridge(path, dryRun);
    if (result === "removed") {
      plannedRemovedPaths.add(path);
    }
    recordFileResult(filename, result, { removed, updated, preserved });
  }

  if (options.resetConfig === true) {
    const path = join(root, "skillboard.config.yaml");
    const result = await removeConfigFile(path, dryRun);
    if (result === "removed") {
      plannedRemovedPaths.add(path);
    }
    recordFileResult("skillboard.config.yaml", result, { removed, updated, preserved });
  } else if (options.removeConfig === true) {
    const path = join(root, "skillboard.config.yaml");
    const result = await removeGeneratedFile(path, defaultConfig(), dryRun);
    if (result === "removed") {
      plannedRemovedPaths.add(path);
    }
    recordFileResult("skillboard.config.yaml", result, { removed, updated, preserved });
  } else if (await exists(join(root, "skillboard.config.yaml"))) {
    preserved.push("skillboard.config.yaml");
  }

  if (options.removeProjectState === true) {
    const path = join(root, ".skillboard");
    const result = await removeProjectStateDir(path, dryRun);
    if (result === "removed") {
      plannedRemovedPaths.add(path);
    }
    recordFileResult(".skillboard", result, { removed, updated, preserved });
  } else {
    for (const entry of generatedFiles(root)) {
      const result = await removeGeneratedFile(entry.path, entry.expected, dryRun);
      if (result === "removed") {
        plannedRemovedPaths.add(entry.path);
      }
      recordFileResult(entry.label, result, { removed, updated, preserved });
    }
  }

  if (options.removeReports === true && options.removeProjectState !== true) {
    const path = join(root, ".skillboard", "reports");
    const result = await removeGeneratedDir(path, dryRun);
    if (result === "removed") {
      plannedRemovedPaths.add(path);
    }
    recordFileResult(".skillboard/reports", result, { removed, updated, preserved });
  }

  if (options.removeHooks === true && options.removeProjectState !== true) {
    const path = join(root, ".skillboard", "hooks");
    const result = await removeGeneratedDir(path, dryRun);
    if (result === "removed") {
      plannedRemovedPaths.add(path);
    }
    recordFileResult(".skillboard/hooks", result, { removed, updated, preserved });
  }

  if (options.removeEmptyDirs !== false) {
    for (const dir of emptyDirs(root, {
      skipReports: options.removeReports === true,
      skipHooks: options.removeHooks === true,
      skipSkillboard: options.removeProjectState === true
    })) {
      const result = await removeEmptyDir(dir.path, dryRun, plannedRemovedPaths);
      if (result === "removed") {
        plannedRemovedPaths.add(dir.path);
      }
      recordFileResult(dir.label, result, { removed, updated, preserved });
    }
  }

  return { dryRun, removed, updated, preserved };
}

function generatedFiles(root) {
  return [
    {
      label: ".skillboard/profiles/README.md",
      path: join(root, ".skillboard", "profiles", "README.md"),
      expected: profileReadme()
    },
    {
      label: ".skillboard/hooks/README.md",
      path: join(root, ".skillboard", "hooks", "README.md"),
      expected: hookReadme()
    }
  ];
}

function emptyDirs(root, options = {}) {
  const dirs = [
    { label: ".skillboard/profiles", path: join(root, ".skillboard", "profiles") },
    { label: ".skillboard/hooks", path: join(root, ".skillboard", "hooks") },
    { label: ".skillboard/reports", path: join(root, ".skillboard", "reports") },
    { label: ".skillboard", path: join(root, ".skillboard") },
    { label: "skills", path: join(root, "skills") }
  ];
  return dirs.filter((dir) => {
    if (options.skipReports === true && dir.label === ".skillboard/reports") {
      return false;
    }
    if (options.skipHooks === true && dir.label === ".skillboard/hooks") {
      return false;
    }
    if (options.skipSkillboard === true && dir.label.startsWith(".skillboard")) {
      return false;
    }
    return true;
  });
}

async function removeBridge(path, dryRun) {
  const stats = await pathStats(path);
  if (stats === null) {
    return "absent";
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return "preserved";
  }
  const current = await readFile(path, "utf8");
  const next = withoutBridgeBlock(current);
  if (next === current) {
    return "preserved";
  }
  if (next.trim().length === 0) {
    if (!dryRun) {
      await rm(path);
    }
    return "removed";
  }
  if (!dryRun) {
    await writeFile(path, next, "utf8");
  }
  return "updated";
}

function withoutBridgeBlock(text) {
  const start = text.indexOf(BRIDGE_START);
  if (start === -1) {
    return text;
  }
  const end = text.indexOf(BRIDGE_END, start);
  if (end === -1) {
    return text;
  }
  const afterBlock = end + BRIDGE_END.length;
  let before = text.slice(0, start);
  let after = text.slice(afterBlock).replace(/^\r?\n/u, "");
  if (before.endsWith("\r\n\r\n")) {
    before = before.slice(0, -2);
  } else if (before.endsWith("\n\n")) {
    before = before.slice(0, -1);
  }
  if (before.trim().length === 0 && after.trim().length === 0) {
    return "";
  }
  if (before.length > 0 && after.length > 0 && !before.endsWith("\n")) {
    after = `${lineEnding(text)}${after}`;
  }
  return `${before}${after}`;
}

async function removeGeneratedFile(path, expected, dryRun) {
  const stats = await pathStats(path);
  if (stats === null) {
    return "absent";
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return "preserved";
  }
  const current = await readFile(path, "utf8");
  if (current !== expected) {
    return "preserved";
  }
  if (!dryRun) {
    await rm(path);
  }
  return "removed";
}

async function removeConfigFile(path, dryRun) {
  const stats = await pathStats(path);
  if (stats === null) {
    return "absent";
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return "preserved";
  }
  if (!dryRun) {
    await rm(path);
  }
  return "removed";
}

async function removeGeneratedDir(path, dryRun) {
  const stats = await pathStats(path);
  if (stats === null) {
    return "absent";
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return "preserved";
  }
  if (!dryRun) {
    await rm(path, { recursive: true });
  }
  return "removed";
}

async function removeProjectStateDir(path, dryRun) {
  const stats = await pathStats(path);
  if (stats === null) {
    return "absent";
  }
  if (stats.isSymbolicLink()) {
    if (!dryRun) {
      await rm(path);
    }
    return "removed";
  }
  if (!stats.isDirectory()) {
    return "preserved";
  }
  if (!dryRun) {
    await rm(path, { recursive: true });
  }
  return "removed";
}

async function removeEmptyDir(path, dryRun, plannedRemovedPaths) {
  const stats = await pathStats(path);
  if (stats === null) {
    return "absent";
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return "preserved";
  }
  const entries = (await readdir(path)).filter((entry) => !plannedRemovedPaths.has(join(path, entry)));
  if (entries.length > 0) {
    return "preserved";
  }
  if (!dryRun) {
    await rmdir(path);
  }
  return "removed";
}

function recordFileResult(label, result, output) {
  if (result === "removed") {
    output.removed.push(label);
  } else if (result === "updated") {
    output.updated.push(label);
  } else if (result === "preserved") {
    output.preserved.push(label);
  }
}

function lineEnding(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function pathStats(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
