import {
  INVOCATION_VALUES,
  NON_CALLABLE_WORKFLOW_INVOCATIONS,
  NON_CALLABLE_WORKFLOW_STATUSES
} from "../constants.mjs";

export const workflowRules = [
  {
    id: "WF-REF-001",
    check(ctx) {
      const diagnostics = [];
      for (const workflow of ctx.workflows) {
        if (workflow.harness !== "unspecified" && !ctx.harnessesByName.has(workflow.harness)) {
          diagnostics.push(`Workflow ${workflow.name} references undeclared harness: ${workflow.harness}`);
        }
        for (const skillId of workflow.activeSkills) {
          if (!ctx.skillsById.has(skillId)) {
            diagnostics.push(`Workflow ${workflow.name} references undeclared active skill: ${skillId}`);
          }
        }
        for (const skillId of workflow.blockedSkills) {
          if (!ctx.skillsById.has(skillId)) {
            diagnostics.push(`Workflow ${workflow.name} references undeclared blocked skill: ${skillId}`);
          }
        }
        for (const capability of workflow.requiredCapabilities) {
          if (!ctx.capabilitiesByName.has(capability.name)) {
            diagnostics.push(`Workflow ${workflow.name} references undeclared required capability: ${capability.name}`);
          }
          if (capability.preferred !== "" && !ctx.skillsById.has(capability.preferred)) {
            diagnostics.push(`Capability requirement ${capability.name} in workflow ${workflow.name} references undeclared preferred skill: ${capability.preferred}`);
          }
          for (const skillId of capability.fallback) {
            if (!ctx.skillsById.has(skillId)) {
              diagnostics.push(`Capability requirement ${capability.name} in workflow ${workflow.name} references undeclared fallback skill: ${skillId}`);
            }
          }
        }
      }
      return diagnostics;
    }
  },
  {
    id: "WF-ACTIVE-001",
    check(ctx) {
      const diagnostics = [];
      for (const workflow of ctx.workflows) {
        const blocked = new Set(workflow.blockedSkills);
        for (const skillId of workflow.activeSkills) {
          const skill = ctx.skillsById.get(skillId);
          if (skill === undefined) {
            continue;
          }
          if (blocked.has(skillId)) {
            diagnostics.push(`Workflow ${workflow.name} lists skill ${skillId} as both active and blocked.`);
          }
          diagnostics.push(...nonCallableDiagnostics(`Workflow ${workflow.name} activates`, skill));
        }
      }
      return diagnostics;
    }
  },
  {
    id: "WF-CAPABILITY-001",
    check(ctx) {
      const diagnostics = [];
      for (const workflow of ctx.workflows) {
        const blocked = new Set(workflow.blockedSkills);
        for (const capability of workflow.requiredCapabilities) {
          if (!INVOCATION_VALUES.has(capability.policy)) {
            diagnostics.push(`Capability requirement ${capability.name} in workflow ${workflow.name} has unsupported policy: ${capability.policy}`);
          }
          if (capability.preferred !== "" && blocked.has(capability.preferred)) {
            diagnostics.push(`Capability requirement ${capability.name} in workflow ${workflow.name} prefers blocked skill: ${capability.preferred}`);
          }
          for (const skillId of capability.fallback) {
            if (blocked.has(skillId)) {
              diagnostics.push(`Capability requirement ${capability.name} in workflow ${workflow.name} lists blocked fallback skill: ${skillId}`);
            }
            const fallback = ctx.skillsById.get(skillId);
            if (fallback !== undefined) {
              diagnostics.push(...nonCallableDiagnostics(`Capability requirement ${capability.name} in workflow ${workflow.name} lists fallback`, fallback));
            }
          }
          const preferred = capability.preferred === "" ? undefined : ctx.skillsById.get(capability.preferred);
          if (preferred !== undefined) {
            diagnostics.push(...nonCallableDiagnostics(`Capability requirement ${capability.name} in workflow ${workflow.name} prefers`, preferred));
          }
        }
      }
      return diagnostics;
    }
  }
];

function nonCallableDiagnostics(prefix, skill) {
  const diagnostics = [];
  if (NON_CALLABLE_WORKFLOW_STATUSES.has(skill.status)) {
    diagnostics.push(`${prefix} non-callable skill ${skill.id} with status: ${skill.status}.`);
  }
  if (NON_CALLABLE_WORKFLOW_INVOCATIONS.has(skill.invocation)) {
    diagnostics.push(`${prefix} non-callable skill ${skill.id} with invocation: ${skill.invocation}.`);
  }
  return diagnostics;
}
