# Skill Variant Lifecycle

SkillBoard treats a skill variant as a reviewed policy relationship plus a file snapshot trail. This is a manual adaptation lifecycle for cases such as `a -> claude.a`, where a human adapts a base skill for a specific agent or workflow and then asks SkillBoard to record, review, approve, or reset that relationship.

Variant lifecycle is policy registration. SkillBoard records metadata, snapshots, digests, and workflow preference changes; it does not convert skill bodies, does not rewrite skill bodies, and does not guarantee semantic equivalence of skill bodies.

## Lifecycle commands

All examples use the global `skillboard` command. From a clone, replace `skillboard ` with `node bin/skillboard.mjs `.

```bash
skillboard variant add <variant-id> --from <base-id> --capability <name> --workflow <name> --config <path> --skills <dir> [--path <relative-skill-path>] [--mode manual-only|router-only|workflow-auto] [--category <name>] [--owner-install-unit <unit-id>] [--dry-run] [--json]
skillboard variant fork <variant-id> --from <base-id> --capability <name> --workflow <name> --path <relative-skill-path> --config <path> --skills <dir> [--adapted-for <label>] [--category <name>] [--owner-install-unit <unit-id>] [--dry-run] [--json]
skillboard variant status <variant-id> --config <path> --skills <dir> [--json]
skillboard variant approve <variant-id> --config <path> --skills <dir> [--mode manual-only|router-only|workflow-auto] [--dry-run] [--json]
skillboard variant reset <variant-id> --to-base|--to-approved --config <path> --skills <dir> [--yes] [--dry-run] [--mode manual-only|router-only|workflow-auto] [--json]
```

Use `--json` in scripts. Success payloads return the command-specific lifecycle fields such as `message`, `dryRun`, `changed`, `plan`, `filePlan`, `skill`, `variant`, and `warnings`. Errors include `ok: false` with a stable `error.code` and `error.message`. Usage errors exit with code `2` in both plain and JSON modes.

## Recommended review flow

1. Register or fork the variant from a known base:

   ```bash
   skillboard variant fork claude.a --from a --capability task-review --workflow claude-workflow --path claude/a --config skillboard.config.yaml --skills skills --json
   ```

   Fork creates a draft relationship and raw snapshot records without promoting the variant for automatic workflow use.

2. Edit the variant `SKILL.md` by hand. This is where the actual adaptation happens.

3. Inspect computed drift before approval:

   ```bash
   skillboard variant status claude.a --config skillboard.config.yaml --skills skills --json
   ```

   `variant.status` is the stored lifecycle state. `computedStatus` is derived from the live digest, the base digest, and the approved digest. A changed live file that differs from the base snapshot and has no matching approved snapshot is a draft candidate.

4. Approve the reviewed variant:

   ```bash
   skillboard variant approve claude.a --config skillboard.config.yaml --skills skills --mode router-only --json
   ```

   Approval writes an approved snapshot, records the live digest, updates the skill metadata, and promotes the workflow preference/fallback policy for the chosen capability.

5. Reset deliberately when needed:

   ```bash
   skillboard variant reset claude.a --to-base --config skillboard.config.yaml --skills skills --yes --json
   skillboard variant reset claude.a --to-approved --config skillboard.config.yaml --skills skills --yes --json
   ```

   `--to-base` restores the base draft file and demotes workflow preference back to the base skill. `--to-approved` restores the approved snapshot and policy. Without `--yes`, mutating reset is rejected; use `--dry-run --json` to inspect the plan first.

## Metadata and snapshots

Variant metadata lives with the skill declaration in `skillboard.config.yaml`:

```yaml
skills:
  claude.a:
    variant:
      of: a
      capability: task-review
      workflow: claude-workflow
      status: approved
      adapted_for: claude
      base:
        content_digest: sha256:...
        snapshot: .skillboard/variant-snapshots/claude.a/base.md
      approved:
        content_digest: sha256:...
        snapshot: .skillboard/variant-snapshots/claude.a/approved.md
```

Snapshots are raw file records under `.skillboard/variant-snapshots/<encoded-skill-id>/`. That directory is created lazily by lifecycle commands such as `variant fork` and `variant approve`; `skillboard init` does not need to pre-create snapshot directories. A reset can restore the base or approved content safely from those records. The lifecycle helpers verify that snapshot and live paths stay inside the configured workspace before writing files.

## Safety boundaries

- `variant fork` and `variant add` create policy metadata; they do not make a newly edited skill equivalent to the base.
- `variant approve` should happen only after human review of the live `SKILL.md` body and the `variant status` digest output.
- `variant reset` writes files only through the safe replacement helper and refuses ambiguous reset targets.
- A variant is still governed by normal capability, workflow, exposure, install-unit, and invocation checks.
