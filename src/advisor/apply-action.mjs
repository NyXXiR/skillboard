import { buildSkillBrief } from "../advisor.mjs";
import {
  activateSkill,
  blockSkill,
  installGuardHook,
  removeSkill
} from "../control.mjs";
import { reviewInstallUnit } from "../review.mjs";
import { uninstallProject } from "../uninstall.mjs";

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

  const action = await resolveCurrentAction(actionId, options);
  if (action.blocked_reason !== null) {
    throw new ApplyActionError("blocked-action", action.blocked_reason);
  }

  if (previewMode(options)) {
    return {
      ok: true,
      mode: "preview",
      changed: false,
      action
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
