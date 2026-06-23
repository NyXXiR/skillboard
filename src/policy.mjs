export function checkPolicy(workspace) {
  const errors = [];
  const warnings = [];
  const skillIds = new Set(workspace.skills.map((skill) => skill.id));
  const skillsById = new Map(workspace.skills.map((skill) => [skill.id, skill]));
  const workflowNames = new Set(workspace.workflows.map((workflow) => workflow.name));
  const harnessNames = new Set(workspace.harnesses.map((harness) => harness.name));
  const installUnitsById = new Map(workspace.installUnits.map((unit) => [unit.id, unit]));
  const capabilitiesByName = new Map(workspace.capabilities.map((capability) => [capability.name, capability]));
  const workflowScopedSkillIds = new Set(workspace.workflows.flatMap((workflow) => {
    const capabilitySkills = workflow.requiredCapabilities.flatMap((capability) => {
      return capability.preferred === "" ? capability.fallback : [capability.preferred, ...capability.fallback];
    });
    return [...workflow.activeSkills, ...capabilitySkills];
  }));

  for (const workflow of workspace.workflows) {
    if (workflow.harness !== "unspecified" && !harnessNames.has(workflow.harness)) {
      errors.push(`Workflow ${workflow.name} references undeclared harness: ${workflow.harness}`);
    }
    for (const skillId of workflow.activeSkills) {
      if (!skillIds.has(skillId)) {
        errors.push(`Workflow ${workflow.name} references undeclared active skill: ${skillId}`);
      }
    }
    for (const skillId of workflow.blockedSkills) {
      if (!skillIds.has(skillId)) {
        errors.push(`Workflow ${workflow.name} references undeclared blocked skill: ${skillId}`);
      }
    }
    for (const capability of workflow.requiredCapabilities) {
      if (capability.preferred !== "" && !skillIds.has(capability.preferred)) {
        errors.push(`Capability requirement ${capability.name} in workflow ${workflow.name} references undeclared preferred skill: ${capability.preferred}`);
      }
      for (const skillId of capability.fallback) {
        if (!skillIds.has(skillId)) {
          errors.push(`Capability requirement ${capability.name} in workflow ${workflow.name} references undeclared fallback skill: ${skillId}`);
        }
      }
    }
  }

  for (const skill of workspace.skills) {
    validateStatusInvocation(skill, errors);
    if (workspace.defaults.requireExplicitWorkflow && skill.invocation === "workflow-auto" && !workflowScopedSkillIds.has(skill.id)) {
      errors.push(`Skill ${skill.id} uses workflow-auto but is not scoped to any workflow.`);
    }
    if (skill.invocation === "global-auto") {
      warnings.push(`Skill ${skill.id} is global-auto; prefer workflow-auto or router-only.`);
      if (skill.exposure !== "global-meta") {
        errors.push(`Skill ${skill.id} uses global-auto but is not exposure: global-meta.`);
      }
    }
    if (skill.replacedBy !== undefined && !skillIds.has(skill.replacedBy)) {
      errors.push(`Skill ${skill.id} replaced_by points to undeclared skill: ${skill.replacedBy}`);
    }
    for (const capabilityName of skill.canonicalFor) {
      const capability = capabilitiesByName.get(capabilityName);
      if (capability === undefined) {
        errors.push(`Skill ${skill.id} canonical_for references undeclared capability: ${capabilityName}`);
      } else if (capability.canonical !== skill.id) {
        errors.push(`Skill ${skill.id} claims canonical_for ${capabilityName} but capability canonical is ${capability.canonical || "none"}.`);
      }
    }
    for (const skillId of skill.conflictsWith) {
      if (!skillIds.has(skillId)) {
        errors.push(`Skill ${skill.id} conflicts_with undeclared skill: ${skillId}`);
      }
    }
    if (skill.ownerInstallUnit !== undefined && !installUnitsById.has(skill.ownerInstallUnit)) {
      errors.push(`Skill ${skill.id} owner_install_unit points to undeclared install unit: ${skill.ownerInstallUnit}`);
    }
    if (skill.exposure === "unit-managed" && skill.ownerInstallUnit === undefined) {
      errors.push(`Skill ${skill.id} is unit-managed but does not declare owner_install_unit.`);
    }
    const owner = skill.ownerInstallUnit === undefined ? undefined : installUnitsById.get(skill.ownerInstallUnit);
    if (owner !== undefined && !owner.components.skills.includes(skill.id)) {
      errors.push(`Skill ${skill.id} declares owner_install_unit ${owner.id} but is not listed in its component skills.`);
    }
  }

  for (const capability of workspace.capabilities) {
    if (capability.canonical !== "" && !skillIds.has(capability.canonical)) {
      errors.push(`Capability requirement ${capability.name} references undeclared canonical skill: ${capability.canonical}`);
    }
    for (const skillId of capability.alternatives) {
      if (!skillIds.has(skillId)) {
        errors.push(`Capability requirement ${capability.name} references undeclared alternative skill: ${skillId}`);
      }
    }
  }

  for (const harness of workspace.harnesses) {
    for (const workflow of harness.workflows) {
      if (!workflowNames.has(workflow)) {
        errors.push(`Harness ${harness.name} references undeclared workflow: ${workflow}`);
      }
    }
  }

  for (const unit of workspace.installUnits) {
    validateProvidedComponents(unit, errors, warnings);
    for (const skillId of unit.components.skills) {
      const skill = skillsById.get(skillId);
      if (skill === undefined) {
        errors.push(`Install unit ${unit.id} declares undeclared component skill: ${skillId}`);
      } else if (skill.ownerInstallUnit !== undefined && skill.ownerInstallUnit !== unit.id) {
        errors.push(`Install unit ${unit.id} declares component skill ${skillId} owned by ${skill.ownerInstallUnit}.`);
      }
    }
    for (const workflow of unit.workflowDependencies) {
      if (!workflowNames.has(workflow)) {
        errors.push(`Install unit ${unit.id} references undeclared workflow dependency: ${workflow}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateStatusInvocation(skill, errors) {
  if (skill.status === "blocked" && skill.invocation !== "blocked") {
    errors.push(`Blocked skill ${skill.id} must use invocation: blocked.`);
  }
  if (skill.status === "quarantined" && skill.invocation !== "blocked") {
    errors.push(`Quarantined skill ${skill.id} must use invocation: blocked.`);
  }
  if (skill.status === "deprecated" && !["deprecated", "blocked"].includes(skill.invocation)) {
    errors.push(`Deprecated skill ${skill.id} must use invocation: deprecated or blocked.`);
  }
  if (["active", "canonical"].includes(skill.status) && ["blocked", "deprecated"].includes(skill.invocation)) {
    errors.push(`Active skill ${skill.id} cannot use invocation: ${skill.invocation}.`);
  }
  if (skill.status === "active-manual" && skill.invocation !== "manual-only") {
    errors.push(`active-manual skill ${skill.id} must use invocation: manual-only.`);
  }
  if (skill.status === "active-router" && skill.invocation !== "router-only") {
    errors.push(`active-router skill ${skill.id} must use invocation: router-only.`);
  }
  if (skill.status === "active-auto" && skill.invocation !== "workflow-auto") {
    errors.push(`active-auto skill ${skill.id} must use invocation: workflow-auto.`);
  }
}

function validateProvidedComponents(unit, errors, warnings) {
  validateComponentGroup(unit, errors, warnings, "skills", unit.components.skills, ["skills", "skill"]);
  validateComponentGroup(unit, errors, warnings, "commands", unit.components.commands, ["commands", "command"]);
  validateComponentGroup(unit, errors, warnings, "hooks", unit.components.hooks, ["hooks", "hook"]);
  validateComponentGroup(unit, errors, warnings, "mcp_servers", unit.components.mcpServers, ["mcp-server", "mcp-servers", "mcp_server", "mcp_servers"]);
}

function validateComponentGroup(unit, errors, warnings, label, values, aliases) {
  const provides = aliases.some((alias) => unit.providedComponents.includes(alias));
  if (values.length > 0 && !provides) {
    errors.push(`Install unit ${unit.id} lists ${label} but does not include ${aliases[0]} in provided_components.`);
  }
  if (values.length === 0 && provides) {
    warnings.push(`Install unit ${unit.id} declares ${aliases[0]} in provided_components but lists no ${label}.`);
  }
}
