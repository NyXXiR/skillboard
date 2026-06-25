import {
  canUseSkill,
  explainSkill,
  listSkills
} from "../control.mjs";
import { emptySkillGroups } from "./schema.mjs";
import { sortById } from "./sort.mjs";

export function skillsWithoutWorkflow(workspace) {
  const groups = emptySkillGroups();
  groups.installed_only = installedOnlyEntries(workspace);
  return sortSkillGroups(groups);
}

export function skillsForWorkflow(workspace, workflowName, sourceAudit = { units: [] }) {
  if (workflowName === null) {
    const groups = emptySkillGroups();
    groups.installed_only = installedOnlyEntries(workspace);
    return sortSkillGroups(groups);
  }

  const groups = emptySkillGroups();
  const sourceFindings = findingsBySource(sourceAudit);
  for (const summary of listSkills(workspace)) {
    const skill = workspace.skills.find((candidate) => candidate.id === summary.id);
    const explanation = explainSkill(workspace, summary.id);
    const use = canUseSkill(workspace, summary.id, workflowName);
    const group = groupForDeclaredSkill(workspace, skill, use, sourceFindings);
    const entry = declaredSkillEntry(summary, explanation, use, group);
    if (use.allowed) {
      if (use.automaticAllowed) {
        groups.automatic_allowed.push(entry);
      } else {
        groups.manual_allowed.push(entry);
      }
    } else {
      groups[group].push(entry);
    }
  }
  groups.installed_only = installedOnlyEntries(workspace);
  return sortSkillGroups(groups);
}

function declaredSkillEntry(summary, explanation, use, group) {
  return {
    id: summary.id,
    label: summary.id,
    path: summary.path,
    reason: reasonForGroup(group, use?.reasons ?? []),
    advanced: {
      status: summary.status,
      invocation: summary.invocation,
      exposure: summary.exposure,
      category: summary.category,
      source_class: explanation.source.class,
      owner_install_unit: explanation.source.ownerInstallUnit,
      workflow_roles: use?.roles ?? summary.workflowRoles,
      capability_roles: use?.capabilityRoles ?? [],
      trust: explanation.trust
    }
  };
}

function groupForDeclaredSkill(workspace, skill, use, sourceFindings) {
  if (use.allowed) {
    return use.automaticAllowed ? "automatic_allowed" : "manual_allowed";
  }
  const findings = sourceFindings.get(skill?.ownerInstallUnit) ?? [];
  const hardBlocked = hasHardSafetyBlock(workspace, skill, use.reasons, findings);
  if (isNotInWorkflow(use.reasons)) {
    return hardBlocked ? "blocked" : "not_in_workflow";
  }
  if (!hardBlocked && isReviewableTrustGap(workspace, skill, use.reasons)) {
    return "needs_review";
  }
  return "blocked";
}

function installedOnlyEntries(workspace) {
  const declaredPaths = new Set(workspace.skills.map((skill) => skill.path));
  return workspace.installedSkills
    .filter((skill) => !declaredPaths.has(skill.path))
    .map((skill) => ({
      id: skill.id,
      label: skill.name ?? skill.id,
      path: skill.path,
      reason: "Discovered on disk but not declared in skillboard.config.yaml.",
      advanced: {
        name: skill.name ?? null,
        description: skill.description ?? null
      }
    }))
    .sort(sortById);
}

function reasonForGroup(group, reasons) {
  if (group === "not_in_workflow") {
    return reasons.find(isNotInWorkflowReason) ?? reasons[0] ?? null;
  }
  if (group === "needs_review") {
    return reasons.find(isReviewReason) ?? reasons[0] ?? null;
  }
  if (group === "blocked") {
    return reasons.find(isHardReason) ?? reasons[0] ?? null;
  }
  return reasons[0] ?? null;
}

function isNotInWorkflow(reasons) {
  return reasons.some(isNotInWorkflowReason);
}

function isReviewableTrustGap(workspace, skill, reasons) {
  return hasKnownProvenance(workspace, skill) && reasons.some(isReviewReason);
}

function hasHardSafetyBlock(workspace, skill, reasons, findings) {
  if (hasMissingProvenance(workspace, skill)) {
    return true;
  }
  if (isNonCallableSkill(skill)) {
    return true;
  }
  return reasons.some(isHardReason) || findings.some(isHardFinding);
}

function hasMissingProvenance(workspace, skill) {
  if (skill === undefined) {
    return true;
  }
  if (skill.exposure === "unit-managed" && skill.ownerInstallUnit === undefined) {
    return true;
  }
  return skill.ownerInstallUnit !== undefined
    && !workspace.installUnits.some((unit) => unit.id === skill.ownerInstallUnit);
}

function hasKnownProvenance(workspace, skill) {
  return skill?.ownerInstallUnit !== undefined
    && workspace.installUnits.some((unit) => unit.id === skill.ownerInstallUnit);
}

function isNonCallableSkill(skill) {
  return ["blocked", "quarantined", "deprecated", "archived", "removed"].includes(skill?.status)
    || ["blocked", "deprecated"].includes(skill?.invocation);
}

function findingsBySource(sourceAudit) {
  return new Map((sourceAudit.units ?? []).map((unit) => [unit.id, unit.findings ?? []]));
}

function isNotInWorkflowReason(reason) {
  return reason.includes("is not active, preferred, or fallback in workflow");
}

function isReviewReason(reason) {
  const normalized = reason.toLowerCase();
  return normalized.includes("unreviewed")
    || normalized.includes("not reviewed")
    || normalized.includes("not trusted");
}

function isHardReason(reason) {
  const normalized = reason.toLowerCase();
  return normalized.includes("policy check failed")
    || normalized.includes("unknown skill")
    || normalized.includes("unknown workflow")
    || normalized.includes("blocks skill")
    || normalized.includes("source trust policy")
    || (normalized.includes("install unit") && normalized.includes("disabled"))
    || normalized.includes("non-callable")
    || normalized.includes("global-auto but not global-meta");
}

function isHardFinding(finding) {
  if (isReviewReason(finding.message)) {
    return false;
  }
  return finding.severity === "error";
}

function sortSkillGroups(groups) {
  return {
    automatic_allowed: groups.automatic_allowed.sort(sortById),
    manual_allowed: groups.manual_allowed.sort(sortById),
    needs_review: groups.needs_review.sort(sortById),
    blocked: groups.blocked.sort(sortById),
    not_in_workflow: groups.not_in_workflow.sort(sortById),
    installed_only: groups.installed_only.sort(sortById)
  };
}
