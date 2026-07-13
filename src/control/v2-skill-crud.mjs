import { ensureMapAt, loadConfig, requireYamlMap, withPolicyMutationLock, writeCheckedConfig } from "./config-write.mjs";

export async function setV2SkillEnabled(options) {
  return mutate(options, (skill) => skill.set("enabled", options.enabled), `${options.enabled ? "Enabled" : "Disabled"} ${options.skillId}`);
}

export async function setV2SkillShared(options) {
  return mutate(options, (skill) => skill.set("shared", options.shared), `${options.shared ? "Shared" : "Unshared"} ${options.skillId}`);
}

export async function setV2SkillPreference(options) {
  const intents = names(options.intents, "--intent");
  if (!Number.isInteger(options.priority)) throw new Error("--priority must be an integer");
  return mutate(options, (skill, document) => skill.set("preference", document.createNode({ intents, priority: options.priority })), `Updated preference for ${options.skillId}`);
}

async function mutate(options, update, message) {
  return await withPolicyMutationLock(options.configPath, async (configPath) => {
    const { document, originalText } = await loadConfig(configPath);
    const skills = ensureMapAt(document, ["skills"], "skills");
    const raw = skills.get(options.skillId, true);
    if (raw === undefined) throw new Error(`Unknown skill: ${options.skillId}`);
    update(requireYamlMap(raw, `skills.${options.skillId}`), document);
    return await writeCheckedConfig(document, originalText, { ...options, configPath }, message);
  });
}

function names(values, option) {
  const result = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
  if (result.length === 0) throw new Error(`${option} requires at least one value`);
  return result;
}
