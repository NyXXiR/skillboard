import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { atomicWrite } from "./migration/v2-files.mjs";

const FORMAT_VERSION = 1;
const SUPPORTED_AGENTS = new Set(["codex", "claude", "opencode", "hermes"]);

export function agentRootRegistryPath(home) {
  return join(resolve(home), ".skillboard", "agent-roots.json");
}

export async function loadRegisteredAgentRoots(home) {
  const root = resolve(home);
  const path = agentRootRegistryPath(root);
  const stats = await lstat(path).catch(missingOnly);
  if (stats === undefined) return [];
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("Agent root registry must be a regular file, not a symbolic link.");
  }
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value?.format_version !== FORMAT_VERSION || !Array.isArray(value.roots)) {
    throw new Error("Invalid agent root registry format.");
  }
  const entries = normalizeEntries(value.roots, root);
  for (const entry of entries) await assertSafeRootPath(root, entry.path);
  return entries;
}

export async function proposedAgentRoot(home, agent, path, cwd = process.cwd()) {
  assertAgent(agent);
  const root = resolve(home);
  const target = resolve(cwd, path);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Registered skill root must remain inside the invoking user's home.");
  }
  await assertSafeRootPath(root, target);
  return { agent, path: target };
}

export async function writeRegisteredAgentRoots(home, entries) {
  const root = resolve(home);
  const normalized = normalizeEntries(entries.map((entry) => ({
    agent: entry.agent,
    path: portablePath(root, entry.path)
  })), root);
  const value = {
    format_version: FORMAT_VERSION,
    roots: normalized.map((entry) => ({ agent: entry.agent, path: portablePath(root, entry.path) }))
  };
  await atomicWrite(agentRootRegistryPath(root), Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
  return normalized;
}

export function mergeRegisteredAgentRoots(entries, proposed) {
  const byKey = new Map();
  const agentByPath = new Map();
  for (const entry of proposed === undefined ? entries : [...entries, proposed]) {
    assertAgent(entry.agent);
    const path = resolve(entry.path);
    const registeredAgent = agentByPath.get(path);
    if (registeredAgent !== undefined && registeredAgent !== entry.agent) {
      throw new Error(`Custom skill root is already registered for agent ${registeredAgent}: ${path}`);
    }
    agentByPath.set(path, entry.agent);
    byKey.set(`${entry.agent}\0${path}`, { agent: entry.agent, path });
  }
  return [...byKey.values()].sort(compareEntries);
}

function normalizeEntries(entries, home) {
  if (!entries.every((entry) => entry !== null && typeof entry === "object")) {
    throw new Error("Invalid agent root registry entry.");
  }
  return mergeRegisteredAgentRoots(entries.map((entry) => {
    assertAgent(entry.agent);
    if (typeof entry.path !== "string" || entry.path.trim() === "") {
      throw new Error("Registered skill root path must be a non-empty string.");
    }
    const path = isAbsolute(entry.path) ? resolve(entry.path) : resolve(home, entry.path);
    const rel = relative(home, path);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Registered skill root must remain inside the invoking user's home.");
    }
    return { agent: entry.agent, path };
  }));
}

function portablePath(home, path) {
  return relative(home, resolve(path)).split("\\").join("/");
}

function assertAgent(agent) {
  if (!SUPPORTED_AGENTS.has(agent)) {
    throw new Error(`Unsupported setup agent: ${String(agent)}`);
  }
}

function compareEntries(left, right) {
  return `${left.agent}\0${left.path}`.localeCompare(`${right.agent}\0${right.path}`);
}

async function assertSafeRootPath(home, target) {
  const components = [];
  let current = resolve(target);
  while (current !== home) {
    components.push(current);
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  for (const component of components.reverse()) {
    const stats = await lstat(component).catch(missingOnly);
    if (stats === undefined) continue;
    if (stats.isSymbolicLink()) {
      throw new Error("Registered skill root must not traverse a symbolic link.");
    }
    if (!stats.isDirectory()) {
      throw new Error("Registered skill root components must be directories.");
    }
  }
}

function missingOnly(error) {
  if (error?.code === "ENOENT") return undefined;
  throw error;
}
