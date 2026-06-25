export function resolveWorkflow(workflows, requestedWorkflow) {
  const candidates = workflows.map((workflow) => workflow.name).sort((left, right) => left.localeCompare(right));
  if (requestedWorkflow !== undefined) {
    return {
      selected: requestedWorkflow,
      defaulted: false,
      needs_selection: false,
      candidates,
      unknown: !candidates.includes(requestedWorkflow),
      blocked_reason: candidates.includes(requestedWorkflow) ? null : `Unknown workflow: ${requestedWorkflow}`
    };
  }
  if (candidates.length === 1) {
    return {
      selected: candidates[0],
      defaulted: true,
      needs_selection: false,
      candidates,
      unknown: false,
      blocked_reason: null
    };
  }
  if (candidates.length > 1) {
    return {
      selected: null,
      defaulted: false,
      needs_selection: true,
      candidates,
      unknown: false,
      blocked_reason: "Multiple workflows exist; pass a workflow to classify skill availability."
    };
  }
  return {
    selected: null,
    defaulted: false,
    needs_selection: false,
    candidates,
    unknown: false,
    blocked_reason: "No workflows are configured."
  };
}
