# Routing

Routing chooses among skills already available to the current agent. Guard
decides availability from valid generated inventory, `enabled`, and
`installed_on`; routing cannot override that verdict.

## v2 resolution order

1. Remove skills missing valid inventory records.
2. Remove disabled skills.
3. Remove skills not installed for the selected agent.
4. Return every remaining skill's id, name, description, path, and raw optional
   preference beside the request.
5. Let the active model interpret the full request, explicit user direction,
   descriptions, instructions, and preferences and choose a skill or no skill.
6. Guard the model-selected skill immediately before use.

V2 has no intent tokenizer, metadata score, request matcher, ranked candidates,
or deterministic recommendation. Korean and other languages are handled by the
foundation model. Preference is raw model context and never changes
availability. Version 1 compatibility routing retains its deterministic
tokenizer until the v1 reader is removed in v0.4.0.

```bash
skillboard brief --intent "write tests" --agent codex --json
skillboard route "write tests" --agent codex --json
skillboard guard use test-first --agent codex --json
```

These commands use `~/skillboard.config.yaml` and
`~/.skillboard/inventory.json` from any working directory. Advanced
`--config` and `--skills` overrides remain available for migration, testing,
and legacy workspaces.

When guard allows use, continue without another approval. If the model-selected
choice was ambiguous, finish first and ask afterward only when remembering a
preference would reduce future ambiguity.

Version 1 compatibility routing remains workflow-driven and may return a
deterministic capability route. It asks for clarification when no workflow
route matches.

Source and provenance findings are optional audit metadata and never determine
availability. Runtime and action authorization are outside SkillBoard's scope.
