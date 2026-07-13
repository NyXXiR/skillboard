import YAML from "yaml";
import { requireRecord } from "../config-helpers.mjs";

const POLICY_KEYS = new Set(["enabled", "shared", "preference"]);
const V1_POLICY_KEYS = new Set([
  "path", "status", "invocation", "exposure", "category", "canonical_for",
  "conflicts_with", "replaced_by", "owner_install_unit", "variant", "scope"
]);
const PREFERENCE_KEYS = new Set(["intents", "priority"]);
const SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const MIGRATION_GUIDANCE = "Run `skillboard migrate v2` to convert version 1 policy.";

export function parseV2Policy(config) {
  const unknownRootKeys = Object.keys(config).filter((key) => !["version", "skills"].includes(key));
  if (unknownRootKeys.length > 0) {
    throw new Error(`Version 2 config contains unsupported policy section: ${unknownRootKeys.join(", ")}. ${MIGRATION_GUIDANCE}`);
  }
  const rawSkills = requireRecord(config.skills ?? {}, "skills");
  const skills = Object.entries(rawSkills)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, entry]) => parseSkillPolicy(id, entry));
  return { workflows: [], skills };
}

export function serializeV2Policy(workspace) {
  if (workspace.version !== 2) {
    throw new Error("serializeV2Policy requires a version 2 workspace");
  }
  const config = {
    version: 2,
    skills: Object.fromEntries(workspace.skills.map((skill) => [skill.id, serializeSkill(skill)]))
  };
  return YAML.stringify(config, { lineWidth: 0 });
}

function parseSkillPolicy(id, entry) {
  if (!SKILL_ID_PATTERN.test(id)) {
    throw new Error(`Version 2 config contains invalid skill id: ${id}`);
  }
  const label = `skills.${id}`;
  const raw = requireRecord(entry, label);
  const keys = Object.keys(raw);
  const v1Keys = keys.filter((key) => V1_POLICY_KEYS.has(key));
  if (v1Keys.length > 0) {
    throw new Error(`${label} mixes version 1 key ${v1Keys.join(", ")} with version 2 policy. ${MIGRATION_GUIDANCE}`);
  }
  const unknownKeys = keys.filter((key) => !POLICY_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${label} contains unsupported version 2 policy key: ${unknownKeys.join(", ")}. ${MIGRATION_GUIDANCE}`);
  }
  if (typeof raw.enabled !== "boolean") {
    throw new Error(`${label}.enabled is required and must be a boolean`);
  }
  if (typeof raw.shared !== "boolean") {
    throw new Error(`${label}.shared is required and must be a boolean`);
  }
  return {
    id,
    enabled: raw.enabled,
    shared: raw.shared,
    preference: parsePreference(raw.preference, label)
  };
}

function parsePreference(value, label) {
  if (value === undefined) {
    return null;
  }
  const raw = requireRecord(value, `${label}.preference`);
  const unknownKeys = Object.keys(raw).filter((key) => !PREFERENCE_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${label}.preference contains unsupported key: ${unknownKeys.join(", ")}`);
  }
  const intents = raw.intents;
  if (!Array.isArray(intents) || intents.length === 0 || intents.some((intent) => typeof intent !== "string" || intent.trim() === "")) {
    throw new Error(`${label}.preference.intents must be a non-empty list of intent terms`);
  }
  assertUnique(intents, `${label}.preference.intents`);
  assertSorted(intents, `${label}.preference.intents`);
  if (!Number.isInteger(raw.priority)) {
    throw new Error(`${label}.preference.priority is required and must be an integer`);
  }
  return { intents: [...intents], priority: raw.priority };
}

function serializeSkill(skill) {
  return {
    enabled: skill.enabled,
    shared: skill.shared,
    ...(skill.preference === null ? {} : {
      preference: { intents: [...skill.preference.intents], priority: skill.preference.priority }
    })
  };
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${label} must not contain duplicates: ${value}`);
    }
    seen.add(value);
  }
}

function assertSorted(values, label) {
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  if (values.some((value, index) => value !== sorted[index])) {
    throw new Error(`${label} must be sorted`);
  }
}
