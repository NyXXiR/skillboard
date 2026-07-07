# First-Time Skill Control Flow

This flow assumes a user installed SkillBoard so their AI can keep installed
skills broadly available while resolving confusing overlap only when it matters.

When you ask your AI normal work requests such as "write tests before
implementation", "review this plan and point out weak assumptions", or "help me
refine this UX flow," the AI should work normally. SkillBoard becomes relevant
when skill choice is ambiguous, several skills overlap, workflow priority
matters, or you explicitly ask for a SkillBoard or skill decision such as "what
skills can you use here?" or "make this reviewed skill available for this
workflow." In those cases, the AI should read the current brief, show the
relevant choice, ask only before applying one current action id when policy
would change, and run the final guard automatically before invocation. For an
already-allowed skill, the AI should state which skill it is about to use and
which skill it used when reporting the result, not ask for another approval.
That disclosure is an audit trace, not a permission prompt. If you explicitly
ask for a specific already-allowed skill, the AI should honor that request after
guard use instead of rerouting away solely because another skill also matches.
You do not need to memorize the SkillBoard command loop. The command examples
below are AI/automation/operator details for the agent, scripts, or people
maintaining the setup.

If you ask OpenCode to use a skill you previously used in Codex, the target
agent should call:

```bash
skillboard import-skill --from codex --to opencode --skill <skill> --json
```

Compatible skills are installed into the target agent's user skill root. When
the source is agent-specific, the agent should explain the compatibility issue
and ask before producing a target-agent adapted `SKILL.md`.

Before changing this routing or workflow UX, read
[`docs/ai-skill-routing-goal.md`](ai-skill-routing-goal.md). The goal is to keep
SkillBoard non-blocking: observe the request, route to the current best skill,
work normally, explain briefly, ask after use only when a policy preference would
help, and remember that usage policy without rewriting skill bodies.

## 1. Start From Agent-Layer Setup

AI/automation/operator details:

```bash
skillboard setup --agent codex,claude,opencode,hermes --yes
```

Package install and `skillboard setup` write user-agent guidance only. They do
not create `skillboard.config.yaml`, `.skillboard/`, `AGENTS.md`, or
`CLAUDE.md` in projects. `skillboard init` is deprecated project-local policy
bootstrap and is not needed for normal use; use it only when maintaining an
existing workspace that intentionally keeps local SkillBoard policy files. Use
`skillboard doctor --strict` only for an existing policy workspace when
review-needed safe-mode warnings should fail automation.

When the user asks the agent what it can use, the agent should read the current
brief with `skillboard brief --json` first and answer from the brief rather than
reading skill files directly. The user-facing text output uses sections such as
"What your AI can use now", "Needs your decision", and "Blocked for safety";
text briefs include previewable action cards by default, while the JSON form
keeps action cards opt-in. For large skill sets, the default text brief stays
compact: counts, top categories, next safe action, short previews per section,
and short action summaries. Use `skillboard brief --verbose` when an operator
needs every skill and full copyable command details. Those action cards are
suggestions only: the agent should pick one current action id from the brief,
request confirmation before applying risk-bearing changes, then run
`skillboard apply-action <action-id> --config skillboard.config.yaml --skills skills --yes --json`
with `--workflow <name>` when a workflow is selected. The agent should read the
returned post-apply brief before making the next availability claim.
`apply-action` re-resolves the current brief and refuses stale action ids instead
of replaying cached action-card shell text.

When a normal request leaves skill choice ambiguous, several skills overlap,
workflow priority matters, or the user asks for a SkillBoard or skill decision,
the agent can keep the same brief flow and include the user request as intent:

```bash
skillboard brief --intent "write tests before implementation" --workflow daily-workflow --config skillboard.config.yaml --skills skills --json
```

The returned `assistant_guidance.route` maps the request to a declared workflow
capability or a workflow-bound skill metadata match, returns the recommended
skill and fallbacks, and includes `match_source`, `matched_terms`,
`recommendation_reason`, `route_candidates`, `overlap_resolution`,
`policy_memory`,
`post_use_policy_suggestion`, and the `skillboard guard use ...` command that
still needs to pass immediately before invocation. `overlap_resolution`
summarizes permissive routing when several allowed skills match.
`route_candidates` is the per-skill decision trace: it shows which matching
skill was selected, which candidates were denied, and the guard reason when a
preferred skill was skipped for an allowed fallback.
`policy_memory` appears when remembered or configured workflow policy selected
the routed skill while other allowed skills were also available; the agent
should mention that after completion so the user understands the prior choice
shaped the route.
`post_use_policy_suggestion` is the ask-after-use hook: if it is present, the
agent should use the allowed routed skill first, then ask after completion
whether to remember the suggested preference. Metadata matching can
use declared skill id, path, category, and `SKILL.md` frontmatter
name/description; it does not semantically rank raw skill bodies. If a
recommended skill is already allowed, the agent should disclose it at the start
and completion rather than ask for another approval. If the user explicitly
requests a specific already-allowed skill, the agent should honor that request
after guard use instead of rerouting away solely because another skill also
matches. If no capability or workflow-bound skill matches, the agent should ask
a clarifying question instead of guessing from raw `SKILL.md` text. Operators can still call
`skillboard route ...` directly when they only need the recommendation payload.

Run this again after installing agent packages, plugins, workflow bundles, or
harnesses:

```bash
skillboard inventory refresh --dry-run
skillboard inventory refresh
```

## 2. Add A User-Owned Skill

AI/automation/operator details:

Create the skill under the project `skills/` directory:

```bash
mkdir -p skills/user-helper
$EDITOR skills/user-helper/SKILL.md
```

