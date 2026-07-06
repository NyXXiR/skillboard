// SIZE_OK: src/brief-renderer.mjs is pre-existing renderer debt; this change only adds narrow AI/automation copy until a broader renderer split.
import { renderRouteSectionLines } from "./route-renderer.mjs";

const SKILL_SECTIONS = [
  ["Needs your decision", "needs_review"],
  ["Blocked for safety", "blocked"]
];

const PRIMARY_ACTION_KINDS = new Set([
  "setup-guidance",
  "block-install-unit",
  "review-install-unit",
  "trust-install-unit",
  "activate-skill",
  "hook-install"
]);

const CLEANUP_ACTION_KINDS = new Set([
  "remove-skill-force",
  "reset-cleanup"
]);
const COMPACT_SKILL_LIMIT = 5;
const TOP_CATEGORY_LIMIT = 5;
const POLICY_DIAGNOSTIC_LIMIT = 3;
const MAX_ACTIONS_PER_TEXT_SECTION = 5;
const ACTION_KIND_RANK = new Map([
  ["setup-guidance", 0],
  ["block-install-unit", 0],
  ["review-install-unit", 0],
  ["trust-install-unit", 0],
  ["activate-skill", 1],
  ["hook-install", 2],
  ["block-skill", 3],
  ["remove-skill-force", 4],
  ["reset-cleanup", 5]
]);

export function renderSkillBrief(brief, options = {}) {
  const verbose = options.verbose === true;
  const counts = briefCounts(brief);
  const lines = [
    "# SkillBoard Brief",
    "",
    `AI can use now: ${counts.usable} (${counts.automatic} automatic, ${counts.manual} manual)`,
    `Needs your decision: ${counts.needsDecision}`,
    `Blocked for safety: ${counts.blocked}`,
    `Workflow: ${workflowSummary(brief.workflow)}`,
    ""
  ];
  if (brief.error !== undefined) {
    lines.push(`Error: ${safeText(brief.error.message)}`, "");
  }
  emitIntentRoute(lines, brief);
  emitPolicyHealth(lines, brief);
  emitCategorySummary(lines, brief);
  emitNextAction(lines, brief, { verbose });
  emitAvailableNowSection(lines, brief, { verbose });
  for (const [title, key] of SKILL_SECTIONS) {
    if (key === "needs_review") {
      emitDecisionSection(lines, brief, { verbose });
      continue;
    }
    emitSkillSection(lines, title, brief.skills[key], {
      brief,
      groupLabel: compactGroupLabel(key),
      verbose
    });
  }
  emitSkillSection(lines, "Not in this workflow", [
    ...brief.skills.not_in_workflow,
    ...brief.skills.installed_only
  ], {
    brief,
    groupLabel: "inactive or undeclared skills",
    verbose
  });
  emitActions(lines, brief, { verbose });
  return `${lines.join("\n")}\n`;
}

function emitIntentRoute(lines, brief) {
  const route = brief.assistant_guidance?.route;
  if (route === undefined) {
    return;
  }
  lines.push("## Suggested skill for this request", "");
  lines.push(...renderRouteSectionLines(route, {
    format: "brief",
    nextStep: brief.assistant_guidance?.recommended_next_step
  }));
  lines.push("");
}

function emitPolicyHealth(lines, brief) {
  const policy = brief.health?.policy;
  if (policy === undefined) {
    return;
  }
  const errors = policy.errors ?? [];
  const warnings = policy.warnings ?? [];
  if (errors.length === 0 && warnings.length === 0) {
    return;
  }
  lines.push("## Policy health", "");
  emitPolicyDiagnostics(lines, "Policy errors", errors);
  emitPolicyDiagnostics(lines, "Policy warnings", warnings);
  lines.push(`- check with: ${code(policyCheckCommand(brief), Number.POSITIVE_INFINITY)}`);
  lines.push("");
}

