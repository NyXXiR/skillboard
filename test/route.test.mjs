import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preferSkill } from "../src/index.mjs";
import { routeSkill } from "../src/route.mjs";
import { loadWorkspace } from "../src/workspace.mjs";
import { displayCommand } from "./helpers/expected-command.mjs";

test("route preserves denied preferred fallback ask-after contract", async () => {
  await withFallbackRouteFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const result = routeSkill(workspace, {
      intent: "write tests before implementation",
      workflow: "daily-workflow",
      configPath,
      skillsRoot
    });

    assert.equal(result.matched_capability, "test-first-implementation");
    assert.equal(result.match_source, "capability");
    assert.equal(result.recommended_skill, "user.tdd");
    assert.deepEqual(result.fallback_skills, []);
    assert.equal(result.usage_disclosure.confirmation_required, false);
    assert.deepEqual(result.route_candidates.map((candidate) => ({
      skill: candidate.skill,
      role: candidate.role,
      selected: candidate.selected,
      guard_allowed: candidate.guard_allowed
    })), [
      {
        skill: "vendor.test-first",
        role: "preferred",
        selected: false,
        guard_allowed: false
      },
      {
        skill: "user.tdd",
        role: "fallback",
        selected: true,
        guard_allowed: true
      }
    ]);
    assert.match(result.route_candidates[0].guard_reasons.join("\n"), /unreviewed non-user source vendor\.skills/);
    assert.equal(
      result.post_use_policy_suggestion.suggested_policy.command_hint,
      displayCommand([
        "skillboard", "prefer", "user.tdd",
        "--workflow", "daily-workflow",
        "--capability", "test-first-implementation",
        "--config", configPath,
        "--skills", skillsRoot
      ])
    );
  });
});

test("route reports denied preferred before allowed overlap when multiple fallbacks are usable", async () => {
  await withMixedDeniedAllowedFallbacksFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const result = routeSkill(workspace, {
      intent: "write tests before implementation",
      workflow: "daily-workflow",
      configPath,
      skillsRoot
    });

    assert.equal(result.recommended_skill, "user.tdd");
    assert.deepEqual(result.fallback_skills, ["private.tdd-work-continuity"]);
    assert.deepEqual(result.overlap_resolution, {
      status: "resolved",
      mode: "allowed-fallback",
      selected_skill: "user.tdd",
      matched_skills: ["vendor.test-first", "user.tdd", "private.tdd-work-continuity"],
      allowed_skills: ["user.tdd", "private.tdd-work-continuity"],
      denied_skills: ["vendor.test-first"],
      summary: "Some matching skills are denied for test-first-implementation; SkillBoard keeps allowed skills available and routes daily-workflow to user.tdd."
    });
    assert.match(result.post_use_policy_suggestion.reason, /preferred skill vendor\.test-first is denied/);
  });
});

test("route suppresses disclosure and post-use suggestions when guard denies every candidate", async () => {
  await withGuardDeniedRouteFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const result = routeSkill(workspace, {
      intent: "write tests before implementation",
      workflow: "daily-workflow",
      configPath,
      skillsRoot
    });

    assert.equal(result.recommended_skill, "user.test-first");
    assert.equal(result.guard.allowed, false);
    assert.equal(result.usage_disclosure, null);
    assert.equal(result.post_use_policy_suggestion, null);
    assert.deepEqual(result.fallback_skills, []);
    assert.deepEqual(result.route_candidates.map((candidate) => ({
      skill: candidate.skill,
      selected: candidate.selected,
      guard_allowed: candidate.guard_allowed
    })), [
      {
        skill: "user.test-first",
        selected: true,
        guard_allowed: false
      }
    ]);
  });
});

