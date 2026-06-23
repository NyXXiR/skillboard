# SkillBoard Onboarding/Workflow Security Gate Review

recommendation: REJECT

securityVerdict: FAIL

severity: HIGH

## blockers

1. HIGH - `skillboard add skill --path` accepts traversal paths and can create an automatically allowed workflow skill outside the configured skills root.

   Evidence:
   - CLI passes `--path` through without validation: `src/cli.mjs:373-388`.
   - `addSkill()` writes `options.path` directly into YAML and, when `--workflow` is present, adds the skill to `active_skills` without a `validateUse` recheck: `src/control.mjs:171-194`.
   - Lockfile digesting later reads `join(skillsRoot, skill.path, "SKILL.md")`, so `../../secret` escapes `--skills`: `src/source-verification.mjs:236-250`.
   - Direct repro in a temp workspace:
     - `node bin/skillboard.mjs add skill evil.path --path ../../secret --config <tmp>/project/skillboard.config.yaml --skills <tmp>/project/skills` exited `0`.
     - `node bin/skillboard.mjs lock write --config <tmp>/project/skillboard.config.yaml --skills <tmp>/project/skills --out <tmp>/project/lock.yaml --allow-unverified` exited `0`.
     - The lockfile recorded `evil.path.content_digest: sha256:6ef2f1f279a5275359e0be78f73478b09661b6d0be5431c9611980ca66824477`, which matches `sha256("SECRET_OUTSIDE_SKILLS_ROOT\n")` from `<tmp>/secret/SKILL.md`.
   - Direct automatic invocation repro:
     - `node bin/skillboard.mjs add skill outside.auto --path ../../secret --workflow wf --invocation workflow-auto --config <tmp>/project/skillboard.config.yaml --skills <tmp>/project/skills` exited `0`.
     - `node bin/skillboard.mjs can-use outside.auto --workflow wf --config <tmp>/project/skillboard.config.yaml --skills <tmp>/project/skills --json` exited `0` with `"allowed": true` and `"automaticAllowed": true`.

2. Gate criteria failure - required slop/programming pass finds unresolved oversized mixed-responsibility modules in the reviewed scope.

   Evidence:
   - Pure LOC measurements: `src/control.mjs` 941, `src/cli.mjs` 825, `src/agent-inventory.mjs` 769, `src/doctor.mjs` 276.
   - `omo:programming` and `omo:remove-ai-slops` criteria define `>250` pure LOC as a defect unless justified by a `SIZE_OK`-style exception or equivalent. No such exception was found in these files.
   - This is secondary to the security blocker above, but it also fails the final gate criteria.

## originalIntent

The user requested a read-only security review for the SkillBoard onboarding/workflow implementation, focused on:

- CLI inputs for adding workflows, harnesses, and skills.
- YAML writes.
- Temp config write/rename behavior.
- Path handling.
- Scanner trust classification.
- Safe-mode vs strict behavior.
- Preventing automatic invocation of unreviewed runtime/plugin/system skills.
- Avoiding unsafe command execution.

The expected output was a PASS/FAIL security verdict with severity, blocking issues, findings, and summary.

## desiredOutcome

The shipped implementation should reject path traversal and unsafe activation paths, preserve config atomically on failed policy/use validation, keep runtime/plugin/system skill imports non-automatic unless reviewed/trusted, classify scanner trust without downgrade, and have evidence that adversarial security cases are covered.

## userOutcomeReview

FAIL. From the user's perspective, the implementation does not satisfy the requested path-handling or unsafe-activation outcome:

- A skill path documented as a relative skill path can escape the configured `--skills` root.
- The escaped path is consumed by lockfile digest generation.
- The same escaped skill can be marked workflow-auto and reported by `can-use` as automatically allowed because direct workspace skills are treated as trusted.
- Existing tests and prior security evidence did not cover this adversarial class.

## findings