function emitPolicyDiagnostics(lines, label, diagnostics) {
  if (diagnostics.length === 0) {
    return;
  }
  lines.push(`- ${label}: ${diagnostics.length}`);
  for (const diagnostic of diagnostics.slice(0, POLICY_DIAGNOSTIC_LIMIT)) {
    lines.push(`  - ${safeText(diagnostic)}`);
  }
  const hidden = diagnostics.length - POLICY_DIAGNOSTIC_LIMIT;
  if (hidden > 0) {
    lines.push(`  - ${hidden} more hidden. Run ${code("skillboard check")}.`);
  }
}

function policyCheckCommand(brief) {
  const config = brief.health?.config_path;
  const skills = brief.health?.skills_root;
  if (config === undefined || skills === undefined) {
    return "skillboard check";
  }
  return `skillboard check --config ${config} --skills ${skills}`;
}

function briefCounts(brief) {
  const automatic = brief.skills.automatic_allowed.length;
  const manual = brief.skills.manual_allowed.length;
  return {
    automatic,
    manual,
    usable: automatic + manual,
    needsDecision: decisionCount(brief),
    blocked: brief.skills.blocked.length
  };
}

function decisionCount(brief) {
  const skillDecisionCount = brief.skills.needs_review.length;
  if (skillDecisionCount > 0) {
    return skillDecisionCount;
  }
  return brief.review_queue?.length ?? 0;
}

function emitAvailableNowSection(lines, brief, options) {
  lines.push("## What your AI can use now", "");
  const entries = [
    ...brief.skills.automatic_allowed.map((entry) => ({ entry, mode: "automatic" })),
    ...brief.skills.manual_allowed.map((entry) => ({ entry, mode: "manual-only" }))
  ];
  if (entries.length === 0) {
    lines.push("- none", "");
    return;
  }
  lines.push("Automatic skills can be selected by the AI. On-request skills can be used when the user asks the AI; the AI runs the guard first.");
  lines.push("When the guard allows use, disclose the selected skill at the start and completion instead of asking again.", "");
  const visibleEntries = options.verbose ? entries : entries.slice(0, COMPACT_SKILL_LIMIT);
  for (const item of visibleEntries) {
    lines.push(formatSkillEntry(item.entry, [availableModeLabel(item.mode)]));
  }
  const hiddenEntries = entries.slice(visibleEntries.length);
  if (hiddenEntries.length > 0) {
    lines.push(`- ${hiddenEntries.length} more ${availableHiddenLabel(hiddenEntries)} hidden. Run ${code(verboseCommand(brief))} or ${code(listCommand(brief))}.`);
  }
  lines.push("");
}

function availableHiddenLabel(entries) {
  const modes = new Set(entries.map((entry) => entry.mode));
  if (modes.size !== 1) {
    return "available skills";
  }
  return modes.has("manual-only") ? "on-request skills" : "automatic skills";
}

function availableModeLabel(mode) {
  return mode === "manual-only" ? "on request" : mode;
}

function emitSkillSection(lines, title, entries, options) {
  lines.push(`## ${title}`, "");
  if (entries.length === 0) {
    lines.push("- none", "");
    return;
  }
  emitSkillEntries(lines, entries, options);
  lines.push("");
}

function emitSkillEntries(lines, entries, options) {
  const visibleEntries = options.verbose ? entries : entries.slice(0, COMPACT_SKILL_LIMIT);
  for (const entry of visibleEntries) {
    lines.push(formatSkillEntry(entry));
  }
  const hidden = entries.length - visibleEntries.length;
  if (hidden > 0) {
    lines.push(`- ${hidden} more ${options.groupLabel} hidden. Run ${code(verboseCommand(options.brief))} or ${code(listCommand(options.brief))}.`);
  }
}

function formatSkillEntry(entry, labels = []) {
  const path = entry.path === undefined ? "" : ` (${safeText(entry.path)})`;
  const reason = entry.reason === null || entry.reason === undefined ? null : safeText(entry.reason);
  const details = [...labels, reason].filter((value) => value !== null && value !== "");
  const suffix = details.length === 0 ? "" : ` - ${details.join("; ")}`;
  return `- ${code(entry.id)}${path}${suffix}`;
}

