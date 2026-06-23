const SAFE_HARNESS_STATUSES = new Set(["available", "configured", "primary", "fallback"]);

export function reconcileWorkspace(workspace, options = {}) {
  const configuredSkills = new Set(workspace.skills.map((skill) => skill.id));
  const actualHarnesses = options.actualHarnesses ?? [];
  const plan = {
    skillChanges: [],
    harnessChanges: [],
    autoActions: [],
    decisionsRequired: [],
    warnings: []
  };

  for (const skill of workspace.installedSkills) {
    if (configuredSkills.has(skill.id)) {
      continue;
    }
    const capability = findCapabilityForSkill(workspace, skill.id);
    const recommendedInvocation = recommendedInvocationFor(capability);
    const change = {
      type: "new-skill",
      skillId: skill.id,
      capability: capability?.name ?? "uncategorized",
      recommendedStatus: "quarantined",
      recommendedInvocation
    };
    plan.skillChanges.push(change);
    plan.autoActions.push({
      action: "quarantine-skill",
      skillId: skill.id,
      capability: capability?.name ?? "uncategorized",
      recommendedStatus: "quarantined",
      recommendedInvocation
    });
    plan.decisionsRequired.push(
      `Classify ${skill.id}: keep quarantined, approve manual-only for a workflow, or archive as duplicate.`
    );
  }

  if (actualHarnesses.length === 0) {
    plan.warnings.push("Actual harness inventory was not provided; harness reconciliation skipped.");
  } else {
    reconcileHarnesses(workspace, new Set(actualHarnesses), plan);
  }

  return plan;
}

function reconcileHarnesses(workspace, actualHarnesses, plan) {
  const desiredHarnesses = new Set(workspace.harnesses.map((harness) => harness.name));

  for (const harness of workspace.harnesses) {
    if (!SAFE_HARNESS_STATUSES.has(harness.status) || actualHarnesses.has(harness.name)) {
      continue;
    }
    const affectedWorkflows = harness.workflows.length === 0
      ? workflowsUsingHarness(workspace, harness.name)
      : harness.workflows;
    const change = {
      type: "removed-harness",
      harness: harness.name,
      affectedWorkflows,
      missingCommands: harness.commands,
      recommendations: [
        "assign a fallback harness before applying workflow changes",
        "replace missing commands with capability-backed workflow steps"
      ]
    };
    plan.harnessChanges.push(change);
    plan.decisionsRequired.push(
      `Migrate ${harness.name}: ${affectedWorkflows.length} workflow(s) need a fallback harness or command mapping.`
    );
  }

  for (const harness of actualHarnesses) {
    if (desiredHarnesses.has(harness)) {
      continue;
    }
    plan.harnessChanges.push({
      type: "new-harness",
      harness,
      affectedWorkflows: [],
      missingCommands: [],
      recommendations: ["record the harness as disabled until workflows explicitly opt in"]
    });
    plan.autoActions.push({
      action: "disable-harness",
      harness,
      recommendedStatus: "disabled"
    });
  }
}

function findCapabilityForSkill(workspace, skillId) {
  return workspace.capabilities.find((candidate) => {
    return candidate.canonical === skillId || candidate.alternatives.includes(skillId);
  });
}

function recommendedInvocationFor(capability) {
  if (capability === undefined || capability.defaultPolicy === "global-auto") {
    return "blocked";
  }
  return capability.defaultPolicy;
}

function workflowsUsingHarness(workspace, harnessName) {
  return workspace.workflows
    .filter((workflow) => workflow.harness === harnessName)
    .map((workflow) => workflow.name);
}
