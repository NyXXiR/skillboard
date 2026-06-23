# SkillBoard Doctor/Status Security Review

Result: FAIL

codeQualityStatus: BLOCK
recommendation: REQUEST_CHANGES

Scope reviewed:
- `/mnt/i/workspace/skill-control-plane/src/doctor.mjs`
- `/mnt/i/workspace/skill-control-plane/src/uninstall.mjs`
- `/mnt/i/workspace/skill-control-plane/src/source-verification.mjs`
- `/mnt/i/workspace/skill-control-plane/src/cli.mjs`
- Related source audit and policy code in `/mnt/i/workspace/skill-control-plane/src/control.mjs` and `/mnt/i/workspace/skill-control-plane/src/domain/source-classes.mjs`

Input caveat: no full review diff was provided. I inspected the current worktree directly; `src/doctor.mjs` is currently untracked.

Skill-perspective check:
- Consulted `omo:remove-ai-slops` and `omo:programming` SKILL.md files before judging tests and maintainability.
- `remove-ai-slops` perspective: no deletion-only or tautological tests found in the inspected doctor tests, but the tests are too happy-path focused for the new safety claims.
- `programming` perspective: the implementation violates boundary discipline around path parsing/trust, and `src/cli.mjs` is 600 pure LOC after this change, above the 250 LOC ceiling.

## CRITICAL

None found.

## HIGH

1. `doctor --verify` can read and hash arbitrary files outside the project.

`doctorProject` passes `--verify` directly into `verifySources` at `/mnt/i/workspace/skill-control-plane/src/doctor.mjs:63` and `/mnt/i/workspace/skill-control-plane/src/doctor.mjs:64`; the CLI exposes that through `/mnt/i/workspace/skill-control-plane/src/cli.mjs:155` to `/mnt/i/workspace/skill-control-plane/src/cli.mjs:160`. Source verification treats `~/`, absolute paths, and `../` local paths as valid local sources at `/mnt/i/workspace/skill-control-plane/src/source-verification.mjs:192` to `/mnt/i/workspace/skill-control-plane/src/source-verification.mjs:207`, then recursively digests them and reads regular file bytes at `/mnt/i/workspace/skill-control-plane/src/source-verification.mjs:151` to `/mnt/i/workspace/skill-control-plane/src/source-verification.mjs:180`.

Impact: an untrusted `skillboard.config.yaml` can make doctor/status read and hash files outside `--dir`, including parent-directory secrets or large filesystem trees. The JSON payload returns `verifiedPath` and `actualDigest`, so it leaks absolute paths and content-derived digests. My temp probe with `source: ../outside-secret.txt` returned `ok: true`, `verifiedPath` outside the project root, and a computed digest.

2. Dangerous runtime-extension/high-risk states are reported as passing status.

`sourceAuditFindings` records high-risk unreviewed sources, unreviewed runtime extensions, and unpinned non-user sources only as warnings at `/mnt/i/workspace/skill-control-plane/src/control.mjs:391` to `/mnt/i/workspace/skill-control-plane/src/control.mjs:398`. `auditSources` sets `ok` from errors only at `/mnt/i/workspace/skill-control-plane/src/control.mjs:311` to `/mnt/i/workspace/skill-control-plane/src/control.mjs:318`. `finalizeDoctor` then marks doctor `ok` using `result.sources.ok` and `result.policy.ok` only at `/mnt/i/workspace/skill-control-plane/src/doctor.mjs:91` to `/mnt/i/workspace/skill-control-plane/src/doctor.mjs:97`; the CLI exits 0 when `result.ok` is true at `/mnt/i/workspace/skill-control-plane/src/cli.mjs:155` to `/mnt/i/workspace/skill-control-plane/src/cli.mjs:164`.

Impact: `skillboard doctor` can print/pass `ok: true` for an enabled, high-risk, unreviewed plugin that provides hooks. My temp probe produced `ok: true` with warnings for "high-risk source is not reviewed or trusted", "runtime extension source is unreviewed", and "source is not pinned by digest or signature". That under-reports exactly the class of dangerous runtime extension state this status command is meant to surface.

3. The uninstall dry-run plan used by doctor follows symlinks; real uninstall can write through a symlinked bridge file.

