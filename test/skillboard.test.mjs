import assert from "node:assert/strict";
import { test } from "node:test";
import {
  impactDisable,
  loadWorkspace,
  reconcileWorkspace,
  renderDashboard
} from "../src/index.mjs";
import { withFixture } from "./fixtures.mjs";

test("dashboard shows workflow-scoped active and blocked skills", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const markdown = renderDashboard(workspace);

    assert.match(markdown, /codex-night-workflow/);
    assert.match(markdown, /workflow-auto/);
    assert.match(markdown, /blocked/i);
    assert.match(markdown, /required outputs:/);
    assert.match(markdown, /test_result_or_reason/);
  });
});

test("impact disable reports affected workflows and replacement", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const impact = impactDisable(workspace, "matt.tdd");

    assert.deepEqual(impact.affectedWorkflows, ["codex-night-workflow"]);
    assert.deepEqual(impact.affectedOutputs, ["test_result_or_reason"]);
  });
});

test("scan records installed skill metadata from SKILL.md", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });

    assert.deepEqual(workspace.installedSkills, [
      {
        description: "Requirement clarification with durable docs updates.",
        id: "matt.grill-with-docs",
        name: "matt.grill-with-docs",
        path: "grill-with-docs"
      },
      {
        description: "Test-first implementation discipline.",
        id: "matt.tdd",
        name: "tdd",
        path: "tdd"
      }
    ]);
  });
});

test("reconcile quarantines newly discovered skills and maps known capabilities", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    workspace.skills = workspace.skills.filter((skill) => skill.id !== "matt.grill-with-docs");
    const plan = reconcileWorkspace(workspace, { actualHarnesses: ["codex", "lazycodex"] });

    assert.deepEqual(plan.autoActions, [
      {
        action: "quarantine-skill",
        skillId: "matt.grill-with-docs",
        capability: "requirement-clarification",
        recommendedStatus: "quarantined",
        recommendedInvocation: "router-only"
      }
    ]);
    assert.match(plan.decisionsRequired.join("\n"), /matt\.grill-with-docs/);
  });
});

test("scan accepts CRLF skill frontmatter", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(
      join(skillsRoot, "tdd", "SKILL.md"),
      "---\r\nname: tdd\r\ndescription: CRLF frontmatter works.\r\n---\r\n# TDD\r\n",
      "utf8"
    );
    const workspace = await loadWorkspace({ configPath, skillsRoot });

    assert.equal(workspace.installedSkills.find((skill) => skill.path === "tdd").description, "CRLF frontmatter works.");
  });
});

test("reconcile reports removed harnesses with affected workflows and migration hints", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const plan = reconcileWorkspace(workspace, { actualHarnesses: ["codex"] });

    assert.deepEqual(plan.harnessChanges, [
      {
        type: "removed-harness",
        harness: "lazycodex",
        affectedWorkflows: ["large-refactor-workflow"],
        missingCommands: ["$ulw-plan", "$start-work"],
        recommendations: [
          "assign a fallback harness before applying workflow changes",
          "replace missing commands with capability-backed workflow steps"
        ]
      }
    ]);
  });
});

test("reconcile disables newly detected harnesses until a workflow opts in", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const plan = reconcileWorkspace(workspace, { actualHarnesses: ["codex", "lazycodex", "opencode"] });

    assert.deepEqual(plan.autoActions.at(-1), {
      action: "disable-harness",
      harness: "opencode",
      recommendedStatus: "disabled"
    });
  });
});

test("reconcile warns when actual harness inventory is omitted", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const plan = reconcileWorkspace(workspace);

    assert.deepEqual(plan.warnings, [
      "Actual harness inventory was not provided; harness reconciliation skipped."
    ]);
  });
});

test("impact disable uses capability alternatives, not only replaced_by", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const impact = impactDisable(workspace, "matt.tdd");

    assert.deepEqual(impact.alternatives, ["meerkat.test-first-implementation"]);
    assert.equal(impact.risk, "medium");
  });
});
