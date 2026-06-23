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
- Agent runtime install-unit inventory.
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
skillboard import --profile github.mattpocock.skills --source-root /path/to/mattpocock-skills
skillboard import --profile github.mattpocock.skills --source-root /path/to/mattpocock-skills --config skillboard.config.yaml --merge
skillboard check --config skillboard.config.yaml --skills skills
```

Install from a clone:

```bash
git clone <your-skillboard-repo-url>
cd skillboard
npm install
npm test
npm link
skillboard init
```

`skillboard init` creates `skillboard.config.yaml`, `skills/`,
`.skillboard/reports/`, `.skillboard/profiles/`, `AGENTS.md`, and `CLAUDE.md`.
The agent bridge files tell Codex-style and Claude Code agents to use
`skillboard.config.yaml` as the control-plane source of truth instead of treating
every installed `SKILL.md` as active.

Run the bundled examples:

```bash
node bin/skillboard.mjs dashboard \
  --config examples/skillboard.config.yaml \
  --skills examples/skills \
  --out reports/skill-map.md

node bin/skillboard.mjs import \
  --profile github.mattpocock.skills \
  --source-root /path/to/mattpocock-skills \
  --out reports/mattpocock-import.yaml

node bin/skillboard.mjs import \
  --profile github.mattpocock.skills \
  --source-root /path/to/mattpocock-skills \
  --config skillboard.config.yaml \
  --merge

node bin/skillboard.mjs impact disable matt.tdd \
  --config examples/skillboard.config.yaml \
  --skills examples/skills

node bin/skillboard.mjs reconcile \
  --config examples/skillboard.config.yaml \
  --skills examples/skills \
  --actual-harnesses codex,claude \
  --out reports/reconcile-plan.md

node bin/skillboard.mjs check \
  --config examples/multi-source.config.yaml \
  --skills examples/multi-source-skills

node bin/skillboard.mjs dashboard \
  --config examples/multi-source.config.yaml \
  --skills examples/multi-source-skills \
  --out reports/multi-source-skill-map.md
```

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

To apply the fragment directly, pass `--merge --config`. Merge is
non-destructive by default: if a skill or install-unit id already exists, the
command fails and leaves the config unchanged. Use `--replace` only when you
intend to overwrite existing entries.

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/cloned-or-installed/repo \
  --config skillboard.config.yaml \
  --merge
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

## Commands

```bash
skillboard init [--dir <path>]
skillboard import --profile <id-or-path> --source-root <dir> [--profile-dirs a,b] [--out <path>]
skillboard import --profile <id-or-path> --source-root <dir> --config <path> --merge [--replace]
node bin/skillboard.mjs scan --config <path> --skills <dir>
node bin/skillboard.mjs check --config <path> --skills <dir>
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
risk, and rollback shape. LazyCodex-style setups fit this model as
user-global harness/plugin bundles that provide commands, skills, MCP
integrations, hooks, and config.

## Positioning

SkillBoard is not a replacement for installers such as `skillshare` or package
managers such as APM. It is the governance layer above them: it decides what is
active, what is blocked, and what a user should inspect before changing the skill
set.

See [docs/install.md](docs/install.md) for install and bootstrap details.

See [docs/positioning.md](docs/positioning.md) and
[docs/policy-model.md](docs/policy-model.md). See
[docs/adapters.md](docs/adapters.md) for the source-profile adapter model, and
[docs/versioning.md](docs/versioning.md) for release, schema, profile, workflow,
and future lockfile versioning rules.
