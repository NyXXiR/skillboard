// allow: SIZE_OK - brief CLI integration suite split is deferred from the 0.2.7 release gate.
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
import { displayCommand } from "./helpers/expected-command.mjs";

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

test("brief command does not hide manual-only skills from the usable-now section", async () => {
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
    assert.match(result.stdout, /AI can use now: 1 \(0 automatic, 1 manual\)/);
    const usableSection = sectionBetween(result.stdout, "## What your AI can use now", "## Needs your decision");
    assert.match(usableSection, /On-request skills can be used when the user asks the AI; the AI runs the guard first\./);
    assert.match(usableSection, /When the guard allows use, disclose the selected skill at the start and completion instead of asking again\./);
    assert.match(usableSection, /user\.local-helper/);
    assert.match(usableSection, /on request/);
    assert.doesNotMatch(usableSection, /manual-only/);
    assert.doesNotMatch(usableSection, /^-\s*none$/m);
    assert.doesNotMatch(result.stdout, /## Manual only/);
  });
});

test("brief command intent json includes route-backed skill suggestion", async () => {
  await withIntentRouteFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--intent",
      "write tests before implementation",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 0);
    assert.equal(payload.assistant_guidance.status, "ready");
    assert.equal(payload.assistant_guidance.goal_document.path, "docs/ai-skill-routing-goal.md");
    assert.match(payload.assistant_guidance.goal_document.purpose, /non-blocking AI skill routing control plane/i);
    assert.ok(payload.assistant_guidance.goal_document.when_to_read.includes("before changing routing"));
    assert.match(payload.assistant_guidance.recommended_next_step, /matt\.tdd/);
    assert.equal(payload.assistant_guidance.route.intent, "write tests before implementation");
    assert.equal(payload.assistant_guidance.route.matched_capability, "test-first-implementation");
    assert.equal(payload.assistant_guidance.route.match_source, "capability");
    assert.equal(payload.assistant_guidance.route.confidence, "high");
    assert.equal(payload.assistant_guidance.route.recommended_skill, "matt.tdd");
    assert.deepEqual(payload.assistant_guidance.route.fallback_skills, ["private.tdd-work-continuity"]);
    assert.deepEqual(payload.assistant_guidance.route.route_candidates.map((candidate) => ({
      skill: candidate.skill,
      role: candidate.role,
      selected: candidate.selected,
      guard_allowed: candidate.guard_allowed
    })), [
      {
        skill: "matt.tdd",
        role: "preferred",
        selected: true,
        guard_allowed: true
      },
      {
        skill: "private.tdd-work-continuity",
        role: "fallback",
        selected: false,
        guard_allowed: true
      }
    ]);
    assert.ok(payload.assistant_guidance.route.matched_terms.includes("test"));
    assert.match(payload.assistant_guidance.route.recommendation_reason, /Matched capability test-first-implementation/);
    assert.equal(payload.assistant_guidance.route.usage_disclosure.confirmation_required, false);
    assert.match(payload.assistant_guidance.route.usage_disclosure.start, /State at the start that matt\.tdd is being used/);
    assert.match(payload.assistant_guidance.route.usage_disclosure.finish, /State at completion that matt\.tdd was used/);
    assert.equal(payload.assistant_guidance.route.usage_disclosure.start_message, "I will use matt.tdd for this request.");
    assert.equal(payload.assistant_guidance.route.usage_disclosure.finish_message, "I used matt.tdd for this request.");
    assert.equal(payload.assistant_guidance.route.guard_allowed, true);
    assert.match(payload.assistant_guidance.route.guard_command, /skillboard guard use matt\.tdd/);
  });
});

