export const BRIDGE_START = "<!-- BEGIN SKILLBOARD -->";
export const BRIDGE_END = "<!-- END SKILLBOARD -->";

export function defaultConfig() {
  return `version: 2
skills: {}
`;
}

export function bridgeBlock() {
  return `${BRIDGE_START}
# SkillBoard Control Plane

SkillBoard keeps one user-level policy. A valid installed skill defaults to
enabled and agent-local. Users may opt individual skills into cross-agent
sharing. Optional preference ranks enabled skills installed for the current
agent and never changes availability or copies files.

## Route and use

- Work normally unless skills overlap or the user asks
  for a skill decision.
- Read \`skillboard brief --intent <request> --agent <agent> --json\`.
- Use the recommended enabled, installed skill and ordered fallbacks. Honor an
  explicit user choice when the guard allows it.
- Run \`skillboard guard use <skill-id> --agent <agent> --json\` immediately
  before use.
- Do not ask for another approval when guard allows use. Briefly disclose the
  selected skill as an audit trace.
- If the routed brief suggests policy memory, finish the work first, then ask
  once whether to remember that intent preference. Do not prompt before use.

## Change policy

- Policy changes only enable/disable a skill, share/unshare one skill, or
  remember optional ranking preference.
- Read a fresh brief with \`--include-actions\`, choose one current action id, ask
  for one confirmation, then run \`skillboard apply-action <action-id> --yes
  --json\`.
- Reread the returned post-apply brief. Never reuse cached action ids or apply
  multiple actions from one confirmation.
- If inventory no longer observes a permanently removed unshared skill, use its
  current forget action after confirmation. Forget removes policy only and never
  deletes skill files.

## Compatibility and boundaries

- If the brief reports stale version 1 policy, do not mutate it. Preview
  \`skillboard migrate v2 --config skillboard.config.yaml --json\`, then obtain
  confirmation before applying with \`--yes --json\`. Rollback uses
  \`--rollback <backup> --json\`.
- Source and provenance observations are optional audit metadata and never
  determine availability.
- Runtime and action authorization are outside SkillBoard's scope. Follow the
  agent or harness permission boundary for commands, hooks, MCP servers,
  external writes, destructive actions, network access, and secrets.

${BRIDGE_END}`;
}

export function profileReadme() {
  return `# SkillBoard source profiles

Put discovery profiles here when a skill repository is not
covered by a built-in profile. Profiles produce inventory observations; they do
not authorize availability. Newly discovered valid skills default to
enabled and agent-local while existing user policy is preserved.
`;
}

export function hookReadme() {
  return `# SkillBoard hooks

Preview a generated guard hook before installation:

\`\`\`bash
skillboard hook install --workflow <name> --config skillboard.config.yaml --skills skills --out .skillboard/hooks/<name>-guard.sh --dry-run --json
\`\`\`

For persistent changes prefer one current action card applied with
\`skillboard apply-action <action-id> --yes --json\`. Runtime hook permission is
owned by the active harness, not SkillBoard policy.
`;
}