function emitDecisionSection(lines, brief, options) {
  lines.push("## Needs your decision", "");
  const skillEntries = brief.skills.needs_review;
  const reviewEntries = reviewEntriesForDecisionSection(brief, skillEntries);
  if (skillEntries.length === 0 && reviewEntries.length === 0) {
    lines.push("- none", "");
    return;
  }
  emitDeferredDecisionLead(lines, brief);
  if (skillEntries.length > 0) {
    emitSkillEntries(lines, skillEntries, {
      ...options,
      brief,
      groupLabel: "decision items"
    });
  }
  if (reviewEntries.length > 0) {
    emitReviewQueueEntries(lines, reviewEntries, {
      ...options,
      brief
    });
  }
  lines.push("");
}

function emitDeferredDecisionLead(lines, brief) {
  if (!hasUsableRoutedSkill(brief)) {
    return;
  }
  lines.push("A routed skill is already usable for this request; handle these decisions after the task unless a policy-changing action is needed now.", "");
}

function reviewEntriesForDecisionSection(brief, skillEntries) {
  if (skillEntries.length === 0) {
    return brief.review_queue ?? [];
  }
  return [];
}

function emitReviewQueueEntries(lines, entries, options) {
  const visibleEntries = options.verbose ? entries : entries.slice(0, COMPACT_SKILL_LIMIT);
  for (const entry of visibleEntries) {
    const label = entry.label ?? entry.title ?? entry.id;
    const action = firstActionId(entry);
    const actionText = action === null ? "" : ` - action: ${code(action)}`;
    lines.push(`- ${safeText(label)} - ${safeText(entry.reason)}${actionText}`);
  }
  const hidden = entries.length - visibleEntries.length;
  if (hidden > 0) {
    lines.push(`- ${hidden} more review decisions hidden. Run ${code(verboseCommand(options.brief))}.`);
  }
}

function firstActionId(entry) {
  const [action] = entry.action_ids ?? [];
  return typeof action === "string" ? action : null;
}

function emitCategorySummary(lines, brief) {
  const categories = categoryCounts(brief);
  lines.push("## Top categories", "");
  if (categories.length === 0) {
    lines.push("- none", "");
    return;
  }
  for (const [category, count] of categories.slice(0, TOP_CATEGORY_LIMIT)) {
    lines.push(`- ${safeText(category)}: ${count}`);
  }
  const hidden = categories.length - TOP_CATEGORY_LIMIT;
  if (hidden > 0) {
    lines.push(`- ${hidden} more categories hidden.`);
  }
  lines.push("");
}

function categoryCounts(brief) {
  const counts = new Map();
  for (const entry of allSkillEntries(brief)) {
    const category = entry.advanced?.category ?? "uncategorized";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    return right[1] - left[1] || left[0].localeCompare(right[0]);
  });
}

function allSkillEntries(brief) {
  return [
    ...brief.skills.automatic_allowed,
    ...brief.skills.manual_allowed,
    ...brief.skills.needs_review,
    ...brief.skills.blocked,
    ...brief.skills.not_in_workflow,
    ...brief.skills.installed_only
  ];
}

function compactGroupLabel(key) {
  if (key === "automatic_allowed") {
    return "automatic skills";
  }
  if (key === "manual_allowed") {
    return "manual-only skills";
  }
  if (key === "needs_review") {
    return "decision items";
  }
  return "blocked skills";
}

function verboseCommand(brief) {
  return `skillboard brief --verbose${workflowOption(brief)}`;
}

function listCommand(brief) {
  return `skillboard list skills${workflowOption(brief)}`;
}

function workflowOption(brief) {
  const selected = brief.workflow.selected;
  if (selected === null || brief.workflow.unknown) {
    return "";
  }
  return ` --workflow ${selected}`;
}

