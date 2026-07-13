import { lstat, readdir, readFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { uninstallAgentIntegration } from "./agent-integration-files.mjs";
import { resolveSetupHome } from "./agent-integration-home.mjs";
import {
  agentSkillRootCandidates,
  supportedAgentNames
} from "./agent-skill-roots.mjs";

const SHARE_MARKER = ".skillboard-share.json";

export async function uninstallUser(options = {}) {
  const env = options.env ?? process.env;
  const home = await resolveSetupHome(env, options.runtime ?? {});
  const planned = await planUserUninstall(home, env);
  if (options.dryRun) {
    const guidance = await uninstallAgentIntegration(planned.guidanceTargets, true);
    return result(home, true, planned.managedCopies, guidance, planned.statePaths, planned.preserved);
  }

  const removedCopies = [];
  const preserved = [...planned.preserved];
  for (const copy of planned.managedCopies) {
    if (await removeManagedCopy(copy)) {
      removedCopies.push(copy);
    } else {
      preserved.push(copy.path);
    }
  }
  const guidance = await uninstallAgentIntegration(planned.guidanceTargets, false);
  const removedState = [];
  for (const state of planned.statePaths) {
    if (await removeStatePath(state)) removedState.push(state);
    else preserved.push(state);
  }
  return result(home, false, removedCopies, guidance, removedState, preserved);
}

async function planUserUninstall(home, env) {
  const preserved = [];
  const roots = [{ root: join(home, ".agents", "shared-skills"), agent: null }];
  for (const agent of supportedAgentNames()) {
    for (const candidate of await agentSkillRootCandidates(agent, home, env)) {
      roots.push({ root: candidate.skillRoot, agent });
    }
  }
  const managedCopies = [];
  const seenRoots = new Set();
  for (const entry of roots) {
    const root = resolve(entry.root);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    managedCopies.push(...await managedCopiesInRoot(root, entry.agent, preserved));
  }

  const guidanceTargets = [];
  for (const agent of supportedAgentNames()) {
    for (const candidate of await agentSkillRootCandidates(agent, home, env)) {
      guidanceTargets.push({
        agent,
        home,
        skillPath: join(candidate.skillRoot, "skillboard", "SKILL.md"),
        root: candidate.skillRoot,
        source: candidate.source
      });
    }
  }
  return {
    managedCopies: managedCopies.sort((left, right) => left.path.localeCompare(right.path)),
    guidanceTargets,
    statePaths: await existingStatePaths(home),
    preserved: [...new Set(preserved)].sort()
  };
}

async function managedCopiesInRoot(root, agent, preserved) {
  const stats = await pathStats(root);
  if (stats === null) return [];
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    preserved.push(root);
    return [];
  }
  const copies = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    const marker = await readManagedMarker(path, entry.name, agent);
    if (marker !== null) copies.push({ path, skill: entry.name, agent, mode: marker.mode });
  }
  return copies;
}

async function readManagedMarker(path, skill, agent) {
  const markerPath = join(path, SHARE_MARKER);
  const stats = await pathStats(markerPath);
  if (stats === null || stats.isSymbolicLink() || !stats.isFile()) return null;
  const value = await readFile(markerPath, "utf8").then(parseJsonOrNull, () => null);
  if (value?.version !== 1 || value.managed_by !== "skillboard" || value.skill !== skill) return null;
  if (agent === null && value.mode === "shared-source") return value;
  if (agent !== null && value.mode === "agent-copy" && value.target_agent === agent) return value;
  return null;
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function removeManagedCopy(copy) {
  const stats = await pathStats(copy.path);
  if (stats === null) return true;
  if (stats.isSymbolicLink() || !stats.isDirectory()) return false;
  const marker = await readManagedMarker(copy.path, copy.skill, copy.agent);
  if (marker === null || marker.mode !== copy.mode) return false;
  await rm(copy.path, { recursive: true, force: true });
  return true;
}

async function existingStatePaths(home) {
  const result = [];
  for (const path of [join(home, "skillboard.config.yaml"), join(home, ".skillboard")]) {
    if (await pathStats(path) !== null) result.push(path);
  }
  return result;
}

async function removeStatePath(path) {
  const stats = await pathStats(path);
  if (stats === null) return true;
  const name = basename(path);
  const supported = name === "skillboard.config.yaml"
    ? stats.isFile() || stats.isSymbolicLink()
    : name === ".skillboard" && (stats.isDirectory() || stats.isSymbolicLink());
  if (!supported) return false;
  await rm(path, { recursive: stats.isDirectory(), force: true });
  return true;
}

function result(home, dryRun, managedCopies, guidance, statePaths, preserved) {
  return {
    ok: true,
    mode: "user",
    dry_run: dryRun,
    home,
    managed_copies: managedCopies,
    guidance,
    state_paths: statePaths,
    preserved: [...new Set([...preserved, ...guidance.preserved])].sort()
  };
}

async function pathStats(path) {
  return await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}
