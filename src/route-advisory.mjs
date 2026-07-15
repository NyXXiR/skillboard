import { command } from "./advisor/action-core.mjs";

const DEFAULT_CONFIG_PATH = "skillboard.config.yaml";
const DEFAULT_SKILLS_ROOT = "skills";

export function routeCandidate(entry, selected) {
  return {
    skill: entry.skill,
    role: entry.role,
    selected,
    guard_allowed: entry.guard.allowed,
    guard_reasons: entry.guard.reasons,
    guard_roles: entry.guard.roles,
    capability_roles: entry.guard.capabilityRoles
  };
}

export function usageDisclosure(skillId, policyMemory = null) {
  const finishMessage = policyMemory?.finish_disclosure
    ?? `I used ${skillId} for this request.`;
  return {
    confirmation_required: false,
    start: `State at the start that ${skillId} is being used for this request.`,
    finish: policyMemory === null
      ? `State at completion that ${skillId} was used.`
      : `State at completion that ${skillId} was used because remembered or configured policy preferred it over other allowed skills.`,
    start_message: `I will use ${skillId} for this request.`,
    finish_message: finishMessage,
    policy_memory: policyMemory,
    guard: "Run the guard automatically immediately before invocation. Ask the user only if the guard denies use or a policy-changing action is needed."
  };
}

export function selectedRouteSkill(routedSkills) {
  return routedSkills.find((entry) => entry.guard.allowed) ?? routedSkills[0] ?? null;
}

export function allowedFallbackSkills(routedSkills, recommended) {
  return routedSkills
    .filter((entry) => entry.guard.allowed && entry.skill !== recommended?.skill)
    .map((entry) => entry.skill);
}

export function overlapResolutionForRoute({ matchedCapability, recommended, routedSkills, workflowName }) {
  if (recommended === null || routedSkills.length < 2) {
    return null;
  }
  const matchedSkills = routedSkills.map((entry) => entry.skill);
  const allowedSkills = routedSkills.filter((entry) => entry.guard.allowed).map((entry) => entry.skill);
  const deniedSkills = routedSkills.filter((entry) => !entry.guard.allowed).map((entry) => entry.skill);
  if (deniedSkills.length > 0 && recommended.guard.allowed) {
    return {
      status: "resolved",
      mode: "allowed-fallback",
      selected_skill: recommended.skill,
      matched_skills: matchedSkills,
      allowed_skills: allowedSkills,
      denied_skills: deniedSkills,
      summary: `Some matching skills are denied for ${matchedCapability}; SkillBoard keeps allowed skills available and routes ${workflowName} to ${recommended.skill}.`
    };
  }
  if (allowedSkills.length > 1) {
    return {
      status: "resolved",
      mode: "permissive-routing",
      selected_skill: recommended.skill,
      matched_skills: matchedSkills,
      allowed_skills: allowedSkills,
      denied_skills: deniedSkills,
      summary: `Multiple allowed skills match ${matchedCapability}; SkillBoard keeps them available and routes ${workflowName} to ${recommended.skill}.`
    };
  }
  return {
    status: "blocked",
    mode: "guard-denied",
    selected_skill: recommended.skill,
    matched_skills: matchedSkills,
    allowed_skills: allowedSkills,
    denied_skills: deniedSkills,
    summary: `Matching skills exist for ${matchedCapability}, but the guard currently denies the selected route.`
  };
}

export function policyMemoryForRoute({ matchedCapability, routeMatch, recommended, routedSkills, workflowName }) {
  if (recommended === null || recommended.guard.allowed !== true || recommended.role !== "preferred" || !routeMatch.required_by_workflow) {
    return null;
  }
  const alternatives = routedSkills
    .filter((entry) => entry.guard.allowed && entry.skill !== recommended.skill)
    .map((entry) => entry.skill);
  if (alternatives.length === 0) {
    return null;
  }
  const alternativeText = alternatives.join(", ");
  return {
    status: "applied",
    mode: "remembered-or-configured-preference",
    selected_skill: recommended.skill,
    available_alternatives: alternatives,
    summary: `Remembered or configured policy selected ${recommended.skill} for ${matchedCapability} in ${workflowName}; other allowed skills were also available: ${alternativeText}.`,
    finish_disclosure: `I used ${recommended.skill} for this request because SkillBoard has a remembered or configured preference for it; other allowed skills were also available: ${alternativeText}.`
  };
}

