# AI Skill Routing Goal

SkillBoard's product goal is to be a **permissive AI skill routing layer**. It keeps installed skills broadly available by default, then gives the AI a deterministic route when multiple skills could steer the same task. It should help an AI decide which skills and workflow policies apply to the current task without turning normal work into a settings session.

This document is the goal reference for product work, routing changes, AI-facing brief changes, bridge updates, policy UX, and workflow UX.

## Core principle

SkillBoard should keep the user's work moving by default. Broadly available
skills are normal; deterministic overlap resolution is the value.

The preferred loop is:

```text
observe → route → work → explain briefly → ask after → remember policy
```

That means:

1. **Observe** the user's request and current workflow context.
2. **Route** to the most appropriate allowed skill or workflow policy without asking first when the risk is low, especially when several similar skills match.
3. **Work** normally so SkillBoard does not become a pre-task settings checklist.
4. **Explain briefly** which skill was used or skipped, only at the level needed for trust.
5. **Ask after** the task when the routing choice was ambiguous, recurring, or likely to become a useful preference.
6. **Remember policy** as usage guidance for future turns.

## Non-goals

SkillBoard does not rewrite `SKILL.md` bodies as the primary way to improve outcomes.

SkillBoard should not:

- ask users to choose from a large skill inventory before ordinary work can begin;
- require users to memorize the SkillBoard command loop;
- infer permission from raw installed `SKILL.md` files;
- silently let overlapping skills contaminate an answer;
- make the default model feel deny-first when the user's skill set is already allowed;
- mutate skill body content when a usage policy would solve the problem;
- turn every allowed skill invocation into a permission prompt.

## Simplification rule

Do not simplify by deleting concepts blindly. Keep a concept only when it
justifies itself against SkillBoard's routing identity: routing, overlap
resolution, policy memory, or a less interruptive user flow. Concepts that do
not pass that test should be removed, merged, or renamed into the smaller
surface that does.

## What SkillBoard controls

SkillBoard controls **when and how a skill may influence an AI workflow**.

The control object is a usage policy, not the skill body itself:

- task or intent triggers;
- workflow scope;
- user, project, or team scope;
- preferred and fallback skills;
- exclusion rules;
- overlap resolution summaries;
- confidence or ambiguity thresholds;
- disclosure and guard behavior;
- pending policy suggestions to review later.

## Skill usage modes

Use these terms when designing routing, docs, brief output, or policy UX:

- **Always use** — apply the skill automatically for a clearly scoped situation.
- **Prefer** — choose this skill first when several skills match.
- **Reference only** — read the skill as background guidance, but do not let its format or workflow dominate the final answer.
- **Ask after use** — use the skill for low-risk ambiguous work, then ask whether to remember that choice.
- **Ask before use** — ask first only when the action is risky, policy-changing, expensive, destructive, or externally visible.
- **Avoid** — do not use the skill in a scoped situation unless the user explicitly asks.
- **Block** — never use the skill while the policy remains in force.

## User-facing flow

A normal user should be able to talk to their AI naturally:

```text
User: "Help me refine this UX flow."
AI: works using the routed skills.
AI: "I used command-flow-ux-audit as the primary reference and left TDD skills out because this was not a code-editing task. Should I treat that as the default for UX-flow requests?"
```

The confirmation is intentionally small and late. It records a policy preference without interrupting the work that caused the user to ask for help.

## AI-facing behavior

AI integrations should:

- read the current SkillBoard brief before making skill availability claims;
- route from the current request and workflow instead of searching raw skill bodies;
- run the guard automatically immediately before invoking an allowed skill;
- disclose allowed skill use at the start and completion;
- ask the user before applying policy-changing action cards;
- reread the post-apply brief before making another availability claim;
- propose remembered policy only when the user has seen enough context to judge the result.

## Development rule

Read `docs/ai-skill-routing-goal.md` before changing routing, brief, bridge, policy, or workflow UX.

Any implementation that affects AI-mediated skill selection should preserve the non-blocking loop:

```text
observe → route → work → explain briefly → ask after → remember policy
```

When in doubt, prefer a small usage-policy change over skill-body mutation or a larger pre-task setup flow.

## MVP acceptance criteria

A change moves SkillBoard toward this goal when:

- ordinary allowed-skill work proceeds without a pre-task skill-selection prompt;
- ambiguous but low-risk choices can be handled with ask-after-use policy suggestions;
- multiple allowed matching skills stay available while the routed skill is deterministic;
- risky or policy-changing actions still require explicit confirmation before apply;
- `brief --json` gives AI integrations a stable way to discover the goal document and routing guidance;
- text output stays compact by default and reserves verbose detail for explicit requests;
- users can understand why a skill was used, skipped, or blocked;
- SkillBoard records usage policy separately from skill body content.
