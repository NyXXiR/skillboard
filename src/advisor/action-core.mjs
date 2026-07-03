const RISK_RANK = { info: 0, low: 1, medium: 2, high: 3, destructive: 4 };
const INSTALL_UNIT_REVIEW_ACTIONS = new Set([
  "block-install-unit",
  "review-install-unit",
  "trust-install-unit"
]);

export function makeAction(data) {
  return {
    id: `${data.kind}:${data.targetId}`,
    kind: data.kind,
    label: data.label,
    reason: data.reason,
    risk: data.risk,
    requires_user_confirmation: data.requiresUserConfirmation ?? requiresConfirmation(data.risk),
    dry_run: data.dryRun,
    apply: data.apply,
    application: data.application ?? emptyApplication(data.blockedReason),
    applies_to: data.appliesTo,
    blocked_reason: data.blockedReason,
    advanced: data.advanced
  };
}

export function command(argv) {
  return { argv, display: argv.map(shellQuote).join(" ") };
}

export function applyOrNull(workflow, dryRun, argv) {
  return workflowResolved(workflow) && dryRun !== null ? command(argv) : null;
}

export function blockedByWorkflow(workflow) {
  return workflowResolved(workflow) ? null : workflow.blocked_reason ?? "Select a workflow before applying action cards.";
}

export function workflowResolved(workflow) {
  return workflow.selected !== null && !workflow.needs_selection && !workflow.unknown;
}

export function sortActions(left, right) {
  return left.kind.localeCompare(right.kind)
    || left.applies_to.id.localeCompare(right.applies_to.id)
    || RISK_RANK[left.risk] - RISK_RANK[right.risk]
    || left.id.localeCompare(right.id);
}

export function linkReviewQueue(reviewQueue, actions) {
  const byUnit = new Map(actions
    .filter((entry) => INSTALL_UNIT_REVIEW_ACTIONS.has(entry.kind))
    .map((entry) => [entry.applies_to.id, entry.id]));
  return reviewQueue.map((entry) => {
    const unitId = entry.advanced.install_unit ?? entry.advanced.source_id;
    return unitId === undefined || !byUnit.has(unitId)
      ? entry
      : { ...entry, action_ids: [byUnit.get(unitId)] };
  });
}

function requiresConfirmation(risk) {
  return RISK_RANK[risk] >= RISK_RANK.medium;
}

function emptyApplication(blockedReason) {
  return {
    preview: null,
    apply: null,
    blocked_reason: blockedReason ?? "Action cannot be applied directly."
  };
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}
