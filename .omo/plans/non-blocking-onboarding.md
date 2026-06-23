# non-blocking-onboarding - Work Plan

## TL;DR (For humans)

**What you'll get:** First-time SkillBoard setup will import a user's existing local skills without making the project look broken. New external/runtime items stay safely gated, and users get CLI commands to add workflows, harnesses, and new skills without hand-editing YAML.

**Why this approach:** It separates "setup is broken" from "setup is safe but has review items." Local user-authored skills are preserved as manual workflow assets, while external automatic invocation remains blocked until reviewed.

**What it will NOT do:** It will not auto-trust external plugins, enable workflow-auto/global-auto for unreviewed sources, delete user files, or publish anything to npm.

**Effort:** Medium
**Risk:** Medium - the change crosses CLI exit codes, config merging, and policy tests.
**Decisions to sanity-check:** Default local user skills become manual-callable when a safe local workflow can be inferred or generated; high-risk review warnings fail only under `--strict`; arbitrary third-party workflow formats are not auto-imported unless a structured detector/profile exists.

Your next move: ask Codex to start implementation, or request a higher-accuracy review of this plan first. Full execution detail follows below.

---

> TL;DR (machine): Medium-risk CLI/control-plane change: non-blocking safe-mode doctor, trusted local manual adoption, add workflow/harness growth commands, strict security gate retained.

## Scope
### Must have

- `skillboard doctor` and `skillboard status` default to success for safe-mode review-needed states when config, bridge, policy, and source audit hard errors are clean.
- `skillboard doctor --strict` and `skillboard status --strict` preserve fail-fast behavior for high-risk/unreviewed runtime extension review warnings.
- JSON health output includes explicit fields for default health and strict health, for example `mode`, `reviewRequired`, `strictOk`, and a compact review summary.
- Text health output uses wording like `safe mode, review needed` instead of making normal first-run quarantine look broken.
- First-time init/import treats trusted local user-authored skills as existing personal setup.
- If no workflows exist and trusted local user skills are discovered, init creates a local manual workflow and harness binding so those skills can pass policy as manual-only workflow assets.
- External/plugin/runtime/system skills remain quarantined and blocked by default unless already declared otherwise.
- Existing SkillBoard config entries, workflows, harnesses, and skill declarations are preserved and not overwritten.
- Existing non-SkillBoard workflow/harness state is imported only when a detector/profile provides structured metadata; otherwise init reports it as review-needed setup rather than inventing a workflow.
- Users can add future workflows and harnesses through CLI commands, then attach local skills without editing YAML.
- `activate`, `prefer`, `guard`, `can-use`, `check`, and source audit continue to block unsafe automatic invocation for unreviewed external sources.
- README/install/user-flow/policy/bridge docs describe the new onboarding and growth path.

### Must NOT have (guardrails, anti-slop, scope boundaries)

- Must not auto-enable `workflow-auto` or `global-auto` for unreviewed external/package/plugin sources.
- Must not reduce policy errors to warnings.
- Must not change `skillboard check` success semantics.
- Must not delete or mutate user-authored `SKILL.md` files.
- Must not rewrite bridge content outside `BEGIN SKILLBOARD` / `END SKILLBOARD` blocks.
- Must not require interactive prompts or manual YAML editing for the supported happy path.
- Must not claim automatic import of arbitrary workflow/harness formats that SkillBoard cannot structurally parse.
- Must not publish or rename the npm package.

## Verification strategy

> Zero human intervention - all verification is agent-executed.

- Test decision: TDD with Node's built-in `node --test`, plus `npm run diagnostics` and `npm run check`.
- For each todo: write or update failing tests first, run the narrow test, implement, rerun the narrow test.
- Full gates:
  - `npm run diagnostics`
  - `node --test`
  - `npm run check`
  - local install smoke in a temp prefix with `npm install --prefix <tmp> /mnt/i/workspace/skill-control-plane`
- Manual QA gate:
  - Create temp `HOME` and `CODEX_HOME` with Codex user skills plus a plugin manifest.
  - Run installed `skillboard init`.
  - Run default `skillboard doctor` and confirm exit 0 with safe-mode review output.
  - Run `skillboard doctor --strict` and confirm exit 1 for the same review warnings.
  - Run `skillboard add workflow`, `skillboard add skill --workflow`, `skillboard can-use`, and unreviewed external `activate --mode workflow-auto` refusal.
