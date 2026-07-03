# Install And Bootstrap

SkillBoard sits one layer above skill installers, plugin marketplaces, harness
bundles, and local skill repositories.

After install, ask your AI questions like "what skills can you use here?" or
"which skill should you use for this task?" The AI runs SkillBoard behind the
scenes when skill choices overlap or workflow priority matters. Installed user
skills are usable by default unless runtime, user, or local instructions disable
them; SkillBoard should not turn every skill choice into a permission prompt.
When it selects a skill, the AI should briefly say which skill it will use and
which skill it used. You do not need to memorize the SkillBoard command loop.

## Install From npm

Global install auto-runs agent integration. Installing the package makes the
CLI available and the postinstall step runs agent-layer setup for detected
Codex, Claude, OpenCode, and Hermes user skill roots. The setup is best-effort:
it never fails the package install, does not edit agent config files, and does
not create project policy files.

The published CLI supports Node.js 14.21 or newer. Node 12 and older are not
supported without a transpiled bundle because the source uses modern ESM and
syntax such as nullish coalescing.

AI/automation/operator details:

```bash
npm install -g agent-skillboard
```

If your system npm requires elevated permissions, this is also supported:

```bash
sudo npm install -g agent-skillboard
```

Under sudo, the postinstall setup resolves `SUDO_USER` and targets that user's
agent homes instead of writing guidance under `/root`. The executable prefix is
still decided by the npm command you run, so use the same npm/Node environment
you expect to provide `skillboard` on `PATH`. Managed guidance files and
directories written under the user's home are restored to the invoking user's
`SUDO_UID:SUDO_GID` ownership.

The install-time setup writes a user-level SkillBoard guidance skill under
detected agent homes such as `CODEX_HOME`, `AGENTS_HOME`, `CLAUDE_HOME`,
`OPENCODE_HOME`, and `HERMES_HOME`. Codex detection also checks
`~/.agents/skills` and `~/.codex/skills`.
If `~/.agents` exists but `~/.agents/skills` does not, setup creates the
`skills` directory and installs the guidance skill there so Codex profiles that
read the shared agent skill tree can see SkillBoard after restart.
No separate setup command is required after a normal global install or update.
When npm runs lifecycle scripts, package updates rerun the agent-home scan,
refresh managed SkillBoard guidance files, and add newly detected supported
agent roots.

Run `skillboard setup` later when you add another supported agent, enable a new
agent home, intentionally skipped lifecycle scripts, or need to repair the
agent-layer guidance install:

```bash
skillboard setup
skillboard setup --agent codex,claude,opencode,hermes --yes
```

After setup, the target agent can reuse a skill from another supported agent:

```bash
skillboard import-skill --from codex --to opencode --skill <skill> --json
```

If the source skill can be used as-is, the agent installs it with `--yes`. If
SkillBoard reports `needs-adaptation`, the agent explains why, asks before
changing the skill body for the target runtime, then installs the approved
adapted file with `--adapted-file <path> --yes`.

Use no-prompt npx package execution only when you intentionally want to create
or inspect local workspace policy files without keeping a global SkillBoard
binary installed:

```bash
npx --yes --package agent-skillboard skillboard init
npx --yes --package agent-skillboard skillboard doctor --summary
npx --yes --package agent-skillboard skillboard brief --workflow <workflow-from-init>
```

Local workspace policy files can be stricter than the first agent-layer setup.
When you intentionally run `init`, it imports trusted local skills as
manual-only and keeps runtime/plugin skills quarantined until their source is
reviewed. The brief presents unreviewed runtime sources as one-time review
decisions rather than default block recommendations; after review, individual
quarantined skills can be activated as manual-only workflow skills. When `init`
creates or discovers workflows, use one of the workflow names it prints for the
first brief. If `init` does not print a workflow, run the unscoped `brief`
command it prints instead. The explicit package/binary spelling avoids an extra
npx install prompt and keeps the executable name clear.

