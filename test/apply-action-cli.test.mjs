// allow: SIZE_OK - apply-action CLI test split is deferred from the 0.2.7 release gate.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withActionsFixture, withReviewedBlockedFixture } from "./helpers/advisor-brief-actions.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const skillboardBin = join(repoRoot, "bin/skillboard.mjs");

test("apply-action dry-run previews the selected current action without mutating config", async () => {
  await withActionsFixture(async (paths) => {
    const originalConfig = await readFile(paths.configPath, "utf8");
    const result = await runSkillboard([
      "apply-action",
      "trust-install-unit:safe.pack",
      ...workflowArgs(paths),
      "--dry-run",
      "--json"
    ]);
    const afterConfig = await readFile(paths.configPath, "utf8");

    assert.equal(afterConfig, originalConfig);
    assert.equal(result.exitCode, 0, commandFailure(result));

    const payload = parseJson(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.mode, "preview");
    assert.equal(payload.changed, false);
    assert.equal(payload.action.id, "trust-install-unit:safe.pack");
    assert.equal(payload.action.kind, "trust-install-unit");
    assert.equal(payload.action.applies_to.id, "safe.pack");
    assert.equal(payload.action.risk, "low");
    assert.equal(payload.action.apply.argv[0], "skillboard");
  });
});

test("apply-action --yes --json refuses v1 review action without mutation", async () => {
  await withActionsFixture(async (paths) => {
    const originalConfig = await readFile(paths.configPath, "utf8");
    const result = await runSkillboard([
      "apply-action",
      "review-install-unit:medium.pack",
      ...workflowArgs(paths),
      "--yes",
      "--json"
    ]);

    assert.notEqual(result.exitCode, 0);
    const payload = parseJson(result);
    assertStructuredError(payload, "migration-required", /^Version 1 policy is read-only\. Run `skillboard migrate v2`\.$/);
    assert.equal(await readFile(paths.configPath, "utf8"), originalConfig);
  });
});

test("apply-action text mode refuses v1 mutation without changing bytes", async () => {
  await withActionsFixture(async (paths) => {
    const before = await readFile(paths.configPath, "utf8");
    const result = await runSkillboard([
      "apply-action",
      "review-install-unit:medium.pack",
      ...workflowArgs(paths),
      "--yes"
    ]);

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stderr.trim(), "Version 1 policy is read-only. Run `skillboard migrate v2`.");
    assert.equal(await readFile(paths.configPath, "utf8"), before);
  });
});

test("apply-action refuses a v1 action id with structured JSON and no mutation", async () => {
  await withActionsFixture(async (paths) => {
    const configAfterManualReview = await readFile(paths.configPath, "utf8");
    const result = await runSkillboard([
      "apply-action",
      "review-install-unit:medium.pack",
      ...workflowArgs(paths),
      "--yes",
      "--json"
    ]);
    const afterConfig = await readFile(paths.configPath, "utf8");

    assert.equal(afterConfig, configAfterManualReview);
    assert.notEqual(result.exitCode, 0);

    const payload = parseJson(result);
    assertStructuredError(payload, "migration-required", /^Version 1 policy is read-only\. Run `skillboard migrate v2`\.$/);
  });
});

test("apply-action without --yes previews medium-risk action and leaves config unchanged", async () => {
  await withActionsFixture(async (paths) => {
    const originalConfig = await readFile(paths.configPath, "utf8");
    const result = await runSkillboard([
      "apply-action",
      "review-install-unit:medium.pack",
      ...workflowArgs(paths),
      "--json"
    ]);
    const afterConfig = await readFile(paths.configPath, "utf8");

    assert.equal(afterConfig, originalConfig);
    assert.equal(result.exitCode, 0, commandFailure(result));

    const payload = parseJson(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.mode, "preview");
    assert.equal(payload.changed, false);
    assert.equal(payload.action.id, "review-install-unit:medium.pack");
    assert.equal(payload.action.kind, "review-install-unit");
  });
});

test("apply-action destructive reset requires both --yes and --allow-destructive", async () => {
  await assertDestructiveResetRejected(
    ["--yes", "--json"],
    "migration-required",
    /^Version 1 policy is read-only\. Run `skillboard migrate v2`\.$/
  );
});

