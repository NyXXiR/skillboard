import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { loadWorkspace } from "../workspace.mjs";
import { mapV1ConfigToV2 } from "./v1-to-v2.mjs";
import {
  atomicWrite,
  canonicalMigrationPaths,
  createBackup,
  optionalRead,
  relativeInventoryPath,
  restoreSnapshot,
  sha256,
  withConfigLock
} from "./v2-files.mjs";
import {
  beginMigrationTransaction,
  commitMigrationTransaction,
  completeMigrationRecovery,
  finishMigrationTransaction,
  recoverInterruptedMigration
} from "./v2-journal.mjs";
import {
  migrationInventory,
  migrationReport,
  parseMigrationConfig,
  renderMigratedPolicy,
  unchangedMigrationResult
} from "./v2-projection.mjs";

const TARGET_VERSION = 2;

export async function migrateV2(options) {
  const { configPath, inventoryPath } = await canonicalMigrationPaths(options.configPath, options.inventoryPath);
  await recoverInterruptedMigration(configPath, inventoryPath, options.failpoint);
  return await withConfigLock(configPath, async () => {
    if (options.rollbackPath !== undefined) {
      const rollbackPath = isAbsolute(options.rollbackPath)
        ? resolve(options.rollbackPath)
        : resolve(dirname(configPath), options.rollbackPath);
      return await rollbackMigration(configPath, inventoryPath, rollbackPath, options);
    }
    return await migrateForward(configPath, inventoryPath, options);
  });
}

async function migrateForward(configPath, inventoryPath, options) {
  const inputBytes = await readFile(configPath);
  const inputText = inputBytes.toString("utf8");
  const { document, parsed } = parseMigrationConfig(inputText);
  const version = parsed.version ?? 1;
  if (version === TARGET_VERSION) {
    await validateCurrentV2(configPath, inventoryPath, options.skillsRoot);
    return unchangedMigrationResult(inputBytes);
  }
  if (version !== 1) {
    throw new Error(`Unsupported config version: ${String(version)}. No files were changed.`);
  }

  const mapped = mapV1ConfigToV2(parsed);
  const configBytes = Buffer.from(renderMigratedPolicy(mapped.policy, inputText, document));
  const inventory = migrationInventory(mapped.inventory, inputBytes, mapped.losses);
  const inventoryBytes = Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`);
  const report = migrationReport(parsed, mapped, inputBytes, configBytes, inventoryBytes);
  if (options.apply !== true) {
    return { mode: "preview", changed: true, backup: null, ...report };
  }

  const previousInventory = await optionalRead(inventoryPath);
  const backup = await createBackup(configPath, inputBytes, inventoryPath, previousInventory);
  const journalPath = await beginMigrationTransaction(configPath, inventoryPath, backup);
  try {
    await atomicWrite(configPath, configBytes, backup.configMode);
    failAt(options, "after-config-rename");
    failAt(options, "after-config-write");
    await atomicWrite(inventoryPath, inventoryBytes, backup.inventoryMode ?? 0o600);
    failAt(options, "after-inventory-rename");
    failAt(options, "before-validation");
    await validateCurrentV2(configPath, inventoryPath, options.skillsRoot);
    await commitMigrationTransaction(journalPath);
    failAt(options, "after-commit-journal");
    await finishMigrationTransaction(journalPath);
    return {
      mode: "apply",
      changed: true,
      backup: basename(backup.configBackupPath),
      manifest: basename(backup.manifestPath),
      ...report
    };
  } catch (error) {
    await restoreSnapshot(configPath, inventoryPath, backup);
    await completeMigrationRecovery(journalPath, backup);
    throw error;
  }
}

async function rollbackMigration(configPath, inventoryPath, configBackupPath, options) {
  assertAdjacentBackup(configPath, configBackupPath);
  const manifestPath = `${configBackupPath}.manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateManifest(manifest, configPath, inventoryPath, configBackupPath);
  const currentConfig = await readFile(configPath);
  const currentInventory = await optionalRead(inventoryPath);
  const snapshot = {
    configBackupPath,
    manifestPath,
    inventoryBackupPath: manifest.inventory_backup === null
      ? null
      : join(dirname(configBackupPath), manifest.inventory_backup),
    inventoryExisted: manifest.inventory_existed,
    configMode: manifest.config_mode,
    inventoryMode: manifest.inventory_mode
  };
  const backupBytes = await readFile(configBackupPath);
  if (sha256(backupBytes) !== manifest.input_sha256) {
    throw new Error("Migration backup hash mismatch; rollback was not attempted.");
  }
  if (snapshot.inventoryExisted) {
    const inventoryBytes = await readFile(snapshot.inventoryBackupPath);
    if (sha256(inventoryBytes) !== manifest.inventory_input_sha256) {
      throw new Error("Migration inventory backup hash mismatch; rollback was not attempted.");
    }
  }

  const safety = await createBackup(configPath, currentConfig, inventoryPath, currentInventory, "rollback-safety");
  const journalPath = await beginMigrationTransaction(configPath, inventoryPath, safety);
  try {
    await restoreSnapshot(configPath, inventoryPath, snapshot, {
      afterConfigRename: () => failAt(options, "after-config-rename"),
      afterInventoryRename: () => failAt(options, "after-inventory-rename")
    });
    await commitMigrationTransaction(journalPath);
    failAt(options, "after-commit-journal");
    await finishMigrationTransaction(journalPath);
    return {
      mode: "rollback",
      changed: true,
      target_version: manifest.source_version,
      input_sha256: sha256(currentConfig),
      config_sha256: sha256(await readFile(configPath)),
      inventory_sha256: (await optionalRead(inventoryPath)) === null
        ? null
        : sha256(await readFile(inventoryPath)),
      backup: basename(configBackupPath),
      safety_backup: basename(safety.configBackupPath)
    };
  } catch (error) {
    await restoreSnapshot(configPath, inventoryPath, safety);
    await completeMigrationRecovery(journalPath, safety);
    throw error;
  }
}

