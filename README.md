# SkillBoard

Workflow-scoped control and reconciliation for AI agent skills.

SkillBoard is a small policy layer for people who already have skill installers,
plugin marketplaces, skill folders, or package managers, but still cannot answer
the operational question that matters most:

> Which skills can run in this workflow, why, and what breaks if I remove one?

It treats installed skills and active skills as different states. A skill can be
present in a repository without being eligible for model invocation. Workflows
choose the active pool, invocation modes make automatic use explicit, and the
reconciler turns skill or harness drift into safe defaults plus a short list of
decisions that actually need user approval.

## Why This Exists

Agent skill tooling is moving fast. `skillshare` is good at syncing skills across
agent targets. Microsoft APM focuses on reproducible agent context from a
manifest and lockfile. Security scanners such as SkillGate/SkillGuard focus on
trust and risk.

SkillBoard is deliberately narrower:

- Deny automatic invocation by default.
- Activate skills per workflow, not globally.
- Separate installed, active, manual-only, router-only, workflow-auto, blocked,
  and deprecated states.
- Quarantine newly discovered skills instead of auto-enabling them.
- Treat harness additions/removals as migration events, not silent breakage.
- Track capabilities so workflows can depend on roles instead of only skill ids.
- Track install units so plugin bundles, package-manager dependencies, harnesses,
  MCP servers, hooks, agents, and LSPs are not flattened into skill names.
- Keep user-added global skills limited to explicit `global-meta` skills such as
  routers, impact analyzers, and verification gates.
- Show a human-readable skill map before users add or remove skills.
- Report impact before disabling a skill.

## MVP Status

This repository is an early CLI-first foundation. It currently supports:

- YAML policy config parsing.
- Recursive `SKILL.md` discovery.
- Source-profile import for cloned or installed skill repositories.
- Capability and harness config parsing.
- Agent runtime install-unit inventory, including Codex plugin skills, hooks,
  MCP servers, commands, and modified config files when manifest metadata is
  available.
- Strong reference checks for workflows, skills, capabilities, harnesses, and
  install units.
- Semantic policy checks for workflow-scoped auto invocation, canonical skill
  claims, conflicts, status/invocation combinations, and install-unit component
  declarations.
- Markdown dashboard generation.
- Disable-impact analysis.
- Reconcile plan generation for new skills, new harnesses, and removed
  harnesses.

## Quick Start

Install from npm after the package is published:

```bash
npm install -g agent-skillboard
skillboard init
skillboard doctor
skillboard inventory refresh --dry-run
skillboard import --profile github.mattpocock.skills --source-root /path/to/mattpocock-skills
skillboard import --profile github.mattpocock.skills --source-root /path/to/mattpocock-skills --config skillboard.config.yaml --merge --dry-run
skillboard check --config skillboard.config.yaml --skills skills
skillboard rollout audit --config skillboard.config.yaml --skills skills --json
skillboard rollout plan --config skillboard.config.yaml --skills skills --json
```

Install from a clone:

```bash
git clone <your-skillboard-repo-url>
cd skillboard
npm install
npm test
npm link
skillboard init
skillboard doctor
```

`skillboard init` creates `skillboard.config.yaml`, `skills/`,
`.skillboard/reports/`, `.skillboard/profiles/`, `AGENTS.md`, and `CLAUDE.md`.
It also scans known local agent skill roots, including Codex user/system skills
and Codex plugin-cache manifests. Trusted user-local skills are imported as
`active-manual` and attached to a generated local manual workflow when the
project has no workflow metadata yet, so a first-time user can immediately use
their own manual skills through `can-use` and guard checks. System, plugin, and
other runtime-supplied skills stay `quarantined` / `blocked`; plugin hooks, MCP
servers, commands, and modified config files are attached to the owning install
unit for review. The agent bridge files tell Codex-style and Claude Code agents
to use `skillboard.config.yaml` as the control-plane source of truth instead of
treating every installed `SKILL.md` as active.

Run `skillboard doctor` after init to see config health, bridge status, managed
skill/install-unit counts, policy/source audit summaries, and the default
uninstall dry-run plan. The default doctor command passes when the workspace is
usable but has review-needed safe-mode warnings; add `--strict` when those
warnings should fail automation. Add `--json` when an agent or script needs the
same information as structured output. `skillboard status` returns the same
health report for users and agents that prefer a shorter command name.