test("apply-action destructive reset refuses v1 and preserves project state", async () => {
  await withActionsFixture(async (paths) => {
    await mkdir(join(paths.root, "skills", "local-helper"), { recursive: true });
    await writeFile(
      join(paths.root, "skills", "local-helper", "SKILL.md"),
      "---\nname: local-helper\ndescription: Apply cleanup fixture.\n---\n# Local helper\n",
      "utf8"
    );
    await mkdir(join(paths.root, ".skillboard", "sources", "example"), { recursive: true });
    await mkdir(join(paths.root, ".skillboard", "rollouts", "txn-1"), { recursive: true });
    await mkdir(join(paths.root, ".skillboard", "variant-snapshots"), { recursive: true });
    await writeFile(join(paths.root, ".skillboard", "sources", "example", "cache.txt"), "cache\n", "utf8");
    await writeFile(join(paths.root, ".skillboard", "rollouts", "txn-1", "plan.json"), "{}\n", "utf8");
    await writeFile(join(paths.root, ".skillboard", "variant-snapshots", "snapshot.md"), "snapshot\n", "utf8");
    await writeFile(join(paths.root, ".skillboard", "profiles", "custom.yaml"), "id: custom\n", "utf8");

    const result = await runSkillboard([
      "apply-action",
      `reset-cleanup:${paths.root}`,
      ...workflowArgs(paths),
      "--yes",
      "--allow-destructive",
      "--json"
    ]);

    assert.notEqual(result.exitCode, 0);
    const payload = parseJson(result);
    assertStructuredError(payload, "migration-required", /^Version 1 policy is read-only\. Run `skillboard migrate v2`\.$/);
    assert.equal(await pathExists(join(paths.root, "skillboard.config.yaml")), true);
    assert.equal(await pathExists(join(paths.root, ".skillboard")), true);
    assert.equal(await pathExists(join(paths.root, "skills", "local-helper", "SKILL.md")), true);
  });
});

test("apply-action refuses v1 before resolving workflow actions", async () => {
  await assertWorkflowActionRejected([], /^Version 1 policy is read-only\. Run `skillboard migrate v2`\.$/);
  await assertWorkflowActionRejected(["--workflow", "missing-workflow"], /^Version 1 policy is read-only\. Run `skillboard migrate v2`\.$/);
});

test("apply-action cannot activate a reviewed blocked runtime skill", async () => {
  await withReviewedBlockedFixture(async (paths) => {
    const originalConfig = await readFile(paths.configPath, "utf8");
    const result = await runSkillboard([
      "apply-action",
      "activate-skill:omo:blocked",
      ...workflowArgs(paths),
      "--yes",
      "--json"
    ]);
    const afterConfig = await readFile(paths.configPath, "utf8");

    assert.equal(afterConfig, originalConfig);
    assert.notEqual(result.exitCode, 0);
    const payload = parseJson(result);
    assertStructuredError(payload, "migration-required", /^Version 1 policy is read-only\. Run `skillboard migrate v2`\.$/);
  });
});

async function assertDestructiveResetRejected(extraArgs, expectedCode, messagePattern) {
  await withActionsFixture(async (paths) => {
    const originalConfig = await readFile(paths.configPath, "utf8");
    const result = await runSkillboard([
      "apply-action",
      `reset-cleanup:${paths.root}`,
      ...workflowArgs(paths),
      ...extraArgs
    ]);
    const afterConfig = await readFile(paths.configPath, "utf8");

    assert.equal(afterConfig, originalConfig);
    assert.notEqual(result.exitCode, 0);

    const payload = parseJson(result);
    assertStructuredError(payload, expectedCode, messagePattern);
  });
}

async function assertWorkflowActionRejected(workflowOptions, messagePattern) {
  await withActionsFixture(async (paths) => {
    const originalConfig = await readFile(paths.configPath, "utf8");
    const result = await runSkillboard([
      "apply-action",
      "review-install-unit:medium.pack",
      ...workflowOptions,
      "--config",
      paths.configPath,
      "--skills",
      paths.skillsRoot,
      "--yes",
      "--json"
    ]);
    const afterConfig = await readFile(paths.configPath, "utf8");

    assert.equal(afterConfig, originalConfig);
    assert.notEqual(result.exitCode, 0);

    const payload = parseJson(result);
    assert.equal(payload.ok, false);
    assert.equal(typeof payload.error?.code, "string");
    assert.match(payload.error.message, messagePattern);
  });
}

function workflowArgs(paths) {
  return [
    "--workflow",
    "agent",
    "--config",
    paths.configPath,
    "--skills",
    paths.skillsRoot
  ];
}

async function pathExists(path) {
  return access(path).then(() => true, () => false);
}

async function runSkillboard(args) {
  try {
    const result = await execFileAsync(process.execPath, [skillboardBin, ...args], {
      cwd: repoRoot
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? ""
    };
  }
}

function parseJson(result) {
  assert.match(result.stdout, /^\s*\{/, `expected JSON stdout, got:\n${commandFailure(result)}`);
  return JSON.parse(result.stdout);
}

function assertStructuredError(payload, expectedCode, messagePattern) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, expectedCode);
  assert.equal(typeof payload.error.message, "string");
  assert.match(payload.error.message, messagePattern);
}

function commandFailure(result) {
  return [
    `exitCode=${result.exitCode}`,
    "stdout:",
    result.stdout,
    "stderr:",
    result.stderr
  ].join("\n");
}
