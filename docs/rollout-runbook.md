# SkillBoard Rollout Runbook

This is an advanced operator runbook for applying and reversing generated
rollout artifacts. It does not add availability rules: v2 availability remains
an enabled policy entry plus generated presence on the selected agent.

## Preconditions

- Run on Node.js 14.21 or newer. Release CI covers Node.js 14.21, 20, and 22.
- Use policy schema v2.
- Use `--json` for automation; rollout commands do not prompt.
- Treat source/provenance findings as optional audit metadata. They never change
  availability.
- Runtime and action authorization remains with the agent or harness.

## Status and exit codes

- `healthy`: exit code `0`.
- `safe-mode`: exit code `1`.
- `strict-failed`: exit code `2`.
- `apply-failed`: exit code `3`.
- `rollback-needed`: exit code `4`.

These statuses describe operator execution health, not skill availability.

## Standard flow

```bash
skillboard rollout audit --config skillboard.config.yaml --skills skills --json
skillboard rollout plan --config skillboard.config.yaml --skills skills --json
skillboard rollout apply --config skillboard.config.yaml --skills skills --json
skillboard rollout report --config skillboard.config.yaml --skills skills --json
```

`audit` and `plan` are read-only. `apply` records a transaction under
`.skillboard/rollouts/` with an exact-byte config backup. Source observations in
the report are informational and cannot enable or disable a skill.

## Emergency rollback

```bash
skillboard rollout rollback \
  --config skillboard.config.yaml \
  --skills skills \
  --transaction rollout-YYYYMMDDHHMMSS \
  --json
```

Rollback restores files recorded by the transaction manifest. It does not
reinterpret availability policy.

## Release gate checklist

- `npm run check`
- `git diff --check`
- `npm audit --audit-level=moderate`
- `npm pack --dry-run --json`
- Scan changed source, docs, and config for secrets before publishing.
