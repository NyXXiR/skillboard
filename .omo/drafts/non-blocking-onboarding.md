---
slug: non-blocking-onboarding
status: plan-written
intent: clear
pending-action: none
approach: non-blocking safe-mode onboarding with trusted local manual adoption and strict CI gate
---

# Draft: non-blocking-onboarding

## Components (topology ledger)

| id | outcome (one line) | status | evidence path |
| --- | --- | --- | --- |
| onboarding-import | Existing local skills, workflows, harnesses, and install units are imported without deleting user files or disabling current policy. | active | src/agent-inventory.mjs:55 |
| health-semantics | Default doctor/status distinguishes broken state from safe-mode review-needed state. | active | src/doctor.mjs:93 |
| review-queue | High-risk/unreviewed units are surfaced as review work, not default command failure. | active | src/doctor.mjs:117 |
| trust-activation | Unreviewed external automatic invocation remains blocked at control/use boundaries. | active | src/control.mjs:402 |
| growth-flow | Users can add workflows, harnesses, and skills from CLI commands without manual YAML editing. | active | src/control.mjs:170 |
| docs-tests | Tests and docs encode first-time adoption plus future additions. | active | test/cli.test.mjs:388 |

## Open assumptions (announced defaults)

| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| Local user-authored skills | Import trusted local user skills as manual-callable, not quarantined, when a safe workflow target can be inferred or created. | User-owned manual skills are part of the existing setup; making them look blocked defeats adoption. | Yes |
| External/plugin/system skills | Keep discovered non-user/plugin/runtime skills quarantined and blocked unless reviewed or explicitly activated. | Preserves current security model and avoids new automatic invocation. | Yes |
| Doctor strictness | Default doctor/status exit 0 for safe-mode review-needed state; `--strict` exits non-zero for blocking review warnings. | First-run UX should continue, while CI/security gates keep fail-fast behavior. | Yes |
| Growth UX | Add `add workflow` and `add harness` paths rather than requiring direct YAML edits. | The current CLI has `add skill` but no way to create the workflow it needs. | Yes |
| Existing workflow/harness import | Preserve existing SkillBoard config and import only structurally detected non-SkillBoard workflow/harness metadata. | Arbitrary workflow formats cannot be safely inferred without a detector/profile. | Yes |

## Findings (cited - path:lines)

- `src/agent-inventory.mjs:55` scans default and custom agent skill roots, and `src/agent-inventory.mjs:275` currently writes every discovered skill as `quarantined` / `blocked`.
- `src/agent-inventory.mjs:343` and `src/agent-inventory.mjs:358` already classify Codex/Claude user skill roots as trusted local user install units.
- `src/doctor.mjs:66` builds blocking review warnings, and `src/doctor.mjs:98` makes those warnings part of `ok`, which drives the default exit code in `src/cli.mjs:232`.
- `src/cli.mjs:756` renders all non-ok states as `needs attention`, which makes safe quarantine look like broken setup.
- `src/control.mjs:417` and `src/control.mjs:434` already block unreviewed external model-selectable skills at actual use/audit boundaries.
- `src/control.mjs:170` supports adding skills, but there is no matching first-class workflow or harness creation command.
- `src/workspace.mjs:167` parses workflows and `src/domain/rules/workflows.mjs:13` requires declared harnesses when workflows name one.
- `test/cli.test.mjs:439` and `test/cli.test.mjs:483` currently assert default doctor failure for high-risk or unreviewed runtime extensions; these must become strict-mode assertions.

## Decisions (with rationale)

- Change default health semantics, not trust semantics: `doctor` / `status` should pass for safe-mode review-needed state, but `check`, `guard`, `activate`, and `prefer` must keep blocking unsafe automatic invocation.
- Add strict mode instead of removing failure behavior: CI and security users get `doctor --strict`, normal first-run users get a continuing setup.
- Treat user-controlled local skill roots as existing personal setup. Import them as manual-callable when they can be attached to an inferred/generated manual workflow; otherwise import them as `candidate` / `manual-only` with attach commands in the review summary.
- Add workflow/harness creation commands so a user can grow from the imported setup without editing YAML.
- Do not claim arbitrary third-party workflow/harness import. Preserve existing SkillBoard config, import only detector/profile-backed structured metadata, and report unknown workflow metadata as review-needed.

## Scope IN

- `doctor` / `status` safe-mode result fields, text output, JSON output, help text, and strict exit behavior.
- `init` / inventory classification for trusted local user skills versus external/plugin/runtime skills.
- First-time default local manual workflow creation when safe to infer.
- CLI control functions for adding workflows and harnesses.
- Structured preservation/import behavior for existing workflows and harnesses.
- Regression tests for first-time adoption, strict doctor, unsafe external auto invocation, and no manual YAML growth flow.
- README/install/user-flow/policy docs and generated bridge text updates.

## Scope OUT (Must NOT have)

- No automatic `workflow-auto` or `global-auto` activation for unreviewed external sources.
- No weakening `skillboard check`, `guard`, `activate`, `prefer`, or source audit error behavior.
- No deletion or rewriting of user-authored skill files, bridge content outside SkillBoard blocks, or existing config entries.
- No interactive prompts required for the primary path.
- No npm publishing or registry-name work.
- No invented workflows from unstructured plugin/runtime metadata.

## Open questions

None. The user approved the direction and clarified that first-time users must preserve their setup while adding future skills/workflows.

## Approval gate

status: approved
Plan written to `.omo/plans/non-blocking-onboarding.md`. Execution still requires an explicit implementation request.
