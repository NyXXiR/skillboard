import {
  activeConflictEntriesForSkill,
  conflictingSkillIds
} from "./conflicts.mjs";

export function impactDisable(workspace, skillId) {
  if (workspace.version === 2) {
    return impactDisableV2(workspace, skillId);
  }
  const affectedWorkflowEntries = workspace.workflows
    .filter((workflow) => workflow.activeSkills.includes(skillId) || workflow.requiredCapabilities.some((capability) => {
      return capability.preferred === skillId || capability.fallback.includes(skillId);
    }));
  const affectedWorkflows = affectedWorkflowEntries.map((workflow) => workflow.name);
  const affectedOutputs = [...new Set(affectedWorkflowEntries.flatMap((workflow) => workflow.requiredOutputs))];
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  const alternatives = alternativesForSkill(workspace, skillId, skill);
  const conflictingSkills = conflictingSkillIds(workspace, skillId);
  const activeConflicts = activeConflictEntriesForSkill(workspace, skillId);
  return {
    skillId,
    exists: skill !== undefined,
    affectedWorkflows,
    affectedOutputs,
    alternatives,
    conflictingSkills,
    activeConflicts,
    risk: riskFor(skill, affectedWorkflows, alternatives)
  };
}

function impactDisableV2(workspace, skillId) {
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  const affectedAgents = skill?.enabled === true
    ? workspace.inventory?.skills?.find((entry) => entry.id === skillId)?.installed_on ?? []
    : [];
  return {
    skillId,
    exists: skill !== undefined,
    affectedWorkflows: [],
    affectedAgents,
    affectedOutputs: [],
    alternatives: [],
    conflictingSkills: [],
    activeConflicts: [],
    policyBefore: skill === undefined ? null : { enabled: skill.enabled, shared: skill.shared },
    policyAfter: skill === undefined ? null : { enabled: false, shared: skill.shared },
    risk: skill === undefined ? "unknown" : affectedAgents.length <= 1 ? "low" : "medium"
  };
}

function alternativesForSkill(workspace, skillId, skill) {
  if (skill?.replacedBy !== undefined) {
    return [skill.replacedBy];
  }
  const capability = workspace.capabilities.find((candidate) => {
    return candidate.canonical === skillId || candidate.alternatives.includes(skillId);
  });
  if (capability === undefined) {
    return [];
  }
  return [capability.canonical, ...capability.alternatives].filter((candidate) => candidate !== skillId);
}

function riskFor(skill, affectedWorkflows, alternatives) {
  if (skill === undefined) {
    return "unknown";
  }
  if (affectedWorkflows.length === 0) {
    return "low";
  }
  return alternatives.length === 0 ? "high" : "medium";
}
