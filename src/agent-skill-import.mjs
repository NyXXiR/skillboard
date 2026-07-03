import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import YAML from "yaml";
import { detectedAgentSkillRoots, preferredAgentSkillRoot, supportedAgentNames } from "./agent-skill-roots.mjs";

const AGENT_MARKERS = Object.freeze({
  codex: [/CODEX_HOME/i, /(^|[/\\])\.codex([/\\]|$)/i, /~\/\.codex\b/i, /\bCodex\b/i],
  claude: [/CLAUDE_HOME/i, /(^|[/\\])\.claude([/\\]|$)/i, /~\/\.claude\b/i, /\bClaude\b/i, /\bCLAUDE\.md\b/],
  opencode: [/OPENCODE_HOME/i, /(^|[/\\])opencode([/\\]|$)/i, /~\/\.config\/opencode\b/i, /\bOpenCode\b/i],
  hermes: [/HERMES_HOME/i, /(^|[/\\])\.hermes([/\\]|$)/i, /~\/\.hermes\b/i, /\bHermes\b/i]
});

export async function importAgentSkill(options = {}) {
  const env = options.env ?? process.env;
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const sourceAgent = requireAgent(options.from, "--from");
  const targetAgent = requireAgent(options.to, "--to");
  const sourceSkill = requireNonEmpty(options.skill, "--skill");
  const sourceRoots = (await detectedAgentSkillRoots(sourceAgent, home, env, { includeFallback: true }))
    .map((root) => root.skillRoot);
  const targetRoot = await agentSkillRoot(targetAgent, home, env);
  const source = await findSourceSkillInRoots({ roots: sourceRoots, skill: sourceSkill });
  const sourceContent = await readFile(source.skillFile, "utf8");
  const targetSkill = options.targetSkill ?? sourceSkill;
  const targetDir = resolveRelativeTarget(targetRoot, targetSkill);
  const targetSkillFile = join(targetDir, "SKILL.md");
  const provenanceFile = join(targetDir, ".skillboard-import.json");
  const compatibility = analyzeAgentCompatibility(sourceContent, { sourceAgent, targetAgent });
  const adaptedFile = options.adaptedFile;
  const dryRun = options.dryRun === true;
  const yes = options.yes === true;
  const replace = options.replace === true;
  const mode = adaptedFile === undefined ? "copy" : "adapted";
  const next = nextSteps({ sourceAgent, targetAgent, sourceSkill, targetSkill });

  if (!compatibility.compatible && adaptedFile === undefined) {
    return {
      status: "needs-adaptation",
      mode: "adaptation-required",
      changed: false,
      source: sourceSummary(sourceAgent, sourceSkill, source),
      target: targetSummary(targetAgent, targetSkill, targetSkillFile),
      compatibility,
      next
    };
  }

  const content = adaptedFile === undefined ? sourceContent : await readFile(adaptedFile, "utf8");
  const targetExists = await exists(targetSkillFile);
  const writeRequired = !dryRun && yes;
  const status = dryRun || !yes ? "ready" : "installed";

  if (targetExists && !replace) {
    throw new Error(`Target skill already exists: ${targetSkillFile}; pass --replace to overwrite`);
  }
  if (writeRequired) {
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetSkillFile, content, "utf8");
    await writeFile(provenanceFile, `${JSON.stringify(provenance({
      sourceAgent,
      sourceSkill,
      source,
      sourceContent,
      targetAgent,
      targetSkill,
      targetSkillFile,
      targetContent: content,
      mode,
      compatibility
    }), null, 2)}\n`, "utf8");
  }

  return {
    status,
    mode,
    changed: writeRequired,
    source: sourceSummary(sourceAgent, sourceSkill, source),
    target: targetSummary(targetAgent, targetSkill, targetSkillFile),
    compatibility,
    next: status === "ready" ? { ...next, apply: `${next.apply} --yes` } : null
  };
}

export function renderImportAgentSkill(result) {
  if (result.status === "needs-adaptation") {
    return [
      "Skill requires adaptation before import.",
      `Source: ${result.source.agent}:${result.source.skill} (${result.source.path})`,
      `Target: ${result.target.agent}:${result.target.skill} (${result.target.path})`,
      `Reasons: ${result.compatibility.reasons.join("; ")}`,
      `Next: ${result.next.adaptedFileOption}`,
      ""
    ].join("\n");
  }
  return [
    `${result.status === "installed" ? "Imported" : "Ready to import"} skill: ${result.source.agent}:${result.source.skill} -> ${result.target.agent}:${result.target.skill}`,
    `Mode: ${result.mode}`,
    `Target: ${result.target.path}`,
    result.status === "ready" ? "Re-run with --yes to write the target skill." : "Provenance: .skillboard-import.json",
    ""
  ].join("\n");
}

