import YAML from "yaml";
import { sha256 } from "./v2-files.mjs";

const TARGET_VERSION = 2;
const INVENTORY_FORMAT_VERSION = 1;

export function parseMigrationConfig(text) {
  const document = YAML.parseDocument(text);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  const parsed = document.toJS();
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Config root must be an object mapping");
  }
  return { document, parsed };
}

export function renderMigratedPolicy(policy, sourceText, document) {
  document.set("version", TARGET_VERSION);
  document.delete("workflows");
  let skills = document.get("skills", true);
  if (!YAML.isMap(skills)) {
    skills = document.createNode({});
    document.set("skills", skills);
  }
  const retainedIds = new Set(Object.keys(policy.skills));
  for (const item of [...skills.items]) {
    const id = String(item.key?.value ?? item.key);
    if (!retainedIds.has(id)) skills.delete(id);
  }
  for (const [id, entry] of Object.entries(policy.skills)) {
    skills.set(id, document.createNode(entry));
  }
  for (const key of ["defaults", "capabilities", "harnesses", "install_units"]) {
    document.delete(key);
  }
  const text = String(document);
  return sourceText.includes("\r\n") ? text.replace(/(?<!\r)\n/g, "\r\n") : text;
}

export function migrationInventory(mapped, sourceBytes, losses) {
  return {
    format_version: INVENTORY_FORMAT_VERSION,
    generated: true,
    authoritative_for_availability: false,
    skills: mapped.skills,
    install_units: mapped.install_units,
    migration: {
      source_version: 1,
      target_version: TARGET_VERSION,
      policy_projection_version: TARGET_VERSION,
      invalidates: ["v1-action-id", "v1-guard-hook", "v1-lock-projection"],
      input_sha256: sha256(sourceBytes),
      losses
    }
  };
}

export function migrationReport(before, mapped, inputBytes, configBytes, inventoryBytes) {
  const skillEntries = Object.entries(before.skills ?? {}).sort(([left], [right]) => left.localeCompare(right));
  return {
    target_version: TARGET_VERSION,
    input_sha256: sha256(inputBytes),
    config_sha256: sha256(configBytes),
    inventory_sha256: sha256(inventoryBytes),
    counts: {
      skills: skillEntries.length,
      enabled: Object.values(mapped.policy.skills).filter((skill) => skill.enabled).length,
      disabled: Object.values(mapped.policy.skills).filter((skill) => !skill.enabled).length,
      warnings: mapped.warnings.length,
      losses: mapped.losses.length
    },
    skills: skillEntries.map(([id, skill]) => ({
      id,
      before: { status: skill.status, invocation: skill.invocation, exposure: skill.exposure },
      after: mapped.policy.skills[id]
    })),
    warnings: [...mapped.warnings],
    losses: mapped.losses.map(({ path, disposition }) => ({ path, disposition })),
    ambiguities: mapped.ambiguities,
    grouped_decision: mapped.ambiguities.length === 0 ? null : {
      action: "apply_v2_migration",
      confirmation_option: "--yes",
      ambiguity_count: mapped.ambiguities.length,
      skill_count: mapped.ambiguities.reduce((count, ambiguity) => count + ambiguity.skill_ids.length, 0)
    }
  };
}

export function unchangedMigrationResult(inputBytes) {
  return {
    mode: "apply",
    changed: false,
    target_version: TARGET_VERSION,
    input_sha256: sha256(inputBytes),
    config_sha256: sha256(inputBytes),
    inventory_sha256: null,
    counts: { skills: 0, enabled: 0, disabled: 0, warnings: 0, losses: 0 },
    skills: [],
    warnings: [],
    losses: [],
    ambiguities: [],
    grouped_decision: null,
    backup: null,
    manifest: null,
    inventory_backup: null
  };
}
