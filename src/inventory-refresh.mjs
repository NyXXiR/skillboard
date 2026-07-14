import { chmod, lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import YAML from "yaml";
import { discoverAgentSkillInventory, mergeAgentSkillInventory } from "./agent-inventory.mjs";
import { textChangePlan } from "./change-plan.mjs";
import { buildGeneratedInventory, mergeV2InventoryPolicy, renderGeneratedInventory } from "./inventory-json.mjs";
import { atomicWrite, optionalRead } from "./migration/v2-files.mjs";
import { loadWorkspace } from "./workspace.mjs";

const MINIMAL_V2_POLICY = "version: 2\nskills: {}\n";

export async function refreshAgentInventory(options = {}) {
  const root = resolve(options.root ?? ".");
  const configPath = resolveUnderRoot(root, options.configPath ?? "skillboard.config.yaml", "Inventory refresh config path");
  return withRefreshLock(root, async () => refreshLocked({ ...options, root, configPath }));
}

async function refreshLocked(options) {
  const { root, configPath } = options;
  const configStats = await lstat(configPath).catch(missingOnly);
  if (configStats?.isSymbolicLink()) {
    throw new Error("Inventory refresh config path must not be a symbolic link.");
  }
  const bootstrappedV2 = configStats === undefined;
  const current = bootstrappedV2 ? MINIMAL_V2_POLICY : await readFile(configPath, "utf8");
  if (!bootstrappedV2) {
    await loadWorkspace({ configPath });
  }
  const inventory = options.inventory ?? await discoverAgentSkillInventory({
    roots: options.roots,
    home: options.home,
    env: options.env,
    registeredRoots: options.registeredRoots
  });
  const configVersion = YAML.parse(current)?.version;
  const generatedInventory = configVersion === 2
    ? await buildGeneratedInventory(inventory, { root, home: options.home ?? options.env?.HOME })
    : null;
  const inventoryPath = resolveUnderRoot(root, options.inventoryPath ?? ".skillboard/inventory.json", "Generated inventory target");
  const inventoryText = generatedInventory === null ? null : renderGeneratedInventory(generatedInventory);
  if (inventoryText !== null) {
    await assertGeneratedInventoryTarget(root, inventoryPath);
  }
  const previousInventoryText = inventoryText === null
    ? null
    : await readFile(inventoryPath, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
  const projected = configVersion === 2
    ? mergeV2InventoryPolicy(current, inventory)
    : mergeAgentSkillInventory(current, inventory);
  const merged = configVersion === 1 && options.preserveLegacyPolicy === true
    ? { ...projected, text: current }
    : projected;
  const plan = textChangePlan(current, merged.text);
  const dryRun = options.dryRun === true;

  const inventoryChanged = inventoryText !== null && inventoryText !== previousInventoryText;
  if (!dryRun) {
    const [previousConfig, previousInventory] = await Promise.all([
      optionalRead(configPath),
      inventoryText === null ? Promise.resolve(null) : optionalRead(inventoryPath)
    ]);
    try {
      if (inventoryChanged) {
        await mkdir(dirname(inventoryPath), { recursive: true });
        const writeInventory = options.writeInventory ?? writeInventoryFile;
        await writeInventory(inventoryPath, inventoryText);
      }
      if (bootstrappedV2) {
        const writeConfig = options.writeConfig ?? atomicWrite;
        await writeConfig(configPath, Buffer.from(merged.text));
      } else if (plan.changed) {
        const writeConfig = options.writeConfig ?? atomicWrite;
        await writeConfig(configPath, Buffer.from(merged.text));
      }
      if (inventoryText !== null) await chmod(inventoryPath, 0o600);
    } catch (error) {
      await restoreFile(configPath, previousConfig);
      if (inventoryText !== null) await restoreFile(inventoryPath, previousInventory);
      throw error;
    }
  }

  return {
    dryRun,
    bootstrappedV2,
    configPath: relativeArtifactPath(root, configPath),
    inventoryPath: generatedInventory === null ? null : relativeArtifactPath(root, inventoryPath),
    observedSkillIds: inventory.skills.map(({ id }) => id).sort((left, right) => left.localeCompare(right)),
    inventoryChanged,
    changed: plan.changed,
    plan,
    scan: {
      scannedSkills: inventory.scannedSkills ?? inventory.skills.length,
      scannedInstallUnits: inventory.installUnits.length,
      addedSkills: merged.addedSkills,
      addedInstallUnits: merged.addedInstallUnits ?? [],
      updatedInstallUnits: merged.updatedInstallUnits ?? [],
      addedWorkflows: merged.addedWorkflows ?? [],
      addedHarnesses: merged.addedHarnesses ?? [],
      skippedSkills: merged.skippedSkills ?? [],
      reviewNotes: merged.reviewNotes ?? [],
      warnings: [...(inventory.warnings ?? []), ...(generatedInventory?.redactions.warnings ?? [])],
      redactedPaths: generatedInventory?.redactions.path_count ?? 0
    }
  };
}

async function withRefreshLock(root, operation) {
  const lockPath = join(root, ".skillboard-inventory-refresh.lock");
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("Another inventory refresh is already using this project.");
    }
    throw error;
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

function resolveUnderRoot(root, path, label) {
  const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (!isPathInside(root, target)) {
    throw new Error(`${label} must remain inside the project root.`);
  }
  return target;
}

async function assertGeneratedInventoryTarget(root, target) {
  if (!isPathInside(root, target)) {
    throw new Error(`Generated inventory target is outside the project root: ${target}`);
  }
  const targetStats = await lstat(target).catch(missingOnly);
  if (targetStats?.isSymbolicLink()) {
    throw new Error(`Generated inventory target is a symlink and may resolve outside the project root: ${target}`);
  }
  const existingParent = await nearestExistingDirectory(dirname(target));
  const [realRoot, realParent] = await Promise.all([realpath(root), realpath(existingParent)]);
  if (!isPathInside(realRoot, realParent)) {
    throw new Error(`Generated inventory target resolves outside the project root: ${target}`);
  }
}

async function nearestExistingDirectory(start) {
  let candidate = start;
  while (true) {
    const stats = await lstat(candidate).catch(missingOnly);
    if (stats !== undefined) {
      if (!stats.isDirectory() && !stats.isSymbolicLink()) {
        throw new Error(`Generated inventory parent is not a directory: ${candidate}`);
      }
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error(`Generated inventory parent does not exist: ${start}`);
    }
    candidate = parent;
  }
}

function missingOnly(error) {
  if (error?.code === "ENOENT") {
    return undefined;
  }
  throw error;
}

function isPathInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function writeInventoryFile(path, text) {
  await atomicWrite(path, Buffer.from(text));
}

async function restoreFile(path, bytes) {
  if (bytes === null) {
    await rm(path, { force: true });
    return;
  }
  await atomicWrite(path, bytes);
}

function relativeArtifactPath(root, path) {
  return relative(root, path).replace(/\\/g, "/") || ".";
}
