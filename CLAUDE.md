<!-- BEGIN SKILLBOARD -->
# SkillBoard Control Plane

Your responsibility is to answer skill availability questions from SkillBoard, translate user intent into current action ids, ask for one confirmation only before policy-changing actions, apply one current action, reread the post-apply brief, and run the guard automatically before invocation.

## Product Goal

- SkillBoard is a permissive AI skill routing layer, not a pre-task settings checklist.
- Keep installed skills broadly available by default; use SkillBoard to resolve overlap when several skills could steer the same task.
- Read `docs/ai-skill-routing-goal.md` before changing routing, brief, bridge, policy, or workflow UX.
- Preserve the loop: observe → route → work → explain briefly → ask after → remember policy.
- SkillBoard does not rewrite `SKILL.md` bodies to personalize behavior; record usage policy for when to use, prefer, reference, avoid, or block skills.

## Availability

- Use SkillBoard as the source of truth for project-local policy and workflow priority; installed `SKILL.md` files are candidates, not enough to resolve overlap by themselves.
- Read the current brief before answering: `skillboard brief --json --config skillboard.config.yaml --skills skills`. If the workflow is known, include `--workflow <name>`; add `--include-actions` when the user wants you to mediate a change.
- For ordinary user requests, work normally unless skill choice is ambiguous, several skills overlap, workflow priority matters, or the user explicitly asks for a SkillBoard or skill decision. In those cases, read `skillboard brief --intent <request> --json --config skillboard.config.yaml --skills skills`. Include `--workflow <name>` when known. Read `assistant_guidance.route`; use `recommended_skill`, `fallback_skills`, `route_candidates`, `overlap_resolution`, `policy_memory`, `post_use_policy_suggestion`, and `guard_command` instead of guessing from raw skill text. Inspect `overlap_resolution` and `route_candidates` when several skills match so allowed overlap, denied candidates, and selected fallbacks are clear. If `policy_memory` is present, mention after completion that remembered or configured policy selected this skill even though other allowed skills were available. If `post_use_policy_suggestion` is present, work first with the allowed routed skill, then ask after completion whether to remember the suggested policy. If no skill matches, ask a clarifying question before choosing a skill.
- If the user explicitly requests a specific already-allowed skill, honor that request after guard use instead of rerouting away solely because another skill also matches.
- Treat the brief sections headed "What your AI can use now", "Needs your decision", and "Blocked for safety" as the availability summary; do not infer availability from `SKILL.md` bodies.
- Treat "Needs your decision" as a one-time decision queue, not a persistent blocked state. "Blocked for safety" means the skill/source/workflow is hard-blocked until policy or provenance changes.
- Use `skillboard can-use <skill-id> --workflow <name> --config skillboard.config.yaml --skills skills --json` for machine-readable agent decisions.

## Intent to Action

- Translate user intent into current action ids from the current brief, not saved output.
- For action cards, read `skillboard brief --json --config skillboard.config.yaml --skills skills --include-actions`, pick one current action id, ask the user for one confirmation, then run `skillboard apply-action <action-id> --config skillboard.config.yaml --skills skills --yes --json`. Include `--workflow <name>` when a workflow is selected.
- After `skillboard apply-action <action-id> ... --yes --json`, reread the returned post-apply brief before answering the next availability question or applying another action. `apply-action` re-resolves current actions; do not apply cached or stale action ids, do not apply multiple actions, and do not run raw action-card shell text as the primary apply path.
- For an already-allowed skill, do not ask for another approval. Run `skillboard guard use <skill-id> --workflow <name> --config skillboard.config.yaml --skills skills` automatically. Say at the start: "I will use <skill-id> for this request." Say at completion: "I used <skill-id> for this request." Treat this disclosure as an audit trace, not a permission prompt. Ask the user only if the guard denies use or a policy-changing action is needed.

## Operations

- Source trust: run `skillboard audit sources --config skillboard.config.yaml --skills skills` before trusting newly imported external skill sources; after review, use `skillboard review install-unit <unit-id> --trust-level reviewed --config skillboard.config.yaml --skills skills`. Unreviewed runtime sources are a one-time review decision, not a default block recommendation; after review, activate only the needed quarantined skills as manual-only workflow skills and use ask-after policy suggestions for future preferences.
- Health: run `skillboard doctor --config skillboard.config.yaml --skills skills` or `skillboard status --config skillboard.config.yaml --skills skills --json`; add `--strict` when review-needed safe mode should fail automation.
- Hook action cards: prefer `skillboard apply-action <action-id> --yes --json`. The underlying manual preview is `skillboard hook install --workflow <name> --config skillboard.config.yaml --skills skills --out .skillboard/hooks/<name>-guard.sh --dry-run --json`; inspect `planned.preview.shell` before materializing an executable guard hook outside the action-card control loop. Generated hooks pin the install-time SkillBoard command, config, skills root, and workflow; set those values with hook install options such as `--skillboard-bin`, not runtime environment overrides.
- Inventory/import growth: run `skillboard inventory refresh --dry-run --config skillboard.config.yaml` after installing local skill packs, plugins, workflow bundles, or harnesses; run `skillboard import --profile <id-or-path> --source-root <repo> --out .skillboard/reports/import-fragment.yaml` after installing a new skill repository, then review the fragment before merging it into `skillboard.config.yaml`.
- Prefer workflow-scoped skills over global skill invocation. Only `global-meta` skills may be treated as globally available.

<!-- END SKILLBOARD -->
