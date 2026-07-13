import { EXPOSURE_VALUES, INVOCATION_VALUES, STATUS_VALUES } from "../domain/constants.mjs";
import { TERMINAL_STATUSES, validateSkillState } from "../domain/skill-state-matrix.mjs";

const V1_SKILL_POLICY_FIELDS = new Set(["status", "invocation", "exposure"]);
const V1_SKILL_LOCATION_FIELDS = new Set(["path", "owner_install_unit"]);

/**
 * Purely project a parsed v1 config into v2 policy and audit observations.
 * The caller retains ownership of input and may safely hash/reuse it afterward.
 */
export function mapV1ConfigToV2(input) {
  const config = requireRecord(input, "v1 config");
  if (config.version !== undefined && config.version !== 1) {
    throw new Error(`Expected version 1 config; got version ${String(config.version)}`);
  }
  const skills = requireRecord(config.skills ?? {}, "v1 config skills");
  const workflows = requireRecord(config.workflows ?? {}, "v1 config workflows");
  const capabilities = requireRecord(config.capabilities ?? {}, "v1 config capabilities");
  const installUnits = requireRecord(config.install_units ?? {}, "v1 config install_units");
  const workflowNames = Object.keys(workflows).sort();
  const warnings = [];
  const losses = collectLosses(config);
  const policySkills = {};
  const inventorySkills = [];
  const uncertainQuarantines = [];

  for (const [skillId, rawSkill] of Object.entries(skills).sort(byEntryKey)) {
    const skill = requireRecord(rawSkill, `skill ${skillId}`);
    validateState(skillId, skill);
    const enabled = !TERMINAL_STATUSES.has(skill.status);
    const preference = preferenceFor(skillId, capabilities, workflows);
    policySkills[skillId] = {
      enabled,
      shared: false,
      ...(preference === null ? {} : { preference })
    };
    if (isReviewOnlyQuarantine(skillId, skill, workflowNames, workflows)) {
      uncertainQuarantines.push(skillId);
    }
    inventorySkills.push(skillObservation(skillId, skill));
  }

  const ambiguities = uncertainQuarantines.length === 0 ? [] : [{
    kind: "review_only_quarantine",
    skill_ids: uncertainQuarantines,
    mapped_enabled: true,
    requires_grouped_confirmation: true
  }];
  if (uncertainQuarantines.length > 0) {
    warnings.push(
      `${uncertainQuarantines.length} review-only quarantine state(s) were mapped enabled; confirm them together when applying the migration.`
    );
  }

  return {
    policy: {
      version: 2,
      skills: policySkills
    },
    inventory: {
      format_version: 1,
      skills: inventorySkills,
      install_units: Object.entries(installUnits).sort(byEntryKey).map(([id, unit]) => ({
        id,
        observations: clone(requireRecord(unit, `install unit ${id}`))
      }))
    },
    warnings,
    losses,
    ambiguities
  };
}

function isReviewOnlyQuarantine(skillId, skill, workflowNames, workflows) {
  if (skill.status !== "quarantined" || skill.invocation !== "blocked") return false;
  return !workflowNames.some((name) => stringList(workflows[name]?.blocked_skills).includes(skillId));
}

function validateState(skillId, skill) {
  if (!STATUS_VALUES.has(skill.status)) {
    throw new Error(`Skill ${skillId} has unsupported status: ${String(skill.status)}`);
  }
  if (!INVOCATION_VALUES.has(skill.invocation)) {
    throw new Error(`Skill ${skillId} has unsupported invocation: ${String(skill.invocation)}`);
  }
  if (!EXPOSURE_VALUES.has(skill.exposure)) {
    throw new Error(`Skill ${skillId} has unsupported exposure: ${String(skill.exposure)}`);
  }
  const diagnostic = validateSkillState(skill.status, skill.invocation, skillId);
  if (typeof diagnostic === "string") throw new Error(diagnostic);
}

