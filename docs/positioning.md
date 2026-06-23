# Positioning

## Problem

AI agent skills are easy to install but hard to govern.

Users lose confidence when they cannot tell:

- which installed skills are active,
- which skills may be invoked automatically,
- which workflows depend on a skill,
- which similar skills compete silently,
- whether removing a skill breaks a hidden workflow.
- what to do after new skills or harnesses appear.
- how to migrate workflows when a harness disappears.
- which plugin, marketplace, package, or installer introduced a component.

## Product Definition

SkillBoard is a workflow-scoped skill control board with a reconciler.

It is not primarily a skill catalog. It is an operations layer that turns a
skill repository into a visible, policy-checked system. Users define intent and
policy; SkillBoard interprets drift between desired state and actual state.

## Adjacent Tools

- `skillshare`: syncs skills across many agent targets.
- Microsoft APM: reproduces agent context from `apm.yml` and lockfiles.
- SkillGate/SkillGuard/SkillScope-style tools: scan, permissions, and security
  risk.
- SkillPilot/skill routers: pick relevant skills before inference.

SkillBoard complements those tools by making invocation state, workflow impact,
and migration decisions explicit.

## Runtime Primitive Model

SkillBoard should not depend on one installer shape. The likely ecosystem
direction is manifest plus scope plus bundle plus cache plus enable/disable plus
lockfile plus audit. That means the control plane needs a parent abstraction for
the thing that was installed.

The parent is an install unit. Skills and harnesses can then be child components
of a `plugin`, `marketplace`, `package-manager-dependency`, `harness`,
`mcp-server`, `hook`, `agent`, or `lsp` unit. LazyCodex-style installers should
therefore show up as user-global harness/plugin bundles that provide commands,
skills, MCP integrations, hooks, and config changes, not as loose skills mixed
into the skill list.

Users should be able to plug in workflow/harness bundles, then add only a small
number of personal global meta skills. Those global meta skills are for control
tasks such as routing, impact analysis, registry maintenance, and verification.
Everything else should remain scoped to a workflow or owned by its parent install
unit. This is how SkillBoard keeps skill count growth from becoming routing
complexity.

The multi-source fixture exercises this product claim with one private skill
source plus five external repositories: a personal skill folder, a workflow skill
pack, a harness bundle, a standard Agent Skills repository, a multi-harness
plugin marketplace, and a catalog-style marketplace.

Import adapters should follow the same principle. Popular repositories can have
bundled source profiles, but the import logic should not branch on repository
names. The stable contract is the normalized install-unit model, not a hardcoded
adapter per source.

## Wedge

The first useful wedge is:

1. read an existing skill folder,
2. read a strong workflow policy config,
3. quarantine newly discovered skills,
4. show active/manual/blocked state,
5. fail CI when policy references drift,
6. show disable impact before cleanup,
7. produce a reconcile plan when skills or harnesses change.
8. show the install unit that introduced a skill, harness, hook, MCP server, or
   command.

That is enough to make adding and removing skills feel safer.

## Reconciler Promise

Control should not mean constant manual work. The reconciler should handle the
obvious safe defaults and only ask for important decisions:

- new skills: quarantine, map likely capability, ask whether to approve;
- removed skills: show affected workflows and fallback capabilities;
- changed harnesses: show missing commands and migration hints;
- new harnesses: disable by default until explicitly assigned;
- duplicate skills: group by capability and recommend a canonical
  implementation.
