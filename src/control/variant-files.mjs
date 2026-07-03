import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { normalizeSkillPath } from "../skill-paths.mjs";
import { skillContentDigest } from "../source-verification.mjs";

const SNAPSHOT_ROOT = ".skillboard/variant-snapshots";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function resolveVariantLiveSkillFile({ skillsRoot, skill }) {
  if (skill === null || typeof skill !== "object") {
    throw new Error("skill must be an object with id and path");
  }
  const root = resolveRequiredPath(skillsRoot, "skills root");
  const skillPath = normalizeSkillPath(skill.path, `skills.${skill.id ?? "<unknown>"}.path`);
  const liveFile = resolve(root, skillPath, "SKILL.md");
  assertPathInside(root, liveFile, "live skill file");
  return liveFile;
}

export function variantSnapshotTarget({ configPath, skillId, snapshotName }) {
  const encodedSkillId = encodeSkillIdSegment(skillId);
  const fileName = snapshotFileName(snapshotName);
  const storedPath = `${SNAPSHOT_ROOT}/${encodedSkillId}/${fileName}`;
  return resolveVariantSnapshotFile({ configPath, snapshotPath: storedPath });
}

export function resolveVariantSnapshotFile({ configPath, snapshotPath }) {
  const configDir = dirname(resolveRequiredPath(configPath, "config path"));
  const normalized = normalizeStoredSnapshotPath(snapshotPath);
  const root = resolve(configDir, SNAPSHOT_ROOT);
  const absolutePath = resolve(configDir, normalized);
  if (!isPathInside(root, absolutePath)) {
    throw new Error(`snapshot path must stay under ${SNAPSHOT_ROOT}`);
  }
  return {
    storedPath: relative(configDir, absolutePath).replace(/\\/g, "/"),
    absolutePath,
    rootPath: root
  };
}

export function variantTempPath(absolutePath) {
  return join(dirname(resolveRequiredPath(absolutePath, "target path")), `.${basename(absolutePath)}.${randomUUID()}.tmp`);
}

