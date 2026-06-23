# manualQa

## surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| S1 | npm run diagnostics | terminal CLI | `npm run diagnostics` | PASS | A1 |
| S2 | npm run check | terminal CLI | `npm run check` | PASS | A2 |
| S3 | audit sources --verify with slash command source | terminal CLI | `node bin/skillboard.mjs audit sources --verify --config <tmp>/skillboard.config.yaml --skills <tmp>/skills --json` | PASS | A3 |
| S4 | lock write with bad source_digest exits nonzero and does not write | terminal CLI | `node bin/skillboard.mjs lock write --config <tmp>/skillboard.config.yaml --skills <tmp>/skills --out <tmp>/skillboard.lock.yaml` | PASS | A4 |
| S5 | lock write --allow-unverified writes with bad source_digest | terminal CLI | `node bin/skillboard.mjs lock write --config <tmp>/skillboard.config.yaml --skills <tmp>/skills --out <tmp>/skillboard.lock.yaml --allow-unverified --json` | PASS | A5 |
| S6 | activate unreviewed external workflow-auto fails and preserves config | terminal CLI | `node bin/skillboard.mjs activate vendor.router --workflow review-workflow --mode workflow-auto --config <tmp>/skillboard.config.yaml --skills <tmp>/skills` | PASS | A6 |
| S7 | hook install with custom skillboard bin works | terminal CLI plus generated shell hook | `node bin/skillboard.mjs hook install --workflow codex-night-workflow --config examples/multi-source.config.yaml --skills examples/multi-source-skills --out <tmp>/codex-night-workflow-guard.sh --skillboard-bin 'node bin/skillboard.mjs' --json`; corrected secondary: `<tmp>/codex-night-workflow-guard.sh matt.tdd` | PASS | A7 |

## adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| S3 | audit slash command source | command-like source path | classify as metadata-only, exit 0, warn about missing source_digest pin | PASS | A3 |
| S4 | lock write bad source_digest | tampered or stale local source digest | exit nonzero and leave requested lockfile absent | PASS | A4 |
| S5 | lock write --allow-unverified | explicit override of verification failure | exit 0 and write non-empty lockfile with `digest_verified: false` | PASS | A5 |
| S6 | activate unreviewed external workflow-auto | unsafe automatic activation of unreviewed external source | fail with usability error and preserve config byte-for-byte | PASS | A6 |
| S7 | hook install custom command string | command with arguments in generated hook | generated hook remains executable and splits `node bin/skillboard.mjs` successfully | PASS | A7 |

## artifactRefs

| id | kind | description | path |
|---|---|---|---|
| A1 | terminal transcript | diagnostics command output and exit code | `.omo/evidence/affected-hands-on-qa/s1-diagnostics.txt` |
| A2 | terminal transcript | check command output, test summary, and exit code | `.omo/evidence/affected-hands-on-qa/s2-check.txt` |
| A3 | terminal transcript | slash command source fixture, audit JSON, and exit code | `.omo/evidence/affected-hands-on-qa/s3-audit-slash-source.txt` |
| A4 | terminal transcript | bad digest lock write stderr, exit code, and missing lockfile check | `.omo/evidence/affected-hands-on-qa/s4-lock-bad-digest.txt` |
| A5 | terminal transcript | allow-unverified lock write output and lockfile contents | `.omo/evidence/affected-hands-on-qa/s5-lock-allow-unverified.txt` |
| A6 | terminal transcript | unreviewed workflow-auto activation stderr and before/after config check | `.omo/evidence/affected-hands-on-qa/s6-activate-unreviewed-workflow-auto.txt` |
| A7 | terminal transcript | hook install JSON, generated hook head, failed malformed secondary attempt, corrected successful hook execution | `.omo/evidence/affected-hands-on-qa/s7-hook-install-skillboard-bin.txt` |
