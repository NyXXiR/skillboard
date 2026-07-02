import { command } from "./advisor/action-core.mjs";
import { canUseSkill } from "./control/can-use-guard.mjs";

const HIGH_CONFIDENCE = 4;
const MEDIUM_CONFIDENCE = 2;
const DEFAULT_CONFIG_PATH = "skillboard.config.yaml";
const DEFAULT_SKILLS_ROOT = "skills";
const ROUTE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "being",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "these",
  "this",
  "those",
  "to",
  "was",
  "were",
  "with",
  "without",
  "you",
  "your"
]);

export function routeSkill(workspace, options) {
  const intent = options.intent.trim();
  if (intent.length === 0) {
    throw new Error("Usage: skillboard route <intent> --workflow <name>");
  }
  const workflow = workspace.workflows.find((candidate) => candidate.name === options.workflow);
  if (workflow === undefined) {
    throw new Error(`Unknown workflow: ${options.workflow}`);
  }

  const intentTokens = tokensFor(intent);
  const candidates = capabilityRouteCandidates(workspace, workflow)
    .map((candidate) => scoreCandidate(workspace, candidate, intent, intentTokens))
    .sort((left, right) => right.score - left.score || left.capability.localeCompare(right.capability));
  const best = candidates.find((candidate) => candidate.score > 0);
  if (best === undefined) {
    const skillCandidates = skillRouteCandidates(workspace, workflow, intent, intentTokens);
    const skillBest = skillCandidates.find((candidate) => candidate.score > 0 && candidate.allowed)
      ?? skillCandidates.find((candidate) => candidate.score > 0);
    return skillBest === undefined
      ? noRoute({ intent, workflow, candidates, skillCandidates, workspace })
      : skillRoute({ intent, workflow, candidate: skillBest, candidates, skillCandidates, options, workspace });
  }

  const routedSkills = best.skill_ids.map((skillId, index) => ({
    skill: skillId,
    role: index === 0 ? "preferred" : "fallback",
    guard: canUseSkill(workspace, skillId, workflow.name)
  }));
  const recommended = selectedRouteSkill(routedSkills);
  const fallbackSkills = allowedFallbackSkills(routedSkills, recommended);
  const postUsePolicySuggestion = postUsePolicySuggestionForCapabilityRoute({
    matchedCapability: best.capability,
    routeMatch: best,
    recommended,
    routedSkills,
    workflowName: workflow.name,
    options
  });

  return {
    ok: true,
    intent,
    workflow: workflow.name,
    matched_capability: best.capability,
    matched_skill: null,
    match_source: "capability",
    confidence: confidenceFor(best.score),
    matched_terms: best.matched_tokens,
    recommendation_reason: recommendationReason({
      match: `Matched capability ${best.capability}`,
      matchedFields: best.matched_fields,
      matchedTerms: best.matched_tokens,
      skill: recommended?.skill ?? null,
      guard: recommended?.guard ?? null
    }),
    recommended_skill: recommended?.skill ?? null,
    fallback_skills: fallbackSkills,
    route_candidates: routedSkills.map((entry) => routeCandidate(entry, entry.skill === recommended?.skill)),
    guard_command: recommended === null ? null : guardCommand(recommended.skill, workflow.name, options),
    guard: recommended?.guard ?? null,
    usage_disclosure: recommended?.guard.allowed === true ? usageDisclosure(recommended.skill) : null,
    post_use_policy_suggestion: postUsePolicySuggestion,
    possible_skills: possibleWorkflowSkills(workspace, workflow),
    candidates
  };
}

function noRoute({ intent, workflow, candidates, skillCandidates, workspace }) {
  return {
    ok: true,
    intent,
    workflow: workflow.name,
    matched_capability: null,
    matched_skill: null,
    match_source: "none",
    confidence: "none",
    matched_terms: [],
    recommendation_reason: "No workflow capability or skill metadata matched this request. Ask a clarifying question before choosing a skill.",
    recommended_skill: null,
    fallback_skills: [],
    route_candidates: [],
    guard_command: null,
    guard: null,
    usage_disclosure: null,
    post_use_policy_suggestion: null,
    possible_skills: possibleWorkflowSkills(workspace, workflow),
    candidates,
    skill_candidates: skillCandidates
  };
}

