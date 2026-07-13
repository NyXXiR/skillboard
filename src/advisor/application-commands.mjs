import {
  command,
  workflowResolved
} from "./action-core.mjs";

export function withApplicationCommands(actions, { paths, workflow, workspace, options }) {
  return actions.map((action) => {
    return {
      ...action,
      application: applicationCommand(action, paths, workflow, workspace, options)
    };
  });
}

function applicationCommand(action, paths, workflow, workspace, options) {
  const blockedReason = applicationBlockedReason(action, workflow, workspace);
  if (blockedReason !== null) {
    return {
      preview: null,
      apply: null,
      blocked_reason: blockedReason
    };
  }

  const base = [
    "skillboard", "apply-action", action.id,
    ...(workspace.version === 2 ? [] : workflowArgs(workflow)),
    "--dir", paths.root,
    "--config", paths.configPath,
    ...(paths.skillsRoot === undefined ? [] : ["--skills", paths.skillsRoot]),
    "--json",
    ...(workspace.version === 2 && options?.agent !== undefined ? ["--agent", options.agent] : [])
  ];
  return {
    preview: command([...base, "--dry-run"]),
    apply: command([...base, "--yes", ...destructiveArgs(action)]),
    blocked_reason: null
  };
}

function applicationBlockedReason(action, workflow, workspace) {
  if (action.blocked_reason !== null) {
    return action.blocked_reason;
  }
  if (action.apply === null) {
    return "Action cannot be applied directly.";
  }
  if (workspace.version !== 2 && !workflowResolved(workflow)) {
    return workflow.blocked_reason ?? "Select a workflow before applying action cards.";
  }
  return null;
}

function workflowArgs(workflow) {
  return workflowResolved(workflow) ? ["--workflow", workflow.selected] : [];
}

function destructiveArgs(action) {
  return action.kind === "reset-cleanup" ? ["--allow-destructive"] : [];
}
