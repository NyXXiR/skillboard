# First-Time Skill Control Flow

This flow assumes a user installed SkillBoard because they want to ask their AI
which skills are safe to use and approve changes without learning the control
plane internals.

When you ask your AI "what skills can you use here?" or "make this reviewed
skill available for this workflow," the AI should read the current brief, show
the relevant choice, ask before applying one current action id, and run the
final guard before invocation. You do not need to memorize the SkillBoard
command loop. The command examples below are AI/automation/operator details for
the agent, scripts, or people maintaining the setup.

## 1. Bootstrap The Control Plane

AI/automation/operator details:

```bash
skillboard init
skillboard doctor
```

`init` creates the config, local `skills/` directory, report directories, and
agent bridge blocks. It also scans known local agent skill locations and records
discovered skills as managed entries. Trusted user-local skills, including
Hermes profile skills under `.hermes/profiles/*/skills`, are immediately
attached to a generated manual workflow as `status: active` with
`invocation: manual-only` when the project has no workflows yet, so existing
manual skills keep working through `can-use` and guard checks without creating
legacy-state warning noise. Runtime-supplied or external skills are quarantined
until an explicit source and workflow decision exists. Reviewable items should
appear as "Needs your decision"; only provenance failures, explicit user blocks,
disabled sources, or other hard policy failures should remain "Blocked for
safety". Use
`skillboard doctor --strict` when review-needed safe-mode warnings should fail
automation.

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
should run `skillboard guard use ...` immediately before calling a skill so
state changes made after the brief cannot slip through.

When wiring a guard hook from an action card, keep `apply-action` as the
action-card primary flow:

```bash
skillboard apply-action <action-id> --workflow daily-workflow --config skillboard.config.yaml --skills skills --yes --json
```

The raw hook commands are underlying manual operator detail for previewing and
materializing an executable guard hook outside the action-card approval loop:

```bash
skillboard hook install --workflow daily-workflow --config skillboard.config.yaml --skills skills --out .skillboard/hooks/daily-workflow-guard.sh --dry-run --json
skillboard hook install --workflow daily-workflow --config skillboard.config.yaml --skills skills --out .skillboard/hooks/daily-workflow-guard.sh
```

For direct manual hook installation, inspect the JSON `planned.preview.shell`
before an operator materializes the matching non-dry-run hook command.

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

This removes SkillBoard policy references only. It does not delete
`skills/user-helper/SKILL.md`.

## 6. Stop Using SkillBoard Safely

AI/automation/operator details:

```bash
skillboard uninstall --dry-run
skillboard uninstall
```

Uninstall removes generated bridge blocks and unchanged helper files. It
preserves `skillboard.config.yaml`, `skills/`, reports, and user-authored
content in bridge files.

For a fresh policy lifecycle during testing, use:

```bash
skillboard uninstall --reset-config --remove-reports --remove-hooks --dry-run
skillboard uninstall --reset-config --remove-reports --remove-hooks
skillboard init
```

`--reset-config` discards the current SkillBoard config even if it contains
imported skills or workflow edits. `--remove-reports` also discards generated
dashboard and impact reports. `--remove-hooks` discards the entire
`.skillboard/hooks/` directory contents when you explicitly want a full test or
test reset, so `.skillboard/` can disappear when no other SkillBoard state
remains. These reset flags do not delete local `skills/` files.