See [docs/user-flow.md](docs/user-flow.md) for the first-time flow that covers
adding a local skill, inspecting its influence, activating/blocking it, and
removing SkillBoard policy references without deleting the underlying
`SKILL.md`.

Run `skillboard inventory refresh --dry-run` after installing a new local agent
skill pack, plugin, workflow bundle, or harness. It reuses the same scanner as
init and reports the text and YAML semantic config change plan. If the project
has no workflows yet, newly discovered trusted user-local skills are attached to
a generated manual workflow; if workflows already exist, those skills are kept as
manual-only candidates and the refresh prints a review note to attach them with
`skillboard add workflow`. Runtime or external skills remain quarantined /
blocked until a workflow explicitly activates them. Broken detector entries or
malformed `SKILL.md` files are reported as scan warnings instead of aborting the
whole refresh.

Add new local growth paths without hand-editing YAML:

```bash
skillboard add harness codex --config skillboard.config.yaml --skills skills
skillboard add workflow daily-workflow --harness codex --skill user.helper --config skillboard.config.yaml --skills skills
```

When an installer writes runtime settings without a manifest, capture that
surface explicitly:

```bash
skillboard inventory detect --unit acme.runtime --config skillboard.config.yaml --install-output install.log --config-file ~/.codex/config.toml --dry-run
```

For fetchable Git sources, refresh the local cache and digest pin before writing
a lockfile:

```bash
skillboard sources refresh --config skillboard.config.yaml --unit github.mattpocock.skills --dry-run
skillboard sources refresh --config skillboard.config.yaml --unit github.mattpocock.skills
```

To remove the project bridge safely:

```bash
skillboard uninstall --dry-run
skillboard uninstall
```

`skillboard uninstall` removes only SkillBoard bridge blocks and unchanged
generated helper files by default. It preserves `skillboard.config.yaml`, local
skills, reports, and any user content in `AGENTS.md` or `CLAUDE.md`. Add
`--remove-config` only when you want to delete an untouched default config.

Run the bundled examples from the repository root:

```bash
npm install
npm run check
node bin/skillboard.mjs check \
  --config examples/multi-source.config.yaml \
  --skills examples/multi-source-skills
node bin/skillboard.mjs list skills \
  --config examples/multi-source.config.yaml \
  --skills examples/multi-source-skills \
  --workflow codex-night-workflow
node bin/skillboard.mjs explain private.tdd-work-continuity \
  --config examples/multi-source.config.yaml \
  --skills examples/multi-source-skills
node bin/skillboard.mjs can-use matt.tdd \
  --workflow codex-night-workflow \
  --config examples/multi-source.config.yaml \
  --skills examples/multi-source-skills
node bin/skillboard.mjs audit sources --verify \
  --config examples/multi-source.config.yaml \
  --skills examples/multi-source-skills
mkdir -p .skillboard/reports
node bin/skillboard.mjs lock write \
  --config examples/multi-source.config.yaml \
  --skills examples/multi-source-skills \
  --out .skillboard/reports/multi-source.lock.yaml \
  --replace
node bin/skillboard.mjs hook install \
  --workflow codex-night-workflow \
  --config examples/multi-source.config.yaml \
  --skills examples/multi-source-skills \
  --out .skillboard/reports/codex-night-guard.sh \
  --skillboard-bin "node bin/skillboard.mjs"
```

The multi-source example intentionally uses project-root-relative local paths,
such as `./examples/multi-source-skills/private`, so a fresh clone can run these
commands without editing machine-specific paths.

## Config Shape

