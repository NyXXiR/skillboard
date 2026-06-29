import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  canUseSkill,
  forkSkillVariant,
  loadWorkspace,
  approveSkillVariant,
  resetSkillVariant,
  variantLifecycleStatus
} from "../src/index.mjs";
import {
  BASE_SKILL_CONTENT,
  CHANGED_SKILL_CONTENT,
  lifecycleVariantSkill,
  rawSha256,
  readConfig,
  snapshotPath,
  withControlVariantWorkspace,
  writeSnapshot
} from "./helpers/variant-lifecycle-control-fixtures.mjs";

const FORK_OPTIONS = {
  variantId: "claude.review",
  baseId: "base.review",
  capability: "task-review",
  workflow: "claude-workflow",
  path: "claude/review",
  adaptedFor: "Claude review",
  category: "agent"
};
const APPROVED_CONTENT = `${BASE_SKILL_CONTENT}\nApproved adaptation.\n`;

test("fork creates draft snapshot without promotion", async () => {
  await withControlVariantWorkspace({}, async ({ configPath, root, skillsRoot, variantFile }) => {
    const before = await readFile(configPath, "utf8");
    const expectedDigest = rawSha256(BASE_SKILL_CONTENT);
    const expectedSnapshot = snapshotPath("claude.review", "base");

    const dryRun = await forkSkillVariant({ ...FORK_OPTIONS, configPath, skillsRoot, dryRun: true });
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.changed, true);
    assert.equal(await readFile(configPath, "utf8"), before);
    await assert.rejects(readFile(variantFile, "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, expectedSnapshot), "utf8"), /ENOENT/);

    const result = await forkSkillVariant({ ...FORK_OPTIONS, configPath, skillsRoot });
    assert.equal(result.dryRun, false);
    assert.equal(result.variant.status, "draft");
    assert.deepEqual(result.filePlan.map((entry) => entry.action), ["copy-skill-for-fork", "write-snapshot"]);

    const config = await readConfig(configPath);
    assert.deepEqual(config.skills["claude.review"], {
      path: "claude/review",
      status: "candidate",
      invocation: "manual-only",
      exposure: "exported",
      category: "agent",
      variant: {
        of: "base.review",
        adapted_for: "Claude review",
        capability: "task-review",
        workflow: "claude-workflow",
        status: "draft",
        base: { content_digest: expectedDigest, snapshot: expectedSnapshot }
      }
    });
    assert.equal(config.workflows["claude-workflow"].required_capabilities["task-review"].preferred, "base.review");
    assert.deepEqual(config.workflows["claude-workflow"].required_capabilities["task-review"].fallback, []);
    assert.deepEqual(config.workflows["claude-workflow"].active_skills, ["base.review"]);
    assert.equal(await readFile(variantFile, "utf8"), BASE_SKILL_CONTENT);
    assert.equal(await readFile(join(root, expectedSnapshot), "utf8"), BASE_SKILL_CONTENT);

    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const use = canUseSkill(workspace, "claude.review", "claude-workflow");
    assert.equal(use.allowed, false);
    assert.match(use.reasons.join("\n"), /not active, preferred, or fallback/);

    const baseStatus = await variantLifecycleStatus({ configPath, skillsRoot, variantId: "claude.review" });
    assert.equal(baseStatus.computedStatus, "draft-base");
    assert.equal(baseStatus.liveDigest, expectedDigest);
    assert.equal(baseStatus.baseDigest, expectedDigest);
    assert.equal(baseStatus.approvedDigest, null);

    await writeFile(variantFile, CHANGED_SKILL_CONTENT, "utf8");
    const changedStatus = await variantLifecycleStatus({ configPath, skillsRoot, variantId: "claude.review" });
    assert.equal(changedStatus.computedStatus, "draft-changed");
    assert.equal(changedStatus.liveDigest, rawSha256(CHANGED_SKILL_CONTENT));
  });
});

test("fork and status reject invalid lifecycle inputs", async () => {
  await withControlVariantWorkspace({}, async ({ configPath, skillsRoot }) => {
    await assert.rejects(forkSkillVariant({ ...FORK_OPTIONS, configPath, skillsRoot, baseId: "missing.base" }), /Unknown skill: missing\.base/);
    await assert.rejects(forkSkillVariant({ ...FORK_OPTIONS, configPath, skillsRoot, capability: "missing-capability" }), /Unknown capability: missing-capability/);
    await assert.rejects(forkSkillVariant({ ...FORK_OPTIONS, configPath, skillsRoot, workflow: "missing-workflow" }), /Unknown workflow: missing-workflow/);
    await assert.rejects(variantLifecycleStatus({ configPath, skillsRoot, variantId: "base.review" }), /not a lifecycle variant/);
  });

  await withControlVariantWorkspace({ createBase: false }, async ({ configPath, skillsRoot }) => {
    const before = await readFile(configPath, "utf8");
    await assert.rejects(forkSkillVariant({ ...FORK_OPTIONS, configPath, skillsRoot }), /base skill file/i);
    assert.equal(await readFile(configPath, "utf8"), before);
  });

  await withControlVariantWorkspace({ variantSkill: lifecycleVariantSkill() }, async ({ configPath, skillsRoot }) => {
    await assert.rejects(forkSkillVariant({ ...FORK_OPTIONS, configPath, skillsRoot }), /Skill already exists: claude\.review/);
  });

  await withControlVariantWorkspace({ variantContent: "existing target\n" }, async ({ configPath, skillsRoot, variantFile }) => {
    await assert.rejects(forkSkillVariant({ ...FORK_OPTIONS, configPath, skillsRoot }), /Fork target already exists/);
    assert.equal(await readFile(variantFile, "utf8"), "existing target\n");
  });

  await withControlVariantWorkspace({ variantSkill: lifecycleVariantSkill() }, async ({ configPath, skillsRoot }) => {
    const status = await variantLifecycleStatus({ configPath, skillsRoot, variantId: "claude.review" });
    assert.equal(status.computedStatus, "missing-live-file");
    assert.equal(status.liveDigest, null);
  });

  await withControlVariantWorkspace({ variantSkill: lifecycleVariantSkill(), variantContent: BASE_SKILL_CONTENT }, async ({ configPath, skillsRoot }) => {
    const status = await variantLifecycleStatus({ configPath, skillsRoot, variantId: "claude.review" });
    assert.equal(status.computedStatus, "draft-base");
    assert.equal(status.files.baseSnapshot.exists, false);
    assert.match(status.warnings.join("\n"), /base snapshot missing/);
  });

  await withControlVariantWorkspace({ variantSkill: lifecycleVariantSkill(), variantContent: CHANGED_SKILL_CONTENT }, async ({ configPath, skillsRoot }) => {
    const status = await variantLifecycleStatus({ configPath, skillsRoot, variantId: "claude.review" });
    assert.equal(status.computedStatus, "draft-changed");
  });

  await withControlVariantWorkspace({
    variantSkill: lifecycleVariantSkill({
      variantStatus: "approved",
      approvedDigest: rawSha256(`${BASE_SKILL_CONTENT}\nApproved adaptation.\n`)
    }),
    variantContent: `${BASE_SKILL_CONTENT}\nDrifted approved adaptation.\n`
  }, async ({ configPath, root, skillsRoot }) => {
    await writeSnapshot(root, snapshotPath("claude.review", "base"), BASE_SKILL_CONTENT);
    await writeSnapshot(root, snapshotPath("claude.review", "approved"), `${BASE_SKILL_CONTENT}\nApproved adaptation.\n`);
    const status = await variantLifecycleStatus({ configPath, skillsRoot, variantId: "claude.review" });
    assert.equal(status.computedStatus, "drifted");
    assert.equal(status.approvedDigest, rawSha256(`${BASE_SKILL_CONTENT}\nApproved adaptation.\n`));
  });
});

test("approve promotes reviewed variant after snapshot", async () => {
  await withControlVariantWorkspace({
    variantSkill: lifecycleVariantSkill(),
    variantContent: CHANGED_SKILL_CONTENT
  }, async ({ configPath, root, skillsRoot }) => {
    const approvedSnapshot = snapshotPath("claude.review", "approved");
    const approvedDigest = rawSha256(CHANGED_SKILL_CONTENT);
    const before = await readFile(configPath, "utf8");
    await writeSnapshot(root, snapshotPath("claude.review", "base"), BASE_SKILL_CONTENT);

    const dryRun = await approveSkillVariant({ configPath, skillsRoot, variantId: "claude.review", mode: "workflow-auto", dryRun: true });
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.changed, true);
    assert.equal(await readFile(configPath, "utf8"), before);
    await assert.rejects(readFile(join(root, approvedSnapshot), "utf8"), /ENOENT/);

    const result = await approveSkillVariant({ configPath, skillsRoot, variantId: "claude.review", mode: "workflow-auto" });
    assert.equal(result.variant.status, "approved");
    assert.deepEqual(result.filePlan.map((entry) => entry.action), ["write-snapshot"]);

    const config = await readConfig(configPath);
    assert.equal(config.skills["claude.review"].status, "active");
    assert.equal(config.skills["claude.review"].invocation, "workflow-auto");
    assert.equal(config.skills["claude.review"].variant.status, "approved");
    assert.deepEqual(config.skills["claude.review"].variant.approved, { content_digest: approvedDigest, snapshot: approvedSnapshot });
    assert.deepEqual(config.capabilities["task-review"].alternatives, ["claude.review"]);
    assert.equal(config.workflows["claude-workflow"].required_capabilities["task-review"].preferred, "claude.review");
    assert.deepEqual(config.workflows["claude-workflow"].required_capabilities["task-review"].fallback, ["base.review"]);
    assert.deepEqual(config.workflows["claude-workflow"].active_skills, ["base.review", "claude.review"]);
    assert.equal(await readFile(join(root, approvedSnapshot), "utf8"), CHANGED_SKILL_CONTENT);

    const workspace = await loadWorkspace({ configPath, skillsRoot });
    assert.equal(canUseSkill(workspace, "claude.review", "claude-workflow").allowed, true);
    const status = await variantLifecycleStatus({ configPath, skillsRoot, variantId: "claude.review" });
    assert.equal(status.computedStatus, "approved");
    assert.equal(status.approvedDigest, approvedDigest);
  });
});

