import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  BASE_SKILL_CONTENT,
  CHANGED_SKILL_CONTENT,
  withControlVariantWorkspace
} from "./helpers/variant-lifecycle-control-fixtures.mjs";

const execFileAsync = promisify(execFile);

async function runSkillboard(args, options = {}) {
  return await execFileAsync(process.execPath, ["bin/skillboard.mjs", ...args], options);
}

async function jsonCommand(args, options = {}) {
  const result = await runSkillboard([...args, "--json"], options);
  return JSON.parse(result.stdout);
}

async function jsonError(args) {
  try {
    await runSkillboard([...args, "--json"]);
  } catch (error) {
    return { code: error.code, payload: JSON.parse(error.stdout), stderr: error.stderr };
  }
  throw new Error(`Expected command to fail: ${args.join(" ")}`);
}

function baseArgs(configPath, skillsRoot) {
  return ["--config", configPath, "--skills", skillsRoot];
}

function forkArgs(configPath, skillsRoot, extra = []) {
  return [
    "variant", "fork", "claude.review",
    "--from", "base.review",
    "--capability", "task-review",
    "--workflow", "claude-workflow",
    "--path", "claude/review",
    ...baseArgs(configPath, skillsRoot),
    ...extra
  ];
}

test("cli variant lifecycle happy path", async () => {
  await withControlVariantWorkspace({}, async ({ configPath, skillsRoot, variantFile }) => {
    const before = await readFile(configPath, "utf8");
    const dryRun = await jsonCommand(forkArgs(configPath, skillsRoot, ["--dry-run"]));
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.variant.status, "draft");
    assert.ok(dryRun.plan.changed);
    assert.ok(dryRun.filePlan.length >= 2);
    assert.equal(await readFile(configPath, "utf8"), before);

    const fork = await jsonCommand(forkArgs(configPath, skillsRoot));
    assert.equal(fork.changed, true);
    assert.equal(fork.variant.base.contentDigest.startsWith("sha256:"), true);
    assert.equal(await readFile(variantFile, "utf8"), BASE_SKILL_CONTENT);

    await writeFile(variantFile, CHANGED_SKILL_CONTENT, "utf8");
    const draftStatus = await jsonCommand(["variant", "status", "claude.review", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(draftStatus.computedStatus, "draft-changed");
    assert.equal(draftStatus.files.live.exists, true);
    assert.equal(draftStatus.approvedDigest, null);

    const approved = await jsonCommand(["variant", "approve", "claude.review", "--mode", "workflow-auto", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(approved.variant.status, "approved");
    assert.ok(approved.filePlan[0].path.includes("approved"));

    const resetBase = await jsonCommand(["variant", "reset", "claude.review", "--to-base", "--yes", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(resetBase.variant.status, "draft");
    assert.equal(await readFile(variantFile, "utf8"), BASE_SKILL_CONTENT);

    const resetApproved = await jsonCommand(["variant", "reset", "claude.review", "--to-approved", "--yes", "--mode", "workflow-auto", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(resetApproved.variant.status, "approved");
    assert.equal(await readFile(variantFile, "utf8"), CHANGED_SKILL_CONTENT);
  });
});

test("cli variant lifecycle errors", async () => {
  await withControlVariantWorkspace({}, async ({ configPath, skillsRoot }) => {
    const plainUsage = await jsonError(["variant", "fork", "claude.review", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(plainUsage.code, 2);
    assert.equal(plainUsage.payload.ok, false);
    assert.equal(plainUsage.payload.error.code, "usage_error");

    let plainError;
    try {
      await runSkillboard(["variant", "fork", "missing"]);
    } catch (error) {
      plainError = error;
    }
    assert.equal(plainError.code, 2);
    assert.match(plainError.stderr, /Usage: skillboard variant fork/);

    const unknown = await jsonError(["variant", "unknown", "claude.review", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(unknown.code, 2);
    assert.equal(unknown.payload.error.code, "unknown_variant_subcommand");

    await jsonCommand(forkArgs(configPath, skillsRoot));
    const invalidApproveMode = await jsonError(["variant", "approve", "claude.review", "--mode", "bad", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(invalidApproveMode.code, 2);
    assert.equal(invalidApproveMode.payload.error.code, "usage_error");

    let plainInvalidApproveMode;
    try {
      await runSkillboard(["variant", "approve", "claude.review", "--mode", "bad", ...baseArgs(configPath, skillsRoot)]);
    } catch (error) {
      plainInvalidApproveMode = error;
    }
    assert.equal(plainInvalidApproveMode.code, 2);
    assert.match(plainInvalidApproveMode.stderr, /requires --mode manual-only/);

    const noYes = await jsonError(["variant", "reset", "claude.review", "--to-base", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(noYes.code, 1);
    assert.equal(noYes.payload.error.code, "confirmation_required");

    const malformedReset = await jsonError(["variant", "reset", "claude.review", "--to-base", "--to-approved", "--yes", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(malformedReset.code, 2);
    assert.equal(malformedReset.payload.error.code, "usage_error");

    let plainMalformedReset;
    try {
      await runSkillboard(["variant", "reset", "claude.review", "--to-base", "--to-approved", "--yes", ...baseArgs(configPath, skillsRoot)]);
    } catch (error) {
      plainMalformedReset = error;
    }
    assert.equal(plainMalformedReset.code, 2);
    assert.match(plainMalformedReset.stderr, /exactly one of --to-base or --to-approved/);

    const nonVariant = await jsonError(["variant", "status", "base.review", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(nonVariant.code, 1);
    assert.match(nonVariant.payload.error.message, /not a lifecycle variant/);
  });
});
