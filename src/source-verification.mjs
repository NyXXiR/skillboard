import { lstat, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { createHash, verify as verifySignature } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import YAML from "yaml";
import { installUnitSourceClass, isLocalSourceReference } from "./domain/source-classes.mjs";

const DIGEST_PREFIX = "sha256:";

export async function verifySources(workspace, options = {}) {
  const configDir = options.configPath === undefined ? process.cwd() : dirname(resolve(options.configPath));
  const rootDir = options.rootDir === undefined ? process.cwd() : resolve(options.rootDir);
  const units = [];
  for (const unit of workspace.installUnits) {
    units.push(await verifyInstallUnit(unit, { configDir, rootDir, restrictToRoot: options.restrictToRoot === true }));
  }
  const errors = units.flatMap((unit) => unit.findings
    .filter((finding) => finding.severity === "error")
    .map((finding) => `${unit.id}: ${finding.message}`));
  const warnings = units.flatMap((unit) => unit.findings
    .filter((finding) => finding.severity === "warning")
    .map((finding) => `${unit.id}: ${finding.message}`));
  return { ok: errors.length === 0, units, errors, warnings };
}

export async function writeLockfile(workspace, options) {
  const verified = await verifySources(workspace, { configPath: options.configPath, rootDir: options.rootDir });
  if (!verified.ok && options.allowUnverified !== true) {
    throw new Error(`Cannot write lockfile because source verification failed:\n${verified.errors.join("\n")}`);
  }
  const text = await renderLockfile(workspace, { ...options, verified });
  await writeFile(options.out, text, { encoding: "utf8", flag: options.replace === true ? "w" : "wx" });
  return { path: options.out, bytes: Buffer.byteLength(text) };
}

export async function renderLockfile(workspace, options = {}) {
  const verified = options.verified ?? await verifySources(workspace, { configPath: options.configPath, rootDir: options.rootDir });
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const skillDigests = await skillContentDigests(workspace, options.skillsRoot);
  return YAML.stringify({
    version: 1,
    generated_at: generatedAt,
    config_schema_version: workspace.version,
    install_units: Object.fromEntries(verified.units.map((unit) => [unit.id, {
      kind: unit.kind,
      source: unit.source,
      cache_path: unit.cachePath,
      verified_path: unit.verifiedPath,
      verified_field: unit.verifiedField,
      source_class: unit.sourceClass,
      trust_level: unit.trustLevel,
      permission_risk: unit.permissionRisk,
      source_digest: unit.actualDigest ?? unit.expectedDigest ?? null,
      digest_verified: unit.digestVerified,
      signature_verified: unit.signatureVerified,
      status: unit.status
    }])),
    skills: Object.fromEntries(workspace.skills.map((skill) => [skill.id, {
      path: skill.path,
      status: skill.status,
      invocation: skill.invocation,
      exposure: skill.exposure,
      owner_install_unit: skill.ownerInstallUnit ?? null,
      content_digest: skillDigests.get(skill.id) ?? null
    }])),
    workflows: Object.fromEntries(workspace.workflows.map((workflow) => [workflow.name, {
      harness: workflow.harness,
      active_skills: workflow.activeSkills,
      blocked_skills: workflow.blockedSkills,
      required_capabilities: Object.fromEntries(workflow.requiredCapabilities.map((capability) => [capability.name, {
        preferred: capability.preferred,
        fallback: capability.fallback,
        policy: capability.policy
      }]))
    }]))
  });
}

async function verifyInstallUnit(unit, options) {
  const target = await verificationTarget(unit, options);
  const localPath = target.path;
  const findings = [];
  let actualDigest = null;
  let digestVerified = false;
  let signatureVerified = false;
  let status = "metadata-only";

  if (localPath !== null && options.restrictToRoot === true && !isPathInside(options.rootDir, localPath)) {
    status = "unverified";
    findings.push({ severity: "error", message: `${target.field} is outside the allowed root: ${localPath}` });
  } else if (localPath === null) {
    if (unit.sourceDigest === undefined) {
      findings.push({ severity: "warning", message: "remote or command source has no source_digest pin" });
    }
    if (unit.signature !== undefined && unit.publicKey === undefined) {
      findings.push({ severity: "error", message: "signature is configured without public_key" });
    }
  } else {
    try {
      actualDigest = await sourceDigest(localPath);
      status = "verified-local";
      if (unit.sourceDigest === undefined) {
        findings.push({ severity: "warning", message: `${target.field} is not pinned; computed ${actualDigest}` });
      } else if (unit.sourceDigest !== actualDigest) {
        findings.push({ severity: "error", message: `source_digest mismatch: expected ${unit.sourceDigest}, got ${actualDigest}` });
      } else {
        digestVerified = true;
      }
      if (unit.signature !== undefined) {
        if (unit.publicKey === undefined) {
          findings.push({ severity: "error", message: "signature is configured without public_key" });
        } else if (verifyDigestSignature(actualDigest, unit.signature, unit.publicKey)) {
          signatureVerified = true;
        } else {
          findings.push({ severity: "error", message: "signature does not verify source_digest" });
        }
      }
    } catch (error) {
      status = "unverified";
      findings.push({ severity: "error", message: `cannot verify local source: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  return {
    id: unit.id,
    kind: unit.kind,
    source: unit.source,
    cachePath: unit.cachePath.length === 0 ? null : unit.cachePath,
    verifiedPath: localPath,
    verifiedField: target.field,
    sourceClass: installUnitSourceClass(unit),
    trustLevel: unit.trustLevel,
    permissionRisk: unit.permissionRisk,
    expectedDigest: unit.sourceDigest ?? null,
    actualDigest,
    digestVerified,
    signatureVerified,
    status,
    findings
  };
}

function isPathInside(root, path) {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function verificationTarget(unit, options) {
  const cachePath = unit.cachePath.trim();
  if (cachePath.length > 0) {
    const path = await localSourcePath(cachePath, options, { allowBareRelative: true });
    if (path !== null) {
      return { path, field: "cache_path" };
    }
  }
  return { path: await localSourcePath(unit.source, options, { allowBareRelative: false }), field: "source" };
}

export async function sourceDigest(path) {
  const hash = createHash("sha256");
  hash.update("skillboard-source-digest-v1\n");
  await addPathDigest(hash, path, path);
  return `${DIGEST_PREFIX}${hash.digest("hex")}`;
}

async function addPathDigest(hash, root, path) {
  const stats = await lstat(path);
  const rel = relative(root, path).replaceAll("\\", "/") || ".";
  if (stats.isSymbolicLink()) {
    hash.update(`symlink\0${rel}\0${await readlink(path)}\n`);
    return;
  }
  if (stats.isDirectory()) {
    hash.update(`dir\0${rel}\n`);
    const entries = (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await addPathDigest(hash, root, join(path, entry.name));
    }
    return;
  }
  if (!stats.isFile()) {
    hash.update(`other\0${rel}\n`);
    return;
  }
  hash.update(`file\0${rel}\0${stats.size}\0`);
  hash.update(await readFile(path));
  hash.update("\n");
}

function verifyDigestSignature(digest, signature, publicKey) {
  try {
    return verifySignature("sha256", Buffer.from(digest), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

async function localSourcePath(source, paths, options) {
  const value = source.trim();
  if (!isLocalSourceReference(value, options)) {
    return null;
  }
  if (value.startsWith("~/")) {
    return resolve(homedir(), value.slice(2));
  }
  if (isAbsolute(value)) {
    return value;
  }
  const candidates = uniquePaths([
    resolve(paths.configDir, value),
    resolve(paths.rootDir, value)
  ]);
  return await firstExistingPath(candidates) ?? candidates[0] ?? null;
}

async function firstExistingPath(paths) {
  for (const path of paths) {
    try {
      await lstat(path);
      return path;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        return path;
      }
    }
  }
  return null;
}

function uniquePaths(paths) {
  return [...new Set(paths)];
}

export async function skillContentDigest(skillFilePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(skillFilePath));
  return `${DIGEST_PREFIX}${hash.digest("hex")}`;
}

async function skillContentDigests(workspace, skillsRoot) {
  const digests = new Map();
  if (skillsRoot === undefined) {
    return digests;
  }
  for (const skill of workspace.skills) {
    const skillPath = join(skillsRoot, skill.path, "SKILL.md");
    try {
      digests.set(skill.id, await skillContentDigest(skillPath));
    } catch {
      digests.set(skill.id, null);
    }
  }
  return digests;
}
