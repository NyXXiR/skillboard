# SkillBoard Reference

This is the operator reference for users who already understand the basic
SkillBoard flow and need exact command, config, and lifecycle details.

For installation and bootstrap commands, start with [install.md](install.md).
For a guided first workflow, use [user-flow.md](user-flow.md).

## Command Forms

Most examples use the global `skillboard` binary. When running from a clone
without `npm install -g agent-skillboard`, replace `skillboard ` with
`node bin/skillboard.mjs ` and run from the repository root.

The npm package is `agent-skillboard`; the executable remains `skillboard`.
For CI or scripts, the explicit package form avoids binary-name ambiguity:

```bash
npx --yes --package agent-skillboard skillboard init
npx --yes --package agent-skillboard skillboard doctor --summary
npx --yes --package agent-skillboard skillboard brief --workflow <workflow-from-init>
npm exec --yes --package agent-skillboard -- skillboard init
npm exec --yes --package agent-skillboard -- skillboard doctor --summary
npm exec --yes --package agent-skillboard -- skillboard brief --workflow <workflow-from-init>
```

After a global install, postinstall auto-runs agent-layer setup for detected
supported agent homes. Use `skillboard setup` later when you add another
supported agent, skipped lifecycle scripts, or need to repair user-level agent
guidance. This is agent-layer integration; it does not initialize, attach, or
manage individual projects. To remove only managed agent-layer guidance, run
`skillboard uninstall --agent-layer` before package removal.

If `init` does not print a workflow, run the unscoped `brief` command it prints
instead.

Unreleased GitHub builds are available when intentionally testing repository
state before the next npm release:

```bash
npx --yes --package github:NyXXiR/skillboard skillboard init
npx --yes --package github:NyXXiR/skillboard skillboard doctor --summary
npx --yes --package github:NyXXiR/skillboard skillboard brief --workflow <workflow-from-init>
```

From a source clone:

```bash
git clone https://github.com/NyXXiR/skillboard.git
cd skillboard
npm install
npm test
node bin/skillboard.mjs init --dir /path/to/your/project
node bin/skillboard.mjs doctor --dir /path/to/your/project --summary
node bin/skillboard.mjs brief --dir /path/to/your/project --workflow <workflow-from-init>
```

## Commands