- Evidence paths:
  - `.omo/evidence/non-blocking-onboarding/diagnostics.txt`
  - `.omo/evidence/non-blocking-onboarding/node-test.txt`
  - `.omo/evidence/non-blocking-onboarding/npm-check.txt`
  - `.omo/evidence/non-blocking-onboarding/local-install-smoke.txt`
  - `.omo/evidence/non-blocking-onboarding/manual-qa.md`

## Execution strategy
### Parallel execution waves

- Wave 1: Health semantics and local adoption model. These touch related tests but separate source modules.
- Wave 2: Growth commands and CLI output/review summaries.
- Wave 3: Docs and full end-to-end QA.

### Dependency matrix

| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1. Safe-mode health contract | none | 3, 6, final QA | 2 |
| 2. Trusted local adoption contract | none | 3, 4, 6, final QA | 1 |
| 3. Init/status review summary and existing workflow handling | 1, 2 | 6, final QA | 4 |
| 4. Workflow/harness growth commands | 2 | 5, 6, final QA | 3 |
| 5. Add-skill growth path integration | 4 | 6, final QA | docs part of 7 |
| 6. Trust-boundary regressions | 1, 2, 4, 5 | final QA | 7 |
| 7. Documentation and bridge updates | 1, 2, 4 | final QA | 6 |

## Todos

> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

- [ ] 1. Add default safe-mode health and strict doctor/status behavior
  What to do / Must NOT do: Update `test/cli.test.mjs` first so high-risk unreviewed runtime extension scenarios no longer fail default `doctor`/`status`, but still fail with `--strict`. Then update `src/doctor.mjs` and `src/cli.mjs` to expose default health and strict health separately. Keep missing config, invalid config, broken/unmanaged bridge, policy errors, and source audit errors non-zero in default mode.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 3, 6, final QA
  References (executor has NO interview context - be exhaustive): `src/doctor.mjs:66`, `src/doctor.mjs:93`, `src/doctor.mjs:117`, `src/doctor.mjs:133`, `src/cli.mjs:224`, `src/cli.mjs:232`, `src/cli.mjs:752`, `src/cli.mjs:797`, `test/cli.test.mjs:439`, `test/cli.test.mjs:483`
  Acceptance criteria (agent-executable): A default high-risk review-needed doctor test exits 0 and returns JSON with `ok: true`, `reviewRequired: true`, `strictOk: false`, and `mode: "safe-mode"` or equivalent explicit names. The same fixture with `--strict` exits 1. Missing config and unmanaged bridge tests still exit 1.
  QA scenarios (name the exact tool + invocation): Happy: `node --test test/cli.test.mjs --test-name-pattern "doctor"` records default safe-mode exit 0 and strict exit 1. Failure: mutate the fixture to include a real policy error and confirm default `doctor` still exits 1. Evidence `.omo/evidence/non-blocking-onboarding/task-1-health.txt`
  Commit: N unless the user explicitly asks for commits | feat(doctor): separate safe-mode status from strict review failures

- [ ] 2. Preserve trusted local user skills during first-time inventory adoption
  What to do / Must NOT do: Update inventory tests first so Codex/Claude/custom user skills are not imported as blocked when they are from trusted local user roots. Implement a small, named classifier in `src/agent-inventory.mjs` for skill defaults by install unit. External plugin/system/runtime skills remain `quarantined` / `blocked`. For trusted local user skills, use `active-manual` / `manual-only` when they will be attached to an auto-created local manual workflow; otherwise use `candidate` / `manual-only`.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 3, 4, 6, final QA
  References (executor has NO interview context - be exhaustive): `src/agent-inventory.mjs:55`, `src/agent-inventory.mjs:91`, `src/agent-inventory.mjs:275`, `src/agent-inventory.mjs:343`, `src/agent-inventory.mjs:358`, `src/agent-inventory.mjs:373`, `src/domain/constants.mjs:1`, `src/domain/constants.mjs:46`, `src/domain/rules/skills.mjs:89`, `test/cli.test.mjs:664`
  Acceptance criteria (agent-executable): The init scan fixture imports user-owned `local-helper` as manual-callable, keeps plugin `demo:review` quarantined/blocked, and keeps system/runtime skills blocked unless explicitly covered by trusted local handling. Policy check passes.
  QA scenarios (name the exact tool + invocation): Happy: `node --test test/cli.test.mjs --test-name-pattern "init scans installed agent skills"` confirms local user skill status/invocation and external quarantine. Failure: add a plugin skill to the fixture and confirm it remains non-callable. Evidence `.omo/evidence/non-blocking-onboarding/task-2-local-adoption.txt`
  Commit: N unless the user explicitly asks for commits | feat(inventory): import trusted local skills as manual setup

