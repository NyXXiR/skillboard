# SkillBoard Onboarding Current QA Matrix

Status: PASS
Date: 2026-06-24

## Scope

This matrix covers the current non-blocking onboarding implementation and the
five blocker closures found during review:

- unreviewed non-user source manual workflow bypass is denied;
- medium-risk unreviewed plugin manual workflow bypass is denied;
- `add skill --workflow` validates immediate `can-use` before writing;
- `doctor --strict` fails whenever `reviewRequired` is true;
- skill paths are normalized and rejected if they can escape the skills root.

## Evidence

| Scenario | Priority | Command / transcript | Result |
| --- | --- | --- | --- |
| Focused CLI regressions | P0 | `node --test test/cli.test.mjs --test-name-pattern "paths outside\|unreviewed non-user\|medium-risk\|add skill with workflow\|add workflow and harness"` | PASS: 46/46 CLI tests |
| Type diagnostics | P0 | `npm run diagnostics` -> `diagnostics.txt` | PASS |
| Medium-risk plugin bypass | P0 | `manual-medium-plugin-bypass.txt` | PASS: unreviewed plugin was rejected; trusted user skill workflow remained usable with `automaticAllowed: false` |
| First init safe mode | P0 | `manual-init-safe-mode.txt` | PASS: trusted Codex user skill got `codex-local-manual`; runtime plugin produced safe mode; strict doctor failed |
| First-time local adoption, manual growth, and path traversal | P0 | `manual-path-traversal.txt` | PASS: trusted local skill is usable immediately; new manual workflow is usable; `../../secret` is rejected with config unchanged |
| Full node test suite | P0 | `node --test` run in session after this matrix | PASS: 85/85 tests |
| Full package gate | P0 | `npm run check` run in session after this matrix | PASS: 85/85 tests |

## Size Note

The focused touched files are large because this repository currently keeps CLI
routing, control mutations, and CLI tests in monolithic files. Splitting
`src/control.mjs`, `src/cli.mjs`, or `test/cli.test.mjs` would be a broad
refactor beyond this user-requested onboarding change and would risk unrelated
churn in an already dirty worktree. The current patch follows the existing local
patterns and adds regression coverage around the changed behavior.
