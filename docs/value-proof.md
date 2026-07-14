# SkillBoard Value Proof

The executable proof is the v2 contract and integration suite:

```bash
node --test test/v2-agent-sharing.test.mjs test/v2-onboarding-behavior.test.mjs test/v2-guard-route.test.mjs test/v2-surface-integration.test.mjs
```

## What it proves

- Setup creates user-level state without project init.
- Valid discovered skills default to enabled and agent-local.
- Disabled skills and skills absent from the selected agent are denied.
- Share and unshare preserve agent-owned originals.
- Optional preference changes ranking without changing availability.
- Source and provenance audits do not change guard results.
- Commands produce the same result from different working directories.
- Version 1 project policy remains read-only until explicit migration; setup
  automatically migrates an understood user policy with an exact backup.

## Reproduce the user surface

```bash
node bin/skillboard.mjs setup --yes --agent codex
node bin/skillboard.mjs brief --agent codex --json
node bin/skillboard.mjs check --config examples/v2-multi-source.config.yaml --skills examples/multi-source-skills
```

The policy contains only `enabled`, `shared`, and optional preference. Generated
inventory records `installed_on`. Source and provenance remain optional audit
metadata and never determine availability. Runtime and action authorization
remain outside SkillBoard's scope.

## Version 1 compatibility proof

```bash
skillboard migrate v2 --config <path> --json
skillboard migrate v2 --config <path> --yes --json
skillboard migrate v2 --config <path> --rollback <backup> --json
```
