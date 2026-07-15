# Positioning

SkillBoard solves overlap routing for people who use different skill sets in
multiple AI agents.

Its durable policy answers two questions:

1. Is this skill enabled?
2. Should this one skill remain agent-local or be shared across agents?

The active model chooses the best enabled skill installed for the current
agent, or no skill, from raw descriptions and optional saved preferences.
SkillBoard does not tokenize, score, or match v2 request text. Preference never
changes availability.

## Difference from distribution tools

A pure distribution tool copies a selected set everywhere. SkillBoard observes
agent-local installations, routes among what the current agent can actually use,
and promotes only explicitly selected skills into managed sharing. Users do not
need to flatten every agent into one global skill set.

Source scanners and permission systems remain separate. Source and provenance
observations are audit metadata and never determine availability.
Runtime and action authorization are outside SkillBoard's policy scope.

## Product promise

Installing a valid skill makes it enabled and agent-local. Ordinary use never
waits for quarantine or source review. Users intervene only to disable it,
share or unshare that skill, or remember a routing preference.