export async function agentSkillRoot(agent, home = homedir(), env = process.env) {
  requireKnownAgent(agent);
  return await preferredAgentSkillRoot(agent, home, env);
}

export function supportedImportAgents() {
  return supportedAgentNames();
}

function requireAgent(value, optionName) {
  const agent = requireNonEmpty(value, optionName);
  if (!supportedAgentNames().includes(agent)) {
    throw new Error(`Unsupported ${optionName} agent: ${agent}`);
  }
  return agent;
}

function requireKnownAgent(agent) {
  if (!supportedAgentNames().includes(agent)) {
    throw new Error(`Unsupported agent: ${agent}`);
  }
}

function requireNonEmpty(value, optionName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${optionName} is required`);
  }
  return value.trim();
}

async function findSourceSkill(options) {
  const root = resolve(options.root);
  const directDir = resolveRelativeTarget(root, options.skill);
  const directFile = join(directDir, "SKILL.md");
  if (await exists(directFile)) {
    return { skillDir: directDir, skillFile: directFile, matchedBy: "path" };
  }
  const matches = [];
  for (const file of await findSkillFiles(root)) {
    const text = await readFile(file, "utf8").catch(() => "");
    const frontmatter = parseSkillFrontmatter(text);
    if (frontmatter.name === options.skill) {
      matches.push({ skillDir: dirname(file), skillFile: file, matchedBy: "frontmatter" });
    }
  }
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new Error(`Multiple source skills matched ${options.skill}; pass a directory name instead`);
  }
  throw new Error(`Source skill not found: ${options.skill} under ${root}`);
}

async function findSourceSkillInRoots(options) {
  const misses = [];
  for (const root of options.roots) {
    try {
      return await findSourceSkill({ root, skill: options.skill });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith(`Source skill not found: ${options.skill} under `)) {
        throw error;
      }
      misses.push(root);
    }
  }
  throw new Error(`Source skill not found: ${options.skill} under ${misses.join(", ")}`);
}

async function findSkillFiles(root) {
  const files = [];
  const pending = [resolve(root)];
  while (pending.length > 0) {
    const current = pending.shift();
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        files.push(path);
      }
    }
  }
  return files;
}

function parseSkillFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) {
    return {};
  }
  const parsed = YAML.parse(match[1]);
  return parsed !== null && typeof parsed === "object" ? parsed : {};
}

function analyzeAgentCompatibility(content, options) {
  const reasons = [];
  for (const [agent, markers] of Object.entries(AGENT_MARKERS)) {
    if (agent === options.targetAgent) {
      continue;
    }
    const matched = markers.filter((marker) => marker.test(content)).map((marker) => marker.source);
    if (matched.length > 0) {
      reasons.push(`source mentions ${agent}-specific runtime markers: ${matched.join(", ")}`);
    }
  }
  return {
    compatible: reasons.length === 0,
    sourceAgent: options.sourceAgent,
    targetAgent: options.targetAgent,
    reasons
  };
}

function nextSteps(options) {
  const base = `skillboard import-skill --from ${options.sourceAgent} --to ${options.targetAgent} --skill ${options.sourceSkill} --target-skill ${options.targetSkill}`;
  return {
    askUser: "Ask whether to adapt the skill for the target agent before changing the skill body.",
    adaptedFileOption: `${base} --adapted-file <adapted-skill.md> --yes`,
    apply: base
  };
}

function provenance(options) {
  return {
    version: 1,
    mode: options.mode,
    source: {
      agent: options.sourceAgent,
      skill: options.sourceSkill,
      path: options.source.skillFile,
      digest: digest(options.sourceContent)
    },
    target: {
      agent: options.targetAgent,
      skill: options.targetSkill,
      path: options.targetSkillFile,
      digest: digest(options.targetContent)
    },
    compatibility: options.compatibility
  };
}

function sourceSummary(agent, skill, source) {
  return {
    agent,
    skill,
    path: source.skillFile,
    matchedBy: source.matchedBy
  };
}

function targetSummary(agent, skill, path) {
  return { agent, skill, path };
}

function digest(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function resolveRelativeTarget(root, value) {
  const relativePath = String(value).replace(/\\/g, "/");
  if (relativePath.trim() === "" || relativePath.includes("\0")) {
    throw new Error("skill path must be a non-empty relative path");
  }
  if (relativePath.startsWith("/") || /^[A-Za-z]:\//.test(relativePath)) {
    throw new Error("skill path must be relative");
  }
  const absolute = resolve(root, relativePath);
  assertInside(resolve(root), absolute, "skill path");
  return absolute;
}

function assertInside(root, candidate, label) {
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return;
  }
  throw new Error(`${label} must stay under ${root}`);
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}
