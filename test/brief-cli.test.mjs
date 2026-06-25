import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { withBriefFixture } from "./helpers/advisor-brief-fixtures.mjs";
import { withGroupsFixture } from "./helpers/advisor-brief-groups.mjs";

const execFileAsync = promisify(execFile);

test("brief command renders readable text sections", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow"
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /What your AI can use now/);
    assert.match(result.stdout, /Manual only/);
    assert.match(result.stdout, /Needs review/);
    assert.match(result.stdout, /Blocked for safety/);
    assert.match(result.stdout, /Not in this workflow/);
    assert.match(result.stdout, /Suggested next actions/);
    assert.throws(() => JSON.parse(result.stdout));
  });
});

test("brief command json omits actions unless requested", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 0);
    assert.equal(payload.schema_version, 1);
    assert.equal(Object.hasOwn(payload, "actions"), false);
  });
});

test("brief command include-actions json includes actions", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--include-actions",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 0);
    assert.ok(Array.isArray(payload.actions));
    assert.ok(payload.actions.length > 0);
  });
});

test("brief command missing config json exits with expected payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-missing-cli-"));
  try {
    const before = await readdir(root);
    const result = await runCli([
      "brief",
      "--dir",
      root,
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills"),
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.equal(payload.ok, false);
    assert.equal(typeof payload.error.code, "string");
    assert.equal(payload.health.mode, "not-initialized");
    assert.deepEqual(await readdir(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief command unknown workflow json exits with expected payload", async () => {
  await withGroupsFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli([
      "brief",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "missing",
      "--include-actions",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(result.code, 2);
    assert.equal(result.stderr, "");
    assert.equal(payload.ok, false);
    assert.equal(payload.workflow.unknown, true);
    assertNoApplyCommands(payload);
  });
});

test("brief command help lists command and options", async () => {
  const result = await runCli(["help"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /brief \[--workflow <name>\]/);
  assert.match(result.stdout, /--include-actions/);
  assert.match(result.stdout, /--json/);
});

async function runCli(args) {
  try {
    const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", ...args]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

function assertNoApplyCommands(value) {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Object.hasOwn(value, "apply")) {
    assert.equal(value.apply, null);
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const entry of child) {
        assertNoApplyCommands(entry);
      }
    } else {
      assertNoApplyCommands(child);
    }
  }
}
