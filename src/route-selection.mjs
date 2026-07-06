import { canUseSkill } from "./control/can-use-guard.mjs";
import { canonicalRouteToken, phraseKey, tokensFor } from "./route-tokens.mjs";

const HIGH_CONFIDENCE = 4;
const MEDIUM_CONFIDENCE = 2;

export function selectRoute(workspace, workflow, intent) {
  const intentTokens = tokensFor(intent);
  const skillCandidates = skillRouteCandidates(workspace, workflow, intent, intentTokens);
  const explicitSkill = explicitAllowedSkillRouteCandidate(intent, skillCandidates);
  const candidates = capabilityRouteCandidates(workspace, workflow)
    .map((candidate) => scoreCandidate(workspace, candidate, intent, intentTokens))
    .sort((left, right) => right.score - left.score || left.capability.localeCompare(right.capability));
  const best = candidates.find((candidate) => candidate.score > 0);
  const skillBest = skillCandidates.find((candidate) => candidate.score > 0 && candidate.allowed)
    ?? skillCandidates.find((candidate) => candidate.score > 0);

  return {
    candidates,
    skillCandidates,
    explicitSkill,
    best,
    skillBest
  };
}

function explicitAllowedSkillRouteCandidate(intent, skillCandidates) {
  const intentKey = phraseKey(intent);
  return skillCandidates.find((candidate) => candidate.allowed && exactSkillIdMention(intentKey, candidate.skill_id));
}

function exactSkillIdMention(intentKey, skillId) {
  const skillKey = phraseKey(skillId);
  return skillKey.length > 0 && intentKey.includes(skillKey);
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

function phraseMatchScore(intent, capability) {
  const normalizedIntent = phraseKey(intent);
  const normalizedCapability = phraseKey(capability);
  if (normalizedIntent.length === 0 || normalizedCapability.length === 0) {
    return 0;
  }
  return normalizedIntent.includes(normalizedCapability) || normalizedCapability.includes(normalizedIntent) ? 4 : 0;
}

export function possibleWorkflowSkills(workspace, workflow) {
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

export function confidenceFor(score) {
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

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}
