# Install and Setup

## Install from npm

```bash
npm install -g agent-skillboard
skillboard --version
skillboard doctor --summary
```

Postinstall detects supported agent homes, installs managed guidance, creates
`~/skillboard.config.yaml`, and refreshes `~/.skillboard/inventory.json`. No
separate setup command is required after a normal global install or update, and
no project init is needed.

## Safe updates and npm prefixes

Run the update with the Node/npm environment whose global prefix should own the
CLI:

```bash
npm config get prefix
npm install -g agent-skillboard@latest
skillboard doctor --summary
```

Node version managers and system npm can use different global prefixes. Doctor
reports the current package, the `skillboard` executable selected by `PATH`, and
multiple SkillBoard installations. Discovery reads executable links and package
metadata only; it does not execute PATH candidates.

When doctor reports duplicate global installs, select the prefix you intend to
keep. Activate the Node environment that owns each stale prefix, confirm it with
`npm config get prefix`, and run `npm uninstall -g agent-skillboard` there.
SkillBoard does not automatically uninstall another prefix or request elevated
permissions for cleanup.

From 0.3.2, setup and global postinstall automatically migrate a valid version
1 user policy when every reported migration choice is understood. Migration
creates an adjacent exact backup, preserves explicit terminal denials as
disabled, and makes review-only quarantine states enabled and agent-local. An
unknown future ambiguity leaves the policy unchanged and prints the explicit
preview command; no migration files are changed. A v1 policy skill that is not
currently observed uses the same review path so setup neither invents inventory
nor silently forgets its policy.

Run setup later when lifecycle scripts were skipped, another agent or Hermes
profile was added, or a managed root needs to be repaired:

```bash
skillboard setup --agent codex,claude,opencode,hermes --yes
```

Setup is idempotent. Each run refreshes managed agent guidance, user policy,
and observed inventory. If the user already chose `shared: true` for a skill,
setup creates only the missing compatible managed copies for newly discovered
agent roots. It preserves unmanaged files and does not share agent-local skills.
Restart or refresh agents after setup or an npm update because an agent may
cache its user skill inventory.

Register a nonstandard agent skill directory once with exactly one agent:

```bash
skillboard setup --agent hermes --skill-root ~/.hermes/profiles/work/skills --yes
```

The root must remain inside the invoking user's home and must not traverse a
symbolic link. SkillBoard stores it in `~/.skillboard/agent-roots.json` as
operational discovery state, not policy, and reuses it during setup and global
package updates. Conventional roots that contain agent-owned skills remain
active; obsolete roots containing only SkillBoard-managed artifacts do not
create false agent presence.

System npm may require `sudo npm install -g agent-skillboard`. SkillBoard uses
`SUDO_USER` for user-level state and restores managed files to that user.

## Default behavior

A valid installed skill defaults to enabled and agent-local. Sharing is opt-in
per skill:

```bash
skillboard skill share <skill-id>
skillboard skill unshare <skill-id>
```

Sharing preserves agent-owned originals. Source and provenance are optional
audit metadata and never determine availability. Runtime and action
authorization are outside SkillBoard's scope.

## From GitHub or a clone

```bash
npx --yes --package github:NyXXiR/skillboard skillboard --version
npm exec --yes --package github:NyXXiR/skillboard -- skillboard help
git clone https://github.com/NyXXiR/skillboard.git
cd skillboard
npm install
node bin/skillboard.mjs help
```

For source-tree commands, replace `skillboard ` with
`node bin/skillboard.mjs `.

Hermes should read only explicitly shared or Hermes-installed skills, not the
entire Codex skill tree.

## Version 1 projects

```bash
skillboard migrate v2 --config <path> --json
skillboard migrate v2 --config <path> --yes --json
skillboard migrate v2 --config <path> --rollback <backup> --json
```

Version 1 is read-only during v0.3.x. v0.4.0 removes the v1 reader. Setup and
global postinstall automatically migrate an understood version 1 user policy
through the same backup and validation transaction. Unknown future ambiguity
or a policy skill that is not currently observed leaves it unchanged and prints
the preview command. Explicit preview, apply, and rollback remain available for
project policies, audits, and recovery.

## Uninstall

```bash
skillboard uninstall --user --dry-run
skillboard uninstall --user --yes
npm uninstall -g agent-skillboard
```

User-level cleanup removes marker-owned shared copies, managed SkillBoard
guidance, `~/skillboard.config.yaml`, and `~/.skillboard`. It preserves
agent-owned and unmanaged skills. Apply requires `--yes`; legacy project cleanup
and guidance-only `--agent-layer` cleanup remain explicit and previewable.
