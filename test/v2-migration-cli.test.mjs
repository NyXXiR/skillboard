import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withConfigLock } from "../src/migration/v2-files.mjs";
import { migrateV2 } from "../src/migration/v2-transaction.mjs";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../bin/skillboard.mjs", import.meta.url));

test("migrate v2 previews without writes, applies once, and rolls back exact bytes", async () => {
  await withFixture(async ({ configPath, inventoryPath }) => {
    const before = await readFile(configPath);
    const preview = await run(["migrate", "v2", "--config", configPath, "--json"]);
    const previewJson = JSON.parse(preview.stdout);
    assert.equal(previewJson.mode, "preview");
    assert.equal(previewJson.changed, true);
    assert.equal(previewJson.input_sha256, sha(before));
    assert.equal(previewJson.target_version, 2);
    assert.equal(previewJson.counts.skills, 2);
    assert.equal(await readFile(configPath, "utf8"), before.toString("utf8"));
    await assert.rejects(stat(inventoryPath));

    const apply = JSON.parse((await run(["migrate", "v2", "--config", configPath, "--yes", "--json"])).stdout);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.changed, true);
    assert.ok(apply.backup.endsWith(".bak"));
    assert.equal(apply.config_sha256, sha(await readFile(configPath)));
    assert.equal(apply.inventory_sha256, sha(await readFile(inventoryPath)));
    assert.doesNotMatch(JSON.stringify(apply), new RegExp(configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const migratedConfig = await readFile(configPath, "utf8");
    assert.match(migratedConfig, /# keep this comment/);
    assert.match(migratedConfig, /# keep demo policy context/);
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
    assert.equal(inventory.skills.find(({ id }) => id === "demo").observations.x_extension, "retained");
    assert.equal(inventory.migration.source_document, undefined);
    assert.doesNotMatch(JSON.stringify(inventory), /raw_metadata/);
    assert.deepEqual(inventory.migration.invalidates, ["v1-action-id", "v1-guard-hook", "v1-lock-projection"]);

    const again = JSON.parse((await run(["migrate", "v2", "--config", configPath, "--yes", "--json"])).stdout);
    assert.equal(again.changed, false);
    assert.equal(again.backup, null);

    const rollback = JSON.parse((await run(["migrate", "v2", "--config", configPath, "--rollback", apply.backup, "--json"])).stdout);
    assert.equal(rollback.changed, true);
    assert.equal(sha(await readFile(configPath)), sha(before));
    await assert.rejects(stat(inventoryPath));
  });
});

test("migrate v2 reports review-only quarantine uncertainty once at the grouped apply boundary", async () => {
  await withFixture(async ({ configPath }) => {
    const input = fixture().replace("workflows:", `  uncertain:
    path: uncertain
    status: quarantined
    invocation: blocked
    exposure: exported
workflows:`);
    await writeFile(configPath, input, "utf8");
    const before = await readFile(configPath);

    // When: the user previews the migration without the grouped --yes action.
    const preview = JSON.parse((await run(["migrate", "v2", "--config", configPath, "--json"])).stdout);

    // Then: one grouped decision names every uncertain skill and preview remains non-mutating.
    assert.deepEqual(preview.ambiguities, [{
      kind: "review_only_quarantine",
      skill_ids: ["uncertain"],
      mapped_enabled: true,
      requires_grouped_confirmation: true
    }]);
    assert.deepEqual(preview.grouped_decision, {
      action: "apply_v2_migration",
      confirmation_option: "--yes",
      ambiguity_count: 1,
      skill_count: 1
    });
    assert.deepEqual(await readFile(configPath), before);
  });
});

test("migrate v2 refuses a concurrent or stale lock without misleading success output", async () => {
  await withFixture(async ({ configPath }) => {
    const before = await readFile(configPath);
    await writeFile(`${configPath}.migrate.lock`, "stale\n");
    const result = await run(["migrate", "v2", "--config", configPath, "--yes", "--json"], {}, false);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /another migration is already using this config/i);
    assert.equal(result.stdout, "");
    assert.deepEqual(await readFile(configPath), before);
    await rm(`${configPath}.migrate.lock`, { force: true });
  });
});

test("migrate v2 refuses apply when config bytes changed after preview", async () => {
  await withFixture(async ({ root, configPath, inventoryPath }) => {
    const preview = await migrateV2({ configPath, inventoryPath, apply: false });
    const changed = `${await readFile(configPath, "utf8")}\n# concurrent edit\n`;
    await writeFile(configPath, changed, "utf8");

    await assert.rejects(
      migrateV2({
        configPath,
        inventoryPath,
        apply: true,
        expectedInputSha256: preview.input_sha256
      }),
      /changed after migration preview.*no files were changed/i
    );

    assert.equal(await readFile(configPath, "utf8"), changed);
    assert.equal((await readdir(root)).some((name) => name.endsWith(".bak")), false);
  });
});

test("migrate v2 rejects a symlink config without replacing the link or changing its target", async () => {
  await withFixture(async ({ root, configPath }) => {
    const targetBefore = await readFile(configPath);
    const alias = join(root, "config-alias.yaml");
    await symlink(configPath, alias);
    const result = await run(["migrate", "v2", "--config", alias, "--yes", "--json"], {}, false);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /config path must not be a symbolic link/i);
    assert.equal((await lstat(alias)).isSymbolicLink(), true);
    assert.deepEqual(await readFile(configPath), targetBefore);
  });
});

test("migrate v2 rejects a symlinked inventory directory before backups or writes", async () => {
  await withFixture(async ({ root, configPath }) => {
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(root, ".skillboard"));
    const before = await readFile(configPath);
    const result = await run(["migrate", "v2", "--config", configPath, "--yes", "--json"], {}, false);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /inventory directory must not be a symbolic link/i);
    assert.deepEqual(await readFile(configPath), before);
    assert.deepEqual(await readdir(outside), []);
    const entries = await readdir(root);
    assert.equal(entries.some((name) => name.endsWith(".bak")), false);
  });
});

