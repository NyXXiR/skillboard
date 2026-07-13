import { loadWorkspace } from "../workspace.mjs";
import {
  digestVariantFile,
  resolveVariantLiveSkillFile,
  resolveVariantSnapshotFile
} from "./variant-files.mjs";

export async function variantLifecycleStatus(options) {
  const workspace = await loadWorkspace({ configPath: options.configPath, skillsRoot: options.skillsRoot });
  const policySkill = workspace.skills.find((candidate) => candidate.id === options.variantId);
  const skill = workspace.version === 2
    ? historicalVariantSkill(workspace, policySkill)
    : policySkill;
  if (skill === undefined) {
    throw new Error(`Unknown skill: ${options.variantId}`);
  }
  if (skill.variant === null || skill.variant === undefined) {
    throw new Error(`Skill ${options.variantId} is not a lifecycle variant`);
  }

  const warnings = [];
  const liveFile = resolveVariantLiveSkillFile({ skillsRoot: options.skillsRoot, skill });
  const live = await inspectDigestFile(liveFile);
  const baseSnapshot = await inspectSnapshot(options.configPath, "base", skill.variant.base, warnings);
  const approvedSnapshot = skill.variant.approved === undefined
    ? null
    : await inspectSnapshot(options.configPath, "approved", skill.variant.approved, warnings);
  const approvedDigest = skill.variant.approved?.contentDigest ?? null;
  return {
    skill: skill.id,
    variant: skill.variant,
    computedStatus: computeStatus(skill.variant.status, live.digest, skill.variant.base.contentDigest, approvedDigest),
    liveDigest: live.digest,
    baseDigest: skill.variant.base.contentDigest,
    approvedDigest,
    files: {
      live: { path: liveFile, exists: live.exists, digest: live.digest },
      baseSnapshot,
      approvedSnapshot
    },
    warnings
  };
}

function historicalVariantSkill(workspace, policySkill) {
  if (policySkill === undefined) return undefined;
  const observed = workspace.inventory?.skills?.find((candidate) => candidate.id === policySkill.id);
  const rawVariant = observed?.observations?.variant;
  if (observed === undefined || rawVariant === undefined) return policySkill;
  return {
    ...policySkill,
    path: observed.path,
    variant: parseHistoricalVariant(rawVariant, policySkill.id)
  };
}

function parseHistoricalVariant(raw, skillId) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Inventory variant observation for ${skillId} must be an object`);
  }
  const approved = raw.approved === undefined ? undefined : historicalCheckpoint(raw.approved, `${skillId}.approved`);
  return {
    of: requiredString(raw.of, `${skillId}.variant.of`),
    adaptedFor: typeof raw.adapted_for === "string" ? raw.adapted_for : null,
    capability: requiredString(raw.capability, `${skillId}.variant.capability`),
    workflow: requiredString(raw.workflow, `${skillId}.variant.workflow`),
    status: requiredString(raw.status, `${skillId}.variant.status`),
    base: historicalCheckpoint(raw.base, `${skillId}.variant.base`),
    ...(approved === undefined ? {} : { approved })
  };
}

function historicalCheckpoint(raw, label) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Inventory variant checkpoint ${label} must be an object`);
  }
  return {
    contentDigest: requiredString(raw.content_digest, `${label}.content_digest`),
    snapshot: requiredString(raw.snapshot, `${label}.snapshot`)
  };
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function computeStatus(lifecycleStatus, liveDigest, baseDigest, approvedDigest) {
  if (liveDigest === null) {
    return "missing-live-file";
  }
  if (approvedDigest !== null && liveDigest === approvedDigest) {
    return "approved";
  }
  if (lifecycleStatus === "approved" && approvedDigest !== null) {
    return "drifted";
  }
  return liveDigest === baseDigest ? "draft-base" : "draft-changed";
}

async function inspectSnapshot(configPath, label, checkpoint, warnings) {
  const resolved = resolveVariantSnapshotFile({ configPath, snapshotPath: checkpoint.snapshot });
  const digest = await inspectDigestFile(resolved.absolutePath);
  if (!digest.exists) {
    warnings.push(`${label} snapshot missing: ${checkpoint.snapshot}`);
  } else if (digest.digest !== checkpoint.contentDigest) {
    warnings.push(`${label} snapshot digest mismatch: expected ${checkpoint.contentDigest}, got ${digest.digest}`);
  }
  return { path: resolved.storedPath, absolutePath: resolved.absolutePath, exists: digest.exists, digest: digest.digest };
}

async function inspectDigestFile(path) {
  try {
    return { exists: true, digest: await digestVariantFile(path) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, digest: null };
    }
    throw error;
  }
}
