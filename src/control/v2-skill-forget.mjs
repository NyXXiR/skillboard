import { loadWorkspace } from "../workspace.mjs";
import {
  loadConfig,
  requireYamlMap,
  withPolicyMutationLock,
  writeCheckedConfig
} from "./config-write.mjs";

export async function forgetV2Skill(options) {
  return await withPolicyMutationLock(options.configPath, async (configPath) => {
    const workspace = await loadWorkspace({
      configPath,
      inventoryPath: options.inventoryPath,
      skillsRoot: options.skillsRoot
    });
    const policy = workspace.skills.find((skill) => skill.id === options.skillId);
    if (policy === undefined) throw new Error(`Unknown skill: ${options.skillId}`);
    if (workspace.inventory.integrityErrors.length > 0) {
      throw new Error(`Cannot forget a skill while generated inventory is unhealthy: ${workspace.inventory.integrityErrors.join("; ")}`);
    }
    if (policy.shared) {
      throw new Error(`Skill ${options.skillId} is shared. Run skillboard skill unshare ${options.skillId} before forgetting it.`);
    }
    if (workspace.inventory.skills.some((skill) => skill.id === options.skillId)) {
      throw new Error(`Skill ${options.skillId} is still installed. Remove it from its owning agent before forgetting its policy.`);
    }

    const { document, originalText } = await loadConfig(configPath);
    const skills = requireYamlMap(document.get("skills", true), "skills");
    skills.delete(options.skillId);
    return await writeCheckedConfig(
      document,
      originalText,
      { ...options, configPath },
      `Forgot ${options.skillId}`
    );
  });
}
