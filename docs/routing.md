# Routing

Routing chooses among skills already available to the current agent. Guard
decides availability from valid generated inventory, `enabled`, and
`installed_on`; routing cannot override that verdict.

## Resolution order

1. Remove skills missing valid inventory records.
2. Remove disabled skills.
3. Remove skills not installed for the selected agent.
4. Honor an explicit user-selected skill if it remains eligible.
5. Rank intent matches by optional preference and priority.
6. Return one recommendation and ordered fallbacks.

Preference ranks only and never changes availability.

```bash
skillboard brief --intent "write tests" --agent codex --json
skillboard route "write tests" --agent codex --json
skillboard guard use test-first --agent codex --json
```

These commands use `~/skillboard.config.yaml` and
`~/.skillboard/inventory.json` from any working directory. Advanced
`--config` and `--skills` overrides remain available for migration, testing,
and legacy workspaces.

When guard allows use, continue without another approval. Ask after completion
only when remembering a preference would reduce future ambiguity.

Source and provenance findings are optional audit metadata and never determine
availability. Runtime and action authorization are outside SkillBoard's scope.
