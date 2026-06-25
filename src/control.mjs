import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import YAML from "yaml";
import { checkPolicy } from "./policy.mjs";
import { loadWorkspace } from "./workspace.mjs";
import { textChangePlan } from "./change-plan.mjs";
import { normalizeSkillPath } from "./skill-paths.mjs";
import {
  EXPOSURE_VALUES,
  HARNESS_STATUS_VALUES,
  INVOCATION_VALUES,
  NON_CALLABLE_WORKFLOW_INVOCATIONS,
  NON_CALLABLE_WORKFLOW_STATUSES,
  STATUS_VALUES
} from "./domain/constants.mjs";
import {
  hasRuntimeComponents,
  installUnitPriority,
  installUnitSourceClass,
  isModelSelectableInvocation,
  isUserControlledSource
} from "./domain/source-classes.mjs";
import {
  GUARD_HOOK_MODE,
  assertGuardHookPlanIsInstallable,
  buildGuardHookInstallPlan
} from "./hook-plan.mjs";

export { planGuardHookInstall } from "./hook-plan.mjs";

const WRITABLE_INVOCATIONS = new Set(["manual-only", "router-only", "workflow-auto", "global-auto"]);

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
    .map((workflow) => workflowSkillRole(workflow, skillId))
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

export function canUseSkill(workspace, skillId, workflowName) {
  const policy = checkPolicy(workspace);
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  const workflow = workspace.workflows.find((candidate) => candidate.name === workflowName);
  const reasons = [];

  if (!policy.ok) {
    reasons.push("Policy check failed.");
  }
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

export async function activateSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skill = requireConfigSkill(document, options.skillId);
  const workflow = requireConfigWorkflow(document, options.workflow);
  const mode = options.mode ?? readMapString(skill, "invocation", "manual-only");

  if (!WRITABLE_INVOCATIONS.has(mode) || mode === "global-auto") {
    throw new Error(`activate requires --mode manual-only, router-only, or workflow-auto; got ${mode}`);
  }
  skill.set("status", "active");
  skill.set("invocation", mode);
  addUnique(ensureSeq(workflow, "active_skills", document), options.skillId);
  removeValue(ensureSeq(workflow, "blocked_skills", document), options.skillId);

  return await writeCheckedConfig(
    document,
    originalText,
    { ...options, validateUse: { skillId: options.skillId, workflow: options.workflow } },
    `Activated ${options.skillId} in ${options.workflow} as ${mode}`
  );
}

export async function addSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skills = ensureMapAt(document, ["skills"], "skills");
  if (skills.get(options.skillId, true) !== undefined) {
    throw new Error(`Skill already exists: ${options.skillId}`);
  }
  const skillPath = normalizeSkillPath(options.path, "skill path");
  const status = options.status ?? (options.workflow === undefined ? "candidate" : "active");
  const invocation = options.invocation ?? "manual-only";
  const exposure = options.exposure ?? "exported";
  validateSkillState(status, invocation, exposure);
  skills.set(options.skillId, document.createNode(stripUndefined({
    path: skillPath,
    status,
    invocation,
    exposure,
    category: options.category ?? "user",
    owner_install_unit: options.ownerInstallUnit
  })));
  if (options.workflow !== undefined) {
    const workflow = requireConfigWorkflow(document, options.workflow);
    addUnique(ensureSeq(workflow, "active_skills", document), options.skillId);
    removeValue(ensureSeq(workflow, "blocked_skills", document), options.skillId);
  }
  const validation = options.workflow === undefined
    ? options
    : { ...options, validateUse: { skillId: options.skillId, workflow: options.workflow } };
  return await writeCheckedConfig(document, originalText, validation, `Added ${options.skillId}`);
}

export async function addHarness(options) {
  if (options.harness === undefined) {
    throw new Error("addHarness requires a harness name");
  }
  const { document, originalText } = await loadConfig(options.configPath);
  const harnesses = ensureMapAt(document, ["harnesses"], "harnesses");
  if (harnesses.get(options.harness, true) !== undefined) {
    throw new Error(`Harness already exists: ${options.harness}`);
  }
  const status = options.status ?? "configured";
  validateHarnessStatus(status);
  harnesses.set(options.harness, document.createNode({
    status,
    workflows: [],
    commands: options.commands ?? []
  }));
  return await writeCheckedConfig(document, originalText, options, `Added harness ${options.harness}`);
}