test("approve rejects invalid lifecycle inputs", async () => {
  await withControlVariantWorkspace({}, async ({ configPath, skillsRoot }) => {
    await assert.rejects(approveSkillVariant({ configPath, skillsRoot, variantId: "missing.review" }), /Unknown skill: missing\.review/);
    await assert.rejects(approveSkillVariant({ configPath, skillsRoot, variantId: "base.review" }), /not a lifecycle variant/);
  });

  await withControlVariantWorkspace({ variantSkill: lifecycleVariantSkill() }, async ({ configPath, skillsRoot }) => {
    await assert.rejects(approveSkillVariant({ configPath, skillsRoot, variantId: "claude.review" }), /live variant skill file/i);
  });

  await withControlVariantWorkspace({ variantSkill: lifecycleVariantSkill(), variantContent: CHANGED_SKILL_CONTENT }, async ({ configPath, skillsRoot }) => {
    await assert.rejects(approveSkillVariant({ configPath, skillsRoot, variantId: "claude.review", mode: "global-auto" }), /approve requires --mode manual-only, router-only, or workflow-auto/);
  });

  await withControlVariantWorkspace({
    variantSkill: lifecycleVariantSkill({ ownerInstallUnit: "remote.variant" }),
    variantContent: CHANGED_SKILL_CONTENT,
    installUnits: `install_units:\n  remote.variant:\n    kind: skill\n    source_class: git\n    trust_level: unreviewed\n    enabled: true\n    provided_components:\n      - skills\n    components:\n      skills:\n        - claude.review\n`
  }, async ({ configPath, skillsRoot }) => {
    await assert.rejects(
      approveSkillVariant({ configPath, skillsRoot, variantId: "claude.review", mode: "workflow-auto" }),
      /would not be usable|unreviewed non-user source/
    );
  });
});

