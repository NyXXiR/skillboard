import { dirname, join, resolve } from "node:path";
import { canAutomaticallyMigrateV2 } from "./migration/automatic-v2.mjs";
import { migrateV2 } from "./migration/v2-transaction.mjs";

export async function upgradeLegacyUserPolicy(options) {
  if (options.inventoryPath !== null) {
    return { status: "current", inventoryPath: options.inventoryPath, artifacts: [] };
  }

  const inventoryPath = resolve(options.home, ".skillboard", "inventory.json");
  const migrationOptions = {
    configPath: options.configPath,
    inventoryPath,
    failpoint: options.failpoint
  };
  const preview = await migrateV2({ ...migrationOptions, apply: false });
  const observed = new Set(options.observedSkillIds);
  const unobservedSkillIds = preview.skills.map(({ id }) => id).filter((id) => !observed.has(id));
  if (!canAutomaticallyMigrateV2(preview) || unobservedSkillIds.length > 0) {
    return {
      status: "decision-required",
      inventoryPath: null,
      artifacts: [],
      preview,
      unobservedSkillIds
    };
  }

  const applied = await migrateV2({
    ...migrationOptions,
    apply: true,
    expectedInputSha256: preview.input_sha256
  });
  const directory = dirname(options.configPath);
  const artifactNames = [applied.backup, applied.manifest, applied.inventory_backup].filter(Boolean);
  return {
    status: "upgraded",
    inventoryPath,
    backupPath: join(directory, applied.backup),
    artifacts: artifactNames.map((name) => join(directory, name)),
    report: applied
  };
}
