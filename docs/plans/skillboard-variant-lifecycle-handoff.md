# SkillBoard Variant Lifecycle Handoff Plan

This document was the handoff point for continuing the SkillBoard variant lifecycle implementation in `/home/nyxxir/skillboard`.

## Status

Completed on 2026-06-29.

The authoritative execution plan was `.omo/plans/skillboard-variant-lifecycle.md`; all Todos 1-8 and final verification wave F1-F4 were completed. Ignored orchestration artifacts under `.omo/` and `.agent-work/` contain the detailed evidence and continuity logs.

## Implemented Scope

The feature adds a manual, auditable lifecycle for cross-agent skill variants:

- `skillboard variant fork`
- `skillboard variant status`
- `skillboard variant approve`
- `skillboard variant reset`
- nested `skills.<id>.variant` metadata
- digest-backed raw `SKILL.md` snapshots
- documentation and tests for manual cross-agent adaptation

## Product Decisions Preserved

- `variant add` remains the existing immediate policy-registration command.
- New lifecycle commands are additive: `fork`, `status`, `approve`, `reset`.
- A draft fork is policy-valid but not callable:
  - top-level `status: candidate`
  - top-level `invocation: manual-only`
  - no workflow active/preferred/fallback role until approval
- `variant.status` is nested lifecycle metadata only. Top-level skill statuses were not expanded with `draft` or `approved`.
- Snapshot files are raw `SKILL.md` content only.
- Snapshot paths are config-relative and stay under `.skillboard/variant-snapshots/`.
- Drift is computed from file digests; `drifted` is not persisted in config.
- The implementation does not add automatic prompt conversion, LLM calls, new dependencies, or prompt rewriting.

## Verification Summary

Final verification passed:

- `npm run check` → 244/244 tests pass.
- Focused lifecycle suite → 24/24 tests pass.
- Manual CLI QA evidence was written under `.omo/evidence/manual-variant-lifecycle/`.
- F1-F4 evidence files were written under `.omo/evidence/`.
- Independent final no-edit review passed with no blockers.
- `git diff --check` and untracked whitespace checks passed.

## Final Commit

Planned commit message:

```text
feat(control): add variant lifecycle management
```

Do not push unless the user explicitly asks.
