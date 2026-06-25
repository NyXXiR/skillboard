import {
  auditSources,
  listWorkflows
} from "./control.mjs";
import { doctorProject } from "./doctor.mjs";
import { buildActionCards, buildInitActions } from "./advisor/actions.mjs";
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
  const cleanup = await buildCleanup(paths.root);
  const doctor = await doctorProject({
    root: paths.root,
    configPath: paths.configPath,
    skillsRoot: paths.skillsRoot
  });

  if (!doctor.config.exists || !doctor.initialized) {
    return buildBrief({
      ok: false,
      error: {
        code: "not-initialized",
        message: doctor.config.error ?? "skillboard.config.yaml was not found"
      },
      health: healthFromDoctor(doctor, paths),
      workflow: emptyWorkflowState(),
      skills: emptySkillGroups(),
      sources: emptySources(),
      reviewQueue: [],
      cleanup,
      actions: requestedActions(options) ? buildInitActions(paths) : undefined
    });
  }

  if (!doctor.config.valid) {
    return buildExpectedConfigError(doctor, paths, cleanup, {
      code: "invalid-config",
      message: doctor.config.error ?? "skillboard.config.yaml is invalid"
    });
  }

  let workspace;
  try {
    workspace = await loadWorkspace({ configPath: paths.configPath, skillsRoot: paths.skillsRoot });
  } catch (error) {
    return buildExpectedConfigError(doctor, paths, cleanup, {
      code: "invalid-config",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const sourceAudit = auditSources(workspace);
  const workflow = resolveWorkflow(listWorkflows(workspace), options.workflow);
  const reviewQueue = buildReviewQueue(workspace, sourceAudit);

  if (workflow.unknown) {
    const skills = skillsWithoutWorkflow(workspace);
    const actionData = actionsForBrief({ options, paths, workflow, skills, reviewQueue, cleanup, workspace });
    return buildBrief({
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

  const skills = skillsForWorkflow(workspace, workflow.selected, sourceAudit);
  const actionData = actionsForBrief({ options, paths, workflow, skills, reviewQueue, cleanup, workspace });
  return buildBrief({
    ok: doctor.ok,
    health: healthFromDoctor(doctor, paths),
    workflow,
    skills,
    sources: summarizeSources(sourceAudit),
    reviewQueue: actionData.reviewQueue,
    cleanup,
    actions: actionData.actions
  });
}

function buildExpectedConfigError(doctor, paths, cleanup, error) {
  return buildBrief({
    ok: false,
    error,
    health: healthFromDoctor(doctor, paths),
    workflow: emptyWorkflowState(),
    skills: emptySkillGroups(),
    sources: sourcesFromDoctor(doctor),
    reviewQueue: [],
    cleanup
  });
}

function actionsForBrief(context) {
  if (!requestedActions(context.options)) {
    return { reviewQueue: context.reviewQueue, actions: undefined };
  }
  return buildActionCards(context);
}

function requestedActions(options) {
  return options.includeActions === true;
}
