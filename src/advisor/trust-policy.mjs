import { hasRuntimeComponents, installUnitSourceClass } from "../domain/source-classes.mjs";

/**
 * Recommend the next trust_level for an install unit based on its
 * source class, permission risk, and runtime surface.
 *
 * The recommendation is a suggestion used by advisor action cards.
 * The final authorization is still performed by `skillboard review` validation.
 */
export function recommendTrustLevel(unit) {
  const sourceClass = installUnitSourceClass(unit);
  const risk = unit.permissionRisk ?? "unknown";
  const runtime = hasRuntimeComponents(unit);

  if (unit.trustLevel === "trusted" || unit.trustLevel === "blocked") {
    return unit.trustLevel;
  }

  // User-controlled local sources are trusted by default because the user owns the files.
  if (sourceClass === "user" && risk === "low") {
    return "trusted";
  }

  // High-risk sources require explicit review, not a default block. Blocking is
  // still available as a recorded trust policy, but the advisor keeps the work
  // moving by asking for a one-time source review first.
  if (risk === "high") {
    return "reviewed";
  }

  // Unknown risk always requires at least a review before any automatic use.
  if (risk === "unknown") {
    return "reviewed";
  }

  // Medium-risk or runtime-related sources should be reviewed, not blindly trusted.
  if (risk === "medium" || runtime) {
    return "reviewed";
  }

  return "trusted";
}

/**
 * Map a trust recommendation to an advisor action kind and label.
 */
export function trustRecommendationAction(recommended) {
  if (recommended === "trusted") {
    return {
      kind: "trust-install-unit",
      label: "Trust source",
      reason: "Low-risk source can be trusted after explicit user confirmation."
    };
  }
  if (recommended === "blocked") {
    return {
      kind: "block-install-unit",
      label: "Decide whether to block source",
      reason: "Source is blocked by trust policy and needs an explicit decision before its skills appear again."
    };
  }
  return {
    kind: "review-install-unit",
    label: "Review source",
    reason: "Review the source before enabling its model-selectable skills."
  };
}
