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
    kind: "setup-user",
    targetId: paths.root,
    label: "Set up the SkillBoard user control plane",
    reason: "The user-level SkillBoard policy and generated inventory do not exist yet.",
    risk: "low",
    requiresUserConfirmation: true,
    dryRun: null,
    apply: null,
    appliesTo: { kind: "user_state", id: paths.root },
    blockedReason: "Run `skillboard setup --yes` after user confirmation.",
    advanced: { root: paths.root, command: "skillboard setup --yes" }
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

export function buildV2ActionCards({ options, paths, workflow, workspace }) {
  if (workflow.unknown || workflow.needs_selection) {
    return [];
  }
  const actions = [];
  const observedSkills = new Set(workspace.inventory.skillIds);
  for (const skill of workspace.skills) {
    if (!observedSkills.has(skill.id)) {
      actions.push(skill.shared
        ? v2SharingAction(skill, paths, "unshare")
        : v2ForgetAction(skill, paths));
      continue;
    }
    const kind = skill.enabled ? "v2:disable-skill" : "v2:enable-skill";
    const operation = skill.enabled ? "disable" : "enable";
    const policyArgs = ["skillboard", "skill", operation, skill.id, "--config", paths.configPath,
      ...(paths.skillsRoot === undefined ? [] : ["--skills", paths.skillsRoot])];
    const dryRun = command([...policyArgs, "--dry-run", "--json"]);
    actions.push(makeAction({
      kind,
      targetId: skill.id,
      label: `${skill.enabled ? "Disable" : "Enable"} ${skill.id}`,
      reason: `${skill.enabled ? "Stop" : "Allow"} SkillBoard from selecting this skill.`,
      risk: "medium",
      dryRun,
      apply: command([...policyArgs, "--json"]),
      appliesTo: { kind: "skill", id: skill.id },
      blockedReason: null,
      advanced: { enabled: !skill.enabled, policy_projection_version: 2 }
    }));
    actions.push(v2SharingAction(skill, paths, skill.shared ? "unshare" : "share"));
    const intent = options?.intent?.trim();
    if (intent !== undefined && intent.length > 0
      && skill.enabled
      && !samePreference(skill.preference, intent)) {
      const intents = [...new Set([...(skill.preference?.intents ?? []), intent])]
        .sort((left, right) => left.localeCompare(right));
      const preferenceArgs = ["skillboard", "skill", "preference", skill.id, "--intent", intents.join(","), "--priority", "100", "--config", paths.configPath,
        ...(paths.skillsRoot === undefined ? [] : ["--skills", paths.skillsRoot])];
      actions.push(makeAction({
        kind: "v2:prefer-skill",
        targetId: `${skill.id}:${encodeURIComponent(intent)}`,
        label: `Prefer ${skill.id} for ${intent}`,
        reason: "Rank this enabled skill higher when it is installed for the current agent and the intent matches.",
        risk: "medium",
        dryRun: command([...preferenceArgs, "--dry-run", "--json"]),
        apply: command([...preferenceArgs, "--json"]),
        appliesTo: { kind: "skill", id: skill.id },
        blockedReason: null,
        advanced: { intents, priority: 100, policy_projection_version: 2 }
      }));
    }
  }
  return withApplicationCommands(actions.sort(sortActions), { options, paths, workflow, workspace });
}

function v2SharingAction(skill, paths, operation) {
  const args = ["skillboard", "skill", operation, skill.id, "--config", paths.configPath];
  const unshare = operation === "unshare";
  return makeAction({
    kind: unshare ? "v2:unshare-skill" : "v2:share-skill",
    targetId: skill.id,
    label: `${unshare ? "Stop sharing" : "Share"} ${skill.id}`,
    reason: unshare
      ? "Stop SkillBoard-managed cross-agent sharing while preserving agent-owned originals."
      : "Make this skill available through the user shared-skill layer.",
    risk: "medium",
    dryRun: command([...args, "--dry-run", "--json"]),
    apply: command([...args, "--json"]),
    appliesTo: { kind: "skill", id: skill.id },
    blockedReason: null,
    advanced: { shared: !unshare, policy_projection_version: 2 }
  });
}

function v2ForgetAction(skill, paths) {
  const args = ["skillboard", "skill", "forget", skill.id, "--config", paths.configPath,
    ...(paths.skillsRoot === undefined ? [] : ["--skills", paths.skillsRoot])];
  return makeAction({
    kind: "v2:forget-skill",
    targetId: skill.id,
    label: `Forget removed skill ${skill.id}`,
    reason: "Remove stale SkillBoard policy after the owning installer removed this unshared skill.",
    risk: "medium",
    dryRun: command([...args, "--dry-run", "--json"]),
    apply: command([...args, "--json"]),
    appliesTo: { kind: "skill", id: skill.id },
    blockedReason: null,
    advanced: { policy_only: true, policy_projection_version: 2 }
  });
}

function samePreference(preference, intent) {
  return preference?.priority === 100 && preference.intents.includes(intent);
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
