import YAML from "yaml";
import {
  EXPOSURE_VALUES,
  INVOCATION_VALUES,
  NON_CALLABLE_WORKFLOW_INVOCATIONS,
  NON_CALLABLE_WORKFLOW_STATUSES,
  STATUS_VALUES
} from "../domain/constants.mjs";
import { normalizeSkillPath } from "../skill-paths.mjs";
import {
  addUnique,
  ensureMapAt,
  ensureSeq,
  loadConfig,
  mapValues,
  nodeScalarValue,
  optionalMap,
  optionalRootMap,
  optionalSeq,
  readMapString,
  removeValue,
  requireMapAt,
  requireYamlMap,
  sequenceIncludes,
  uniqueValues,
  writeCheckedConfig
} from "./config-write.mjs";
import { canUseSkill } from "./can-use-guard.mjs";

const WRITABLE_INVOCATIONS = new Set(["manual-only", "router-only", "workflow-auto", "global-auto"]);

export async function activateSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skill = requireConfigSkill(document, options.skillId);
  const workflow = requireConfigWorkflow(document, options.workflow);
  const mode = options.mode ?? readMapString(skill, "invocation", "manual-only");

  if (!WRITABLE_INVOCATIONS.has(mode) || mode === "global-auto") {
    throw new Error(`activate requires --mode manual-only, router-only, or workflow-auto; got ${mode}`);
  }
  skill.set("status", "active");
  skill.set("invocation", mode);
  addUnique(ensureSeq(workflow, "active_skills", document), options.skillId);
  removeValue(ensureSeq(workflow, "blocked_skills", document), options.skillId);

  return await writeCheckedConfig(
    document,
    originalText,
    { ...options, validateUse: { skillId: options.skillId, workflow: options.workflow } },
    `Activated ${options.skillId} in ${options.workflow} as ${mode}`
  );
}

export async function addSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skills = ensureMapAt(document, ["skills"], "skills");
  if (skills.get(options.skillId, true) !== undefined) {
    throw new Error(`Skill already exists: ${options.skillId}`);
  }
  const skillPath = normalizeSkillPath(options.path, "skill path");
  const status = options.status ?? (options.workflow === undefined ? "candidate" : "active");
  const invocation = options.invocation ?? "manual-only";
  const exposure = options.exposure ?? "exported";
  validateSkillState(status, invocation, exposure);
  skills.set(options.skillId, document.createNode(stripUndefined({
    path: skillPath,
    status,
    invocation,
    exposure,
    category: options.category ?? "user",
    owner_install_unit: options.ownerInstallUnit
  })));
  if (options.workflow !== undefined) {
    const workflow = requireConfigWorkflow(document, options.workflow);
    addUnique(ensureSeq(workflow, "active_skills", document), options.skillId);
    removeValue(ensureSeq(workflow, "blocked_skills", document), options.skillId);
  }
  const validation = options.workflow === undefined
    ? options
    : { ...options, validateUse: { skillId: options.skillId, workflow: options.workflow } };
  return await writeCheckedConfig(document, originalText, validation, `Added ${options.skillId}`);
}