async function validateCurrentV2(configPath, inventoryPath, skillsRoot) {
  const workspace = await loadWorkspace({ configPath, inventoryPath, skillsRoot });
  if (workspace.version !== TARGET_VERSION) {
    throw new Error("Post-write validation did not load version 2 policy.");
  }
  if (workspace.inventory?.integrityErrors?.length > 0) {
    throw new Error("Post-write inventory validation failed.");
  }
  const policyIds = workspace.skills.map(({ id }) => id).sort((left, right) => left.localeCompare(right));
  const inventoryIds = [...(workspace.inventory?.skillIds ?? [])].sort((left, right) => left.localeCompare(right));
  if (policyIds.length !== inventoryIds.length
    || policyIds.some((id, index) => id !== inventoryIds[index])) {
    throw new Error("Post-write policy and inventory skill-set agreement failed.");
  }
}

function validateManifest(manifest, configPath, inventoryPath, backupPath) {
  if (manifest?.format_version !== 1 || manifest.config_backup !== basename(backupPath)) {
    throw new Error("Invalid migration backup manifest; rollback was not attempted.");
  }
  if (manifest.target_config !== basename(configPath)) {
    throw new Error("Migration backup belongs to a different config; rollback was not attempted.");
  }
  const requestedInventory = relativeInventoryPath(configPath, inventoryPath);
  if (manifest.target_inventory !== requestedInventory) {
    throw new Error("Requested inventory target does not match the migration manifest; rollback was not attempted.");
  }
  if (!Number.isInteger(manifest.config_mode) || manifest.config_mode < 0 || manifest.config_mode > 0o777
    || (manifest.inventory_existed === true
      && (!Number.isInteger(manifest.inventory_mode) || manifest.inventory_mode < 0 || manifest.inventory_mode > 0o777))) {
    throw new Error("Invalid migration backup mode metadata; rollback was not attempted.");
  }
  if (manifest.inventory_existed === true) {
    const expected = `${basename(backupPath)}.inventory`;
    if (manifest.inventory_backup !== expected || basename(manifest.inventory_backup) !== manifest.inventory_backup) {
      throw new Error("Invalid migration inventory backup reference; rollback was not attempted.");
    }
  } else if (manifest.inventory_existed !== false || manifest.inventory_backup !== null) {
    throw new Error("Invalid migration inventory backup state; rollback was not attempted.");
  }
}

function assertAdjacentBackup(configPath, backupPath) {
  if (dirname(configPath) !== dirname(backupPath) || !basename(backupPath).startsWith(`${basename(configPath)}.`)) {
    throw new Error("Migration rollback backup must be adjacent to the selected config.");
  }
}

function failAt(options, point) {
  if (options.failpoint === `terminate-${point}`) process.exit(86);
  if (options.failpoint === point) throw new Error(`Injected migration failure at ${point}.`);
}
