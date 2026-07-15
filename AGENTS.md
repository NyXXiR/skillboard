<!-- BEGIN SKILLBOARD -->
# SkillBoard Control Plane

SkillBoard keeps one user-level policy. A valid installed skill defaults to
enabled and agent-local. Users may opt individual skills into cross-agent
sharing. Optional preference is raw context for the model and never changes
availability or copies files.

## Route and use

- Work normally unless skills overlap or the user asks
  for a skill decision.
- Read `skillboard brief --intent <request> --agent <agent> --json`.
- SkillBoard returns eligible skill descriptions and raw saved preferences. It
  does not tokenize, score, match, or recommend from v2 request text.
- The model makes the semantic choice, including explicit user requests and
  saved preferences, or continues without a skill when none fits.
- Run `skillboard guard use <skill-id> --agent <agent> --json` immediately
  before use.
- Do not ask for another approval when guard allows use. Briefly disclose the
  selected skill as an audit trace.
- If remembering the choice would help later model selection, finish the work first, then ask
  once whether to remember that intent preference. Do not prompt before use.

## Change policy

- Policy changes only enable/disable a skill, share/unshare one skill, or
  remember optional model preference.
- Read a fresh brief with `--include-actions`, choose one current action id, ask
  for one confirmation, then run `skillboard apply-action <action-id> --yes
  --json`.
- Reread the returned post-apply brief. Never reuse cached action ids or apply
  multiple actions from one confirmation.
- If inventory no longer observes a permanently removed unshared skill, use its
  current forget action after confirmation. Forget removes policy only and never
  deletes skill files.

## Compatibility and boundaries

- If the brief reports stale version 1 policy, do not mutate it. Preview
  `skillboard migrate v2 --config skillboard.config.yaml --json`, then obtain
  confirmation before applying with `--yes --json`. Rollback uses
  `--rollback <backup> --json`.
- Source and provenance observations are optional audit metadata and never
  determine availability.
- Runtime and action authorization are outside SkillBoard's scope. Follow the
  agent or harness permission boundary for commands, hooks, MCP servers,
  external writes, destructive actions, network access, and secrets.

<!-- END SKILLBOARD -->
