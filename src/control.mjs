import { chmod, lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  installUnitSourceClass,
  installUnitPriority
} from "./domain/source-classes.mjs";
import { canUseSkill } from "./control/can-use-guard.mjs";
import {
  auditSources,
  classifySkillSource,
  classifySkillTrust,
  skillSummary
} from "./control/source-trust.mjs";
import {
  activateSkill,
  addSkill,
  addSkillVariant,
  blockSkill,
  preferSkill,
  quarantineSkill,
  removeSkill
} from "./control/skill-crud.mjs";
import { addHarness, addWorkflow } from "./control/workflow-crud.mjs";
import {
  GUARD_HOOK_MODE,
  assertGuardHookPlanIsInstallable,
  buildGuardHookInstallPlan,
  planGuardHookInstall
} from "./hook-plan.mjs";

export { planGuardHookInstall } from "./hook-plan.mjs";

export function listSkills(workspace, options = {}) {
  const workflow = options.workflow === undefined ? undefined : workflowByName(workspace, options.workflow);
  const skillIds = workflow === undefined
    ? new Set(workspace.skills.map((skill) => skill.id))
    : new Set([
      ...workflow.activeSkills,
      ...workflow.blockedSkills,
      ...workflow.requiredCapabilities.flatMap((capability) => {
        return [capability.preferred, ...capability.fallback].filter((skillId) => skillId.length > 0);
      })
    ]);

  return workspace.skills
    .filter((skill) => skillIds.has(skill.id))
    .map((skill) => skillSummary(workspace, skill, workflow))
    .sort((left, right) => {
      return right.sourcePriority - left.sourcePriority || left.id.localeCompare(right.id);
    });
}

export function listWorkflows(workspace) {
  return workspace.workflows.map((workflow) => ({
    name: workflow.name,
    harness: workflow.harness,
    activeSkills: workflow.activeSkills,
    blockedSkills: workflow.blockedSkills,
    requiredCapabilities: workflow.requiredCapabilities.map((capability) => capability.name)
  })).sort((left, right) => left.name.localeCompare(right.name));
}

export function listHarnesses(workspace) {
  return workspace.harnesses.map((harness) => ({
    name: harness.name,
    status: harness.status,
    workflows: harness.workflows,
    commands: harness.commands
  })).sort((left, right) => left.name.localeCompare(right.name));
}

export function listInstallUnits(workspace) {
  return workspace.installUnits.map((unit) => ({
    id: unit.id,
    kind: unit.kind,
    sourceClass: installUnitSourceClass(unit),
    priority: installUnitPriority(unit),
    trustLevel: unit.trustLevel,
    sourceDigest: unit.sourceDigest ?? null,
    signature: unit.signature ?? null,
    publicKey: unit.publicKey ?? null,
    verifiedAt: unit.verifiedAt ?? null,
    source: unit.source,
    scope: unit.scope,
    enabled: unit.enabled,
    skills: unit.components.skills,
    permissionRisk: unit.permissionRisk
  })).sort((left, right) => left.id.localeCompare(right.id));
}

export function explainSkill(workspace, skillId) {
  const skill = skillById(workspace, skillId);
  const source = classifySkillSource(workspace, skill);
  const workflows = workspace.workflows
    .map((workflow) => workflowSkillRole(workspace, workflow, skillId))
    .filter((entry) => entry.roles.length > 0);
  const capabilities = workspace.capabilities
    .filter((capability) => capability.canonical === skillId || capability.alternatives.includes(skillId))
    .map((capability) => ({
      name: capability.name,
      role: capability.canonical === skillId ? "canonical" : "alternative",
      defaultPolicy: capability.defaultPolicy
    }));

  return {
    ...skillSummary(workspace, skill),
    source,
    trust: classifySkillTrust(workspace, skill),
    workflows,
    capabilities,
    replacedBy: skill.replacedBy ?? null,
    conflictsWith: skill.conflictsWith
  };
}

export {
  activateSkill,
  addHarness,
  addSkill,
  addSkillVariant,
  addWorkflow,
  auditSources,
  blockSkill,
  canUseSkill,
  classifySkillSource,
  classifySkillTrust,
  preferSkill,
  quarantineSkill,
  removeSkill
};

export async function installGuardHook(options) {
  const { plan, script } = await buildGuardHookInstallPlan(options);
  assertGuardHookPlanIsInstallable(plan);

  await mkdir(dirname(plan.path), { recursive: true });
  await assertNewNonSymlinkPath(plan.path);
  await writeFile(plan.path, script, { encoding: "utf8", flag: "wx", mode: GUARD_HOOK_MODE });
  await assertRegularFile(plan.path);
  await chmod(plan.path, GUARD_HOOK_MODE);
  return { path: plan.path, workflow: plan.workflow, executable: true };
}

async function assertNewNonSymlinkPath(path) {
  const existing = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (existing !== undefined) {
    throw new Error(`Refusing to overwrite existing hook path: ${path}`);
  }
}

async function assertRegularFile(path) {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Hook path is not a regular file: ${path}`);
  }
}

function workflowByName(workspace, name) {
  const workflow = workspace.workflows.find((candidate) => candidate.name === name);
  if (workflow === undefined) {
    throw new Error(`Unknown workflow: ${name}`);
  }
  return workflow;
}

function skillById(workspace, skillId) {
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  if (skill === undefined) {
    throw new Error(`Unknown skill: ${skillId}`);
  }
  return skill;
}

function workflowSkillRole(workspace, workflow, skillId) {
  const roles = [];
  const capabilityRoles = [];
  if (workflow.activeSkills.includes(skillId)) {
    roles.push("active");
  }
  if (workflow.blockedSkills.includes(skillId)) {
    roles.push("blocked");
  }
  for (const capability of workflow.requiredCapabilities) {
    if (capability.preferred === skillId) {
      roles.push("preferred");
      capabilityRoles.push({ capability: capability.name, role: "preferred", policy: capability.policy });
    }
    if (capability.fallback.includes(skillId)) {
      roles.push("fallback");
      capabilityRoles.push({ capability: capability.name, role: "fallback", policy: capability.policy });
    }
  }
  return { workflow: workflow.name, roles: [...new Set(roles)], capabilityRoles };
}
