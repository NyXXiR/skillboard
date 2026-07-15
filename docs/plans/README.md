# Agent Handoff Plans

This directory contains durable plans that can be picked up by another agent
(such as Hermes) when the original author is not available.

## Conventions

- Each plan file is named `<timestamp>-<slug>.md`.
- The `Status:` field in the frontmatter controls the lifecycle:
  - `pending` — waiting for an agent to pick it up
  - `assigned` — an agent is currently working on it
  - `consumed` — the agent has finished the planned work
- Agents should only pick up files with `Status: pending`.
- After picking up a plan, change the status to `assigned` and commit.
- After completing the work, change the status to `consumed` and commit.

## Current Plans

- `20260715-030500-korean-intent-routing-and-v1-flag-ux.md` — Unicode/Korean
  intent tokenization for the router (P0) plus v1/v2 flag vocabulary UX in
  usage errors and docs (Status: consumed)
- `20260625-080025-skillboard-mvp-review.md` — SkillBoard MVP feature/domain
  review and UX improvement plan (Status: completed)