export function postUsePolicySuggestionForCapabilityRoute({ matchedCapability, routeMatch, recommended, routedSkills, workflowName, options }) {
  return postUsePolicySuggestionForDeniedPreferredFallback({
    matchedCapability,
    recommended,
    routedSkills,
    workflowName,
    options
  }) ?? postUsePolicySuggestionForAllowedAmbiguity({
    matchedCapability,
    routeMatch,
    recommended,
    routedSkills,
    workflowName,
    options
  });
}

function postUsePolicySuggestionForDeniedPreferredFallback({ matchedCapability, recommended, routedSkills, workflowName, options }) {
  if (recommended === null || recommended.role !== "fallback" || recommended.guard.allowed !== true) {
    return null;
  }
  const preferred = routedSkills.find((entry) => entry.role === "preferred");
  if (preferred === undefined || preferred.guard.allowed === true) {
    return null;
  }
  return {
    timing: "after_use",
    mode: "ask_after_use",
    reason: `SkillBoard selected fallback ${recommended.skill} because preferred skill ${preferred.skill} is denied. After completing the task, ask whether to remember ${recommended.skill} as the preferred skill for ${matchedCapability} in ${workflowName}.`,
    question: `Should I remember ${recommended.skill} as the preferred skill for similar ${matchedCapability} requests in ${workflowName}?`,
    requires_confirmation: true,
    suggested_policy: {
      kind: "prefer-skill",
      skill: recommended.skill,
      workflow: workflowName,
      capability: matchedCapability,
      command_hint: command([
        "skillboard", "prefer", recommended.skill,
        "--workflow", workflowName,
        "--capability", matchedCapability,
        "--config", routeConfigPath(options),
        "--skills", routeSkillsRoot(options)
      ]).display
    }
  };
}

function postUsePolicySuggestionForAllowedAmbiguity({ matchedCapability, routeMatch, recommended, routedSkills, workflowName, options }) {
  if (recommended === null || recommended.guard.allowed !== true || routeMatch.required_by_workflow) {
    return null;
  }
  const allowedSkills = routedSkills.filter((entry) => entry.guard.allowed);
  if (allowedSkills.length < 2) {
    return null;
  }
  return {
    timing: "after_use",
    mode: "ask_after_use",
    reason: `SkillBoard found multiple allowed skills for ${matchedCapability} and selected ${recommended.skill}. After completing the task, ask whether to remember ${recommended.skill} as the preferred skill for ${matchedCapability} in ${workflowName} to reduce future ambiguity.`,
    question: `Should I remember ${recommended.skill} as the preferred skill for similar ${matchedCapability} requests in ${workflowName}?`,
    requires_confirmation: true,
    suggested_policy: {
      kind: "prefer-skill",
      skill: recommended.skill,
      workflow: workflowName,
      capability: matchedCapability,
      command_hint: command([
        "skillboard", "prefer", recommended.skill,
        "--workflow", workflowName,
        "--capability", matchedCapability,
        "--config", routeConfigPath(options),
        "--skills", routeSkillsRoot(options)
      ]).display
    }
  };
}

export function recommendationReason({ match, matchedFields, matchedTerms, skill, guard }) {
  const fieldText = matchedFields.length === 0
    ? ""
    : ` through ${matchedFields.join(", ")}`;
  const termText = matchedTerms.length === 0
    ? ""
    : ` (${matchedTerms.join(", ")})`;
  if (skill === null || guard === null) {
    return `${match}${fieldText}${termText}, but no workflow-bound skill is available.`;
  }
  if (guard.allowed) {
    return `${match}${fieldText}${termText}; recommended ${skill} because the guard allows ${skill}.`;
  }
  const reason = guard.reasons[0] ?? "the guard did not provide a reason";
  return `${match}${fieldText}${termText}; recommended ${skill}, but the guard currently denies it: ${reason}`;
}

export function guardCommand(skillId, workflowName, options) {
  return command([
    "skillboard", "guard", "use", skillId,
    ...(workflowName === undefined ? [] : ["--workflow", workflowName]),
    ...(options.agent === undefined ? [] : ["--agent", options.agent]),
    "--config", routeConfigPath(options),
    ...(options.skillsRoot === undefined && workflowName === undefined ? [] : ["--skills", routeSkillsRoot(options)])
  ]).display;
}

function routeConfigPath(options) {
  return options.configPath ?? DEFAULT_CONFIG_PATH;
}

function routeSkillsRoot(options) {
  return options.skillsRoot ?? DEFAULT_SKILLS_ROOT;
}