- [ ] 3. Preserve structured existing workflows and auto-create local manual workflows only when safe
  What to do / Must NOT do: Add tests first for init with trusted local user skills and no existing workflows, plus init against an existing `skillboard.config.yaml` that already has workflows and harnesses. Implement merge logic so it creates a declared harness and a local manual workflow, for example `codex-local-manual` for Codex user skills and `claude-local-manual` for Claude user skills, only when the config has no workflows. Attach trusted local user skills as active manual-only entries. If SkillBoard workflows already exist, preserve them untouched and import new local skills as `candidate` / `manual-only` plus review-summary commands. For non-SkillBoard workflow/harness state, only import when a detector/profile returns structured workflow/harness metadata; otherwise report "workflow metadata not detected" in the review summary. Do not attach external/plugin/system skills.
  Parallelization: Wave 2 | Blocked by: 1, 2 | Blocks: 6, final QA
  References (executor has NO interview context - be exhaustive): `src/agent-inventory.mjs:76`, `src/agent-inventory.mjs:107`, `src/agent-inventory.mjs:310`, `src/workspace.mjs:150`, `src/workspace.mjs:167`, `src/domain/rules/workflows.mjs:13`, `src/domain/rules/workflows.mjs:47`, `src/lifecycle-cli.mjs:19`, `test/cli.test.mjs:664`
  Acceptance criteria (agent-executable): In a fresh project with only trusted local user skills, `skillboard init` creates a policy-valid workflow/harness and `skillboard can-use <local-skill> --workflow <generated-workflow>` exits 0 with `automaticAllowed: false`. In a project that already has SkillBoard workflows and harnesses, init does not add a generated workflow, mutate active pools, or overwrite harness bindings. In a project with only plugin/runtime metadata and no structured workflow metadata, init reports review-needed workflow metadata instead of inventing one.
  QA scenarios (name the exact tool + invocation): Happy: temp `HOME`/`CODEX_HOME`, `node bin/skillboard.mjs init --dir <project>`, then `node bin/skillboard.mjs can-use local-helper --workflow codex-local-manual --config <project>/skillboard.config.yaml --skills <project>/skills --json`. Failure: same fixture with an existing workflow confirms no auto-created workflow and no active pool mutation; plugin-only fixture confirms no invented workflow. Evidence `.omo/evidence/non-blocking-onboarding/task-3-local-workflow.txt`
  Commit: N unless the user explicitly asks for commits | feat(init): create local manual workflow for first-time user skills

- [ ] 4. Add first-class workflow and harness growth commands
  What to do / Must NOT do: Write CLI/control tests first for `skillboard add workflow` and `skillboard add harness`. Implement `addWorkflow` and `addHarness` in `src/control.mjs`, route them through `src/cli.mjs`, update help text, and use the same YAML-safe write and `writeCheckedConfig` pattern as existing control mutations. `add workflow <name> --harness <id>` should create the workflow, link it from the harness, and create the harness with status `configured` if missing unless the user passes a flag that requires pre-existence. `--skill a,b` may attach existing manual-callable skills; candidate/manual-only local skills should be promoted to `active-manual` / `manual-only` when attached. The command must fail if it would activate quarantined/blocked/deprecated skills or make an unreviewed external skill model-selectable.
  Parallelization: Wave 2 | Blocked by: 2 | Blocks: 5, 6, final QA
  References (executor has NO interview context - be exhaustive): `src/control.mjs:170`, `src/control.mjs:148`, `src/control.mjs:237`, `src/control.mjs:402`, `src/cli.mjs:356`, `src/cli.mjs:790`, `src/workspace.mjs:150`, `src/workspace.mjs:167`, `src/domain/rules/harnesses.mjs:1`, `src/domain/rules/workflows.mjs:13`
  Acceptance criteria (agent-executable): `add harness codex --status configured --dry-run` reports a semantic change and does not write. `add workflow daily --harness codex --skill local-helper` writes a valid config, links `harnesses.codex.workflows`, promotes local `candidate` / `manual-only` skills to `active-manual` / `manual-only`, and passes `skillboard check`. Attempting to attach a quarantined plugin skill fails and leaves the config unchanged.
  QA scenarios (name the exact tool + invocation): Happy: `node bin/skillboard.mjs add workflow daily --harness codex --skill local-helper --config <config> --skills <skills>` followed by `check` and `list workflows`. Failure: attach `demo:review` while quarantined and confirm command exits 1 with unchanged config hash. Evidence `.omo/evidence/non-blocking-onboarding/task-4-growth-commands.txt`
  Commit: N unless the user explicitly asks for commits | feat(control): add workflow and harness CLI mutations

