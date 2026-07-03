// allow: SIZE_OK - action-card construction split is deferred from the 0.2.7 release gate.
import {
  applyOrNull,
  blockedByWorkflow,
  command,
  linkReviewQueue,
  makeAction,
  sortActions,
  workflowResolved
} from "./action-core.mjs";
import { withApplicationCommands } from "./application-commands.mjs";
import { buildSetupGuidanceActions } from "./setup-actions.mjs";
import { trustRecommendationAction } from "./trust-policy.mjs";

const WRITABLE_MODES = new Set(["manual-only", "router-only", "workflow-auto"]);
const NON_ACTIVATABLE_STATUSES = new Set(["blocked", "deprecated", "archived", "removed"]);

export function buildInitActions(paths) {
  return [makeAction({
    kind: "init-project",
    targetId: paths.root,
    label: "Initialize SkillBoard in this project",
    reason: "SkillBoard is not initialized for this project.",
    risk: "low",
    requiresUserConfirmation: true,
    dryRun: null,
    apply: null,
    appliesTo: { kind: "project", id: paths.root },
    blockedReason: "skillboard init does not have a dry-run preview command.",
    advanced: { root: paths.root }
  })];
}

export function buildActionCards(context) {
  const actions = withApplicationCommands([
    ...buildSetupGuidanceActions(context),
    ...reviewInstallUnitActions(context),
    ...activateSkillActions(context),
    ...blockSkillActions(context),
    ...hookInstallActions(context),
    ...removeSkillForceActions(context),
    resetCleanupAction(context)
  ].filter(Boolean).sort(sortActions), context);
  return {
    actions,
    reviewQueue: linkReviewQueue(context.reviewQueue, actions)
  };
}

function reviewInstallUnitActions({ paths, workflow, reviewQueue }) {
  const units = new Map();
  for (const entry of reviewQueue) {
    const unitId = entry.advanced.install_unit ?? entry.advanced.source_id;
    if (unitId !== undefined && entry.kind === "install_unit") {
      units.set(unitId, {
        risk: entry.risk,
        recommended: entry.advanced.recommended_trust_level ?? "reviewed"
      });
    }
  }
  return [...units.entries()].map(([unitId, { risk, recommended }]) => {
    const action = trustRecommendationAction(recommended);
    const dryRun = command([
      "skillboard", "review", "install-unit", unitId, "--trust-level", recommended,
      "--config", paths.configPath, "--skills", paths.skillsRoot, "--dry-run", "--json"
    ]);
    return makeAction({
      kind: action.kind,
      targetId: unitId,
      label: `${action.label} ${unitId}`,
      reason: action.reason,
      risk,
      requiresUserConfirmation: true,
      dryRun,
      apply: applyOrNull(workflow, dryRun, [
        "skillboard", "review", "install-unit", unitId, "--trust-level", recommended,
        "--config", paths.configPath, "--skills", paths.skillsRoot, "--json"
      ]),
      appliesTo: { kind: "install_unit", id: unitId },
      blockedReason: blockedByWorkflow(workflow),
      advanced: { trust_level: recommended }
    });
  });
}

function activateSkillActions({ paths, workflow, skills, workspace }) {
  const candidates = [
    ...skills.not_in_workflow,
    ...skills.blocked.filter((skill) => missingProvenance(workspace, skill.id) || canActivate(skill))
  ];
  return candidates.flatMap((skill) => {
    if (missingProvenance(workspace, skill.id)) {
      return [blockedActivateAction(paths, workflow, skill)];
    }
    if (!canActivate(skill)) {
      return [];
    }
    const mode = activationMode(skill);
    const risk = riskFromSkill(skill);
    const dryRun = command([
      "skillboard", "activate", skill.id, "--workflow", workflow.selected, "--mode", mode,
      "--config", paths.configPath, "--skills", paths.skillsRoot, "--dry-run", "--json"
    ]);
    return [makeAction({
      kind: "activate-skill",
      targetId: skill.id,
      label: `Activate ${skill.id} in this workflow`,
      reason: "Add this reviewed skill to the selected workflow.",
      risk,
      dryRun,
      apply: applyOrNull(workflow, dryRun, [
        "skillboard", "activate", skill.id, "--workflow", workflow.selected, "--mode", mode,
        "--config", paths.configPath, "--skills", paths.skillsRoot, "--json"
      ]),
      appliesTo: { kind: "skill", id: skill.id, workflow: workflow.selected },
      blockedReason: blockedByWorkflow(workflow),
      advanced: skillAdvanced(skill, { mode })
    })];
  });
}

function blockSkillActions({ paths, workflow, skills }) {
  if (!workflowResolved(workflow)) {
    return [];
  }
  return [...skills.automatic_allowed, ...skills.manual_allowed].map((skill) => {
    const dryRun = command([
      "skillboard", "block", skill.id, "--workflow", workflow.selected,
      "--config", paths.configPath, "--skills", paths.skillsRoot, "--dry-run", "--json"
    ]);
    return makeAction({
      kind: "block-skill",
      targetId: skill.id,
      label: `Disable ${skill.id} in this workflow`,
      reason: "Workflow-scoped disable; this does not delete the skill.",
      risk: "medium",
      dryRun,
      apply: command([
        "skillboard", "block", skill.id, "--workflow", workflow.selected,
        "--config", paths.configPath, "--skills", paths.skillsRoot, "--json"
      ]),
      appliesTo: { kind: "skill", id: skill.id, workflow: workflow.selected },
      blockedReason: null,
      advanced: skillAdvanced(skill)
    });
  });
}

