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

test("README proof fixture shows route picks the right allowed skill", async () => {
  const args = [
    "--config",
    "examples/multi-source.config.yaml",
    "--skills",
    "examples/multi-source-skills",
    "--workflow",
    "codex-night-workflow"
  ];
  const route = await runSkillboard([
    "route",
    "write tests before implementation",
    ...args,
    "--json"
  ]);
  const brief = await runSkillboard([
    "brief",
    "--intent",
    "write tests before implementation",
    ...args,
    "--json"
  ]);
  const guard = await runSkillboard([
    "guard",
    "use",
    "matt.tdd",
    ...args,
    "--json"
  ]);
  const noMatch = await runSkillboard([
    "route",
    "ship a powerpoint deck",
    ...args,
    "--json"
  ]);

  assert.equal(route.code, 0);
  const routePayload = JSON.parse(route.stdout);
  assert.equal(routePayload.intent, "write tests before implementation");
  assert.equal(routePayload.workflow, "codex-night-workflow");
  assert.equal(routePayload.match_source, "capability");
  assert.equal(routePayload.matched_capability, "test-first-implementation");
  assert.equal(routePayload.confidence, "high");
  assert.equal(routePayload.recommended_skill, "matt.tdd");
  assert.deepEqual(routePayload.fallback_skills, ["private.tdd-work-continuity"]);
  assert.equal(routePayload.guard.allowed, true);
  assert.match(routePayload.guard_command, /skillboard guard use matt\.tdd/);
  assert.equal(routePayload.usage_disclosure.confirmation_required, false);
  assert.equal(routePayload.usage_disclosure.start_message, "I will use matt.tdd for this request.");
  assert.equal(routePayload.usage_disclosure.finish_message, "I used matt.tdd for this request because SkillBoard has a remembered or configured preference for it; other allowed skills were also available: private.tdd-work-continuity.");
  assert.equal(routePayload.policy_memory.selected_skill, "matt.tdd");
  assert.deepEqual(routePayload.possible_skills.map((skill) => skill.id), [
    "matt.tdd",
    "private.tdd-work-continuity"
  ]);

  assert.equal(brief.code, 0);
  const briefRoute = JSON.parse(brief.stdout).assistant_guidance.route;
  assert.equal(briefRoute.recommended_skill, "matt.tdd");
  assert.equal(briefRoute.guard_allowed, true);
  assert.equal(briefRoute.usage_disclosure.start_message, "I will use matt.tdd for this request.");

  assert.equal(guard.code, 0);
  const guardPayload = JSON.parse(guard.stdout);
  assert.equal(guardPayload.allowed, true);
  assert.equal(guardPayload.skill, "matt.tdd");
  assert.deepEqual(guardPayload.roles, ["active", "preferred"]);

  assert.equal(noMatch.code, 0);
  const noMatchPayload = JSON.parse(noMatch.stdout);
  assert.equal(noMatchPayload.matched_capability, null);
  assert.equal(noMatchPayload.recommended_skill, null);
  assert.equal(noMatchPayload.usage_disclosure, null);
  assert.match(noMatchPayload.recommendation_reason, /Ask a clarifying question/);
  assert.deepEqual(noMatchPayload.possible_skills.map((skill) => skill.id), [
    "matt.tdd",
    "private.tdd-work-continuity"
  ]);
});