- [ ] 5. Integrate new-skill growth with workflow creation
  What to do / Must NOT do: Update tests so a first-time user can create a new local `skills/new-helper/SKILL.md`, run `skillboard add skill new.helper --path new-helper --workflow daily`, and then `can-use` it in that workflow without direct YAML edits. Reuse the existing `addSkill` defaults where possible. If `--workflow` references a missing workflow, keep the current refusal unless the user first runs `add workflow`; do not silently create ambiguous workflows from `add skill`.
  Parallelization: Wave 2 | Blocked by: 4 | Blocks: 6, final QA
  References (executor has NO interview context - be exhaustive): `src/control.mjs:170`, `src/control.mjs:188`, `src/control.mjs:402`, `src/cli.mjs:376`, `src/lifecycle-content.mjs:36`, `docs/user-flow.md:22`
  Acceptance criteria (agent-executable): A temp project can create workflow `daily`, add `new.helper` with `--workflow daily`, pass `check`, and return `Allowed: true` / `Automatic allowed: false` from `can-use`. Missing workflow remains a clear error and does not write.
  QA scenarios (name the exact tool + invocation): Happy: shell transcript using `mkdir -p skills/new-helper`, writing a minimal `SKILL.md`, then `add workflow`, `add skill`, `can-use`. Failure: run `add skill` with `--workflow missing` and compare config hash before/after. Evidence `.omo/evidence/non-blocking-onboarding/task-5-new-skill-growth.txt`
  Commit: N unless the user explicitly asks for commits | test(cli): cover workflow-backed new skill growth

- [ ] 6. Lock trust boundaries and review queue behavior
  What to do / Must NOT do: Add regression tests that prove non-blocking onboarding does not weaken unreviewed external source protection. Keep or update the existing activate/prefer tests that refuse unreviewed automatic external skills. Add one `guard use` / `can-use` scenario showing a quarantined plugin skill stays denied after safe-mode init. Make source audit warnings visible in the new review summary without becoming hard errors in default doctor.
  Parallelization: Wave 3 | Blocked by: 1, 2, 3, 4, 5 | Blocks: final QA
  References (executor has NO interview context - be exhaustive): `src/control.mjs:417`, `src/control.mjs:434`, `src/control.mjs:437`, `src/control.mjs:440`, `test/cli.test.mjs:1564`, `test/cli.test.mjs:1630`, `src/doctor.mjs:117`, `src/cli.mjs:740`
  Acceptance criteria (agent-executable): Existing unreviewed external `activate --mode workflow-auto` and `prefer` refusal tests still pass. Default doctor exits 0 for review-needed but `can-use`/`guard` denies quarantined or unreviewed automatic plugin skills. `doctor --strict` exits 1 for the same review-needed fixture.
  QA scenarios (name the exact tool + invocation): Happy: `node --test test/cli.test.mjs --test-name-pattern "unreviewed|guard|doctor"` passes. Failure: make plugin skill workflow-auto in the fixture and confirm `check` or control validation fails. Evidence `.omo/evidence/non-blocking-onboarding/task-6-trust-boundaries.txt`
  Commit: N unless the user explicitly asks for commits | test(policy): keep external automatic invocation gated

