import {
  hasRuntimeComponents,
  installUnitPriority,
  installUnitSourceClass,
  isModelSelectableInvocation,
  isUserControlledSource
} from "../domain/source-classes.mjs";

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

export function workflowSkillRole(workflow, skillId) {
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

export function skillSummary(workspace, skill, workflow) {
  const source = classifySkillSource(workspace, skill);
  return {
    id: skill.id,
    path: skill.path,
    status: skill.status,
    invocation: skill.invocation,
    exposure: skill.exposure,
    category: skill.category,
    variant: skill.variant ?? null,
    sourceClass: source.class,
    sourcePriority: source.priority,
    ownerInstallUnit: source.ownerInstallUnit,
    workflowRoles: workflow === undefined ? [] : workflowSkillRole(workflow, skill.id).roles
  };
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