test("brief command intent json asks after use when an allowed fallback is selected", async () => {
  await withFallbackRouteFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--intent",
      "write tests before implementation",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 0);
    assert.equal(payload.assistant_guidance.status, "needs-decision");
    assert.equal(
      payload.assistant_guidance.recommended_next_step,
      "Use user.tdd for this request after the guard check passes; handle pending review decisions after the task unless a policy-changing action is needed now."
    );
    assert.equal(payload.assistant_guidance.route.recommended_skill, "user.tdd");
    assert.equal(payload.assistant_guidance.route.route_candidates[0].guard_allowed, false);
    assert.equal(payload.assistant_guidance.route.route_candidates[1].selected, true);
    assert.deepEqual(payload.assistant_guidance.route.post_use_policy_suggestion, {
      timing: "after_use",
      mode: "ask_after_use",
      reason: "SkillBoard selected fallback user.tdd because preferred skill vendor.test-first is denied. After completing the task, ask whether to remember user.tdd as the preferred skill for test-first-implementation in daily-workflow.",
      question: "Should I remember user.tdd as the preferred skill for similar test-first-implementation requests in daily-workflow?",
      requires_confirmation: true,
      suggested_policy: {
        kind: "prefer-skill",
        skill: "user.tdd",
        workflow: "daily-workflow",
        capability: "test-first-implementation",
        command_hint: displayCommand([
          "skillboard", "prefer", "user.tdd",
          "--workflow", "daily-workflow",
          "--capability", "test-first-implementation",
          "--config", configPath,
          "--skills", skillsRoot
        ])
      }
    });
  });
});

test("brief command intent json asks after use when allowed ambiguity is selected", async () => {
  await withAmbiguousAllowedRouteFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--intent",
      "write tests before implementation",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 0);
    assert.equal(payload.assistant_guidance.status, "ready");
    assert.equal(
      payload.assistant_guidance.recommended_next_step,
      "Use user.tdd for this request after the guard check passes."
    );
    assert.equal(payload.assistant_guidance.route.recommended_skill, "user.tdd");
    assert.equal(payload.assistant_guidance.route.guard_allowed, true);
    assert.equal(payload.assistant_guidance.route.usage_disclosure.confirmation_required, false);
    assert.deepEqual(payload.assistant_guidance.route.route_candidates.map((candidate) => ({
      skill: candidate.skill,
      role: candidate.role,
      selected: candidate.selected,
      guard_allowed: candidate.guard_allowed,
      guard_roles: candidate.guard_roles,
      capability_roles: candidate.capability_roles
    })), [
      {
        skill: "user.tdd",
        role: "preferred",
        selected: true,
        guard_allowed: true,
        guard_roles: ["active"],
        capability_roles: []
      },
      {
        skill: "private.tdd-work-continuity",
        role: "fallback",
        selected: false,
        guard_allowed: true,
        guard_roles: ["active"],
        capability_roles: []
      }
    ]);
    assert.deepEqual(payload.assistant_guidance.route.post_use_policy_suggestion, {
      timing: "after_use",
      mode: "ask_after_use",
      reason: "SkillBoard found multiple allowed skills for test-first-implementation and selected user.tdd. After completing the task, ask whether to remember user.tdd as the preferred skill for test-first-implementation in daily-workflow to reduce future ambiguity.",
      question: "Should I remember user.tdd as the preferred skill for similar test-first-implementation requests in daily-workflow?",
      requires_confirmation: true,
      suggested_policy: {
        kind: "prefer-skill",
        skill: "user.tdd",
        workflow: "daily-workflow",
        capability: "test-first-implementation",
        command_hint: displayCommand([
          "skillboard", "prefer", "user.tdd",
          "--workflow", "daily-workflow",
          "--capability", "test-first-implementation",
          "--config", configPath,
          "--skills", skillsRoot
        ])
      }
    });
  });
});

