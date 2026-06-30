import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  withBriefFixture,
  withSourceReviewFixture
} from "./helpers/advisor-brief-fixtures.mjs";
import { withGroupsFixture } from "./helpers/advisor-brief-groups.mjs";
import {
  assertNoApplyCommands,
  runCli,
  sectionBetween,
  withInitializedEmptyProject
} from "./helpers/brief-cli.mjs";

test("brief command renders readable text sections", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow"
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /^# SkillBoard Brief\n\nAI can use now: 1 \(0 automatic, 1 manual\)\nNeeds your decision: 0\nBlocked for safety: 0/m);
    assert.match(result.stdout, /## Next safe action/);
    assert.match(result.stdout, /What your AI can use now/);
    assert.match(result.stdout, /Manual only/);
    assert.match(result.stdout, /Needs your decision/);
    assert.match(result.stdout, /Blocked for safety/);
    assert.match(result.stdout, /Not in this workflow/);
    assert.match(result.stdout, /Suggested next actions/);
    assert.match(result.stdout, /apply: `skillboard apply-action/);
    assert.doesNotMatch(result.stdout, /underlying apply:/);
    assert.doesNotMatch(result.stdout, /Action cards not requested/);
    assert.throws(() => JSON.parse(result.stdout));
  });
});

test("brief command treats reviewable source friction as a decision queue, not hard blocked", async () => {
  await withSourceReviewFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow"
    ]);

    assert.equal(result.code, 1);
    assert.match(result.stdout, /Needs your decision: 1/);
    assert.match(result.stdout, /Blocked for safety: 0/);
    assert.match(result.stdout, /## Needs your decision/);
    assert.match(result.stdout, /vendor\.auto/);
    assert.match(result.stdout, /Decide whether to block source acme\.pack/);
    assert.doesNotMatch(result.stdout, /Action cards not requested/);
  });
});

test("brief command surfaces policy errors above skill lists", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-policy-health-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "broken-helper"), { recursive: true });
    await writeFile(
      join(skillsRoot, "broken-helper", "SKILL.md"),
      "---\nname: broken-helper\ndescription: Broken helper.\n---\n# broken-helper\n",
      "utf8"
    );
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  user.broken:
    path: broken-helper
    status: active
    invocation: blocked
    exposure: exported
    category: user
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - user.broken
    blocked_skills: []
install_units: {}
`,
      "utf8"
    );

    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow"
    ]);

    assert.equal(result.code, 1);
    assert.match(result.stdout, /## Policy health/);
    assert.match(result.stdout, /Policy errors: 3/);
    assert.match(result.stdout, /Active skill user\.broken cannot use invocation: blocked/);
    assert.match(result.stdout, /Workflow daily-workflow activates non-callable skill user\.broken with invocation: blocked/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief command defaults to compact output for large manual skill sets", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-compact-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const skillIds = Array.from({ length: 18 }, (_, index) => `manual.skill-${String(index + 1).padStart(2, "0")}`);
    const init = await runCli(["init", "--dir", root, "--no-scan-installed"]);
    assert.equal(init.code, 0);
    for (const skillId of skillIds) {
      const path = skillId.replace(".", "/");
      await mkdir(join(skillsRoot, path), { recursive: true });
      await writeFile(
        join(skillsRoot, path, "SKILL.md"),
        `---\nname: ${skillId}\ndescription: Manual skill ${skillId}.\n---\n# ${skillId}\n`,
        "utf8"
      );
    }
    await writeFile(configPath, compactConfig(skillIds), "utf8");

    const compact = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow"
    ]);
    const verbose = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--verbose"
    ]);

    assert.equal(compact.code, 0);
    assert.equal(verbose.code, 0);
    assert.match(compact.stdout, /AI can use now: 18 \(0 automatic, 18 manual\)/);
    assert.match(compact.stdout, /## Top categories/);
    assert.match(compact.stdout, /Run `skillboard brief --verbose/);
    assert.match(compact.stdout, /13 more manual-only skills hidden/);
    assert.doesNotMatch(compact.stdout, /manual\.skill-18/);
    assert.doesNotMatch(compact.stdout, /underlying apply:/);
    assert.match(verbose.stdout, /manual\.skill-18/);
    assert.ok(compact.stdout.split("\n").length < verbose.stdout.split("\n").length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief command json omits actions unless requested", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 0);
    assert.equal(payload.schema_version, 1);
    assert.equal(Object.hasOwn(payload, "actions"), false);
  });
});

test("brief command include-actions json includes actions", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--include-actions",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 0);
    assert.ok(Array.isArray(payload.actions));
    assert.ok(payload.actions.length > 0);
    assertAssistantGuidance(payload, { status: "ready", hasWorkflowGuardHint: true });
  });
});

test("brief command include-actions json guides review-needed decisions", async () => {
  await withSourceReviewFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--include-actions",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 1);
    assertAssistantGuidance(payload, { status: "needs-decision", hasWorkflowGuardHint: true });
    assert.ok(payload.assistant_guidance.choices.some((choice) => choice.risk === "high"));
  });
});

test("brief command include-actions json blocks guidance when policy errors coexist with review queue", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-policy-review-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "vendor-auto"), { recursive: true });
    await writeFile(
      join(skillsRoot, "vendor-auto", "SKILL.md"),
      "---\nname: vendor-auto\ndescription: Vendor auto skill.\n---\n# vendor-auto\n",
      "utf8"
    );
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  vendor.auto:
    path: vendor-auto
    status: active
    invocation: blocked
    exposure: unit-managed
    category: plugin
    owner_install_unit: acme.pack
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - vendor.auto
    blocked_skills: []
install_units:
  acme.pack:
    kind: plugin
    source: npx acme install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: high
    provided_components:
      - skills
    components:
      skills:
        - vendor.auto
`,
      "utf8"
    );

    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--include-actions",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 1);
    assert.ok(payload.health.policy.errors.length > 0);
    assert.ok(payload.review_queue.length > 0);
    assert.ok(payload.actions.length > 0);
    assertAssistantGuidance(payload, {
      status: "blocked",
      hasWorkflowGuardHint: true,
      choicesMatchActions: false
    });
    assert.deepEqual(payload.assistant_guidance.choices, []);
    assert.match(payload.assistant_guidance.recommended_next_step, /fix/i);
    assert.match(payload.assistant_guidance.recommended_next_step, /policy error/i);
    assert.match(payload.assistant_guidance.recommended_next_step, /before applying actions/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief command guides initialized empty projects toward setup", async () => {
  await withInitializedEmptyProject(async ({ configPath, root, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--dir",
      root,
      "--config",
      configPath,
      "--skills",
      skillsRoot
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /AI can use now: 0 \(0 automatic, 0 manual\)/);
    assert.match(result.stdout, /Workflow: none selected/);
    assert.match(result.stdout, /setup|inventory refresh|discover|add harness|add workflow/i);
    assert.match(result.stdout, /skillboard inventory refresh\b[\s\S]*--dry-run/i);
    assert.match(result.stdout, /skillboard inventory refresh\b[\s\S]*--dir\b/i);

    const nextAction = sectionBetween(result.stdout, "## Next safe action", "## What your AI can use now");
    assert.doesNotMatch(nextAction, /^-\s*none$/m);
    assert.match(nextAction, /setup|inventory refresh|discover|add harness|add workflow/i);
    assert.doesNotMatch(nextAction, /Reset SkillBoard generated project files|uninstall|cleanup/i);

    const suggestedActionsStart = result.stdout.indexOf("## Suggested next actions");
    assert.notEqual(suggestedActionsStart, -1);
    const suggestedActions = result.stdout.slice(suggestedActionsStart);
    assert.doesNotMatch(suggestedActions, /^-\s*none$/m);
    assert.match(suggestedActions, /setup|inventory refresh|discover|add harness|add workflow/i);
    assert.doesNotMatch(result.stdout, /## Advanced cleanup actions/);
  });
});

test("brief command initialized empty project json omits actions by default", async () => {
  await withInitializedEmptyProject(async ({ configPath, root, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--dir",
      root,
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 0);
    assert.equal(payload.schema_version, 1);
    assert.equal(Object.hasOwn(payload, "actions"), false);
  });
});

test("brief command initialized empty project include-actions json keeps returned action schema compatible", async () => {
  await withInitializedEmptyProject(async ({ configPath, root, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--dir",
      root,
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--include-actions",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 0);
    assert.equal(payload.schema_version, 1);
    assert.ok(Array.isArray(payload.actions));
    assert.ok(payload.actions.length > 0);
    assert.ok(payload.actions.some((action) => action.kind === "setup-guidance"));
    assert.notDeepEqual([...new Set(payload.actions.map((action) => action.kind))], ["reset-cleanup"]);
    assert.deepEqual(payload.assistant_guidance.choices, []);
    assert.doesNotMatch(payload.assistant_guidance.recommended_next_step, /approve/i);

    for (const action of payload.actions) {
      assert.equal(typeof action.id, "string");
      assert.equal(typeof action.kind, "string");
      assert.equal(typeof action.label, "string");
      assert.ok(action.dry_run === null || typeof action.dry_run.display === "string");
      assert.ok(action.apply === null || typeof action.apply.display === "string");
    }
  });
});

test("brief command missing config json exits with expected payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-missing-cli-"));
  try {
    const before = await readdir(root);
    const result = await runCli([
      "brief",
      "--dir",
      root,
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills"),
      "--include-actions",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.equal(payload.ok, false);
    assert.equal(typeof payload.error.code, "string");
    assert.equal(payload.health.mode, "not-initialized");
    assertAssistantGuidance(payload, {
      status: "not-initialized",
      hasWorkflowGuardHint: false,
      choicesMatchActions: false
    });
    assert.ok(payload.actions.some((action) => action.kind === "init-project"));
    assert.deepEqual(payload.assistant_guidance.choices, []);
    assert.match(payload.assistant_guidance.recommended_next_step, /Initialize SkillBoard/);
    assert.doesNotMatch(payload.assistant_guidance.recommended_next_step, /approve/i);
    assert.deepEqual(await readdir(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief command invalid config include-actions json guides config repair without mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-invalid-config-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await writeFile(join(root, "AGENTS.md"), "# Test project\n", "utf8");
    await mkdir(join(skillsRoot, "bad"), { recursive: true });
    await writeFile(
      join(skillsRoot, "bad", "SKILL.md"),
      "---\nname: bad\n---\n# Bad\n",
      "utf8"
    );
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  bad.skill:
    path: bad
    status: not-a-status
    invocation: manual-only
    exposure: exported
    category: user
capabilities: {}
harnesses: {}
workflows: {}
install_units: {}
`,
      "utf8"
    );

    const before = await listProjectTree(root);
    const result = await runCli([
      "brief",
      "--dir",
      root,
      "--include-actions",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.equal(payload.ok, false);
    assert.equal(payload.health.config.valid, false);
    assert.equal(payload.health.config.error, "Unsupported status for bad.skill: not-a-status");
    assertAssistantGuidance(payload, {
      status: "invalid-config",
      hasWorkflowGuardHint: false,
      choicesMatchActions: false
    });
    assert.match(payload.assistant_guidance.recommended_next_step, /Fix the SkillBoard configuration/);
    assert.deepEqual(payload.assistant_guidance.choices, []);
    assert.deepEqual(await listProjectTree(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief command unknown workflow json exits with expected payload", async () => {
  await withGroupsFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "missing",
      "--include-actions",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 2);
    assert.equal(result.stderr, "");
    assert.equal(payload.ok, false);
    assert.equal(payload.workflow.unknown, true);
    assertAssistantGuidance(payload, {
      status: "unknown-workflow",
      hasWorkflowGuardHint: false,
      choicesMatchActions: false
    });
    assertNoBlockedOrInapplicableChoices(payload);
    assert.deepEqual(payload.assistant_guidance.choices, []);
    assert.doesNotMatch(payload.assistant_guidance.recommended_next_step, /approve/i);
    assertNoApplyCommands(payload);
  });
});

test("brief command help lists command and options", async () => {
  const result = await runCli(["help"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /brief \[--workflow <name>\]/);
  assert.match(result.stdout, /--include-actions/);
  assert.match(result.stdout, /--json/);
  assert.match(result.stdout, /--verbose/);
});

function compactConfig(skillIds) {
  const skills = skillIds.map((skillId, index) => {
    const category = index < 9 ? "software-development" : "productivity";
    return `  ${skillId}:
    path: ${skillId.replace(".", "/")}
    status: active
    invocation: manual-only
    exposure: exported
    category: ${category}`;
  }).join("\n");
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
${skills}
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
${skillIds.map((skillId) => `      - ${skillId}`).join("\n")}
    blocked_skills: []
install_units: {}
`;
}

async function listProjectTree(root) {
  return (await readdir(root, { recursive: true })).map(String).sort();
}

function assertAssistantGuidance(payload, { status, hasWorkflowGuardHint, choicesMatchActions = true }) {
  assert.ok(payload.assistant_guidance, "expected assistant_guidance");
  assert.deepEqual(Object.keys(payload.assistant_guidance), [
    "status",
    "summary",
    "recommended_next_step",
    "choices",
    "guard"
  ]);
  assert.equal(payload.assistant_guidance.status, status);
  assert.equal(typeof payload.assistant_guidance.summary, "string");
  assert.ok(payload.assistant_guidance.summary.length > 0);
  assert.ok(
    payload.assistant_guidance.recommended_next_step === null
      || typeof payload.assistant_guidance.recommended_next_step === "string"
  );
  assert.deepEqual(payload.assistant_guidance.guard, {
    required: true,
    when: "before invoking a skill",
    command_hint: hasWorkflowGuardHint ? payload.assistant_guidance.guard.command_hint : null
  });
  if (hasWorkflowGuardHint) {
    assert.match(payload.assistant_guidance.guard.command_hint, /skillboard guard use '?<skill-id>'?/);
    assert.match(payload.assistant_guidance.guard.command_hint, /--workflow daily-workflow/);
  }
  if (choicesMatchActions) {
    assert.deepEqual(
      payload.assistant_guidance.choices.map((choice) => choice.action_id),
      (payload.actions ?? []).map((action) => action.id)
    );
  }
  for (const choice of payload.assistant_guidance.choices) {
    assert.deepEqual(Object.keys(choice), [
      "label",
      "action_id",
      "risk",
      "requires_confirmation",
      "effect",
      "blocked_reason"
    ]);
    assert.equal(typeof choice.label, "string");
    assert.equal(typeof choice.action_id, "string");
    assert.equal(typeof choice.risk, "string");
    assert.equal(typeof choice.requires_confirmation, "boolean");
    assert.equal(typeof choice.effect, "string");
    assert.ok(choice.blocked_reason === null || typeof choice.blocked_reason === "string");
  }
}

function assertNoBlockedOrInapplicableChoices(payload) {
  const actionsById = new Map((payload.actions ?? []).map((action) => [action.id, action]));
  for (const choice of payload.assistant_guidance.choices) {
    const action = actionsById.get(choice.action_id);
    assert.ok(action, `choice ${choice.action_id} should map to a current action`);
    assert.equal(action.blocked_reason, null);
    assert.equal(action.application?.blocked_reason ?? null, null);
    assert.notEqual(action.application?.apply ?? null, null);
    assert.equal(choice.blocked_reason, null);
  }
}