```bash
skillboard setup [--yes] [--agent codex[,claude,opencode,hermes]]
skillboard import-skill --from <agent> --to <agent> --skill <id-or-dir> [--target-skill <id-or-dir>] [--adapted-file <path>] [--dry-run] [--yes] [--replace] [--json]
skillboard init [--dir <path>] [--scan-root <dir>[,<dir>]] [--no-scan-installed]
skillboard uninstall [--dir <path>] [--dry-run] [--keep-settings] [--purge] [--remove-config|--reset-config] [--remove-reports] [--remove-hooks] [--keep-empty-dirs] [--agent-layer] [--agent codex[,claude,opencode,hermes]]
skillboard inventory refresh [--dir <path>] [--config <path>] [--scan-root <dir>[,<dir>]] [--dry-run] [--json]
skillboard inventory detect --unit <id> --config <path> [--install-output <path>] [--config-file a,b] [--source <value>] [--kind <kind>] [--scope <scope>] [--dry-run] [--json]
skillboard sources refresh [--dir <path>] [--config <path>] [--unit <id>[,<id>]] [--cache-dir <dir>] [--dry-run] [--json]
skillboard doctor [--dir <path>] [--config <path>] [--skills <dir>] [--verify] [--strict] [--json] [--summary]
skillboard status [--dir <path>] [--config <path>] [--skills <dir>] [--verify] [--strict] [--json] [--summary]
skillboard brief [--workflow <name>] [--intent <request>] [--dir <path>] [--config <path>] [--skills <dir>] [--include-actions] [--verbose] [--json]
skillboard apply-action <action-id> [--workflow <name>] [--dir <path>] [--config <path>] [--skills <dir>] [--dry-run] [--yes] [--allow-destructive] [--json]
skillboard import --profile <id-or-path> --source-root <dir> [--profile-dirs a,b] [--out <path>]
skillboard import --profile <id-or-path> --source-root <dir> --config <path> --merge [--replace] [--dry-run]
skillboard scan --config <path> --skills <dir>
skillboard check --config <path> --skills <dir>
skillboard list [skills|workflows|harnesses|install-units] --config <path> --skills <dir>
skillboard explain <skill-id> --config <path> --skills <dir>
skillboard route <intent> --workflow <name> --config <path> --skills <dir> [--json]
skillboard can-use <skill-id> --workflow <name> --config <path> --skills <dir>
skillboard guard use <skill-id> --workflow <name> --config <path> --skills <dir>
skillboard audit sources --config <path> --skills <dir> [--verify]
skillboard rollout [audit|plan|apply|rollback|report] [--dir <path>] [--config <path>] [--skills <dir>] [--transaction <id>] [--json]
skillboard hook install --workflow <name> --config <path> --skills <dir> [--out <path>] [--skillboard-bin <path>] [--dry-run] [--json]
skillboard lock write --config <path> --skills <dir> [--out <path>] [--replace] [--allow-unverified]
skillboard review install-unit <unit-id> [--trust-level trusted|reviewed|unreviewed|blocked] --config <path> --skills <dir>
skillboard add skill <skill-id> --path <relative-skill-path> --config <path> --skills <dir>
skillboard add workflow <workflow-name> --harness <harness-name> --config <path> --skills <dir> [--skill <id>[,<id>]]
skillboard add harness <harness-name> --config <path> --skills <dir> [--status <status>] [--command <cmd>[,<cmd>]]
skillboard variant add <variant-id> --from <base-id> --capability <name> --workflow <name> --config <path> --skills <dir> [--path <relative-skill-path>] [--mode manual-only|router-only|workflow-auto] [--category <name>] [--owner-install-unit <unit-id>] [--dry-run] [--json]
skillboard variant fork <variant-id> --from <base-id> --capability <name> --workflow <name> --path <relative-skill-path> --config <path> --skills <dir> [--adapted-for <label>] [--category <name>] [--owner-install-unit <unit-id>] [--dry-run] [--json]
skillboard variant status <variant-id> --config <path> --skills <dir> [--json]
skillboard variant approve <variant-id> --config <path> --skills <dir> [--mode manual-only|router-only|workflow-auto] [--dry-run] [--json]
skillboard variant reset <variant-id> --to-base|--to-approved --config <path> --skills <dir> [--yes] [--dry-run] [--mode manual-only|router-only|workflow-auto] [--json]
skillboard activate <skill-id> --workflow <name> --config <path> --skills <dir>
skillboard block <skill-id> --workflow <name> --config <path> --skills <dir>
skillboard quarantine <skill-id> --config <path> --skills <dir>
skillboard prefer <skill-id> --workflow <name> --capability <name> --config <path> --skills <dir>
skillboard remove skill <skill-id> --config <path> --skills <dir> [--force]
skillboard dashboard --config <path> --skills <dir> [--out <path>]
skillboard reconcile --config <path> --skills <dir> [--actual-harnesses a,b] [--out <path>]
skillboard impact disable <skill-id> --config <path> --skills <dir> [--out <path>] [--json]
```

## Agent Skill Reuse

`import-skill` operates above projects. It reads one supported agent's user
skill root and writes to another supported agent's user skill root:

```bash
skillboard import-skill --from codex --to opencode --skill test-first --json
skillboard import-skill --from codex --to opencode --skill test-first --yes --json
```

Supported agents are `codex`, `claude`, `opencode`, and `hermes`. Roots come
from `CODEX_HOME`, `AGENTS_HOME`, `CLAUDE_HOME`, `OPENCODE_HOME`, and
`HERMES_HOME`, or from their default user locations. Codex source scanning also
checks `~/.agents/skills` and `~/.codex/skills`.

If the source skill contains markers for another agent runtime, the command
returns `status: "needs-adaptation"` with compatibility reasons and no writes.
The target agent should ask the user before changing the skill body. After
approval, it writes an adapted `SKILL.md` and installs it with provenance:

```bash
skillboard import-skill \
  --from codex \
  --to opencode \
  --skill codex-hook \
  --target-skill opencode-hook \
  --adapted-file /tmp/opencode-hook.SKILL.md \
  --yes \
  --json
```

This is separate from `variant` commands. `import-skill` installs a target-agent
user skill file; `variant` records project-local policy relationships,
snapshots, and workflow preferences.

## Capability Routing

For the normal AI-mediated flow, prefer `brief --intent`: it returns the current
availability brief plus a compact route recommendation in `assistant_guidance`.

```bash
skillboard brief \
  --intent "write tests before implementation" \
  --workflow codex-night-workflow \
  --config skillboard.config.yaml \
  --skills skills \
  --json
```

`route` is a read-only recommendation surface for AI/automation. It maps a
normal user request to the best matching workflow capability or workflow-bound
skill metadata, then returns the recommended skill, fallback skills, matched
terms, recommendation reason, and the guard command that must still pass before
invocation.

```bash
skillboard route "write tests before implementation" \
  --workflow codex-night-workflow \
  --config skillboard.config.yaml \
  --skills skills \
  --json
```

