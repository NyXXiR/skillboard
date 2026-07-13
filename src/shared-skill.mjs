import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { analyzeAgentCompatibility, findSourceSkillInRoots } from "./agent-skill-import.mjs";
import { agentSkillRootCandidates, detectedAgentSkillRoots, supportedAgentNames } from "./agent-skill-roots.mjs";
import { setV2SkillShared } from "./control/v2-skill-crud.mjs";
import { refreshAgentInventory } from "./inventory-refresh.mjs";
import { loadWorkspace } from "./workspace.mjs";

const MARKER = ".skillboard-share.json";

export async function setSkillSharing(options) {
  const workspace = await loadWorkspace({ configPath: options.configPath, inventoryPath: options.inventoryPath });
  const policy = workspace.skills.find((skill) => skill.id === options.skillId);
  if (policy === undefined) throw new Error(`Unknown skill: ${options.skillId}`);
  return options.shared
    ? await shareSkill(options, workspace, policy)
    : await unshareSkill(options, policy);
}

async function shareSkill(options, workspace, policy) {
  const observation = workspace.inventory.skills.find((skill) => skill.id === options.skillId);
  const installedOn = agents(observation?.installed_on);
  const sourceAgent = installedOn[0];
  if (sourceAgent === undefined) {
    throw new Error(`Skill ${options.skillId} is not installed in a supported agent skill root.`);
  }
  const sourceRoots = (await detectedAgentSkillRoots(sourceAgent, options.home, options.env, { includeFallback: true }))
    .map((entry) => entry.skillRoot);
  const source = await findSourceSkillInRoots({ roots: sourceRoots, skill: options.skillId });
  const sourceDir = await realpath(source.skillDir);
  if (!(await lstat(sourceDir)).isDirectory()) {
    throw new Error(`Skill source is not a directory: ${source.skillDir}`);
  }
  const content = await readFile(source.skillFile, "utf8");
  const targetAgents = supportedAgentNames().filter((agent) => agent !== sourceAgent && !installedOn.includes(agent));
  for (const targetAgent of targetAgents) {
    const compatibility = analyzeAgentCompatibility(content, { sourceAgent, targetAgent });
    if (!compatibility.compatible) {
      throw new Error(`Skill ${options.skillId} needs adaptation for ${targetAgent}: ${compatibility.reasons.join("; ")}`);
    }
  }
  const sharedRoot = join(options.home, ".agents", "shared-skills");
  const sharedDir = shareTarget(sharedRoot, options.skillId);
  const targets = uniqueTargets((await Promise.all(targetAgents.map(async (agent) => {
    const roots = await detectedAgentSkillRoots(agent, options.home, options.env, { includeFallback: true });
    return roots.map((root) => ({ agent, root: root.skillRoot, path: shareTarget(root.skillRoot, options.skillId) }));
  }))).flat());
  await assertShareTargetAvailable(sharedRoot, sharedDir, options.home, options.skillId);
  for (const target of targets) {
    await assertShareTargetAvailable(target.root, target.path, options.home, options.skillId);
  }
  if (options.dryRun) {
    return sharingResult(options, policy, installedOn, targetAgents, false);
  }

  const created = [];
  let policyChanged = false;
  try {
    if (await copyManaged(sourceDir, sharedDir, marker(options.skillId, sourceAgent, "shared-source"), options)) {
      created.push(sharedDir);
    }
    for (const target of targets) {
      if (await exists(target.path)) continue;
      if (await copyManaged(sharedDir, target.path, marker(options.skillId, sourceAgent, "agent-copy", target.agent), options)) {
        created.push(target.path);
      }
    }
    await setPolicy(options, true);
    policyChanged = policy.shared !== true;
    failpoint(options, "after-policy-write");
    const refreshed = await refresh(options);
    const current = refreshedInventoryAgents(refreshed, options);
    return sharingResult(options, { ...policy, shared: true }, current, targetAgents, true);
  } catch (error) {
    const rollbackErrors = [];
    await Promise.all(created.reverse().map(async (path) => {
      await rm(path, { recursive: true, force: true }).catch((rollbackError) => rollbackErrors.push(rollbackError));
    }));
    if (policyChanged) {
      await setPolicy(options, policy.shared).catch((rollbackError) => rollbackErrors.push(rollbackError));
    }
    throw rollbackOutcome(error, rollbackErrors);
  }
}