Doctor includes an uninstall plan by calling `uninstallProject` with `dryRun: true` at `/mnt/i/workspace/skill-control-plane/src/doctor.mjs:16` to `/mnt/i/workspace/skill-control-plane/src/doctor.mjs:21`, then renders only counts at `/mnt/i/workspace/skill-control-plane/src/cli.mjs:587` to `/mnt/i/workspace/skill-control-plane/src/cli.mjs:589`. `removeBridge` uses `readFile(path)` and, on non-empty bridge removal, `writeFile(path, next)` without `lstat`/non-symlink checks at `/mnt/i/workspace/skill-control-plane/src/uninstall.mjs:79` to `/mnt/i/workspace/skill-control-plane/src/uninstall.mjs:97`. Generated file and directory checks also use symlink-following operations at `/mnt/i/workspace/skill-control-plane/src/uninstall.mjs:126` to `/mnt/i/workspace/skill-control-plane/src/uninstall.mjs:149`.

Impact: doctor itself does not write because the write calls are guarded by `!dryRun`, but its advertised uninstall dry-run can be based on symlink targets, and the actual uninstall path can mutate an out-of-project symlink target for `AGENTS.md`/`CLAUDE.md` when the target contains user content plus a bridge block. Doctor/status should not present that as an ordinary safe update.

## MEDIUM

1. `--dir` does not constrain `--config` or `--skills`.

`doctorProject` resolves `root`, `configPath`, and `skillsRoot` at `/mnt/i/workspace/skill-control-plane/src/doctor.mjs:11` to `/mnt/i/workspace/skill-control-plane/src/doctor.mjs:14`, but `resolveUnderRoot` returns absolute paths unchanged and lets relative `../` escape root at `/mnt/i/workspace/skill-control-plane/src/doctor.mjs:223` to `/mnt/i/workspace/skill-control-plane/src/doctor.mjs:224`. `loadWorkspace` then recursively scans whatever `skillsRoot` points at at `/mnt/i/workspace/skill-control-plane/src/workspace.mjs:37` to `/mnt/i/workspace/skill-control-plane/src/workspace.mjs:68`.

Impact: automation can believe it is checking one project via `--dir` while doctor/status reads config or scans skills elsewhere. If this is intentional, the output and docs need to make the trust boundary explicit; otherwise path containment should be enforced.

## LOW

1. Existing tests do not cover the new safety boundaries.

Doctor tests only cover an empty project and a normal initialized project at `/mnt/i/workspace/skill-control-plane/test/cli.test.mjs:139` to `/mnt/i/workspace/skill-control-plane/test/cli.test.mjs:180`. Source verification tests cover ordinary local digest verification and command metadata behavior at `/mnt/i/workspace/skill-control-plane/test/cli.test.mjs:719` to `/mnt/i/workspace/skill-control-plane/test/cli.test.mjs:848`. There are no tests for `doctor --verify`, `../` or absolute source escape, symlinked bridge files, warning-only runtime extension states, or escaped `--config`/`--skills`.

2. CLI module size is now a maintainability risk.

Measured pure LOC:
- `src/doctor.mjs`: 214
- `src/uninstall.mjs`: 155
- `src/source-verification.mjs`: 229
- `src/cli.mjs`: 600

`src/cli.mjs` now contains command dispatch, option parsing, output rendering, and many command implementations. The added doctor/status rendering increases an already oversized file and makes future safety reviews harder.

## Evidence

Commands run:
- `npm run diagnostics` passed.
- `node --test --test-name-pattern "doctor|audit verify" test/cli.test.mjs` passed: 4 tests, 0 failures.
- Temp probe confirmed warning-only risky runtime extension returns `ok: true` and exits successfully.
- Temp probe confirmed `doctor --verify` digests `../outside-secret.txt`, returns an out-of-project `verifiedPath`, and still returns `ok: true`.

## Blockers

- Constrain source verification to approved roots or require an explicit, clearly named unsafe override before reading/hashing outside the project or configured cache root.
- Make doctor/status fail, or at least return a non-clear status/exit code, for enabled high-risk unreviewed runtime extensions and equivalent dangerous warning-only states.
- Add symlink-safe handling to uninstall dry-run and real uninstall paths; refuse or explicitly report symlinked bridge/generated/managed directory paths before any actual uninstall write can follow them.
- Add regression tests for the unsafe path, warning-only runtime extension, symlink, and doctor `--verify` cases.
