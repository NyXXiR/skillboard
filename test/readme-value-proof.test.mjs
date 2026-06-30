import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("README proof fixture shows raw list misses policy failure", async () => {
  const rawList = await runSkillboard([
    "list",
    "skills",
    "--config",
    "examples/skillboard.config.yaml",
    "--skills",
    "examples/skills",
    "--workflow",
    "codex-night-workflow"
  ]);
  const brief = await runSkillboard([
    "brief",
    "--config",
    "examples/skillboard.config.yaml",
    "--skills",
    "examples/skills",
    "--workflow",
    "codex-night-workflow"
  ]);

  assert.equal(rawList.code, 0);
  assert.equal(skillRows(rawList.stdout).length, 4);
  assert.match(rawList.stdout, /matt\.tdd\tactive\tworkflow-auto/);
  assert.doesNotMatch(rawList.stdout, /Policy errors/);

  assert.equal(brief.code, 1);
  assert.match(brief.stdout, /AI can use now: 0 \(0 automatic, 0 manual\)/);
  assert.match(brief.stdout, /Blocked for safety: 8/);
  assert.match(brief.stdout, /Policy errors: 2/);
  assert.match(brief.stdout, /Policy warnings: 1/);
  assert.match(brief.stdout, /Capability requirement requirement-clarification in workflow requirement-review lists fallback non-callable skill matt\.grill-with-docs/);
});

