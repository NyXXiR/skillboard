import { readFile } from "node:fs/promises";
import { loadWorkspace } from "../workspace.mjs";
import {
  ensureSeq,
  loadConfig,
  readMapString,
  removeValue,
  writeCheckedConfig
} from "./config-write.mjs";
import {
  addVariantCapabilityAlternative,
  ensureRequiredCapability,
  promoteVariantInWorkflow,
  readRequiredCapabilityPolicy,
  requireConfigCapability,
  requireConfigSkill,
  requireConfigWorkflow,
  variantConfigMetadata
} from "./variant-lifecycle-config.mjs";
import {
  createResetBackup,
  digestVariantFile,
  replaceLiveSkillFileForReset,
  resolveVariantLiveSkillFile,
  resolveVariantSnapshotFile
} from "./variant-files.mjs";

const APPROVED_INVOCATIONS = new Set(["manual-only", "router-only", "workflow-auto"]);

export async function resetSkillVariant(options) {
  if (options.dryRun !== true && options.yes !== true) {
    throw new Error("reset requires --yes unless --dry-run is used");
  }
  const target = resetTarget(options);
  const current = await lifecycleSkill(options);
  const checkpoint = resetCheckpoint(current.variant, target);
  const snapshot = resolveVariantSnapshotFile({ configPath: options.configPath, snapshotPath: checkpoint.snapshot });
  const content = await readSnapshotContent(snapshot.absolutePath, target, checkpoint.contentDigest);
  const liveFile = resolveVariantLiveSkillFile({ skillsRoot: options.skillsRoot, skill: current });
  const { document, originalText } = await loadConfig(options.configPath);
  const skill = requireConfigSkill(document, options.variantId);
  const workflow = requireConfigWorkflow(document, current.variant.workflow);
  const capability = requireConfigCapability(document, current.variant.capability);
  const variant = { ...current.variant, status: target === "base" ? "draft" : "approved" };

  if (target === "base") {
    demoteToBase(document, skill, workflow, variant, options.variantId);
  } else {
    promoteToApproved(document, skill, workflow, capability, variant, options);
  }

  const writeOptions = target === "approved"
    ? { ...options, validateUse: { skillId: options.variantId, workflow: variant.workflow } }
    : options;
  const filePlan = [await replaceLiveSkillFileForReset({ liveFile, content, dryRun: true })];

  if (options.dryRun === true) {
    const result = await writeCheckedConfig(document, originalText, writeOptions, resetMessage(options.variantId, target));
    return { ...result, skill: options.variantId, variant, target, filePlan, warnings: [] };
  }

  await writeCheckedConfig(document, originalText, { ...writeOptions, dryRun: true }, resetMessage(options.variantId, target));
  const backup = await createResetBackup(liveFile);
  try {
    filePlan[0] = await replaceLiveSkillFileForReset({ liveFile, content });
    const result = await writeCheckedConfig(document, originalText, writeOptions, resetMessage(options.variantId, target));
    return { ...result, skill: options.variantId, variant, target, filePlan, warnings: [] };
  } catch (error) {
    await backup.restore().catch(() => undefined);
    throw error;
  } finally {
    await backup.cleanup();
  }
}

function demoteToBase(document, skill, workflow, variant, variantId) {
  skill.set("status", "candidate");
  skill.set("invocation", "manual-only");
  skill.set("variant", document.createNode(variantConfigMetadata(variant)));
  const required = ensureRequiredCapability(workflow, variant.capability, document);
  if (readMapString(required, "preferred", "") === variantId) {
    required.set("preferred", variant.of);
  }
  const fallback = ensureSeq(required, "fallback", document);
  removeValue(fallback, variantId);
  removeValue(fallback, variant.of);
  removeValue(ensureSeq(workflow, "active_skills", document), variantId);
}

function promoteToApproved(document, skill, workflow, capability, variant, options) {
  const invocation = approvedInvocation(options, workflow, capability, variant.capability);
  skill.set("status", "active");
  skill.set("invocation", invocation);
  skill.set("variant", document.createNode(variantConfigMetadata(variant)));
  addVariantCapabilityAlternative(document, capability, { baseId: variant.of, variantId: options.variantId });
  promoteVariantInWorkflow(document, workflow, capability, { baseId: variant.of, variantId: options.variantId, capability: variant.capability });
}

function resetTarget(options) {
  const values = [
    options.toBase === true ? "base" : null,
    options.toApproved === true ? "approved" : null,
    options.to === "base" || options.target === "base" ? "base" : null,
    options.to === "approved" || options.target === "approved" ? "approved" : null
  ].filter(Boolean);
  if (values.length !== 1) {
    throw new Error("reset requires exactly one of --to-base or --to-approved");
  }
  return values[0];
}

function resetCheckpoint(variant, target) {
  if (target === "base") {
    return variant.base;
  }
  if (variant.approved === undefined) {
    throw new Error("reset --to-approved requires approved snapshot metadata");
  }
  return variant.approved;
}

async function lifecycleSkill(options) {
  const workspace = await loadWorkspace({ configPath: options.configPath, skillsRoot: options.skillsRoot });
  const skill = workspace.skills.find((candidate) => candidate.id === options.variantId);
  if (skill === undefined) {
    throw new Error(`Unknown skill: ${options.variantId}`);
  }
  if (skill.variant === null || skill.variant === undefined) {
    throw new Error(`Skill ${options.variantId} is not a lifecycle variant`);
  }
  return skill;
}

async function readSnapshotContent(path, label, expectedDigest) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing ${label} snapshot: ${path}`);
    }
    throw error;
  }
  const actualDigest = await digestVariantFile(path);
  if (actualDigest !== expectedDigest) {
    throw new Error(`${label} snapshot digest mismatch: expected ${expectedDigest}, got ${actualDigest}`);
  }
  return content;
}

function approvedInvocation(options, workflow, capability, capabilityName) {
  const computed = firstNonEmpty([
    options.mode,
    options.invocation,
    readRequiredCapabilityPolicy(workflow, capabilityName),
    readMapString(capability, "default_policy", ""),
    "manual-only"
  ]);
  if (!APPROVED_INVOCATIONS.has(computed)) {
    throw new Error("reset --to-approved requires --mode manual-only, router-only, or workflow-auto");
  }
  return computed;
}

function firstNonEmpty(values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? "manual-only";
}

function resetMessage(variantId, target) {
  return `Reset variant ${variantId} to ${target}`;
}