function emitActions(lines, brief, options) {
  const actions = actionsForTextBrief(brief);
  lines.push("## Suggested next actions", "");
  lines.push(suggestedActionsLead(brief), "");
  if (actions.length === 0) {
    lines.push("- none", "");
    return;
  }
  const ordered = orderedActions(actions, prioritizeSourceDecisions(brief));
  const primary = ordered.filter((action) => PRIMARY_ACTION_KINDS.has(action.kind));
  const other = ordered.filter((action) => !PRIMARY_ACTION_KINDS.has(action.kind) && !CLEANUP_ACTION_KINDS.has(action.kind));
  const cleanup = ordered.filter((action) => CLEANUP_ACTION_KINDS.has(action.kind));
  if (primary.length === 0 && other.length === 0 && cleanup.length === 0) {
    lines.push("- none", "");
    return;
  }
  emitActionList(lines, primary, { ...options, brief });
  if (!options.verbose) {
    const hiddenSecondary = other.length + cleanup.length;
    if (hiddenSecondary > 0) {
      if (lines[lines.length - 1] === "") {
        lines.pop();
      }
      lines.push(`- ${hiddenSecondary} safety and cleanup actions hidden. Run ${code(`skillboard brief --verbose${workflowOption(brief)}`)}.`);
      lines.push("");
    }
    return;
  }
  if (other.length > 0) {
    lines.push("## Other safety actions", "");
    emitActionList(lines, other, { ...options, brief });
  }
  if (cleanup.length > 0) {
    lines.push("## Advanced cleanup actions", "");
    emitActionList(lines, cleanup, { ...options, brief });
  }
}

function suggestedActionsLead(brief) {
  return hasUsableRoutedSkill(brief)
    ? "After the routed task, use current action ids from this brief for policy changes; ask for one user confirmation before applying one action."
    : "AI/automation operations should use current action ids from this brief, then ask for user confirmation before applying one action.";
}

function emitNextAction(lines, brief, options) {
  lines.push("## Next safe action", "");
  lines.push(nextActionLead(brief), "");
  const action = nextSafeAction(brief);
  if (action === null) {
    lines.push("- none", "");
    return;
  }
  emitAction(lines, action, { ...options, brief, listOnly: false });
  lines.push("");
}

function nextActionLead(brief) {
  return hasUsableRoutedSkill(brief)
    ? "A routed skill is already usable for this request; handle this policy action after the task unless a policy-changing action is needed now."
    : "AI/automation should present this as the next confirmable operation, not as an automatic mutation.";
}

function hasUsableRoutedSkill(brief) {
  const route = brief.assistant_guidance?.route;
  return route?.recommended_skill !== null
    && route?.recommended_skill !== undefined
    && route.guard_allowed === true;
}

function nextSafeAction(brief) {
  const actions = actionsForTextBrief(brief);
  if (actions.length === 0) {
    return null;
  }
  const ordered = orderedActions(actions, prioritizeSourceDecisions(brief));
  return ordered.find((action) => PRIMARY_ACTION_KINDS.has(action.kind) && action.blocked_reason === null)
    ?? ordered.find((action) => PRIMARY_ACTION_KINDS.has(action.kind))
    ?? null;
}

function actionsForTextBrief(brief) {
  return brief.actions ?? [];
}

function orderedActions(actions, prioritizeDecisions) {
  return [...actions].sort((left, right) => {
    return actionRank(left, prioritizeDecisions) - actionRank(right, prioritizeDecisions)
      || left.id.localeCompare(right.id);
  });
}

function prioritizeSourceDecisions(brief) {
  return brief.skills.needs_review.length > 0;
}

function actionRank(action, prioritizeDecisions) {
  if (!prioritizeDecisions && isSourceDecisionAction(action)) {
    return 2;
  }
  return ACTION_KIND_RANK.get(action.kind) ?? 10;
}

function isSourceDecisionAction(action) {
  return action.kind === "block-install-unit"
    || action.kind === "review-install-unit"
    || action.kind === "trust-install-unit";
}

function emitActionList(lines, actions, options) {
  if (actions.length === 0) {
    lines.push("- none", "");
    return;
  }
  for (const action of actions.slice(0, MAX_ACTIONS_PER_TEXT_SECTION)) {
    emitAction(lines, action, { ...options, listOnly: !options.verbose });
  }
  const hidden = actions.length - MAX_ACTIONS_PER_TEXT_SECTION;
  if (hidden > 0) {
    const details = options.verbose
      ? "skillboard brief --include-actions --json"
      : `skillboard brief --verbose${workflowOption(options.brief)}`;
    lines.push(`- ${hidden} more action cards available with ${code(details)}.`);
  }
  lines.push("");
}

