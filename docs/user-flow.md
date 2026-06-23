# First-Time Skill Control Flow

This flow assumes a user installed SkillBoard because they want to see and
control which agent skills can affect a workflow.

## 1. Bootstrap The Control Plane

```bash
skillboard init
skillboard doctor
```

`init` creates the config, local `skills/` directory, report directories, and
agent bridge blocks. It also scans known local agent skill locations and records
discovered skills as managed entries. Trusted user-local skills are immediately
attached to a generated manual workflow when the project has no workflows yet,
so existing manual skills keep working through `can-use` and guard checks.
Runtime-supplied or external skills are quarantined and blocked until a workflow
explicitly enables them. Use `skillboard doctor --strict` when review-needed
safe-mode warnings should fail automation.

Run this again after installing agent packages, plugins, workflow bundles, or
harnesses:

```bash
skillboard inventory refresh --dry-run
skillboard inventory refresh
```

## 2. Add A User-Owned Skill

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
skill to `active-manual` for that workflow. It still does not grant automatic
model invocation.

## 3. Inspect Influence Before Use

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

## 4. Enable, Disable, Or Prefer

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

```bash
skillboard uninstall --dry-run
skillboard uninstall
```

Uninstall removes generated bridge blocks and unchanged helper files. It
preserves `skillboard.config.yaml`, `skills/`, reports, and user-authored
content in bridge files.
