# SkillBoard Enterprise Auto Rollout Readiness

## Goal Objective

Bring SkillBoard from "safe for individual/team pilot adoption" to "safe for enterprise-wide automated rollout".

The target state is that SkillBoard can be installed, initialized, audited, upgraded, and rolled back across many existing developer machines without breaking existing local skill usage, silently enabling unreviewed runtime sources, losing user files, or requiring manual inspection on each machine.

This is a future-session goal document only. Do not treat this file as evidence that the work is complete.

## Current Baseline

As of the latest implementation pass:

- Trusted local user skills can remain usable after onboarding as `manual-only`.
- New local skills, workflows, and harnesses can be added through CLI commands instead of manual YAML editing.
- Unreviewed non-user, plugin, and runtime sources remain review-gated.
- `doctor` default mode can report usable safe mode; `doctor --strict` fails review-required states.
- Skill path traversal such as `../../secret` is rejected.
- Verification passed: `npm run diagnostics`, `node --test` 85/85, `npm run check`, focused regression 46/46, manual QA, final gate review.

Known non-enterprise-ready issue:

- The worktree currently has broad CRLF/trailing-whitespace churn, so `git diff --check` is noisy and cannot yet serve as a clean release gate.

## Enterprise Rollout Definition Of Done

SkillBoard is enterprise-auto-rollout-ready only when all of these are true:

- A non-interactive rollout command can audit, dry-run, apply, and report without prompts.
- Every mutating step creates backups and can roll back safely.
- Default organization policy can be centrally distributed, pinned, and audited.
- Runtime/plugin/external sources cannot become active without explicit reviewed policy.
- The package supply chain is reproducible and release-gated.
- Cross-platform CI covers supported enterprise OS and Node versions.
- A fleet report can show which machines are healthy, safe-mode, strict-failing, or rollback-needed.
- Operators have a runbook for canary, staged rollout, emergency disable, and uninstall.

## Required Workstreams

### 1. Repo Hygiene And Release Gate Cleanup

Objective:
Make the repository suitable for strict CI and release automation.

Tasks:

- Add or verify `.gitattributes` for stable line endings across Markdown, YAML, JS, shell, and lockfiles.
- Normalize existing CRLF/trailing-whitespace churn in a dedicated mechanical commit.
- Add CI enforcement for `git diff --check`.
- Keep formatting churn separate from functional changes.
- Confirm `npm run check` still passes after normalization.

Acceptance:

- `git diff --check` is clean on a fresh checkout after tests.
- Line-ending rules are documented and enforced.
- Functional diffs are no longer hidden by whitespace noise.

### 2. Fleet-Safe Non-Interactive Rollout Mode

Objective:
Provide an automation-safe entrypoint for enterprise deployment tools.

Tasks:

- Design `skillboard rollout audit`, `skillboard rollout plan`, and `skillboard rollout apply` or equivalent commands.
- Ensure every rollout command has `--json`.
- Ensure no rollout path prompts or waits for user input.
- Add explicit exit codes for healthy, safe-mode, strict-failed, apply-failed, and rollback-needed.
- Separate read-only audit, dry-run plan, and mutating apply.
- Make command output stable enough for central log ingestion.

Acceptance:

- A deployment script can run audit and plan on a clean or dirty developer machine without mutating files.
- Apply fails closed when policy, bridge, source, or path validation fails.
- JSON schema is documented and regression-tested.

### 3. Backup And Rollback Guarantees

Objective:
Make every mutating rollout reversible.

Tasks:

- Add backup creation before writing `skillboard.config.yaml`, `AGENTS.md`, `CLAUDE.md`, and generated `.skillboard` files.
- Record a transaction manifest for each apply.
- Add rollback command that restores the last transaction.
- Ensure partial failure never leaves bridge files half-written.
- Test rollback after simulated write failures.

Acceptance:

- Forced write-failure tests leave original files intact.
- Rollback restores exact previous bytes for every file in the transaction.
- Re-running rollback is idempotent or gives a safe no-op result.

### 4. Organization Policy Template

Objective:
Make enterprise defaults explicit and centrally reviewable.

Tasks:

- Define an organization policy file format or profile format.
- Add allowlist and denylist support for source classes, install-unit ids, plugin ids, and runtime component types.
- Add default workflow and harness naming conventions.
- Add policy controls for whether safe-mode is allowed in rollout.
- Add policy controls for trusted local user skills versus system/plugin/runtime skills.
- Document override and exception flow.

Acceptance:

- A central policy can be applied to a new project without hand-editing YAML.
- Unreviewed runtime/plugin sources remain blocked unless the org policy explicitly permits them.
- Policy conflicts produce actionable errors.

### 5. Supply Chain And Release Security

Objective:
Make published releases trustworthy enough for organization-wide install.

Tasks:

- Add npm provenance or equivalent release attestation.
- Require signed git tags for releases.
- Generate SBOM for release artifacts.
- Add dependency audit gate.
- Add CodeQL or comparable static security scan.
- Pin release process in documentation.
- Verify `npm pack --dry-run --json` excludes internal artifacts.

Acceptance:

- Release CI produces attestable artifacts.
- Internal `.omo`, tests, and local evidence are excluded from package payloads.
- Security gates must pass before publishing.

### 6. Enterprise Compatibility Matrix

Objective:
Validate real deployment environments, not only unit-test fixtures.

Tasks:

- Expand CI/smoke matrix across supported Node versions and OSes.
- Add smoke tests for `HOME`, `CODEX_HOME`, symlinked config files, read-only files, missing permissions, corporate proxy/offline behavior, and long paths.
- Test multiple agent/harness installations on the same machine.
- Test existing large `AGENTS.md` and `CLAUDE.md` files with user content before and after bridge insertion/removal.
- Test Windows path variants and drive-letter edge cases.

Acceptance:

- Supported environment matrix is documented.
- Unsupported environments fail with clear diagnostics.
- No smoke test requires manual inspection.

### 7. Security Hardening Beyond Current Path Guard

Objective:
Close rollout-scale security classes beyond direct `../../` traversal.

Tasks:

- Audit symlink escape behavior for skills, source caches, backups, and bridge files.
- Audit time-of-check/time-of-use races around source verification and config writes.
- Validate plugin manifests and install-unit metadata as untrusted input.
- Ensure malformed or malicious `SKILL.md` frontmatter cannot poison policy state.
- Add strict lock/source digest enforcement mode for fleet rollout.
- Confirm secrets, tokens, cookies, and local private paths are not emitted in JSON reports by default.

Acceptance:

- Security review finds no high-risk blocker.
- Regression tests cover symlink escape, malformed metadata, and redacted JSON output.
- Strict fleet mode refuses unpinned or unverifiable non-local sources.

### 8. Fleet Reporting And Observability

Objective:
Let operators understand rollout health across many machines.

Tasks:

- Define a stable fleet report JSON schema.
- Include machine-local status categories without exposing sensitive data.
- Include counts and ids for safe-mode causes, strict failures, blocked install units, and rollback status.
- Add report redaction rules.
- Add examples for aggregating reports in CI, MDM, or an internal endpoint.

Acceptance:

- A fleet report can answer: healthy, safe-mode, strict-failed, apply-failed, rollback-needed.
- Reports are deterministic enough for diffing.
- Sensitive values are redacted or omitted by default.

### 9. Staged Rollout And Operational Runbook

Objective:
Make deployment operationally safe.

Tasks:

- Write an administrator rollout runbook.
- Define canary, pilot, staged rollout, and full rollout phases.
- Define rollback triggers and stop-the-line thresholds.
- Add emergency disable guidance.
- Add uninstall guidance for both package removal and project bridge cleanup.
- Add user-facing explanation for safe-mode and strict failure messages.

Acceptance:

- An operator can run rollout without reading source code.
- Rollback and uninstall procedures are tested against real CLI commands.
- Users get actionable messages rather than policy jargon.

### 10. Final Enterprise Gate

Objective:
Require all release-blocking checks before claiming enterprise readiness.

Tasks:

- Run full test suite.
- Run cross-platform CI.
- Run package smoke from packed tarball, not only source tree.
- Run security review.
- Run manual QA on a simulated pre-existing developer setup.
- Run fleet dry-run against at least three fixture profiles: clean machine, existing local skills, plugin/runtime-heavy machine.
- Run rollback QA after forced failure.

Acceptance:

- All gates pass with captured evidence.
- Any known risk is explicitly classified as non-blocking with rationale.
- Final gate review returns PASS.

## Suggested Future Goal Prompt

Use this objective in a future session:

```text
Goal: Make SkillBoard enterprise-auto-rollout-ready using .omo/plans/enterprise-auto-rollout-readiness.md as the source of truth. Start by producing an execution plan, then implement only after I approve it. Do not skip staged rollout, rollback, fleet reporting, supply-chain, compatibility, and security gates.
```

## Must Not Do

- Do not silently activate unreviewed plugin, runtime, external, or system sources.
- Do not delete user skills or user-authored bridge file content.
- Do not rely on manual per-machine review for the happy path.
- Do not treat passing local unit tests as sufficient for enterprise rollout.
- Do not hide safe-mode or strict-failure causes in human-only text.
- Do not publish or package `.omo`, test artifacts, secrets, or local evidence.

## First Recommended Next Step

Start with repo hygiene and rollout-mode planning before expanding features:

1. Normalize line endings and make `git diff --check` enforceable.
2. Design the fleet-safe command surface and JSON schemas.
3. Add transaction backup/rollback guarantees.
4. Then expand supply-chain, compatibility, security, observability, and runbook workstreams.
