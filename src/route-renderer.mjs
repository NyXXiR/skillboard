const FORMATTERS = {
  brief: {
    prefix: "- ",
    candidatePrefix: "  - ",
    guardReasonPrefix: "    - ",
    text: safeText,
    skill: code,
    command: (value) => code(value, Number.POSITIVE_INFINITY),
    list: formatCodeList,
    guardReason: safeText,
    noMatchNextStep: "ask a clarifying question before choosing a skill.",
    includeFallbackWhenNoRecommendation: false
  },
  cli: {
    prefix: "",
    candidatePrefix: "- ",
    guardReasonPrefix: "  - ",
    text: String,
    skill: String,
    command: String,
    list: formatRawCodeList,
    guardReason: String,
    noMatchNextStep: null,
    includeFallbackWhenNoRecommendation: true
  }
};

export function renderRouteSectionLines(route, options = {}) {
  const formatter = FORMATTERS[options.format ?? "cli"] ?? FORMATTERS.cli;
  const lines = [];
  pushRouteMatchLines(lines, route, formatter, options);
  if (route.recommended_skill === null) {
    pushNoRecommendationLines(lines, route, formatter, options);
    return lines;
  }
  pushRecommendationLines(lines, route, formatter, options);
  return lines;
}

function pushRouteMatchLines(lines, route, formatter, options) {
  lines.push(`${formatter.prefix}Intent: ${formatter.text(route.intent)}`);
  if (options.includeWorkflow === true) {
    lines.push(`${formatter.prefix}Workflow: ${formatter.text(route.workflow)}`);
  }
  lines.push(`${formatter.prefix}Match source: ${route.match_source}`);
  lines.push(`${formatter.prefix}Matched capability: ${route.matched_capability ?? "none"}`);
  lines.push(`${formatter.prefix}Matched skill: ${route.matched_skill === null || route.matched_skill === undefined ? "none" : formatter.skill(route.matched_skill)}`);
  lines.push(`${formatter.prefix}Confidence: ${route.confidence}`);
  lines.push(`${formatter.prefix}Why: ${formatter.text(route.recommendation_reason, 320)}`);
  lines.push(`${formatter.prefix}Matched terms: ${formatter.list(route.matched_terms)}`);
}

function pushNoRecommendationLines(lines, route, formatter, options) {
  lines.push(`${formatter.prefix}Recommended skill: none`);
  if (formatter.includeFallbackWhenNoRecommendation) {
    lines.push(`${formatter.prefix}Fallback skills: ${formatter.list(route.fallback_skills)}`);
  }
  if (route.model_selection_required === true) {
    lines.push(`${formatter.prefix}Model selection: required - choose from eligible skill descriptions and raw saved preferences, or use no skill.`);
    if (typeof options.nextStep === "string" && options.nextStep.length > 0) {
      lines.push(`${formatter.prefix}Next step: ${safeText(options.nextStep, 360)}`);
    }
    return;
  }
  if (formatter.noMatchNextStep !== null) {
    lines.push(`${formatter.prefix}Next step: ${formatter.noMatchNextStep}`);
  }
}

function pushRecommendationLines(lines, route, formatter, options) {
  lines.push(`${formatter.prefix}Recommended skill: ${formatter.skill(route.recommended_skill)}`);
  lines.push(`${formatter.prefix}Fallback skills: ${formatter.list(route.fallback_skills)}`);
  if (route.overlap_resolution?.status === "resolved") {
    lines.push(`${formatter.prefix}Overlap: ${safeText(route.overlap_resolution.summary, 320)}`);
  }
  if (route.policy_memory?.status === "applied") {
    lines.push(`${formatter.prefix}Policy preference: ${safeText(route.policy_memory.summary, 320)}`);
  }
  pushCandidateLines(lines, route.route_candidates ?? [], formatter);
  if (typeof options.nextStep === "string" && options.nextStep.length > 0) {
    lines.push(`${formatter.prefix}Next step: ${safeText(options.nextStep, 360)}`);
  }
  if (route.guard_command !== null) {
    lines.push(`${formatter.prefix}Guard: ${formatter.command(route.guard_command)}`);
  }
  pushDisclosureLines(lines, route, formatter);
  pushPostUsePolicySuggestion(lines, route.post_use_policy_suggestion, formatter);
}

function pushCandidateLines(lines, candidates, formatter) {
  if (candidates.length === 0) {
    return;
  }
  lines.push(`${formatter.prefix}Route candidates:`);
  for (const candidate of candidates) {
    lines.push(`${formatter.candidatePrefix}${formatter.skill(candidate.skill)} (${routeCandidateStatus(candidate)})`);
    if (!candidate.guard_allowed && candidate.guard_reasons.length > 0) {
      lines.push(`${formatter.guardReasonPrefix}${formatter.guardReason(candidate.guard_reasons[0])}`);
    }
  }
}

function pushDisclosureLines(lines, route, formatter) {
  if (route.usage_disclosure === null || route.usage_disclosure === undefined) {
    return;
  }
  const skillLabel = formatter.skill(route.recommended_skill);
  lines.push(`${formatter.prefix}Disclosure: ${routeDisclosureText(skillLabel)}`);
  lines.push(`${formatter.prefix}Say before use: "${formatter.text(route.usage_disclosure.start_message)}"`);
  lines.push(`${formatter.prefix}Say after completion: "${formatter.text(route.usage_disclosure.finish_message)}"`);
}

function pushPostUsePolicySuggestion(lines, suggestion, formatter) {
  if (suggestion === null || suggestion === undefined) {
    return;
  }
  lines.push(`${formatter.prefix}After completion: ${formatter.text(afterUsePromptText(suggestion.question))}`);
  lines.push(`${formatter.prefix}Policy command after confirmation: ${formatter.command(suggestion.suggested_policy.command_hint)}`);
}

function routeCandidateStatus(candidate) {
  return [
    candidate.role,
    candidate.selected ? "selected" : null,
    candidate.guard_allowed ? "allowed" : "denied"
  ].filter((value) => value !== null).join(", ");
}

function routeDisclosureText(skillLabel) {
  return `run the guard automatically, state at the start that ${skillLabel} is being used, and state at completion that it was used. No extra user approval is needed when the guard allows it.`;
}

function afterUsePromptText(question) {
  return question.replace(/^Should I /u, "ask whether to ").replace(/\?$/u, ".");
}

function safeText(value, maxLength = 180) {
  const compact = String(value).replace(/\s+/g, " ").trim();
  const withoutTicks = compact.replace(/`/g, "'");
  return withoutTicks.length > maxLength ? `${withoutTicks.slice(0, maxLength - 3)}...` : withoutTicks;
}

function code(value, maxLength = 180) {
  return `\`${safeText(value, maxLength)}\``;
}

function formatCodeList(values) {
  return values.length === 0 ? "none" : values.map((value) => code(value)).join(", ");
}

function formatRawCodeList(values) {
  return values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", ");
}
