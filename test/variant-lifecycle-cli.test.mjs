import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  CHANGED_SKILL_CONTENT,
  lifecycleVariantSkill,
  rawSha256,
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

test("cli variant lifecycle refuses v1 mutations and preserves bytes", async () => {
  await withControlVariantWorkspace({}, async ({ configPath, skillsRoot }) => {
    const before = await readFile(configPath, "utf8");
    const dryRun = await jsonError(forkArgs(configPath, skillsRoot, ["--dry-run"]));
    assert.equal(dryRun.payload.error.code, "lifecycle_error");
    assert.equal(dryRun.payload.error.message, "Version 1 policy is read-only. Run `skillboard migrate v2`.");
    assert.equal(await readFile(configPath, "utf8"), before);

    const fork = await jsonError(forkArgs(configPath, skillsRoot));
    assert.equal(fork.payload.error.code, "lifecycle_error");
    assert.equal(fork.payload.error.message, "Version 1 policy is read-only. Run `skillboard migrate v2`.");
    assert.equal(await readFile(configPath, "utf8"), before);
  });
});

test("cli variant lifecycle errors", async () => {
  await withControlVariantWorkspace({
    variantSkill: lifecycleVariantSkill(),
    variantContent: CHANGED_SKILL_CONTENT
  }, async ({ configPath, skillsRoot }) => {
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

    const v1Fork = await jsonError(forkArgs(configPath, skillsRoot));
    assert.equal(v1Fork.payload.error.code, "lifecycle_error");
    assert.match(v1Fork.payload.error.message, /Skill already exists: claude\.review/);
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

test("cli variant lifecycle is an explicit v1 compatibility surface for v2 policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-variant-boundary-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "review"), { recursive: true });
    await mkdir(join(root, ".skillboard"), { recursive: true });
    await writeFile(join(skillsRoot, "review", "SKILL.md"), CHANGED_SKILL_CONTENT, "utf8");
    await writeFile(configPath, "version: 2\nskills:\n  review:\n    enabled: true\n    shared: false\n", "utf8");
    await writeFile(join(root, ".skillboard", "inventory.json"), JSON.stringify({
      format_version: 1, generated: true, authoritative_for_availability: false,
      skills: [{
        id: "review", path: "review", owner_install_unit: "migration.unowned",
        observations: {
          variant: {
            of: "base.review", adapted_for: "review", capability: "review", workflow: "daily", status: "draft",
            base: {
              content_digest: rawSha256("historical base\n"),
              snapshot: ".skillboard/variant-snapshots/review/base.md"
            }
          }
        }
      }]
    }), "utf8");

    const status = await jsonCommand(["variant", "status", "review", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(status.skill, "review");
    assert.equal(status.computedStatus, "draft-changed");
    assert.equal(status.liveDigest, rawSha256(CHANGED_SKILL_CONTENT));
    assert.match(status.warnings.join("\n"), /base snapshot missing/);

    const unknown = await jsonError(["variant", "status", "review", "--mystery", ...baseArgs(configPath, skillsRoot)]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.payload.error.message, /Unknown variant option: --mystery/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