- [ ] 7. Update docs, bridge text, and user-facing command help
  What to do / Must NOT do: Update `README.md`, `docs/install.md`, `docs/user-flow.md`, `docs/policy-model.md`, and `src/lifecycle-content.mjs` to describe the default safe-mode flow, strict mode, trusted local manual adoption, review-needed queue, and workflow/harness growth commands. Keep docs clear that install and init do not delete skills and do not auto-enable external automatic invocation. Update `helpText` for `--strict`, `add workflow`, and `add harness`.
  Parallelization: Wave 3 | Blocked by: 1, 2, 4 | Blocks: final QA
  References (executor has NO interview context - be exhaustive): `README.md:87`, `README.md:97`, `docs/install.md:30`, `docs/install.md:61`, `docs/user-flow.md:1`, `docs/policy-model.md:220`, `src/lifecycle-content.mjs:25`, `src/cli.mjs:790`
  Acceptance criteria (agent-executable): `node bin/skillboard.mjs --help` includes strict mode and growth commands. Docs include a first-time flow that imports existing setup, shows safe mode review, creates a workflow, adds a skill, and verifies with `can-use`.
  QA scenarios (name the exact tool + invocation): Happy: `rg -n "safe mode|--strict|add workflow|add harness|review needed" README.md docs src/lifecycle-content.mjs src/cli.mjs`. Failure: docs must not claim external plugins are auto-enabled or trusted by default. Evidence `.omo/evidence/non-blocking-onboarding/task-7-docs.txt`
  Commit: N unless the user explicitly asks for commits | docs(onboarding): describe safe-mode adoption and growth

- [ ] 8. Run full package and local-install smoke verification
  What to do / Must NOT do: After all implementation todos pass, run full diagnostics/tests/package smoke and drive the installed CLI through the first-time user surface in a temp project. Do not rely only on unit tests. Record exact command outputs under `.omo/evidence/non-blocking-onboarding/`.
  Parallelization: Final implementation wave | Blocked by: 1, 2, 3, 4, 5, 6, 7 | Blocks: final response
  References (executor has NO interview context - be exhaustive): `package.json:15`, `package.json:19`, `README.md:83`, `src/cli.mjs:224`, `src/lifecycle-cli.mjs:5`
  Acceptance criteria (agent-executable): `npm run diagnostics`, `node --test`, `npm run check`, `npm pack --dry-run`, and local install smoke all exit 0 except the intentional `doctor --strict` step, which exits 1 and is recorded as expected.
  QA scenarios (name the exact tool + invocation): Happy: temp local package install, first-run `init`, default `doctor`, `add workflow`, `add skill`, `can-use`, `inventory refresh --dry-run`, `check`. Failure: `doctor --strict` on unreviewed high-risk plugin exits 1; unreviewed external workflow-auto activation exits 1. Evidence `.omo/evidence/non-blocking-onboarding/local-install-smoke.txt` and `.omo/evidence/non-blocking-onboarding/manual-qa.md`
  Commit: N | verification only

## Final verification wave

> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.

- [ ] F1. Plan compliance audit
  - Verify every Must have is implemented or explicitly proven not applicable.
  - Verify every Must NOT have is preserved.
  - Evidence: `.omo/evidence/non-blocking-onboarding/f1-plan-compliance.md`

- [ ] F2. Code quality review
  - Review changed modules for scoped edits, clear naming, no accidental broad rewrites, no unsafe type escapes, and no unrelated worktree changes.
  - Evidence: `.omo/evidence/non-blocking-onboarding/f2-code-quality.md`

- [ ] F3. Real manual QA
  - Drive the installed CLI in a temp project with temp HOME/CODEX_HOME through first-time adoption and growth commands.
  - Evidence: `.omo/evidence/non-blocking-onboarding/manual-qa.md`

- [ ] F4. Scope fidelity
  - Confirm npm publishing, registry changes, interactive prompts, and unrelated docs/code are not included.
  - Evidence: `.omo/evidence/non-blocking-onboarding/f4-scope-fidelity.md`

## Commit strategy

- Keep commits atomic by product outcome:
  - `feat(doctor): separate safe-mode status from strict review failures`
  - `feat(inventory): preserve trusted local manual setup`
  - `feat(control): add workflow and harness CLI mutations`
  - `docs(onboarding): document safe-mode adoption and growth`
- Do not amend existing commits.
- Do not stage unrelated dirty worktree files.
- If user does not ask for commits, leave changes unstaged and report touched files plus verification.

## Success criteria

- First-time default install/init/status no longer appears broken solely because unreviewed high-risk runtime extensions need review.
- Default doctor/status continue with exit 0 in safe-mode review-needed state.
- Strict doctor/status fail for the same high-risk unreviewed runtime extension review state.
- Trusted local user skills are preserved as manual setup when safe; external/plugin/runtime skills remain quarantined/blocked unless explicitly reviewed and activated.
- Users can create workflows/harnesses and add skills through CLI commands without manual YAML edits.
- Unsafe automatic invocation from unreviewed external sources is still refused.
- `npm run diagnostics`, `node --test`, `npm run check`, and local installed CLI smoke verification pass with recorded evidence.