test("migrate v2 rejects unknown options before preview", async () => {
  await withFixture(async ({ configPath }) => {
    const before = await readFile(configPath);
    const result = await run(["migrate", "v2", "--config", configPath, "--banana", "--json"], {}, false);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /unknown migrate option: --banana/i);
    assert.equal(result.stdout, "");
    assert.deepEqual(await readFile(configPath), before);
  });
});

test("withConfigLock serializes path aliases for the same underlying config", async () => {
  await withFixture(async ({ root, configPath }) => {
    const alias = join(root, "lock-alias.yaml");
    await symlink(configPath, alias);
    let concurrent = 0;
    let maxConcurrent = 0;
    const first = withConfigLock(configPath, async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 50));
      concurrent -= 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = withConfigLock(alias, async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      concurrent -= 1;
    });
    const settled = await Promise.allSettled([first, second]);
    assert.equal(maxConcurrent, 1);
    assert.ok(settled.some(({ status }) => status === "rejected"));
  });
});

test("migrate v2 validates input before writing and restores both files after injected failures", async () => {
  await withFixture(async ({ root, configPath, inventoryPath }) => {
    const oldInventory = Buffer.from("{\"old\":true}\n");
    await mkdir(dirname(inventoryPath), { recursive: true });
    await writeFile(inventoryPath, oldInventory);
    const before = await readFile(configPath);
    const failure = await run(
      ["migrate", "v2", "--config", configPath, "--yes", "--json"],
      { SKILLBOARD_MIGRATION_FAILPOINT: "after-config-write" },
      false
    );
    assert.notEqual(failure.code, 0);
    assert.match(failure.stderr, /injected migration failure/i);
    assert.deepEqual(await readFile(configPath), before);
    assert.deepEqual(await readFile(inventoryPath), oldInventory);

    await writeFile(configPath, "version: 99\nskills: {}\n");
    const bad = await run(["migrate", "v2", "--config", configPath, "--yes", "--json"], {}, false);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /unsupported config version/i);
    assert.equal(await readFile(configPath, "utf8"), "version: 99\nskills: {}\n");
    assert.deepEqual(await readFile(inventoryPath), oldInventory);
    await assert.rejects(stat(`${configPath}.migrate.lock`));
    assert.ok(root);
  });
});

test("migrate v2 restores a newly created inventory after post-write validation failure", async () => {
  await withFixture(async ({ configPath, inventoryPath }) => {
    const before = await readFile(configPath);
    const failure = await run(
      ["migrate", "v2", "--config", configPath, "--yes", "--json"],
      { SKILLBOARD_MIGRATION_FAILPOINT: "before-validation" },
      false
    );
    assert.notEqual(failure.code, 0);
    assert.deepEqual(await readFile(configPath), before);
    await assert.rejects(stat(inventoryPath));
  });
});

