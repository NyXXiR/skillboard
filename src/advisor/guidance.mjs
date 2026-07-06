import { command } from "./action-core.mjs";

const GUARD_WHEN = "before invoking a skill";
const GOAL_DOCUMENT = Object.freeze({
  path: "docs/ai-skill-routing-goal.md",
  purpose: "Preserve SkillBoard as a permissive AI skill routing layer: keep skills broadly available, resolve overlaps deterministically, explain briefly, ask after use when policy learning helps, and remember usage policy without rewriting skill bodies.",
  loop: Object.freeze([
    "observe",
    "route",
    "work",
    "explain briefly",
    "ask after",
    "remember policy"
  ]),
  simplification_rule: "Concepts must justify themselves by supporting SkillBoard's routing identity, overlap resolution, policy memory, or non-blocking user flow; remove, merge, or rename only the concepts that fail that test.",
  when_to_read: Object.freeze([
    "before changing routing",
    "before changing brief output",
    "before changing bridge instructions",
    "before changing policy UX",
    "before changing workflow UX"
  ])
});
const GUARD_ALLOWED_USE = Object.freeze({
  confirmation_required: false,
  start: "State at the start which selected skill is being used for this request.",
  finish: "State at completion which selected skill was used.",
  start_message_template: "I will use <skill-id> for this request.",
  finish_message_template: "I used <skill-id> for this request.",
  ask_user_when: "Ask the user only if the guard denies use or a policy-changing action is needed."
});

export function buildAssistantGuidance(brief, options = {}) {
  const status = guidanceStatus(brief);
  const choices = status === "invalid-config" || hasPolicyErrors(brief) ? [] : choicesFromActions(brief.actions ?? []);
  const route = options.route === undefined ? null : routeGuidance(options.route);
  const guidance = {
    status,
    summary: summaryForStatus(status, brief),
    goal_document: goalDocument(),
    recommended_next_step: recommendedNextStep(status, brief, choices, route),
    choices,
    guard: {
      required: true,
      when: GUARD_WHEN,
      command_hint: guardCommandHint(brief),
      allowed_use: GUARD_ALLOWED_USE
    }
  };
  if (route !== null) {
    guidance.route = route;
  }
  return guidance;
}

function goalDocument() {
  return {
    ...GOAL_DOCUMENT,
    loop: [...GOAL_DOCUMENT.loop],
    when_to_read: [...GOAL_DOCUMENT.when_to_read]
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
  const decisionCount = guidanceDecisionCount(brief);
  const blockedCount = brief.skills?.blocked?.length ?? 0;
  switch (status) {
    case "ready":
      return `SkillBoard is ready; ${readyCount} skills are available in this workflow.`;
    case "needs-decision":
      return `SkillBoard needs ${decisionCount} user ${decisionWord(decisionCount)} before this workflow is fully ready.`;
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

function guidanceDecisionCount(brief) {
  const skillDecisionCount = brief.skills?.needs_review?.length ?? 0;
  if (skillDecisionCount > 0) {
    return skillDecisionCount;
  }
  const reviewCount = brief.review_queue?.length ?? 0;
  return reviewCount === 0 ? (brief.actions?.length ?? 0) : reviewCount;
}

function decisionWord(count) {
  return count === 1 ? "decision" : "decisions";
}

function recommendedNextStep(status, brief, choices, route = null) {
  const firstChoice = choices[0];
  switch (status) {
    case "ready":
      if (route !== null) {
        return route.recommended_skill === null
          ? "Ask a clarifying question; no workflow capability matched this request."
          : `Use ${route.recommended_skill} for this request after the guard check passes${postUsePolicyStep(route)}.`;
      }
      return "Run the guard check before invoking any selected skill.";
    case "needs-decision":
      if (route?.recommended_skill !== null && route?.guard_allowed === true) {
        return route.post_use_policy_suggestion === null
          ? `Use ${route.recommended_skill} for this request after the guard check passes; handle pending review decisions after the task unless a policy-changing action is needed now.`
          : `Use ${route.recommended_skill} for this request after the guard check passes; after completion, ask whether to remember the suggested policy and handle pending review decisions unless a policy-changing action is needed now.`;
      }
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

function postUsePolicyStep(route) {
  return route.post_use_policy_suggestion === null
    ? ""
    : "; after completion, ask whether to remember the suggested policy";
}

function routeGuidance(route) {
  return {
    intent: route.intent,
    workflow: route.workflow,
    matched_capability: route.matched_capability,
    matched_skill: route.matched_skill ?? null,
    match_source: route.match_source,
    confidence: route.confidence,
    matched_terms: route.matched_terms,
    recommendation_reason: route.recommendation_reason,
    recommended_skill: route.recommended_skill,
    fallback_skills: route.fallback_skills,
    route_candidates: (route.route_candidates ?? []).map((candidate) => ({
      skill: candidate.skill,
      role: candidate.role,
      selected: candidate.selected,
      guard_allowed: candidate.guard_allowed,
      guard_reasons: candidate.guard_reasons,
      guard_roles: candidate.guard_roles,
      capability_roles: candidate.capability_roles
    })),
    overlap_resolution: route.overlap_resolution ?? null,
    policy_memory: route.policy_memory ?? null,
    usage_disclosure: route.usage_disclosure ?? null,
    post_use_policy_suggestion: route.post_use_policy_suggestion ?? null,
    guard_command: route.guard_command,
    guard_allowed: route.guard?.allowed ?? null,
    guard_reasons: route.guard?.reasons ?? [],
    possible_skills: route.possible_skills.map((skill) => ({
      id: skill.id,
      category: skill.category,
      allowed: skill.allowed
    }))
  };
}

function hasPolicyErrors(brief) {
  return (brief.health?.policy?.errors?.length ?? 0) > 0;
}

function choicesFromActions(actions) {
  return actions.filter(confirmableAction).map((action) => ({
    label: action.label,
    action_id: action.id,
    kind: action.kind,
    applies_to: action.applies_to ?? null,
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