export async function addSkillVariant(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skills = requireMapAt(document, ["skills"], "skills");
  const baseSkill = requireConfigSkill(document, options.baseId);
  const workflow = requireConfigWorkflow(document, options.workflow);
  const capabilityDefinition = requireConfigCapability(document, options.capability);
  const existingRequiredPolicy = readRequiredCapabilityPolicy(workflow, options.capability);
  const required = ensureRequiredCapability(workflow, options.capability, document);
  const existingVariant = skills.get(options.variantId, true);

  if (existingVariant === undefined) {
    if (options.path === undefined) {
      throw new Error("--path is required when adding an undeclared variant skill");
    }
    if (options.ownerInstallUnit !== undefined) {
      appendSkillToOwnerInstallUnit(document, options.ownerInstallUnit, options.variantId);
    }
    const invocation = variantInvocation(options, existingRequiredPolicy, capabilityDefinition);
    validateSkillState("active", invocation, "exported");
    skills.set(options.variantId, document.createNode(stripUndefined({
      path: normalizeSkillPath(options.path, "skill path"),
      status: "active",
      invocation,
      exposure: "exported",
      category: options.category ?? readMapString(baseSkill, "category", "uncategorized"),
      owner_install_unit: options.ownerInstallUnit
    })));
  } else {
    requireYamlMap(existingVariant, `skills.${options.variantId}`);
  }

  const alternatives = ensureSeq(capabilityDefinition, "alternatives", document);
  const canonical = readMapString(capabilityDefinition, "canonical", "");
  if (canonical !== options.baseId && !sequenceIncludes(alternatives, options.baseId)) {
    addUnique(alternatives, options.baseId);
  }
  if (canonical !== options.variantId && !sequenceIncludes(alternatives, options.variantId)) {
    addUnique(alternatives, options.variantId);
  }

  const previousPreferred = readMapString(required, "preferred", "");
  const fallback = ensureSeq(required, "fallback", document);
  required.set("preferred", options.variantId);
  setFallbackValues(
    fallback,
    orderedVariantFallbacks(
      sequenceValues(fallback),
      [previousPreferred, options.baseId, canonical],
      options.variantId
    )
  );
  addUnique(ensureSeq(workflow, "active_skills", document), options.variantId);
  removeValue(ensureSeq(workflow, "blocked_skills", document), options.variantId);

  return await writeCheckedConfig(
    document,
    originalText,
    { ...options, validateUse: { skillId: options.variantId, workflow: options.workflow } },
    `Added variant ${options.variantId} for ${options.baseId} in ${options.workflow}`
  );
}

export async function blockSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  requireConfigSkill(document, options.skillId);
  const workflow = requireConfigWorkflow(document, options.workflow);

  addUnique(ensureSeq(workflow, "blocked_skills", document), options.skillId);
  removeValue(ensureSeq(workflow, "active_skills", document), options.skillId);
  removeSkillFromRequiredCapabilities(workflow, options.skillId, document);
  downgradeIfUnscopedWorkflowAuto(document, options.skillId);

  return await writeCheckedConfig(document, originalText, options, `Blocked ${options.skillId} in ${options.workflow}`);
}

export async function quarantineSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skill = requireConfigSkill(document, options.skillId);

  skill.set("status", "quarantined");
  skill.set("invocation", "blocked");
  const workflows = requireMapAt(document, ["workflows"], "workflows");
  for (const workflow of mapValues(workflows, "workflow")) {
    removeValue(ensureSeq(workflow, "active_skills", document), options.skillId);
    removeSkillFromRequiredCapabilities(workflow, options.skillId, document);
  }

  return await writeCheckedConfig(document, originalText, options, `Quarantined ${options.skillId}`);
}

export async function removeSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skills = requireMapAt(document, ["skills"], "skills");
  requireConfigSkill(document, options.skillId);
  const references = configSkillReferences(document, options.skillId);
  if (references.length > 0 && options.force !== true) {
    throw new Error(`Skill ${options.skillId} is still referenced: ${references.join(", ")}. Re-run with --force to remove config references first.`);
  }
  removeSkillReferences(document, options.skillId);
  skills.delete(options.skillId);
  return await writeCheckedConfig(document, originalText, options, `Removed ${options.skillId}`);
}

