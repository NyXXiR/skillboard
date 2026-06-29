import { readFile } from "node:fs/promises";
import { normalizeSkillPath } from "../skill-paths.mjs";
import { loadWorkspace } from "../workspace.mjs";
import {
  loadConfig,
  readMapString,
  requireMapAt,
  writeCheckedConfig
} from "./config-write.mjs";
import {
  addVariantCapabilityAlternative,
  appendSkillToOwnerInstallUnit,
  promoteVariantInWorkflow,
  readRequiredCapabilityPolicy,
  requireConfigCapability,
  requireConfigSkill,
  requireConfigWorkflow,
  stripUndefined,
  variantConfigMetadata
} from "./variant-lifecycle-config.mjs";
import {
  cleanupCreatedVariantFile,
  copySkillFileForFork,
  digestVariantFile,
  resolveVariantLiveSkillFile,
  variantSnapshotTarget,
  writeVariantSnapshot
} from "./variant-files.mjs";

const APPROVE_INVOCATIONS = new Set(["manual-only", "router-only", "workflow-auto"]);

export async function forkSkillVariant(options) {
  const { document, originalText } = await loadConfig(options.configPath);
  const skills = requireMapAt(document, ["skills"], "skills");
  const baseSkill = requireConfigSkill(document, options.baseId);
  const workflow = requireConfigWorkflow(document, options.workflow);
  const capability = requireConfigCapability(document, options.capability);
  if (skills.get(options.variantId, true) !== undefined) {
    throw new Error(`Skill already exists: ${options.variantId}`);
  }
  if (options.path === undefined) {
    throw new Error("--path is required when forking a variant skill");
  }

  const variantPath = normalizeSkillPath(options.path, "skill path");
  const baseFile = resolveVariantLiveSkillFile({
    skillsRoot: options.skillsRoot,
    skill: { id: options.baseId, path: readMapString(baseSkill, "path", options.baseId) }
  });
  const targetFile = resolveVariantLiveSkillFile({
    skillsRoot: options.skillsRoot,
    skill: { id: options.variantId, path: variantPath }
  });
  const baseContent = await readBaseSkillFile(baseFile, options.baseId);
  const baseDigest = await digestVariantFile(baseFile);
  const snapshot = variantSnapshotTarget({ configPath: options.configPath, skillId: options.variantId, snapshotName: "base" });
  const variant = draftVariantMetadata(options, baseDigest, snapshot.storedPath);

  if (options.ownerInstallUnit !== undefined) {
    appendSkillToOwnerInstallUnit(document, options.ownerInstallUnit, options.variantId);
  }
  skills.set(options.variantId, document.createNode(stripUndefined({
    path: variantPath,
    status: "candidate",
    invocation: "manual-only",
    exposure: "exported",
    category: options.category ?? readMapString(baseSkill, "category", "uncategorized"),
    owner_install_unit: options.ownerInstallUnit,
    variant: variantConfigMetadata(variant)
  })));
  addVariantCapabilityAlternative(document, capability, options);

  const filePlan = [];
  let copied = false;
  let snapshotWritten = false;
  try {
    filePlan.push(await copySkillFileForFork({
      sourceFile: baseFile,
      targetFile,
      dryRun: options.dryRun === true
    }));
    copied = options.dryRun !== true;
    filePlan.push(await writeVariantSnapshot({
      configPath: options.configPath,
      skillId: options.variantId,
      snapshotName: "base",
      content: baseContent,
      expectedDigest: baseDigest,
      dryRun: options.dryRun === true
    }));
    snapshotWritten = options.dryRun !== true;
    const result = await writeCheckedConfig(
      document,
      originalText,
      options,
      `Forked draft variant ${options.variantId} from ${options.baseId}`
    );
    return { ...result, skill: options.variantId, variant, filePlan, warnings: [] };
  } catch (error) {
    if (snapshotWritten) {
      await cleanupCreatedVariantFile(snapshot.absolutePath, { expectedDigest: baseDigest }).catch(() => undefined);
    }
    if (copied) {
      await cleanupCreatedVariantFile(targetFile, { expectedDigest: baseDigest }).catch(() => undefined);
    }
    throw error;
  }
}