export async function addWorkflow(options) {
  if (options.workflow === undefined) {
    throw new Error("addWorkflow requires a workflow name");
  }
  if (options.harness === undefined) {
    throw new Error("addWorkflow requires a harness name");
  }
  const { document, originalText } = await loadConfig(options.configPath);
  const workflows = ensureMapAt(document, ["workflows"], "workflows");
  const harnesses = ensureMapAt(document, ["harnesses"], "harnesses");
  if (workflows.get(options.workflow, true) !== undefined) {
    throw new Error(`Workflow already exists: ${options.workflow}`);
  }
  const skillIds = uniqueValues(options.skills ?? []);
  const activeSkills = [];
  const validateUses = [];
  for (const skillId of skillIds) {
    const skill = requireConfigSkill(document, skillId);
    ensureCallableWorkflowSkill(skillId, skill);
    if (readMapString(skill, "status", "vendor") === "candidate" && readMapString(skill, "invocation", "manual-only") === "manual-only") {
      skill.set("status", "active-manual");
    }
    activeSkills.push(skillId);
    validateUses.push({ skillId, workflow: options.workflow });
  }

  const harness = harnesses.get(options.harness, true);
  if (harness === undefined) {
    if (options.requireExistingHarness === true) {
      throw new Error(`Unknown harness: ${options.harness}`);
    }
    const harnessStatus = options.harnessStatus ?? "configured";
    validateHarnessStatus(harnessStatus);
    harnesses.set(options.harness, document.createNode({
      status: harnessStatus,
      workflows: [options.workflow],
      commands: []
    }));
  } else {
    addUnique(ensureSeq(requireYamlMap(harness, `harnesses.${options.harness}`), "workflows", document), options.workflow);
  }

  workflows.set(options.workflow, document.createNode({
    harness: options.harness,
    active_skills: activeSkills,
    blocked_skills: []
  }));

  return await writeCheckedConfig(
    document,
    originalText,
    { ...options, validateUses },
    `Added workflow ${options.workflow}`
  );
}

export async function blockSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  requireConfigSkill(document, options.skillId);
  const workflow = requireConfigWorkflow(document, options.workflow);

  addUnique(ensureSeq(workflow, "blocked_skills", document), options.skillId);
  removeValue(ensureSeq(workflow, "active_skills", document), options.skillId);
  removeSkillFromRequiredCapabilities(workflow, options.skillId, document);
  downgradeIfUnscopedWorkflowAuto(document, options.skillId);

  return await writeCheckedConfig(document, originalText, options, `Blocked ${options.skillId} in ${options.workflow}`);
}

export async function quarantineSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skill = requireConfigSkill(document, options.skillId);

  skill.set("status", "quarantined");
  skill.set("invocation", "blocked");
  const workflows = requireMapAt(document, ["workflows"], "workflows");
  for (const workflow of mapValues(workflows, "workflow")) {
    removeValue(ensureSeq(workflow, "active_skills", document), options.skillId);
    removeSkillFromRequiredCapabilities(workflow, options.skillId, document);
  }

  return await writeCheckedConfig(document, originalText, options, `Quarantined ${options.skillId}`);
}

export async function removeSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skills = requireMapAt(document, ["skills"], "skills");
  requireConfigSkill(document, options.skillId);
  const references = configSkillReferences(document, options.skillId);
  if (references.length > 0 && options.force !== true) {
    throw new Error(`Skill ${options.skillId} is still referenced: ${references.join(", ")}. Re-run with --force to remove config references first.`);
  }
  removeSkillReferences(document, options.skillId);
  skills.delete(options.skillId);
  return await writeCheckedConfig(document, originalText, options, `Removed ${options.skillId}`);
}