export async function preferSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skill = requireConfigSkill(document, options.skillId);
  const workflow = requireConfigWorkflow(document, options.workflow);
  const capabilities = requireMapAt(document, ["capabilities"], "capabilities");
  const capabilityDefinition = capabilities.get(options.capability, true);
  if (capabilityDefinition === undefined) {
    throw new Error(`Unknown capability: ${options.capability}`);
  }
  const required = ensureRequiredCapability(workflow, options.capability, document);
  const previousPreferred = readMapString(required, "preferred", "");
  if (previousPreferred.length > 0 && previousPreferred !== options.skillId) {
    addUnique(ensureSeq(required, "fallback", document), previousPreferred);
  }
  required.set("preferred", options.skillId);
  removeValue(ensureSeq(required, "fallback", document), options.skillId);
  addUnique(ensureSeq(workflow, "active_skills", document), options.skillId);
  removeValue(ensureSeq(workflow, "blocked_skills", document), options.skillId);
  const status = readMapString(skill, "status", "vendor");
  const invocation = readMapString(skill, "invocation", "manual-only");
  if (status === "quarantined" || status === "blocked") {
    skill.set("status", "active");
  }
  if (invocation === "blocked" || invocation === "deprecated") {
    const requiredPolicy = readMapString(required, "policy", "");
    const defaultPolicy = YAML.isMap(capabilityDefinition) ? readMapString(capabilityDefinition, "default_policy", "manual-only") : "manual-only";
    skill.set("invocation", requiredPolicy.length > 0 ? requiredPolicy : defaultPolicy);
  }

  return await writeCheckedConfig(
    document,
    originalText,
    { ...options, validateUse: { skillId: options.skillId, workflow: options.workflow } },
    `Preferred ${options.skillId} for ${options.capability} in ${options.workflow}`
  );
}

function requireConfigSkill(document, skillId) {
  const skills = requireMapAt(document, ["skills"], "skills");
  const skill = skills.get(skillId, true);
  if (skill === undefined) {
    throw new Error(`Unknown skill: ${skillId}`);
  }
  return requireYamlMap(skill, `skills.${skillId}`);
}

function requireConfigWorkflow(document, workflowName) {
  const workflows = requireMapAt(document, ["workflows"], "workflows");
  const workflow = workflows.get(workflowName, true);
  if (workflow === undefined) {
    throw new Error(`Unknown workflow: ${workflowName}`);
  }
  const raw = requireYamlMap(workflow, `workflows.${workflowName}`);
  ensureSeq(raw, "active_skills", document);
  ensureSeq(raw, "blocked_skills", document);
  const requiredCapabilities = raw.get("required_capabilities", true);
  if (requiredCapabilities !== undefined) {
    requireYamlMap(requiredCapabilities, `workflows.${workflowName}.required_capabilities`);
  }
  return raw;
}

function requireConfigCapability(document, capabilityName) {
  const capabilities = requireMapAt(document, ["capabilities"], "capabilities");
  const capability = capabilities.get(capabilityName, true);
  if (capability === undefined) {
    throw new Error(`Unknown capability: ${capabilityName}`);
  }
  return requireYamlMap(capability, `capabilities.${capabilityName}`);
}

function appendSkillToOwnerInstallUnit(document, unitId, skillId) {
  const installUnits = optionalRootMap(document, "install_units");
  if (installUnits === undefined) {
    throw new Error(`Unknown install unit: ${unitId}`);
  }
  const installUnit = installUnits.get(unitId, true);
  if (installUnit === undefined) {
    throw new Error(`Unknown install unit: ${unitId}`);
  }
  const unit = requireYamlMap(installUnit, `install_units.${unitId}`);
  let components = unit.get("components", true);
  if (components === undefined) {
    components = document.createNode({});
    unit.set("components", components);
  }
  addUnique(ensureSeq(requireYamlMap(components, `install_units.${unitId}.components`), "skills", document), skillId);
}

function ensureRequiredCapability(workflow, capabilityName, document) {
  let capabilities = workflow.get("required_capabilities", true);
  if (capabilities === undefined) {
    capabilities = document.createNode({});
    workflow.set("required_capabilities", capabilities);
  }
  const capabilityMap = requireYamlMap(capabilities, "required_capabilities");
  if (capabilityMap.get(capabilityName, true) === undefined) {
    capabilityMap.set(capabilityName, document.createNode({
      preferred: "",
      fallback: [],
      policy: "manual-only"
    }));
  }
  const capability = requireYamlMap(capabilityMap.get(capabilityName, true), `required_capabilities.${capabilityName}`);
  ensureSeq(capability, "fallback", document);
  return capability;
}

function readRequiredCapabilityPolicy(workflow, capabilityName) {
  const capabilities = optionalMap(workflow, "required_capabilities");
  if (capabilities === undefined) {
    return "";
  }
  const capability = capabilities.get(capabilityName, true);
  if (capability === undefined) {
    return "";
  }
  return readMapString(requireYamlMap(capability, `required_capabilities.${capabilityName}`), "policy", "");
}