export async function approveSkillVariant(options) {
  const current = await lifecycleSkill(options);
  const liveFile = resolveVariantLiveSkillFile({ skillsRoot: options.skillsRoot, skill: current });
  const liveContent = await readLiveVariantFile(liveFile, options.variantId);
  const liveDigest = await digestVariantFile(liveFile);
  const { document, originalText } = await loadConfig(options.configPath);
  const skill = requireConfigSkill(document, options.variantId);
  const workflow = requireConfigWorkflow(document, current.variant.workflow);
  const capability = requireConfigCapability(document, current.variant.capability);
  const invocation = approvedInvocation(options, workflow, capability, current.variant.capability);
  const snapshot = variantSnapshotTarget({ configPath: options.configPath, skillId: options.variantId, snapshotName: "approved" });
  const variant = {
    ...current.variant,
    status: "approved",
    approved: { contentDigest: liveDigest, snapshot: snapshot.storedPath }
  };

  skill.set("status", "active");
  skill.set("invocation", invocation);
  skill.set("variant", document.createNode(variantConfigMetadata(variant)));
  addVariantCapabilityAlternative(document, capability, { baseId: variant.of, variantId: options.variantId });
  promoteVariantInWorkflow(document, workflow, capability, { baseId: variant.of, variantId: options.variantId, capability: variant.capability });

  const writeOptions = { ...options, validateUse: { skillId: options.variantId, workflow: variant.workflow } };
  const filePlan = [await writeVariantSnapshot({
    configPath: options.configPath,
    skillId: options.variantId,
    snapshotName: "approved",
    content: liveContent,
    expectedDigest: liveDigest,
    allowOverwrite: true,
    dryRun: true
  })];
  if (options.dryRun === true) {
    const result = await writeCheckedConfig(document, originalText, writeOptions, `Approved variant ${options.variantId} for ${variant.workflow}`);
    return { ...result, skill: options.variantId, variant, filePlan, warnings: [] };
  }
  await writeCheckedConfig(document, originalText, { ...writeOptions, dryRun: true }, `Approved variant ${options.variantId} for ${variant.workflow}`);
  filePlan[0] = await writeVariantSnapshot({
    configPath: options.configPath,
    skillId: options.variantId,
    snapshotName: "approved",
    content: liveContent,
    expectedDigest: liveDigest,
    allowOverwrite: true
  });
  const result = await writeCheckedConfig(document, originalText, writeOptions, `Approved variant ${options.variantId} for ${variant.workflow}`);
  return { ...result, skill: options.variantId, variant, filePlan, warnings: [] };
}

function draftVariantMetadata(options, baseDigest, snapshotPath) {
  return {
    of: options.baseId,
    adaptedFor: options.adaptedFor ?? null,
    capability: options.capability,
    workflow: options.workflow,
    status: "draft",
    base: { contentDigest: baseDigest, snapshot: snapshotPath }
  };
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

function approvedInvocation(options, workflow, capability, capabilityName) {
  const computed = firstNonEmpty([
    options.mode,
    options.invocation,
    readRequiredCapabilityPolicy(workflow, capabilityName),
    readMapString(capability, "default_policy", ""),
    "manual-only"
  ]);
  if (!APPROVE_INVOCATIONS.has(computed)) {
    throw new Error("approve requires --mode manual-only, router-only, or workflow-auto");
  }
  return computed;
}

function firstNonEmpty(values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? "manual-only";
}

async function readBaseSkillFile(path, skillId) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing base skill file for ${skillId}: ${path}`);
    }
    throw error;
  }
}

async function readLiveVariantFile(path, skillId) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing live variant skill file for ${skillId}: ${path}`);
    }
    throw error;
  }
}