function skillRoute({ intent, workflow, candidate, candidates, skillCandidates, options, workspace }) {
  const routeCandidates = skillCandidates
    .filter((entry) => entry.score > 0)
    .map((entry) => ({
      skill: entry.skill_id,
      role: entry.skill_id === candidate.skill_id ? "matched" : "alternative",
      guard: canUseSkill(workspace, entry.skill_id, workflow.name)
    }));
  const selectedCandidate = routeCandidates.find((entry) => entry.skill === candidate.skill_id);
  const guard = selectedCandidate?.guard ?? canUseSkill(workspace, candidate.skill_id, workflow.name);
  const fallbackSkills = allowedFallbackSkills(routeCandidates, selectedCandidate);
  return {
    ok: true,
    intent,
    workflow: workflow.name,
    matched_capability: null,
    matched_skill: candidate.skill_id,
    match_source: "skill-metadata",
    confidence: confidenceFor(candidate.score),
    matched_terms: candidate.matched_tokens,
    recommendation_reason: recommendationReason({
      match: `Matched workflow skill metadata for ${candidate.skill_id}`,
      matchedFields: candidate.matched_fields,
      matchedTerms: candidate.matched_tokens,
      skill: candidate.skill_id,
      guard
    }),
    recommended_skill: candidate.skill_id,
    fallback_skills: fallbackSkills,
    route_candidates: routeCandidates.map((entry) => routeCandidate(entry, entry.skill === candidate.skill_id)),
    guard_command: guardCommand(candidate.skill_id, workflow.name, options),
    guard,
    usage_disclosure: guard.allowed ? usageDisclosure(candidate.skill_id) : null,
    post_use_policy_suggestion: null,
    possible_skills: possibleWorkflowSkills(workspace, workflow),
    candidates,
    skill_candidates: skillCandidates
  };
}

