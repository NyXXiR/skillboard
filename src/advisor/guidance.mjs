import { command } from "./action-core.mjs";

const GUARD_WHEN = "before invoking a skill";

export function buildAssistantGuidance(brief) {
  const status = guidanceStatus(brief);
  const choices = status === "invalid-config" || hasPolicyErrors(brief) ? [] : choicesFromActions(brief.actions ?? []);
  return {
    status,
    summary: summaryForStatus(status, brief),
    recommended_next_step: recommendedNextStep(status, brief, choices),
    choices,
    guard: {
      required: true,
      when: GUARD_WHEN,
      command_hint: guardCommandHint(brief)
    }
  };
}

function guidanceStatus(brief) {
  if (hasInvalidConfig(brief)) {
    return "invalid-config";
  }
  if (brief.error?.code === "not-initialized") {
    return "not-initialized";
  }
  if (brief.error?.code === "unknown-workflow" || brief.workflow?.unknown === true) {
    return "unknown-workflow";
  }
  if (brief.workflow?.needs_selection === true || brief.workflow?.selected === null) {
    return "workflow-selection-needed";
  }
  if (hasPolicyErrors(brief)) {
    return "blocked";
  }
  if ((brief.review_queue ?? []).length > 0 || brief.health?.review_required === true) {
    return "needs-decision";
  }
  if (brief.health?.policy?.ok === false || brief.ok === false) {
    return "blocked";
  }
  return "ready";
}

function hasInvalidConfig(brief) {
  return brief.error?.code === "invalid-config"
    || (brief.health?.config?.exists === true && brief.health.config.valid === false);
}

function summaryForStatus(status, brief) {
  const readyCount = (brief.skills?.automatic_allowed?.length ?? 0) + (brief.skills?.manual_allowed?.length ?? 0);
  const reviewCount = brief.review_queue?.length ?? 0;
  const decisionCount = reviewCount === 0 ? (brief.actions?.length ?? 0) : reviewCount;
  const blockedCount = brief.skills?.blocked?.length ?? 0;
  switch (status) {
    case "ready":
      return `SkillBoard is ready; ${readyCount} skills are available in this workflow.`;
    case "needs-decision":
      return `SkillBoard needs ${decisionCount} user decisions before this workflow is fully ready.`;
    case "blocked":
      return `SkillBoard found blocking policy issues; ${blockedCount} skills are blocked for safety.`;
    case "not-initialized":
      return "SkillBoard is not initialized in this project.";
    case "invalid-config":
      return "SkillBoard cannot read the project configuration.";
    case "workflow-selection-needed":
      return "SkillBoard needs a workflow selection before applying action cards.";
    case "unknown-workflow":
      return `SkillBoard does not know workflow ${brief.workflow?.selected ?? "the requested workflow"}.`;
    default:
      return "SkillBoard could not determine the current guidance state.";
  }
}

function recommendedNextStep(status, brief, choices) {
  const firstChoice = choices[0];
  switch (status) {
    case "ready":
      return "Run the guard check before invoking any selected skill.";
    case "needs-decision":
      return firstChoice === undefined
        ? "Ask the user which pending review decision to make."
        : `Ask the user whether to approve: ${firstChoice.label}.`;
    case "blocked":
      if (hasPolicyErrors(brief)) {
        return "Fix the SkillBoard policy errors before applying actions or invoking skills.";
      }
      return firstChoice === undefined
        ? "Resolve the blocking policy issue before invoking skills."
        : `Review the blocked item before applying: ${firstChoice.label}.`;
    case "not-initialized":
      return firstChoice === undefined
        ? "Initialize SkillBoard before checking skill availability."
        : `Ask the user whether to approve: ${firstChoice.label}.`;
    case "invalid-config":
      return "Fix the SkillBoard configuration before checking skill availability.";
    case "workflow-selection-needed":
      return (brief.workflow?.candidates?.length ?? 0) === 0
        ? "Set up SkillBoard by refreshing inventory, then add a harness and workflow before applying action cards."
        : "Ask the user which workflow to use.";
    case "unknown-workflow":
      return "Ask the user to choose one of the configured workflows.";
    default:
      return null;
  }
}

function hasPolicyErrors(brief) {
  return (brief.health?.policy?.errors?.length ?? 0) > 0;
}

function choicesFromActions(actions) {
  return actions.filter(confirmableAction).map((action) => ({
    label: action.label,
    action_id: action.id,
    risk: action.risk,
    requires_confirmation: action.requires_user_confirmation,
    effect: action.reason,
    blocked_reason: action.blocked_reason ?? action.application?.blocked_reason ?? null
  }));
}

function confirmableAction(action) {
  return action.blocked_reason === null
    && (action.application?.blocked_reason ?? null) === null
    && (action.application?.apply ?? null) !== null;
}

function guardCommandHint(brief) {
  if (hasInvalidConfig(brief)) {
    return null;
  }
  if (brief.workflow?.selected === null || brief.workflow?.unknown === true || brief.workflow?.needs_selection === true) {
    return null;
  }
  return command([
    "skillboard", "guard", "use", "<skill-id>",
    "--workflow", brief.workflow.selected,
    "--config", brief.health.config_path,
    "--skills", brief.health.skills_root
  ]).display;
}