async function unshareSkill(options, policy) {
  const managed = [];
  for (const agent of supportedAgentNames()) {
    for (const root of await agentSkillRootCandidates(agent, options.home, options.env)) {
      const path = shareTarget(root.skillRoot, options.skillId);
      if (await managedShare(path, options.skillId)) managed.push(path);
    }
  }
  const sharedDir = shareTarget(join(options.home, ".agents", "shared-skills"), options.skillId);
  if (await managedShare(sharedDir, options.skillId)) managed.push(sharedDir);
  if (options.dryRun) {
    return sharingResult(options, policy, [], [], false);
  }
  const staged = [];
  let policyChanged = false;
  try {
    await setPolicy(options, false);
    policyChanged = policy.shared !== false;
    for (const path of [...new Set(managed)]) {
      const stagedPath = join(
        dirname(dirname(path)),
        `.skillboard-unshare-${basename(path)}-${randomUUID()}`
      );
      await rename(path, stagedPath);
      staged.push({ path, stagedPath });
    }
    failpoint(options, "after-files-staged");
    await refresh(options);
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of staged.reverse()) {
      await rename(entry.stagedPath, entry.path).catch((rollbackError) => rollbackErrors.push(rollbackError));
    }
    if (policyChanged) {
      await setPolicy(options, policy.shared).catch((rollbackError) => rollbackErrors.push(rollbackError));
    }
    throw rollbackOutcome(error, rollbackErrors);
  }
  await Promise.all(staged.map((entry) => rm(entry.stagedPath, { recursive: true, force: true })));
  const workspace = await loadWorkspace({ configPath: options.configPath, inventoryPath: options.inventoryPath });
  const observation = workspace.inventory.skills.find((skill) => skill.id === options.skillId);
  return sharingResult(options, { ...policy, shared: false }, agents(observation?.installed_on), [], true);
}

async function setPolicy(options, shared) {
  await setV2SkillShared({ skillId: options.skillId, shared, configPath: options.configPath, dryRun: false });
}

async function refresh(options) {
  await refreshAgentInventory({
    root: options.home,
    configPath: options.configPath,
    home: options.home,
    env: options.env
  });
  return await loadWorkspace({ configPath: options.configPath, inventoryPath: options.inventoryPath });
}

function refreshedInventoryAgents(workspace, options) {
  return agents(workspace.inventory.skills.find((skill) => skill.id === options.skillId)?.installed_on);
}

export async function copyManaged(source, target, metadata, options = {}) {
  if (await exists(target)) {
    if (!await managedShare(target, metadata.skill)) {
      throw new Error(`Share target already exists and is not managed by SkillBoard: ${target}`);
    }
    return false;
  }
  await mkdir(dirname(target), { recursive: true });
  try {
    await mkdir(target);
  } catch (error) {
    if (error?.code === "EEXIST") {
      if (await managedShare(target, metadata.skill)) return false;
      throw new Error(`Share target already exists and is not managed by SkillBoard: ${target}`);
    }
    throw error;
  }
  try {
    failpoint(options, "after-copy-target-created");
    await copyDirectory(source, target);
    await writeFile(join(target, MARKER), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    return true;
  } catch (error) {
    const rollbackErrors = [];
    await rm(target, { recursive: true, force: true }).catch((rollbackError) => rollbackErrors.push(rollbackError));
    throw rollbackOutcome(error, rollbackErrors);
  }
}

async function copyDirectory(source, target) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await mkdir(targetPath);
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
    } else if (entry.isSymbolicLink()) {
      await symlink(await readlink(sourcePath), targetPath);
    } else {
      throw new Error(`Unsupported skill entry type: ${sourcePath}`);
    }
  }
}

