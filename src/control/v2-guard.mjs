import { readFile } from "node:fs/promises";
import { supportedAgentNames } from "../agent-skill-roots.mjs";

export async function loadV2InventoryIndex(path) {
  const text = await readFile(path, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (text === null) {
    return { path, integrityErrors: [`generated inventory is missing: ${path}`], skillIds: [], skills: [], installUnits: [] };
  }
  try {
    const value = JSON.parse(text);
    const errors = validateInventory(value);
    const skillIds = errors.length === 0
      ? value.skills.map((skill) => skill.id).sort((left, right) => left.localeCompare(right))
      : [];
    const installUnits = errors.length === 0
      ? (value.install_units ?? []).map(projectInstallUnitObservation)
      : [];
    return { path, integrityErrors: errors, skillIds, skills: errors.length === 0 ? value.skills : [], installUnits };
  } catch (error) {
    return { path, integrityErrors: [`generated inventory is invalid JSON: ${errorMessage(error)}`], skillIds: [], skills: [], installUnits: [] };
  }
}

export function authorizeV2Skill(skillId, policy, inventory, agentName) {
  if (typeof agentName !== "string" || agentName.length === 0) {
    return {
      allowed: false,
      integrityError: false,
      reasons: ["Current agent is required for version 2 availability checks."]
    };
  }
  if (!supportedAgentNames().includes(agentName)) {
    return {
      allowed: false,
      integrityError: false,
      reasons: [`Unsupported agent: ${agentName}.`]
    };
  }
  const integrityReasons = inventoryIntegrityReasons(inventory, skillId);
  if (integrityReasons.length > 0) {
    return { allowed: false, integrityError: true, reasons: integrityReasons };
  }
  if (policy === undefined) {
    return { allowed: false, integrityError: false, reasons: ["Skill has no version 2 policy entry."] };
  }
  if (!policy.enabled) {
    return { allowed: false, integrityError: false, reasons: [`Skill ${policy.id} is disabled.`] };
  }
  const observation = inventory.skills?.find((skill) => skill.id === skillId);
  const installedOn = Array.isArray(observation?.installed_on) ? observation.installed_on : [];
  if (!installedOn.includes(agentName)) {
    return {
      allowed: false,
      integrityError: false,
      reasons: [`Skill ${policy.id} is not installed for agent ${agentName}.`]
    };
  }
  return { allowed: true, integrityError: false, reasons: [] };
}

function validateInventory(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["generated inventory root must be an object"];
  }
  const errors = [];
  if (value.format_version !== 1) errors.push("generated inventory format_version must be 1");
  if (value.generated !== true) errors.push("generated inventory must declare generated: true");
  if (value.authoritative_for_availability !== false) {
    errors.push("generated inventory must declare authoritative_for_availability: false");
  }
  if (!Array.isArray(value.skills)) {
    errors.push("generated inventory skills must be an array");
    return errors;
  }
  const ids = new Set();
  for (const [index, skill] of value.skills.entries()) {
    if (skill === null || typeof skill !== "object" || Array.isArray(skill)) {
      errors.push(`generated inventory skill ${index} must be an object`);
      continue;
    }
    for (const field of ["id", "path", "owner_install_unit"]) {
      if (typeof skill[field] !== "string" || skill[field].trim() === "") {
        errors.push(`generated inventory skill ${index}.${field} must be a non-empty string`);
      }
    }
    if (skill.installed_on !== undefined && (!Array.isArray(skill.installed_on)
      || skill.installed_on.some((agent) => typeof agent !== "string" || agent.trim() === ""))) {
      errors.push(`generated inventory skill ${index}.installed_on must be a list of agent names`);
    }
    if (typeof skill.id === "string") {
      if (ids.has(skill.id)) errors.push(`generated inventory contains duplicate skill id: ${skill.id}`);
      ids.add(skill.id);
    }
  }
  if (value.install_units !== undefined && !Array.isArray(value.install_units)) {
    errors.push("generated inventory install_units must be an array");
    return errors;
  }
  const unitIds = new Set();
  for (const [index, unit] of (value.install_units ?? []).entries()) {
    if (unit === null || typeof unit !== "object" || Array.isArray(unit)) {
      errors.push(`generated inventory install unit ${index} must be an object`);
      continue;
    }
    if (typeof unit.id !== "string" || unit.id.trim() === "") {
      errors.push(`generated inventory install unit ${index}.id must be a non-empty string`);
    } else if (unitIds.has(unit.id)) {
      errors.push(`generated inventory contains duplicate install unit id: ${unit.id}`);
    } else {
      unitIds.add(unit.id);
    }
  }
  return errors;
}

function projectInstallUnitObservation(unit) {
  const runtime = unit.runtime_components ?? {};
  return {
    id: unit.id,
    kind: unit.kind ?? "skill",
    sourceClass: unit.source_class,
    priority: undefined,
    trustLevel: unit.trust_observation ?? "unreviewed",
    sourceDigest: unit.source_digest,
    signature: unit.signature_observed === true ? "observed" : undefined,
    publicKey: undefined,
    verifiedAt: unit.verified_at,
    source: unit.source ?? "",
    scope: "inventory-observation",
    manifestPath: unit.manifest_path ?? "",
    cachePath: unit.cache_path ?? "",
    providedComponents: [],
    components: {
      skills: stringList(unit.skills),
      commands: stringList(runtime.commands),
      hooks: stringList(runtime.hooks),
      mcpServers: stringList(runtime.mcp_servers)
    },
    modifiedConfigFiles: [],
    autoUpdate: false,
    enabled: true,
    workflowDependencies: [],
    permissionRisk: unit.permission_risk ?? "unknown",
    rollback: "observation-only"
  };
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function inventoryIntegrityReasons(inventory, skillId) {
  if (inventory === null || typeof inventory !== "object") {
    return ["Inventory integrity error: generated inventory is unavailable."];
  }
  if (Array.isArray(inventory.integrityErrors) && inventory.integrityErrors.length > 0) {
    return inventory.integrityErrors.map((reason) => `Inventory integrity error: ${reason}`);
  }
  const ids = inventory.skillIds instanceof Set
    ? inventory.skillIds
    : new Set(Array.isArray(inventory.skillIds) ? inventory.skillIds : []);
  if (!ids.has(skillId)) {
    return [`Inventory integrity error: skill ${skillId ?? "<unknown>"} is missing from generated inventory.`];
  }
  return [];
}