```yaml
version: 1

defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true

skills:
  matt.tdd:
    path: tdd
    status: active
    invocation: workflow-auto
    exposure: exported
    category: engineering

  user.workflow-router:
    path: user/workflow-router
    status: active
    invocation: global-auto
    exposure: global-meta
    category: meta

capabilities:
  test-first-implementation:
    canonical: matt.tdd
    alternatives:
      - meerkat.test-first-implementation
    default_policy: workflow-auto

harnesses:
  codex:
    status: primary
    workflows:
      - codex-night-workflow

install_units:
  lazycodex.omo:
    kind: harness
    source: npx lazycodex-ai install
    scope: user-global
    manifest_path: ~/.codex/plugins/cache/sisyphuslabs/omo/plugin.json
    cache_path: ~/.codex/plugins/cache/sisyphuslabs/omo
    provided_components:
      - skills
      - commands
      - mcp-server
      - hook
    components:
      skills:
        - lazycodex.ulw-plan
      commands:
        - $ulw-plan
        - $start-work
      hooks:
        - post-tool-use
      mcp_servers:
        - omo-docs
    modified_config_files:
      - ~/.codex/config.toml
      - ~/.local/bin
    auto_update: false
    enabled: true
    workflow_dependencies:
      - large-refactor-workflow
    permission_risk: high
    rollback: manual

workflows:
  codex-night-workflow:
    harness: codex
    active_skills:
      - matt.tdd
    blocked_skills: []
    required_capabilities:
      test-first-implementation:
        preferred: matt.tdd
        fallback:
          - meerkat.test-first-implementation
        policy: workflow-auto
```

## Source Profiles

`skillboard import` reads a source profile and emits a YAML fragment containing
governed `skills` plus their owning `install_units`.

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/cloned-or-installed/repo \
  --out .skillboard/reports/import-fragment.yaml
```

To preview a direct apply path, pass `--merge --config --dry-run`. Merge is
non-destructive by default: if a skill or install-unit id already exists, the
command fails and leaves the config unchanged. Use `--replace` only when you
intend to overwrite existing entries, and drop `--dry-run` only after reviewing
the reported change plan.

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/cloned-or-installed/repo \
  --config skillboard.config.yaml \
  --merge \
  --dry-run
```

Built-in profiles are shipped as YAML data under `profiles/`, including:

- `github.mattpocock.skills`
- `github.code-yeongyu.oh-my-openagent`
- `github.anthropics.skills`
- `github.wshobson.agents`
- `github.voltagent.awesome-agent-skills`

Project-specific profiles can live under `.skillboard/profiles/` and be passed
by path:

```bash
skillboard import --profile .skillboard/profiles/my-source.yaml --source-root /path/to/repo
```

Invocation modes:

- `manual-only`: user must explicitly ask for it.
- `router-only`: a router/orchestrator may select it after policy checks.
- `workflow-auto`: model invocation is allowed only inside listed workflows.
- `global-auto`: allowed globally; use sparingly.
- `blocked`: installed but never callable.
- `deprecated`: kept for history, not for new use.

Skill exposure:

- `exported`: centrally governed skill that may serve shared workflows or
  canonical capabilities.
- `global-meta`: intentionally global control skill, such as a router,
  impact analyzer, or verification gate. This is the only exposure that may use
  `global-auto`.
- `unit-managed`: child component supplied by a parent install unit or harness
  bundle.
- `private`: workflow-internal implementation detail; central governance should
  avoid managing it unless it becomes shared.

`owner_install_unit` links a declared skill back to the package, plugin,
marketplace, harness, or local source that supplied it. SkillBoard checks this
both ways: install-unit `components.skills` must reference declared skills, and a
skill that names an owner must be listed by that owner. `unit-managed` skills
must always declare an owner.

The multi-source example in `examples/multi-source.config.yaml` models one
private skill source plus five external repositories:

- `mattpocock/skills`
- `code-yeongyu/oh-my-openagent`
- `anthropics/skills`
- `wshobson/agents`
- `VoltAgent/awesome-agent-skills`

Run the example commands from the repository root. Local example sources are
written as project-root-relative paths; fetchable Git sources can be cached and
pinned with `skillboard sources refresh`.

## Commands

