import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { renderLockfile, skillContentDigest } from "../src/source-verification.mjs";
import {
  cleanupCreatedVariantFile,
  copySkillFileForFork,
  createResetBackup,
  replaceLiveSkillFileForReset,
  requireVariantDigest,
  resolveVariantLiveSkillFile,
  resolveVariantSnapshotFile,
  variantSnapshotTarget,
  variantTempPath,
  digestVariantFile,
  isPathInside,
  assertPathInside,
  writeVariantSnapshot
} from "../src/control/variant-files.mjs";

test("renderLockfile preserves sha256 content_digest shape for ordinary skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-lock-digest-test-"));
  try {
    const skillsRoot = join(root, "skills");
    const content = "# Ordinary Skill\n\nUse exact raw content.\n";
    await mkdir(join(skillsRoot, "ordinary"), { recursive: true });
    await writeFile(join(skillsRoot, "ordinary", "SKILL.md"), content, "utf8");
    const workspace = {
      version: 1,
      skills: [{
        id: "ordinary.skill",
        path: "ordinary",
        status: "active",
        invocation: "manual-only",
        exposure: "exported",
        ownerInstallUnit: undefined
      }],
      workflows: []
    };

    const text = await renderLockfile(workspace, {
      skillsRoot,
      generatedAt: "2026-06-29T00:00:00.000Z",
      verified: { units: [] }
    });
    const lock = YAML.parse(text);
    const expectedDigest = rawSha256(content);

    assert.equal(lock.skills["ordinary.skill"].content_digest, expectedDigest);
    assert.match(lock.skills["ordinary.skill"].content_digest, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exposes direct path containment digest and temp-path helpers", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-helper-test-"));
  try {
    const skillFile = join(root, "skills", "base", "SKILL.md");
    await mkdir(dirname(skillFile), { recursive: true });
    await writeFile(skillFile, "# Base\n", "utf8");

    const tempPath = variantTempPath(join(root, "snapshots", "base.md"));
    assert.equal(dirname(tempPath), join(root, "snapshots"));
    assert.match(tempPath, /\.base\.md\.[a-f0-9-]+\.tmp$/);
    assert.equal(await digestVariantFile(skillFile), rawSha256("# Base\n"));
    assert.equal(isPathInside(root, join(root, "skills", "base")), true);
    assert.equal(isPathInside(root, join(dirname(root), "outside")), false);
    assert.throws(() => assertPathInside(root, join(dirname(root), "outside"), "variant helper path"), /variant helper path must stay under/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves variant snapshot paths and digests raw SKILL.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-file-test-"));
  try {
    const configPath = join(root, "project", "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const skill = { id: "base.review", path: "base/review" };
    const variantId = "claude.review+codex/review";
    const content = "---\nname: base.review\ndescription: Fixture.\n---\n# Base Review\n";
    await mkdir(dirname(configPath), { recursive: true });
    await mkdir(join(skillsRoot, skill.path), { recursive: true });
    await writeFile(configPath, "version: 1\n", "utf8");
    await writeFile(join(skillsRoot, skill.path, "SKILL.md"), content, "utf8");

    const liveFile = resolveVariantLiveSkillFile({ skillsRoot, skill });
    const digest = await skillContentDigest(liveFile);
    const target = variantSnapshotTarget({ configPath, skillId: variantId, snapshotName: "base" });
    const resolved = resolveVariantSnapshotFile({ configPath, snapshotPath: target.storedPath });
    const dryRun = await writeVariantSnapshot({
      configPath,
      skillId: variantId,
      snapshotName: "base",
      content,
      dryRun: true
    });

    assert.equal(liveFile, join(skillsRoot, "base", "review", "SKILL.md"));
    assert.equal(digest, rawSha256(content));
    assert.equal(target.storedPath, `.skillboard/variant-snapshots/${encodeURIComponent(variantId)}/base.md`);
    assert.equal(resolved.absolutePath, target.absolutePath);
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.changed, true);
    assert.equal(dryRun.path, target.storedPath);
    await assert.rejects(readFile(target.absolutePath, "utf8"), /ENOENT/);

    const written = await writeVariantSnapshot({
      configPath,
      skillId: variantId,
      snapshotName: "base",
      content,
      expectedDigest: digest
    });

    assert.equal(written.dryRun, false);
    assert.equal(written.path, target.storedPath);
    assert.equal(await readFile(target.absolutePath, "utf8"), content);
    assert.deepEqual((await readdir(dirname(target.absolutePath))).filter((entry) => entry.includes(".tmp")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsafe variant file operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-file-safety-test-"));
  try {
    const configPath = join(root, "project", "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(dirname(configPath), { recursive: true });
    await mkdir(skillsRoot, { recursive: true });
    await writeFile(configPath, "version: 1\n", "utf8");

    assert.throws(
      () => resolveVariantLiveSkillFile({ skillsRoot, skill: { id: "bad", path: "../escape" } }),
      /stay under the skills root/
    );
    assert.throws(
      () => resolveVariantLiveSkillFile({ skillsRoot, skill: { id: "bad", path: "/tmp/escape" } }),
      /relative to the skills root/
    );
    assert.throws(
      () => resolveVariantSnapshotFile({ configPath, snapshotPath: "../outside.md" }),
      /under \.skillboard\/variant-snapshots/
    );
    assert.throws(
      () => resolveVariantSnapshotFile({ configPath, snapshotPath: join(root, "outside.md") }),
      /relative to the config directory/
    );
    assert.throws(
      () => requireVariantDigest("sha256:not-hex"),
      /sha256:<64 hex chars>/
    );
    const staleDigestTarget = variantSnapshotTarget({ configPath, skillId: "stale.variant", snapshotName: "base" });
    await assert.rejects(
      writeVariantSnapshot({
        configPath,
        skillId: "stale.variant",
        snapshotName: "base",
        content: "current snapshot\n",
        expectedDigest: rawSha256("stale snapshot\n")
      }),
      /snapshot content digest mismatch/
    );
    await assert.rejects(readFile(staleDigestTarget.absolutePath, "utf8"), /ENOENT/);
    assert.deepEqual((await readdir(dirname(staleDigestTarget.absolutePath))).filter((entry) => entry.includes(".tmp")), []);

    const sourceFile = join(skillsRoot, "base", "review", "SKILL.md");
    const forkTarget = join(skillsRoot, "claude", "review", "SKILL.md");
    await mkdir(dirname(sourceFile), { recursive: true });
    await mkdir(dirname(forkTarget), { recursive: true });
    await writeFile(sourceFile, "base content\n", "utf8");
    await writeFile(forkTarget, "do not overwrite\n", "utf8");
    await assert.rejects(
      copySkillFileForFork({ sourceFile, targetFile: forkTarget }),
      /already exists/
    );
    assert.equal(await readFile(forkTarget, "utf8"), "do not overwrite\n");

    const liveLink = join(skillsRoot, "symlinked", "SKILL.md");
    const outsideTarget = join(root, "outside.md");
    await mkdir(dirname(liveLink), { recursive: true });
    await writeFile(outsideTarget, "outside\n", "utf8");
    await symlink(outsideTarget, liveLink);
    await assert.rejects(
      replaceLiveSkillFileForReset({ liveFile: liveLink, content: "reset\n" }),
      /Refusing to overwrite symlink/
    );
    assert.equal(await readFile(outsideTarget, "utf8"), "outside\n");

    const snapshotTarget = variantSnapshotTarget({ configPath, skillId: "broken.variant", snapshotName: "base" });
    await mkdir(snapshotTarget.absolutePath, { recursive: true });
    await assert.rejects(
      writeVariantSnapshot({
        configPath,
        skillId: "broken.variant",
        snapshotName: "base",
        content: "snapshot\n",
        allowOverwrite: true
      })
    );
    assert.deepEqual((await readdir(dirname(snapshotTarget.absolutePath))).filter((entry) => entry.includes(".tmp")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleans created variant files only when expected digest matches", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-cleanup-test-"));
  try {
    const createdFile = join(root, "created", "SKILL.md");
    await mkdir(dirname(createdFile), { recursive: true });
    await writeFile(createdFile, "created variant\n", "utf8");

    const stale = await cleanupCreatedVariantFile(createdFile, {
      expectedDigest: rawSha256("different variant\n")
    });
    assert.equal(stale.removed, false);
    assert.equal(stale.reason, "digest-mismatch");
    assert.equal(stale.actualDigest, rawSha256("created variant\n"));
    assert.equal(await readFile(createdFile, "utf8"), "created variant\n");

    const cleaned = await cleanupCreatedVariantFile(createdFile, {
      expectedDigest: rawSha256("created variant\n")
    });
    assert.deepEqual(cleaned, { removed: true });
    await assert.rejects(readFile(createdFile, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restores reset backup after simulated reset write", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-reset-restore-test-"));
  try {
    const liveFile = join(root, "skills", "codex", "review", "SKILL.md");
    await mkdir(dirname(liveFile), { recursive: true });
    await writeFile(liveFile, "approved content\n", "utf8");

    const backup = await createResetBackup(liveFile);
    await writeFile(liveFile, "reset draft\n", "utf8");
    assert.equal(await readFile(liveFile, "utf8"), "reset draft\n");

    await backup.restore();
    assert.equal(await readFile(liveFile, "utf8"), "approved content\n");

    await backup.cleanup();
    await assert.rejects(readFile(backup.backupPath, "utf8"), /ENOENT/);

    const replaced = await replaceLiveSkillFileForReset({
      liveFile,
      content: "approved content v2\n"
    });
    assert.equal(replaced.action, "replace-live-skill-for-reset");
    assert.equal(replaced.overwrite, true);
    assert.equal(await readFile(liveFile, "utf8"), "approved content v2\n");
    await assert.rejects(readFile(replaced.backupPath, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function rawSha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
