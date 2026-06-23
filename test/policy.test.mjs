import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPolicy, loadWorkspace } from "../src/index.mjs";
import { withFixture } from "./fixtures.mjs";

test("policy check rejects workflow references to undeclared skills", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    workspace.workflows[0].activeSkills.push("missing.skill");
    const result = checkPolicy(workspace);

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /missing\.skill/);
  });
});

test("policy check rejects undeclared capability, harness, and install-unit workflow references", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    workspace.capabilities[0].alternatives.push("missing.skill");
    workspace.workflows[0].requiredCapabilities[0].fallback.push("missing.fallback");
    workspace.workflows[0].harness = "missing-harness";
    workspace.harnesses[0].workflows.push("missing-workflow");
    workspace.installUnits.push({
      id: "bad.bundle",
      kind: "plugin",
      source: "test",
      scope: "project",
      manifestPath: "",
      cachePath: "",
      providedComponents: [],
      components: {
        skills: [],
        commands: [],
        hooks: [],
        mcpServers: []
      },
      modifiedConfigFiles: [],
      autoUpdate: false,
      enabled: true,
      workflowDependencies: ["missing-workflow"],
      permissionRisk: "low",
      rollback: "automatic"
    });
    const result = checkPolicy(workspace);
    const errors = result.errors.join("\n");

    assert.equal(result.ok, false);
    assert.match(
      errors,
      /Capability requirement test-first-implementation in workflow codex-night-workflow references undeclared fallback skill: missing\.fallback/
    );
    assert.match(
      errors,
      /Capability requirement requirement-clarification references undeclared alternative skill: missing\.skill/
    );
    assert.match(errors, /Workflow codex-night-workflow references undeclared harness: missing-harness/);
    assert.match(errors, /Harness codex references undeclared workflow: missing-workflow/);
    assert.match(errors, /Install unit bad\.bundle references undeclared workflow dependency: missing-workflow/);
  });
});

test("policy allows global invocation only for explicitly global meta skills", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    workspace.skills.push({
      id: "matt.grill-with-docs",
      path: "grill-with-docs",
      status: "quarantined",
      invocation: "blocked",
      exposure: "exported",
      category: "requirements",
      canonicalFor: [],
      conflictsWith: [],
      replacedBy: "meerkat.requirement-intake"
    });
    workspace.skills.push({
      id: "meerkat.test-first-implementation",
      path: "vendor/meerkat-test-first-implementation",
      status: "candidate",
      invocation: "workflow-auto",
      exposure: "exported",
      category: "engineering",
      canonicalFor: [],
      conflictsWith: [],
      replacedBy: undefined
    });
    workspace.workflows.push({
      name: "large-refactor-workflow",
      harness: "lazycodex",
      activeSkills: [],
      blockedSkills: [],
      requiredOutputs: [],
      requiredCapabilities: []
    });
    workspace.skills.push({
      id: "user.workflow-router",
      path: "user/workflow-router",
      status: "active",
      invocation: "global-auto",
      exposure: "global-meta",
      category: "meta",
      canonicalFor: [],
      conflictsWith: [],
      replacedBy: undefined
    });
    workspace.skills[0].invocation = "global-auto";
    const result = checkPolicy(workspace);
    const errors = result.errors.join("\n");

    assert.equal(result.ok, false);
    assert.match(errors, /Skill meerkat\.requirement-intake uses global-auto but is not exposure: global-meta/);
    assert.doesNotMatch(errors, /user\.workflow-router/);
  });
});

test("policy rejects install-unit component ownership drift", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    workspace.skills.push({
      id: "matt.grill-with-docs",
      path: "grill-with-docs",
      status: "quarantined",
      invocation: "blocked",
      exposure: "exported",
      category: "requirements",
      canonicalFor: [],
      conflictsWith: [],
      replacedBy: "meerkat.requirement-intake"
    });
    workspace.skills.push({
      id: "meerkat.test-first-implementation",
      path: "vendor/meerkat-test-first-implementation",
      status: "candidate",
      invocation: "workflow-auto",
      exposure: "exported",
      category: "engineering",
      canonicalFor: [],
      conflictsWith: [],
      replacedBy: undefined
    });
    workspace.workflows.push({
      name: "large-refactor-workflow",
      harness: "lazycodex",
      activeSkills: [],
      blockedSkills: [],
      requiredOutputs: [],
      requiredCapabilities: []
    });
    workspace.installUnits.push({
      id: "github.mattpocock.skills",
      kind: "marketplace",
      source: "npx skills@latest add mattpocock/skills",
      scope: "user-global",
      manifestPath: "",
      cachePath: "",
      providedComponents: ["skills"],
      components: {
        skills: ["matt.tdd", "missing.vendor-skill"],
        commands: [],
        hooks: [],
        mcpServers: []
      },
      modifiedConfigFiles: [],
      autoUpdate: false,
      enabled: true,
      workflowDependencies: [],
      permissionRisk: "medium",
      rollback: "reinstall"
    });
    workspace.skills.find((skill) => skill.id === "matt.tdd").ownerInstallUnit = "other.bundle";
    workspace.skills.find((skill) => skill.id === "matt.grill-me").exposure = "unit-managed";

    const result = checkPolicy(workspace);
    const errors = result.errors.join("\n");

    assert.equal(result.ok, false);
    assert.match(errors, /Install unit github\.mattpocock\.skills declares undeclared component skill: missing\.vendor-skill/);
    assert.match(errors, /Install unit github\.mattpocock\.skills declares component skill matt\.tdd owned by other\.bundle/);
    assert.match(errors, /Skill matt\.grill-me is unit-managed but does not declare owner_install_unit/);
  });
});