function variantInvocation(options, requiredPolicy, capabilityDefinition) {
  const explicit = options.mode ?? options.invocation;
  const computed = firstNonEmpty([
    explicit,
    requiredPolicy,
    readMapString(capabilityDefinition, "default_policy", ""),
    "manual-only"
  ]);
  return computed === "global-auto" ? "manual-only" : computed;
}

function firstNonEmpty(values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? "manual-only";
}

function sequenceValues(sequence) {
  return sequence.items.map((item) => nodeScalarValue(item));
}

function orderedVariantFallbacks(existingValues, priorityValues, variantId) {
  const next = [];
  const seen = new Set();
  for (const value of [...priorityValues, ...existingValues]) {
    if (typeof value !== "string" || value.length === 0 || value === variantId || seen.has(value)) {
      continue;
    }
    next.push(value);
    seen.add(value);
  }
  return next;
}

function setFallbackValues(sequence, values) {
  while (sequence.items.length > 0) {
    sequence.delete(0);
  }
  for (const value of values) {
    sequence.add(value);
  }
}

function removeSkillFromRequiredCapabilities(workflow, skillId, document) {
  const capabilities = optionalMap(workflow, "required_capabilities");
  if (capabilities === undefined) {
    return;
  }
  for (const capability of mapValues(capabilities, "required_capability")) {
    if (readMapString(capability, "preferred", "") === skillId) {
      capability.set("preferred", "");
    }
    removeValue(ensureSeq(capability, "fallback", document), skillId);
  }
}

function configSkillReferences(document, skillId) {
  return [
    ...workflowReferences(document, skillId),
    ...capabilityReferences(document, skillId),
    ...installUnitReferences(document, skillId)
  ];
}

function workflowReferences(document, skillId) {
  const workflows = optionalRootMap(document, "workflows");
  if (workflows === undefined) {
    return [];
  }
  const references = [];
  for (const pair of workflows.items) {
    const name = nodeScalarValue(pair.key);
    const workflow = requireYamlMap(pair.value, `workflows.${name}`);
    const activeSkills = optionalSeq(workflow, "active_skills");
    const blockedSkills = optionalSeq(workflow, "blocked_skills");
    if (activeSkills !== undefined && sequenceIncludes(activeSkills, skillId)) {
      references.push(`workflow ${name}.active_skills`);
    }
    if (blockedSkills !== undefined && sequenceIncludes(blockedSkills, skillId)) {
      references.push(`workflow ${name}.blocked_skills`);
    }
    const requiredCapabilities = optionalMap(workflow, "required_capabilities");
    if (requiredCapabilities === undefined) {
      continue;
    }
    for (const capabilityPair of requiredCapabilities.items) {
      const capabilityName = nodeScalarValue(capabilityPair.key);
      const requirement = requireYamlMap(capabilityPair.value, `workflows.${name}.required_capabilities.${capabilityName}`);
      if (readMapString(requirement, "preferred", "") === skillId) {
        references.push(`workflow ${name}.required_capabilities.${capabilityName}.preferred`);
      }
      const fallback = optionalSeq(requirement, "fallback");
      if (fallback !== undefined && sequenceIncludes(fallback, skillId)) {
        references.push(`workflow ${name}.required_capabilities.${capabilityName}.fallback`);
      }
    }
  }
  return references;
}

function capabilityReferences(document, skillId) {
  const capabilities = optionalRootMap(document, "capabilities");
  if (capabilities === undefined) {
    return [];
  }
  const references = [];
  for (const pair of capabilities.items) {
    const name = nodeScalarValue(pair.key);
    const capability = requireYamlMap(pair.value, `capabilities.${name}`);
    if (readMapString(capability, "canonical", "") === skillId) {
      references.push(`capability ${name}.canonical`);
    }
    const alternatives = optionalSeq(capability, "alternatives");
    if (alternatives !== undefined && sequenceIncludes(alternatives, skillId)) {
      references.push(`capability ${name}.alternatives`);
    }
  }
  return references;
}

