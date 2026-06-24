# SkillBoard Rollout Runbook

Use this runbook when SkillBoard is operated as an enterprise rollout gate for agent skills, plugins, harnesses, hooks, MCP servers, and workflow bundles.

## Preconditions

- Run on Node.js 20 or newer.
- Keep `skillboard.config.yaml` as the source of truth.
- Use `--json` for automation; rollout commands do not prompt or wait for user input.
- Treat plugin, runtime extension, and external package sources as blocked from automatic activation unless an explicit reviewed/trusted policy is recorded in config.

## Status and exit codes

- `healthy`: exit code `0`; policy and source gates passed.
- `safe-mode`: exit code `1`; reserved for usable-but-limited rollout states.
- `strict-failed`: exit code `2`; policy/source gates failed and automation must not apply rollout.
- `apply-failed`: exit code `3`; apply was blocked or failed before a committed transaction.
- `rollback-needed`: exit code `4`; apply failed after mutation risk and operator rollback is required.

## Standard rollout flow

```bash
skillboard rollout audit --config skillboard.config.yaml --skills skills --json
skillboard rollout plan --config skillboard.config.yaml --skills skills --json
skillboard rollout apply --config skillboard.config.yaml --skills skills --json
skillboard rollout report --config skillboard.config.yaml --skills skills --json
```

`audit` and `plan` are read-only. `apply` creates a transaction directory under `.skillboard/rollouts/` with a manifest, report, state file, and exact-byte backup of the config before committing.

## Source gate policy

Rollout blocks unreviewed high-risk runtime/plugin/external sources when they could become active through model-selectable skills. Before apply, review each relevant install unit and set a reviewed/trusted trust level only after source ownership, pinning, and expected runtime components are understood.

## Emergency rollback

If a rollout report or operator check indicates `rollback-needed`, restore the committed transaction by id:

```bash
skillboard rollout rollback \
  --config skillboard.config.yaml \
  --skills skills \
  --transaction rollout-YYYYMMDDHHMMSS \
  --json
```

Rollback reads `.skillboard/rollouts/<transaction>/manifest.json` and restores configured files from their recorded backups. The config restore is byte-for-byte so accidental operator edits made after apply are removed.

## Fleet report handling

Use `skillboard rollout report --json` for dashboards and schedulers. The report includes deterministic status counters for `healthy`, `safe-mode`, `strict-failed`, `apply-failed`, and `rollback-needed`. Local paths and obvious secret/token values are redacted from machine-readable payloads by default.

## Release gate checklist

- `npm run check`
- Node 20: `npx -y -p node@20 -c 'node -v && npm -v && npm run check'`
- `git diff --check`
- `npm audit --audit-level=moderate`
- `npm pack --dry-run --json`
- Secret scan changed source, docs, and config files before publishing or pushing.
