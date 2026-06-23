import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("cli check and dashboard handle the multi-source example", async () => {
  const baseArgs = ["--config", "examples/multi-source.config.yaml", "--skills", "examples/multi-source-skills"];
  const check = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "check", ...baseArgs]);
  const dashboard = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "dashboard", ...baseArgs]);

  assert.match(check.stdout, /Policy check passed/);
  assert.match(dashboard.stdout, /github\.mattpocock\.skills/);
  assert.match(dashboard.stdout, /github\.code-yeongyu\.oh-my-openagent/);
  assert.match(dashboard.stdout, /owner: `github\.mattpocock\.skills`/);
  assert.match(dashboard.stdout, /owner: `local\.agent-skills-private`/);
});

test("cli init bootstraps config and agent bridge files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-test-"));
  try {
    const first = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root]);
    const second = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root]);
    const config = await readFile(join(root, "skillboard.config.yaml"), "utf8");
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    const profilesReadme = await readFile(join(root, ".skillboard", "profiles", "README.md"), "utf8");
    const check = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "check",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills")
    ]);

    assert.match(first.stdout, /Initialized SkillBoard/);
    assert.match(second.stdout, /SkillBoard already initialized/);
    assert.match(config, /invocation_policy: deny-by-default/);
    assert.match(agents, /BEGIN SKILLBOARD/);
    assert.match(agents, /skillboard check/);
    assert.match(agents, /skillboard import/);
    assert.match(claude, /BEGIN SKILLBOARD/);
    assert.match(profilesReadme, /source profiles/);
    assert.equal(agents.match(/BEGIN SKILLBOARD/g).length, 1);
    assert.match(check.stdout, /Policy check passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli impact can write disable reports to a file", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-impact-test-"));
  try {
    const out = join(root, "impact.md");
    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "impact",
      "disable",
      "matt.tdd",
      "--config",
      "examples/skillboard.config.yaml",
      "--skills",
      "examples/skills",
      "--out",
      out
    ]);
    const report = await readFile(out, "utf8");

    assert.match(result.stdout, /Impact report written/);
    assert.match(report, /Affected required outputs/);
    assert.match(report, /test_result_or_reason/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
