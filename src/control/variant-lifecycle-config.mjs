import {
  addUnique,
  ensureSeq,
  nodeScalarValue,
  optionalMap,
  optionalRootMap,
  readMapString,
  removeValue,
  requireMapAt,
  requireYamlMap,
  sequenceIncludes
} from "./config-write.mjs";

export function requireConfigSkill(document, skillId) {
  const skills = requireMapAt(document, ["skills"], "skills");
  const skill = skills.get(skillId, true);
  if (skill === undefined) {
    throw new Error(`Unknown skill: ${skillId}`);
  }
  return requireYamlMap(skill, `skills.${skillId}`);
}

export function requireConfigWorkflow(document, workflowName) {
  const workflows = requireMapAt(document, ["workflows"], "workflows");
  const workflow = workflows.get(workflowName, true);
  if (workflow === undefined) {
    throw new Error(`Unknown workflow: ${workflowName}`);
  }
  const raw = requireYamlMap(workflow, `workflows.${workflowName}`);
  ensureSeq(raw, "active_skills", document);
  ensureSeq(raw, "blocked_skills", document);
  return raw;
}

export function requireConfigCapability(document, capabilityName) {
  const capabilities = requireMapAt(document, ["capabilities"], "capabilities");
  const capability = capabilities.get(capabilityName, true);
  if (capability === undefined) {
    throw new Error(`Unknown capability: ${capabilityName}`);
  }
  return requireYamlMap(capability, `capabilities.${capabilityName}`);
}

export function addVariantCapabilityAlternative(document, capability, options) {
  const alternatives = ensureSeq(capability, "alternatives", document);
  const canonical = readMapString(capability, "canonical", "");
  if (canonical !== options.baseId && !sequenceIncludes(alternatives, options.baseId)) {
    addUnique(alternatives, options.baseId);
  }
  if (canonical !== options.variantId && !sequenceIncludes(alternatives, options.variantId)) {
    addUnique(alternatives, options.variantId);
  }
}

export function promoteVariantInWorkflow(document, workflow, capabilityDefinition, options) {
  const required = ensureRequiredCapability(workflow, options.capability, document);
  const previousPreferred = readMapString(required, "preferred", "");
  const canonical = readMapString(capabilityDefinition, "canonical", "");
  const fallback = ensureSeq(required, "fallback", document);
  required.set("preferred", options.variantId);
  setFallbackValues(fallback, orderedVariantFallbacks(sequenceValues(fallback), [previousPreferred, options.baseId, canonical], options.variantId));
  addUnique(ensureSeq(workflow, "active_skills", document), options.variantId);
  removeValue(ensureSeq(workflow, "blocked_skills", document), options.variantId);
  return required;
}

export function ensureRequiredCapability(workflow, capabilityName, document) {
  let capabilities = workflow.get("required_capabilities", true);
  if (capabilities === undefined) {
    capabilities = document.createNode({});
    workflow.set("required_capabilities", capabilities);
  }
  const capabilityMap = requireYamlMap(capabilities, "required_capabilities");
  if (capabilityMap.get(capabilityName, true) === undefined) {
    capabilityMap.set(capabilityName, document.createNode({ preferred: "", fallback: [], policy: "manual-only" }));
  }
  const capability = requireYamlMap(capabilityMap.get(capabilityName, true), `required_capabilities.${capabilityName}`);
  ensureSeq(capability, "fallback", document);
  return capability;
}

export function readRequiredCapabilityPolicy(workflow, capabilityName) {
  const capabilities = optionalMap(workflow, "required_capabilities");
  if (capabilities === undefined || capabilities.get(capabilityName, true) === undefined) {
    return "";
  }
  return readMapString(requireYamlMap(capabilities.get(capabilityName, true), `required_capabilities.${capabilityName}`), "policy", "");
}

export function orderedVariantFallbacks(existingValues, priorityValues, variantId) {
  const next = [];
  const seen = new Set();
  for (const value of [...priorityValues, ...existingValues]) {
    if (typeof value === "string" && value.length > 0 && value !== variantId && !seen.has(value)) {
      next.push(value);
      seen.add(value);
    }
  }
  return next;
}

export function setFallbackValues(sequence, values) {
  while (sequence.items.length > 0) {
    sequence.delete(0);
  }
  for (const value of values) {
    sequence.add(value);
  }
}

export function sequenceValues(sequence) {
  return sequence.items.map((item) => nodeScalarValue(item));
}

export function appendSkillToOwnerInstallUnit(document, unitId, skillId) {
  const installUnits = optionalRootMap(document, "install_units");
  if (installUnits === undefined || installUnits.get(unitId, true) === undefined) {
    throw new Error(`Unknown install unit: ${unitId}`);
  }
  const unit = requireYamlMap(installUnits.get(unitId, true), `install_units.${unitId}`);
  let components = unit.get("components", true);
  if (components === undefined) {
    components = document.createNode({});
    unit.set("components", components);
  }
  addUnique(ensureSeq(requireYamlMap(components, `install_units.${unitId}.components`), "skills", document), skillId);
}

export function variantConfigMetadata(variant) {
  return stripUndefined({
    of: variant.of,
    adapted_for: variant.adaptedFor ?? undefined,
    capability: variant.capability,
    workflow: variant.workflow,
    status: variant.status,
    base: {
      content_digest: variant.base.contentDigest,
      snapshot: variant.base.snapshot
    },
    approved: checkpointConfigMetadata(variant.approved)
  });
}

export function checkpointConfigMetadata(checkpoint) {
  if (checkpoint === undefined || checkpoint === null) {
    return undefined;
  }
  return {
    content_digest: checkpoint.contentDigest,
    snapshot: checkpoint.snapshot
  };
}

export function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
