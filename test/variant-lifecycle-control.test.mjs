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
const V1_MIGRATION_REQUIRED = /Version 1 policy is read-only\. Run `skillboard migrate v2`\./;

test("fork refuses v1 dry-run and write without changing config or files", async () => {
  await withControlVariantWorkspace({}, async ({ configPath, root, skillsRoot, variantFile }) => {
    const before = await readFile(configPath, "utf8");
    const expectedSnapshot = snapshotPath("claude.review", "base");

    await assert.rejects(
      forkSkillVariant({ ...FORK_OPTIONS, configPath, skillsRoot, dryRun: true }),
      V1_MIGRATION_REQUIRED
    );
    assert.equal(await readFile(configPath, "utf8"), before);
    await assert.rejects(readFile(variantFile, "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, expectedSnapshot), "utf8"), /ENOENT/);

    await assert.rejects(
      forkSkillVariant({ ...FORK_OPTIONS, configPath, skillsRoot }),
      V1_MIGRATION_REQUIRED
    );
    assert.equal(await readFile(configPath, "utf8"), before);
    await assert.rejects(readFile(variantFile, "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, expectedSnapshot), "utf8"), /ENOENT/);
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

test("approve refuses v1 dry-run and write while preserving bytes and snapshots", async () => {
  await withControlVariantWorkspace({
    variantSkill: lifecycleVariantSkill(),
    variantContent: CHANGED_SKILL_CONTENT
  }, async ({ configPath, root, skillsRoot }) => {
    const approvedSnapshot = snapshotPath("claude.review", "approved");
    const before = await readFile(configPath, "utf8");
    await writeSnapshot(root, snapshotPath("claude.review", "base"), BASE_SKILL_CONTENT);

    await assert.rejects(
      approveSkillVariant({ configPath, skillsRoot, variantId: "claude.review", mode: "workflow-auto", dryRun: true }),
      V1_MIGRATION_REQUIRED
    );
    assert.equal(await readFile(configPath, "utf8"), before);
    await assert.rejects(readFile(join(root, approvedSnapshot), "utf8"), /ENOENT/);

    await assert.rejects(
      approveSkillVariant({ configPath, skillsRoot, variantId: "claude.review", mode: "workflow-auto" }),
      V1_MIGRATION_REQUIRED
    );
    assert.equal(await readFile(configPath, "utf8"), before);
    await assert.rejects(readFile(join(root, approvedSnapshot), "utf8"), /ENOENT/);
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
      V1_MIGRATION_REQUIRED
    );
  });
});

test("reset refuses v1 dry-run and writes while preserving config and live file", async () => {
  await withControlVariantWorkspace({
    variantSkill: lifecycleVariantSkill({ variantStatus: "approved", approvedDigest: rawSha256(APPROVED_CONTENT) }),
    variantContent: APPROVED_CONTENT
  }, async ({ configPath, root, skillsRoot, variantFile }) => {
    await writeSnapshot(root, snapshotPath("claude.review", "base"), BASE_SKILL_CONTENT);
    await writeSnapshot(root, snapshotPath("claude.review", "approved"), APPROVED_CONTENT);
    const before = await readFile(configPath, "utf8");

    await assert.rejects(
      resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toBase: true, dryRun: true }),
      V1_MIGRATION_REQUIRED
    );
    assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal(await readFile(variantFile, "utf8"), APPROVED_CONTENT);

    await assert.rejects(
      resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toBase: true, yes: true }),
      V1_MIGRATION_REQUIRED
    );
    await assert.rejects(
      resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toApproved: true, yes: true, mode: "workflow-auto" }),
      V1_MIGRATION_REQUIRED
    );
    assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal(await readFile(variantFile, "utf8"), APPROVED_CONTENT);
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
    await assert.rejects(resetSkillVariant({ configPath, skillsRoot, variantId: "claude.review", toApproved: true, yes: true, mode: "workflow-auto" }), V1_MIGRATION_REQUIRED);
    assert.equal(await readFile(configPath, "utf8"), before); assert.equal(await readFile(variantFile, "utf8"), CHANGED_SKILL_CONTENT);
  });
});
