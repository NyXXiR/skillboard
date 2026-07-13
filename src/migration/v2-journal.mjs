import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  atomicWrite,
  optionalRead,
  relativeInventoryPath,
  removeBackupSet,
  removeDurably,
  restoreSnapshot,
  sha256
} from "./v2-files.mjs";

const JOURNAL_FORMAT_VERSION = 1;

export async function beginMigrationTransaction(configPath, inventoryPath, backup) {
  const journalPath = journalPathFor(configPath);
  const journal = {
    format_version: JOURNAL_FORMAT_VERSION,
    pid: process.pid,
    phase: "prepared",
    target_config: basename(configPath),
    target_inventory: relativeInventoryPath(configPath, inventoryPath),
    config_backup: basename(backup.configBackupPath),
    inventory_backup: backup.inventoryBackupPath === null ? null : basename(backup.inventoryBackupPath),
    inventory_existed: backup.inventoryExisted,
    config_mode: backup.configMode,
    inventory_mode: backup.inventoryMode,
    input_sha256: sha256(await readFile(backup.configBackupPath)),
    inventory_input_sha256: backup.inventoryBackupPath === null
      ? null
      : sha256(await readFile(backup.inventoryBackupPath))
  };
  await atomicWrite(journalPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`), 0o600);
  return journalPath;
}

export async function commitMigrationTransaction(journalPath) {
  const journal = parseJournal(await readFile(journalPath, "utf8"));
  await atomicWrite(
    journalPath,
    Buffer.from(`${JSON.stringify({ ...journal, phase: "committed" }, null, 2)}\n`),
    0o600
  );
}

export async function finishMigrationTransaction(journalPath) {
  await removeDurably(journalPath);
}

export async function completeMigrationRecovery(journalPath, backup) {
  const journal = parseJournal(await readFile(journalPath, "utf8"));
  await writePhase(journalPath, journal, "recovered");
  await removeBackupSet(backup);
  await removeDurably(journalPath);
}

export async function recoverInterruptedMigration(configPath, inventoryPath, failpoint) {
  const journalPath = journalPathFor(configPath);
  const bytes = await optionalRead(journalPath);
  if (bytes === null) return false;
  const journal = parseJournal(bytes.toString("utf8"));
  validateTargets(journal, configPath, inventoryPath);
  if (processIsAlive(journal.pid)) {
    throw new Error("Another migration is already using this config.");
  }
  const backup = backupFromJournal(journal, configPath);
  if (journal.phase === "prepared") {
    await validateBackupHashes(backup, journal);
    await restoreSnapshot(configPath, inventoryPath, backup, {
      afterConfigRename: () => terminateRecoveryAt(failpoint, "after-config-rename"),
      afterInventoryRename: () => terminateRecoveryAt(failpoint, "after-inventory-rename")
    });
    await completeMigrationRecovery(journalPath, backup);
  } else if (journal.phase === "recovered") {
    await removeBackupSet(backup);
    await removeDurably(journalPath);
  } else {
    await removeDurably(journalPath);
  }
  await removeDurably(`${configPath}.migrate.lock`);
  return true;
}

export function journalPathFor(configPath) {
  return `${configPath}.migrate.transaction.json`;
}

function parseJournal(text) {
  const value = JSON.parse(text);
  if (value?.format_version !== JOURNAL_FORMAT_VERSION
    || !Number.isInteger(value.pid)
    || value.pid <= 0
    || !["prepared", "committed", "recovered"].includes(value.phase)) {
    throw new Error("Invalid migration transaction journal; recovery was not attempted.");
  }
  return value;
}

async function writePhase(journalPath, journal, phase) {
  await atomicWrite(
    journalPath,
    Buffer.from(`${JSON.stringify({ ...journal, phase }, null, 2)}\n`),
    0o600
  );
}

function terminateRecoveryAt(failpoint, point) {
  if (failpoint === `terminate-recovery-${point}`) process.exit(87);
}

function validateTargets(journal, configPath, inventoryPath) {
  if (journal.target_config !== basename(configPath)
    || journal.target_inventory !== relativeInventoryPath(configPath, inventoryPath)) {
    throw new Error("Migration transaction target mismatch; recovery was not attempted.");
  }
  if (typeof journal.config_backup !== "string"
    || basename(journal.config_backup) !== journal.config_backup
    || !journal.config_backup.startsWith(`${basename(configPath)}.`)) {
    throw new Error("Invalid migration transaction backup reference; recovery was not attempted.");
  }
  const validInventoryBackup = journal.inventory_existed === false && journal.inventory_backup === null
    || journal.inventory_existed === true
      && typeof journal.inventory_backup === "string"
      && basename(journal.inventory_backup) === journal.inventory_backup;
  const validModes = Number.isInteger(journal.config_mode)
    && journal.config_mode >= 0
    && journal.config_mode <= 0o777
    && (journal.inventory_existed === false
      ? journal.inventory_mode === null
      : Number.isInteger(journal.inventory_mode)
        && journal.inventory_mode >= 0
        && journal.inventory_mode <= 0o777);
  if (!validInventoryBackup || !validModes) {
    throw new Error("Invalid migration transaction backup metadata; recovery was not attempted.");
  }
}

function backupFromJournal(journal, configPath) {
  const directory = dirname(configPath);
  return {
    configBackupPath: join(directory, journal.config_backup),
    inventoryBackupPath: journal.inventory_backup === null ? null : join(directory, journal.inventory_backup),
    inventoryExisted: journal.inventory_existed,
    configMode: journal.config_mode,
    inventoryMode: journal.inventory_mode,
    manifestPath: `${join(directory, journal.config_backup)}.manifest.json`
  };
}

async function validateBackupHashes(backup, journal) {
  if (sha256(await readFile(backup.configBackupPath)) !== journal.input_sha256) {
    throw new Error("Migration transaction backup hash mismatch; recovery was not attempted.");
  }
  if (backup.inventoryExisted
    && sha256(await readFile(backup.inventoryBackupPath)) !== journal.inventory_input_sha256) {
    throw new Error("Migration transaction inventory hash mismatch; recovery was not attempted.");
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}
