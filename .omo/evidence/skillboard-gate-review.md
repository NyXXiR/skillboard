recommendation: REJECT

blockers:
- Source verification and lockfile generation are not safe enough for the stated goal. `node bin/skillboard.mjs audit sources --verify --config examples/multi-source.config.yaml --skills examples/multi-source-skills --json` exits 1. It treats the command-style source `/plugin marketplace add anthropics/skills` as a local absolute filesystem path and reports `cannot verify local source: ENOENT ... '/plugin marketplace add anthropics/skills'`. That makes command/harness-provided sources fail verification for the wrong reason. Separately, `node bin/skillboard.mjs lock write ...` exits 0 and writes a lockfile even when source verification contains `status: unverified` entries. This conflicts with `docs/versioning.md`, which says the lockfile should represent a verified working set.
- Control writes can create a state that SkillBoard immediately denies. A temp config with an unreviewed marketplace install unit and a candidate `manual-only` skill allowed `activate vendor.router --workflow review-workflow --mode workflow-auto` to exit 0, write `status: active` and `invocation: workflow-auto`, and print only `[UNIT-TRUST-001]` as a warning. The next `can-use vendor.router --workflow review-workflow --json` exited 2 because the skill is model-selectable but the external source is unreviewed. From the user's perspective, "Activated" is not a reliable management outcome.
- The TypeScript fallback diagnostic evidence is not meaningful as shipped. The recorded fallback command and my direct rerun of `./node_modules/.bin/tsc --allowJs --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck ...` exit 0 because they omit `--checkJs`, so JavaScript bodies are not checked. Adding `--checkJs` produces real diagnostics, including `src/control.mjs(138,94)` and several `src/reconcile.mjs` inferred `never[]` errors. MCP LSP is installed and runs, but it reports a TypeScript hint in `src/control.mjs` at line 447 for an unused `workflow` parameter.
- Required review coverage is absent. I found manual QA transcripts and gate-review artifacts, but no separate code-review report or notepad artifact showing the required skill-perspective check and remove-ai-slops overfit/slop criteria coverage. Per the gate instructions, absent or unsupported review coverage is itself a rejection condition.
- Direct remove-ai-slops/programming pass found unresolved maintainability slop. Pure LOC exceeds the loaded criteria's 250-line ceiling without a `SIZE_OK` justification: `test/cli.test.mjs` 780, `src/control.mjs` 664, `src/cli.mjs` 563, and `src/source-profiles.mjs` 253. I did not find evidence that a split was planned, justified, or reviewed.

originalIntent:
The user wanted SkillBoard to be usable as a consistent control plane for user-created skills and external workflow/harness-provided skills. The expected result includes AI/person command support, flexible source classes, source trust and verification hardening, LSP diagnostics installed if needed, and prior security blockers fixed.

desiredOutcome:
A user or agent can list/explain/audit/manage skills through the CLI, install guard hooks, trust `can-use` and `guard` decisions, generate a meaningful lockfile/source verification record, manage flexible source classes without spoofing `user`, and run meaningful diagnostics without hidden gaps.

userOutcomeReview:
- CLI command surface: mostly achieved. Fresh `npm run check` passed 53 tests, and direct CLI checks for `list`, `explain`, `can-use`, `guard`, `hook install`, `audit sources`, `lock write`, and control writes all execute through the public binary.
- Prior blocker rechecks: `source_class: user` spoofing is rejected by policy; default hook filenames sanitize traversal-like workflow names; existing/symlink hook outputs are refused; `--skillboard-bin 'node bin/skillboard.mjs'` works in the generated hook; disabled install units are denied by `can-use`; empty `source_digest` is treated as unpinned; non-callable fallback skills are denied.
- Source verification/lock behavior: not complete. `audit sources --verify` misclassifies slash-command sources as local paths, and `lock write` succeeds while recording unverified sources.
- Trust-aware management: inconsistent. `activate` can report success and write a model-selectable unreviewed external skill that `can-use` then denies.
- Diagnostics: partially achieved. Local `typescript-language-server` and `tsc` are installed; MCP LSP works. The fallback tsc command used as evidence is too weak without `--checkJs`, and the stricter fallback reveals diagnostics.
- Formatting churn: I inspected behavior separately from line-ending churn as requested. `git diff --check` fails with broad CRLF/trailing-whitespace reports, but I did not use formatting churn as a blocker.