function emitAction(lines, action, options) {
  if (options.listOnly) {
    emitCompactActionListItem(lines, action);
    return;
  }

  lines.push(`- ${safeText(action.label)} (${action.risk})`);
  lines.push(`  - why: ${safeText(action.reason)}`);
  if (action.blocked_reason !== null) {
    lines.push(`  - blocked: ${safeText(action.blocked_reason)}`);
  }
  if (!options.verbose) {
    emitCompactActionCommands(lines, action, options.brief);
    return;
  }
  if (action.application?.preview !== undefined && action.application.preview !== null) {
    lines.push(`  - preview action: ${code(action.application.preview.display, Number.POSITIVE_INFINITY)}`);
  }
  if (action.application?.apply !== undefined && action.application.apply !== null) {
    lines.push(`  - apply action: ${code(action.application.apply.display, Number.POSITIVE_INFINITY)}`);
  }
  if (action.dry_run !== null) {
    lines.push(`  - ${rawLabel(action, "preview")}: ${code(action.dry_run.display)}`);
  }
  if (action.apply !== null) {
    lines.push(`  - ${rawLabel(action, "apply")}: ${code(action.apply.display)}`);
  }
}

function emitCompactActionListItem(lines, action) {
  const blocked = action.blocked_reason === null ? "" : ` - blocked: ${safeText(action.blocked_reason)}`;
  lines.push(`- ${safeText(action.label)} (${action.risk})${blocked}`);
}

function emitCompactActionCommands(lines, action, brief) {
  let emittedCommand = false;
  if (action.application?.preview !== undefined && action.application.preview !== null) {
    lines.push(`  - preview: ${code(compactApplyActionCommand(action, brief, "preview"))}`);
    emittedCommand = true;
  }
  if (action.application?.apply !== undefined && action.application.apply !== null) {
    lines.push(`  - apply: ${code(compactApplyActionCommand(action, brief, "apply"))}`);
    emittedCommand = true;
  }
  if (action.application?.blocked_reason !== undefined && action.application.blocked_reason !== null) {
    lines.push(`  - blocked: ${safeText(action.application.blocked_reason)}`);
  }
  if (!emittedCommand && action.dry_run !== null) {
    lines.push(`  - preview: ${code(action.dry_run.display, Number.POSITIVE_INFINITY)}`);
  }
  lines.push(`  - details: ${code(`skillboard brief --verbose${workflowOption(brief)}`)}`);
}

function compactApplyActionCommand(action, brief, mode) {
  const flag = mode === "preview" ? "--dry-run" : "--yes";
  const destructive = mode === "apply" && action.kind === "reset-cleanup" ? " --allow-destructive" : "";
  return `skillboard apply-action ${action.id}${workflowOption(brief)} ${flag}${destructive}`;
}

function rawLabel(action, label) {
  return action.application?.preview === undefined ? label : `underlying ${label}`;
}

function workflowSummary(workflow) {
  if (workflow.unknown) {
    return `${workflow.selected} (unknown)`;
  }
  if (workflow.needs_selection) {
    return `needs selection: ${workflow.candidates.join(", ")}`;
  }
  if (workflow.selected === null) {
    return "none selected";
  }
  return `${workflow.selected}${workflow.defaulted ? " (defaulted)" : ""}`;
}

function safeText(value, maxLength = 180) {
  const compact = String(value).replace(/\s+/g, " ").trim();
  const withoutTicks = compact.replace(/`/g, "'");
  return withoutTicks.length > maxLength ? `${withoutTicks.slice(0, maxLength - 3)}...` : withoutTicks;
}

function code(value, maxLength = 180) {
  return `\`${safeText(value, maxLength)}\``;
}

function formatCodeList(values) {
  return values.length === 0 ? "none" : values.map((value) => code(value)).join(", ");
}