function preferenceFor(skillId, capabilities, workflows) {
  const roles = [];
  for (const [name, rawCapability] of Object.entries(capabilities)) {
    const capability = requireRecord(rawCapability, `capability ${name}`);
    if (capability.canonical === skillId) roles.push({ intent: name, priority: 100 });
    if (stringList(capability.alternatives).includes(skillId)) roles.push({ intent: name, priority: 50 });
  }
  for (const rawWorkflow of Object.values(workflows)) {
    const workflow = requireRecord(rawWorkflow, "workflow");
    const requirements = requireRecord(workflow.required_capabilities ?? {}, "workflow required_capabilities");
    for (const [name, rawRequirement] of Object.entries(requirements)) {
      const requirement = requireRecord(rawRequirement, `workflow capability ${name}`);
      if (requirement.preferred === skillId) roles.push({ intent: name, priority: 100 });
      stringList(requirement.fallback).forEach((candidate, index) => {
        if (candidate === skillId) roles.push({ intent: name, priority: 90 - index });
      });
    }
  }
  if (roles.length === 0) return null;
  return {
    intents: [...new Set(roles.map(({ intent }) => intent))].sort(),
    priority: Math.max(...roles.map(({ priority }) => priority))
  };
}

function skillObservation(id, skill) {
  const aliases = Array.isArray(skill.source_aliases) ? clone(skill.source_aliases) : [];
  const observations = Object.fromEntries(
    Object.entries(skill)
      .filter(([key]) => !V1_SKILL_POLICY_FIELDS.has(key)
        && !V1_SKILL_LOCATION_FIELDS.has(key)
        && key !== "source_aliases")
      .map(([key, value]) => [key, clone(value)])
  );
  return {
    id,
    path: typeof skill.path === "string" && skill.path.length > 0 ? skill.path : id,
    owner_install_unit: typeof skill.owner_install_unit === "string" && skill.owner_install_unit.length > 0
      ? skill.owner_install_unit
      : "migration.unowned",
    aliases,
    installed_on: installedAgents(skill),
    observations
  };
}

function installedAgents(skill) {
  const units = [skill.owner_install_unit, ...(skill.source_aliases ?? []).map((alias) => alias?.owner_install_unit)];
  return [...new Set(units.map(agentForUnit).filter(Boolean))].sort();
}

function agentForUnit(unit) {
  if (typeof unit !== "string") return "";
  return ["codex", "claude", "opencode", "hermes"].find((agent) => unit === agent || unit.startsWith(`${agent}.`)) ?? "";
}

function collectLosses(config) {
  const losses = [];
  visit(config, "", (path, value) => {
    if (path === "/version") return;
    losses.push({ path, value: clone(value), disposition: lossDisposition(path) });
  });
  return losses;
}

function visit(value, path, add) {
  if (value === null || typeof value !== "object") {
    add(path, value);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) add(path, []);
    value.forEach((entry, index) => visit(entry, `${path}/${index}`, add));
    return;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) add(path, {});
  entries.forEach(([key, entry]) => visit(entry, `${path}/${escapePointer(key)}`, add));
}

function lossDisposition(path) {
  if (/^\/skills\/[^/]+\/(status|invocation|exposure)$/.test(path)) return "mapped_to_v2_policy";
  if (path.startsWith("/skills/") || path.startsWith("/install_units/")) return "preserved_in_inventory_observation";
  if (path.startsWith("/capabilities/") || path.startsWith("/workflows/")) return "mapped_where_applicable";
  return "not_part_of_v2_policy";
}

function requireRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object mapping`);
  }
  return value;
}

function stringList(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Expected a list of strings in v1 config");
  }
  return value;
}

function clone(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => clone(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

/** @param {[string, unknown]} left @param {[string, unknown]} right */
function byEntryKey(left, right) {
  return left[0].localeCompare(right[0]);
}

function escapePointer(value) {
  return value.split("~").join("~0").split("/").join("~1");
}