export async function preferSkill(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skill = requireConfigSkill(document, options.skillId);
  const workflow = requireConfigWorkflow(document, options.workflow);
  const capabilities = requireMapAt(document, ["capabilities"], "capabilities");
  const capabilityDefinition = capabilities.get(options.capability, true);
  if (capabilityDefinition === undefined) {
    throw new Error(`Unknown capability: ${options.capability}`);
  }
  const required = ensureRequiredCapability(workflow, options.capability, document);
  const previousPreferred = readMapString(required, "preferred", "");
  if (previousPreferred.length > 0 && previousPreferred !== options.skillId) {
    addUnique(ensureSeq(required, "fallback", document), previousPreferred);
  }
  required.set("preferred", options.skillId);
  removeValue(ensureSeq(required, "fallback", document), options.skillId);
  addUnique(ensureSeq(workflow, "active_skills", document), options.skillId);
  removeValue(ensureSeq(workflow, "blocked_skills", document), options.skillId);
  const status = readMapString(skill, "status", "vendor");
  const invocation = readMapString(skill, "invocation", "manual-only");
  if (status === "quarantined" || status === "blocked") {
    skill.set("status", "active");
  }
  if (invocation === "blocked" || invocation === "deprecated") {
    const requiredPolicy = readMapString(required, "policy", "");
    const defaultPolicy = YAML.isMap(capabilityDefinition) ? readMapString(capabilityDefinition, "default_policy", "manual-only") : "manual-only";
    skill.set("invocation", requiredPolicy.length > 0 ? requiredPolicy : defaultPolicy);
  }

  return await writeCheckedConfig(
    document,
    originalText,
    { ...options, validateUse: { skillId: options.skillId, workflow: options.workflow } },
    `Preferred ${options.skillId} for ${options.capability} in ${options.workflow}`
  );
}

export function classifySkillSource(workspace, skill) {
  const unit = skill.ownerInstallUnit === undefined
    ? undefined
    : workspace.installUnits.find((candidate) => candidate.id === skill.ownerInstallUnit);
  if (unit === undefined) {
    return {
      class: "user",
      priority: 100,
      ownerInstallUnit: skill.ownerInstallUnit ?? null,
      detail: "declared directly in the workspace policy"
    };
  }
  const sourceClass = installUnitSourceClass(unit);
  const priority = installUnitPriority(unit);
  return {
    class: sourceClass,
    priority,
    ownerInstallUnit: unit.id,
    detail: unit.source || unit.kind
  };
}

export function classifySkillTrust(workspace, skill) {
  const unit = skill.ownerInstallUnit === undefined
    ? undefined
    : workspace.installUnits.find((candidate) => candidate.id === skill.ownerInstallUnit);
  if (unit === undefined) {
    return {
      level: "trusted",
      reviewed: true,
      signed: false,
      pinned: false,
      ownerInstallUnit: skill.ownerInstallUnit ?? null,
      reason: "declared directly in workspace policy"
    };
  }
  const sourceClass = installUnitSourceClass(unit);
  const level = unit.trustLevel ?? (isUserControlledSource(unit) ? "trusted" : "unreviewed");
  return {
    level,
    reviewed: level === "trusted" || level === "reviewed",
    signed: unit.signature !== undefined && unit.signature.length > 0,
    pinned: unit.sourceDigest !== undefined && unit.sourceDigest.length > 0,
    verifiedAt: unit.verifiedAt ?? null,
    ownerInstallUnit: unit.id,
    sourceClass,
    permissionRisk: unit.permissionRisk
  };
}

