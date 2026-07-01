import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preferSkill } from "../src/index.mjs";
import { routeSkill } from "../src/route.mjs";
import { loadWorkspace } from "../src/workspace.mjs";
import { displayCommand } from "./helpers/expected-command.mjs";

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

    const result = await preferSkill({
      skillId: suggestion.suggested_policy.skill,
      workflow: suggestion.suggested_policy.workflow,
      capability: suggestion.suggested_policy.capability,
      configPath,
      skillsRoot
    });

    assert.equal(result.changed, true);
    assert.equal(result.dryRun, false);
    assert.match(result.message, /Preferred user\.tdd/);

    const afterWorkspace = await loadWorkspace({ configPath, skillsRoot });
    const after = routeSkill(afterWorkspace, {
      intent: "write tests before implementation",
      workflow: "daily-workflow",
      configPath,
      skillsRoot
    });

    assert.equal(after.recommended_skill, "user.tdd");
    assert.deepEqual(after.route_candidates.map((candidate) => ({
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
        skill: "vendor.test-first",
        role: "fallback",
        selected: false,
        guard_allowed: false
      }
    ]);
    assert.equal(after.post_use_policy_suggestion, null);
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
