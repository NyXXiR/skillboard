import { checkPolicy } from "../policy.mjs";
import {
  NON_CALLABLE_WORKFLOW_INVOCATIONS,
  NON_CALLABLE_WORKFLOW_STATUSES
} from "../domain/constants.mjs";
import { workflowConflictEntriesForSkill } from "../conflicts.mjs";
import { isModelSelectableInvocation, isUserControlledSource } from "../domain/source-classes.mjs";
import { classifySkillTrust, workflowSkillRole } from "./source-trust.mjs";
import { authorizeV2Skill } from "./v2-guard.mjs";

export function canUseSkill(workspace, skillId, workflowName, agentName) {
  if (workspace.version === 2) {
    return canUseV2Skill(workspace, skillId, agentName);
  }
  const policy = checkPolicy(workspace);
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  const workflow = workspace.workflows.find((candidate) => candidate.name === workflowName);
  const reasons = [];

  if (skill === undefined) {
    reasons.push(`Unknown skill: ${skillId}`);
  }
  if (workflow === undefined) {
    reasons.push(`Unknown workflow: ${workflowName}`);
  }
  if (skill === undefined || workflow === undefined) {
    return canUseResult(false, skillId, workflowName, skill, workflow, reasons);
  }

  const role = workflowSkillRole(workflow, skillId);
  for (const conflict of workflowConflictEntriesForSkill(workspace, workflow, skillId)) {
    const other = conflict.skill === skillId ? conflict.conflictingSkill : conflict.skill;
    reasons.push(`Skill ${skillId} conflicts with active skill ${other} in workflow ${workflowName}.`);
  }
  if (!policy.ok) {
    reasons.push("Policy check failed.");
  }
  if (workflow.blockedSkills.includes(skillId)) {
    reasons.push(`Workflow ${workflowName} blocks skill ${skillId}.`);
  }
  reasons.push(...trustUseReasons(workspace, skill));
  if (role.roles.length === 0 && skill.invocation !== "global-auto") {
    reasons.push(`Skill ${skillId} is not active, preferred, or fallback in workflow ${workflowName}.`);
  }
  if (NON_CALLABLE_WORKFLOW_STATUSES.has(skill.status)) {
    reasons.push(`Skill ${skillId} has non-callable status: ${skill.status}.`);
  }
  if (NON_CALLABLE_WORKFLOW_INVOCATIONS.has(skill.invocation)) {
    reasons.push(`Skill ${skillId} has non-callable invocation: ${skill.invocation}.`);
  }
  if (skill.invocation === "global-auto" && skill.exposure !== "global-meta") {
    reasons.push(`Skill ${skillId} is global-auto but not global-meta.`);
  }

  return canUseResult(reasons.length === 0, skillId, workflowName, skill, workflow, reasons, role, classifySkillTrust(workspace, skill));
}

function canUseV2Skill(workspace, skillId, agentName) {
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  const authorization = authorizeV2Skill(skillId, skill, workspace.inventory, agentName);
  return {
    allowed: authorization.allowed,
    automaticAllowed: authorization.allowed,
    allowedUse: authorization.allowed ? allowedUse(skillId) : null,
    skill: skillId,
    workflow: null,
    agent: agentName ?? null,
    workflowKnown: true,
    integrityError: authorization.integrityError,
    reasons: authorization.reasons
  };
}

function trustUseReasons(workspace, skill) {
  const unit = skill.ownerInstallUnit === undefined
    ? undefined
    : workspace.installUnits.find((candidate) => candidate.id === skill.ownerInstallUnit);
  if (unit === undefined) {
    return [];
  }
  const trust = classifySkillTrust(workspace, skill);
  const reasons = [];
  if (!unit.enabled) {
    reasons.push(`Install unit ${unit.id} is disabled.`);
  }
  if (trust.level === "blocked") {
    reasons.push(`Install unit ${unit.id} is blocked by source trust policy.`);
  }
  if (unit.enabled && !isUserControlledSource(unit) && trust.level === "unreviewed") {
    reasons.push(`Skill ${skill.id} belongs to unreviewed non-user source ${unit.id}.`);
  }
  if (!isUserControlledSource(unit) && isModelSelectableInvocation(skill.invocation) && trust.level === "unreviewed") {
    reasons.push(`Skill ${skill.id} is model-selectable but source ${unit.id} is unreviewed.`);
  }
  if (skill.invocation === "global-auto" && !trust.reviewed) {
    reasons.push(`Skill ${skill.id} is global-auto but source ${unit.id} is not reviewed or trusted.`);
  }
  return reasons;
}

export function canUseResult(allowed, skillId, workflowName, skill, workflow, reasons, role = { roles: [], capabilityRoles: [] }, trust = null) {
  const automaticAllowed = allowed && ["workflow-auto", "global-auto"].includes(skill?.invocation ?? "");
  return {
    allowed,
    automaticAllowed,
    allowedUse: allowed ? allowedUse(skillId) : null,
    skill: skillId,
    workflow: workflowName,
    invocation: skill?.invocation ?? null,
    status: skill?.status ?? null,
    workflowKnown: workflow !== undefined,
    trust,
    roles: role.roles,
    capabilityRoles: role.capabilityRoles,
    reasons
  };
}

function allowedUse(skillId) {
  return {
    confirmationRequired: false,
    start: `State at the start that ${skillId} is being used for this request.`,
    finish: `State at completion that ${skillId} was used.`,
    startMessage: `I will use ${skillId} for this request.`,
    finishMessage: `I used ${skillId} for this request.`,
    askUserWhen: "Ask the user only if the guard denies use or a policy-changing action is needed."
  };
}
