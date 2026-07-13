import { buildSkillBrief } from "../advisor.mjs";
import {
  activateSkill,
  blockSkill,
  installGuardHook,
  removeSkill
} from "../control.mjs";
import { setV2SkillEnabled, setV2SkillPreference } from "../control/v2-skill-crud.mjs";
import { forgetV2Skill } from "../control/v2-skill-forget.mjs";
import { setSkillSharing } from "../shared-skill.mjs";
import { resolveUserStatePaths } from "../user-state-paths.mjs";
import { reviewInstallUnit } from "../review.mjs";
import { uninstallProject } from "../uninstall.mjs";
import { isPreV2ActionId, V1_MUTATION_ERROR } from "../compatibility.mjs";
import { loadWorkspace } from "../workspace.mjs";
import { resolveProjectPaths } from "./schema.mjs";

const INSTALL_UNIT_ACTIONS = new Set([
  "block-install-unit",
  "review-install-unit",
  "trust-install-unit"
]);

export class ApplyActionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApplyActionError";
    this.code = code;
  }
}

export async function applyAdvisorAction(actionId, options) {
  if (actionId === undefined || actionId.length === 0) {
    throw new ApplyActionError("missing-action-id", "Usage: skillboard apply-action <action-id>");
  }

  const paths = resolveProjectPaths(options);
  options = { ...options, root: paths.root, configPath: paths.configPath, skillsRoot: paths.skillsRoot };
  const workspace = await loadWorkspace({ configPath: options.configPath, skillsRoot: options.skillsRoot });
  if (workspace.version === 1 && options.yes === true && options.dryRun !== true) {
    throw new ApplyActionError("migration-required", V1_MUTATION_ERROR);
  }
  if (workspace.version === 2 && isPreV2ActionId(actionId)) {
    throw new ApplyActionError("stale-policy-version", `Pre-v2 action id is stale: ${actionId}. Run skillboard brief --include-actions to get current actions.`);
  }
  const action = await resolveCurrentAction(actionId, options);
  if (action.blocked_reason !== null) {
    throw new ApplyActionError("blocked-action", action.blocked_reason);
  }

  if (previewMode(options)) {
    const control = action.kind.startsWith("v2:")
      ? await dispatchAction(action, { ...options, dryRun: true })
      : null;
    return {
      ok: true,
      mode: "preview",
      changed: false,
      action,
      control
    };
  }

  if (action.apply === null) {
    throw new ApplyActionError("action-not-applicable", `Action cannot be applied directly: ${action.id}`);
  }

  if (action.kind === "reset-cleanup" && options.allowDestructive !== true) {
    throw new ApplyActionError(
      "destructive-confirmation-required",
      "reset-cleanup is destructive; pass --allow-destructive with --yes to apply it."
    );
  }

  const control = await dispatchAction(action, options);
  const brief = await buildActionBrief(options);
  return {
    ok: true,
    mode: "applied",
    changed: controlChanged(action, control),
    action,
    control,
    brief
  };
}

export function applyActionErrorPayload(error) {
  if (error instanceof ApplyActionError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return {
    ok: false,
    error: {
      code: "apply-action-failed",
      message: error instanceof Error ? error.message : String(error)
    }
  };
}

async function resolveCurrentAction(actionId, options) {
  const brief = await buildActionBrief(options);
  const actions = Array.isArray(brief.actions) ? brief.actions : [];
  const matches = actions.filter((action) => action.id === actionId);
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new ApplyActionError("ambiguous-action", `Action id resolved more than once: ${actionId}`);
  }
  throw new ApplyActionError(
    "stale-action",
    `Action is no longer current or was not found: ${actionId}`
  );
}

function buildActionBrief(options) {
  return buildSkillBrief({
    includeActions: true,
    agent: options.agent,
    intent: options.intent,
    workflow: options.workflow,
    configPath: options.configPath,
    skillsRoot: options.skillsRoot,
    root: options.root
  });
}

function previewMode(options) {
  return options.dryRun === true || options.yes !== true;
}

async function dispatchAction(action, options) {
  if (action.kind === "v2:enable-skill" || action.kind === "v2:disable-skill") {
    return await setV2SkillEnabled({
      skillId: action.applies_to.id,
      enabled: action.kind === "v2:enable-skill",
      configPath: options.configPath,
      skillsRoot: options.skillsRoot,
      dryRun: options.dryRun === true
    });
  }
  if (action.kind === "v2:share-skill" || action.kind === "v2:unshare-skill") {
    const state = resolveUserStatePaths({
      home: options.home,
      env: options.env ?? process.env,
      configPath: options.configPath,
      inventoryPath: options.inventoryPath
    });
    return await setSkillSharing({
      skillId: action.applies_to.id,
      shared: action.kind === "v2:share-skill",
      configPath: options.configPath,
      inventoryPath: state.inventoryPath,
      home: state.home,
      env: options.env ?? process.env,
      dryRun: options.dryRun === true
    });
  }
  if (action.kind === "v2:prefer-skill") {
    return await setV2SkillPreference({
      skillId: action.applies_to.id,
      intents: action.advanced.intents,
      priority: action.advanced.priority,
      configPath: options.configPath,
      skillsRoot: options.skillsRoot,
      dryRun: options.dryRun === true
    });
  }
  if (action.kind === "v2:forget-skill") {
    const state = resolveUserStatePaths({
      home: options.home,
      env: options.env ?? process.env,
      configPath: options.configPath,
      inventoryPath: options.inventoryPath
    });
    return await forgetV2Skill({
      skillId: action.applies_to.id,
      configPath: options.configPath,
      inventoryPath: state.inventoryPath,
      skillsRoot: options.skillsRoot,
      dryRun: options.dryRun === true
    });
  }
  if (INSTALL_UNIT_ACTIONS.has(action.kind)) {
    return await reviewInstallUnit({
      unitId: action.applies_to.id,
      trustLevel: action.advanced.trust_level,
      configPath: options.configPath,
      skillsRoot: options.skillsRoot,
      dryRun: false
    });
  }

  if (action.kind === "activate-skill") {
    return await activateSkill({
      skillId: action.applies_to.id,
      workflow: action.applies_to.workflow,
      mode: action.advanced.mode,
      configPath: options.configPath,
      skillsRoot: options.skillsRoot,
      dryRun: false
    });
  }

  if (action.kind === "block-skill") {
    return await blockSkill({
      skillId: action.applies_to.id,
      workflow: action.applies_to.workflow,
      configPath: options.configPath,
      skillsRoot: options.skillsRoot,
      dryRun: false
    });
  }

  if (action.kind === "hook-install") {
    return await installGuardHook({
      workflow: action.advanced.workflow,
      out: options.hookOut,
      command: options.skillboardBin,
      configPath: options.configPath,
      skillsRoot: options.skillsRoot
    });
  }

  if (action.kind === "remove-skill-force") {
    return await removeSkill({
      skillId: action.applies_to.id,
      force: true,
      configPath: options.configPath,
      skillsRoot: options.skillsRoot,
      dryRun: false
    });
  }

  if (action.kind === "reset-cleanup") {
    return await uninstallProject({
      root: action.applies_to.id,
      dryRun: false,
      resetConfig: true,
      removeReports: true,
      removeHooks: true,
      removeProjectState: true
    });
  }

  throw new ApplyActionError("unsupported-action", `Unsupported action kind: ${action.kind}`);
}

function controlChanged(action, control) {
  if (typeof control.changed === "boolean") {
    return control.changed;
  }
  if (action.kind === "reset-cleanup") {
    return control.removed.length > 0 || control.updated.length > 0;
  }
  return true;
}
