const SAFE_AMBIGUITY_KIND = "review_only_quarantine";

export function canAutomaticallyMigrateV2(report) {
  if (report?.mode !== "preview" || report.changed !== true || report.target_version !== 2) return false;
  if (!Array.isArray(report.ambiguities)) return false;
  return report.ambiguities.every((ambiguity) => (
    ambiguity?.kind === SAFE_AMBIGUITY_KIND
    && ambiguity.mapped_enabled === true
    && ambiguity.requires_grouped_confirmation === true
    && Array.isArray(ambiguity.skill_ids)
    && ambiguity.skill_ids.length > 0
    && ambiguity.skill_ids.every((skillId) => typeof skillId === "string" && skillId.length > 0)
  ));
}