export function auditSources(workspace) {
  const skillsByOwner = new Map();
  for (const skill of workspace.skills) {
    if (skill.ownerInstallUnit === undefined) {
      continue;
    }
    const skills = skillsByOwner.get(skill.ownerInstallUnit) ?? [];
    skills.push(skill);
    skillsByOwner.set(skill.ownerInstallUnit, skills);
  }

  const units = workspace.installUnits.map((unit) => {
    const sourceClass = installUnitSourceClass(unit);
    const ownedSkills = skillsByOwner.get(unit.id) ?? [];
    const automaticSkills = ownedSkills
      .filter((skill) => isModelSelectableInvocation(skill.invocation))
      .map((skill) => skill.id)
      .sort((left, right) => left.localeCompare(right));
    const findings = sourceAuditFindings(unit, sourceClass, automaticSkills);
    return {
      id: unit.id,
      kind: unit.kind,
      sourceClass,
      enabled: unit.enabled,
      trustLevel: unit.trustLevel,
      permissionRisk: unit.permissionRisk,
      signed: unit.signature !== undefined && unit.signature.length > 0,
      pinned: unit.sourceDigest !== undefined && unit.sourceDigest.length > 0,
      verifiedAt: unit.verifiedAt ?? null,
      automaticSkills,
      findings
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const errors = units.flatMap((unit) => unit.findings.filter((finding) => finding.severity === "error").map((finding) => `${unit.id}: ${finding.message}`));
  const warnings = units.flatMap((unit) => unit.findings.filter((finding) => finding.severity === "warning").map((finding) => `${unit.id}: ${finding.message}`));
  return {
    ok: errors.length === 0,
    units,
    errors,
    warnings
  };
}

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

function skillSummary(workspace, skill, workflow) {
  const source = classifySkillSource(workspace, skill);
  return {
    id: skill.id,
    path: skill.path,
    status: skill.status,
    invocation: skill.invocation,
    exposure: skill.exposure,
    category: skill.category,
    sourceClass: source.class,
    sourcePriority: source.priority,
    ownerInstallUnit: source.ownerInstallUnit,
    workflowRoles: workflow === undefined ? [] : workflowSkillRole(workflow, skill.id).roles
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

function sourceAuditFindings(unit, sourceClass, automaticSkills) {
  const findings = [];
  if (unit.enabled && unit.trustLevel === "blocked") {
    findings.push({ severity: "error", message: "enabled install unit is trust-blocked" });
  }
  if (!unit.enabled && automaticSkills.length > 0) {
    findings.push({ severity: "warning", message: `disabled source owns model-selectable skills: ${automaticSkills.join(", ")}` });
  }
  if (unit.enabled && !isUserControlledSource(unit) && unit.trustLevel === "unreviewed" && automaticSkills.length > 0) {
    findings.push({ severity: "error", message: `unreviewed source owns model-selectable skills: ${automaticSkills.join(", ")}` });
  }
  if (unit.enabled && unit.permissionRisk === "high" && !["trusted", "reviewed"].includes(unit.trustLevel)) {
    findings.push({ severity: "warning", message: "high-risk source is not reviewed or trusted" });
  }
  if (unit.enabled && hasRuntimeComponents(unit) && unit.trustLevel === "unreviewed") {
    findings.push({ severity: "warning", message: "runtime extension source is unreviewed" });
  }
  if (unit.enabled && sourceClass !== "user" && unit.permissionRisk !== "low" && unit.sourceDigest === undefined && unit.signature === undefined) {
    findings.push({ severity: "warning", message: "source is not pinned by digest or signature" });
  }
  return findings;
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

function canUseResult(allowed, skillId, workflowName, skill, workflow, reasons, role = { roles: [], capabilityRoles: [] }, trust = null) {
  const automaticAllowed = allowed && ["workflow-auto", "global-auto"].includes(skill?.invocation ?? "");
  return {
    allowed,
    automaticAllowed,
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

function workflowSkillRole(workflow, skillId) {
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

async function loadConfig(path) {
  const text = await readFile(path, "utf8");
  const document = YAML.parseDocument(text);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  requireYamlMap(document.contents, "config root");
  return {
    document,
    originalText: text
  };
}

async function writeCheckedConfig(document, originalText, options, message) {
  const nextText = preserveLineEndings(String(document), originalText);
  const plan = textChangePlan(originalText, nextText);
  const tempPath = tempConfigPath(options.configPath);
  await writeFile(tempPath, nextText, { encoding: "utf8", flag: "wx" });
  try {
    const workspace = await loadWorkspace({ configPath: tempPath, skillsRoot: options.skillsRoot });
    const policy = checkPolicy(workspace);
    if (!policy.ok) {
      throw new Error(`Policy update would create invalid config:\n${policy.errors.join("\n")}`);
    }
    const validateUses = options.validateUses ?? (options.validateUse === undefined ? [] : [options.validateUse]);
    for (const useRequest of validateUses) {
      const use = canUseSkill(workspace, useRequest.skillId, useRequest.workflow);
      if (!use.allowed) {
        throw new Error(`Control update would not be usable:\n${use.reasons.join("\n")}`);
      }
    }
    if (options.dryRun === true) {
      return { message, policy, dryRun: true, changed: plan.changed, plan };
    }
    if (plan.changed) {
      await rename(tempPath, options.configPath);
    }
    return { message, policy, dryRun: false, changed: plan.changed, plan };
  } finally {
    await rm(tempPath, { force: true });
  }
}

function tempConfigPath(configPath) {
  return join(dirname(configPath), `.${basename(configPath)}.${randomUUID()}.tmp`);
}

function preserveLineEndings(text, reference) {
  return reference.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}

function skillById(workspace, skillId) {
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  if (skill === undefined) {
    throw new Error(`Unknown skill: ${skillId}`);
  }
  return skill;
}

function workflowByName(workspace, name) {
  const workflow = workspace.workflows.find((candidate) => candidate.name === name);
  if (workflow === undefined) {
    throw new Error(`Unknown workflow: ${name}`);
  }
  return workflow;
}

function requireConfigSkill(document, skillId) {
  const skills = requireMapAt(document, ["skills"], "skills");
  const skill = skills.get(skillId, true);
  if (skill === undefined) {
    throw new Error(`Unknown skill: ${skillId}`);
  }
  return requireYamlMap(skill, `skills.${skillId}`);
}

function requireConfigWorkflow(document, workflowName) {
  const workflows = requireMapAt(document, ["workflows"], "workflows");
  const workflow = workflows.get(workflowName, true);
  if (workflow === undefined) {
    throw new Error(`Unknown workflow: ${workflowName}`);
  }
  const raw = requireYamlMap(workflow, `workflows.${workflowName}`);
  ensureSeq(raw, "active_skills", document);
  ensureSeq(raw, "blocked_skills", document);
  const requiredCapabilities = raw.get("required_capabilities", true);
  if (requiredCapabilities !== undefined) {
    requireYamlMap(requiredCapabilities, `workflows.${workflowName}.required_capabilities`);
  }
  return raw;
}

function ensureRequiredCapability(workflow, capabilityName, document) {
  let capabilities = workflow.get("required_capabilities", true);
  if (capabilities === undefined) {
    capabilities = document.createNode({});
    workflow.set("required_capabilities", capabilities);
  }
  const capabilityMap = requireYamlMap(capabilities, "required_capabilities");
  if (capabilityMap.get(capabilityName, true) === undefined) {
    capabilityMap.set(capabilityName, document.createNode({
      preferred: "",
      fallback: [],
      policy: "manual-only"
    }));
  }
  const capability = requireYamlMap(capabilityMap.get(capabilityName, true), `required_capabilities.${capabilityName}`);
  ensureSeq(capability, "fallback", document);
  return capability;
}

function requireMapAt(document, path, label) {
  return requireYamlMap(document.getIn(path, true), label);
}

function ensureMapAt(document, path, label) {
  const existing = document.getIn(path, true);
  if (existing !== undefined) {
    const map = requireYamlMap(existing, label);
    map.flow = false;
    return map;
  }
  const next = document.createNode({});
  next.flow = false;
  document.setIn(path, next);
  return next;
}

function requireYamlMap(value, label) {
  if (!YAML.isMap(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
}

function ensureSeq(map, key, document) {
  const existing = map.get(key, true);
  if (existing === undefined) {
    const next = document.createNode([]);
    next.flow = false;
    map.set(key, next);
    return next;
  }
  if (!YAML.isSeq(existing)) {
    throw new Error(`${key} must be a list`);
  }
  existing.flow = false;
  return existing;
}

function optionalSeq(map, key) {
  const existing = map.get(key, true);
  if (existing === undefined) {
    return undefined;
  }
  if (!YAML.isSeq(existing)) {
    throw new Error(`${key} must be a list`);
  }
  return existing;
}

function optionalMap(map, key) {
  const existing = map.get(key, true);
  if (existing === undefined) {
    return undefined;
  }
  return requireYamlMap(existing, key);
}

function mapValues(map, label) {
  return map.items.map((pair) => requireYamlMap(pair.value, label));
}

function readMapString(map, key, fallback) {
  const value = map.get(key);
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function addUnique(values, value) {
  if (!sequenceIncludes(values, value)) {
    values.add(value);
  }
}

function removeValue(values, value) {
  for (let index = values.items.length - 1; index >= 0; index -= 1) {
    if (nodeScalarValue(values.items[index]) === value) {
      values.delete(index);
    }
  }
}

function removeSkillFromRequiredCapabilities(workflow, skillId, document) {
  const capabilities = optionalMap(workflow, "required_capabilities");
  if (capabilities === undefined) {
    return;
  }
  for (const capability of mapValues(capabilities, "required_capability")) {
    if (readMapString(capability, "preferred", "") === skillId) {
      capability.set("preferred", "");
    }
    removeValue(ensureSeq(capability, "fallback", document), skillId);
  }
}

function configSkillReferences(document, skillId) {
  return [
    ...workflowReferences(document, skillId),
    ...capabilityReferences(document, skillId),
    ...installUnitReferences(document, skillId)
  ];
}

function workflowReferences(document, skillId) {
  const workflows = optionalRootMap(document, "workflows");
  if (workflows === undefined) {
    return [];
  }
  const references = [];
  for (const pair of workflows.items) {
    const name = nodeScalarValue(pair.key);
    const workflow = requireYamlMap(pair.value, `workflows.${name}`);
    const activeSkills = optionalSeq(workflow, "active_skills");
    const blockedSkills = optionalSeq(workflow, "blocked_skills");
    if (activeSkills !== undefined && sequenceIncludes(activeSkills, skillId)) {
      references.push(`workflow ${name}.active_skills`);
    }
    if (blockedSkills !== undefined && sequenceIncludes(blockedSkills, skillId)) {
      references.push(`workflow ${name}.blocked_skills`);
    }
    const requiredCapabilities = optionalMap(workflow, "required_capabilities");
    if (requiredCapabilities === undefined) {
      continue;
    }
    for (const capabilityPair of requiredCapabilities.items) {
      const capabilityName = nodeScalarValue(capabilityPair.key);
      const requirement = requireYamlMap(capabilityPair.value, `workflows.${name}.required_capabilities.${capabilityName}`);
      if (readMapString(requirement, "preferred", "") === skillId) {
        references.push(`workflow ${name}.required_capabilities.${capabilityName}.preferred`);
      }
      const fallback = optionalSeq(requirement, "fallback");
      if (fallback !== undefined && sequenceIncludes(fallback, skillId)) {
        references.push(`workflow ${name}.required_capabilities.${capabilityName}.fallback`);
      }
    }
  }
  return references;
}

function capabilityReferences(document, skillId) {
  const capabilities = optionalRootMap(document, "capabilities");
  if (capabilities === undefined) {
    return [];
  }
  const references = [];
  for (const pair of capabilities.items) {
    const name = nodeScalarValue(pair.key);
    const capability = requireYamlMap(pair.value, `capabilities.${name}`);
    if (readMapString(capability, "canonical", "") === skillId) {
      references.push(`capability ${name}.canonical`);
    }
    const alternatives = optionalSeq(capability, "alternatives");
    if (alternatives !== undefined && sequenceIncludes(alternatives, skillId)) {
      references.push(`capability ${name}.alternatives`);
    }
  }
  return references;
}

function installUnitReferences(document, skillId) {
  const installUnits = optionalRootMap(document, "install_units");
  if (installUnits === undefined) {
    return [];
  }
  const references = [];
  for (const pair of installUnits.items) {
    const id = nodeScalarValue(pair.key);
    const unit = requireYamlMap(pair.value, `install_units.${id}`);
    const components = optionalMap(unit, "components");
    const skills = components === undefined ? undefined : optionalSeq(components, "skills");
    if (skills !== undefined && sequenceIncludes(skills, skillId)) {
      references.push(`install_unit ${id}.components.skills`);
    }
  }
  return references;
}

function removeSkillReferences(document, skillId) {
  const workflows = optionalRootMap(document, "workflows");
  if (workflows !== undefined) {
    for (const workflow of mapValues(workflows, "workflow")) {
      const activeSkills = optionalSeq(workflow, "active_skills");
      const blockedSkills = optionalSeq(workflow, "blocked_skills");
      if (activeSkills !== undefined) {
        removeValue(activeSkills, skillId);
      }
      if (blockedSkills !== undefined) {
        removeValue(blockedSkills, skillId);
      }
      removeSkillFromRequiredCapabilities(workflow, skillId, document);
    }
  }
  const capabilities = optionalRootMap(document, "capabilities");
  if (capabilities !== undefined) {
    for (const capability of mapValues(capabilities, "capability")) {
      if (readMapString(capability, "canonical", "") === skillId) {
        capability.set("canonical", "");
      }
      const alternatives = optionalSeq(capability, "alternatives");
      if (alternatives !== undefined) {
        removeValue(alternatives, skillId);
      }
    }
  }
  const installUnits = optionalRootMap(document, "install_units");
  if (installUnits !== undefined) {
    for (const unit of mapValues(installUnits, "install_unit")) {
      const components = optionalMap(unit, "components");
      const skills = components === undefined ? undefined : optionalSeq(components, "skills");
      if (skills !== undefined) {
        removeValue(skills, skillId);
      }
    }
  }
}

function optionalRootMap(document, key) {
  const existing = document.get(key, true);
  return existing === undefined ? undefined : requireYamlMap(existing, key);
}

function validateSkillState(status, invocation, exposure) {
  if (!STATUS_VALUES.has(status)) {
    throw new Error(`Unsupported status: ${status}`);
  }
  if (!INVOCATION_VALUES.has(invocation)) {
    throw new Error(`Unsupported invocation: ${invocation}`);
  }
  if (!EXPOSURE_VALUES.has(exposure)) {
    throw new Error(`Unsupported exposure: ${exposure}`);
  }
}

function validateHarnessStatus(status) {
  if (!HARNESS_STATUS_VALUES.has(status)) {
    throw new Error(`Unsupported harness status: ${status}`);
  }
}

function ensureCallableWorkflowSkill(skillId, skill) {
  const status = readMapString(skill, "status", "vendor");
  const invocation = readMapString(skill, "invocation", "manual-only");
  if (NON_CALLABLE_WORKFLOW_STATUSES.has(status)) {
    throw new Error(`Cannot attach non-callable skill ${skillId} with status: ${status}`);
  }
  if (NON_CALLABLE_WORKFLOW_INVOCATIONS.has(invocation)) {
    throw new Error(`Cannot attach non-callable skill ${skillId} with invocation: ${invocation}`);
  }
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function downgradeIfUnscopedWorkflowAuto(document, skillId) {
  const skill = requireConfigSkill(document, skillId);
  if (readMapString(skill, "invocation", "") !== "workflow-auto") {
    return;
  }
  const workflows = requireMapAt(document, ["workflows"], "workflows");
  for (const raw of mapValues(workflows, "workflow")) {
    const activeSkills = optionalSeq(raw, "active_skills");
    if (activeSkills !== undefined && sequenceIncludes(activeSkills, skillId)) {
      return;
    }
    const capabilities = optionalMap(raw, "required_capabilities");
    if (capabilities === undefined) {
      continue;
    }
    for (const requirement of mapValues(capabilities, "required_capability")) {
      const fallback = optionalSeq(requirement, "fallback");
      if (readMapString(requirement, "preferred", "") === skillId || (fallback !== undefined && sequenceIncludes(fallback, skillId))) {
        return;
      }
    }
  }
  skill.set("invocation", "manual-only");
  const status = readMapString(skill, "status", "");
  if (status === "active" || status === "active-auto") {
    skill.set("status", "candidate");
  }
}

function sequenceIncludes(sequence, value) {
  return sequence.items.some((item) => nodeScalarValue(item) === value);
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function nodeScalarValue(node) {
  return node !== null && typeof node === "object" && "value" in node ? node.value : node;
}
