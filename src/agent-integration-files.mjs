import { lstat, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AGENT_INTEGRATION_END, AGENT_INTEGRATION_START, agentIntegrationSkill } from "./agent-integration-content.mjs";
import { applyOwnership, isInside } from "./agent-integration-home.mjs";

export async function installAgentIntegration(targets, ownership = null) {
  const created = [];
  const updated = [];
  const unchanged = [];
  const preserved = [];
  const content = agentIntegrationSkill();
  for (const target of targets) {
    if (!await isSafeManagedSkillTarget(target)) {
      preserved.push(`${target.agent}:${target.skillPath}`);
      continue;
    }
    const existing = await readFile(target.skillPath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    });
    if (existing === content) {
      await applyOwnership(target.skillPath, ownership);
      unchanged.push(`${target.agent}:${target.skillPath}`);
      continue;
    }
    if (existing !== null && !existing.includes(AGENT_INTEGRATION_START)) {
      preserved.push(`${target.agent}:${target.skillPath}`);
      continue;
    }
    await mkdir(dirname(target.skillPath), { recursive: true });
    await writeFile(target.skillPath, content, "utf8");
    await applyOwnership(target.skillPath, ownership);
    (existing === null ? created : updated).push(`${target.agent}:${target.skillPath}`);
  }
  return { created, updated, unchanged, preserved };
}

export async function uninstallAgentIntegration(targets, dryRun) {
  const removed = [];
  const updated = [];
  const preserved = [];
  const absent = [];
  for (const target of targets) {
    const result = await removeAgentIntegration(target, dryRun);
    const value = `${target.agent}:${target.skillPath}`;
    if (result === "removed") {
      removed.push(value);
    } else if (result === "updated") {
      updated.push(value);
    } else if (result === "preserved") {
      preserved.push(value);
    } else {
      absent.push(value);
    }
  }
  return { removed, updated, preserved, absent };
}

async function removeAgentIntegration(target, dryRun) {
  if (!await isSafeManagedSkillTarget(target)) {
    return "preserved";
  }
  const path = target.skillPath;
  const stats = await pathStats(path);
  if (stats === null) {
    return "absent";
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return "preserved";
  }
  const current = await readFile(path, "utf8");
  const next = withoutAgentIntegrationBlock(current);
  if (next === null) {
    return "preserved";
  }
  if (shouldRemoveAgentIntegrationFile(next)) {
    if (!dryRun) {
      await rm(path);
      await removeEmptyManagedSkillDir(dirname(path));
    }
    return "removed";
  }
  if (!dryRun) {
    await writeFile(path, next, "utf8");
  }
  return "updated";
}

async function isSafeManagedSkillTarget(target) {
  const root = resolve(target.root);
  const skillPath = resolve(target.skillPath);
  const skillDir = dirname(skillPath);
  if (!isInside(skillDir, root) || !isInside(skillPath, root)) {
    return false;
  }
  if (await hasUnsafeManagedDirectoryComponent(root, skillDir)) {
    return false;
  }
  const skillStats = await pathStats(skillPath);
  return skillStats === null || !skillStats.isSymbolicLink();
}

async function hasUnsafeManagedDirectoryComponent(root, skillDir) {
  for (const component of managedDirectoryComponents(root, skillDir)) {
    const stats = await pathStats(component);
    if (stats !== null && (stats.isSymbolicLink() || !stats.isDirectory())) {
      return true;
    }
  }
  return false;
}

function managedDirectoryComponents(root, skillDir) {
  const beforeRoot = [];
  let current = root;
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    beforeRoot.push(parent);
    current = parent;
  }

  const fromRoot = [];
  current = skillDir;
  while (isInside(current, root)) {
    fromRoot.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  fromRoot.push(root);

  return uniquePaths([...beforeRoot.reverse(), ...fromRoot.reverse()]);
}

function uniquePaths(paths) {
  const seen = new Set();
  const unique = [];
  for (const path of paths) {
    if (!seen.has(path)) {
      seen.add(path);
      unique.push(path);
    }
  }
  return unique;
}

function withoutAgentIntegrationBlock(text) {
  const start = text.indexOf(AGENT_INTEGRATION_START);
  if (start === -1) {
    return null;
  }
  const end = text.indexOf(AGENT_INTEGRATION_END, start);
  if (end === -1) {
    return null;
  }
  const afterBlock = end + AGENT_INTEGRATION_END.length;
  let before = text.slice(0, start);
  const after = text.slice(afterBlock).replace(/^\r?\n/u, "");
  if (before.endsWith("\r\n\r\n")) {
    before = before.slice(0, -2);
  } else if (before.endsWith("\n\n")) {
    before = before.slice(0, -1);
  }
  return `${before}${after}`;
}

function shouldRemoveAgentIntegrationFile(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return true;
  }
  return /^---\s*\r?\nname:\s*skillboard\s*\r?\ndescription:[\s\S]*?\r?\n---\s*$/u.test(trimmed);
}

async function removeEmptyManagedSkillDir(path) {
  try {
    await rmdir(path);
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") {
      throw error;
    }
  }
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
