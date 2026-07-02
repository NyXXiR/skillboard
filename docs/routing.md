# Capability Routing

Capability routing helps an AI choose a skill for the user's current request
without making the user learn SkillBoard commands.

For the normal AI-mediated flow, prefer `brief --intent`. It returns the
availability brief and the routing result together:

```bash
skillboard brief \
  --intent "write tests before implementation" \
  --workflow codex-night-workflow \
  --config skillboard.config.yaml \
  --skills skills \
  --json
```

Read `assistant_guidance.route` from the JSON output. It includes:

- `matched_capability`
- `match_source`
- `confidence`
- `matched_terms`
- `recommendation_reason`
- `recommended_skill`
- `fallback_skills`
- `route_candidates`
- `post_use_policy_suggestion`
- `guard_command`
- `usage_disclosure`

When `guard_allowed` is true, the AI should run the guard automatically before
using the skill. It should not ask for another approval. It should disclose the
skill at the start and at completion:

```text
I will use <skill-id> for this request.
I used <skill-id> for this request.
```

When several skills match, inspect `route_candidates` before acting. Each entry
shows the candidate skill, whether it was selected, whether the guard currently
allows it, and the guard reason when it is denied. This is the field that tells
an AI why a preferred skill was skipped and an allowed fallback was selected.

When routing is safe but policy learning would reduce future ambiguity,
SkillBoard may return `post_use_policy_suggestion`. This includes cases where a
preferred skill is denied and an allowed fallback is selected, or where multiple
allowed workflow-bound skills match and one allowed skill is selected
deterministically. The AI should keep the task moving with the allowed routed
skill, then ask after completion whether to remember that skill as the preferred
workflow policy. The suggested policy command is informational until the user
confirms it.

Use `route` directly when an automation layer only needs the recommendation
payload:

```bash
skillboard route "write tests before implementation" \
  --workflow codex-night-workflow \
  --config skillboard.config.yaml \
  --skills skills \
  --json
```

Routing first matches declared workflow capabilities. If the workflow has skill
bindings but no matching capability, it can fall back to workflow-bound skill
metadata such as id, path, category, `SKILL.md` name, and `SKILL.md`
description.

Routing does not invoke the skill. The final boundary is still:

```bash
skillboard guard use <skill-id> \
  --workflow codex-night-workflow \
  --config skillboard.config.yaml \
  --skills skills
```

If no capability or workflow-bound skill matches, SkillBoard returns
`recommended_skill: null`. Ask a clarifying question before choosing a skill.

See [Value proof](value-proof.md) for an executable route example that selects
`matt.tdd`, returns `private.tdd-work-continuity` as fallback, and verifies the
guard and disclosure fields.
