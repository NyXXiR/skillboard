# AI Skill Routing Goal

SkillBoard is a user-level, non-blocking control plane for skill availability,
cross-agent sharing, and overlap routing. It asks only two policy questions:

1. Is the skill enabled or disabled?
2. Should SkillBoard share this skill with other supported agents?

Installed, valid skills default to enabled and agent-local. A user may disable
a skill or opt that individual skill into sharing. An optional preference ranks
enabled candidates that are actually installed for the current agent;
preference never changes availability or copies files.

## Product loop

Preserve `observe → route → work → explain briefly → ask after → remember`.
Ordinary work must not stop for source review or pre-task configuration. Read
the current brief when skills overlap, run the guard before use, and ask
once only before a persistent policy change.

## Boundaries

Source, provenance, digest, aliases, install-unit details, and risk are optional
audit metadata and never determine availability. They belong in generated
inventory and audit output, not user policy.

Runtime and action authorization are outside SkillBoard's scope. The active
agent or harness remains responsible for hooks, MCP servers, commands, network
access, external writes, destructive actions, and secrets.

SkillBoard does not rewrite `SKILL.md` bodies. It records enablement, explicit
sharing, and optional routing preference. Agent presence (`installed_on`) is
generated inventory, not user-managed policy.

`shared: false` means SkillBoard does not propagate the skill. It does not
remove or quarantine copies that the user or another tool installed. With
`shared: true`, SkillBoard materializes a managed shared source and compatible
managed copies for supported agents, while preserving every agent-owned
original.

`setup` is a repeatable user-level convergence operation. It observes agents
and Hermes profiles added after installation, refreshes managed guidance and
inventory, and materializes missing copies only for skills already marked
`shared: true`. Custom agent roots are remembered outside policy as operational
discovery state. They must not introduce project scope, source trust gates, or
another authorization layer.

## Development rule

Every route, brief, guard, dashboard, generated bridge, and policy mutation must
project the same v2 meaning. Normal commands use one home control plane from any
working directory; project initialization is not part of the v2 flow. Never
reintroduce source reputation, workflow scope, or legacy state fields as hidden
authorization checks.

Version 1 is migration input only. It has a one-release read-only window in the
v0.3 release and is removed in v0.4.0.