Register it without making it callable yet:

```bash
skillboard add skill user.helper \
  --path user-helper \
  --config skillboard.config.yaml \
  --skills skills \
  --dry-run

skillboard add skill user.helper \
  --path user-helper \
  --config skillboard.config.yaml \
  --skills skills
```

The dry run reports semantic YAML changes and leaves the config untouched. The
real command adds the skill as a direct user-owned `candidate` by default.

Create a workflow or harness for the skill without hand-editing YAML:

```bash
skillboard add harness codex \
  --config skillboard.config.yaml \
  --skills skills

skillboard add workflow daily-workflow \
  --harness codex \
  --skill user.helper \
  --config skillboard.config.yaml \
  --skills skills
```

When `add workflow` attaches a `candidate` / `manual-only` skill, it promotes the
skill to `active` with `invocation: manual-only` for that workflow. It still
does not grant automatic model invocation.

## 3. Inspect Influence Before Use

AI/automation/operator details:

```bash
skillboard explain user.helper \
  --config skillboard.config.yaml \
  --skills skills

skillboard can-use user.helper \
  --workflow daily-workflow \
  --config skillboard.config.yaml \
  --skills skills

skillboard impact disable user.helper \
  --config skillboard.config.yaml \
  --skills skills \
  --out .skillboard/reports/user-helper-impact.md
```

`explain` shows source class, trust, owner install unit, workflow roles, and
capability roles. `can-use` is the machine-readable gate for agents. `impact`
shows which workflows and required outputs would be affected before disabling or
removing a skill.

For an actual invocation, `brief` is not the final permission check. Agents
should run `skillboard guard use ...` automatically immediately before calling a
skill so state changes made after the brief cannot slip through. A passing guard
does not require another user prompt; the agent should disclose the skill use at
the start and in the final result. That disclosure is an audit trace, not a
permission prompt.

When wiring a guard hook from an action card, keep `apply-action` as the
action-card primary flow:

```bash
skillboard apply-action <action-id> --workflow daily-workflow --config skillboard.config.yaml --skills skills --yes --json
```

The raw hook commands are underlying manual operator detail for previewing and
materializing an executable guard hook outside the action-card control loop:

```bash
skillboard hook install --workflow daily-workflow --config skillboard.config.yaml --skills skills --out .skillboard/hooks/daily-workflow-guard.sh --dry-run --json
skillboard hook install --workflow daily-workflow --config skillboard.config.yaml --skills skills --out .skillboard/hooks/daily-workflow-guard.sh
```

For direct manual hook installation, inspect the JSON `planned.preview.shell`
before an operator materializes the matching non-dry-run hook command. Generated
hooks pin the install-time SkillBoard command, config, skills root, and workflow;
set those values with hook install options such as `--skillboard-bin`, not with
runtime environment overrides.

## 4. Enable, Disable, Or Prefer

AI/automation/operator details:

Enable the skill only for the workflow that should see it:

```bash
skillboard activate user.helper \
  --workflow daily-workflow \
  --config skillboard.config.yaml \
  --skills skills
```

If you already used `skillboard add workflow ... --skill user.helper`, this
manual activation step is not needed for direct user invocation.

Block it from a workflow without deleting the declaration or file:

```bash
skillboard block user.helper \
  --workflow daily-workflow \
  --config skillboard.config.yaml \
  --skills skills
```

Prefer it for a capability when the workflow should depend on a role rather than
a raw skill id:

```bash
skillboard prefer user.helper \
  --workflow daily-workflow \
  --capability task-review \
  --config skillboard.config.yaml \
  --skills skills
```

## 5. Remove Governance Without Deleting User Files

AI/automation/operator details:

First try the safe remove:

```bash
skillboard remove skill user.helper \
  --config skillboard.config.yaml \
  --skills skills
```

If workflows, capabilities, or install units still reference the skill, the
command refuses to remove it and prints the references. After reviewing the
impact, remove the config declaration and references:

```bash
skillboard remove skill user.helper \
  --config skillboard.config.yaml \
  --skills skills \
  --force \
  --dry-run

skillboard remove skill user.helper \
  --config skillboard.config.yaml \
  --skills skills \
  --force
```

This removes SkillBoard policy references only and leaves
`skills/user-helper/SKILL.md` in place.

## 6. Stop Using SkillBoard Safely

AI/automation/operator details:

Remove managed user-agent guidance first if global install/setup made agents
recognize SkillBoard and you want that agent-layer footprint gone:

```bash
skillboard uninstall --agent-layer --dry-run
skillboard uninstall --agent-layer
```

This removes only managed `skillboard/SKILL.md` guidance files containing the
SkillBoard agent integration marker. It preserves other agent skills and
user-authored `skillboard` skills.

```bash
skillboard uninstall --dry-run
skillboard uninstall
```

Uninstall removes generated bridge blocks and unchanged helper files. It
also removes `skillboard.config.yaml` and the `.skillboard/` project state by
default while preserving local `skills/` files and user-authored non-SkillBoard
content in bridge files.

If you want to keep project SkillBoard policy and bridge guidance, opt into
settings preservation explicitly:

```bash
skillboard uninstall --keep-settings --dry-run
skillboard uninstall --keep-settings
```

`--purge` is still accepted as an explicit spelling for the default clean
project removal. Default removal and `--purge` both discard the current
SkillBoard config even if it contains imported skills or workflow edits, remove
generated dashboard and impact reports, and remove the entire `.skillboard/`
project state directory, including hooks, source caches, rollout logs, variant
snapshots, and profiles. Local `skills/` files stay in place.
