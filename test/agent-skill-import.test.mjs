import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BIN = join(process.cwd(), "bin", "skillboard.mjs");

function agentEnv(home) {
  return {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_HOME: join(home, ".claude"),
    OPENCODE_HOME: join(home, ".config", "opencode"),
    HERMES_HOME: join(home, ".hermes")
  };
}

function withoutEnvKeys(env, keys) {
  const copy = { ...env };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

async function writeSkill(path, body) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "SKILL.md"), body, "utf8");
}

async function runSkillboard(args, options = {}) {
  try {
    const result = await execFileAsync(process.execPath, [BIN, ...args], options);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("import-skill copies a compatible user skill into another agent root", async () => {
  const home = await mkdtemp(join(tmpdir(), "skillboard-import-skill-copy-"));
  try {
    const project = join(home, "project");
    await mkdir(project);
    const content = "---\nname: test-first\ndescription: Run tests before implementation.\n---\n# Test First\nUse a test-first workflow.\n";
    await writeSkill(join(home, ".codex", "skills", "test-first"), content);

    const result = await runSkillboard([
      "import-skill",
      "--from",
      "codex",
      "--to",
      "opencode",
      "--skill",
      "test-first",
      "--yes",
      "--json"
    ], { cwd: project, env: agentEnv(home) });

    const payload = JSON.parse(result.stdout);
    const targetSkill = join(home, ".config", "opencode", "skills", "test-first", "SKILL.md");
    const provenance = JSON.parse(await readFile(join(home, ".config", "opencode", "skills", "test-first", ".skillboard-import.json"), "utf8"));

    assert.equal(result.code, 0, result.stderr);
    assert.equal(payload.status, "installed");
    assert.equal(payload.mode, "copy");
    assert.equal(payload.compatibility.compatible, true);
    assert.equal(await readFile(targetSkill, "utf8"), content);
    assert.equal(provenance.source.agent, "codex");
    assert.equal(provenance.target.agent, "opencode");
    assert.equal(provenance.mode, "copy");
    assert.equal(await readFile(join(project, "skillboard.config.yaml"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(project, "AGENTS.md"), "utf8").catch(() => null), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("import-skill can read Codex skills from .agents skill roots", async () => {
  const home = await mkdtemp(join(tmpdir(), "skillboard-import-skill-agents-root-"));
  try {
    const content = "---\nname: shared-test-first\ndescription: Run tests before implementation.\n---\n# Shared Test First\nUse a test-first workflow.\n";
    await writeSkill(join(home, ".agents", "skills", "shared-test-first"), content);

    const result = await runSkillboard([
      "import-skill",
      "--from",
      "codex",
      "--to",
      "opencode",
      "--skill",
      "shared-test-first",
      "--yes",
      "--json"
    ], { cwd: home, env: withoutEnvKeys(agentEnv(home), ["CODEX_HOME"]) });

    const payload = JSON.parse(result.stdout);
    const targetSkill = join(home, ".config", "opencode", "skills", "shared-test-first", "SKILL.md");

    assert.equal(result.code, 0, result.stderr);
    assert.equal(payload.status, "installed");
    assert.match(payload.source.path, /\.agents\/skills\/shared-test-first\/SKILL\.md/);
    assert.equal(await readFile(targetSkill, "utf8"), content);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("import-skill reports adaptation-required when the source is agent-specific", async () => {
  const home = await mkdtemp(join(tmpdir(), "skillboard-import-skill-adapt-required-"));
  try {
    const source = "---\nname: codex-hook\ndescription: Uses Codex hook config.\n---\n# Codex Hook\nRead CODEX_HOME and update ~/.codex/config.toml before use.\n";
    await writeSkill(join(home, ".codex", "skills", "codex-hook"), source);

    const result = await runSkillboard([
      "import-skill",
      "--from",
      "codex",
      "--to",
      "opencode",
      "--skill",
      "codex-hook",
      "--json"
    ], { cwd: home, env: agentEnv(home) });

    const payload = JSON.parse(result.stdout);
    const targetSkill = join(home, ".config", "opencode", "skills", "codex-hook", "SKILL.md");

    assert.equal(result.code, 2, result.stderr);
    assert.equal(payload.status, "needs-adaptation");
    assert.equal(payload.compatibility.compatible, false);
    assert.match(payload.compatibility.reasons.join("\n"), /codex/i);
    assert.match(payload.next.adaptedFileOption, /--adapted-file/);
    assert.equal(await readFile(targetSkill, "utf8").catch(() => null), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("import-skill installs an AI-adapted file while preserving source provenance", async () => {
  const home = await mkdtemp(join(tmpdir(), "skillboard-import-skill-adapted-"));
  try {
    const source = "---\nname: codex-hook\ndescription: Uses Codex hook config.\n---\n# Codex Hook\nRead CODEX_HOME and update ~/.codex/config.toml before use.\n";
    const adapted = "---\nname: opencode-hook\ndescription: Uses OpenCode config.\n---\n# OpenCode Hook\nUse OPENCODE_HOME and OpenCode configuration before use.\n";
    const adaptedFile = join(home, "opencode-hook.SKILL.md");
    await writeSkill(join(home, ".codex", "skills", "codex-hook"), source);
    await writeFile(adaptedFile, adapted, "utf8");

    const result = await runSkillboard([
      "import-skill",
      "--from",
      "codex",
      "--to",
      "opencode",
      "--skill",
      "codex-hook",
      "--target-skill",
      "opencode-hook",
      "--adapted-file",
      adaptedFile,
      "--yes",
      "--json"
    ], { cwd: home, env: agentEnv(home) });

    const payload = JSON.parse(result.stdout);
    const targetDir = join(home, ".config", "opencode", "skills", "opencode-hook");
    const provenance = JSON.parse(await readFile(join(targetDir, ".skillboard-import.json"), "utf8"));

    assert.equal(result.code, 0, result.stderr);
    assert.equal(payload.status, "installed");
    assert.equal(payload.mode, "adapted");
    assert.equal(payload.compatibility.compatible, false);
    assert.equal(await readFile(join(targetDir, "SKILL.md"), "utf8"), adapted);
    assert.equal(provenance.mode, "adapted");
    assert.equal(provenance.source.agent, "codex");
    assert.equal(provenance.target.agent, "opencode");
    assert.equal(provenance.source.skill, "codex-hook");
    assert.equal(provenance.target.skill, "opencode-hook");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
