# SkillBoard Security Code Review

Verdict: PASS
codeQualityStatus: WATCH
recommendation: APPROVE
blockers: none

## Scope Reviewed

- Workspace: `/mnt/i/workspace/skill-control-plane`
- Review target: current uncommitted working tree on `main`
- Focused files: `src/domain/source-classes.mjs`, `src/source-verification.mjs`, `src/install-units.mjs`, `src/control.mjs`, `src/cli.mjs`, `src/domain/rules/*.mjs`, and related tests.
- User-specified trust boundaries rechecked: `local.*` remote spoof, reserved `source_class: user`, slash-command source classification, lock write failure on verify errors, `--allow-unverified`, `activate`/`prefer` usability validation, hook symlink/path safety, generated hook command handling, disabled install units, empty `source_digest`, and non-callable fallback.
- No executor evidence was trusted without reinspection. Existing `.omo/evidence/*` artifacts were treated as prior context only.

## Skill-Perspective Check

- Ran: loaded and consulted `omo:remove-ai-slops` and `omo:programming` `SKILL.md` files before judging test relevance and maintainability.
- `remove-ai-slops` perspective: no CRITICAL/HIGH slop violations found. The security tests exercise observable CLI/policy outcomes with temp workspaces; they are not deletion-only tests, tautologies, or implementation-constant mirrors.
- `programming` perspective: no CRITICAL/HIGH violations found for this review scope. The implementation keeps trust checks at config/CLI boundaries and validates control writes before replacing the config. I did not apply style or module-size findings because the assignment says to ignore them unless they create direct security risk.

## CRITICAL

None.

## HIGH

None.

## MEDIUM

None.

## LOW

1. Positive `--allow-unverified` behavior is manually verified but not locked by a checked-in regression test.

   References: `src/source-verification.mjs:25`, `src/cli.mjs:270`, `test/cli.test.mjs:594`.

   The negative lock-write path is covered by `test/cli.test.mjs:594-639`, and my adversarial probe confirmed `--allow-unverified` writes only when explicitly passed and records `digest_verified: false`. A dedicated checked-in positive test would better preserve that intentional unsafe override behavior. This is not a blocker because the implemented behavior is correct and verified in this review.

## Boundary Recheck

- `local.*` remote spoof: PASS. `installUnitSourceClass()` ignores reserved configured `user` class and derives `user` only from local source references (`src/domain/source-classes.mjs:1-24`, `src/domain/source-classes.mjs:61-76`). A temp probe with `id: local.evil-pack`, `source: github.com/evil/skills`, and no explicit source class produced `sourceClass: skill-pack` and `can-use` denial for an unreviewed router skill.
- Reserved `source_class: user`: PASS. Non-local units using reserved `source_class: user` fail policy (`src/domain/rules/install-units.mjs:8-10`; checked by `test/policy-hardening.test.mjs:148-193`).
- Slash-command source classification: PASS. Slash commands are classified as command/metadata sources, not absolute local paths (`src/domain/source-classes.mjs:79-82`; `test/cli.test.mjs:552-588`).
- Lock write failure on verify errors: PASS. `writeLockfile()` verifies first and throws before write unless `allowUnverified` is true (`src/source-verification.mjs:25-31`; `test/cli.test.mjs:594-639`).
- `--allow-unverified`: PASS. Manual adversarial probe confirmed bad local digest writes a lock only with the explicit flag and records `digest_verified: false`.
- `activate`/`prefer` usability validation: PASS. Both paths call `writeCheckedConfig(... validateUse ...)` before rename (`src/control.mjs:155-160`, `src/control.mjs:220-224`). Checked-in `activate` negative coverage exists (`test/cli.test.mjs:645-705`), and a temp `prefer` probe against an unreviewed automatic external skill failed atomically with the original config preserved.
- Hook symlink/path safety: PASS. Hook install uses sanitized default filenames, refuses existing/symlink final paths, writes with `wx`, and verifies the result is a regular file (`src/control.mjs:321-455`; `test/cli.test.mjs:228-282`).
- Generated hook command handling: PASS. The generated hook supports command + argument invocation for `SKILLBOARD_BIN="node bin/skillboard.mjs"` and preserves quoted config/workflow/skills values (`src/control.mjs:403-425`; `test/cli.test.mjs:176-222`).
- Disabled install units: PASS. `can-use`/guard deny skills owned by disabled units (`src/control.mjs:356-367`; `test/cli.test.mjs:355-417`).
- Empty `source_digest`: PASS. Empty strings normalize to unpinned (`src/install-units.mjs:11-33`, `src/install-units.mjs:50-52`; `test/cli.test.mjs:423-457`).
- Non-callable fallback: PASS. Policy rejects blocked/quarantined/deprecated fallback and preferred capability skills (`src/domain/rules/workflows.mjs:76-104`; `test/policy-hardening.test.mjs:79-145`).

## Verification

- `node --check bin/skillboard.mjs`: PASS.
- `npm run diagnostics`: PASS.
- `npm test`: PASS, 57/57 tests.
- `npm run check`: PASS, 57/57 tests after syntax and diagnostics.
- Manual adversarial probe: PASS. Covered `--allow-unverified`, local-id remote spoof, remote reserved `source_class: user`, slash-command metadata classification, and `prefer` usability rejection/atomicity.

## Final Security Verdict

PASS. No CRITICAL or HIGH security issues remain in the reviewed trust-boundary fixes.