for (const failpoint of ["terminate-after-config-rename", "terminate-after-inventory-rename"]) {
  test(`migrate v2 recovers a process termination at ${failpoint}`, async () => {
    await withFixture(async ({ configPath, inventoryPath }) => {
      // Given: an apply process terminates after one of the durable renames.
      const before = await readFile(configPath);
      const terminated = await run(
        ["migrate", "v2", "--config", configPath, "--yes", "--json"],
        { SKILLBOARD_MIGRATION_FAILPOINT: failpoint },
        false
      );
      assert.notEqual(terminated.code, 0);

      // When: the next invocation opens the same migration target.
      const recovered = JSON.parse((await run(["migrate", "v2", "--config", configPath, "--json"])).stdout);

      // Then: the durable journal restores the exact v1 snapshot before previewing again.
      assert.equal(recovered.mode, "preview");
      assert.deepEqual(await readFile(configPath), before);
      await assert.rejects(stat(inventoryPath));
      await assert.rejects(stat(`${configPath}.migrate.lock`));
      await assert.rejects(stat(`${configPath}.migrate.transaction.json`));
    });
  });
}

for (const recoveryFailpoint of [
  "terminate-recovery-after-config-rename",
  "terminate-recovery-after-inventory-rename"
]) {
  test(`migration recovery is restartable at ${recoveryFailpoint}`, async () => {
    await withFixture(async ({ configPath, inventoryPath }) => {
      // Given: a migration is interrupted, then its recovery is interrupted after a restore rename.
      const before = await readFile(configPath);
      await run(
        ["migrate", "v2", "--config", configPath, "--yes", "--json"],
        { SKILLBOARD_MIGRATION_FAILPOINT: "terminate-after-inventory-rename" },
        false
      );
      const interruptedRecovery = await run(
        ["migrate", "v2", "--config", configPath, "--json"],
        { SKILLBOARD_MIGRATION_FAILPOINT: recoveryFailpoint },
        false
      );
      assert.notEqual(interruptedRecovery.code, 0);

      // When: a third process opens the same target without a failpoint.
      const recovered = JSON.parse((await run(["migrate", "v2", "--config", configPath, "--json"])).stdout);

      // Then: recovery replays idempotently from durable backups and reaches the exact v1 pair.
      assert.equal(recovered.mode, "preview");
      assert.deepEqual(await readFile(configPath), before);
      await assert.rejects(stat(inventoryPath));
      await assert.rejects(stat(`${configPath}.migrate.transaction.json`));
    });
  });
}

for (const failpoint of ["terminate-after-config-rename", "terminate-after-inventory-rename"]) {
  test(`rollback recovers a process termination at ${failpoint}`, async () => {
    await withFixture(async ({ configPath, inventoryPath }) => {
      // Given: a completed v2 migration and a rollback process that terminates between target renames.
      const applied = JSON.parse((await run(["migrate", "v2", "--config", configPath, "--yes", "--json"])).stdout);
      const migratedConfig = await readFile(configPath);
      const migratedInventory = await readFile(inventoryPath);
      const terminated = await run(
        ["migrate", "v2", "--config", configPath, "--rollback", join(dirname(configPath), applied.backup), "--json"],
        { SKILLBOARD_MIGRATION_FAILPOINT: failpoint },
        false
      );
      assert.notEqual(terminated.code, 0);

      // When: the next migration invocation recovers the interrupted rollback.
      const recovered = JSON.parse((await run(["migrate", "v2", "--config", configPath, "--json"])).stdout);

      // Then: the exact pre-rollback v2 pair is restored and remains valid.
      assert.equal(recovered.changed, false);
      assert.deepEqual(await readFile(configPath), migratedConfig);
      assert.deepEqual(await readFile(inventoryPath), migratedInventory);
      await assert.rejects(stat(`${configPath}.migrate.transaction.json`));
    });
  });
}

test("migrate v2 validates exact policy and inventory skill-set agreement", async () => {
  await withFixture(async ({ configPath, inventoryPath }) => {
    // Given: a valid applied migration whose generated inventory is later missing one policy skill.
    await run(["migrate", "v2", "--config", configPath, "--yes", "--json"]);
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
    inventory.skills = inventory.skills.filter(({ id }) => id !== "denied");
    await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");

    // When/Then: idempotent validation rejects the disagreement instead of reporting success.
    const result = await run(["migrate", "v2", "--config", configPath, "--yes", "--json"], {}, false);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /policy.*inventory.*skill.set.*agreement/i);
  });
});

