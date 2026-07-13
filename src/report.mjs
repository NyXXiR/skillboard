export function renderDashboard(workspace) {
  if (workspace.version === 2) return renderV2Dashboard(workspace);
  const lines = ["# SkillBoard", "", "## Defaults", ""];
  lines.push(`- Invocation policy: \`${workspace.defaults.invocationPolicy}\``);
  lines.push(`- Model auto invocation: \`${workspace.defaults.allowModelInvocation}\``);
  lines.push(`- Explicit workflow required: \`${workspace.defaults.requireExplicitWorkflow}\``);
  lines.push("", "## Workflows", "");

  for (const workflow of workspace.workflows) {
    lines.push(`### ${workflow.name}`, "");
    lines.push(`- Harness: \`${workflow.harness}\``);
    lines.push(`- required outputs: ${formatList(workflow.requiredOutputs)}`);
    emitSkillGroup(lines, "active", workflow.activeSkills, workspace);
    emitSkillGroup(lines, "blocked", workflow.blockedSkills, workspace);
    emitCapabilityRequirements(lines, workflow.requiredCapabilities);
    lines.push("");
  }

  lines.push("## Capabilities", "");
  if (workspace.capabilities.length === 0) {
    lines.push("- none");
  }
  for (const capability of workspace.capabilities) {
    lines.push(`- \`${capability.name}\` — canonical: \`${capability.canonical || "none"}\`, alternatives: ${formatList(capability.alternatives)}`);
  }
  lines.push("", "## Harnesses", "");
  if (workspace.harnesses.length === 0) {
    lines.push("- none");
  }
  for (const harness of workspace.harnesses) {
    lines.push(`- \`${harness.name}\` — ${harness.status}, workflows: ${formatList(harness.workflows)}`);
  }
  lines.push("");

  lines.push("## Agent Runtime Install Units", "");
  if (workspace.installUnits.length === 0) {
    lines.push("- none");
  }
  for (const unit of workspace.installUnits) {
    lines.push(`### ${unit.id}`, "");
    lines.push(`- Kind: \`${unit.kind}\``);
    lines.push(`- Scope: \`${unit.scope}\``);
    lines.push(`- Source: \`${unit.source || "unknown"}\``);
    lines.push(`- Enabled: \`${unit.enabled}\``);
    lines.push(`- Auto update: \`${unit.autoUpdate}\``);
    lines.push(`- Manifest: \`${unit.manifestPath || "none"}\``);
    lines.push(`- Cache: \`${unit.cachePath || "none"}\``);
    lines.push(`- Provides: ${formatList(unit.providedComponents)}`);
    lines.push(`- Skills: ${formatList(unit.components.skills)}`);
    lines.push(`- Commands: ${formatList(unit.components.commands)}`);
    lines.push(`- Hooks: ${formatList(unit.components.hooks)}`);
    lines.push(`- MCP servers: ${formatList(unit.components.mcpServers)}`);
    lines.push(`- Modifies: ${formatList(unit.modifiedConfigFiles)}`);
    lines.push(`- Workflow dependencies: ${formatList(unit.workflowDependencies)}`);
    lines.push(`- Trust level: \`${unit.trustLevel}\``);
    lines.push(`- permission risk: \`${unit.permissionRisk}\``);
    lines.push(`- Rollback: \`${unit.rollback}\``);
    lines.push("");
  }

  lines.push("## Skill Inventory", "");
  for (const skill of workspace.skills) {
    lines.push(`- \`${skill.id}\` — ${skill.status}, ${skill.invocation}, ${skill.exposure}, ${skill.category}, owner: \`${skill.ownerInstallUnit ?? "none"}\``);
  }
  lines.push("", "## Installed Skill Files", "");
  if (workspace.installedSkills.length === 0) {
    lines.push("- none");
  }
  for (const skill of workspace.installedSkills) {
    lines.push(`- \`${skill.path}\` — ${skill.name}: ${skill.description}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderV2Dashboard(workspace) {
  const lines = ["# SkillBoard", "", "## Version 2 Policy", ""];
  for (const skill of workspace.skills) {
    const state = skill.enabled ? "enabled" : "disabled";
    lines.push(`- \`${skill.id}\` — ${state}, ${skill.shared ? "shared across agents" : "agent-local"}`);
  }
  lines.push("", "## Runtime Readiness", "");
  const errors = workspace.inventory?.integrityErrors ?? [];
  lines.push(errors.length === 0 ? "- inventory ready" : `- inventory unavailable: ${errors.join("; ")}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderReconcilePlan(plan) {
  const lines = ["# SkillBoard Reconcile Plan", "", "## Warnings", ""];
  if (plan.warnings.length === 0) {
    lines.push("- none");
  }
  for (const warning of plan.warnings) {
    lines.push(`- ${warning}`);
  }
  lines.push("", "## Automatic Actions", "");
  if (plan.autoActions.length === 0) {
    lines.push("- none");
  }
  for (const action of plan.autoActions) {
    if (action.action === "enable-skill-local") {
      lines.push(`- enable \`${action.skillId}\` where it is installed`);
    } else if (action.action === "quarantine-skill") {
      lines.push(`- quarantine \`${action.skillId}\` as \`${action.recommendedStatus}\` / \`${action.recommendedInvocation}\` for capability \`${action.capability}\``);
    } else if (action.action === "disable-harness") {
      lines.push(`- disable new harness \`${action.harness}\` until a workflow opts in`);
    }
  }

  lines.push("", "## Skill Changes", "");
  if (plan.skillChanges.length === 0) {
    lines.push("- none");
  }
  for (const change of plan.skillChanges) {
    if (change.recommendedEnabled !== undefined) {
      lines.push(`- \`${change.skillId}\`: ${change.type}, recommend enabled \`${change.recommendedEnabled}\`, shared \`${change.recommendedShared}\``);
    } else {
      lines.push(`- \`${change.skillId}\`: ${change.type}, capability \`${change.capability}\`, recommend \`${change.recommendedStatus}\``);
    }
  }

  lines.push("", "## Harness Changes", "");
  if (plan.harnessChanges.length === 0) {
    lines.push("- none");
  }
  for (const change of plan.harnessChanges) {
    lines.push(`- \`${change.harness}\`: ${change.type}`);
    lines.push(`  - affected workflows: ${formatList(change.affectedWorkflows)}`);
    lines.push(`  - missing commands: ${formatList(change.missingCommands)}`);
    lines.push(`  - recommendations: ${formatList(change.recommendations)}`);
  }

  lines.push("", "## Decisions Required", "");
  if (plan.decisionsRequired.length === 0) {
    lines.push("- none");
  }
  for (const decision of plan.decisionsRequired) {
    lines.push(`- ${decision}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function emitSkillGroup(lines, label, skillIds, workspace) {
  lines.push(`- ${label}:`);
  if (skillIds.length === 0) {
    lines.push("  - none");
    return;
  }
  for (const skillId of skillIds) {
    const skill = workspace.skills.find((candidate) => candidate.id === skillId);
    const invocation = skill === undefined ? "missing" : skill.invocation;
    lines.push(`  - \`${skillId}\` (${invocation})`);
  }
}

function emitCapabilityRequirements(lines, capabilities) {
  lines.push("- required capabilities:");
  if (capabilities.length === 0) {
    lines.push("  - none");
    return;
  }
  for (const capability of capabilities) {
    lines.push(`  - \`${capability.name}\` preferred \`${capability.preferred || "none"}\`, fallback: ${formatList(capability.fallback)}`);
  }
}

function formatList(values) {
  return values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", ");
}
