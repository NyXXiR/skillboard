import { RESERVED_SOURCE_CLASSES, hasRuntimeComponents, isModelSelectableInvocation, isUserControlledSource } from "../source-classes.mjs";

export const installUnitRules = [
  {
    id: "UNIT-COMPONENT-001",
    check(ctx) {
      const diagnostics = [];
      for (const unit of ctx.installUnits) {
        if (unit.sourceClass !== undefined && RESERVED_SOURCE_CLASSES.has(unit.sourceClass) && !isUserControlledSource(unit)) {
          diagnostics.push(`Install unit ${unit.id} uses reserved source_class: ${unit.sourceClass}.`);
        }
        diagnostics.push(...validateProvidedComponents(unit));
        for (const skillId of unit.components.skills) {
          const skill = ctx.skillsById.get(skillId);
          if (skill === undefined) {
            diagnostics.push(`Install unit ${unit.id} declares undeclared component skill: ${skillId}`);
          } else if (skill.ownerInstallUnit !== undefined && skill.ownerInstallUnit !== unit.id) {
            diagnostics.push(`Install unit ${unit.id} declares component skill ${skillId} owned by ${skill.ownerInstallUnit}.`);
          }
        }
      }
      return diagnostics;
    }
  },
  {
    id: "UNIT-REF-001",
    check(ctx) {
      const diagnostics = [];
      for (const unit of ctx.installUnits) {
        for (const workflow of unit.workflowDependencies) {
          if (!ctx.workflowsByName.has(workflow)) {
            diagnostics.push(`Install unit ${unit.id} references undeclared workflow dependency: ${workflow}`);
          }
        }
      }
      return diagnostics;
    }
  },
  {
    id: "UNIT-TRUST-001",
    check(ctx) {
      const diagnostics = [];
      for (const unit of ctx.installUnits) {
        if (unit.enabled && unit.trustLevel === "blocked") {
          diagnostics.push(`Install unit ${unit.id} is enabled but trust_level is blocked.`);
        }
        const automaticSkills = unit.components.skills
          .map((skillId) => ctx.skillsById.get(skillId))
          .filter((skill) => skill !== undefined && isModelSelectableInvocation(skill.invocation));
        if (unit.enabled && !isUserControlledSource(unit) && unit.trustLevel === "unreviewed" && automaticSkills.length > 0) {
          diagnostics.push({
            severity: "warning",
            message: `Install unit ${unit.id} is unreviewed but owns model-selectable skills: ${automaticSkills.map((skill) => skill.id).join(", ")}.`
          });
        }
        if (unit.enabled && unit.permissionRisk === "high" && !["trusted", "reviewed"].includes(unit.trustLevel)) {
          diagnostics.push({
            severity: "warning",
            message: `Install unit ${unit.id} is high risk but not reviewed or trusted.`
          });
        }
        if (unit.enabled && hasRuntimeComponents(unit) && unit.trustLevel === "unreviewed") {
          diagnostics.push({
            severity: "warning",
            message: `Install unit ${unit.id} provides runtime components but is unreviewed.`
          });
        }
      }
      return diagnostics;
    }
  }
];

function validateProvidedComponents(unit) {
  return [
    ...validateComponentGroup(unit, "skills", unit.components.skills, ["skills", "skill"]),
    ...validateComponentGroup(unit, "commands", unit.components.commands, ["commands", "command"]),
    ...validateComponentGroup(unit, "hooks", unit.components.hooks, ["hooks", "hook"]),
    ...validateComponentGroup(unit, "mcp_servers", unit.components.mcpServers, ["mcp-server", "mcp-servers", "mcp_server", "mcp_servers"])
  ];
}

function validateComponentGroup(unit, label, values, aliases) {
  const provides = aliases.some((alias) => unit.providedComponents.includes(alias));
  if (values.length > 0 && !provides) {
    return [`Install unit ${unit.id} lists ${label} but does not include ${aliases[0]} in provided_components.`];
  }
  if (values.length === 0 && provides) {
    return [{
      severity: "warning",
      message: `Install unit ${unit.id} declares ${aliases[0]} in provided_components but lists no ${label}.`
    }];
  }
  return [];
}