function installUnitReferences(document, skillId) {
  const installUnits = optionalRootMap(document, "install_units");
  if (installUnits === undefined) {
    return [];
  }
  const references = [];
  for (const pair of installUnits.items) {
    const id = nodeScalarValue(pair.key);
    const unit = requireYamlMap(pair.value, `install_units.${id}`);
    const components = optionalMap(unit, "components");
    const skills = components === undefined ? undefined : optionalSeq(components, "skills");
    if (skills !== undefined && sequenceIncludes(skills, skillId)) {
      references.push(`install_unit ${id}.components.skills`);
    }
  }
  return references;
}

function removeSkillReferences(document, skillId) {
  const workflows = optionalRootMap(document, "workflows");
  if (workflows !== undefined) {
    for (const workflow of mapValues(workflows, "workflow")) {
      const activeSkills = optionalSeq(workflow, "active_skills");
      const blockedSkills = optionalSeq(workflow, "blocked_skills");
      if (activeSkills !== undefined) {
        removeValue(activeSkills, skillId);
      }
      if (blockedSkills !== undefined) {
        removeValue(blockedSkills, skillId);
      }
      removeSkillFromRequiredCapabilities(workflow, skillId, document);
    }
  }
  const capabilities = optionalRootMap(document, "capabilities");
  if (capabilities !== undefined) {
    for (const capability of mapValues(capabilities, "capability")) {
      if (readMapString(capability, "canonical", "") === skillId) {
        capability.set("canonical", "");
      }
      const alternatives = optionalSeq(capability, "alternatives");
      if (alternatives !== undefined) {
        removeValue(alternatives, skillId);
      }
    }
  }
  const installUnits = optionalRootMap(document, "install_units");
  if (installUnits !== undefined) {
    for (const unit of mapValues(installUnits, "install_unit")) {
      const components = optionalMap(unit, "components");
      const skills = components === undefined ? undefined : optionalSeq(components, "skills");
      if (skills !== undefined) {
        removeValue(skills, skillId);
      }
    }
  }
}

function validateSkillState(status, invocation, exposure) {
  if (!STATUS_VALUES.has(status)) {
    throw new Error(`Unsupported status: ${status}`);
  }
  if (!INVOCATION_VALUES.has(invocation)) {
    throw new Error(`Unsupported invocation: ${invocation}`);
  }
  if (!EXPOSURE_VALUES.has(exposure)) {
    throw new Error(`Unsupported exposure: ${exposure}`);
  }
}

export function ensureCallableWorkflowSkill(skillId, skill) {
  const status = readMapString(skill, "status", "vendor");
  const invocation = readMapString(skill, "invocation", "manual-only");
  if (NON_CALLABLE_WORKFLOW_STATUSES.has(status)) {
    throw new Error(`Cannot attach non-callable skill ${skillId} with status: ${status}`);
  }
  if (NON_CALLABLE_WORKFLOW_INVOCATIONS.has(invocation)) {
    throw new Error(`Cannot attach non-callable skill ${skillId} with invocation: ${invocation}`);
  }
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function downgradeIfUnscopedWorkflowAuto(document, skillId) {
  const skill = requireConfigSkill(document, skillId);
  if (readMapString(skill, "invocation", "") !== "workflow-auto") {
    return;
  }
  const workflows = requireMapAt(document, ["workflows"], "workflows");
  for (const raw of mapValues(workflows, "workflow")) {
    const activeSkills = optionalSeq(raw, "active_skills");
    if (activeSkills !== undefined && sequenceIncludes(activeSkills, skillId)) {
      return;
    }
    const capabilities = optionalMap(raw, "required_capabilities");
    if (capabilities === undefined) {
      continue;
    }
    for (const requirement of mapValues(capabilities, "required_capability")) {
      const fallback = optionalSeq(requirement, "fallback");
      if (readMapString(requirement, "preferred", "") === skillId || (fallback !== undefined && sequenceIncludes(fallback, skillId))) {
        return;
      }
    }
  }
  skill.set("invocation", "manual-only");
  const status = readMapString(skill, "status", "");
  if (status === "active" || status === "active-auto") {
    skill.set("status", "candidate");
  }
}