export async function managedShareMetadata(path, skillId) {
  const directory = await pathStats(path);
  if (directory === null || directory.isSymbolicLink() || !directory.isDirectory()) return null;
  const markerPath = join(path, MARKER);
  const markerStats = await pathStats(markerPath);
  if (markerStats === null || markerStats.isSymbolicLink() || !markerStats.isFile()) return null;
  const value = await readFile(markerPath, "utf8").then(parseJsonOrNull, () => null);
  return value?.version === 1 && value.managed_by === "skillboard" && value.skill === skillId ? value : null;
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function managedShare(path, skillId) {
  return await managedShareMetadata(path, skillId) !== null;
}

export function marker(skill, sourceAgent, mode, targetAgent = null) {
  return { version: 1, managed_by: "skillboard", mode, skill, source_agent: sourceAgent, target_agent: targetAgent };
}

function agents(value) {
  const supported = new Set(supportedAgentNames());
  return [...new Set((Array.isArray(value) ? value : []).filter((agent) => supported.has(agent)))].sort();
}

function sharingResult(options, policy, installedOn, targets, changed) {
  return {
    ok: true,
    skill: options.skillId,
    shared: options.dryRun ? options.shared : policy.shared,
    changed,
    dry_run: options.dryRun,
    installed_on: agents(installedOn),
    target_agents: [...targets].sort()
  };
}

function failpoint(options, value) {
  if (options.env?.SKILLBOARD_SHARE_FAILPOINT === value) {
    throw new Error(`Injected sharing failure ${value}.`);
  }
}

function rollbackOutcome(error, rollbackErrors) {
  if (rollbackErrors.length === 0) return error;
  const original = error instanceof Error ? error.message : String(error);
  const rollback = rollbackErrors.map((entry) => entry instanceof Error ? entry.message : String(entry)).join("; ");
  return new Error(`${original} Rollback also failed: ${rollback}`);
}

async function exists(path) {
  return lstat(path).then(() => true, () => false);
}

export function shareTarget(root, skillId) {
  const value = String(skillId).replace(/\\/g, "/");
  if (value.trim() === "" || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    throw new Error("skill id must identify a relative skill directory");
  }
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, value);
  const rel = relative(resolvedRoot, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`skill id must stay under the skill root: ${skillId}`);
  }
  return target;
}

export async function assertShareTargetAvailable(root, target, home, skillId) {
  const resolvedRoot = resolve(root);
  const resolvedHome = resolve(home);
  const boundary = resolvedRoot === resolvedHome || isInside(resolvedRoot, resolvedHome)
    ? resolvedHome
    : resolvedRoot;
  for (const component of directoryComponents(boundary, dirname(target))) {
    const stats = await pathStats(component);
    if (stats?.isSymbolicLink()) {
      throw new Error(`Share target contains a symbolic link: ${component}`);
    }
    if (stats !== null && !stats.isDirectory()) {
      throw new Error(`Share target directory component is not a directory: ${component}`);
    }
  }
  const stats = await pathStats(target);
  if (stats === null) return;
  if (stats.isSymbolicLink()) {
    throw new Error(`Share target is a symbolic link: ${target}`);
  }
  if (!stats.isDirectory() || !await managedShare(target, skillId)) {
    throw new Error(`Share target already exists and is not managed by SkillBoard: ${target}`);
  }
}

function uniqueTargets(targets) {
  const byPath = new Map();
  for (const target of targets) byPath.set(resolve(target.path), target);
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function directoryComponents(boundary, targetDir) {
  const components = [];
  let current = resolve(targetDir);
  const root = resolve(boundary);
  while (current === root || isInside(current, root)) {
    components.push(current);
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return components.reverse();
}

function isInside(path, parent) {
  const rel = relative(parent, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function pathStats(path) {
  return lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}
