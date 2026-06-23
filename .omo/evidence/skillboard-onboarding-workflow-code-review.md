# SkillBoard Onboarding/Workflow Code Review

## Status

- codeQualityStatus: BLOCK
- recommendation: REQUEST_CHANGES
- confidence: high
- reportPath: `.omo/evidence/skillboard-onboarding-workflow-code-review.md`

## Scope Reviewed

Requested scoped files:

- `src/doctor.mjs`
- `src/cli.mjs`
- `src/control.mjs`
- `src/index.mjs`
- `src/agent-inventory.mjs`
- `src/inventory-refresh.mjs`
- `src/init.mjs`
- `src/lifecycle-cli.mjs`
- `src/lifecycle-content.mjs`
- `test/cli.test.mjs`
- `README.md`
- `docs/install.md`
- `docs/user-flow.md`
- `docs/policy-model.md`

Notes:

- The worktree contains many unrelated dirty files. I focused on the requested behavior paths.
- `src/doctor.mjs`, `src/inventory-refresh.mjs`, and `docs/user-flow.md` are untracked in Git but were included in the requested scope and inspected.
- No notepad path or current evidence path list was provided by the user. Existing `.omo/evidence` artifacts were treated as untrusted; I ran fresh verification commands.

## Skill Perspective Check

- `omo:remove-ai-slops`: consulted. The diff violates this perspective in test/production maintainability: oversized changed files, brittle implementation-format assertions, and out-of-scope command/API surface mixed into the onboarding/workflow diff.
- `omo:programming`: consulted. The diff violates this perspective: several modified source/test files exceed the 250 pure-LOC ceiling, and new write paths do not consistently validate observable behavior.

## Verification Run

- `npm run check`: PASS, 79/79 tests passed. Includes `node --check`, `tsc -p tsconfig.lsp.json`, and `node --test`.
- `node --test test/cli.test.mjs`: PASS, 40/40 tests passed.
- `git diff --check -- <scoped files>`: FAIL. It reports widespread trailing-whitespace/CRLF churn in docs and source/test files.
- Manual reproduction: `doctor --strict --json` on a safe-mode quarantined-skill workspace exits 0 while reporting `"mode": "safe-mode"` and `"reviewRequired": true`.
- Manual reproduction: `add skill --workflow --invocation workflow-auto` can succeed for an unreviewed external owner, while immediate `can-use` denies the resulting skill.

## Findings By Severity

### CRITICAL

None.

### HIGH

1. `doctor --strict` does not actually fail every safe-mode/review-required state.

   References:
   - `src/doctor.mjs:101`
   - `src/doctor.mjs:102`
   - `src/doctor.mjs:108`
   - `src/cli.mjs:226`
   - `src/cli.mjs:234`

   `finalizeDoctor()` can set `reviewRequired: true` and `mode: "safe-mode"` because of quarantined skills, general source warnings, or high-risk install units, but `strictOk` only checks `result.sources.blockingWarnings.length === 0`. The CLI then exits based on `strictOk`, so `skillboard doctor --strict` can return success while the payload says safe mode and review required.

   This conflicts with the documented/advertised strict gate in `README.md` and `docs/install.md`, and it weakens CI/automation usage of the doctor command.

   Reproduced with a workspace containing a single `quarantined` / `blocked` skill:
   - exit code: 0
   - JSON: `"ok": true`, `"strictOk": true`, `"reviewRequired": true`, `"mode": "safe-mode"`

2. `add skill --workflow` can report success while leaving the resulting skill unusable.

   References:
   - `src/control.mjs:171`
   - `src/control.mjs:189`
   - `src/control.mjs:194`
   - `src/control.mjs:631`
   - `src/control.mjs:642`
   - `src/control.mjs:644`
   - `src/control.mjs:646`
   - `src/cli.mjs:365`
   - `src/cli.mjs:376`
   - `src/cli.mjs:384`

   `writeCheckedConfig()` already supports `validateUse` / `validateUses`, and `activateSkill()`, `preferSkill()`, and `addWorkflow()` use that path to reject writes that would not pass `can-use`. `addSkill()` attaches to a workflow but calls `writeCheckedConfig()` without `validateUse`.

   Reproduced by adding a workflow-auto skill owned by an unreviewed external install unit whose `components.skills` already includes the skill. The command returns 0 and writes the skill into `active_skills`; immediate `can-use` exits 2 with `Skill acme.skill is model-selectable but source acme.runtime is unreviewed.`

   This creates false success for a public control command and diverges from the safety semantics already enforced by `activate` and `prefer`.

### MEDIUM

1. Scoped diff has large CRLF/trailing-whitespace churn and fails `git diff --check`.

   References:
   - `README.md:1`
   - `docs/install.md:1`
   - `docs/policy-model.md:1`
   - `src/cli.mjs:38`
   - `src/init.mjs:5`
   - `test/cli.test.mjs:1`

   The diff appears to rewrite large portions of docs and several source/test files with CRLF line endings. This creates a noisy review surface, obscures the actual onboarding/workflow changes, and would leave whitespace errors if committed as-is.

2. The changed files are well over the programming skill's file-size ceiling.

   Pure LOC measured with blank/comment exclusion:

   - `src/control.mjs`: 941
   - `src/cli.mjs`: 825
   - `src/agent-inventory.mjs`: 769
   - `src/doctor.mjs`: 276
   - `test/cli.test.mjs`: 2041

   The implementation adds substantial new behavior to already-large modules instead of splitting responsibilities by command family, inventory merge logic, doctor reporting, and test scenario clusters. This is a maintainability risk even though tests pass.

3. The scoped CLI/API diff exposes extra command surface that is not part of the stated onboarding/workflow summary.

   References:
   - `src/cli.mjs:56`
   - `src/cli.mjs:58`
   - `src/cli.mjs:177`
   - `src/cli.mjs:193`
   - `src/index.mjs:10`
   - `src/index.mjs:11`
   - `src/index.mjs:55`
   - `src/index.mjs:62`

   `inventory detect` and `sources refresh` are wired into the public CLI/export surface from scoped files, but their implementation files are untracked and not included in the requested changed-file list. That makes the public API review boundary incomplete and mixes source-cache/runtime-output parsing into an onboarding/workflow change.

### LOW

1. Some tests assert YAML writer formatting and help/bridge text too tightly.

   References:
   - `test/cli.test.mjs:123`
   - `test/cli.test.mjs:128`
   - `test/cli.test.mjs:427`
   - `test/cli.test.mjs:428`
   - `test/cli.test.mjs:828`
   - `test/cli.test.mjs:829`

   These tests do exercise real CLI workflows, so they are not useless. The weaker part is that several assertions pin exact emitted YAML line order/spacing or bridge text snippets rather than parsed config semantics. That increases false-negative risk when the YAML emitter changes without behavioral drift.

## Blockers

1. Make `doctor --strict` fail whenever the result is in safe mode / review required, or explicitly narrow and redocument strict semantics. Add tests for non-blocking review-required states such as quarantined skills.
2. Make `addSkill()` validate `can-use` when `options.workflow` is provided, matching `activateSkill()`, `preferSkill()`, and `addWorkflow()`. Add a regression test for `add skill --workflow --invocation workflow-auto` with an unreviewed external owner.
3. Clean the CRLF/trailing-whitespace churn before approval. The scoped diff currently fails `git diff --check`.

## Summary

The implementation has useful coverage and the project verification suite passes, but the strict doctor gate and `add skill --workflow` safety semantics are not correct. The diff also has significant maintainability issues from line-ending churn and oversized modules. Request changes before approval.
