# SkillBoard Reference

## Command forms

Global install:

```bash
skillboard <command>
```

Source tree: replace `skillboard ` with `node bin/skillboard.mjs `.

## Core user-level commands

```text
skillboard setup [--yes] [--agent codex[,claude,opencode,hermes]] [--skill-root <path>]
skillboard inventory refresh [--config <path>] [--dry-run] [--json]
skillboard brief [--agent codex|claude|opencode|hermes] [--intent <request>] [--include-actions] [--json]
skillboard route <intent> --agent codex|claude|opencode|hermes [--json]
skillboard can-use <skill-id> --agent codex|claude|opencode|hermes [--json]
skillboard guard use <skill-id> --agent codex|claude|opencode|hermes [--json]
skillboard skill enable <skill-id> [--dry-run] [--json]
skillboard skill disable <skill-id> [--dry-run] [--json]
skillboard skill share <skill-id> [--dry-run] [--json]
skillboard skill unshare <skill-id> [--dry-run] [--json]
skillboard skill preference <skill-id> --intent <term>[,<term>] --priority <integer> [--dry-run] [--json]
skillboard skill forget <skill-id> [--dry-run] [--json]
skillboard uninstall --user (--dry-run|--yes) [--json]
skillboard doctor [--config <path>] [--strict] [--json]
```

Without path overrides, commands read `~/skillboard.config.yaml` and
`~/.skillboard/inventory.json` from any directory. Setup bootstraps both files
atomically and never creates project state.

Doctor also reports installation health: the running package version and
entrypoint, the `skillboard` executable selected by `PATH`, discovered package
installations, shadowing, and duplicate global installs. These observations are
informational and do not change policy health. Candidate executables are never
run during discovery. Use `skillboard doctor --summary` after updates; use
`npm config get prefix` in each Node environment to identify the owner of a
stale global copy. SkillBoard does not automatically uninstall another prefix.

Setup is the convergent install/update command. It refreshes managed guidance,
policy, and inventory; discovers late standard roots and Hermes profiles; and
creates missing compatible copies for policy entries already marked
`shared: true`. `--skill-root` requires exactly one `--agent`, accepts only a
non-symlinked path inside the invoking user's home, and persists the mapping in
`~/.skillboard/agent-roots.json`. That registry is operational discovery state,
not authorization or policy. One root cannot be registered to two agents.

Guard requires a valid inventory record, `enabled: true`, and the selected agent
in `installed_on`. Optional preference ranks candidates but never changes
availability.

Version 2 route, can-use, and guard require `--agent`; generated agent guidance
passes it automatically. This prevents one agent from selecting another
agent's local-only skill without adding a user prompt to the normal flow.

## Config schema v2

```yaml
version: 2
skills:
  local-helper:
    enabled: true
    shared: false
    preference:
      intents: [implementation]
      priority: 50
  shared-helper:
    enabled: true
    shared: true
  disabled-helper:
    enabled: false
    shared: false
```

- `enabled` and `shared` are required Booleans.
- `shared: false` means agent-local; `shared: true` enables managed cross-agent
  copies while preserving the original.
- `preference` is optional and ranks enabled skills installed for the current
  agent only.
- Unknown policy keys are rejected.
- Skill ids use letters, numbers, `.`, `_`, `:`, and `-`; path-like ids are rejected.
- A valid newly discovered skill defaults to enabled and agent-local.

`skill forget` removes only a policy entry. It requires healthy inventory,
refuses skills that are still observed or shared, and never deletes skill files.
This distinguishes permanent owner removal from a temporarily unavailable agent
root.

## Generated inventory and audits

`~/.skillboard/inventory.json` records `installed_on`, paths, sources,
provenance, digests, aliases, install units, and runtime-component observations.
Only `installed_on` participates in the presence check. Other observations are
optional audit metadata and never determine availability.

Runtime and action authorization are outside SkillBoard's scope. The active
agent or harness owns permission checks for hooks, MCP servers, commands,
network access, external writes, destructive operations, and secrets.

Profile import is trust-neutral. Preview a merge before writing:

```bash
skillboard import --profile <id-or-path> --source-root <dir> --config <path> --merge --dry-run
```

Import does not approve a source or authorize runtime components. Missing valid
skills receive the enabled, agent-local default; existing policy is preserved
unless `--replace` is explicit.

## Policy actions

Agents obtain current actions from `brief --include-actions --json`, ask once,
and apply exactly one current id:

```bash
skillboard apply-action <action-id> --agent <agent> --yes --json
```

The returned post-apply brief is authoritative. Cached ids are not reused.
Share and unshare action cards use the same managed-copy transaction as the
direct commands.

## User-level removal

```bash
skillboard uninstall --user --dry-run
skillboard uninstall --user --yes
```

Dry-run reports marker-owned shared copies, managed agent guidance, and the two
home state paths without mutation. Apply requires `--yes`, rechecks ownership
markers before removing copies, never follows a symlinked agent skill root, and
preserves agent-owned and unmanaged skills. It then removes
`~/skillboard.config.yaml` and `~/.skillboard`. Package removal remains a
separate `npm uninstall -g agent-skillboard` step.

## Version 1 migration reference

Version 1 is readable but immutable during the v0.3 one-release read-only
window:

```bash
skillboard migrate v2 --config <path> --json
skillboard migrate v2 --config <path> --yes --json
skillboard migrate v2 --config <path> --rollback <backup> --json
```

Preview changes no bytes. Apply creates an adjacent byte-for-byte backup and
writes v2 policy plus generated inventory atomically. Rollback restores the
selected backup. v0.4.0 removes the v1 reader.

Setup and global npm postinstall automatically migrate a valid version 1 user
policy when all reported choices are understood. They create an adjacent exact
backup, preserve terminal denials as disabled, and map review-only quarantine
to enabled and agent-local. An unknown future ambiguity leaves the policy
unchanged, changes no migration files, and prints the preview form. The same
review path names policy skills that are not currently observed. Explicit
commands remain available for project policies, audit, and recovery.

Legacy fields are interpreted only by migration and never become hidden v2
authorization. Primary examples are `examples/v2-multi-source.config.yaml` and
`examples/v2-policy-error.config.yaml`; unprefixed v1 examples remain migration
fixtures.

## Advanced operator commands

The complete CLI help lists import, audit, rollout, hook, lock, variant,
reconcile, impact, dashboard, and legacy lifecycle commands. These are not the
normal user loop.

`reconcile` reports missing valid inventory skills as enabled, agent-local
recommendations. It does not write policy implicitly. `impact disable
<skill-id>` reports current enabled and sharing consequences. Neither command
introduces another authorization state.

`variant status <variant-id>` is read-only content and inventory lifecycle
inspection. V2 availability changes only through `skill enable`, `skill
disable`, `skill share`, `skill unshare`, and `skill preference`; `skill forget`
removes obsolete policy only after the skill is absent.

Hook installation remains an advanced legacy-workflow surface:

```bash
skillboard hook install --workflow <name> --config <path> --skills <dir> --out <path> --dry-run --json
```