test("reset moves between base draft and approved variant", async () => {
  await withControlVariantWorkspace({
    variantSkill: lifecycleVariantSkill({ variantStatus: "approved", approvedDigest: rawSha256(APPROVED_CONTENT) }),
    variantContent: APPROVED_CONTENT
  }, async ({ configPath, root, skillsRoot, variantFile }) => {
    await writeSnapshot(root, snapshotPath("claude.review", "base"), BASE_SKILL_CONTENT);
    await writeSnapshot(root, snapshotPath("claude.review", "approved"), APPROVED_CONTENT);
    await approveSkillVariant({ configPath, skillsRoot, variantId: "claude.review", mode: "workflow-auto" });
    const before = await readFile(configPath, "utf8");

    const dryRun = await resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toBase: true, dryRun: true });
    assert.equal(dryRun.dryRun, true); assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal(await readFile(variantFile, "utf8"), APPROVED_CONTENT);

    const toBase = await resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toBase: true, yes: true });
    assert.equal(toBase.variant.status, "draft");
    assert.equal(await readFile(variantFile, "utf8"), BASE_SKILL_CONTENT);
    let config = await readConfig(configPath);
    assert.equal(config.skills["claude.review"].status, "candidate"); assert.equal(config.skills["claude.review"].invocation, "manual-only");
    assert.equal(config.skills["claude.review"].variant.status, "draft");
    assert.equal(config.skills["claude.review"].variant.approved.content_digest, rawSha256(APPROVED_CONTENT));
    assert.equal(config.workflows["claude-workflow"].required_capabilities["task-review"].preferred, "base.review");
    assert.deepEqual(config.workflows["claude-workflow"].required_capabilities["task-review"].fallback, []); assert.deepEqual(config.workflows["claude-workflow"].active_skills, ["base.review"]);
    let workspace = await loadWorkspace({ configPath, skillsRoot });
    assert.equal(canUseSkill(workspace, "claude.review", "claude-workflow").allowed, false);

    const toApproved = await resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toApproved: true, yes: true, mode: "workflow-auto" });
    assert.equal(toApproved.variant.status, "approved"); assert.equal(await readFile(variantFile, "utf8"), APPROVED_CONTENT);
    config = await readConfig(configPath);
    assert.equal(config.skills["claude.review"].status, "active");
    assert.equal(config.workflows["claude-workflow"].required_capabilities["task-review"].preferred, "claude.review");
    assert.deepEqual(config.workflows["claude-workflow"].required_capabilities["task-review"].fallback, ["base.review"]);
    workspace = await loadWorkspace({ configPath, skillsRoot });
    assert.equal(canUseSkill(workspace, "claude.review", "claude-workflow").allowed, true);
    assert.equal((await variantLifecycleStatus({ configPath, skillsRoot, variantId: "claude.review" })).computedStatus, "approved");
  });
});

