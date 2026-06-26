import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { discoverAgentSkillInventory, mergeAgentSkillInventory } from "./agent-inventory.mjs";
import { textChangePlan } from "./change-plan.mjs";

export async function refreshAgentInventory(options = {}) {
  const root = resolve(options.root ?? ".");
  const configPath = resolveUnderRoot(root, options.configPath ?? "skillboard.config.yaml");
  const inventory = await discoverAgentSkillInventory({
    roots: options.roots,
    home: options.home,
    env: options.env
  });
  const current = await readFile(configPath, "utf8");
  const merged = mergeAgentSkillInventory(current, inventory);
  const plan = textChangePlan(current, merged.text);
  const dryRun = options.dryRun === true;

  if (plan.changed && !dryRun) {
    await writeFile(configPath, merged.text, "utf8");
  }

  return {
    dryRun,
    configPath,
    changed: plan.changed,
    plan,
    scan: {
      scannedSkills: inventory.scannedSkills ?? inventory.skills.length,
      scannedInstallUnits: inventory.installUnits.length,
      addedSkills: merged.addedSkills,
      addedInstallUnits: merged.addedInstallUnits,
      updatedInstallUnits: merged.updatedInstallUnits,
      addedWorkflows: merged.addedWorkflows,
      addedHarnesses: merged.addedHarnesses,
      skippedSkills: merged.skippedSkills,
      reviewNotes: merged.reviewNotes,
      warnings: inventory.warnings ?? []
    }
  };
}

function resolveUnderRoot(root, path) {
  return isAbsolute(path) ? path : resolve(root, path);
}
