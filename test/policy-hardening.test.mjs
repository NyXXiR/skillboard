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