export function requireVariantDigest(value, label = "content digest") {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} must use sha256:<64 hex chars>`);
  }
  return value;
}

export const digestVariantFile = skillContentDigest;

export async function writeVariantSnapshot(options) {
  const target = variantSnapshotTarget(options);
  const content = normalizeFileContent(options.content, "snapshot content");
  if (options.expectedDigest !== undefined) {
    requireVariantDigest(options.expectedDigest, "expected snapshot digest");
  }
  const plan = filePlan("write-snapshot", {
    path: target.storedPath,
    absolutePath: target.absolutePath,
    bytes: Buffer.byteLength(content),
    overwrite: options.allowOverwrite === true,
    dryRun: options.dryRun === true
  });
  if (options.dryRun === true) {
    return plan;
  }
  if (options.allowOverwrite !== true) {
    await assertMissing(target.absolutePath, "Snapshot target");
  }
  await writeFileByRename(target.absolutePath, content, { expectedDigest: options.expectedDigest });
  return plan;
}

export async function copySkillFileForFork(options) {
  const sourceFile = resolveRequiredPath(options.sourceFile, "source skill file");
  const targetFile = resolveRequiredPath(options.targetFile, "fork target skill file");
  const sourceStats = await lstat(sourceFile);
  if (!sourceStats.isFile()) {
    throw new Error(`Source skill file must be a regular file: ${sourceFile}`);
  }
  await assertMissing(targetFile, "Fork target");
  const plan = filePlan("copy-skill-for-fork", {
    from: sourceFile,
    path: targetFile,
    absolutePath: targetFile,
    bytes: sourceStats.size,
    dryRun: options.dryRun === true
  });
  if (options.dryRun === true) {
    return plan;
  }
  await writeFileByRename(targetFile, await readFile(sourceFile));
  return plan;
}

export async function createResetBackup(liveFile) {
  const absolutePath = resolveRequiredPath(liveFile, "live skill file");
  await assertResetTargetFile(absolutePath);
  const backupPath = join(dirname(absolutePath), `.${basename(absolutePath)}.${randomUUID()}.bak`);
  await copyFile(absolutePath, backupPath, fsConstants.COPYFILE_EXCL);
  return {
    liveFile: absolutePath,
    backupPath,
    restore: () => copyFile(backupPath, absolutePath),
    cleanup: () => rm(backupPath, { force: true })
  };
}

export async function replaceLiveSkillFileForReset(options) {
  const liveFile = resolveRequiredPath(options.liveFile, "live skill file");
  const content = normalizeFileContent(options.content, "reset content");
  await assertResetTargetFile(liveFile);
  const plan = filePlan("replace-live-skill-for-reset", {
    path: liveFile,
    absolutePath: liveFile,
    bytes: Buffer.byteLength(content),
    overwrite: true,
    dryRun: options.dryRun === true
  });
  if (options.dryRun === true) {
    return plan;
  }

  const backup = await createResetBackup(liveFile);
  try {
    await writeFileByRename(liveFile, content);
    return { ...plan, backupPath: backup.backupPath };
  } catch (error) {
    await backup.restore().catch(() => undefined);
    throw error;
  } finally {
    await backup.cleanup();
  }
}

export async function cleanupCreatedVariantFile(path, options = {}) {
  const absolutePath = resolveRequiredPath(path, "created variant file");
  if (options.expectedDigest !== undefined) {
    const expectedDigest = requireVariantDigest(options.expectedDigest, "expected cleanup digest");
    const actualDigest = await skillContentDigest(absolutePath).catch(() => null);
    if (actualDigest !== expectedDigest) {
      return { removed: false, reason: "digest-mismatch", actualDigest };
    }
  }
  await rm(absolutePath, { force: true });
  return { removed: true };
}

export function isPathInside(root, candidate) {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function assertPathInside(root, candidate, label = "path") {
  if (!isPathInside(root, candidate)) {
    throw new Error(`${label} must stay under ${root}`);
  }
}

function filePlan(action, values) {
  return { action, changed: true, ...values };
}

async function writeFileByRename(targetPath, content, options = {}) {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = variantTempPath(targetPath);
  try {
    await writeFile(tempPath, content, { flag: "wx" });
    if (options.expectedDigest !== undefined) {
      const actualDigest = await skillContentDigest(tempPath);
      if (actualDigest !== options.expectedDigest) {
        throw new Error(`snapshot content digest mismatch: expected ${options.expectedDigest}, got ${actualDigest}`);
      }
    }
    await rename(tempPath, targetPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function assertMissing(path, label) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`${label} already exists: ${path}`);
}

async function assertResetTargetFile(path) {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to overwrite symlink target for reset: ${path}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Reset target must be a regular file: ${path}`);
  }
}

function normalizeStoredSnapshotPath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("snapshot path must be a non-empty relative path");
  }
  if (value.includes("\0")) {
    throw new Error("snapshot path must not contain null bytes");
  }
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.startsWith("//") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error("snapshot path must be relative to the config directory");
  }
  if (!normalized.startsWith(`${SNAPSHOT_ROOT}/`)) {
    throw new Error(`snapshot path must stay under ${SNAPSHOT_ROOT}`);
  }
  return normalized;
}

function encodeSkillIdSegment(skillId) {
  if (typeof skillId !== "string" || skillId.length === 0) {
    throw new Error("skill id must be a non-empty string");
  }
  if (skillId.includes("\0")) {
    throw new Error("skill id must not contain null bytes");
  }
  const encoded = encodeURIComponent(skillId);
  if (encoded === ".") {
    return "%2E";
  }
  return encoded === ".." ? "%2E%2E" : encoded;
}

function snapshotFileName(snapshotName) {
  if (typeof snapshotName !== "string" || snapshotName.length === 0) {
    throw new Error("snapshot name must be a non-empty string");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(snapshotName)) {
    throw new Error("snapshot name may only contain letters, numbers, underscores, and dashes");
  }
  return `${snapshotName}.md`;
}

function resolveRequiredPath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty path`);
  }
  if (value.includes("\0")) {
    throw new Error(`${label} must not contain null bytes`);
  }
  return resolve(value);
}

function normalizeFileContent(value, label) {
  if (typeof value === "string" || Buffer.isBuffer(value)) {
    return value;
  }
  throw new Error(`${label} must be a string or Buffer`);
}