The equivalent `npm exec` spelling is also no-prompt and works well in scripts:

```bash
npm exec --yes --package agent-skillboard -- skillboard init
npm exec --yes --package agent-skillboard -- skillboard doctor --summary
npm exec --yes --package agent-skillboard -- skillboard brief --workflow <workflow-from-init>
```

For repeated local use, install the CLI globally:

AI/automation/operator details:

```bash
npm install -g agent-skillboard
skillboard setup --agent codex,claude,opencode,hermes --yes
```

The executable remains `skillboard` even though the npm package name is
`agent-skillboard`.

## Run Unreleased Builds From GitHub

Use GitHub npx only when you intentionally want the current repository state
before the next npm release:

AI/automation/operator details:

```bash
npx --yes --package github:NyXXiR/skillboard skillboard init
npx --yes --package github:NyXXiR/skillboard skillboard doctor --summary
npx --yes --package github:NyXXiR/skillboard skillboard brief --workflow <workflow-from-init>
```

The equivalent `npm exec` spelling is explicit about the package and binary:

```bash
npm exec --yes --package github:NyXXiR/skillboard -- skillboard init
npm exec --yes --package github:NyXXiR/skillboard -- skillboard doctor --summary
npm exec --yes --package github:NyXXiR/skillboard -- skillboard brief --workflow <workflow-from-init>
```

## Install From A Clone

Use a clone when developing SkillBoard itself or testing unreleased changes:

AI/automation/operator details:

```bash
git clone https://github.com/NyXXiR/skillboard.git
cd skillboard
npm install
node bin/skillboard.mjs init --dir /path/to/your/project
node bin/skillboard.mjs doctor --dir /path/to/your/project --summary
node bin/skillboard.mjs brief --dir /path/to/your/project --workflow <workflow-from-init>
```

## What init Does

`skillboard init` is the optional local policy-file generation step. npm
installation and `skillboard setup` do not modify a project, but init creates
local files for teams that intentionally keep workflow policy in a workspace.

Created project files:

- `skillboard.config.yaml`: desired state for workflows, capabilities, skills,
  harnesses, and install units.
- `skills/`: local skill root.
- `.skillboard/reports/`: generated dashboard and reconcile output location.
- `.skillboard/profiles/`: project-specific source profile location.
- `AGENTS.md`: Codex-style project instruction bridge.
- `CLAUDE.md`: Claude Code project instruction bridge.

The bridge block is marked with `BEGIN SKILLBOARD` / `END SKILLBOARD` and is
idempotent. Running init again does not duplicate it.

By default, init scans known local agent skill roots such as Codex user skills,
Codex system skills, Codex plugin-cache manifests, Claude user skills, Hermes
user skills, and Hermes profile skills under `.hermes/profiles/*/skills`.
Trusted user-local skills are written as `status: active` with `invocation:
manual-only` and attached to a generated local manual workflow when the project
has no workflow metadata yet. That lets a first-time user keep their existing
manual skills usable through `skillboard can-use` and guard checks without
granting automatic model invocation or creating legacy-state warning noise.
System, plugin, and other runtime-supplied skills are written with `status:
quarantined` and `invocation: blocked`. Plugin hooks, MCP servers, commands, and
modified config files are recorded on the owning install unit when manifest
metadata exposes them, which lets policy checks flag high-risk runtime
extensions without flattening them into loose skills. After the owning source is
reviewed, action cards can activate a quarantined runtime skill into a workflow
as `manual-only`; automatic preference should still be remembered later through
the normal ask-after-use policy loop. Use `--no-scan-installed` for a
scaffold-only bootstrap, or `--scan-root <dir>[,<dir>]` to add server-specific
skill roots during bootstrap.

After init, run:

```bash
skillboard doctor --dir /path/to/your/project
```

