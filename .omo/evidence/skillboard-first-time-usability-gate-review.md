# SkillBoard First-Time Usability Gate Review

recommendation: REJECT

## blockers

- Behavior blocker: `add workflow` can promote a plugin-owned `candidate` / `manual-only` skill from an unreviewed high-risk runtime install unit to `active-manual`, and `can-use` then allows it. This violates the goal constraint to keep risky runtime/plugin components review-gated. Evidence: `src/control.mjs:232` to `src/control.mjs:239` promotes any candidate/manual skill without checking trusted local ownership; `src/control.mjs:478` to `src/control.mjs:499` does not deny manual use for unreviewed high-risk/runtime units. Direct CLI probe returned exit 0 for `add workflow runtime-flow --skill plugin.manual`, then `can-use` returned `allowed: true` for an unreviewed plugin unit with `permission_risk: high` and hook components.
- Required current review artifacts are unsupported for this feature. The supplied assignment did not include executor evidence, code-review report, manual QA matrix, or notepad path. Existing artifacts under `.omo/evidence` are stale for earlier fixes: `.omo/evidence/latest-skillboard-fixes-code-review.md` and `.omo/evidence/skillboard-review-index.md` reference 59 tests and different lock/prefer/security work, while the current suite has 79 tests and this feature is init/inventory/adoption/doctor/add-workflow.
- The required code review coverage is absent for this feature state. No current code-review report explicitly covers the first-time usability feature with the same `remove-ai-slops` overfit/slop criteria and `programming` perspective coverage. Existing reports cannot support approval for this scope.
- Direct slop pass found unresolved maintainability slop in changed production and test files. Pure LOC exceeds the loaded `remove-ai-slops` / `programming` 250-line ceiling without a current split plan or `SIZE_OK` justification: `src/doctor.mjs` 276 new, `src/cli.mjs` 825, `src/control.mjs` 941, `src/agent-inventory.mjs` 769, and `test/cli.test.mjs` 2040. These files were part of the changed feature set, and the diff adds substantial code to already oversized modules.

## originalIntent

The user wanted SkillBoard to be usable after clone/npm install plus `skillboard init` for someone who already has manually created skills and multiple skills/workflows/harnesses. They specifically objected to manual review blocking immediately after install. The implementation should preserve existing setup, auto-adopt trusted local manual skills, still allow adding new skills/workflows/harnesses, and keep risky runtime/plugin components review-gated.

## desiredOutcome

- `skillboard init` scans existing local agent skill roots and makes trusted local user skills usable as manual skills without allowing automatic invocation.
- Existing workflows are preserved; newly discovered local user skills become manual candidates with review notes instead of being attached arbitrarily.
- System, runtime, plugin, and unreviewed risky components remain quarantined/blocked or otherwise review-gated.
- `skillboard doctor` defaults to a usable safe-mode exit when only review warnings exist, while `--strict` fails automation for risky runtime review.
- CLI/control APIs support adding harnesses and workflows, and workflow attachment validates the resulting policy/use state.
- Documentation and tests support the user-visible first-time flow.

## userOutcomeReview

REJECT. The main happy path is present and works in direct CLI verification: trusted local user skills are imported as `active-manual`, attached to `codex-local-manual`, allowed by `can-use`, and not automatic; system/plugin skills discovered by init remain quarantined/blocked; default doctor reports safe mode and strict mode exits 1 for high-risk runtime review.

The shipped artifact still fails the user's safety outcome because the new add-workflow path can make an unreviewed high-risk plugin/runtime skill usable when it is manually declared as `candidate` / `manual-only`. Since `writeCheckedConfig` trusts `can-use`, and `can-use` only denies unreviewed external sources for model-selectable invocations, the review gate is bypassed for manual invocation. That is directly in scope because the feature claims "add workflow can attach candidate manual skills as active-manual" while the goal requires risky runtime/plugin components to stay review-gated.

## checkedArtifactPaths

- `/home/nyxxir/.codex/plugins/cache/sisyphuslabs/omo/4.13.0/skills/remove-ai-slops/SKILL.md`
- `/home/nyxxir/.codex/plugins/cache/sisyphuslabs/omo/4.13.0/skills/programming/SKILL.md`
- `/home/nyxxir/.codex/plugins/cache/sisyphuslabs/omo/4.13.0/skills/programming/references/code-smells.md`
- `src/doctor.mjs`
- `src/cli.mjs`
- `src/control.mjs`
- `src/index.mjs`
- `src/agent-inventory.mjs`
- `src/inventory-refresh.mjs`
- `src/init.mjs`
- `src/lifecycle-cli.mjs`
- `src/lifecycle-content.mjs`
- `src/domain/constants.mjs`
- `src/domain/source-classes.mjs`
- `src/domain/rules/skills.mjs`
- `src/domain/rules/install-units.mjs`
- `src/domain/rules/workflows.mjs`
- `src/workspace.mjs`
- `src/policy.mjs`
- `test/cli.test.mjs`
- `README.md`
- `docs/install.md`
- `docs/user-flow.md`
- `docs/policy-model.md`
- `.omo/evidence/latest-skillboard-fixes-code-review.md`
- `.omo/evidence/affected-hands-on-qa/manualQa.md`
- `.omo/evidence/skillboard-review-index.md`
- `.omo/evidence/skillboard-review-notepad.md`
- `.omo/evidence/skillboard-final-gate-review.md`

## directVerification

- `npm test`: PASS, 79 tests, 0 failed.
- `npm run diagnostics`: PASS.
- `node --check bin/skillboard.mjs`: PASS.
- LSP diagnostics: no diagnostics for `src/doctor.mjs`, `src/cli.mjs`, `src/control.mjs`, `src/agent-inventory.mjs`, and `src/inventory-refresh.mjs`.
- Manual happy-path CLI scenario: PASS. Created temp Codex user, system, and plugin skill roots; ran `init`; observed 3 scanned skills, trusted local skill attached to `codex-local-manual`, system/plugin skills quarantined, default doctor `ok: true`, `reviewRequired: true`, `mode: safe-mode`, strict exit 1, and `can-use local-helper` allowed with `automaticAllowed: false`.
- Manual risky plugin candidate probe: FAIL. Created a config with `plugin.manual` as `candidate` / `manual-only`, owned by an enabled unreviewed plugin install unit with `permission_risk: high` and hook components. `add workflow runtime-flow --skill plugin.manual` exited 0 and promoted it to `active-manual`; `can-use plugin.manual` returned `allowed: true`.
- Direct `remove-ai-slops` overfit/slop pass: no deletion-only tests or tautological removal tests were found in the inspected feature tests; however, coverage misses the adversarial plugin-owned manual candidate path and large touched modules remain unresolved slop.
- Direct `programming` pass: diagnostics are clean, but file-size criteria fail on multiple touched modules with no current justification or split plan.

## exactEvidenceGaps

- No current executor evidence was supplied for this specific implemented feature set.
- No current code-review report was supplied or found that covers init/inventory/adoption/doctor/add-workflow with explicit `remove-ai-slops` and `programming` criteria.
- No current manual QA matrix was supplied or found for this first-time usability feature set. Existing `.omo/evidence/affected-hands-on-qa/manualQa.md` covers slash-command source verification, lockfile behavior, automatic activation refusal, and hook command execution, not the current onboarding/adoption paths.
- Existing notepad/index artifacts are stale for this review scope and reference an earlier 59-test state.
- No evidence artifact covers the adversarial class "plugin-owned or runtime-owned candidate/manual-only skill attached by `add workflow`".
- No artifact justifies the oversized changed modules under the loaded slop/programming criteria.