checked artifact paths:
- `/mnt/i/workspace/skill-control-plane/bin/skillboard.mjs`
- `/mnt/i/workspace/skill-control-plane/src/cli.mjs`
- `/mnt/i/workspace/skill-control-plane/src/control.mjs`
- `/mnt/i/workspace/skill-control-plane/src/source-verification.mjs`
- `/mnt/i/workspace/skill-control-plane/src/source-profiles.mjs`
- `/mnt/i/workspace/skill-control-plane/src/source-profile-loader.mjs`
- `/mnt/i/workspace/skill-control-plane/src/install-units.mjs`
- `/mnt/i/workspace/skill-control-plane/src/workspace.mjs`
- `/mnt/i/workspace/skill-control-plane/src/policy.mjs`
- `/mnt/i/workspace/skill-control-plane/src/domain/source-classes.mjs`
- `/mnt/i/workspace/skill-control-plane/src/domain/rules/install-units.mjs`
- `/mnt/i/workspace/skill-control-plane/src/domain/rules/skills.mjs`
- `/mnt/i/workspace/skill-control-plane/src/domain/rules/workflows.mjs`
- `/mnt/i/workspace/skill-control-plane/docs/versioning.md`
- `/mnt/i/workspace/skill-control-plane/README.md`
- `/mnt/i/workspace/skill-control-plane/package.json`
- `/mnt/i/workspace/skill-control-plane/.codex/lsp-client.json`
- `/mnt/i/workspace/skill-control-plane/.opencode/lsp.json`
- `/mnt/i/workspace/skill-control-plane/test/cli.test.mjs`
- `/mnt/i/workspace/skill-control-plane/test/policy-hardening.test.mjs`
- `/mnt/i/workspace/skill-control-plane/.omo/evidence/skillboard-current-qa`
- `/mnt/i/workspace/skill-control-plane/.omo/evidence/skillboard-cli-qa-20260623`
- `/mnt/i/workspace/skill-control-plane/.omo/evidence/skillboard-cli-qa`

exact evidence gaps:
- No code-review report artifact was present with explicit programming-skill and remove-ai-slops overfit/slop coverage.
- No notepad artifact/path was present.
- No artifact justifies oversized source/test modules under the loaded programming criteria.
- No artifact shows `lock write` refusing or clearly flagging failed source verification as a non-success.
- No artifact shows command-style slash sources are classified as metadata/command sources instead of local filesystem paths.
- The TypeScript fallback artifact uses `allowJs` without `checkJs`, so it does not prove JavaScript diagnostics are meaningful.

verification run:
- `npm run check`: PASS, 53 tests.
- `find bin src test -name '*.mjs' -print0 | xargs -0 -n1 node --check`: PASS.
- `npm ls --depth=0`: `@types/node@26.0.0`, `typescript-language-server@5.3.0`, `typescript@6.0.3`, `yaml@2.9.0`.
- `mcp__lsp.status`: TypeScript installed; active clients start on diagnostics.
- `mcp__lsp.diagnostics /mnt/i/workspace/skill-control-plane/src`: 0 errors, 1 TypeScript hint in `src/control.mjs`.
- `./node_modules/.bin/tsc --allowJs --noEmit ...`: PASS but weak because no `--checkJs`.
- `./node_modules/.bin/tsc --allowJs --checkJs --noEmit ...`: FAIL with production and test diagnostics.
- `node bin/skillboard.mjs audit sources --verify --config examples/multi-source.config.yaml --skills examples/multi-source-skills --json`: FAIL, source verification errors.
- `node bin/skillboard.mjs lock write --config examples/multi-source.config.yaml --skills examples/multi-source-skills --out <tmp>/skillboard.lock.yaml --json`: exits 0 while writing unverified statuses.
- Manual hook checks: `--skillboard-bin 'node bin/skillboard.mjs'` generated hook allows `matt.tdd`; traversal-like default workflow name writes sanitized `.skillboard/hooks/skillboard-guard-bad-workflow.sh`; symlink output is refused.
- Manual trust checks: spoofed `source_class: user` policy fails; disabled install-unit skill `can-use` fails; empty `source_digest` remains unpinned; blocked fallback skill `can-use` and policy fail.