test("route suggests ask-after preference for ambiguous allowed workflow skills", async () => {
  await withAmbiguousAllowedRouteFixture(async ({ configPath, skillsRoot }) => {
    const beforeWorkspace = await loadWorkspace({ configPath, skillsRoot });
    const before = routeSkill(beforeWorkspace, {
      intent: "write tests before implementation",
      workflow: "daily-workflow",
      configPath,
      skillsRoot
    });

    assert.equal(before.matched_capability, "test-first-implementation");
    assert.equal(before.match_source, "capability");
    assert.equal(before.recommended_skill, "user.tdd");
    assert.deepEqual(before.fallback_skills, ["private.tdd-work-continuity"]);
    assert.equal(before.usage_disclosure.confirmation_required, false);
    assert.deepEqual(before.route_candidates.map((candidate) => ({
      skill: candidate.skill,
      role: candidate.role,
      selected: candidate.selected,
      guard_allowed: candidate.guard_allowed
    })), [
      {
        skill: "user.tdd",
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
    assert.deepEqual(before.post_use_policy_suggestion, {
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

    const configBytes = await readFile(configPath, "utf8");
    await assert.rejects(preferSkill({
      skillId: before.post_use_policy_suggestion.suggested_policy.skill,
      workflow: before.post_use_policy_suggestion.suggested_policy.workflow,
      capability: before.post_use_policy_suggestion.suggested_policy.capability,
      configPath,
      skillsRoot
    }), /Version 1 policy is read-only\. Run `skillboard migrate v2`\./);
    assert.equal(await readFile(configPath, "utf8"), configBytes);
  });
});

test("route honors explicitly requested allowed fallback before capability preference", async () => {
  await withAmbiguousAllowedRouteFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const result = routeSkill(workspace, {
      intent: "use private.tdd-work-continuity for test-first implementation",
      workflow: "daily-workflow",
      configPath,
      skillsRoot
    });

    assert.equal(result.matched_capability, null);
    assert.equal(result.matched_skill, "private.tdd-work-continuity");
    assert.equal(result.match_source, "skill-metadata");
    assert.equal(result.recommended_skill, "private.tdd-work-continuity");
    assert.equal(result.policy_memory, null);
    assert.equal(result.post_use_policy_suggestion, null);
    assert.equal(
      result.usage_disclosure.finish_message,
      "I used private.tdd-work-continuity for this request."
    );
    const selected = result.route_candidates.find((candidate) => candidate.selected);
    assert.equal(selected.skill, "private.tdd-work-continuity");
    assert.equal(selected.role, "matched");
    assert.equal(selected.guard_allowed, true);
    assert.deepEqual(selected.guard_reasons, []);
  });
});

test("route resolves grill-me style overlap consistently across Codex and OpenCode workflows", async () => {
  await withCriticalReviewOverlapFixture(async ({ configPath, skillsRoot }) => {
    for (const workflow of ["codex-workflow", "opencode-workflow"]) {
      const workspace = await loadWorkspace({ configPath, skillsRoot });
      const result = routeSkill(workspace, {
        intent: "grill this design and review weak assumptions",
        workflow,
        configPath,
        skillsRoot
      });

      assert.equal(result.matched_capability, "critical-review");
      assert.equal(result.match_source, "capability");
      assert.equal(result.recommended_skill, "matt.grill-me");
      assert.deepEqual(result.fallback_skills, ["team.review-work", "user.product-critique"]);
      assert.deepEqual(result.overlap_resolution, {
        status: "resolved",
        mode: "permissive-routing",
        selected_skill: "matt.grill-me",
        matched_skills: ["matt.grill-me", "team.review-work", "user.product-critique"],
        allowed_skills: ["matt.grill-me", "team.review-work", "user.product-critique"],
        denied_skills: [],
        summary: `Multiple allowed skills match critical-review; SkillBoard keeps them available and routes ${workflow} to matt.grill-me.`
      });
      assert.deepEqual(result.route_candidates.map((candidate) => ({
        skill: candidate.skill,
        selected: candidate.selected,
        guard_allowed: candidate.guard_allowed
      })), [
        {
          skill: "matt.grill-me",
          selected: true,
          guard_allowed: true
        },
        {
          skill: "team.review-work",
          selected: false,
          guard_allowed: true
        },
        {
          skill: "user.product-critique",
          selected: false,
          guard_allowed: true
        }
      ]);
      assert.match(result.post_use_policy_suggestion.reason, /multiple allowed skills/);
    }
  });
});

test("route keeps no-match as clarification without policy suggestion", async () => {
  await withAmbiguousAllowedRouteFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const result = routeSkill(workspace, {
      intent: "draw a logo",
      workflow: "daily-workflow",
      configPath,
      skillsRoot
    });

    assert.equal(result.match_source, "none");
    assert.equal(result.recommended_skill, null);
    assert.equal(result.guard_command, null);
    assert.equal(result.usage_disclosure, null);
    assert.equal(result.post_use_policy_suggestion, null);
  });
});

test("routeSkill uses default paths for fallback post-use policy commands", async () => {
  await withFallbackRouteFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const result = routeSkill(workspace, {
      intent: "write tests before implementation",
      workflow: "daily-workflow"
    });

    assert.equal(result.recommended_skill, "user.tdd");
    assert.equal(
      result.guard_command,
      "skillboard guard use user.tdd --workflow daily-workflow --config skillboard.config.yaml --skills skills"
    );
    assert.equal(
      result.post_use_policy_suggestion.suggested_policy.command_hint,
      displayCommand([
        "skillboard", "prefer", "user.tdd",
        "--workflow", "daily-workflow",
        "--capability", "test-first-implementation",
        "--config", "skillboard.config.yaml",
        "--skills", "skills"
      ])
    );
  });
});

test("post-use policy suggestion can be remembered for the next route", async () => {
  await withFallbackRouteFixture(async ({ configPath, skillsRoot }) => {
    const beforeWorkspace = await loadWorkspace({ configPath, skillsRoot });
    const displayConfigPath = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\skillboard-route-api-defaults\\skillboard.config.yaml";
    const displaySkillsRoot = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\skillboard-route-api-defaults\\skills";
    const before = routeSkill(beforeWorkspace, {
      intent: "write tests before implementation",
      workflow: "daily-workflow",
      configPath: displayConfigPath,
      skillsRoot: displaySkillsRoot
    });
    const suggestion = before.post_use_policy_suggestion;

    assert.equal(before.recommended_skill, "user.tdd");
    assert.equal(suggestion.requires_confirmation, true);
    assert.equal(
      suggestion.suggested_policy.command_hint,
      displayCommand([
        "skillboard", "prefer", "user.tdd",
        "--workflow", "daily-workflow",
        "--capability", "test-first-implementation",
        "--config", displayConfigPath,
        "--skills", displaySkillsRoot
      ])
    );

    const configBytes = await readFile(configPath, "utf8");
    await assert.rejects(preferSkill({
      skillId: suggestion.suggested_policy.skill,
      workflow: suggestion.suggested_policy.workflow,
      capability: suggestion.suggested_policy.capability,
      configPath,
      skillsRoot
    }), /Version 1 policy is read-only\. Run `skillboard migrate v2`\./);
    assert.equal(await readFile(configPath, "utf8"), configBytes);
  });
});

