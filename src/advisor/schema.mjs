import { isAbsolute, resolve } from "node:path";
import { uninstallProject } from "../uninstall.mjs";
import { sortedStrings } from "./sort.mjs";

const SCHEMA_VERSION = 1;
const EMPTY_SKILL_GROUPS = Object.freeze({
  automatic_allowed: Object.freeze([]),
  manual_allowed: Object.freeze([]),
  needs_review: Object.freeze([]),
  blocked: Object.freeze([]),
  not_in_workflow: Object.freeze([]),
  installed_only: Object.freeze([])
});

export function buildBrief(data) {
  const brief = {
    ok: data.ok,
    schema_version: SCHEMA_VERSION
  };
  if (data.error !== undefined) {
    brief.error = data.error;
  }
  brief.health = data.health;
  brief.workflow = data.workflow;
  brief.skills = data.skills;
  brief.sources = data.sources;
  brief.review_queue = data.reviewQueue;
  brief.cleanup = data.cleanup;
  if (data.actions !== undefined) {
    brief.actions = data.actions;
  }
  return brief;
}

export function resolveProjectPaths(options) {
  const root = resolve(options.root ?? ".");
  return {
    root,
    configPath: resolveUnderRoot(root, options.configPath ?? "skillboard.config.yaml"),
    skillsRoot: resolveUnderRoot(root, options.skillsRoot ?? "skills")
  };
}

export async function buildCleanup(root) {
  const conservative = await uninstallProject({
    root,
    dryRun: true,
    removeConfig: false,
    removeEmptyDirs: true
  });
  const fullReset = await uninstallProject({
    root,
    dryRun: true,
    resetConfig: true,
    removeReports: true,
    removeHooks: true,
    removeEmptyDirs: true
  });
  return {
    conservative,
    full_reset: fullReset
  };
}

export function healthFromDoctor(doctor, paths) {
  return {
    mode: doctor.mode,
    review_required: doctor.reviewRequired,
    strict_ok: doctor.strictOk,
    initialized: doctor.initialized,
    root: paths.root,
    config_path: paths.configPath,
    skills_root: paths.skillsRoot,
    config: {
      exists: doctor.config.exists,
      valid: doctor.config.valid,
      version: doctor.config.version,
      error: doctor.config.error
    },
    policy: {
      ok: doctor.policy.ok,
      errors: sortedStrings(doctor.policy.errors),
      warnings: sortedStrings(doctor.policy.warnings)
    }
  };
}

export function emptyWorkflowState() {
  return {
    selected: null,
    defaulted: false,
    needs_selection: false,
    candidates: [],
    unknown: false,
    blocked_reason: null
  };
}

export function emptySkillGroups() {
  return {
    automatic_allowed: [...EMPTY_SKILL_GROUPS.automatic_allowed],
    manual_allowed: [...EMPTY_SKILL_GROUPS.manual_allowed],
    needs_review: [...EMPTY_SKILL_GROUPS.needs_review],
    blocked: [...EMPTY_SKILL_GROUPS.blocked],
    not_in_workflow: [...EMPTY_SKILL_GROUPS.not_in_workflow],
    installed_only: [...EMPTY_SKILL_GROUPS.installed_only]
  };
}

function resolveUnderRoot(root, path) {
  return isAbsolute(path) ? path : resolve(root, path);
}
