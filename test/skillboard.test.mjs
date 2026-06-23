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

test("agent inventory accepts injected detector registry entries", async () => {
  const { mkdir, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { discoverAgentSkillInventory } = await import("../src/index.mjs");
  const root = await mkdtemp(join(tmpdir(), "skillboard-detector-registry-test-"));
  try {
    const sourceRoot = join(root, "custom-source");
    await mkdir(sourceRoot, { recursive: true });
    const inventory = await discoverAgentSkillInventory({
      env: { SKILLBOARD_INIT_SCAN_ROOTS: "" },
      home: root,
      roots: [sourceRoot],
      detectors: [
        {
          id: "test-runtime-detector",
          matches(path) {
            return path === sourceRoot;
          },
          async discover(path) {
            return [{
              unit: {
                id: "test.runtime",
                kind: "mcp-server",
                trustLevel: "unreviewed",
                source: path,
                scope: "project",
                category: "runtime",
                commands: [],
                hooks: [],
                mcpServers: ["test-mcp"],
                modifiedConfigFiles: [],
                permissionRisk: "high"
              },
              root: path,
              files: []
            }];
          }
        }
      ]
    });

    assert.deepEqual(inventory.installUnits.map((unit) => unit.id), ["test.runtime"]);
    assert.deepEqual(inventory.installUnits[0].mcpServers, ["test-mcp"]);
    assert.deepEqual(inventory.skills, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent inventory isolates detector and skill parse failures as warnings", async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { discoverAgentSkillInventory } = await import("../src/index.mjs");
  const root = await mkdtemp(join(tmpdir(), "skillboard-detector-warning-test-"));
  try {
    const throwingRoot = join(root, "throwing-source");
    await mkdir(throwingRoot, { recursive: true });
    const throwingInventory = await discoverAgentSkillInventory({
      env: { SKILLBOARD_INIT_SCAN_ROOTS: "" },
      home: root,
      roots: [throwingRoot],
      detectors: [
        {
          id: "throwing-detector",
          matches() {
            return true;
          },
          async discover() {
            throw new Error("detector unavailable");
          }
        }
      ]
    });

    assert.deepEqual(throwingInventory.skills, []);
    assert.match(throwingInventory.warnings.join("\n"), /throwing-detector failed while scanning/);

    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "bad"), { recursive: true });
    await writeFile(join(skillsRoot, "bad", "SKILL.md"), "# missing frontmatter\n", "utf8");
    await mkdir(join(skillsRoot, "good"), { recursive: true });
    await writeFile(join(skillsRoot, "good", "SKILL.md"), "---\nname: good\n---\n# Good\n", "utf8");
    const parsedInventory = await discoverAgentSkillInventory({
      env: { SKILLBOARD_INIT_SCAN_ROOTS: "" },
      home: root,
      roots: [skillsRoot]
    });

    assert.deepEqual(parsedInventory.skills.map((skill) => skill.id), ["good"]);
    assert.match(parsedInventory.warnings.join("\n"), /bad\/SKILL\.md skipped/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
