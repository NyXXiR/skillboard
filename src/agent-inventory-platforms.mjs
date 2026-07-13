import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { agentSkillRootCandidates } from "./agent-skill-roots.mjs";

export async function defaultScanRoots(home, env) {
  const codexHome = env.CODEX_HOME ?? join(home, ".codex");
  const agentRoots = await Promise.all([
    agentSkillRootCandidates("codex", home, env),
    agentSkillRootCandidates("claude", home, env),
    agentSkillRootCandidates("opencode", home, env),
    agentSkillRootCandidates("hermes", home, env)
  ]);
  return [
    join(codexHome, "skills", ".system"),
    join(codexHome, "plugins", "cache"),
    join(home, ".agents", "shared-skills"),
    ...agentRoots.flat().map((root) => root.skillRoot)
  ];
}

export function sharedUserUnit(path, home) {
  return userSkillUnit("shared.user-skills", path, home);
}

export function systemCodexUnit(path, home) {
  return {
    id: "codex.system-skills",
    kind: "agent",
    sourceClass: "runtime-extension",
    priority: 55,
    trustLevel: "reviewed",
    source: displayPath(path, home),
    scope: "user-global",
    manifestPath: "",
    cachePath: displayPath(path, home),
    category: "agent-runtime"
  };
}

export function userCodexUnit(path, home) {
  return userSkillUnit("codex.user-skills", path, home);
}

export function userClaudeUnit(path, home) {
  return userSkillUnit("claude.user-skills", path, home);
}

export function userOpenCodeUnit(path, home) {
  return userSkillUnit("opencode.user-skills", path, home);
}

export function userHermesUnit(path, home) {
  return userSkillUnit("hermes.user-skills", path, home);
}

export function hermesProfileUnit(path, home) {
  const profile = safeSegment(basename(dirname(path))).replace(/\./g, "-");
  return userSkillUnit(`hermes.profile.${profile}.skills`, path, home);
}

export function customUserUnit(path, home) {
  return {
    ...userSkillUnit(`custom.${safeSegment(basename(path))}.skills`, path, home),
    scope: "local"
  };
}

export function isHermesProfileSkillsPath(path) {
  const normalized = path.replace(/\\/g, "/");
  return /\/\.hermes\/profiles\/[^/]+\/skills$/u.test(normalized);
}

export function safeSegment(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.length === 0 ? "skill" : normalized;
}

export function displayPath(path, home) {
  const resolvedHome = resolve(home);
  const resolvedPath = resolve(path);
  const rel = relative(resolvedHome, resolvedPath);
  if (rel === "") {
    return "~";
  }
  if (!rel.startsWith("..") && !isAbsolute(rel)) {
    return `~/${rel.replace(/\\/g, "/")}`;
  }
  return resolvedPath;
}

function userSkillUnit(id, path, home) {
  return {
    id,
    kind: "skill",
    sourceClass: undefined,
    priority: 100,
    trustLevel: "trusted",
    source: displayPath(path, home),
    scope: "user-global",
    manifestPath: "",
    cachePath: displayPath(path, home),
    category: "user"
  };
}