Doctor is read-only. It reports config validity, bridge block status, managed
skills and install units, policy/source audit health, high-risk runtime
extensions, and the default uninstall dry-run plan. The default exit code stays
zero when the project is usable but has review-needed safe-mode warnings, such as
an unreviewed runtime extension. Add `--strict` when those warnings should fail a
CI or automation gate. Use `--json` for an agent-readable health payload, or
`--verify` when local source/cache digests should be checked as part of the
report. `skillboard status` is the same report under a shorter command name.

For AI-mediated use, the generated bridge tells agents to answer availability
questions by reading the current brief with `skillboard brief --json`, not from
memory or from raw `SKILL.md` bodies. The brief is read-only and organizes the
response around "What your AI can use now", decisions the user can make once,
hard safety blocks, inactive installed skills, and suggested action cards. Text
briefs show action cards by default; JSON keeps them opt-in with
`--include-actions`. The default text brief is compact for large skill sets: it
keeps counts, top categories, the next safe action, short section previews, and
short action summaries. Use `skillboard brief --verbose` when an operator needs
the full list or full copyable command details. Agents should still run
`skillboard guard use ...` immediately before an actual skill invocation. A
passing guard is not a user prompt; the agent should disclose the selected skill
at the start and completion, and ask only if the guard denies use or a
policy-changing action is needed.

When the user asks which skill fits a task, the bridge tells agents to use
`skillboard brief --intent <request> --json`, read `assistant_guidance.route`,
and use `recommended_skill`, `fallback_skills`, `route_candidates`,
`post_use_policy_suggestion`, and `guard_command` instead of guessing from raw
skill text. Inspect
`route_candidates` when several skills match so denied candidates and selected
fallbacks are clear. If `post_use_policy_suggestion` is present, the agent
should use the allowed routed skill first, then ask after completion whether to
remember the suggested policy. If no skill matches, the agent should ask a
clarifying question before choosing a skill.

Action cards are change suggestions. Before an agent applies one that changes
policy, trust, hooks, reset state, or skill references, it should request user
confirmation for one current action id from the brief. After confirmation, it should run
`skillboard apply-action <action-id> --config skillboard.config.yaml --skills skills --yes --json`
with `--workflow <name>` when a workflow is selected. It should then read the
returned post-apply brief before answering another availability question or
applying another action card. `apply-action` re-resolves current action cards,
so stale action ids and cached action-card shell text are not replayed.
For hook action cards specifically, keep `apply-action` as the action-card
primary flow. Raw `skillboard hook install ... --dry-run --json` previews and
the matching non-dry-run command are underlying manual detail for operators who
need to inspect or materialize an executable guard hook directly. Generated hooks
pin the install-time SkillBoard command, config, skills root, and workflow; set
those values with hook install options such as `--skillboard-bin`, not with
runtime environment overrides.

## Hermes System Prompt Bridge

Hermes does not automatically read `AGENTS.md` or `CLAUDE.md`. If you want a
Hermes profile to follow SkillBoard policy, add this bridge to the profile or
system prompt for the managed project:

```text
Use SkillBoard as the source of truth for agent skill availability.
Use the workflow generated by init, such as `hermes-codex-local-manual`, or a
workflow you explicitly created for that Hermes profile.

Before answering what skills can be used in that workflow, run:
skillboard brief --workflow <workflow-name> --json --include-actions --dir /path/to/your/project

When the user asks which skill fits a task, run:
skillboard brief --workflow <workflow-name> --intent <request> --json --dir /path/to/your/project
Read assistant_guidance.route. Use recommended_skill, fallback_skills,
route_candidates, post_use_policy_suggestion, and guard_command. Inspect
route_candidates when several skills match so denied candidates and selected
fallbacks are clear. If post_use_policy_suggestion is present, use the allowed
routed skill first, then ask after completion whether to remember the suggested
policy. If no skill matches, ask a clarifying question before choosing a skill.

Do not infer availability from installed SKILL.md files. Immediately before
invoking a skill, run:
skillboard guard use <skill-id> --workflow <workflow-name> --dir /path/to/your/project

If the guard allows an already-approved skill, do not ask the user for another
approval. Say at the start: "I will use <skill-id> for this request." Say at
completion: "I used <skill-id> for this request." Treat that disclosure as an
audit trace, not a permission prompt.

For suggested policy changes, ask the user to approve one current action id from
the `--include-actions` brief, then run:
skillboard apply-action <action-id> --workflow <workflow-name> --dir /path/to/your/project --yes --json
```

