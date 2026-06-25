export function contractView(brief) {
  return {
    top_keys: Object.keys(brief),
    health_keys: Object.keys(brief.health),
    health_values: {
      mode: brief.health.mode,
      review_required: brief.health.review_required,
      strict_ok: brief.health.strict_ok,
      initialized: brief.health.initialized,
      config: brief.health.config,
      policy: brief.health.policy
    },
    workflow_keys: Object.keys(brief.workflow),
    workflow: brief.workflow,
    skill_group_keys: Object.keys(brief.skills),
    manual_allowed: brief.skills.manual_allowed.map(skillView),
    empty_groups: {
      automatic_allowed: brief.skills.automatic_allowed,
      needs_review: brief.skills.needs_review,
      blocked: brief.skills.blocked,
      not_in_workflow: brief.skills.not_in_workflow,
      installed_only: brief.skills.installed_only
    },
    sources: {
      keys: Object.keys(brief.sources),
      ok: brief.sources.ok,
      errors: brief.sources.errors,
      warnings: brief.sources.warnings,
      units: brief.sources.units
    },
    review_queue: brief.review_queue,
    cleanup_keys: Object.keys(brief.cleanup),
    cleanup_value_keys: {
      conservative: Object.keys(brief.cleanup.conservative),
      full_reset: Object.keys(brief.cleanup.full_reset)
    }
  };
}

export function sourceReviewView(brief) {
  return {
    ok: brief.ok,
    needs_review_ids: brief.skills.needs_review.map((skill) => skill.id),
    sources: {
      keys: Object.keys(brief.sources),
      ok: brief.sources.ok,
      errors: brief.sources.errors,
      warnings: brief.sources.warnings,
      units: brief.sources.units.map(sourceUnitView)
    },
    review_queue: brief.review_queue.map(reviewQueueView)
  };
}

function skillView(skill) {
  return {
    keys: Object.keys(skill),
    id: skill.id,
    label: skill.label,
    path: skill.path,
    reason: skill.reason,
    advanced_keys: Object.keys(skill.advanced),
    advanced: skill.advanced
  };
}

function sourceUnitView(unit) {
  return {
    keys: Object.keys(unit),
    id: unit.id,
    kind: unit.kind,
    enabled: unit.enabled,
    risk: unit.risk,
    reviewed: unit.reviewed,
    findings: unit.findings,
    advanced_keys: Object.keys(unit.advanced),
    advanced: unit.advanced
  };
}

function reviewQueueView(entry) {
  return {
    keys: Object.keys(entry),
    kind: entry.kind,
    id: entry.id,
    label: entry.label,
    reason: entry.reason,
    risk: entry.risk,
    action_ids: entry.action_ids,
    advanced_keys: Object.keys(entry.advanced),
    advanced: entry.advanced
  };
}