Routing first honors an exact request for a specific already-allowed workflow
skill. Otherwise, it uses declared capability names and workflow bindings. If a
fresh project has workflow skills but no capability catalog yet, it can fall back
to workflow-bound skill id, path, category, `SKILL.md` name, and `SKILL.md`
description metadata. It does not inspect or semantically rank `SKILL.md` bodies,
and it does not invoke the skill. The JSON payload includes `match_source`,
`matched_terms`, `recommendation_reason`, `route_candidates`, and
`overlap_resolution` so the AI can explain why it chose or declined a skill
without inventing rationale. When remembered or configured workflow policy
selected the routed skill while other allowed skills were also available,
`policy_memory` tells the AI to disclose that after completion. The same
`assistant_guidance` object includes
`assistant_guidance.goal_document`; its `loop` and `simplification_rule` fields
make the non-blocking routing goal machine-readable for agent integrations.
Recommended and fallback skills are limited to the selected workflow's active,
required, or global-auto bindings rather than every global alternative in the
capability catalog. When nothing matches, the result keeps
`matched_capability: null` and `recommended_skill: null`, then returns possible
workflow skills so the AI can ask a clarifying question. When a guard allows the
recommended skill, the AI should disclose the skill at start and completion
instead of asking for another approval. That disclosure is an audit trace, not a
permission prompt. When several allowed skills match, `overlap_resolution`
explains that SkillBoard kept them available and routed the workflow to one
selected skill. When remembered or configured policy determines that route,
`policy_memory` keeps the final disclosure honest about why that skill was used.
When an allowed fallback is selected because the preferred skill is denied,
`post_use_policy_suggestion` tells the AI to ask after the task whether to
remember that fallback as the preferred workflow policy.

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
    conflicts_with:
      - meerkat.no-tests-please

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

`conflicts_with` is runtime policy, not documentation-only metadata. A workflow
cannot keep both sides selectable unless one side is explicitly blocked in that
workflow. Conflict failures appear in policy errors, guard reasons, brief
blocking reasons, and impact reports. `impact disable --json` includes:

- `conflictingSkills`: declared direct or reverse conflicts for the target
  skill.
- `activeConflicts`: workflow-scoped conflict pairs currently involving the
  target skill.

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

## Invocation Modes

- `manual-only`: user must explicitly ask for it.
- `router-only`: a router or orchestrator may select it after policy checks.
- `workflow-auto`: model invocation is allowed only inside listed workflows.
- `global-auto`: allowed globally; use sparingly and only for `global-meta`
  control skills.
- `blocked`: installed but not callable until policy or provenance changes.
- `deprecated`: kept for history, not for new use.

Skill exposure values:

- `exported`: centrally governed skill that may serve shared workflows or
  canonical capabilities.
- `global-meta`: intentionally global control skill, such as a router, impact
  analyzer, or verification gate.
- `unit-managed`: child component supplied by a parent install unit or harness
  bundle.
- `private`: workflow-internal implementation detail.

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
components, modified config files, enablement, workflow dependencies,
permission risk, trust level, digest/signature pins, and rollback shape.
LazyCodex-style setups fit this model as user-global harness/plugin bundles
that provide commands, skills, MCP integrations, hooks, and config.

## Variant Commands

Use `skillboard variant add claude.a --from a --capability task-review
--workflow claude-workflow --path claude/a ...` to record an explicit,
user-approved `a -> claude.a` variant.

For a reviewed manual adaptation lifecycle, use `skillboard variant fork
<variant-id>` to create draft metadata and raw snapshot records, edit the
variant `SKILL.md` by hand, inspect `skillboard variant status <variant-id>`
for `variant.status` and computed drift, then promote with `skillboard variant
approve <variant-id>` or restore with `skillboard variant reset <variant-id>
--to-base|--to-approved`.

SkillBoard records the relationship and policy only; it does not convert skill
bodies, does not rewrite skill bodies, and does not guarantee semantic
equivalence of skill bodies. See [variant-lifecycle.md](variant-lifecycle.md)
for the full lifecycle guide.

## Related Runbooks

- [install.md](install.md): install, init, doctor, bridge, refresh, and uninstall.
- [user-flow.md](user-flow.md): first-time skill governance workflow.
- [policy-model.md](policy-model.md): policy states, invocation modes, and install units.
- [capabilities.md](capabilities.md): capability catalog and workflow resolution.
- [rollout-runbook.md](rollout-runbook.md): rollout audit, apply, report, and rollback.
- [versioning.md](versioning.md): release, schema, profile, workflow, and lockfile versioning.