After installing a new local agent skill pack, plugin, workflow bundle, or
harness, rescan before enabling anything:

```bash
skillboard inventory refresh --dir /path/to/your/project --dry-run
skillboard inventory refresh --dir /path/to/your/project
```

The refresh command reuses the init scanner. If no workflows exist yet, trusted
user-local skills are attached to a generated local manual workflow. If workflows
already exist, those skills are imported as manual-only candidates with a review
note instead of being attached to an arbitrary workflow. Runtime components
remain attached to the owning install unit for review, and non-user runtime
skills stay out of automatic use until a source/workflow decision is recorded.
Dry-run output includes a capped YAML semantic change list, while broken
detector entries or malformed `SKILL.md` files are surfaced as scan warnings
instead of aborting the whole refresh.

Add a new workflow or harness without editing YAML by hand:

```bash
skillboard add harness codex --config skillboard.config.yaml --skills skills
skillboard add workflow daily-workflow \
  --harness codex \
  --skill user.helper \
  --config skillboard.config.yaml \
  --skills skills
```

If an installer mutates runtime config without a manifest, parse its output and
the mutated config files into the owning install unit before enabling anything:

```bash
skillboard inventory detect \
  --unit acme.runtime \
  --config /path/to/your/project/skillboard.config.yaml \
  --install-output /path/to/install.log \
  --config-file ~/.codex/config.toml \
  --dry-run
```

The detector records discovered commands, hooks, MCP servers, and modified
config files under `install_units.<id>`, then updates `permission_risk` from the
detected runtime surface.

For fetchable Git sources, refresh the project cache and digest pin before
writing a lockfile:

```bash
skillboard sources refresh --dir /path/to/your/project --unit github.mattpocock.skills --dry-run
skillboard sources refresh --dir /path/to/your/project --unit github.mattpocock.skills
skillboard audit sources \
  --config /path/to/your/project/skillboard.config.yaml \
  --skills /path/to/your/project/skills \
  --verify
```

`sources refresh` supports direct Git URLs, `git clone <url>` command strings,
GitHub `org/repo` shorthands, and `file://` Git remotes. It writes the refreshed
checkout under `.skillboard/sources/<install-unit-id>`, updates `cache_path`,
`source_digest`, and `verified_at`, and leaves the config untouched on dry-run.

## Uninstall From A Project

Package removal and project cleanup are intentionally separate. `npm uninstall
-g agent-skillboard` removes the CLI package, but it does not edit a project.
Use the project cleanup command when you want to remove the bridge files created
by init:

```bash
skillboard uninstall --dir /path/to/your/project --dry-run
skillboard uninstall --dir /path/to/your/project
```

Default uninstall behavior is conservative:

- removes only the `BEGIN SKILLBOARD` / `END SKILLBOARD` bridge block from
  `AGENTS.md` and `CLAUDE.md`;
- deletes a bridge file only when it has no user content left;
- deletes `.skillboard/profiles/README.md` and `.skillboard/hooks/README.md`
  only when they still exactly match the generated text;
- removes empty generated directories;
- preserves `skillboard.config.yaml`, local skill files, reports, generated guard
  hooks, and modified files by default. Empty generated directories can be
  removed.

Use `--purge` when you want SkillBoard's influence removed from the project
instead of merely disconnecting the bridge:

```bash
skillboard uninstall --dir /path/to/your/project --purge --dry-run
skillboard uninstall --dir /path/to/your/project --purge
```

