# Skill Variant Lifecycle

A variant is a manual content adaptation with snapshot and digest history. The
lifecycle does not authorize availability. A registered variant is usable only
according to its ordinary v2 `enabled` entry and generated installation
presence; optional preference is raw model context and never changes
availability.

## Current v2 boundary

`variant status` remains a read-only advanced operator surface for content and
inventory lifecycle metadata. Authorization-mutating `fork`, `approve`, and
`reset` forms remain an explicit v1 compatibility boundary. Legacy capability
or mode fields are never current availability gates. Runtime/action
authorization remains with the agent or harness.

## Content review flow

1. Fork a variant from a known base.
2. Edit its `SKILL.md` manually.
3. Inspect live/base/approved digest drift.
4. Approve the reviewed snapshot.
5. Reset to a recorded base or approved snapshot when necessary.

SkillBoard does not convert or rewrite skill bodies and does not promise semantic
equivalence between base and variant.

## Read-only inspection

```bash
skillboard variant status <variant-id> --config <path> --skills <dir> --json
```

The `variant status` read-only payload reports stored content and inventory
lifecycle metadata plus computed digest drift.
Snapshots live under `.skillboard/variant-snapshots/<encoded-skill-id>/` and are
created lazily. Path containment checks protect live and snapshot files.

## Version 1 compatibility reference

Historical v1 commands accepted capability, workflow, owner-install-unit, and
mode values such as `manual-only`, `router-only`, and `workflow-auto`. Those
arguments describe the v1 migration/compatibility surface only; they do not
authorize v2 availability.

```text
skillboard variant fork <variant-id> --from <base-id> --capability <name> --workflow <name> --path <path> ...
skillboard variant approve <variant-id> ...
skillboard variant reset <variant-id> --to-base|--to-approved ...
```

Before using a migrated variant, set its v2 policy explicitly:

```yaml
version: 2
skills:
  claude-review:
    enabled: true
    shared: false
    preference:
      intents:
        - review
      priority: 100
```

These authorization-mutating compatibility commands do not change v2 policy.
Use the ordinary v2 enable/disable/share/unshare commands for policy changes.
