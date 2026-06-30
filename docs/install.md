# Install And Bootstrap

SkillBoard sits one layer above skill installers, plugin marketplaces, harness
bundles, and local skill repositories.

After install, ask your AI questions like "what skills can you use in this
project?" or "can you make this reviewed skill available for the current
workflow?" The AI runs SkillBoard behind the scenes: it reads the current brief,
uses one current action id only after confirmation, and runs the guard before
actual skill use. You do not need to memorize the SkillBoard command loop.

## Install From npm

Use npx when you want to bootstrap a project without keeping a global
SkillBoard binary installed:

AI/automation/operator details:

```bash
npx agent-skillboard init
npx agent-skillboard brief
npx agent-skillboard doctor --summary
```

SkillBoard does not make installed skills automatically callable. It imports
trusted local skills as manual-only and keeps runtime/plugin skills quarantined
until reviewed.

In CI or scripts, use the explicit package/binary spelling:

```bash
npx --yes --package agent-skillboard skillboard init
npx --yes --package agent-skillboard skillboard doctor --summary
npm exec --yes --package agent-skillboard -- skillboard init
npm exec --yes --package agent-skillboard -- skillboard doctor --summary
```

For repeated local use, install the CLI globally:

AI/automation/operator details:

```bash
npm install -g agent-skillboard
skillboard init
skillboard doctor
```

The executable remains `skillboard` even though the npm package name is
`agent-skillboard`.

## Run Unreleased Builds From GitHub

Use GitHub npx only when you intentionally want the current repository state
before the next npm release:

AI/automation/operator details:

```bash
npx --yes --package github:NyXXiR/skillboard skillboard init
npx --yes --package github:NyXXiR/skillboard skillboard brief
npx --yes --package github:NyXXiR/skillboard skillboard doctor --summary
```

The equivalent `npm exec` spelling is explicit about the package and binary:

```bash
npm exec --yes --package github:NyXXiR/skillboard -- skillboard init
npm exec --yes --package github:NyXXiR/skillboard -- skillboard doctor --summary
```

## Install From A Clone

Use a clone when developing SkillBoard itself or testing unreleased changes:

AI/automation/operator details:

```bash
git clone https://github.com/NyXXiR/skillboard.git
cd skillboard
npm install
node bin/skillboard.mjs init --dir /path/to/your/project
node bin/skillboard.mjs brief --dir /path/to/your/project
node bin/skillboard.mjs doctor --dir /path/to/your/project --summary
```

## What init Does

`skillboard init` is the safe mutating step. npm installation itself does not
modify a project, but init creates the files that let agents discover the control
plane without a manual prompt and inventories already installed local agent
skills.

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
System, plugin, and other runtime-supplied skills are written with `status: quarantined` and
`invocation: blocked`. Plugin hooks, MCP servers, commands, and modified config files are
recorded on the owning install unit when manifest metadata exposes them, which
lets policy checks flag high-risk runtime extensions without flattening them
into loose skills. Use `--no-scan-installed` for a scaffold-only bootstrap, or
`--scan-root <dir>[,<dir>]` to add server-specific skill roots during bootstrap.

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
`skillboard guard use ...` immediately before an actual skill invocation.

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
need to inspect or materialize an executable guard hook directly.

## Hermes System Prompt Bridge

Hermes does not automatically read `AGENTS.md` or `CLAUDE.md`. If you want a
Hermes profile to follow SkillBoard policy, add this bridge to the profile or
system prompt for the managed project:

```text
Use SkillBoard as the source of truth for agent skill availability.
Before answering what skills can be used, run:
skillboard brief --json --dir /path/to/your/project

Do not infer availability from installed SKILL.md files. Immediately before
invoking a skill, run:
skillboard guard use <skill-id> --workflow <workflow-name> --dir /path/to/your/project

For suggested policy changes, ask the user to approve one current action id,
then run:
skillboard apply-action <action-id> --dir /path/to/your/project --yes --json
```

Use the workflow generated by init, such as `hermes-codex-local-manual`, or a
workflow you explicitly created for that Hermes profile.

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
SkillBoard-owned lifecycle scaffolding while preserving local `skills/`.

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
the install unit once, then revisit only when the source, skill, or workflow
changes.

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