test("rollback rejects a requested inventory target that differs from the manifest target", async () => {
  await withFixture(async ({ root, configPath, inventoryPath }) => {
    // Given: migration applied to a non-default but in-project inventory target.
    const applied = await migrateV2({ configPath, inventoryPath, apply: true });
    const migrated = await readFile(configPath);
    const mismatchedInventory = join(root, ".skillboard", "other-inventory.json");

    // When/Then: rollback cannot redirect the manifest snapshot to another inventory path.
    await assert.rejects(
      migrateV2({
        configPath,
        inventoryPath: mismatchedInventory,
        rollbackPath: join(dirname(configPath), applied.backup)
      }),
      /inventory target does not match.*manifest/i
    );
    assert.deepEqual(await readFile(configPath), migrated);
    await assert.rejects(stat(mismatchedInventory));
  });
});

test("migration canonicalizes a symlinked ancestor for inventory and rollback paths", async () => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-migration-alias-"));
  const realRoot = join(root, "real");
  const aliasRoot = join(root, "alias");
  try {
    await mkdir(realRoot);
    await symlink(realRoot, aliasRoot, "dir");
    const configPath = join(aliasRoot, "skillboard.config.yaml");
    const inventoryPath = join(aliasRoot, ".skillboard", "inventory.json");
    await writeFile(configPath, fixture(), "utf8");

    const applied = await migrateV2({ configPath, inventoryPath, apply: true });
    assert.equal(JSON.parse(await readFile(join(realRoot, ".skillboard", "inventory.json"), "utf8")).generated, true);
    await migrateV2({
      configPath,
      inventoryPath,
      rollbackPath: join(aliasRoot, applied.backup)
    });

    assert.match(await readFile(configPath, "utf8"), /version: 1/);
    await assert.rejects(stat(inventoryPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("apply and rollback preserve target modes while backup artifacts stay private", async () => {
  await withFixture(async ({ configPath, inventoryPath }) => {
    // Given: non-default modes on both existing migration targets.
    await mkdir(dirname(inventoryPath), { recursive: true });
    const oldInventory = Buffer.from("{\"old\":true}\n");
    await writeFile(inventoryPath, oldInventory);
    await chmod(configPath, 0o640);
    await chmod(inventoryPath, 0o644);

    // When: migration applies and then rolls back through its manifest.
    const applied = JSON.parse((await run(["migrate", "v2", "--config", configPath, "--yes", "--json"])).stdout);
    if (process.platform !== "win32") {
      assert.equal((await stat(configPath)).mode & 0o777, 0o640);
      assert.equal((await stat(inventoryPath)).mode & 0o777, 0o644);
      assert.equal((await stat(join(dirname(configPath), applied.backup))).mode & 0o777, 0o600);
      assert.equal((await stat(join(dirname(configPath), applied.manifest))).mode & 0o777, 0o600);
    }
    await run(["migrate", "v2", "--config", configPath, "--rollback", join(dirname(configPath), applied.backup), "--json"]);

    // Then: exact bytes and original modes are restored.
    if (process.platform !== "win32") {
      assert.equal((await stat(configPath)).mode & 0o777, 0o640);
      assert.equal((await stat(inventoryPath)).mode & 0o777, 0o644);
    }
    assert.deepEqual(await readFile(inventoryPath), oldInventory);
  });
});

async function withFixture(callback) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-migration-"));
  const configPath = join(root, "skillboard.config.yaml");
  const inventoryPath = join(root, ".skillboard", "inventory.json");
  try {
    await writeFile(configPath, fixture(), "utf8");
    await callback({ root, configPath, inventoryPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function run(args, env = {}, success = true) {
  try {
    const result = await execFileAsync(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
    return { ...result, code: 0 };
  } catch (error) {
    if (success) throw error;
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code ?? 1 };
  }
}

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  return `# keep this comment in the archived source document
version: 1
skills:
  # keep demo policy context
  demo:
    path: demo
    status: active
    invocation: manual-only
    exposure: exported
    x_extension: retained
  denied:
    path: denied
    status: blocked
    invocation: blocked
    exposure: exported
workflows:
  daily:
    harness: codex
    active_skills: [demo]
    blocked_skills: []
`;
}
