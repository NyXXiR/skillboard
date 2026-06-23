import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";
import { textChangePlan } from "./change-plan.mjs";
import { sourceDigest } from "./source-verification.mjs";

const execFileAsync = promisify(execFile);

export async function refreshSourcePins(options = {}) {
  const root = resolve(options.root ?? ".");
  const configPath = resolveUnderRoot(root, options.configPath ?? "skillboard.config.yaml");
  const cacheRoot = resolveUnderRoot(root, options.cacheDir ?? ".skillboard/sources");
  const dryRun = options.dryRun === true;
  const unitFilter = new Set(options.units ?? []);
  const originalText = await readFile(configPath, "utf8");
  const document = YAML.parseDocument(originalText);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  const units = ensureMap(document, "install_units");
  const refreshed = [];
  const skipped = [];
  const now = options.now ?? new Date().toISOString();

  for (const pair of units.items) {
    const id = String(pair.key?.value ?? "");
    if (id.length === 0 || (unitFilter.size > 0 && !unitFilter.has(id))) {
      continue;
    }
    const unitMap = requireYamlMap(pair.value, `install_units.${id}`);
    const source = readMapString(unitMap, "source", "");
    const gitUrl = gitUrlFromSource(source);
    if (gitUrl === null) {
      skipped.push({ id, reason: "source is not a fetchable git reference" });
      continue;
    }
    const cachePath = join(cacheRoot, safeSegment(id));
    await mkdir(dryRun ? tmpdir() : dirname(cachePath), { recursive: true });
    const checkoutPath = dryRun
      ? await mkdtemp(join(tmpdir(), "skillboard-source-refresh-"))
      : await mkdtemp(join(dirname(cachePath), `.${basename(cachePath)}-`));
    try {
      await mkdir(dirname(checkoutPath), { recursive: true });
      await cloneGit(gitUrl, checkoutPath);
      const digest = await sourceDigest(checkoutPath);
      const configCachePath = relativePath(root, cachePath);
      unitMap.set("cache_path", configCachePath);
      unitMap.set("source_digest", digest);
      unitMap.set("verified_at", now);
      refreshed.push({
        id,
        source,
        gitUrl,
        cachePath: configCachePath,
        sourceDigest: digest,
        verifiedAt: now
      });
      if (!dryRun) {
        await rm(cachePath, { recursive: true, force: true });
        await mkdir(dirname(cachePath), { recursive: true });
        await rename(checkoutPath, cachePath);
      }
    } finally {
      if (dryRun) {
        await rm(checkoutPath, { recursive: true, force: true });
      }
    }
  }

  if (unitFilter.size > 0) {
    for (const id of unitFilter) {
      if (units.get(id, true) === undefined) {
        skipped.push({ id, reason: "install unit not found" });
      }
    }
  }

  const nextText = preserveLineEndings(String(document), originalText);
  const plan = textChangePlan(originalText, nextText);
  if (plan.changed && !dryRun) {
    await writeFile(configPath, nextText, "utf8");
  }
  return {
    dryRun,
    configPath,
    cacheRoot,
    changed: plan.changed,
    plan,
    refreshed,
    skipped
  };
}

export function gitUrlFromSource(source) {
  const value = source.trim();
  if (value.length === 0) {
    return null;
  }
  const cloneMatch = /\bgit\s+clone\s+(?:--[^\s]+\s+)*(?<url>\S+)/u.exec(value);
  if (cloneMatch?.groups?.url !== undefined) {
    return normalizeGitUrl(cloneMatch.groups.url);
  }
  const directMatch = /(?<url>(?:https:\/\/|ssh:\/\/|git@|file:\/\/)\S+)/u.exec(value);
  if (directMatch?.groups?.url !== undefined) {
    return normalizeGitUrl(directMatch.groups.url);
  }
  const githubHostMatch = /(?:^|\s)(?<repo>github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?)(?:\s|$)/u.exec(value);
  if (githubHostMatch?.groups?.repo !== undefined) {
    return normalizeGitUrl(`https://${githubHostMatch.groups.repo}`);
  }
  const shorthandMatch = /(?:^|\s)(?<repo>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\s|$)/u.exec(value);
  if (shorthandMatch?.groups?.repo !== undefined && !shorthandMatch.groups.repo.startsWith("./") && !shorthandMatch.groups.repo.startsWith("../")) {
    return normalizeGitUrl(`https://github.com/${shorthandMatch.groups.repo}`);
  }
  return null;
}

function normalizeGitUrl(value) {
  const trimmed = value.replace(/^['"]|['"]$/gu, "");
  if (trimmed.startsWith("git@") || trimmed.startsWith("ssh://") || trimmed.startsWith("file://")) {
    return trimmed;
  }
  if (trimmed.startsWith("https://")) {
    return trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`;
  }
  return trimmed;
}

async function cloneGit(gitUrl, checkoutPath) {
  await execFileAsync("git", ["clone", "--depth", "1", "--", gitUrl, checkoutPath], {
    maxBuffer: 1024 * 1024 * 10
  });
}

function ensureMap(document, key) {
  const existing = document.get(key, true);
  if (existing === undefined) {
    const next = document.createNode({});
    next.flow = false;
    document.set(key, next);
    return next;
  }
  return requireYamlMap(existing, key);
}

function requireYamlMap(value, label) {
  if (!YAML.isMap(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  value.flow = false;
  return value;
}

function readMapString(map, key, fallback) {
  const raw = map.get(key);
  return typeof raw === "string" ? raw : fallback;
}

function resolveUnderRoot(root, path) {
  return isAbsolute(path) ? path : resolve(root, path);
}

function relativePath(root, path) {
  const rel = relative(root, path).replaceAll("\\", "/");
  return rel.startsWith("..") ? path : rel;
}

function safeSegment(value) {
  const segment = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return segment.length === 0 ? "source" : segment;
}

function preserveLineEndings(text, reference) {
  return reference.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}
