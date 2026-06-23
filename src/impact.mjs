export function impactDisable(workspace, skillId) {
  const affectedWorkflowEntries = workspace.workflows
    .filter((workflow) => workflow.activeSkills.includes(skillId) || workflow.requiredCapabilities.some((capability) => {
      return capability.preferred === skillId || capability.fallback.includes(skillId);
    }));
  const affectedWorkflows = affectedWorkflowEntries.map((workflow) => workflow.name);
  const affectedOutputs = [...new Set(affectedWorkflowEntries.flatMap((workflow) => workflow.requiredOutputs))];
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  const alternatives = alternativesForSkill(workspace, skillId, skill);
  return {
    skillId,
    exists: skill !== undefined,
    affectedWorkflows,
    affectedOutputs,
    alternatives,
    risk: riskFor(skill, affectedWorkflows, alternatives)
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