test("README proof fixture shows action cards re-resolve usable state", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-readme-proof-"));
  try {
    await cp(resolve("examples/multi-source.config.yaml"), join(root, "skillboard.config.yaml"));
    await cp(resolve("examples/multi-source-skills"), join(root, "skills"), { recursive: true });
    await cp(resolve("AGENTS.md"), join(root, "AGENTS.md"));
    await cp(resolve("CLAUDE.md"), join(root, "CLAUDE.md"));

    const args = [
      "--dir",
      root,
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills"),
      "--workflow",
      "codex-night-workflow"
    ];
    const before = await runSkillboard(["brief", ...args, "--include-actions", "--json"]);
    const beforePayload = JSON.parse(before.stdout);
    const apply = await runSkillboard([
      "apply-action",
      "activate-skill:anthropic.docx",
      ...args,
      "--yes",
      "--json"
    ]);
    const after = await runSkillboard(["brief", ...args, "--json"]);
    const afterPayload = JSON.parse(after.stdout);

    assert.equal(before.code, 0);
    assert.equal(usableCount(beforePayload), 2);
    assert.ok(beforePayload.actions.some((action) => action.id === "activate-skill:anthropic.docx"));

    assert.equal(apply.code, 0);
    assert.equal(JSON.parse(apply.stdout).changed, true);

    assert.equal(after.code, 0);
    assert.equal(usableCount(afterPayload), 3);
    assert.deepEqual(afterPayload.skills.automatic_allowed.map((skill) => skill.id), ["matt.tdd"]);
    assert.deepEqual(afterPayload.skills.manual_allowed.map((skill) => skill.id), [
      "anthropic.docx",
      "private.tdd-work-continuity"
    ]);
    assert.equal(afterPayload.health.policy.errors.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("README proof fixture simulates AI-mediated approved action flow", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-ai-mediated-proof-"));
  try {
    await cp(resolve("examples/multi-source.config.yaml"), join(root, "skillboard.config.yaml"));
    await cp(resolve("examples/multi-source-skills"), join(root, "skills"), { recursive: true });
    await cp(resolve("AGENTS.md"), join(root, "AGENTS.md"));
    await cp(resolve("CLAUDE.md"), join(root, "CLAUDE.md"));

    const args = [
      "--dir",
      root,
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills"),
      "--workflow",
      "codex-night-workflow"
    ];
    const beforeGuard = await runSkillboard([
      "guard",
      "use",
      "anthropic.docx",
      ...args,
      "--json"
    ]);
    const blockedGuard = await runSkillboard([
      "guard",
      "use",
      "matt.grill-me",
      ...args,
      "--json"
    ]);
    const before = await runSkillboard(["brief", ...args, "--include-actions", "--json"]);
    const beforePayload = JSON.parse(before.stdout);
    const guidance = beforePayload.assistant_guidance;
    const selectedChoice = guidance.choices.find((choice) => {
      return choice.action_id === "activate-skill:anthropic.docx";
    });
    const currentAction = beforePayload.actions.find((action) => {
      return action.id === selectedChoice?.action_id;
    });

    assert.equal(beforeGuard.code, 2);
    assertGuardDenied(JSON.parse(beforeGuard.stdout), /not active, preferred, or fallback/);
    assert.equal(blockedGuard.code, 2);
    assertGuardDenied(JSON.parse(blockedGuard.stdout), /blocks skill matt\.grill-me/);

    assert.equal(before.code, 0);
    assert.equal(guidance.status, "needs-decision");
    assert.match(guidance.summary, /needs \d+ user decisions/);
    assert.match(guidance.recommended_next_step, /Activate anthropic\.docx/);
    assert.equal(selectedChoice.label, "Activate anthropic.docx in this workflow");
    assert.equal(selectedChoice.requires_confirmation, true);
    assert.equal(selectedChoice.risk, "medium");
    assert.equal(selectedChoice.blocked_reason, null);
    assert.equal(currentAction.id, selectedChoice.action_id);
    assert.equal(currentAction.kind, "activate-skill");
    assert.equal(currentAction.applies_to.id, "anthropic.docx");
    assert.equal(currentAction.applies_to.workflow, "codex-night-workflow");

    const apply = await runSkillboard([
      "apply-action",
      selectedChoice.action_id,
      ...args,
      "--yes",
      "--json"
    ]);
    const applyPayload = JSON.parse(apply.stdout);
    const returnedBrief = applyPayload.brief;
    const postApplyChoiceIds = returnedBrief.assistant_guidance.choices.map((choice) => choice.action_id);
    const afterGuard = await runSkillboard([
      "guard",
      "use",
      "anthropic.docx",
      ...args,
      "--json"
    ]);
    const afterGuardPayload = JSON.parse(afterGuard.stdout);

    assert.equal(apply.code, 0);
    assert.equal(applyPayload.ok, true);
    assert.equal(applyPayload.mode, "applied");
    assert.equal(applyPayload.changed, true);
    assert.equal(applyPayload.action.id, selectedChoice.action_id);
    assert.equal(returnedBrief.schema_version, 1);
    assert.equal(returnedBrief.health.policy.errors.length, 0);
    assert.equal(postApplyChoiceIds.includes(selectedChoice.action_id), false);
    assert.equal(postApplyChoiceIds.includes("block-skill:anthropic.docx"), true);
    assert.ok(returnedBrief.skills.manual_allowed.some((skill) => skill.id === "anthropic.docx"));

    assert.equal(afterGuard.code, 0);
    assert.equal(afterGuardPayload.allowed, true);
    assert.equal(afterGuardPayload.skill, "anthropic.docx");
    assert.equal(afterGuardPayload.workflow, "codex-night-workflow");
    assert.equal(afterGuardPayload.status, "active");
    assert.deepEqual(afterGuardPayload.roles, ["active"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("README links to the reproducible value proof report", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const proof = await readFile(resolve("docs/value-proof.md"), "utf8");

  assert.match(readme, /## Tested Value Proof/);
  assert.match(readme, /\[full reproducible proof\]\(docs\/value-proof\.md\)/);
  assert.match(readme, /## Why Not Just List `\/skills`\?/);
  assert.match(readme, /A raw skill list answers what is declared/);
  assert.match(readme, /SkillBoard answers what can safely\s+run now/);
  assert.match(readme, /Same fixture, different answer/);
  assert.match(readme, /A raw list says `matt\.tdd` is active/);
  assert.match(readme, /SkillBoard says the same workflow has 0\s+usable skills/);
  assert.match(readme, /Question/);
  assert.match(readme, /Raw list/);
  assert.match(readme, /SkillBoard brief/);
  assert.match(readme, /0 usable skills/);
  assert.match(readme, /8 blocked skills/);
  assert.match(readme, /Policy errors: 2/);
  assert.match(readme, /\[Command and config reference\]\(docs\/reference\.md\)/);

  assert.match(proof, /node --test test\/readme-value-proof\.test\.mjs/);
  assert.match(proof, /GitHub-reader takeaway/);
  assert.match(proof, /The raw list answers inventory questions/);
  assert.match(proof, /SkillBoard answers operational safety questions/);
  assert.match(proof, /Raw skill list/);
  assert.match(proof, /4 workflow-linked rows/);
  assert.match(proof, /matt\.tdd active workflow-auto/);
  assert.match(proof, /SkillBoard brief/);
  assert.match(proof, /0 usable skills/);
  assert.match(proof, /8 blocked skills/);
  assert.match(proof, /Policy errors: 2/);
  assert.match(proof, /Policy warnings: 1/);
  assert.match(proof, /action-card flow/);
  assert.match(proof, /usable skills: 2 -> 3/);
  assert.match(proof, /anthropic\.docx/);
  assert.match(proof, /AI-mediated approved action proof/);
  assert.match(proof, /assistant_guidance/);
  assert.match(proof, /guard use anthropic\.docx/);
  assert.match(proof, /guard use matt\.grill-me/);
});

test("README leads with ask-your-AI workflow before command details", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const firstScreen = readme.slice(0, readme.indexOf("## Why Not Just List `/skills`?"));
  const quickStart = readme.slice(
    readme.indexOf("## 5-Minute Quick Start"),
    readme.indexOf("## What SkillBoard Gives You")
  );

  assert.match(firstScreen, /Ask your AI/i);
  assert.match(firstScreen, /What skills can you use in this project\?/);
  assert.match(firstScreen, /Can you make `anthropic\.docx` available for this workflow\?/);
  assert.match(firstScreen, /behind the scenes/i);
  assert.match(firstScreen, /You\s+do not need to memorize/i);

  assert.match(quickStart, /Ask your AI/i);
  assert.match(quickStart, /AI runs\s+SkillBoard behind the scenes/i);
  assert.match(quickStart, /AI\/automation\/operator details/i);
  assert.match(quickStart, /npx agent-skillboard init/);
  assert.match(quickStart, /npx agent-skillboard brief/);
  assert.match(quickStart, /npx agent-skillboard doctor --summary/);
  assert.doesNotMatch(quickStart, /run these commands every time you need a skill/i);
});

async function runSkillboard(args) {
  try {
    const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", ...args], {
      cwd: resolve(".")
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

function skillRows(stdout) {
  return stdout.split("\n").filter((line) => line.trim().length > 0);
}

function usableCount(brief) {
  return brief.skills.automatic_allowed.length + brief.skills.manual_allowed.length;
}

function assertGuardDenied(payload, reasonPattern) {
  assert.equal(payload.allowed, false);
  assert.equal(payload.workflow, "codex-night-workflow");
  assert.ok(Array.isArray(payload.reasons));
  assert.match(payload.reasons.join("\n"), reasonPattern);
}