async function withFallbackRouteFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-route-api-defaults-"));
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
    return await run({ configPath, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withMixedDeniedAllowedFallbacksFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-route-mixed-overlap-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "vendor-test-first"), { recursive: true });
    await mkdir(join(skillsRoot, "user-tdd"), { recursive: true });
    await mkdir(join(skillsRoot, "private-tdd"), { recursive: true });
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
    await writeFile(
      join(skillsRoot, "private-tdd", "SKILL.md"),
      "---\nname: private-tdd\ndescription: Keep TDD work continuous while writing tests before implementation.\n---\n# private-tdd\n",
      "utf8"
    );
    await writeFile(configPath, mixedDeniedAllowedFallbacksConfig(), "utf8");
    return await run({ configPath, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withCriticalReviewOverlapFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-route-critical-overlap-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "matt-grill-me"), { recursive: true });
    await mkdir(join(skillsRoot, "team-review-work"), { recursive: true });
    await mkdir(join(skillsRoot, "product-critique"), { recursive: true });
    await writeFile(
      join(skillsRoot, "matt-grill-me", "SKILL.md"),
      "---\nname: grill-me\ndescription: Grill plans, critique assumptions, and pressure-test weak spots.\n---\n# grill-me\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "team-review-work", "SKILL.md"),
      "---\nname: review-work\ndescription: Review implementation work for correctness, QA gaps, and risks.\n---\n# review-work\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "product-critique", "SKILL.md"),
      "---\nname: product-critique\ndescription: Critique product ideas and user flows.\n---\n# product-critique\n",
      "utf8"
    );
    await writeFile(configPath, criticalReviewOverlapConfig(), "utf8");
    return await run({ configPath, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function criticalReviewOverlapConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  matt.grill-me:
    path: matt-grill-me
    status: active
    invocation: manual-only
    exposure: exported
    category: critique
  team.review-work:
    path: team-review-work
    status: active
    invocation: manual-only
    exposure: exported
    category: critique
  user.product-critique:
    path: product-critique
    status: active
    invocation: manual-only
    exposure: exported
    category: critique
capabilities:
  critical-review:
    canonical: matt.grill-me
    alternatives:
      - team.review-work
      - user.product-critique
    default_policy: manual-only
harnesses:
  codex:
    status: primary
    workflows:
      - codex-workflow
  opencode:
    status: primary
    workflows:
      - opencode-workflow
workflows:
  codex-workflow:
    harness: codex
    active_skills:
      - matt.grill-me
      - team.review-work
      - user.product-critique
    blocked_skills: []
  opencode-workflow:
    harness: opencode
    active_skills:
      - matt.grill-me
      - team.review-work
      - user.product-critique
    blocked_skills: []
install_units: {}
`;
}

async function withGuardDeniedRouteFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-route-guard-denied-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "user-test-first"), { recursive: true });
    await writeFile(
      join(skillsRoot, "user-test-first", "SKILL.md"),
      "---\nname: user-test-first\ndescription: Write tests before implementation.\n---\n# user-test-first\n",
      "utf8"
    );
    await writeFile(configPath, guardDeniedRouteConfig(), "utf8");
    return await run({ configPath, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function guardDeniedRouteConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  user.test-first:
    path: user-test-first
    status: active
    invocation: manual-only
    exposure: exported
    category: testing
capabilities:
  test-first-implementation:
    canonical: user.test-first
    alternatives: []
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
      - user.test-first
    blocked_skills:
      - user.test-first
    required_capabilities:
      test-first-implementation:
        preferred: user.test-first
        fallback: []
        policy: manual-only
install_units: {}
`;
}

async function withAmbiguousAllowedRouteFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-route-ambiguous-allowed-"));
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
    return await run({ configPath, skillsRoot });
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
`;
}

function mixedDeniedAllowedFallbacksConfig() {
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
  private.tdd-work-continuity:
    path: private-tdd
    status: active
    invocation: manual-only
    exposure: exported
    category: testing
capabilities:
  test-first-implementation:
    canonical: vendor.test-first
    alternatives:
      - user.tdd
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
      - vendor.test-first
      - user.tdd
      - private.tdd-work-continuity
    blocked_skills: []
    required_capabilities:
      test-first-implementation:
        preferred: vendor.test-first
        fallback:
          - user.tdd
          - private.tdd-work-continuity
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
`;
}