test("README links to the reproducible value proof report", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const proof = await readFile(resolve("docs/value-proof.md"), "utf8");
  const routing = await readFile(resolve("docs/routing.md"), "utf8");

  assert.match(readme, /## Tested Value Proof/);
  assert.match(readme, /\[full reproducible proof\]\(docs\/value-proof\.md\)/);
  assert.match(readme, /## Why Not Just List `\/skills`\?/);
  assert.match(readme, /A raw skill list answers what is declared/);
  assert.match(readme, /SkillBoard answers what can run now\s+and how overlapping matches should route/);
  assert.match(readme, /Same fixture, different answer/);
  assert.match(readme, /A raw list says `matt\.tdd` is active/);
  assert.match(readme, /SkillBoard says the same workflow has 0\s+usable skills/);
  assert.match(readme, /routes "write tests before\s+implementation" to `matt\.tdd`/);
  assert.match(readme, /Question/);
  assert.match(readme, /Raw list/);
  assert.match(readme, /SkillBoard brief/);
  assert.match(readme, /0 usable skills/);
  assert.match(readme, /8 blocked skills/);
  assert.match(readme, /Policy errors: 2/);
  assert.match(readme, /Overlap: Multiple allowed skills match/);
  assert.match(readme, /`grill-me`-style review overlap across Codex and OpenCode/i);
  assert.match(readme, /\[Capability routing\]\(docs\/routing\.md\)/);
  assert.match(readme, /\[Command and config reference\]\(docs\/reference\.md\)/);

  assert.match(proof, /node --test test\/readme-value-proof\.test\.mjs/);
  assert.match(proof, /GitHub-reader takeaway/);
  assert.match(proof, /The raw list answers inventory questions/);
  assert.match(proof, /SkillBoard answers routing questions/);
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
  assert.match(proof, /Case 4: AI route picks the right allowed skill/);
  assert.match(proof, /route "write tests before implementation"/);
  assert.match(proof, /Recommended skill: `matt\.tdd`/);
  assert.match(proof, /Fallback skill: `private\.tdd-work-continuity`/);
  assert.match(proof, /Overlap resolution is exposed in route payloads/);
  assert.match(proof, /I will use matt\.tdd for this request\./);
  assert.match(proof, /Ask a clarifying question before choosing a skill/);

  assert.match(routing, /# Capability Routing/);
  assert.match(routing, /prefer `brief --intent`/);
  assert.match(routing, /matched_capability/);
  assert.match(routing, /I will use <skill-id> for this request\./);
  assert.match(routing, /Ask a clarifying question before choosing a skill/);
});

test("README leads with ask-your-AI workflow before command details", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const firstScreen = readme.slice(0, readme.indexOf("## Why Not Just List `/skills`?"));
  const quickStart = readme.slice(
    readme.indexOf("## 5-Minute Quick Start"),
    readme.indexOf("## What SkillBoard Gives You")
  );

  assert.match(firstScreen, /Keep AI-agent skills broadly available,\s+then route overlaps consistently/i);
  assert.doesNotMatch(firstScreen, /## Goal/);
  assert.match(firstScreen, /If you use more than one coding agent, skill pack, plugin, MCP\s+tool, or\s+marketplace/i);
  assert.match(firstScreen, /answers the practical questions before you install\s+anything or change workflow policy/i);
  assert.match(firstScreen, /which skills are usable now/i);
  assert.match(firstScreen, /which one\s+should win when skills overlap/i);
  assert.match(firstScreen, /which external skills need review/i);
  assert.match(firstScreen, /## Who This Is For/);
  assert.match(firstScreen, /Use SkillBoard if you use more than one coding agent/i);
  assert.match(firstScreen, /skill pack, plugin, MCP\s+tool, or marketplace/i);
  assert.match(firstScreen, /Which skills can this agent use right now\?/);
  assert.match(firstScreen, /Which skill should win when several match the same task\?/);
  assert.match(firstScreen, /If you use one agent with a few hand-written local skills/i);
  assert.match(firstScreen, /ask your AI normal work requests/i);
  assert.match(firstScreen, /No global install is required/i);
  assert.match(firstScreen, /Most use is read-only/i);
  assert.match(firstScreen, /Nothing changes until you approve a policy action/i);
  assert.match(firstScreen, /Project cleanup is previewable/i);
  assert.match(firstScreen, /default\s+uninstall removes SkillBoard settings/i);
  assert.match(firstScreen, /uninstall --dry-run/i);
  assert.match(firstScreen, /workflow-scoped skill priority and overlap routing\s+for AI agents/i);
  assert.match(firstScreen, /Installed user skills are usable by default/i);
  assert.match(firstScreen, /resolve overlapping skills and workflow priority/i);
  assert.match(firstScreen, /SkillBoard runs behind the scenes only when skill choices\s+overlap/i);
  assert.match(firstScreen, /What skills can you use in this project\?/);
  assert.match(firstScreen, /Write tests before implementation\./);
  assert.match(firstScreen, /Review this plan and point out weak assumptions\./);
  assert.match(firstScreen, /Help me refine this UX flow\./);
  assert.match(firstScreen, /Use the Codex test-first skill in OpenCode too\./);
  assert.match(firstScreen, /Can you make `anthropic\.docx` available for this workflow\?/);
  assert.match(firstScreen, /behind the scenes/i);
  assert.match(firstScreen, /audit trace,\s+not a permission prompt/i);
  assert.match(firstScreen, /I will use matt\.tdd for this request\./);
  assert.match(firstScreen, /I used matt\.tdd for this request\./);
  assert.match(firstScreen, /You: "Write tests before implementation\."/);
  assert.match(firstScreen, /policy-changing action/i);
  assert.match(firstScreen, /You\s+do\s+not need to\s+memorize/i);

  assert.match(quickStart, /Install the CLI/i);
  assert.match(quickStart, /Try it without a global install/i);
  assert.match(quickStart, /npm exec --yes --package agent-skillboard@latest -- skillboard --version/);
  assert.match(quickStart, /npm exec --yes --package agent-skillboard@latest -- skillboard help brief/);
  assert.match(quickStart, /read-only commands[\s\S]{0,100}do not create project\s+files/i);
  assert.match(quickStart, /auto-connects the\s+agent layer/i);
  assert.match(quickStart, /detected\s+Codex, Claude, OpenCode, and Hermes user skill roots/i);
  assert.match(quickStart, /npm install -g agent-skillboard/);
  assert.match(quickStart, /No separate setup\s+command is required after a normal global install/i);
  assert.match(quickStart, /skillboard setup --agent codex,claude,opencode,hermes --yes/);
  assert.match(quickStart, /does not create `skillboard\.config\.yaml`,\s+`\.skillboard\/`, `AGENTS\.md`, or `CLAUDE\.md` in projects/i);
  assert.match(quickStart, /ask normal questions/i);
  assert.match(quickStart, /Write tests before implementation\./);
  assert.match(quickStart, /Review this plan and point out weak assumptions\./);
  assert.match(quickStart, /Remove SkillBoard from a project when you are done/i);
  assert.match(quickStart, /skillboard uninstall --dir \/path\/to\/your\/project --dry-run/);
  assert.match(quickStart, /skillboard uninstall --agent-layer --dry-run/);
  assert.match(quickStart, /preserves other agent skills\s+and user-authored `skillboard` skills/i);
  assert.match(quickStart, /Default project uninstall removes SkillBoard config/i);
  assert.match(quickStart, /--keep-settings/i);
  assert.match(quickStart, /AI\/automation\/operator details/i);
  assert.match(quickStart, /npx --yes --package agent-skillboard skillboard init/);
  assert.match(quickStart, /npx --yes --package agent-skillboard skillboard doctor --summary/);
  assert.match(quickStart, /npx --yes --package agent-skillboard skillboard brief --workflow <workflow-from-init>/);
  assert.doesNotMatch(quickStart, /npx agent-skillboard init/);
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
