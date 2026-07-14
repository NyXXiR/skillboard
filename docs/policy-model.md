# Policy Model

SkillBoard v2 keeps one user-level policy and makes two durable decisions per
skill: enable or disable it, then keep it agent-local or share it across agents.

```yaml
version: 2
skills:
  test-first:
    enabled: true
    shared: false
  docs-helper:
    enabled: true
    shared: true
  unused-helper:
    enabled: false
    shared: false
```

`enabled: false` is the only disabled state. `shared: false` is the default and
means SkillBoard does not propagate the skill; it is not isolation or a safety
judgment. `shared: true` preserves the agent-owned original and creates managed
compatible copies for other supported agents.

## Optional routing preference

Preference ranks enabled skills installed for the current agent. It never
changes availability and never shares files.

```yaml
  test-first:
    enabled: true
    shared: false
    preference:
      intents:
        - implementation
        - testing
      priority: 100
```

An explicit user selection wins when the guard allows it. A high priority cannot
enable a disabled skill or make a skill appear on an agent where it is absent.

## Generated inventory

`~/.skillboard/inventory.json` is generated observation data. Its `installed_on`
list tells routing and guard which supported agents can see each skill. Users do
not maintain an agent matrix in policy.

Source, provenance, install-unit, path, digest, alias, and risk observations are
optional audit metadata and never determine availability. Runtime and action
authorization are outside SkillBoard's scope and remain with the agent or
harness.

## Installation default

A newly discovered valid skill receives `enabled: true` and `shared: false`.
Inventory refresh preserves existing user policy. After the owning installer
permanently removes a skill, `skillboard skill forget <skill-id>` explicitly
removes its stale unshared policy; it never deletes skill files.

## Version 1 migration reference

Version 1 is accepted only as read-only migration input during the v0.3.x
window:

```bash
skillboard migrate v2 --config <path> --json
skillboard migrate v2 --config <path> --yes --json
skillboard migrate v2 --config <path> --rollback <backup> --json
```

v0.4.0 removes the v1 reader.

Setup and global postinstall automatically upgrade a valid version 1 user
policy when its migration report contains only understood choices. The
transaction keeps an exact adjacent backup. An unknown future ambiguity leaves
the policy unchanged and requires the explicit preview/apply flow. Policy skills
that are not currently observed also require review rather than being silently
forgotten.