function routeCandidate(entry, selected) {
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

function usageDisclosure(skillId) {
  return {
    confirmation_required: false,
    start: `State at the start that ${skillId} is being used for this request.`,
    finish: `State at completion that ${skillId} was used.`,
    start_message: `I will use ${skillId} for this request.`,
    finish_message: `I used ${skillId} for this request.`,
    guard: "Run the guard automatically immediately before invocation. Ask the user only if the guard denies use or a policy-changing action is needed."
  };
}

function selectedRouteSkill(routedSkills) {
  return routedSkills.find((entry) => entry.guard.allowed) ?? routedSkills[0] ?? null;
}

function allowedFallbackSkills(routedSkills, recommended) {
  return routedSkills
    .filter((entry) => entry.guard.allowed && entry.skill !== recommended?.skill)
    .map((entry) => entry.skill);
}

function postUsePolicySuggestionForCapabilityRoute({ matchedCapability, routeMatch, recommended, routedSkills, workflowName, options }) {
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

function capabilityRouteCandidates(workspace, workflow) {
  const workflowSkillIds = new Set(workflowBoundSkillIds(workspace, workflow));
  return workspace.capabilities.flatMap((capability) => {
    const requirement = workflow.requiredCapabilities.find((candidate) => candidate.name === capability.name);
    const requiredSkillIds = uniqueStrings([
      requirement?.preferred ?? "",
      ...(requirement?.fallback ?? [])
    ]);
    const configuredSkillIds = uniqueStrings([
      ...requiredSkillIds,
      capability.canonical,
      ...capability.alternatives
    ]);
    const boundSkillIds = configuredSkillIds.filter((skillId) => workflowSkillIds.has(skillId));
    if (requirement === undefined && boundSkillIds.length === 0) {
      return [];
    }
    const skillIds = requirement === undefined ? boundSkillIds : uniqueStrings([...requiredSkillIds, ...boundSkillIds]);
    const skills = skillIds
      .map((skillId) => workspace.skills.find((skill) => skill.id === skillId))
      .filter((skill) => skill !== undefined);
    return [{
      capability: capability.name,
      default_policy: capability.defaultPolicy,
      skill_ids: skillIds,
      skills,
      required_by_workflow: requirement !== undefined
    }];
  });
}

function workflowBoundSkillIds(workspace, workflow) {
  return uniqueStrings([
    ...workflow.activeSkills,
    ...workflow.requiredCapabilities.flatMap((capability) => [capability.preferred, ...capability.fallback]),
    ...workspace.skills.filter((skill) => skill.invocation === "global-auto").map((skill) => skill.id)
  ]);
}

function scoreCandidate(workspace, candidate, intent, intentTokens) {
  const capabilityTokens = tokensFor(candidate.capability);
  let score = phraseMatchScore(intent, candidate.capability);
  const matched_tokens = [];
  const matched_fields = [];
  if (score > 0) {
    matched_fields.push("capability name");
  }
  for (const token of capabilityTokens) {
    if (intentTokens.has(token)) {
      score += 2;
      matched_tokens.push(token);
      matched_fields.push("capability name");
    }
  }
  const metadataMatch = scoreMetadataTerms(
    candidate.skills.flatMap((skill) => skillMetadataTerms(workspace, skill.id, 1)),
    intentTokens
  );
  score += metadataMatch.score;
  matched_tokens.push(...metadataMatch.matchedTokens);
  matched_fields.push(...metadataMatch.matchedFields);
  return {
    capability: candidate.capability,
    confidence: confidenceFor(score),
    score,
    matched_tokens: uniqueStrings(matched_tokens).sort(),
    matched_fields: uniqueStrings(matched_fields),
    recommended_skill: candidate.skill_ids[0] ?? null,
    fallback_skills: candidate.skill_ids.slice(1),
    skill_ids: candidate.skill_ids,
    required_by_workflow: candidate.required_by_workflow
  };
}

function skillRouteCandidates(workspace, workflow, intent, intentTokens) {
  return possibleWorkflowSkills(workspace, workflow)
    .map((skill) => scoreSkillCandidate(workspace, skill, intent, intentTokens))
    .sort((left, right) => right.score - left.score || left.skill_id.localeCompare(right.skill_id));
}

function scoreSkillCandidate(workspace, possibleSkill, intent, intentTokens) {
  const skill = workspace.skills.find((candidate) => candidate.id === possibleSkill.id);
  let score = phraseMatchScore(intent, possibleSkill.id);
  const matched_fields = score > 0 ? ["skill id"] : [];
  const metadataMatch = scoreMetadataTerms(skillMetadataTerms(workspace, possibleSkill.id, 2), intentTokens);
  score += metadataMatch.score;
  matched_fields.push(...metadataMatch.matchedFields);
  const matched_tokens = metadataMatch.matchedTokens;
  return {
    skill_id: possibleSkill.id,
    category: possibleSkill.category,
    allowed: possibleSkill.allowed,
    confidence: confidenceFor(score),
    score,
    matched_tokens: uniqueStrings(matched_tokens).sort(),
    matched_fields: uniqueStrings(matched_fields)
  };
}

function scoreMetadataTerms(terms, intentTokens) {
  let score = 0;
  const matchedTokens = [];
  const matchedFields = [];
  const seenTokens = new Set();
  for (const term of terms) {
    for (const token of tokensFor(term.value)) {
      if (!intentTokens.has(token)) {
        continue;
      }
      matchedFields.push(term.label);
      const matchedToken = canonicalRouteToken(token);
      if (seenTokens.has(matchedToken)) {
        continue;
      }
      seenTokens.add(matchedToken);
      score += term.weight;
      matchedTokens.push(matchedToken);
    }
  }
  return {
    score,
    matchedTokens,
    matchedFields: uniqueStrings(matchedFields)
  };
}

function skillMetadataTerms(workspace, skillId, weight) {
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  const installed = installedSkillFor(workspace, skillId);
  return [
    { label: "skill id", value: skill?.id ?? skillId, weight },
    { label: "skill path", value: skill?.path ?? installed?.path ?? "", weight },
    { label: "category", value: skill?.category ?? "", weight },
    { label: "SKILL.md name", value: installed?.name ?? "", weight },
    { label: "SKILL.md description", value: installed?.description ?? "", weight }
  ];
}

function installedSkillFor(workspace, skillId) {
  const skill = workspace.skills.find((candidate) => candidate.id === skillId);
  return workspace.installedSkills.find((installed) => installed.id === skillId || installed.path === skill?.path);
}

function recommendationReason({ match, matchedFields, matchedTerms, skill, guard }) {
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

function phraseMatchScore(intent, capability) {
  const normalizedIntent = phraseKey(intent);
  const normalizedCapability = phraseKey(capability);
  if (normalizedIntent.length === 0 || normalizedCapability.length === 0) {
    return 0;
  }
  return normalizedIntent.includes(normalizedCapability) || normalizedCapability.includes(normalizedIntent) ? 4 : 0;
}

function possibleWorkflowSkills(workspace, workflow) {
  const ids = workflowBoundSkillIds(workspace, workflow);
  return ids.map((skillId) => {
    const skill = workspace.skills.find((candidate) => candidate.id === skillId);
    const guard = canUseSkill(workspace, skillId, workflow.name);
    return {
      id: skillId,
      status: skill?.status ?? null,
      invocation: skill?.invocation ?? null,
      category: skill?.category ?? null,
      roles: guard.roles,
      capability_roles: guard.capabilityRoles,
      allowed: guard.allowed
    };
  });
}

function guardCommand(skillId, workflowName, options) {
  return command([
    "skillboard", "guard", "use", skillId,
    "--workflow", workflowName,
    "--config", routeConfigPath(options),
    "--skills", routeSkillsRoot(options)
  ]).display;
}

function routeConfigPath(options) {
  return options.configPath ?? DEFAULT_CONFIG_PATH;
}

function routeSkillsRoot(options) {
  return options.skillsRoot ?? DEFAULT_SKILLS_ROOT;
}

function confidenceFor(score) {
  if (score >= HIGH_CONFIDENCE) {
    return "high";
  }
  if (score >= MEDIUM_CONFIDENCE) {
    return "medium";
  }
  if (score > 0) {
    return "low";
  }
  return "none";
}

function tokensFor(value) {
  return new Set(String(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .flatMap(tokenForms)
    .filter(isRouteToken));
}

function tokenForms(token) {
  const singular = singularRouteToken(token);
  return singular === token ? [token] : [token, singular];
}

function canonicalRouteToken(token) {
  return singularRouteToken(token);
}

function singularRouteToken(token) {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("s") && !/(?:ss|us|is)$/u.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

function isRouteToken(token) {
  return token.length > 1 && !ROUTE_STOP_WORDS.has(token);
}

function phraseKey(value) {
  return [...tokensFor(value)].join(" ");
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}
