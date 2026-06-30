<!-- BEGIN SKILLBOARD -->
# SkillBoard Control Plane

Your responsibility is to answer skill availability questions from SkillBoard, translate user intent into current action ids, ask for one confirmation, apply one current action, reread the post-apply brief, and guard before invocation.

## Availability

- Use SkillBoard as the source of truth; installed `SKILL.md` files are not automatically callable.
- Read the current brief before answering: `skillboard brief --json --config skillboard.config.yaml --skills skills`. If the workflow is known, include `--workflow <name>`; add `--include-actions` when the user wants you to mediate a change.
- Treat the brief sections headed "What your AI can use now", "Needs your decision", and "Blocked for safety" as the availability summary; do not infer availability from `SKILL.md` bodies.
- Treat "Needs your decision" as a one-time decision queue, not a persistent blocked state. "Blocked for safety" means the skill/source/workflow is hard-blocked until policy or provenance changes.
- Use `skillboard can-use <skill-id> --workflow <name> --config skillboard.config.yaml --skills skills --json` for machine-readable agent decisions.

## Intent to Action

- Translate user intent into current action ids from the current brief, not saved output.
- For action cards, read `skillboard brief --json --config skillboard.config.yaml --skills skills --include-actions`, pick one current action id, ask the user for one confirmation, then run `skillboard apply-action <action-id> --config skillboard.config.yaml --skills skills --yes --json`. Include `--workflow <name>` when a workflow is selected.
- After `skillboard apply-action <action-id> ... --yes --json`, reread the returned post-apply brief before answering the next availability question or applying another action. `apply-action` re-resolves current actions; do not apply cached or stale action ids, do not apply multiple actions, and do not run raw action-card shell text as the primary apply path.
- Immediately before actual invocation, guard before invocation with `skillboard guard use <skill-id> --workflow <name> --config skillboard.config.yaml --skills skills`.

## Operations

- Source trust: run `skillboard audit sources --config skillboard.config.yaml --skills skills` before trusting newly imported external skill sources; after review, use `skillboard review install-unit <unit-id> --trust-level reviewed --config skillboard.config.yaml --skills skills`.
- Health: run `skillboard doctor --config skillboard.config.yaml --skills skills` or `skillboard status --config skillboard.config.yaml --skills skills --json`; add `--strict` when review-needed safe mode should fail automation.
- Hook action cards: prefer `skillboard apply-action <action-id> --yes --json`. The underlying manual preview is `skillboard hook install --workflow <name> --config skillboard.config.yaml --skills skills --out .skillboard/hooks/<name>-guard.sh --dry-run --json`; inspect `planned.preview.shell` before materializing an executable guard hook outside the action-card approval loop.
- Inventory/import growth: run `skillboard inventory refresh --dry-run --config skillboard.config.yaml` after installing local skill packs, plugins, workflow bundles, or harnesses; run `skillboard import --profile <id-or-path> --source-root <repo> --out .skillboard/reports/import-fragment.yaml` after installing a new skill repository, then review the fragment before merging it into `skillboard.config.yaml`.
- Prefer workflow-scoped skills over global skill invocation. Only `global-meta` skills may be treated as globally available.

<!-- END SKILLBOARD -->
