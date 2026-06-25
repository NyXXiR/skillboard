const SKILL_SECTIONS = [
  ["What your AI can use now", "automatic_allowed"],
  ["Manual only", "manual_allowed"],
  ["Needs review", "needs_review"],
  ["Blocked for safety", "blocked"]
];

export function renderSkillBrief(brief) {
  const lines = [
    "# SkillBoard Brief",
    "",
    `Status: ${brief.ok ? "ready" : "needs attention"}`,
    `Mode: ${brief.health.mode}`,
    `Workflow: ${workflowSummary(brief.workflow)}`,
    ""
  ];
  if (brief.error !== undefined) {
    lines.push(`Error: ${safeText(brief.error.message)}`, "");
  }
  for (const [title, key] of SKILL_SECTIONS) {
    emitSkillSection(lines, title, brief.skills[key]);
  }
  emitSkillSection(lines, "Not in this workflow", [
    ...brief.skills.not_in_workflow,
    ...brief.skills.installed_only
  ]);
  emitActions(lines, brief.actions);
  return `${lines.join("\n")}\n`;
}

function emitSkillSection(lines, title, entries) {
  lines.push(`## ${title}`, "");
  if (entries.length === 0) {
    lines.push("- none", "");
    return;
  }
  for (const entry of entries) {
    const path = entry.path === undefined ? "" : ` (${safeText(entry.path)})`;
    const reason = entry.reason === null || entry.reason === undefined
      ? ""
      : ` - ${safeText(entry.reason)}`;
    lines.push(`- ${code(entry.id)}${path}${reason}`);
  }
  lines.push("");
}

function emitActions(lines, actions) {
  lines.push("## Suggested next actions", "");
  if (actions === undefined) {
    lines.push("- Action cards not requested; rerun with `--include-actions` to include previewable suggestions.", "");
    return;
  }
  if (actions.length === 0) {
    lines.push("- none", "");
    return;
  }
  for (const action of actions) {
    lines.push(`- ${safeText(action.label)} (${action.risk})`);
    if (action.blocked_reason !== null) {
      lines.push(`  - blocked: ${safeText(action.blocked_reason)}`);
    }
    if (action.dry_run !== null) {
      lines.push(`  - preview: ${code(action.dry_run.display)}`);
    }
    if (action.apply !== null) {
      lines.push(`  - apply: ${code(action.apply.display)}`);
    }
  }
  lines.push("");
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

function safeText(value) {
  const compact = String(value).replaceAll(/\s+/g, " ").trim();
  const withoutTicks = compact.replaceAll("`", "'");
  return withoutTicks.length > 180 ? `${withoutTicks.slice(0, 177)}...` : withoutTicks;
}

function code(value) {
  return `\`${safeText(value)}\``;
}
