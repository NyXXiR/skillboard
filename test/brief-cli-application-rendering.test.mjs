import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withBriefFixture } from "./helpers/advisor-brief-fixtures.mjs";
import { runCli, withInitializedEmptyProject } from "./helpers/brief-cli.mjs";

test("brief command renders complete application commands for long paths", async () => {
  await withLongTmpdir(async () => {
    await withBriefFixture(async ({ configPath, root, skillsRoot }) => {
      const compact = await runCli([
        "brief",
        "--config",
        configPath,
        "--skills",
        skillsRoot,
        "--workflow",
        "daily-workflow"
      ]);
      const result = await runCli([
        "brief",
        "--config",
        configPath,
        "--skills",
        skillsRoot,
        "--workflow",
        "daily-workflow",
        "--verbose"
      ]);

      assert.equal(compact.code, 0);
      assert.doesNotMatch(compact.stdout, /apply action: `skillboard apply-action/);
      assert.doesNotMatch(compact.stdout, /underlying apply: `/);
      assert.match(compact.stdout, /details: `skillboard brief --verbose --workflow daily-workflow`/);

      assert.equal(result.code, 0);
      const applyActionLine = result.stdout
        .split("\n")
        .find((line) => line.includes("apply action: `skillboard apply-action"));

      assert.ok(applyActionLine, "expected an application apply action line");
      assert.doesNotMatch(applyActionLine, /\.\.\./);
      assert.match(applyActionLine, /apply action: `skillboard apply-action [^`]+`$/);
      assertCommandLineContainsArg(applyActionLine, "--dir", root);
      assertCommandLineContainsArg(applyActionLine, "--config", configPath);
      assertCommandLineContainsArg(applyActionLine, "--skills", skillsRoot);
      assert.ok(applyActionLine.includes(" --yes"));
      assert.ok(applyActionLine.includes(" --json"));

      const underlyingApplyLine = result.stdout
        .split("\n")
        .find((line) => line.includes("underlying apply: `"));
      assert.ok(underlyingApplyLine, "expected raw underlying apply details");
      assert.match(underlyingApplyLine, /\.\.\./);
    });
  });
});

test("brief command does not invent setup actions for an initialized empty v2 policy", async () => {
  await withLongTmpdir(async () => {
    await withInitializedEmptyProject(async ({ root }) => {
      const result = await runCli(["brief", "--dir", root]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /AI can use now: 0/);
      assert.match(result.stdout, /## Next safe action\s+[^#]*- none/s);
      assert.doesNotMatch(result.stdout, /preview: `skillboard inventory refresh/);
    });
  });
});

async function withLongTmpdir(run) {
  const parent = await mkdtemp(join(tmpdir(), "skillboard-brief-long-command-parent-"));
  const longTmpdir = join(
    parent,
    "path-long-enough-to-force-application-command-display-past-safe-text-limit",
    "another-long-segment-containing-fixture-state-for-brief-rendering"
  );
  const previousTmpdir = process.env.TMPDIR;
  try {
    await mkdir(longTmpdir, { recursive: true });
    process.env.TMPDIR = longTmpdir;
    return await run();
  } finally {
    if (previousTmpdir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previousTmpdir;
    }
    await rm(parent, { recursive: true, force: true });
  }
}

function assertCommandLineContainsArg(line, flag, value) {
  assert.match(line, new RegExp(`\\s${escapeRegExp(flag)}\\s+`));
  assert.ok(line.includes(value), `expected ${flag} value ${value} in ${line}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
