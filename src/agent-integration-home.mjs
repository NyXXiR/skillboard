import { execFile } from "node:child_process";
import { access, chown, lstat, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GETENT_PATHS = ["/usr/bin/getent", "/bin/getent"];

export async function resolveSetupHome(env, runtime) {
  const explicit = nonEmpty(env.SKILLBOARD_SETUP_HOME);
  if (explicit !== null) {
    return explicit;
  }
  if (shouldUseSudoUserHome(env)) {
      const sudoHome = nonEmpty(env.SUDO_HOME)
      ?? await passwdHome(env.SUDO_USER, runtime.passwdPath ?? "/etc/passwd")
      ?? await getentHome(env.SUDO_USER, runtime)
      ?? await conventionalUserHome(env.SUDO_USER);
    if (sudoHome !== null) {
      return sudoHome;
    }
  }
  return env.HOME ?? env.USERPROFILE;
}

export function setupOwnership(env, runtime, home) {
  if (process.platform === "win32" || !shouldUseSudoUserHome(env)) {
    return null;
  }
  const uid = parseNonNegativeInteger(env.SUDO_UID);
  const gid = parseNonNegativeInteger(env.SUDO_GID);
  if (uid === null || gid === null) {
    return null;
  }
  const chownFunction = runtime.chown ?? chown;
  if (runtime.chown === undefined && !canApplyProcessOwnership(uid, gid)) {
    return null;
  }
  return {
    uid,
    gid,
    home: resolve(home),
    chown: chownFunction
  };
}

export async function applyOwnership(path, ownership) {
  if (ownership === null) {
    return;
  }
  for (const ownedPath of await ownershipPaths(path, ownership.home)) {
    await ownership.chown(ownedPath, ownership.uid, ownership.gid);
  }
}

export async function applyOwnershipTree(path, ownership) {
  if (ownership === null) return;
  const stats = await pathStats(path);
  if (stats === null || stats.isSymbolicLink()) return;
  await applyOwnership(path, ownership);
  if (!stats.isDirectory()) return;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    await applyOwnershipTree(resolve(path, entry.name), ownership);
  }
}

function canApplyProcessOwnership(uid, gid) {
  if (typeof process.getuid !== "function") {
    return false;
  }
  if (process.getuid() === 0) {
    return true;
  }
  if (typeof process.getgid !== "function") {
    return process.getuid() === uid;
  }
  return process.getuid() === uid && process.getgid() === gid;
}

function parseNonNegativeInteger(value) {
  if (value === undefined || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function shouldUseSudoUserHome(env) {
  const sudoUser = nonEmpty(env.SUDO_USER);
  return process.platform !== "win32"
    && sudoUser !== null
    && sudoUser !== "root"
    && (
      env.SUDO_UID !== undefined
      || env.SUDO_GID !== undefined
      || env.USER === "root"
      || env.LOGNAME === "root"
      || env.HOME === "/root"
    );
}

async function passwdHome(user, passwdPath) {
  const text = await readFile(passwdPath, "utf8").catch(() => "");
  for (const line of text.split("\n")) {
    if (line.startsWith(`${user}:`)) {
      return nonEmpty(line.split(":")[5]);
    }
  }
  return null;
}

async function getentHome(user, runtime) {
  const candidates = runtime.getentPath === undefined ? GETENT_PATHS : [runtime.getentPath];
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate, ["passwd", user], {
        env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin" },
        timeout: 1000
      });
      const home = nonEmpty(stdout.trim().split(":")[5]);
      if (home !== null) {
        return home;
      }
    } catch {
      // Try the next trusted absolute path; fall back to conventional home paths below.
    }
  }
  return null;
}

async function conventionalUserHome(user) {
  const candidates = process.platform === "darwin"
    ? [`/Users/${user}`]
    : [`/home/${user}`];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

function nonEmpty(value) {
  return value === undefined || value.trim() === "" ? null : value;
}

async function ownershipPaths(path, home) {
  const resolvedHome = resolve(home);
  const resolvedPath = resolve(path);
  if (!isInside(resolvedPath, resolvedHome)) {
    return [];
  }
  const homeStats = await pathStats(resolvedHome);
  if (homeStats === null || homeStats.isSymbolicLink()) {
    return [];
  }
  const directories = [];
  let current = dirname(resolvedPath);
  while (current !== resolvedHome && isInside(current, resolvedHome)) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  const safePaths = [];
  for (const candidate of [...directories.reverse(), resolvedPath]) {
    const stats = await pathStats(candidate);
    if (stats === null || stats.isSymbolicLink()) {
      break;
    }
    safePaths.push(candidate);
  }
  return safePaths;
}

async function pathStats(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function isInside(path, parent) {
  const relativePath = relative(parent, path);
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}