```bash
skillboard init [--dir <path>] [--scan-root <dir>[,<dir>]] [--no-scan-installed]
skillboard uninstall [--dir <path>] [--dry-run] [--remove-config] [--keep-empty-dirs]
skillboard inventory refresh [--dir <path>] [--config <path>] [--scan-root <dir>[,<dir>]] [--dry-run] [--json]
skillboard inventory detect --unit <id> --config <path> [--install-output <path>] [--config-file a,b] [--source <value>] [--kind <kind>] [--scope <scope>] [--dry-run] [--json]
skillboard sources refresh [--dir <path>] [--config <path>] [--unit <id>[,<id>]] [--cache-dir <dir>] [--dry-run] [--json]
skillboard doctor [--dir <path>] [--config <path>] [--skills <dir>] [--verify] [--strict] [--json]
skillboard status [--dir <path>] [--config <path>] [--skills <dir>] [--verify] [--strict] [--json]
skillboard import --profile <id-or-path> --source-root <dir> [--profile-dirs a,b] [--out <path>]
skillboard import --profile <id-or-path> --source-root <dir> --config <path> --merge [--replace] [--dry-run]
node bin/skillboard.mjs scan --config <path> --skills <dir>
node bin/skillboard.mjs check --config <path> --skills <dir>
node bin/skillboard.mjs list [skills|workflows|harnesses|install-units] --config <path> --skills <dir>
node bin/skillboard.mjs explain <skill-id> --config <path> --skills <dir>
node bin/skillboard.mjs can-use <skill-id> --workflow <name> --config <path> --skills <dir>
node bin/skillboard.mjs guard use <skill-id> --workflow <name> --config <path> --skills <dir>
node bin/skillboard.mjs audit sources --config <path> --skills <dir> [--verify]
skillboard rollout [audit|plan|apply|rollback|report] [--dir <path>] [--config <path>] [--skills <dir>] [--transaction <id>] [--json]
node bin/skillboard.mjs hook install --workflow <name> --config <path> --skills <dir> [--out <path>]
node bin/skillboard.mjs lock write --config <path> --skills <dir> [--out <path>] [--replace] [--allow-unverified]
node bin/skillboard.mjs add skill <skill-id> --path <relative-skill-path> --config <path> --skills <dir>
node bin/skillboard.mjs add workflow <workflow-name> --harness <harness-name> --config <path> --skills <dir> [--skill <id>[,<id>]]
node bin/skillboard.mjs add harness <harness-name> --config <path> --skills <dir> [--status <status>] [--command <cmd>[,<cmd>]]
node bin/skillboard.mjs activate <skill-id> --workflow <name> --config <path> --skills <dir>
node bin/skillboard.mjs block <skill-id> --workflow <name> --config <path> --skills <dir>
node bin/skillboard.mjs quarantine <skill-id> --config <path> --skills <dir>
node bin/skillboard.mjs prefer <skill-id> --workflow <name> --capability <name> --config <path> --skills <dir>
node bin/skillboard.mjs remove skill <skill-id> --config <path> --skills <dir> [--force]
node bin/skillboard.mjs dashboard --config <path> --skills <dir> [--out <path>]
node bin/skillboard.mjs reconcile --config <path> --skills <dir> [--actual-harnesses a,b] [--out <path>]
node bin/skillboard.mjs impact disable <skill-id> --config <path> --skills <dir> [--out <path>]
```

## Reconciliation Model

SkillBoard compares desired state from config with actual state from discovered
`SKILL.md` files and detected harnesses.

- New skills become `quarantined` / `blocked` recommendations.
- Known capability matches are surfaced, but not auto-enabled.
- Removed harnesses report affected workflows, missing commands, and migration
  recommendations.
- Newly detected harnesses are disabled until workflows explicitly opt in.
- If actual harness inventory is not provided, reconcile emits a warning instead
  of silently assuming harness state.

## Install Units

SkillBoard should not assume that every runtime change is a standalone skill.
Modern agent environments increasingly install packaged primitives:

- `skill`
- `plugin`
- `marketplace`
- `package-manager-dependency`
- `harness`
- `mcp-server`
- `hook`
- `agent`
- `lsp`

An install unit records source, scope, manifest/cache paths, provided
components, modified config files, enablement, workflow dependencies, permission
risk, trust level, digest/signature pins, and rollback shape. LazyCodex-style setups fit this model as
user-global harness/plugin bundles that provide commands, skills, MCP
integrations, hooks, and config.

## Positioning

SkillBoard is not a replacement for installers such as `skillshare` or package
managers such as APM. It is the governance layer above them: it decides what is
active, what is blocked, and what a user should inspect before changing the skill
set.

See [docs/install.md](docs/install.md) for install and bootstrap details.

See [docs/user-flow.md](docs/user-flow.md),
[docs/positioning.md](docs/positioning.md), and
[docs/policy-model.md](docs/policy-model.md). See
[docs/adapters.md](docs/adapters.md) for the source-profile adapter model, and
[docs/versioning.md](docs/versioning.md) for release, schema, profile, workflow,
and lockfile versioning rules.
