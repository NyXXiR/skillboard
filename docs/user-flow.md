# User Flow

SkillBoard is a user-level control plane, not a per-project setup step. Users
enable or disable skills and may opt individual skills into cross-agent sharing.
Installed skills default to enabled and agent-local.

## 1. Install and ask normally

```bash
npm install -g agent-skillboard
```

Postinstall creates `~/skillboard.config.yaml`, refreshes
`~/.skillboard/inventory.json`, and installs managed guidance for detected
agents. No project init is needed. If setup was skipped:

```bash
skillboard setup --yes --agent codex
```

If an agent is installed later, rerun the same command for that agent. Setup
discovers standard homes and Hermes profiles, installs guidance, refreshes
inventory, and backfills only skills the user already selected with
`shared: true`. For a custom location:

```bash
skillboard setup --agent hermes --skill-root ~/.hermes/profiles/work/skills --yes
```

The registered root survives later setup and package-update runs. No project
init, profile-specific policy layer, or new approval per already-shared skill is
introduced. Unmanaged collisions are preserved and reported.

## 2. Observe and route

From any directory, the agent reads:

```bash
skillboard brief --intent "<request>" --agent codex --json
skillboard guard use <skill-id> --agent codex --json
```

The guard allows an enabled skill only when generated inventory records it on
the selected agent. Preference ranks matching candidates and never changes
availability. Allowed use does not require another confirmation.

## 3. Change one decision

```bash
skillboard skill enable <skill-id>
skillboard skill disable <skill-id>
skillboard skill share <skill-id>
skillboard skill unshare <skill-id>
skillboard skill preference <skill-id> --intent <term>[,<term>] --priority <integer>
skillboard skill forget <skill-id>
```

Share copies the complete skill directory to SkillBoard's managed shared source
and compatible agent roots while preserving the owner copy. Unshare removes only
copies managed by SkillBoard. It never deletes agent-owned originals.

For AI mediation, read `brief --include-actions --json`, confirm one current
action, run `skillboard apply-action <action-id> --agent <agent> --yes --json`, and reread the
returned post-apply brief. Cached action ids are not reused.

## 4. Ask after, then remember

When a route was ambiguous, the agent finishes first. It may then ask whether to
remember an intent preference. Preference affects ordering only; it does not
share, enable, disable, install, or remove a skill.

## 5. Audit separately

Source and provenance are optional audit metadata and never determine
availability. Import is trust-neutral: valid discoveries default to enabled and
agent-local. Runtime and action authorization are outside SkillBoard's scope and
remain with the agent or harness.

## 6. Remove a skill cleanly

Remove the original skill with the agent, plugin, or package manager that owns
it. Then refresh observations and remove only its stale SkillBoard policy:

```bash
skillboard inventory refresh
skillboard skill forget <skill-id> --dry-run
skillboard skill forget <skill-id>
```

Forget refuses a skill that is still observed or has `shared: true`. Unshare it
before removing the owner copy. Forget never deletes a `SKILL.md` or directory.

## 7. Uninstall SkillBoard cleanly

```bash
skillboard uninstall --user --dry-run
skillboard uninstall --user --yes
npm uninstall -g agent-skillboard
```

The preview lists every marker-owned shared copy, managed guidance file, and
home state path. Apply requires `--yes`, preserves agent-owned and unmanaged
skills, and does not touch project files.

## 8. Migrate version 1

```bash
skillboard migrate v2 --config <path> --json
skillboard migrate v2 --config <path> --yes --json
skillboard migrate v2 --config <path> --rollback <backup> --json
```

Version 1 remains readable but immutable for the v0.3.x one-release read-only
window. v0.4.0 removes the v1 reader. No ordinary command migrates implicitly.
