# Policy Model

SkillBoard separates storage from invocation.

## Skill States

- `installed`: discovered on disk from `SKILL.md`.
- `declared`: present in `skillboard.config.yaml`.
- `discovered`: present in actual state but not yet classified.
- `quarantined`: visible to the control plane but not callable.
- `active`: allowed in at least one workflow.
- `active` with `invocation: manual-only`: active only for direct user invocation.
- `active-manual`: legacy spelling accepted for compatibility.
- `active-router`: active only through a policy-checked router.
- `active-auto`: active for workflow-scoped automatic invocation.
- `candidate`: proposed for one or more workflows, pending approval.
- `canonical`: the preferred implementation for a capability.
- `vendor`: kept from an upstream source, but not automatically trusted.
- `blocked`: never callable.
- `deprecated`: kept for historical compatibility.
- `archived`: retained outside normal workflows.
- `removed`: absent from actual state but retained in history or lock data.

## Skill Exposure

Skill exposure controls whether a skill belongs in central governance or should
stay inside a workflow or install-unit boundary.

- `exported`: shared or externally visible skill governed by SkillBoard.
- `global-meta`: intentionally global control skill such as a workflow router,
  impact analyzer, skill registry, or verification gate.
- `unit-managed`: skill supplied by a parent plugin/harness install unit.
- `private`: workflow-internal implementation detail.

Only `global-meta` skills may use `global-auto`. This keeps a user's small set
of personal control skills globally available while plugin-provided skills remain
selected through workflows or install units.

Skills can also declare `owner_install_unit`. This points to the source that
introduced the skill, such as a private skill repository, GitHub marketplace,
package manager dependency, or harness installer. SkillBoard treats owner drift
as a policy error:

- `components.skills` entries must reference declared skills.
- A skill with `owner_install_unit` must be listed in that install unit's
  `components.skills`.
- A component skill cannot claim a different owner than the install unit listing
  it.
- `unit-managed` skills must declare `owner_install_unit`.

## Invocation Modes

- `manual-only`: direct user invocation only.
- `router-only`: selected by an approved routing skill or control layer.
- `workflow-auto`: eligible for model invocation only inside workflows that list
  the skill.
- `global-auto`: eligible everywhere. This should be rare.
- `blocked`: not callable even when installed.
- `deprecated`: not callable for new workflows.

## Default Policy

SkillBoard assumes:

```yaml
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
```

That means installation alone never implies automatic use.

`require_explicit_workflow: true` means a `workflow-auto` skill must be scoped by
at least one workflow, either through `active_skills` or a workflow capability
requirement. `allow_model_invocation: false` is not a blanket ban on
workflow-scoped automation; it means automatic invocation must come from an
explicit policy decision rather than installation.

## AI-Mediated Availability

`skillboard brief --json` is the AI-facing availability contract. It lets an
agent answer "What your AI can use now" with grouped facts from the control
plane instead of trusting installed `SKILL.md` text or inventing policy from the
filesystem. Human brief text separates reviewable friction from hard blocks:
"Needs your decision" means the user can make a source/skill/workflow decision
once, while "Blocked for safety" means policy or provenance must change before
the item is usable. The brief may include action cards when requested, but an
action card is only a suggestion. It does not authorize invocation and it does
not make unreviewed external skills safe for automatic use.

Risk-bearing action cards require user confirmation before apply. Any apply
that mutates policy, trust, hooks, reset state, or skill references makes the
previous brief stale, so the agent should rerun `skillboard brief --json` before
answering another availability question or applying another action card. The
runtime boundary remains `skillboard guard use ...`, run immediately before the
actual skill invocation.

## Workflow Activation

Workflows own active skill pools:

```yaml
workflows:
  codex-night-workflow:
    harness: codex
    active_skills:
      - meerkat.requirement-intake
      - matt.tdd
    blocked_skills:
      - matt.grill-me
```

The generated lockfile pins install-unit source/cache digests, skill content
digests, workflow bindings, and policy decisions.

## Capabilities

Workflows should depend on capabilities when possible, with skills acting as
implementations:

```yaml
capabilities:
  requirement-clarification:
    canonical: meerkat.requirement-intake
    alternatives:
      - matt.grill-me
      - matt.grill-with-docs
    default_policy: router-only
```

This lets SkillBoard suggest replacements when a skill is removed and group
overlapping skills by role instead of by name alone.

Explicit variants use the same capability and workflow fields. For example,
`skillboard variant add claude.a --from a --capability task-review --workflow
claude-workflow --path claude/a ...` records the user-approved `a -> claude.a`
relationship, makes `claude.a` preferred for that workflow, and keeps `a` as a
fallback. For a reviewed manual adaptation lifecycle, `skillboard variant fork
<variant-id>` creates draft metadata and raw snapshot records, `skillboard
variant status <variant-id>` reports `variant.status` plus computed drift, and
`skillboard variant approve <variant-id>` promotes the reviewed body. Use
`skillboard variant reset <variant-id>` with `--to-base` or `--to-approved` to
restore a known snapshot. SkillBoard records workflow policy across agents; it
does not convert skill bodies, does not rewrite skill bodies, and does not
guarantee semantic equivalence of skill bodies.

When the reconciler discovers a new non-user skill that already maps to a
capability, it uses `default_policy` as the recommended invocation mode. The
status remains `quarantined`, so the recommendation is visible but not
automatically callable.

## Harness Lifecycle

Harnesses have their own state because removing a harness can break command
flows even when the skills still exist:

```yaml
harnesses:
  lazycodex:
    status: fallback
    workflows:
      - large-refactor-workflow
    commands:
      - $ulw-plan
      - $start-work
```

The reconciler treats missing configured harnesses as migration events and
newly detected harnesses as disabled until a workflow opts in.

## Install Units

SkillBoard models packaged agent runtime changes as install units. This keeps a
plugin bundle or opinionated harness installer from being flattened into a list
of unrelated skills.

Supported install unit kinds:

- `skill`
- `plugin`
- `marketplace`
- `package-manager-dependency`
- `harness`
- `mcp-server`
- `hook`
- `agent`
- `lsp`

Each unit can record:

- source command or package origin;
- install scope such as user-global, project, local, or admin;
- manifest and cache paths;
- provided components;
- modified config files;
- auto-update and enable/disable state;
- workflow dependencies;
- permission risk;
- rollback shape.

Example:

```yaml
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
```

The `examples/multi-source.config.yaml` fixture models a private skill source
plus `mattpocock/skills`, `code-yeongyu/oh-my-openagent`,
`anthropics/skills`, `wshobson/agents`, and
`VoltAgent/awesome-agent-skills` in one workspace. It is intentionally a
reproducible policy fixture, not a network installer.

## Reconciliation

SkillBoard compares desired state with actual state:

- Desired state: config, workflows, capabilities, harnesses, and policy.
- Actual state: discovered `SKILL.md` files and detected harnesses.
- Reconcile plan: automatic safe actions plus decisions requiring approval.

Safe automatic defaults:

- Trusted user-local skills become `status: active` with
  `invocation: manual-only` only when SkillBoard has no existing workflow
  metadata and can create a local manual workflow.
- Trusted user-local skills discovered after workflows exist become
  `candidate` / `manual-only` with a review note instead of being attached to an
  arbitrary workflow.
- Runtime-supplied, external, system, or unreviewed skills are quarantined from
  automatic use and surfaced as decisions when a safe review path exists.
- New harnesses detected by reconciliation are disabled until workflows opt in.
- Removed skills and harnesses produce impact reports before config changes.
- Capability matches are surfaced as recommendations, not auto-activation.
