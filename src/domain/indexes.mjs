export function buildPolicyContext(workspace) {
  const skillsById = new Map(workspace.skills.map((skill) => [skill.id, skill]));
  const workflowsByName = new Map(workspace.workflows.map((workflow) => [workflow.name, workflow]));
  const harnessesByName = new Map(workspace.harnesses.map((harness) => [harness.name, harness]));
  const installUnitsById = new Map(workspace.installUnits.map((unit) => [unit.id, unit]));
  const capabilitiesByName = new Map(workspace.capabilities.map((capability) => [capability.name, capability]));
  const workflowScopedSkillIds = new Set(workspace.workflows.flatMap((workflow) => {
    const capabilitySkills = workflow.requiredCapabilities.flatMap((capability) => {
      return capability.preferred === "" ? capability.fallback : [capability.preferred, ...capability.fallback];
    });
    return [...workflow.activeSkills, ...capabilitySkills];
  }));

  return {
    workspace,
    defaults: workspace.defaults,
    skills: workspace.skills,
    workflows: workspace.workflows,
    harnesses: workspace.harnesses,
    installUnits: workspace.installUnits,
    capabilities: workspace.capabilities,
    skillsById,
    workflowsByName,
    harnessesByName,
    installUnitsById,
    capabilitiesByName,
    workflowScopedSkillIds
  };
}
