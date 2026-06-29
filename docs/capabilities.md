# Capabilities

SkillBoard uses **capabilities** as a contract layer between a workflow and the skills that satisfy it. A capability is an abstract need, such as "requirement-clarification" or "test-first-implementation". Skills claim to provide it; workflows declare they require it.

There are two places where capabilities appear:

1. **Global capability catalog** in `skillboard.config.yaml` (`capabilities`)
2. **Workflow-scoped requirements** under each workflow (`required_capabilities`)

## Global Capability Catalog

The global catalog defines a capability once for the whole project.

```yaml
capabilities:
  requirement-clarification:
    canonical: meerkat.requirement-intake
    alternatives:
      - matt.grill-me
      - matt.grill-with-docs
    default_policy: router-only
```

- `canonical`: the preferred skill for this capability.
- `alternatives`: other skills that may satisfy the same capability.
- `default_policy`: the suggested invocation policy when a workflow requires the capability but does not override it.

The catalog is used for project-wide policy checks, such as:

- Is the canonical skill declared?
- Does a skill that claims `canonical_for` actually match the catalog?
- Are fallback or alternative skill references valid?

## Workflow-Scoped Requirements

A workflow can require a capability and pin how it should be resolved.

```yaml
workflows:
  requirement-review:
    required_capabilities:
      requirement-clarification:
        preferred: meerkat.requirement-intake
        fallback:
          - matt.grill-with-docs
        policy: router-only
```

- `preferred`: the skill to use first for this workflow.
- `fallback`: ordered alternatives if the preferred skill is unavailable or blocked.
- `policy`: invocation mode that applies when the capability is resolved in this workflow.

## Resolution Flow

When a workflow is selected, SkillBoard resolves each required capability like this:

```
workflow.required_capabilities
        │
        ▼
  capability name
        │
        ▼
  lookup global catalog (capabilities.<name>)
        │
        ▼
  preferred in workflow? ──yes──► use workflow.preferred with workflow.policy
        │
       no
        ▼
  use catalog.canonical with workflow.policy
        │
        ▼
  fallback order: workflow.fallback, then catalog.alternatives
```

If no preferred skill is set in the workflow, the global catalog's canonical skill is used. Fallbacks are checked in order: first the workflow's own fallback list, then the global alternatives.

## Explicit Skill Variants

Use `skillboard variant add claude.a --from a --capability task-review --workflow claude-workflow --path claude/a ...` to record a user-approved `a -> claude.a` variant. SkillBoard adds the variant to the capability alternatives, makes it preferred for the named workflow, and keeps the base skill available as fallback.

This is policy registration, not prompt migration. For a reviewed manual adaptation lifecycle, run `skillboard variant fork <variant-id>` to create a draft and raw snapshot, edit the variant body by hand, inspect `skillboard variant status <variant-id>` for `variant.status` and computed drift, then use `skillboard variant approve <variant-id>` or `skillboard variant reset <variant-id>`. SkillBoard records user-approved variants and consistent workflow policy across agents; it does not convert skill bodies, does not rewrite skill bodies, and does not guarantee semantic equivalence of skill bodies.

## Global vs Workflow: When to Use Each

| Use case | Use global catalog | Use workflow requirement |
|----------|-------------------|--------------------------|
| Define a canonical skill for a capability | ✅ | |
| List known alternatives project-wide | ✅ | |
| Provide a default invocation policy | ✅ | |
| Pin a different skill for one workflow | | ✅ |
| Add workflow-specific fallbacks | | ✅ |
| Override invocation policy for a workflow | | ✅ |

## Skill Declaration

A skill declares that it satisfies a capability through `canonical_for`:

```yaml
skills:
  meerkat.requirement-intake:
    canonical_for:
      - requirement-clarification
```

If `canonical_for` references a capability, the global catalog must list the same skill as its `canonical`. Otherwise the policy check reports a mismatch.

## Safety Notes

- A workflow requirement can only reference capabilities defined in the global catalog.
- `policy` in a workflow requirement must be a valid invocation value.
- Prefer `workflow-auto` or `router-only` for workflow requirements; reserve `global-auto` for explicitly global-meta skills.
