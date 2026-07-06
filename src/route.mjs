import { canUseSkill } from "./control/can-use-guard.mjs";
import {
  allowedFallbackSkills,
  guardCommand,
  overlapResolutionForRoute,
  policyMemoryForRoute,
  postUsePolicySuggestionForCapabilityRoute,
  recommendationReason,
  routeCandidate,
  selectedRouteSkill,
  usageDisclosure
} from "./route-advisory.mjs";
import { confidenceFor, possibleWorkflowSkills, selectRoute } from "./route-selection.mjs";

export function routeSkill(workspace, options) {
  const intent = options.intent.trim();
  if (intent.length === 0) {
    throw new Error("Usage: skillboard route <intent> --workflow <name>");
  }
  const workflow = workspace.workflows.find((candidate) => candidate.name === options.workflow);
  if (workflow === undefined) {
    throw new Error(`Unknown workflow: ${options.workflow}`);
  }

  const {
    candidates,
    skillCandidates,
    explicitSkill,
    best,
    skillBest
  } = selectRoute(workspace, workflow, intent);
  if (explicitSkill !== undefined) {
    return skillRoute({ intent, workflow, candidate: explicitSkill, candidates, skillCandidates, options, workspace });
  }
  if (best === undefined) {
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
  const overlapResolution = overlapResolutionForRoute({
    matchedCapability: best.capability,
    recommended,
    routedSkills,
    workflowName: workflow.name
  });
  const policyMemory = policyMemoryForRoute({
    matchedCapability: best.capability,
    routeMatch: best,
    recommended,
    routedSkills,
    workflowName: workflow.name
  });
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
    overlap_resolution: overlapResolution,
    policy_memory: policyMemory,
    guard_command: recommended === null ? null : guardCommand(recommended.skill, workflow.name, options),
    guard: recommended?.guard ?? null,
    usage_disclosure: recommended?.guard.allowed === true ? usageDisclosure(recommended.skill, policyMemory) : null,
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
    overlap_resolution: null,
    policy_memory: null,
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
  const overlapResolution = overlapResolutionForRoute({
    matchedCapability: candidate.skill_id,
    recommended: selectedCandidate ?? null,
    routedSkills: routeCandidates,
    workflowName: workflow.name
  });
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
    overlap_resolution: overlapResolution,
    policy_memory: null,
    guard_command: guardCommand(candidate.skill_id, workflow.name, options),
    guard,
    usage_disclosure: guard.allowed ? usageDisclosure(candidate.skill_id) : null,
    post_use_policy_suggestion: null,
    possible_skills: possibleWorkflowSkills(workspace, workflow),
    candidates,
    skill_candidates: skillCandidates
  };
}