test("brief command intent text renders suggested skill without hiding guard boundary", async () => {
  await withIntentRouteFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--intent",
      "write tests before implementation"
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /## Suggested skill for this request/);
    assert.match(result.stdout, /Intent: write tests before implementation/);
    assert.match(result.stdout, /Match source: capability/);
    assert.match(result.stdout, /Matched capability: test-first-implementation/);
    assert.match(result.stdout, /Matched skill: none/);
    assert.match(result.stdout, /Why: Matched capability test-first-implementation/);
    assert.match(result.stdout, /Matched terms: `implementation`, `test`/);
    assert.match(result.stdout, /Recommended skill: `matt\.tdd`/);
    assert.match(result.stdout, /Fallback skills: `private\.tdd-work-continuity`/);
    assert.match(result.stdout, /Route candidates:/);
    assert.match(result.stdout, /`matt\.tdd` \(preferred, selected, allowed\)/);
    assert.match(result.stdout, /`private\.tdd-work-continuity` \(fallback, allowed\)/);
    assert.match(result.stdout, /Guard: `skillboard guard use matt\.tdd/);
    assert.match(
      result.stdout,
      /Disclosure: run the guard automatically, state at the start that `matt\.tdd` is being used, and state at completion that it was used\. No extra user approval is needed when the guard allows it\./
    );
    assert.match(result.stdout, /Say before use: "I will use matt\.tdd for this request\."/);
    assert.match(result.stdout, /Say after completion: "I used matt\.tdd for this request\."/);
  });
});

test("brief command intent text renders ask-after preference after allowed ambiguity", async () => {
  await withAmbiguousAllowedRouteFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--intent",
      "write tests before implementation"
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Recommended skill: `user\.tdd`/);
    assert.match(result.stdout, /`user\.tdd` \(preferred, selected, allowed\)/);
    assert.match(result.stdout, /`private\.tdd-work-continuity` \(fallback, allowed\)/);
    assert.doesNotMatch(result.stdout, /ask before use/i);
    assert.match(result.stdout, /No extra user approval is needed when the guard allows it\./);
    assert.match(result.stdout, /After completion: ask whether to remember user\.tdd as the preferred skill for similar test-first-implementation requests in daily-workflow\./);
    assert.match(result.stdout, /Policy command after confirmation: `skillboard prefer user\.tdd --workflow daily-workflow --capability test-first-implementation/);
  });
});

test("brief command intent no-match asks for clarification in guidance", async () => {
  await withIntentRouteFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--intent",
      "draw a logo",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 0);
    assert.equal(payload.assistant_guidance.route.matched_capability, null);
    assert.equal(payload.assistant_guidance.route.match_source, "none");
    assert.equal(payload.assistant_guidance.route.confidence, "none");
    assert.equal(payload.assistant_guidance.route.recommended_skill, null);
    assert.deepEqual(payload.assistant_guidance.route.matched_terms, []);
    assert.match(payload.assistant_guidance.route.recommendation_reason, /No workflow capability or skill metadata matched/);
    assert.equal(payload.assistant_guidance.route.usage_disclosure, null);
    assert.equal(payload.assistant_guidance.route.guard_command, null);
    assert.match(payload.assistant_guidance.recommended_next_step, /clarify/i);
    assert.ok(payload.assistant_guidance.route.possible_skills.some((skill) => skill.id === "matt.tdd"));
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
    assert.match(result.stdout, /Review source acme\.pack/);
    assert.doesNotMatch(result.stdout, /Action cards not requested/);
  });
});