test("reset protects unsafe writes", async () => {
  await withControlVariantWorkspace({ variantSkill: lifecycleVariantSkill(), variantContent: CHANGED_SKILL_CONTENT }, async ({ configPath, skillsRoot, variantFile }) => {
    const before = await readFile(configPath, "utf8");
    await assert.rejects(resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toBase: true }), /requires --yes/);
    assert.equal(await readFile(configPath, "utf8"), before); assert.equal(await readFile(variantFile, "utf8"), CHANGED_SKILL_CONTENT);
  });

  await withControlVariantWorkspace({ variantSkill: lifecycleVariantSkill(), variantContent: CHANGED_SKILL_CONTENT }, async ({ configPath, skillsRoot }) => {
    await assert.rejects(resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toBase: true, yes: true }), /base snapshot/i);
  });

  await withControlVariantWorkspace({ variantSkill: lifecycleVariantSkill(), variantContent: CHANGED_SKILL_CONTENT }, async ({ configPath, root, skillsRoot, baseFile, variantFile }) => {
    await writeSnapshot(root, snapshotPath("claude.review", "base"), BASE_SKILL_CONTENT);
    await rm(variantFile);
    await symlink(baseFile, variantFile);
    await assert.rejects(resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toBase: true, yes: true }), /symlink/);
    assert.equal(await readFile(baseFile, "utf8"), BASE_SKILL_CONTENT);
  });

  await withControlVariantWorkspace({
    variantSkill: lifecycleVariantSkill({ ownerInstallUnit: "remote.variant", variantStatus: "approved", approvedDigest: rawSha256(APPROVED_CONTENT) }),
    variantContent: CHANGED_SKILL_CONTENT,
    installUnits: `install_units:\n  remote.variant:\n    kind: skill\n    source_class: git\n    trust_level: unreviewed\n    enabled: true\n    provided_components:\n      - skills\n    components:\n      skills:\n        - claude.review\n`
  }, async ({ configPath, root, skillsRoot, variantFile }) => {
    await writeSnapshot(root, snapshotPath("claude.review", "base"), BASE_SKILL_CONTENT);
    await writeSnapshot(root, snapshotPath("claude.review", "approved"), APPROVED_CONTENT);
    const before = await readFile(configPath, "utf8");
    await assert.rejects(resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toApproved: true, yes: true, mode: "workflow-auto" }), /would not be usable|unreviewed non-user source/);
    assert.equal(await readFile(configPath, "utf8"), before); assert.equal(await readFile(variantFile, "utf8"), CHANGED_SKILL_CONTENT);
  });
});
