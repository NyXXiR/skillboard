import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export async function createBackup(configPath, configBytes, inventoryPath, inventoryBytes, label = "v1") {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const unique = randomUUID().slice(0, 8);
  const configBackupPath = `${configPath}.${label}-${stamp}-${unique}.bak`;
  const inventoryBackupPath = inventoryBytes === null ? null : `${configBackupPath}.inventory`;
  const manifestPath = `${configBackupPath}.manifest.json`;
  const configMode = await fileMode(configPath);
  const inventoryMode = inventoryBytes === null ? null : await fileMode(inventoryPath);
  await durableCreate(configBackupPath, configBytes);
  try {
    if (inventoryBytes !== null) await durableCreate(inventoryBackupPath, inventoryBytes);
    const manifest = {
      format_version: 1,
      source_version: 1,
      target_version: 2,
      policy_projection_version: 2,
      invalidates: ["v1-action-id", "v1-guard-hook", "v1-lock-projection"],
      target_config: basename(configPath),
      target_inventory: relativeInventoryPath(configPath, inventoryPath),
      config_backup: basename(configBackupPath),
      inventory_backup: inventoryBackupPath === null ? null : basename(inventoryBackupPath),
      inventory_existed: inventoryBytes !== null,
      config_mode: configMode,
      inventory_mode: inventoryMode,
      input_sha256: sha256(configBytes),
      inventory_input_sha256: inventoryBytes === null ? null : sha256(inventoryBytes)
    };
    await durableCreate(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    return {
      configBackupPath,
      inventoryBackupPath,
      inventoryExisted: inventoryBytes !== null,
      configMode,
      inventoryMode,
      manifestPath
    };
  } catch (error) {
    await rm(configBackupPath, { force: true });
    if (inventoryBackupPath !== null) await rm(inventoryBackupPath, { force: true });
    await rm(manifestPath, { force: true });
    throw error;
  }
}

export async function restoreSnapshot(configPath, inventoryPath, snapshot, hooks = {}) {
  await atomicWrite(configPath, await readFile(snapshot.configBackupPath), snapshot.configMode);
  await hooks.afterConfigRename?.();
  if (snapshot.inventoryExisted) {
    await atomicWrite(inventoryPath, await readFile(snapshot.inventoryBackupPath), snapshot.inventoryMode);
  } else {
    await rm(inventoryPath, { force: true });
    await syncDirectory(dirname(inventoryPath));
  }
  await hooks.afterInventoryRename?.();
}

export async function removeBackupSet(backup) {
  await rm(backup.configBackupPath, { force: true });
  if (backup.inventoryBackupPath !== null) await rm(backup.inventoryBackupPath, { force: true });
  await rm(backup.manifestPath, { force: true });
}

export async function atomicWrite(path, bytes, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await durableCreate(tempPath, bytes, mode);
    await rename(tempPath, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function optionalRead(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function removeDurably(path) {
  await rm(path, { force: true });
  await syncDirectory(dirname(path));
}

export async function withConfigLock(configPath, operation) {
  const canonicalPath = await realpath(resolve(configPath));
  const lockPath = `${canonicalPath}.migrate.lock`;
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("Another migration is already using this config. Remove a stale .migrate.lock only after confirming no migration is running.");
    }
    throw error;
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    await handle.sync();
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

export async function canonicalMigrationPaths(requestedConfigPath, requestedInventoryPath) {
  const requested = resolve(requestedConfigPath);
  const stats = await lstat(requested);
  if (stats.isSymbolicLink()) {
    throw new Error("Migration config path must not be a symbolic link; use its real path explicitly.");
  }
  if (!stats.isFile()) throw new Error("Migration config path must be a regular file.");
  const configPath = await realpath(requested);
  const root = dirname(configPath);
  const inventoryPath = resolve(requestedInventoryPath ?? join(root, ".skillboard", "inventory.json"));
  if (!isPathInside(root, inventoryPath)) {
    throw new Error("Migration inventory target must remain inside the config directory.");
  }
  const inventoryStats = await lstat(inventoryPath).catch(missingOnly);
  if (inventoryStats?.isSymbolicLink()) {
    throw new Error("Migration inventory target must not be a symbolic link.");
  }
  const inventoryDirectory = dirname(inventoryPath);
  const directoryStats = await lstat(inventoryDirectory).catch(missingOnly);
  if (directoryStats?.isSymbolicLink()) {
    throw new Error("Migration inventory directory must not be a symbolic link.");
  }
  const existingParent = await nearestExistingDirectory(inventoryDirectory);
  const realParent = await realpath(existingParent);
  if (!isPathInside(root, realParent)) {
    throw new Error("Migration inventory target resolves outside the config directory.");
  }
  return { configPath, inventoryPath };
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function durableCreate(path, bytes, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await chmod(path, mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function syncDirectory(path) {
  if (process.platform === "win32") return;
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function relativeInventoryPath(configPath, inventoryPath) {
  const prefix = `${dirname(configPath)}/`;
  return inventoryPath.startsWith(prefix) ? inventoryPath.slice(prefix.length) : basename(inventoryPath);
}

async function fileMode(path) {
  return (await stat(path)).mode & 0o777;
}

async function nearestExistingDirectory(start) {
  let candidate = start;
  while (true) {
    const stats = await lstat(candidate).catch(missingOnly);
    if (stats !== undefined) {
      if (!stats.isDirectory() && !stats.isSymbolicLink()) {
        throw new Error("Migration inventory parent must be a directory.");
      }
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error("Migration inventory parent does not exist.");
    candidate = parent;
  }
}

function missingOnly(error) {
  if (error?.code === "ENOENT") return undefined;
  throw error;
}

function isPathInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
