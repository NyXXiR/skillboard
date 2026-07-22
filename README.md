# SkillBoard

[![npm version](https://img.shields.io/npm/v/agent-skillboard.svg)](https://www.npmjs.com/package/agent-skillboard)
[![CI](https://github.com/NyXXiR/skillboard/actions/workflows/check.yml/badge.svg)](https://github.com/NyXXiR/skillboard/actions/workflows/check.yml)
[![license](https://img.shields.io/npm/l/agent-skillboard.svg)](LICENSE)

After a global install, SkillBoard attaches guidance to detected Codex, Claude
Code, OpenCode, and Hermes environments. When installed skills overlap, the
active model chooses from eligible descriptions and saved preferences;
SkillBoard then verifies that the chosen skill is enabled and installed for the
current agent before use.

SkillBoard keeps that behavior in one small user-level policy:

1. Enable or disable a skill.
2. Keep an enabled skill agent-local or shared across agents.

Valid installed skills default to enabled and agent-local. Sharing is opt-in per
skill. The model makes semantic skill choices from the request, eligible skill
descriptions, and raw saved preferences. SkillBoard does not tokenize, score,
match, or recommend from v2 request text.

Status: public alpha. Current releases use policy schema v2.

<p align="center">
  <img src="https://raw.githubusercontent.com/NyXXiR/skillboard/main/skillboard.png" alt="SkillBoard architecture diagram" width="100%">
</p>

## 5-Minute Quick Start

Requires Node.js 14.21 or newer. SkillBoard currently supports Codex, Claude
Code, OpenCode, and Hermes.

Try the read-only CLI:

```bash
npm exec --yes --package agent-skillboard@latest -- skillboard --version
npm exec --yes --package agent-skillboard@latest -- skillboard help
```

Install globally:

```bash
npm install -g agent-skillboard
skillboard doctor --summary
```

Restart or refresh your AI agent after installation, then ask for work normally.
SkillBoard is consulted when installed skills overlap or when you ask which
skill should be used. For example:

> Which skill should you use to create a source-verified executive report?

The package postinstall sets up detected agent guidance and creates the
user-level state at `~/skillboard.config.yaml` and
`~/.skillboard/inventory.json`. No separate setup command is required after a
normal install. If lifecycle scripts were skipped or another agent was added:

```bash
skillboard setup --agent codex,claude,opencode,hermes --yes
```

Use the same Node/npm environment for later updates:

```bash
npm config get prefix
npm install -g agent-skillboard@latest
skillboard doctor --summary
```

Doctor compares the running package with the `skillboard` executable selected
by `PATH` and reports duplicate global installs without executing those
candidates. If multiple SkillBoard installations are reported, choose one npm
prefix, activate the Node environment that owns each stale copy, and run
`npm uninstall -g agent-skillboard` there. SkillBoard does not automatically
uninstall another prefix. Restart or refresh agents after an update because
some agents cache user skills.

When an update finds a valid version 1 user policy, setup automatically migrates
it only when all reported choices are understood. It creates an adjacent exact
backup, keeps explicit terminal denials disabled, and maps review-only
quarantine states to enabled and agent-local. Unknown future ambiguity leaves
the policy unchanged and prints the explicit preview command instead. The same
review path is used when a v1 policy skill is not currently observed, avoiding
an unhealthy generated inventory or silently forgetting a denial.

`setup` is safe to rerun. It refreshes managed guidance and inventory, discovers
late standard agent homes and Hermes profiles, and fills already-selected
`shared: true` skills into newly active roots. It does not make every skill
global and never overwrites an unmanaged skill.

For an agent that uses a nonstandard skill directory, register that root once:

```bash
skillboard setup --agent hermes --skill-root ~/.hermes/profiles/work/skills --yes
```

The root must be inside the invoking user's home. SkillBoard records it as
operational discovery state in `~/.skillboard/agent-roots.json`, then reuses it
on later setup and global package updates. This does not add another policy
scope; per-skill `shared` remains the only cross-agent sharing decision.

`sudo npm install -g agent-skillboard` is supported when system npm requires
it. Setup resolves `SUDO_USER` and restores managed home files to that user.
Setup and ordinary use write no project policy and require no project init.

## The v2 policy

```yaml
version: 2
skills:
  test-first:
    enabled: true
    shared: false
    preference:
      intents: [testing]
      priority: 100
  docs-helper:
    enabled: true
    shared: true
  unused:
    enabled: false
    shared: false
```

`enabled` controls use. `shared` controls whether SkillBoard maintains compatible
copies for other supported agents. `shared: false` leaves the skill where its
owner installed it; it does not quarantine, isolate, move, or delete anything.
`shared: true` preserves the owner copy and adds only managed shared copies.

New valid skills receive `enabled: true` and `shared: false`. See
`examples/v2-multi-source.config.yaml` for a valid policy and
`examples/v2-policy-error.config.yaml` for a validation fixture. Unprefixed
examples are retained only as v1 migration fixtures.

Generated inventory records where a skill is installed through `installed_on`.
Source, provenance, path, digest, aliases, install-unit details, and risk are
optional audit metadata and never determine availability. Runtime and action
authorization are outside SkillBoard's scope; the active agent or harness still
authorizes commands, hooks, MCP servers, network access, external writes,
destructive actions, and secrets.

## Agent flow

From any working directory, an agent can:

1. Read `skillboard brief --intent <request> --agent <agent> --json`.
2. Select the best eligible skill from the full request, descriptions, local
   instructions, and raw saved preferences, or use no skill. The model itself
   interprets explicit user direction and preference semantics.
3. Run `skillboard guard use <skill-id> --agent <agent> --json` before use.
4. Work without another approval when the guard allows use.
5. Ask after completion only if remembering a preference would help.

Direct policy changes are:

```bash
skillboard skill enable <skill-id>
skillboard skill disable <skill-id>
skillboard skill share <skill-id>
skillboard skill unshare <skill-id>
skillboard skill preference <skill-id> --intent <term>[,<term>] --priority <integer>
skillboard skill forget <skill-id>
```

Add `--dry-run` to preview or `--json` for machine-readable output. For mediated
changes, the agent reads `brief --include-actions --json`, asks once about one
current action, runs `skillboard apply-action <action-id> --agent <agent> --yes --json`, and
rereads the returned post-apply brief.

This is the distinction from a pure distribution tool: skills stay local by
default, users promote only selected skills to shared use, and a model-facing
preference can be remembered without changing installation or availability.

## Migrate version 1

Version 1 has a one-release read-only window beginning in v0.3.0. Preview makes
no writes; apply creates an adjacent byte-for-byte backup; rollback restores it.

```bash
skillboard migrate v2 --config <path> --json
skillboard migrate v2 --config <path> --yes --json
skillboard migrate v2 --config <path> --rollback <backup> --json
```

Starting in 0.3.2, setup and global package updates automatically migrate a
valid version 1 user policy when the report contains only understood choices.
The transaction creates an adjacent exact backup. Explicit terminal denials
remain disabled; review-only quarantine becomes enabled and agent-local. An
unknown future ambiguity leaves the policy unchanged and prints the preview
command. A policy skill that is not currently observed also stays on v1 for an
explicit decision, because forgetting a disabled entry could enable it if it
later reappears. The explicit commands remain available for project policies,
audits, and rollback. Other v1 mutations still refuse and point to migration.
v0.4.0 removes the v1 reader.

## Cleanup

After removing a local skill with its owning agent or package manager, refresh
inventory and explicitly forget the stale policy entry:

```bash
skillboard inventory refresh
skillboard skill forget <skill-id> --dry-run
skillboard skill forget <skill-id>
```

`forget` never deletes skill files. It refuses skills that are still observed or
shared, so shared skills must be unshared first.

A valid generated inventory remains healthy when it no longer observes an
unshared policy entry. Doctor/status expose sorted entries as
`inventory.stalePolicySkills`; brief exposes the same observation as
`health.inventory.stale_policy_skills`. Stale removed-skill policy does not fail
strict health, change passed mode, or block other observed skills. The absent
skill itself remains unavailable to route and guard. SkillBoard never deletes
these entries automatically: review one current forget action, confirm it, and
then reread the returned brief.

Before removing the SkillBoard package, preview and apply the complete
user-level cleanup:

```bash
skillboard uninstall --user --dry-run
skillboard uninstall --user --yes
npm uninstall -g agent-skillboard
```

User cleanup removes marker-owned shared copies, managed guidance, the home
policy, and generated user state. It preserves agent-owned and unmanaged skills.
Legacy project and guidance-only cleanup remain available through command help.

## Development

From a clone, replace `skillboard ` with `node bin/skillboard.mjs `.

```bash
npm install
npm run check
node bin/skillboard.mjs help
```

Read [installation](docs/install.md), [user flow](docs/user-flow.md),
[policy model](docs/policy-model.md), [routing](docs/routing.md),
[reference](docs/reference.md), [versioning](docs/versioning.md), and the
[Rollout runbook](docs/rollout-runbook.md).