`--purge` removes SkillBoard config, bridge blocks, and the entire
`.skillboard/` project state directory, including reports, hooks, source caches,
rollout logs, variant snapshots, and profiles. It preserves local `skills/`
files because skills that were created or deleted are outside the uninstall
scope.

Use `--remove-config` to delete `skillboard.config.yaml` only when it still
matches the untouched default config. If the config contains scanned skills or
user edits, uninstall preserves it and reports it under `Preserved`.

Use `--reset-config` only when you intentionally want to discard the current
SkillBoard policy state and run `skillboard init` again from a fresh lifecycle.
This removes `skillboard.config.yaml` even when it contains imported skills or
workflow edits, but it still preserves local `skills/` files, reports, and
user-authored bridge content.

Add `--remove-reports` when a test reset should also delete generated
`.skillboard/reports/` output. This flag is explicit because reports may contain
review notes or other user-authored context. Local `skills/` files are still
preserved.

Add `--remove-hooks` only when a reset should also delete the entire
`.skillboard/hooks/` directory contents. This is explicit because hook scripts
may be wired into local agent/runtime configuration. Combine `--reset-config`,
`--remove-reports`, and `--remove-hooks` for a clean test reset that removes
the most common SkillBoard-owned lifecycle scaffolding while preserving local
`skills/`. Use `--purge` instead when no `.skillboard/` project state should
remain at all.

## Upper-Layer Control

After installing skill packs or harness bundles, represent them as install
units:

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/mattpocock-skills \
  --out .skillboard/reports/mattpocock-import.yaml
```

The import output is a reviewable YAML fragment. Merge the accepted `skills` and
`install_units` into `skillboard.config.yaml`; imported skills stay inactive
until workflows and policies explicitly use them.

For a direct but still safe apply path:

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/mattpocock-skills \
  --config skillboard.config.yaml \
  --merge \
  --dry-run
```

`--merge` refuses to overwrite existing `skills` or `install_units`. Add
`--replace` only when you intentionally want the imported source profile to
replace those entries. The merge uses a structured YAML writer that keeps normal
comments and ordering where possible, but review the diff before committing
hand-edited formatting. Drop `--dry-run` only after the reported text and YAML
semantic change plan is acceptable.

After reviewing source ownership, expected components, and risk, record the
install-unit trust decision without editing YAML by hand:

```bash
skillboard review install-unit github.mattpocock.skills \
  --trust-level reviewed \
  --config skillboard.config.yaml \
  --skills skills
```

Automatic invocation remains blocked for unreviewed non-user sources. The user
experience should still be a one-time decision queue: review, trust, or block
the install unit once, activate only the needed quarantined skills as
manual-only, then revisit only when the source, skill, or workflow changes.

```yaml
install_units:
  github.mattpocock.skills:
    kind: marketplace
    source: npx skills@latest add mattpocock/skills
    scope: user-global
    provided_components:
      - skills
    components:
      skills:
        - matt.tdd
```

Then link each governed skill back to its owner:

```yaml
skills:
  matt.tdd:
    path: matt/tdd
    status: active
    invocation: workflow-auto
    exposure: exported
    owner_install_unit: github.mattpocock.skills
```

Run:

```bash
skillboard check --config skillboard.config.yaml --skills skills
skillboard dashboard --config skillboard.config.yaml --skills skills --out .skillboard/reports/skill-map.md
```

This keeps multiple installed repositories visible as managed units instead of
turning every skill into a global invocation candidate.

## Adapter Direction

Import support should be profile-driven, not hardcoded. A popular source such as
`mattpocock/skills` or `oh-my-openagent` may ship with a built-in source profile,
but that profile should be data that maps repository layout and defaults into the
same install-unit model. Source-specific code should be limited to detector
plugins for layouts that cannot be described declaratively.

See [adapters.md](adapters.md).
