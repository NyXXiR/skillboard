import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildSkillBrief } from "../src/advisor.mjs";
import { skillsForWorkflow } from "../src/advisor/skills.mjs";
import { canUseSkill, explainSkill, listSkills } from "../src/control.mjs";
import { doctorProject } from "../src/doctor.mjs";
import { impactDisable } from "../src/impact.mjs";
import { reconcileWorkspace } from "../src/reconcile.mjs";
import { routeSkill } from "../src/route.mjs";
import { variantLifecycleStatus } from "../src/control/variant-status.mjs";

test("doctor and brief fail health when v2 inventory is missing, malformed, or stale", async () => {
  for (const inventoryText of [
    null,
    "{bad-json",
    JSON.stringify({ format_version: 1, generated: true, authoritative_for_availability: false, skills: [] })
  ]) {
    const fixture = await writeV2Fixture(inventoryText);
    try {
      const doctor = await doctorProject(fixture);
      assert.equal(doctor.ok, false);
      assert.equal(doctor.strictOk, false);
      assert.equal(doctor.mode, "failed");
      assert.equal(doctor.inventory.ok, false);
      assert.match(doctor.inventory.errors.join("\n"), /inventory/i);

      const brief = await buildSkillBrief(fixture);
      assert.equal(brief.ok, false);
      assert.equal(brief.health.mode, "failed");
      assert.equal(brief.health.strict_ok, false);
      assert.equal(brief.health.inventory.ok, false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("v2 health is ready without legacy bridge files", async () => {
  const fixture = await writeV2Fixture(JSON.stringify({
    format_version: 1, generated: true, authoritative_for_availability: false,
    skills: [{ id: "demo", path: "demo", owner_install_unit: "local" }]
  }));
  try {
    await rm(join(fixture.root, "AGENTS.md"));
    const doctor = await doctorProject(fixture);
    const brief = await buildSkillBrief(fixture);
    assert.equal(doctor.ok, true);
    assert.equal(doctor.strictOk, true);
    assert.equal(brief.ok, true);
    assert.equal(brief.health.strict_ok, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("v2 doctor keeps source observations out of authorization recommendations", async () => {
  const fixture = await writeV2Fixture(JSON.stringify({
    format_version: 1,
    generated: true,
    authoritative_for_availability: false,
    skills: [{ id: "demo", path: "demo", owner_install_unit: "external.runtime" }],
    install_units: [{
      id: "external.runtime",
      kind: "plugin",
      source_class: "external",
      source: "https://example.invalid/plugin",
      trust_observation: "unreviewed",
      risk_observation: "high",
      skills: ["demo"],
      runtime_components: { hooks: ["hook.sh"] }
    }]
  }));
  try {
    const doctor = await doctorProject(fixture);
    assert.equal(doctor.ok, true);
    assert.equal(doctor.reviewRequired, false);
    assert.doesNotMatch(
      doctor.recommendations.join("\n"),
      /automatic invocation|quarantin|activation|trusting runtime/i
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("v2 ignores legacy workflow selection and groups by enabled policy", () => {
  const groups = skillsForWorkflow(v2Workspace(), "other", { units: [] }, "codex");
  assert.deepEqual(groups.automatic_allowed.map(({ id }) => id), ["scoped"]);
  assert.deepEqual(groups.not_in_workflow, []);
  assert.deepEqual(groups.blocked.map(({ id }) => id), ["disabled"]);
});

test("v2 guard and route ignore legacy workflow arguments", () => {
  const workspace = v2Workspace();
  const guard = canUseSkill(workspace, "disabled", "missing", "codex");
  assert.equal(guard.allowed, false);
  assert.equal(guard.workflowKnown, true);
  assert.deepEqual(guard.reasons, ["Skill disabled is disabled."]);
  assert.equal(routeSkill(workspace, { intent: "tests", workflow: "missing", agent: "codex" }).recommended_skill, "scoped");
});

test("v2 list and explain expose policy plus real inventory observations only", () => {
  const workspace = v2Workspace();
  const listed = listSkills(workspace);
  const scoped = listed.find(({ id }) => id === "scoped");
  assert.deepEqual(scoped, {
    id: "scoped",
    enabled: true,
    shared: false,
    preference: { intents: ["tests"], priority: 5 },
    path: "real/scoped",
    variant: null,
    inventory: {
      present: true,
      path: "real/scoped",
      owner_install_unit: "plugin.example",
      source: "https://example.invalid/repo",
      category: "testing",
      description: "Run focused tests",
      content_digest: "sha256:observed",
      installed_on: ["codex"],
      aliases: [],
      observations: {}
    }
  });
  assert.doesNotMatch(JSON.stringify(scoped), /status|invocation|exposure|trust/i);

  const explained = explainSkill(workspace, "scoped");
  assert.ok("inventory" in explained);
  assert.deepEqual(explained.agents, ["codex"]);
  assert.deepEqual(explained.inventory, scoped.inventory);
  assert.doesNotMatch(JSON.stringify(explained), /status|invocation|exposure|trust|capabilities/i);
});

test("v2 reconcile recommends enabled local policy for inventory-only skills", () => {
  const workspace = v2Workspace({
    installedSkills: [{ id: "new.skill", path: "new/skill", name: "New", description: "New skill" }],
    inventory: {
      integrityErrors: [],
      skillIds: ["scoped", "disabled", "new.skill"],
      skills: [{ id: "new.skill", path: "new/skill", owner_install_unit: "plugin.example" }]
    }
  });
  const plan = reconcileWorkspace(workspace);
  assert.deepEqual(plan.skillChanges, [{
    type: "new-skill",
    skillId: "new.skill",
    recommendedEnabled: true,
    recommendedShared: false
  }]);
  assert.deepEqual(plan.autoActions, [{
    action: "enable-skill-local",
    skillId: "new.skill",
    enabled: true,
    shared: false
  }]);
  assert.deepEqual(plan.decisionsRequired, []);
  assert.doesNotMatch(JSON.stringify(plan), /quarantin|blocked|invocation/i);
});

test("v2 impact reports enabled and observed-agent effects without workflow fields", () => {
  const global = impactDisable(v2Workspace({
    skills: [{ id: "global", enabled: true, shared: true, preference: null }],
    inventory: { integrityErrors: [], skillIds: ["global"], skills: [{ id: "global", installed_on: ["codex", "hermes"] }] }
  }), "global");
  assert.deepEqual(global.affectedWorkflows, []);
  assert.deepEqual(global.affectedAgents, ["codex", "hermes"]);
  assert.deepEqual(global.policyBefore, { enabled: true, shared: true });
  assert.deepEqual(global.policyAfter, { enabled: false, shared: true });
  assert.equal(global.risk, "medium");

  const scoped = impactDisable(v2Workspace(), "scoped");
  assert.deepEqual(scoped.affectedAgents, ["codex"]);
  assert.deepEqual(scoped.policyAfter, { enabled: false, shared: false });
});

test("v2 preference priority applies only when one of its intents matches", () => {
  const workspace = v2Workspace({
    installedSkills: [
      { id: "preferred", path: "preferred", name: "Writer", description: "Write documents" },
      { id: "matched", path: "matched", name: "Tester", description: "Run tests" }
    ],
    inventory: {
      integrityErrors: [], skillIds: ["preferred", "matched"],
      skills: [{ id: "preferred", installed_on: ["codex"] }, { id: "matched", installed_on: ["codex"] }]
    },
    skills: [
      { id: "preferred", enabled: true, shared: false, preference: { intents: ["deploy"], priority: 999 } },
      { id: "matched", enabled: true, shared: false, preference: null }
    ]
  });
  assert.equal(routeSkill(workspace, { intent: "write and run tests", agent: "codex" }).recommended_skill, "matched");
});

test("v2 preference matching rejects empty normalization and substring collisions", () => {
  const workspace = v2Workspace({
    installedSkills: [
      { id: "go", path: "go", name: "Database", description: "Manage data" },
      { id: "matched", path: "matched", name: "Tester", description: "Run tests" }
    ],
    inventory: {
      integrityErrors: [], skillIds: ["go", "matched"],
      skills: [{ id: "go", installed_on: ["codex"] }, { id: "matched", installed_on: ["codex"] }]
    },
    skills: [
      { id: "go", enabled: true, shared: false, preference: { intents: ["a"], priority: 999 } },
      { id: "matched", enabled: true, shared: false, preference: null }
    ]
  });
  assert.equal(routeSkill(workspace, { intent: "run mongodb tests", agent: "codex" }).recommended_skill, "matched");
});

test("v2 variant status reads historical lifecycle observation without policy mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-variant-status-"));
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  const digest = `sha256:${"a".repeat(64)}`;
  try {
    await mkdir(join(root, ".skillboard"));
    await mkdir(skillsRoot);
    await writeFile(configPath, "version: 2\nskills:\n  demo.variant:\n    enabled: true\n    shared: false\n");
    await writeFile(join(root, ".skillboard", "inventory.json"), JSON.stringify({
      format_version: 1, generated: true, authoritative_for_availability: false,
      skills: [{
        id: "demo.variant", path: "demo/variant", owner_install_unit: "migration.unowned",
        observations: {
          variant: {
            of: "demo.base", adapted_for: "review", capability: "review", workflow: "daily", status: "draft",
            base: { content_digest: digest, snapshot: ".skillboard/variant-snapshots/demo.variant/base.md" }
          }
        }
      }]
    }));
    const status = await variantLifecycleStatus({ configPath, skillsRoot, variantId: "demo.variant" });
    assert.equal(status.computedStatus, "missing-live-file");
    assert.equal(status.baseDigest, digest);
    assert.match(status.warnings.join("\n"), /base snapshot missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function v2Workspace(overrides = {}) {
  const observations = [
    {
      id: "scoped", path: "real/scoped", owner_install_unit: "plugin.example",
      source: "https://example.invalid/repo", category: "testing",
      description: "Run focused tests", content_digest: "sha256:observed",
      aliases: [], installed_on: ["codex"]
    },
    { id: "disabled", path: "real/disabled", owner_install_unit: "plugin.example", aliases: [] }
  ];
  return {
    version: 2,
    compatibility: null,
    defaults: {}, capabilities: [], harnesses: [], installUnits: [], installedSkills: [],
    workflows: [],
    skills: [
      { id: "scoped", enabled: true, shared: false, preference: { intents: ["tests"], priority: 5 } },
      { id: "disabled", enabled: false, shared: false, preference: null }
    ],
    inventory: { path: "/project/.skillboard/inventory.json", integrityErrors: [], skillIds: ["scoped", "disabled"], skills: observations },
    ...overrides
  };
}

async function writeV2Fixture(inventoryText) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-health-"));
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  await mkdir(skillsRoot);
  await writeFile(join(root, "AGENTS.md"), "<!-- BEGIN SKILLBOARD -->\nmanaged\n<!-- END SKILLBOARD -->\n");
  await writeFile(configPath, "version: 2\nskills:\n  demo:\n    enabled: true\n    shared: false\n");
  if (inventoryText !== null) {
    await mkdir(join(root, ".skillboard"));
    await writeFile(join(root, ".skillboard", "inventory.json"), inventoryText);
  }
  return { root, configPath, skillsRoot };
}
