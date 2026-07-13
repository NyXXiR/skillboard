export const V1_COMPATIBILITY_REMOVAL_VERSION = "v0.4.0";
export const V1_MIGRATION_COMMAND = "skillboard migrate v2";
export const V1_COMPATIBILITY_NOTICE =
  `Version 1 policy is deprecated and read-only; run \`${V1_MIGRATION_COMMAND}\`. Support ends in package release ${V1_COMPATIBILITY_REMOVAL_VERSION}.`;
export const V1_MUTATION_ERROR = `Version 1 policy is read-only. Run \`${V1_MIGRATION_COMMAND}\`.`;
export const STALE_V1_PROJECTION_ERROR = "This pre-v2 policy projection is stale; regenerate it from version 2 policy.";

export function compatibilityForVersion(version) {
  return version === 1 ? { notice: V1_COMPATIBILITY_NOTICE, removalVersion: V1_COMPATIBILITY_REMOVAL_VERSION } : null;
}

export function assertV2MutationVersion(version) {
  if (version === 1 || version === undefined) throw new Error(V1_MUTATION_ERROR);
}

export function isPreV2ActionId(actionId) {
  return /^(?:review-install-unit|trust-install-unit|activate-skill|block-install-unit):/.test(actionId);
}

export function assertCurrentProjectionVersion(projectionVersion, policyVersion) {
  if (projectionVersion !== undefined && Number(projectionVersion) !== policyVersion) {
    throw new Error(`${STALE_V1_PROJECTION_ERROR} Expected policy projection version ${policyVersion}, got ${projectionVersion}.`);
  }
}
