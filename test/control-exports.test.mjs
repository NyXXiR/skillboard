import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";

const EXPECTED_EXPORTS = [
  "activateSkill",
  "addHarness",
  "addSkill",
  "addSkillVariant",
  "addWorkflow",
  "approveSkillVariant",
  "auditSources",
  "blockSkill",
  "canUseSkill",
  "classifySkillSource",
  "classifySkillTrust",
  "explainSkill",
  "forkSkillVariant",
  "installGuardHook",
  "listHarnesses",
  "listInstallUnits",
  "listSkills",
  "listWorkflows",
  "planGuardHookInstall",
  "preferSkill",
  "quarantineSkill",
  "removeSkill",
  "resetSkillVariant",
  "variantLifecycleStatus"
];

test("control.mjs exports the expected public API", async () => {
  const control = await import("../src/control.mjs");

  for (const name of EXPECTED_EXPORTS) {
    assert.ok(name in control, `Expected export ${name} is missing`);
    assert.equal(typeof control[name], "function", `Export ${name} should be a function`);
  }
});

test("index.mjs exports the expected control-derived public API", async () => {
  const index = await import("../src/index.mjs");
  const expected = [
    "activateSkill",
    "addHarness",
    "addSkill",
    "addSkillVariant",
    "addWorkflow",
    "approveSkillVariant",
    "auditSources",
    "blockSkill",
    "canUseSkill",
    "explainSkill",
    "forkSkillVariant",
    "installGuardHook",
    "listHarnesses",
    "listInstallUnits",
    "listSkills",
    "listWorkflows",
    "preferSkill",
    "quarantineSkill",
    "removeSkill",
    "resetSkillVariant",
    "variantLifecycleStatus"
  ];

  for (const name of expected) {
    assert.ok(name in index, `Expected index export ${name} is missing`);
  }
});

