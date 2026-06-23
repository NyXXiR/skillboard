# SkillBoard Onboarding Blockers Gate Review

recommendation: REJECT

blockers:

- Required current review evidence is stale/unsupported for this re-review. The relevant onboarding code-review artifact, `.omo/evidence/skillboard-onboarding-workflow-code-review.md`, still says `recommendation: REQUEST_CHANGES` and still lists `doctor --strict` and `add skill --workflow` as HIGH blockers. The index/notepad point to older 59-test evidence, while fresh execution now reports 83 tests. No current code-review report was found that approves the four specific fixes and explicitly re-covers `remove-ai-slops` overfit/slop criteria plus `programming` criteria.
- Required current manual QA matrix for these four blocker closures was not found. `.omo/evidence/affected-hands-on-qa/manualQa.md` covers slash-command source verification, lockfile behavior, activation refusal, and hook command execution, not the four current onboarding blockers.
- Direct `programming`/`remove-ai-slops` pass still finds unresolved maintainability slop in the focused touched files: `src/control.mjs` is 947 pure LOC, `src/doctor.mjs` is 276 pure LOC, and `test/cli.test.mjs` is 2297 pure LOC, all above the loaded 250 pure-LOC ceiling without a current split plan or `SIZE_OK`-style justification. The four new tests themselves are observable CLI tests, not deletion-only, tautological, or pure implementation mirrors.

## originalIntent

The user asked for a read-only executable re-review of whether four previously reported SkillBoard onboarding blockers are fixed:

1. `add workflow` could promote unreviewed plugin/runtime `candidate` / `manual-only` skills to `active-manual`, and `can-use` allowed the result.
2. `doctor --strict` could exit 0 while `reviewRequired` was true but `blockingWarnings` was empty.
3. `add skill --workflow` could write a skill that immediate `can-use` denied.
4. A security retry found a medium-risk unreviewed plugin manual bypass, not only high-risk/runtime cases.

## desiredOutcome

The shipped workspace should refuse unreviewed enabled non-user sources for manual workflow attachment, validate all workflow-affecting writes with `can-use` before committing config changes, make strict doctor fail for all review-required safe-mode states, and include current tests/evidence proving those outcomes.

## userOutcomeReview

Functional blocker recheck: PASS.

- `trustUseReasons()` now denies any enabled unreviewed non-user source, independent of model-selectability, high risk, or runtime components (`src/control.mjs:481-506`).
- `addWorkflow()` still performs candidate/manual promotion on a temp config, but it now validates each resulting skill use through `writeCheckedConfig(... validateUses ...)` before rename (`src/control.mjs:219-272`, `src/control.mjs:637-663`).
- `addSkill()` validates immediate usability when `--workflow` is supplied (`src/control.mjs:171-197`).
- `doctorProject()` computes `strictOk` as `ok && !reviewRequired`, and CLI strict exit uses `result.strictOk` (`src/doctor.mjs:97-108`, `src/cli.mjs:226-234`).
- The four named regression tests exist in `test/cli.test.mjs:437`, `test/cli.test.mjs:523`, `test/cli.test.mjs:591`, and `test/cli.test.mjs:688`.

Final gate result: REJECT because the required supporting artifact package is stale/missing for this current fix set, and the direct slop/programming pass has unresolved file-size slop.

## checkedArtifactPaths

- `/home/nyxxir/.codex/plugins/cache/sisyphuslabs/omo/4.13.0/skills/remove-ai-slops/SKILL.md`
- `/home/nyxxir/.codex/plugins/cache/sisyphuslabs/omo/4.13.0/skills/programming/SKILL.md`
- `src/control.mjs`
- `src/doctor.mjs`
- `src/cli.mjs`
- `src/domain/source-classes.mjs`
- `src/install-units.mjs`
- `src/domain/constants.mjs`
- `src/policy.mjs`
- `test/cli.test.mjs`
- `package.json`
- `.omo/evidence/skillboard-onboarding-workflow-code-review.md`
- `.omo/evidence/skillboard-review-index.md`
- `.omo/evidence/skillboard-review-notepad.md`
- `.omo/evidence/affected-hands-on-qa/manualQa.md`
- `.omo/evidence/skillboard-final-gate-review.md`
- `.omo/evidence/latest-skillboard-fixes-code-review.md`
- `.omo/evidence/skillboard-security-review-code-review.md`

## directVerification

- Focused regression command: `node --test --test-name-pattern "cli add workflow refuses unreviewed non-user source manual bypass|cli add workflow refuses medium-risk unreviewed plugin manual bypass|cli add skill with workflow validates immediate usability|cli doctor strict fails review-required state without source blocking warnings" test/cli.test.mjs` passed 4/4.
- Aggregate command: `npm run check` passed. It ran `node --check bin/skillboard.mjs`, `tsc -p tsconfig.lsp.json`, and `node --test`, with 83 passing tests.
- Direct source inspection found no remaining functional bypass in the four specified blocker classes.

## exactEvidenceGaps

- No current approved code-review report was found for the current four blocker closures.
- The most relevant code-review report is stale and still rejects the implementation for two now-fixed blockers.
- No current manual QA matrix was found for the four current blocker closures.
- The active review index/notepad are stale for this state: they reference a 59-test evidence set, while fresh verification now has 83 passing tests.
- `src/doctor.mjs` is untracked in `git status`, so the tracked diff alone does not capture one scoped source file.
- No current artifact justifies the focused oversized modules under the loaded `programming` and `remove-ai-slops` criteria.