function hookInstallActions({ paths, workflow }) {
  if (workflow.selected === null || workflow.unknown) {
    return [];
  }
  const dryRun = command([
    "skillboard", "hook", "install", "--workflow", workflow.selected,
    "--config", paths.configPath, "--skills", paths.skillsRoot, "--dry-run", "--json"
  ]);
  return [makeAction({
    kind: "hook-install",
    targetId: `guard:${workflow.selected}`,
    label: `Preview guard hook install for ${workflow.selected}`,
    reason: "Preview the workflow guard hook install; no files will be changed until you apply it.",
    risk: "high",
    dryRun,
    apply: applyOrNull(workflow, dryRun, [
      "skillboard", "hook", "install", "--workflow", workflow.selected,
      "--config", paths.configPath, "--skills", paths.skillsRoot, "--json"
    ]),
    appliesTo: { kind: "hook", id: `guard:${workflow.selected}`, workflow: workflow.selected },
    blockedReason: blockedByWorkflow(workflow),
    advanced: { workflow: workflow.selected }
  })];
}

function removeSkillForceActions({ paths, workflow, skills, workspace }) {
  return skills.blocked
    .filter((skill) => !missingProvenance(workspace, skill.id))
    .filter((skill) => !canActivate(skill))
    .map((skill) => {
      const dryRun = command([
        "skillboard", "remove", "skill", skill.id, "--force",
        "--config", paths.configPath, "--skills", paths.skillsRoot, "--dry-run", "--json"
      ]);
      return makeAction({
        kind: "remove-skill-force",
        targetId: skill.id,
        label: `Remove ${skill.id} from config with force`,
        reason: "Preview forced config-reference removal before applying it.",
        risk: "high",
        dryRun,
        apply: applyOrNull(workflow, dryRun, [
          "skillboard", "remove", "skill", skill.id, "--force",
          "--config", paths.configPath, "--skills", paths.skillsRoot, "--json"
        ]),
        appliesTo: { kind: "skill", id: skill.id },
        blockedReason: blockedByWorkflow(workflow),
        advanced: skillAdvanced(skill, { force: true })
      });
    });
}

function resetCleanupAction({ paths, workflow, cleanup }) {
  const dryRun = command([
    "skillboard", "uninstall", "--dir", paths.root, "--purge", "--dry-run"
  ]);
  return makeAction({
    kind: "reset-cleanup",
    targetId: paths.root,
    label: "Purge SkillBoard project footprint",
    reason: "Preview full SkillBoard policy cleanup before applying it.",
    risk: "destructive",
    dryRun,
    apply: applyOrNull(workflow, dryRun, [
      "skillboard", "uninstall", "--dir", paths.root, "--purge"
    ]),
    appliesTo: { kind: "project", id: paths.root },
    blockedReason: blockedByWorkflow(workflow),
    advanced: { full_reset: cleanup.full_reset }
  });
}

function blockedActivateAction(paths, workflow, skill) {
  return makeAction({
    kind: "activate-skill",
    targetId: skill.id,
    label: `Activation blocked for ${skill.id}`,
    reason: "Skill provenance must be declared before activation can be suggested.",
    risk: "high",
    dryRun: null,
    apply: null,
    appliesTo: { kind: "skill", id: skill.id, workflow: workflow.selected },
    blockedReason: `Missing owner_install_unit/provenance for unit-managed skill ${skill.id}.`,
    advanced: skillAdvanced(skill, { config_path: paths.configPath })
  });
}

function canActivate(skill) {
  return activationMode(skill) !== null && skill.advanced.trust.reviewed === true;
}

function activationMode(skill) {
  if (NON_ACTIVATABLE_STATUSES.has(skill.advanced.status)) {
    return null;
  }
  if (WRITABLE_MODES.has(skill.advanced.invocation)) {
    return skill.advanced.invocation;
  }
  if (
    skill.advanced.owner_install_unit !== undefined
    && skill.advanced.owner_install_unit !== null
    && skill.advanced.status === "quarantined"
    && skill.advanced.invocation === "blocked"
  ) {
    return "manual-only";
  }
  return null;
}

function missingProvenance(workspace, skillId) {
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  if (skill?.exposure === "unit-managed" && skill.ownerInstallUnit === undefined) {
    return true;
  }
  return skill?.ownerInstallUnit !== undefined
    && !workspace.installUnits.some((unit) => unit.id === skill.ownerInstallUnit);
}

function riskFromSkill(skill) {
  return skill.advanced.trust.permissionRisk === "high" ? "high" : "medium";
}

function skillAdvanced(skill, extra = {}) {
  return {
    invocation: skill.advanced.invocation,
    owner_install_unit: skill.advanced.owner_install_unit,
    source_class: skill.advanced.source_class,
    ...extra
  };
}