test("addSkillVariant creates a workflow preferred variant", async () => {
  const { root, configPath, skillsRoot } = await writeVariantFixture();
  try {
    const { addSkillVariant } = await import("../src/control.mjs");
    const before = await readFile(configPath, "utf8");

    const result = await addSkillVariant({
      configPath,
      skillsRoot,
      variantId: "claude.review",
      baseId: "base.review",
      capability: "task-review",
      workflow: "claude-workflow",
      path: "claude/review",
      dryRun: true
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.changed, true);
    assert.equal(result.policy.ok, true);
    assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal(result.plan.semanticAvailable, true);
    const semanticPaths = result.plan.semanticChanges.map((change) => change.path);
    assert.ok(semanticPaths.includes("/skills/claude.review"));
    assert.ok(semanticPaths.includes("/capabilities/task-review/alternatives/base.review"));
    assert.ok(semanticPaths.includes("/capabilities/task-review/alternatives/claude.review"));
    assert.ok(semanticPaths.includes("/workflows/claude-workflow/required_capabilities/task-review/preferred"));

    await addSkillVariant({
      configPath,
      skillsRoot,
      variantId: "claude.review",
      baseId: "base.review",
      capability: "task-review",
      workflow: "claude-workflow",
      path: "claude/review"
    });

    const config = YAML.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(config.skills["claude.review"], {
      path: "claude/review",
      status: "active",
      invocation: "workflow-auto",
      exposure: "exported",
      category: "core"
    });
    assert.deepEqual(config.capabilities["task-review"].alternatives, ["base.review", "claude.review"]);
    assert.equal(config.workflows["claude-workflow"].required_capabilities["task-review"].preferred, "claude.review");
    assert.deepEqual(
      config.workflows["claude-workflow"].required_capabilities["task-review"].fallback,
      ["old.review", "base.review", "canonical.review", "extra.review"]
    );
    assert.deepEqual(config.workflows["claude-workflow"].active_skills, ["claude.review"]);
    assert.deepEqual(config.workflows["claude-workflow"].blocked_skills, []);
    assert.equal(config.skills["base.review"].replaced_by, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("addSkillVariant preserves declared variant skill fields", async () => {
  const { root, configPath, skillsRoot } = await writeVariantFixture({
    variantSkill: `
  claude.review:
    path: declared/claude-review
    status: candidate
    invocation: router-only
    exposure: private
    category: declared-category
    owner_install_unit: local.variant
`,
    installUnits: `
install_units:
  local.variant:
    kind: skill
    source_class: local
    trust_level: trusted
    enabled: true
    provided_components:
      - skills
    components:
      skills:
        - claude.review
`
  });
  try {
    const { addSkillVariant } = await import("../src/control.mjs");

    await addSkillVariant({
      configPath,
      skillsRoot,
      variantId: "claude.review",
      baseId: "base.review",
      capability: "task-review",
      workflow: "claude-workflow",
      path: "ignored/path",
      category: "ignored-category",
      ownerInstallUnit: "ignored.owner"
    });

    const config = YAML.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(config.skills["claude.review"], {
      path: "declared/claude-review",
      status: "candidate",
      invocation: "router-only",
      exposure: "private",
      category: "declared-category",
      owner_install_unit: "local.variant"
    });
    assert.equal(config.workflows["claude-workflow"].required_capabilities["task-review"].preferred, "claude.review");
    assert.deepEqual(config.capabilities["task-review"].alternatives, ["base.review", "claude.review"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("addSkillVariant derives new variant invocation from capability policy", async () => {
  const routerFixture = await writeVariantFixture({
    requiredCapabilities: "    required_capabilities: {}\n"
  });
  try {
    const { addSkillVariant } = await import("../src/control.mjs");

    await addSkillVariant({
      configPath: routerFixture.configPath,
      skillsRoot: routerFixture.skillsRoot,
      variantId: "claude.review",
      baseId: "base.review",
      capability: "task-review",
      workflow: "claude-workflow",
      path: "claude/review"
    });

    const config = YAML.parse(await readFile(routerFixture.configPath, "utf8"));
    assert.equal(config.skills["claude.review"].invocation, "router-only");
  } finally {
    await rm(routerFixture.root, { recursive: true, force: true });
  }

  const globalFixture = await writeVariantFixture({
    capabilityDefaultPolicy: "global-auto",
    requiredCapabilities: "    required_capabilities: {}\n"
  });
  try {
    const { addSkillVariant } = await import("../src/control.mjs");

    await addSkillVariant({
      configPath: globalFixture.configPath,
      skillsRoot: globalFixture.skillsRoot,
      variantId: "claude.review",
      baseId: "base.review",
      capability: "task-review",
      workflow: "claude-workflow",
      path: "claude/review"
    });

    const config = YAML.parse(await readFile(globalFixture.configPath, "utf8"));
    assert.equal(config.skills["claude.review"].invocation, "manual-only");
  } finally {
    await rm(globalFixture.root, { recursive: true, force: true });
  }
});

test("addSkillVariant requires path for undeclared variants", async () => {
  const { root, configPath, skillsRoot } = await writeVariantFixture();
  try {
    const { addSkillVariant } = await import("../src/control.mjs");
    const before = await readFile(configPath, "utf8");

    await assert.rejects(
      addSkillVariant({
        configPath,
        skillsRoot,
        variantId: "claude.review",
        baseId: "base.review",
        capability: "task-review",
        workflow: "claude-workflow"
      }),
      /--path is required/
    );
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeVariantFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-control-variant-test-"));
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  await writeFile(configPath, variantConfig(options), "utf8");
  return { root, configPath, skillsRoot };
}

function variantConfig(options) {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
skills:
  base.review:
    path: base/review
    status: active
    invocation: workflow-auto
    exposure: exported
    category: core
  canonical.review:
    path: canonical/review
    status: active
    invocation: manual-only
    exposure: exported
    category: core
  old.review:
    path: old/review
    status: active
    invocation: manual-only
    exposure: exported
    category: core
  extra.review:
    path: extra/review
    status: active
    invocation: manual-only
    exposure: exported
    category: core
${options.variantSkill ?? ""}capabilities:
  task-review:
    canonical: canonical.review
    alternatives: []
    default_policy: ${options.capabilityDefaultPolicy ?? "router-only"}
harnesses:
  claude:
    status: available
workflows:
  claude-workflow:
    harness: claude
    active_skills: []
    blocked_skills:
      - claude.review
${options.requiredCapabilities ?? `    required_capabilities:
      task-review:
        preferred: old.review
        fallback:
          - base.review
          - claude.review
          - canonical.review
          - old.review
          - extra.review
        policy: workflow-auto
`}
${options.installUnits ?? ""}`;
}
