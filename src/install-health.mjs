import { constants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";

const PACKAGE_NAME = "agent-skillboard";
const POSIX_COMMANDS = ["skillboard", "agent-skillboard"];
const WINDOWS_COMMANDS = [
  "skillboard.cmd",
  "skillboard.exe",
  "skillboard",
  "agent-skillboard.cmd",
  "agent-skillboard.exe",
  "agent-skillboard"
];

export async function inspectInstallation(options = {}) {
  const platform = options.platform ?? process.platform;
  const pathDelimiter = options.pathDelimiter ?? delimiter;
  const entrypoint = resolve(options.entrypointPath ?? process.argv[1] ?? "bin/skillboard.mjs");
  const currentRealPath = await resolvedPath(entrypoint);
  const currentPackage = await packageForEntrypoint(currentRealPath);
  const pathCandidates = await findPathCandidates(options.env?.PATH ?? "", {
    pathDelimiter,
    platform,
    currentRealPath,
    currentPackageRoot: currentPackage?.root ?? null
  });
  const pathSelected = pathCandidates.find((candidate) => isPrimaryCommand(candidate.path, platform)) ?? null;
  const installations = uniqueInstallations(pathCandidates);
  const duplicateInstallations = installations.length > 1;
  const shadowed = pathSelected !== null && !pathSelected.current;
  const current = {
    version: options.packageVersion ?? currentPackage?.version ?? null,
    entrypoint,
    realPath: currentRealPath,
    packageRoot: currentPackage?.root ?? null
  };
  const warnings = installWarnings({ current, pathSelected, installations, duplicateInstallations, shadowed });
  return {
    current,
    pathSelected,
    pathCandidates,
    installations,
    duplicateInstallations,
    shadowed,
    warnings
  };
}

async function findPathCandidates(pathValue, options) {
  const commands = options.platform === "win32" ? WINDOWS_COMMANDS : POSIX_COMMANDS;
  const directories = pathValue.split(options.pathDelimiter).filter((entry) => entry.trim() !== "");
  const candidates = [];
  const observedPaths = new Set();
  for (const directory of directories) {
    for (const command of commands) {
      const path = resolve(directory, command);
      if (observedPaths.has(path) || !await isExecutable(path, options.platform)) continue;
      observedPaths.add(path);
      candidates.push(await inspectCandidate(path, options));
    }
  }
  return candidates;
}

async function inspectCandidate(path, options) {
  const realPath = await resolvedPath(path);
  const packageMetadata = await packageForCandidate(path, realPath);
  const packageRoot = packageMetadata?.root ?? null;
  return {
    path,
    realPath,
    packageRoot,
    version: packageMetadata?.version ?? null,
    current: realPath === options.currentRealPath
      || (packageRoot !== null && packageRoot === options.currentPackageRoot)
  };
}

async function packageForCandidate(path, realPath) {
  const fromTarget = await packageForEntrypoint(realPath);
  if (fromTarget !== null) return fromTarget;
  const commandDirectory = dirname(path);
  for (const root of [
    join(commandDirectory, "node_modules", PACKAGE_NAME),
    resolve(commandDirectory, "..", PACKAGE_NAME)
  ]) {
    const metadata = await readPackage(root);
    if (metadata !== null) return metadata;
  }
  return null;
}

async function packageForEntrypoint(path) {
  let directory = dirname(path);
  for (let depth = 0; depth < 6; depth += 1) {
    const metadata = await readPackage(directory);
    if (metadata !== null) return metadata;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

async function readPackage(root) {
  try {
    const parsed = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (parsed?.name !== PACKAGE_NAME || typeof parsed.version !== "string") return null;
    return { root: await realpath(root), version: parsed.version };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function isExecutable(path, platform) {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() && !stats.isSymbolicLink()) return false;
    await access(path, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch (error) {
    if (["EACCES", "ELOOP", "ENOENT", "ENOTDIR"].includes(error?.code)) return false;
    throw error;
  }
}

async function resolvedPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error?.code === "ENOENT") return resolve(path);
    throw error;
  }
}

function uniqueInstallations(candidates) {
  const installations = [];
  const observed = new Set();
  for (const candidate of candidates) {
    if (candidate.packageRoot === null || observed.has(candidate.packageRoot)) continue;
    observed.add(candidate.packageRoot);
    installations.push(candidate);
  }
  return installations;
}

function isPrimaryCommand(path, platform) {
  const command = basename(path).toLowerCase();
  return platform === "win32"
    ? ["skillboard", "skillboard.cmd", "skillboard.exe"].includes(command)
    : command === "skillboard";
}

function installWarnings(result) {
  const warnings = [];
  if (result.shadowed) {
    warnings.push(
      `PATH selects SkillBoard ${displayVersion(result.pathSelected.version)} at ${result.pathSelected.path} instead of this ${displayVersion(result.current.version)} invocation at ${result.current.entrypoint}.`
    );
  }
  if (result.duplicateInstallations) {
    warnings.push(
      `Multiple SkillBoard installations were found on PATH: ${result.installations.map(displayInstallation).join(", ")}. Keep one npm prefix active and uninstall stale copies with the npm installation that owns them.`
    );
  }
  return warnings;
}

function displayVersion(version) {
  return version === null ? "with unknown version" : `version ${version}`;
}

function displayInstallation(candidate) {
  return `${candidate.version ?? "unknown"} at ${candidate.path}`;
}
