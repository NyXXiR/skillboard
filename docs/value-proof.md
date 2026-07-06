# SkillBoard Value Proof

This is the README-facing proof that SkillBoard gives a user more useful control
than manually inspecting `/skills` or a raw workflow skill list.

The proof is executable:

```bash
node --test test/readme-value-proof.test.mjs
```

The test uses repository fixtures, not a mocked string. It drives the same CLI
surfaces a user or agent would use.

## GitHub-reader takeaway

The raw list answers inventory questions: which skill declarations are connected
to this workflow?

SkillBoard answers routing questions: which skills can actually run now, why
are others blocked, which skill should steer the user's current request when
several skills overlap, and what approved action changes the next state?

In the tested fixture, the raw list can make the workflow look ready because it
shows `matt.tdd active workflow-auto`. SkillBoard refuses that unsafe claim and
reports 0 usable skills, 8 blocked skills, 2 policy errors, and 1 policy warning
before invocation.

## Case 1: Raw skill list vs SkillBoard brief

Fixture:

```bash
examples/skillboard.config.yaml
examples/skills
```

`examples/skillboard.config.yaml` is an intentional policy-failure fixture. It
is not the passing starter example; it exists to prove that SkillBoard refuses a
raw-list availability claim when policy health fails.

Workflow:

```bash
codex-night-workflow
```

Raw skill list command:

```bash
node bin/skillboard.mjs list skills \
  --config examples/skillboard.config.yaml \
  --skills examples/skills \
  --workflow codex-night-workflow
```

Observed raw-list result:

- Raw skill list: 4 workflow-linked rows.
- It includes `matt.tdd active workflow-auto`.
- It does not include policy health.

SkillBoard brief command:

```bash
node bin/skillboard.mjs brief \
  --config examples/skillboard.config.yaml \
  --skills examples/skills \
  --workflow codex-night-workflow
```

Observed brief result:

- SkillBoard brief: 0 usable skills.
- 8 blocked skills.
- Policy errors: 2.
- Policy warnings: 1.
- The policy diagnostics identify `matt.grill-with-docs` as a non-callable
  fallback in `requirement-review`.

What this proves:

- The raw list can make a workflow look usable because it reports declared
  state such as `active` and `workflow-auto`.
- The SkillBoard brief checks policy health before use and refuses the unsafe
  availability claim.

## Case 2: Approved action-card flow

Fixture:

```bash
examples/multi-source.config.yaml
examples/multi-source-skills
```

The test copies this fixture to a temporary project, including `AGENTS.md` and
`CLAUDE.md`, then runs:

```bash
node bin/skillboard.mjs brief ... --include-actions --json
node bin/skillboard.mjs apply-action activate-skill:anthropic.docx ... --yes --json
node bin/skillboard.mjs brief ... --json
```

Observed action-card flow result:

- Before apply, usable skills: 2.
- The current action list includes `activate-skill:anthropic.docx`.
- Applying that one approved action returns `changed: true`.
- After apply, usable skills: 2 -> 3.
- `anthropic.docx` appears in `manual_allowed`.
- The final brief has 0 policy errors.

What this proves:

- SkillBoard is not just a catalog. It gives a current action id, applies one
  approved change, then re-resolves the next availability state.
- The user does not need to hand-edit YAML or infer enable/disable impact from
  raw `SKILL.md` files.

## Case 3: AI-mediated approved action proof

The test also simulates the product path without calling an external LLM:

```bash
node bin/skillboard.mjs brief ... --include-actions --json
node bin/skillboard.mjs apply-action <current-action-id> ... --yes --json
node bin/skillboard.mjs guard use anthropic.docx ... --json
node bin/skillboard.mjs guard use matt.grill-me ... --json
```

Observed AI-mediated result:

- The simulated user asks for `anthropic.docx` to be made available.
- The AI reads `assistant_guidance.choices` from the current brief.
- The chosen confirmation maps to the current
  `activate-skill:anthropic.docx` action id.
- `apply-action --yes --json` returns a post-apply brief.
- The returned brief no longer offers the stale activate action and now offers
  the matching disable action.
- `guard use anthropic.docx --workflow codex-night-workflow` fails before the
  approved action and succeeds after it.
- `guard use matt.grill-me --workflow codex-night-workflow` stays denied
  because the workflow blocks that skill.

What this proves:

- The proof uses the current `assistant_guidance` action id instead of cached
  output.
- SkillBoard keeps the guard as the final boundary before invocation.
- Blocked skills still produce a non-zero, machine-readable denial.

## Case 4: AI route picks the right allowed skill

The same fixture also proves that SkillBoard can help the AI choose the right
skill before invocation:

```bash
node bin/skillboard.mjs route "write tests before implementation" \
  --config examples/multi-source.config.yaml \
  --skills examples/multi-source-skills \
  --workflow codex-night-workflow \
  --json
```

Observed route result:

- Matched capability: `test-first-implementation`.
- Match source: `capability`.
- Confidence: `high`.
- Recommended skill: `matt.tdd`.
- Fallback skill: `private.tdd-work-continuity`.
- Overlap resolution is exposed in route payloads when several allowed skills
  match, so agents can explain the deterministic route without hiding the other
  available skills.
- Guard command: `skillboard guard use matt.tdd ...`.
- Guard result for `matt.tdd`: allowed.
- Start disclosure: `I will use matt.tdd for this request.`
- Finish disclosure: `I used matt.tdd for this request.`

The proof also checks `brief --intent "write tests before implementation"` so
the recommendation appears inside `assistant_guidance.route`, not only through
the standalone `route` command.

For a request outside the workflow's declared capability, such as "ship a
powerpoint deck", SkillBoard returns no recommended skill and tells the AI to:
Ask a clarifying question before choosing a skill.

What this proves:

- The AI can ask SkillBoard which skill fits a normal user request instead of
  guessing from raw `SKILL.md` text.
- Allowed skill use stays low-friction: the AI discloses use at start and
  finish instead of asking for redundant approval.
- No-match results are explicit, so the AI can ask a clarifying question rather
  than forcing a poor skill choice.