test("brief command surfaces non-skill review queue decisions in text summary", async () => {
  const result = await runCli([
    "brief",
    "--config",
    "examples/multi-source.config.yaml",
    "--skills",
    "examples/multi-source-skills",
    "--workflow",
    "codex-night-workflow"
  ]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Needs your decision: 5/);
  const decisionSection = sectionBetween(result.stdout, "## Needs your decision", "## Blocked for safety");
  assert.doesNotMatch(decisionSection, /^-\s*none$/m);
  assert.match(decisionSection, /Review github\.voltagent\.awesome-agent-skills/);
  assert.match(decisionSection, /source is not pinned by digest or signature/);
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
    assert.match(compact.stdout, /13 more on-request skills hidden/);
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
    assert.match(payload.assistant_guidance.summary, /1 user decision/);
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
    assertAssistantGuidance(payload, {
      status: "workflow-selection-needed",
      hasWorkflowGuardHint: false,
      choicesMatchActions: false
    });
    assert.deepEqual(payload.assistant_guidance.choices, []);
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

test("brief command missing config json includes setup guidance without actions", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-missing-no-actions-cli-"));
  try {
    const result = await runCli([
      "brief",
      "--dir",
      root,
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills"),
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 1);
    assert.equal(Object.hasOwn(payload, "actions"), false);
    assertAssistantGuidance(payload, {
      status: "not-initialized",
      hasWorkflowGuardHint: false,
      choicesMatchActions: false
    });
    assert.deepEqual(payload.assistant_guidance.choices, []);
    assert.match(payload.assistant_guidance.recommended_next_step, /Initialize SkillBoard/);
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
  const result = await runCli(["brief", "--help"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Usage: skillboard brief \[--workflow <name>\]/m);
  assert.match(result.stdout, /\[--intent <request>\]/);
  assert.match(result.stdout, /--include-actions/);
  assert.match(result.stdout, /--json/);
  assert.match(result.stdout, /--verbose/);
  assert.match(result.stdout, /Reads the current SkillBoard brief/);
  assert.doesNotMatch(result.stdout, /^# SkillBoard Brief/m);
});

test("brief command help is available through help brief", async () => {
  const result = await runCli(["help", "brief"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Usage: skillboard brief \[--workflow <name>\]/m);
  assert.match(result.stdout, /guard use/);
  assert.doesNotMatch(result.stdout, /^SkillBoard - AI-mediated workflow-scoped skill policy$/m);
});

test("command-local help does not hide unknown commands", async () => {
  const result = await runCli(["biref", "--help"]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command: biref/);
  assert.match(result.stderr, /Run skillboard help for usage\./);
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

async function withFallbackRouteFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-fallback-route-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "vendor-test-first"), { recursive: true });
    await mkdir(join(skillsRoot, "user-tdd"), { recursive: true });
    await writeFile(
      join(skillsRoot, "vendor-test-first", "SKILL.md"),
      "---\nname: vendor-test-first\ndescription: Write tests before implementation.\n---\n# vendor-test-first\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "user-tdd", "SKILL.md"),
      "---\nname: user-tdd\ndescription: Write tests before implementation with local project conventions.\n---\n# user-tdd\n",
      "utf8"
    );
    await writeFile(configPath, fallbackRouteConfig(), "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function fallbackRouteConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  vendor.test-first:
    path: vendor-test-first
    status: active
    invocation: manual-only
    exposure: exported
    category: testing
    owner_install_unit: vendor.skills
  user.tdd:
    path: user-tdd
    status: active
    invocation: manual-only
    exposure: exported
    category: testing
capabilities:
  test-first-implementation:
    canonical: vendor.test-first
    alternatives:
      - user.tdd
    default_policy: manual-only
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - vendor.test-first
      - user.tdd
    blocked_skills: []
    required_capabilities:
      test-first-implementation:
        preferred: vendor.test-first
        fallback:
          - user.tdd
        policy: manual-only
install_units:
  vendor.skills:
    kind: marketplace
    source: npx skills add vendor/test-first
    scope: user-global
    provided_components:
      - skills
    components:
      skills:
        - vendor.test-first
    enabled: true
    trust_level: unreviewed
    permission_risk: medium
    rollback: reinstall
`;
}

async function withIntentRouteFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-intent-route-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "matt-tdd"), { recursive: true });
    await mkdir(join(skillsRoot, "private-tdd"), { recursive: true });
    await writeFile(
      join(skillsRoot, "matt-tdd", "SKILL.md"),
      "---\nname: matt-tdd\ndescription: Write tests before implementation.\n---\n# matt-tdd\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "private-tdd", "SKILL.md"),
      "---\nname: private-tdd\ndescription: Keep TDD work continuous.\n---\n# private-tdd\n",
      "utf8"
    );
    await writeFile(configPath, intentRouteConfig(), "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withAmbiguousAllowedRouteFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-ambiguous-route-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "user-tdd"), { recursive: true });
    await mkdir(join(skillsRoot, "private-tdd"), { recursive: true });
    await writeFile(
      join(skillsRoot, "user-tdd", "SKILL.md"),
      "---\nname: user-tdd\ndescription: Write tests before implementation with local project conventions.\n---\n# user-tdd\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "private-tdd", "SKILL.md"),
      "---\nname: private-tdd\ndescription: Keep TDD work continuous while writing tests before implementation.\n---\n# private-tdd\n",
      "utf8"
    );
    await writeFile(configPath, ambiguousAllowedRouteConfig(), "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function ambiguousAllowedRouteConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  user.tdd:
    path: user-tdd
    status: active
    invocation: manual-only
    exposure: exported
    category: testing
  private.tdd-work-continuity:
    path: private-tdd
    status: active
    invocation: manual-only
    exposure: exported
    category: testing
capabilities:
  test-first-implementation:
    canonical: user.tdd
    alternatives:
      - private.tdd-work-continuity
    default_policy: manual-only
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - user.tdd
      - private.tdd-work-continuity
    blocked_skills: []
install_units: {}
`;
}

function intentRouteConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  matt.tdd:
    path: matt-tdd
    status: active
    invocation: workflow-auto
    exposure: exported
    category: engineering
  private.tdd-work-continuity:
    path: private-tdd
    status: active
    invocation: router-only
    exposure: exported
    category: engineering
capabilities:
  test-first-implementation:
    canonical: matt.tdd
    alternatives:
      - private.tdd-work-continuity
    default_policy: workflow-auto
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - matt.tdd
      - private.tdd-work-continuity
    blocked_skills: []
    required_capabilities:
      test-first-implementation:
        preferred: matt.tdd
        fallback:
          - private.tdd-work-continuity
        policy: workflow-auto
install_units: {}
`;
}

function assertAssistantGuidance(payload, { status, hasWorkflowGuardHint, choicesMatchActions = true }) {
  assert.ok(payload.assistant_guidance, "expected assistant_guidance");
  assert.deepEqual(Object.keys(payload.assistant_guidance), [
    "status",
    "summary",
    "goal_document",
    "recommended_next_step",
    "choices",
    "guard"
  ]);
  assert.equal(payload.assistant_guidance.status, status);
  assert.equal(typeof payload.assistant_guidance.summary, "string");
  assert.ok(payload.assistant_guidance.summary.length > 0);
  assert.deepEqual(Object.keys(payload.assistant_guidance.goal_document), [
    "path",
    "purpose",
    "when_to_read"
  ]);
  assert.equal(payload.assistant_guidance.goal_document.path, "docs/ai-skill-routing-goal.md");
  assert.match(payload.assistant_guidance.goal_document.purpose, /non-blocking AI skill routing control plane/i);
  assert.deepEqual(payload.assistant_guidance.goal_document.when_to_read, [
    "before changing routing",
    "before changing brief output",
    "before changing bridge instructions",
    "before changing policy UX",
    "before changing workflow UX"
  ]);
  assert.ok(
    payload.assistant_guidance.recommended_next_step === null
      || typeof payload.assistant_guidance.recommended_next_step === "string"
  );
  assert.deepEqual(payload.assistant_guidance.guard, {
    required: true,
    when: "before invoking a skill",
    command_hint: hasWorkflowGuardHint ? payload.assistant_guidance.guard.command_hint : null,
    allowed_use: {
      confirmation_required: false,
      start: "State at the start which selected skill is being used for this request.",
      finish: "State at completion which selected skill was used.",
      start_message_template: "I will use <skill-id> for this request.",
      finish_message_template: "I used <skill-id> for this request.",
      ask_user_when: "Ask the user only if the guard denies use or a policy-changing action is needed."
    }
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
      "kind",
      "applies_to",
      "risk",
      "requires_confirmation",
      "effect",
      "blocked_reason"
    ]);
    assert.equal(typeof choice.label, "string");
    assert.equal(typeof choice.action_id, "string");
    assert.equal(typeof choice.kind, "string");
    assert.ok(choice.applies_to === null || typeof choice.applies_to === "object");
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
