import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SUPPORTED_AGENTS = Object.freeze(["codex", "claude", "opencode", "hermes"]);

export function supportedAgentNames() {
  return [...SUPPORTED_AGENTS];
}

export async function detectedAgentSkillRoots(agent, home = homedir(), env = process.env, options = {}) {
  const candidates = await agentSkillRootCandidates(agent, home, env);
  const detected = [];
  for (const candidate of candidates) {
    if (
      candidate.explicit
      || await exists(candidate.skillRoot)
      || candidate.detectWhenExists !== undefined && await exists(candidate.detectWhenExists)
    ) {
      detected.push(candidate);
    }
  }
  if (detected.length === 0 && options.includeFallback === true) {
    detected.push(fallbackCandidate(candidates));
  }
  return uniqueCandidates(detected);
}

export async function setupAgentSkillTargets(agent, home = homedir(), env = process.env, options = {}) {
  const roots = await detectedAgentSkillRoots(agent, home, env, { includeFallback: options.includeFallback === true });
  return roots.map((root) => ({
    agent,
    home: resolve(home),
    skillPath: join(root.skillRoot, "skillboard", "SKILL.md"),
    root: root.skillRoot,
    source: root.source
  }));
}

export async function preferredAgentSkillRoot(agent, home = homedir(), env = process.env) {
  const [root] = await detectedAgentSkillRoots(agent, home, env, { includeFallback: true });
  return root.skillRoot;
}

export async function agentSkillRootCandidates(agent, home = homedir(), env = process.env) {
  const normalized = normalizeAgent(agent);
  const xdgConfig = env.XDG_CONFIG_HOME ?? join(home, ".config");
  if (normalized === "codex") {
    const agentsHome = join(home, ".agents");
    return uniqueCandidates([
      env.CODEX_HOME === undefined ? null : candidate(join(env.CODEX_HOME, "skills"), "CODEX_HOME/skills", true, false),
      env.AGENTS_HOME === undefined ? null : candidate(join(env.AGENTS_HOME, "skills"), "AGENTS_HOME/skills", true, false),
      candidate(join(agentsHome, "skills"), "~/.agents/skills", false, false, agentsHome),
      candidate(join(home, ".codex", "skills"), "~/.codex/skills", false, true)
    ]);
  }
  if (normalized === "claude") {
    return uniqueCandidates([
      env.CLAUDE_HOME === undefined ? null : candidate(join(env.CLAUDE_HOME, "skills"), "CLAUDE_HOME/skills", true, false),
      candidate(join(home, ".claude", "skills"), "~/.claude/skills", false, true),
      candidate(join(xdgConfig, "claude", "skills"), "XDG claude skills", false, false),
      candidate(join(home, ".config", "claude", "skills"), "~/.config/claude/skills", false, false)
    ]);
  }
  if (normalized === "opencode") {
    return uniqueCandidates([
      env.OPENCODE_HOME === undefined ? null : candidate(join(env.OPENCODE_HOME, "skills"), "OPENCODE_HOME/skills", true, false),
      candidate(join(xdgConfig, "opencode", "skills"), "XDG opencode skills", false, xdgConfig !== join(home, ".config")),
      candidate(join(home, ".config", "opencode", "skills"), "~/.config/opencode/skills", false, true),
      candidate(join(home, ".opencode", "skills"), "~/.opencode/skills", false, false)
    ]);
  }
  const hermesHome = env.HERMES_HOME ?? join(home, ".hermes");
  return uniqueCandidates([
    env.HERMES_HOME === undefined ? null : candidate(join(env.HERMES_HOME, "skills"), "HERMES_HOME/skills", true, false),
    candidate(join(home, ".hermes", "skills"), "~/.hermes/skills", false, true),
    ...(await hermesProfileCandidates(hermesHome))
  ]);
}

function normalizeAgent(agent) {
  if (!SUPPORTED_AGENTS.includes(agent)) {
    throw new Error(`Unsupported agent: ${agent}`);
  }
  return agent;
}

function candidate(skillRoot, source, explicit, fallback, detectWhenExists) {
  return { skillRoot, source, explicit, fallback, detectWhenExists };
}

function fallbackCandidate(candidates) {
  return candidates.find((candidate) => candidate.fallback) ?? candidates[0];
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates.filter(Boolean)) {
    const key = resolve(candidate.skillRoot);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({ ...candidate, skillRoot: key });
  }
  return unique;
}

async function hermesProfileCandidates(hermesHome) {
  const profilesRoot = join(hermesHome, "profiles");
  const entries = await readdir(profilesRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => candidate(join(profilesRoot, entry.name, "skills"), `Hermes profile ${entry.name}`, false, false));
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}