- PASS - Temp config write/rename for control updates uses a same-directory random temp file, `flag: "wx"`, policy validation on the temp config, optional `canUseSkill` validation for activation/preference/workflow additions, and `rename` only after validation: `src/control.mjs:631-658`.
- PASS - `activate` and `prefer` reject unreviewed automatic external skills through `validateUse`/`canUseSkill`: `src/control.mjs:149-168`, `src/control.mjs:313-347`, `src/control.mjs:478-499`; checked by current tests `test/cli.test.mjs`.
- PASS - `add workflow` rejects quarantined/blocked/deprecated skills and validates each resulting use: `src/control.mjs:216-269`, `src/control.mjs:973-981`.
- PASS - Hook install avoids overwriting existing/symlink paths and writes with `wx`: `src/control.mjs:443-459`, `src/control.mjs:560-576`.
- PASS with caveat - Generated hook command handling did not show shell metacharacter re-evaluation; `SKILLBOARD_BIN` is shell-quoted at generation time and executed via `exec "$@"`. The intentional unquoted split at `src/control.mjs:543-547` still supports argument splitting and glob expansion, so it should remain documented and tested.
- REVIEW GAP - `resolveUnderRoot()` in `src/doctor.mjs:289-291` and `src/inventory-refresh.mjs:43-45` does not enforce root containment. This may be intended because docs allow explicit `--config <path>`, but the helper name and `--dir` UX make the trust boundary ambiguous.

## checkedArtifactPaths

- `src/control.mjs`
- `src/cli.mjs`
- `src/agent-inventory.mjs`
- `src/doctor.mjs`
- `src/inventory-refresh.mjs`
- `src/init.mjs`
- `src/source-verification.mjs`
- `src/workspace.mjs`
- `src/domain/source-classes.mjs`
- `src/domain/rules/skills.mjs`
- `src/domain/rules/workflows.mjs`
- `src/domain/rules/install-units.mjs`
- `test/cli.test.mjs`
- `test/policy-hardening.test.mjs`
- `test/skillboard.test.mjs`
- `.omo/evidence/skillboard-security-review-code-review.md`
- `.omo/evidence/skillboard-final-gate-review.md`
- `.omo/evidence/skillboard-review-notepad.md`
- `.omo/evidence/affected-hands-on-qa/manualQa.md`
- `README.md`
- `docs/install.md`
- `docs/policy-model.md`

## directVerification

- Loaded and applied `omo:remove-ai-slops` criteria directly over the focused production code, tests, and diff surface.
- Loaded and applied `omo:programming` criteria directly for architecture/slop review. No code was edited.
- `npm run check`: PASS; syntax check, diagnostics, and Node test suite passed with 79/79 tests.
- `rg` over tests/docs found no checked-in traversal rejection coverage for `add skill --path`.
- Direct temp-workspace CLI repro confirmed the path traversal and outside-root digest.
- Direct temp-workspace CLI repro confirmed `automaticAllowed: true` for a workflow-auto skill declared with `--path ../../secret`.

## exactEvidenceGaps

- The prompt did not include a bounded changed-file list, executor evidence bundle, code review report path, manual QA matrix path, or notepad path. I located likely `.omo/evidence/*` artifacts myself and treated them as untrusted.
- Prior `.omo/evidence/skillboard-security-review-code-review.md` reports PASS and includes `remove-ai-slops`/`programming` perspective coverage, but it did not inspect or test `add skill --path` traversal.
- Existing checked-in tests cover many activation/trust cases but do not assert that `add skill --path` rejects `..`, absolute paths, Windows absolute paths, or paths resolving outside `--skills`.
- Existing QA artifacts cover slash-command source verification, bad digest locking, explicit `--allow-unverified`, unreviewed automatic activation refusal, and hook command execution, but not skill path containment.
- No evidence was found that downstream consumers of `skill.path` consistently enforce containment; `renderLockfile()` demonstrably does not.

## summary

REJECT. The implementation has a confirmed path traversal and automatic invocation policy bypass for direct skills added through the new onboarding CLI. Green tests do not mitigate this because the adversarial class is absent from the suite.
