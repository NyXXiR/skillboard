import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPolicy, loadWorkspace } from "../src/index.mjs";

const CONFIG = "examples/skillboard.config.yaml";
const SKILLS = "examples/skills";

test("policy rejects unscoped workflow-auto skills when explicit workflows are required", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  workspace.skills.push({
    id: "orphan.workflow-auto",
    path: "orphan",
    status: "active",
    invocation: "workflow-auto",
    exposure: "exported",
    category: "engineering",
    canonicalFor: [],
    conflictsWith: [],
    replacedBy: undefined,
    ownerInstallUnit: undefined
  });

  const result = checkPolicy(workspace);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Skill orphan\.workflow-auto uses workflow-auto but is not scoped to any workflow/);
});

test("policy rejects semantic drift in canonical_for and conflicts_with", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  const skill = workspace.skills.find((candidate) => candidate.id === "meerkat.requirement-intake");
  skill.canonicalFor = ["test-first-implementation"];
  skill.conflictsWith.push("missing.skill");

  const result = checkPolicy(workspace);
  const errors = result.errors.join("\n");

  assert.equal(result.ok, false);
  assert.match(errors, /Skill meerkat\.requirement-intake claims canonical_for test-first-implementation but capability canonical is matt\.tdd/);
  assert.match(errors, /Skill meerkat\.requirement-intake conflicts_with undeclared skill: missing\.skill/);
});

test("policy rejects contradictory status and invocation combinations", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  workspace.skills.find((skill) => skill.id === "matt.tdd").invocation = "blocked";
  workspace.skills.find((skill) => skill.id === "matt.grill-me").status = "deprecated";

  const result = checkPolicy(workspace);
  const errors = result.errors.join("\n");

  assert.equal(result.ok, false);
  assert.match(errors, /Active skill matt\.tdd cannot use invocation: blocked/);
  assert.match(errors, /Deprecated skill matt\.grill-me must use invocation: deprecated or blocked/);
});

test("policy rejects install units that list components they do not provide", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  const unit = workspace.installUnits.find((candidate) => candidate.id === "lazycodex.omo");
  unit.providedComponents = ["commands"];

  const result = checkPolicy(workspace);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Install unit lazycodex\.omo lists skills but does not include skills in provided_components/);
});

test("policy rejects non-callable skills in workflow active pools", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  workspace.workflows.find((workflow) => workflow.name === "codex-night-workflow").activeSkills.push("matt.grill-with-docs");

  const result = checkPolicy(workspace);
  const errors = result.errors.join("\n");

  assert.equal(result.ok, false);
  assert.match(errors, /Workflow codex-night-workflow activates non-callable skill matt\.grill-with-docs with status: quarantined/);
  assert.match(errors, /Workflow codex-night-workflow activates non-callable skill matt\.grill-with-docs with invocation: blocked/);
});

test("policy rejects non-callable preferred capability skills", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  const workflow = workspace.workflows.find((candidate) => candidate.name === "requirement-review");
  workflow.requiredCapabilities[0].preferred = "matt.grill-with-docs";

  const result = checkPolicy(workspace);
  const errors = result.errors.join("\n");

  assert.equal(result.ok, false);
  assert.match(errors, /Capability requirement requirement-clarification in workflow requirement-review prefers non-callable skill matt\.grill-with-docs with status: quarantined/);
  assert.match(errors, /Capability requirement requirement-clarification in workflow requirement-review prefers non-callable skill matt\.grill-with-docs with invocation: blocked/);
});

test("policy rejects undeclared required capability names", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  workspace.workflows[0].requiredCapabilities.push({
    name: "missing-capability",
    preferred: "matt.tdd",
    fallback: [],
    policy: "workflow-auto"
  });

  const result = checkPolicy(workspace);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Workflow codex-night-workflow references undeclared required capability: missing-capability/);
});

test("policy rejects unsupported capability policy values", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  workspace.capabilities[0].defaultPolicy = "typo-auto";
  workspace.workflows[0].requiredCapabilities[0].policy = "typo-auto";

  const result = checkPolicy(workspace);
  const errors = result.errors.join("\n");

  assert.equal(result.ok, false);
  assert.match(errors, /Capability requirement test-first-implementation in workflow codex-night-workflow has unsupported policy: typo-auto/);
  assert.match(errors, /Capability requirement-clarification has unsupported default_policy: typo-auto/);
});

test("policy rejects blocked skills in workflow capability selections", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  const workflow = workspace.workflows.find((candidate) => candidate.name === "codex-night-workflow");
  workflow.blockedSkills.push("matt.tdd");
  workflow.requiredCapabilities[0].fallback.push("matt.grill-me");
  workflow.blockedSkills.push("matt.grill-me");

  const result = checkPolicy(workspace);
  const errors = result.errors.join("\n");

  assert.equal(result.ok, false);
  assert.match(errors, /Capability requirement test-first-implementation in workflow codex-night-workflow prefers blocked skill: matt\.tdd/);
  assert.match(errors, /Capability requirement test-first-implementation in workflow codex-night-workflow lists blocked fallback skill: matt\.grill-me/);
});

test("policy rejects non-callable fallback capability skills", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  const workflow = workspace.workflows.find((candidate) => candidate.name === "requirement-review");
  workflow.requiredCapabilities[0].fallback.push("matt.grill-with-docs");

  const result = checkPolicy(workspace);
  const errors = result.errors.join("\n");

  assert.equal(result.ok, false);
  assert.match(errors, /Capability requirement requirement-clarification in workflow requirement-review lists fallback non-callable skill matt\.grill-with-docs with status: quarantined/);
  assert.match(errors, /Capability requirement requirement-clarification in workflow requirement-review lists fallback non-callable skill matt\.grill-with-docs with invocation: blocked/);
});

test("policy rejects spoofed reserved user source class", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  const unit = workspace.installUnits.find((candidate) => candidate.id === "lazycodex.omo");
  unit.sourceClass = "user";

  const result = checkPolicy(workspace);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Install unit lazycodex\.omo uses reserved source_class: user/);
});

test("policy rejects local-id remote source_class user spoofing", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  workspace.installUnits.push({
    id: "local.evil-pack",
    kind: "skill",
    sourceClass: "user",
    priority: undefined,
    trustLevel: "unreviewed",
    sourceDigest: undefined,
    signature: undefined,
    publicKey: undefined,
    verifiedAt: undefined,
    source: "github.com/evil/skills",
    scope: "project",
    manifestPath: "",
    cachePath: "",
    providedComponents: ["skills"],
    components: {
      skills: [],
      commands: [],
      hooks: [],
      mcpServers: []
    },
    modifiedConfigFiles: [],
    autoUpdate: false,
    enabled: true,
    workflowDependencies: [],
    permissionRisk: "medium",
    rollback: "unknown"
  });

  const result = checkPolicy(workspace);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Install unit local\.evil-pack uses reserved source_class: user/);
});
