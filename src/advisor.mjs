import {
  auditSources,
  listWorkflows
} from "./control.mjs";
import { doctorProject } from "./doctor.mjs";
import { routeSkill } from "./route.mjs";
import { buildActionCards, buildInitActions, buildV2ActionCards } from "./advisor/actions.mjs";
import {
  buildBrief,
  buildCleanup,
  emptySkillGroups,
  emptyWorkflowState,
  healthFromDoctor,
  resolveProjectPaths
} from "./advisor/schema.mjs";
import {
  buildReviewQueue,
  emptySources,
  sourcesFromDoctor,
  summarizeSources
} from "./advisor/sources.mjs";
import { skillsForWorkflow, skillsWithoutWorkflow } from "./advisor/skills.mjs";
import { resolveWorkflow } from "./advisor/workflow.mjs";
import { loadWorkspace } from "./workspace.mjs";

export async function buildSkillBrief(options = {}) {
  const paths = resolveProjectPaths(options);
  const configDoctor = await doctorProject({
    root: paths.root,
    configPath: paths.configPath,
    skillsRoot: paths.skillsRoot
  });

  if (!configDoctor.config.exists) {
    const cleanup = userStateCleanup();
    return buildBrief({
      ok: false,
      error: {
        code: "not-initialized",
        message: configDoctor.config.error ?? "skillboard.config.yaml was not found"
      },
      health: healthFromDoctor(configDoctor, paths),
      workflow: emptyWorkflowState(),
      skills: emptySkillGroups(),
      sources: emptySources(),
      reviewQueue: [],
      cleanup,
      actions: requestedActions(options) ? buildInitActions(paths) : undefined
    });
  }

  if (!configDoctor.config.valid) {
    const cleanup = userStateCleanup();
    return buildExpectedConfigError(configDoctor, paths, cleanup, {
      code: "invalid-config",
      message: configDoctor.config.error ?? "skillboard.config.yaml is invalid"
    }, options);
  }

  let workspace;
  try {
    workspace = await loadWorkspace({ configPath: paths.configPath, skillsRoot: paths.skillsRoot });
  } catch (error) {
    const cleanup = userStateCleanup();
    return buildExpectedConfigError(configDoctor, paths, cleanup, {
      code: "invalid-config",
      message: error instanceof Error ? error.message : String(error)
    }, options);
  }

  const cleanup = workspace.version === 2 ? userStateCleanup() : await buildCleanup(paths.root);

  const doctor = await doctorProject({
    root: paths.root,
    configPath: paths.configPath,
    skillsRoot: paths.skillsRoot,
    workspace,
    verifySources: options.verifySources
  });
  const sourceAudit = auditSources(workspace);
  const workflow = workspace.version === 2
    ? emptyWorkflowState()
    : resolveWorkflow(listWorkflows(workspace), options.workflow);
  const reviewQueue = workspace.version === 2 ? [] : buildReviewQueue(workspace, sourceAudit);

  if (workflow.unknown) {
    const skills = skillsWithoutWorkflow(workspace);
    const actionData = actionsForBrief({ options, paths, workflow, skills, reviewQueue, cleanup, workspace });
    return buildBrief({
      compatibility: workspace.compatibility,
      ok: false,
      error: {
        code: "unknown-workflow",
        message: `Unknown workflow: ${workflow.selected}`
      },
      health: healthFromDoctor(doctor, paths),
      workflow,
      skills,
      sources: summarizeSources(sourceAudit),
      reviewQueue: actionData.reviewQueue,
      cleanup,
      actions: actionData.actions
    });
  }

  const skills = skillsForWorkflow(workspace, workflow.selected, sourceAudit, options.agent);
  const actionData = actionsForBrief({ options, paths, workflow, skills, reviewQueue, cleanup, workspace });
  const route = routeForBrief({ options, paths, workflow, workspace });
  const availabilityOk = doctor.config.valid && doctor.policy.ok && doctor.inventory.ok
    && (workspace.version === 2 || doctor.sources.ok);
  return buildBrief({
    compatibility: workspace.compatibility,
    ok: availabilityOk,
    health: healthForBrief(doctor, paths, availabilityOk),
    workflow,
    skills,
    sources: summarizeSources(sourceAudit),
    reviewQueue: actionData.reviewQueue,
    cleanup,
    actions: actionData.actions,
    route
  });
}

function userStateCleanup() {
  return {
    conservative: { dryRun: true, removed: [], updated: [], preserved: [] },
    full_reset: { dryRun: true, removed: [], updated: [], preserved: [] }
  };
}

function routeForBrief({ options, paths, workflow, workspace }) {
  const intent = options.intent?.trim();
  const workflowRequired = workspace.version !== 2 && workflow.selected === null;
  if (intent === undefined || intent.length === 0 || workflowRequired || workflow.unknown || workflow.needs_selection) {
    return undefined;
  }
  return routeSkill(workspace, {
    intent,
    ...(workspace.version === 2 ? { agent: options.agent } : workflow.selected === null ? {} : { workflow: workflow.selected }),
    configPath: paths.configPath,
    skillsRoot: paths.skillsRoot
  });
}

function healthForBrief(doctor, paths, availabilityOk) {
  const health = healthFromDoctor(doctor, paths);
  if (!availabilityOk || health.mode !== "failed") {
    return health;
  }
  return {
    ...health,
    mode: health.review_required ? "safe-mode" : "passed"
  };
}

function buildExpectedConfigError(doctor, paths, cleanup, error, options = {}) {
  return buildBrief({
    ok: false,
    error,
    health: healthFromDoctor(doctor, paths),
    workflow: emptyWorkflowState(),
    skills: emptySkillGroups(),
    sources: sourcesFromDoctor(doctor),
    reviewQueue: [],
    cleanup,
    actions: requestedActions(options) ? [] : undefined
  });
}

function actionsForBrief(context) {
  if (!requestedActions(context.options)) {
    return { reviewQueue: context.reviewQueue, actions: undefined };
  }
  if (context.workspace.version === 2) return { reviewQueue: [], actions: buildV2ActionCards(context) };
  return buildActionCards(context);
}

function requestedActions(options) {
  return options.includeActions === true;
}
