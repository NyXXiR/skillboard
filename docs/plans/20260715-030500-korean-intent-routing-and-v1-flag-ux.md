# Korean Intent Routing + v1/v2 Flag UX

- Status: assigned
- Created: 2026-07-15
- Author: claude (review session 2026-07-15; implementation delegated)
- Scope: `src/route-tokens.mjs`, `src/route-selection.mjs` (read), `src/cli.mjs`, tests, `docs/reference.md`
- Priority: Task 1 is P0 (core feature broken for Korean); Tasks 2–3 are P1.

**TL;DR (ko):** 라우터 토크나이저가 비ASCII를 전부 버려서 한국어 인텐트가 후보 0개가 된다(P0). v1 정책에서 `--agent`를 쓰면 이유 설명 없는 usage 에러가 난다(P1). 이 문서는 다른 AI가 그대로 집어 구현할 수 있게 재현 명령, 수정 지점, 설계, 수용 기준, 검증 명령을 담는다.

---

## Task 1 (P0) — Unicode-aware route tokenization

### Problem

`tokensFor()` in `src/route-tokens.mjs` lowercases and then splits on
`/[^a-z0-9]+/u`, so **every non-ASCII character is treated as a delimiter**.
A Korean intent produces zero tokens and the router returns no candidates.

Reproduction (verified 2026-07-15 on repo HEAD, v0.3.2):

```bash
# English works:
node bin/skillboard.mjs brief --intent "create a youtube shorts video" \
  --workflow claude-local-manual --config ~/skillboard.config.yaml --skills ~/skills --json
# -> assistant_guidance.route.recommended_skill = "openmontage-qwen-shorts"

# Korean returns nothing:
node bin/skillboard.mjs brief --intent "유튜브 쇼츠 영상 제작" \
  --workflow claude-local-manual --config ~/skillboard.config.yaml --skills ~/skills --json
# -> recommended_skill = null, route_candidates = []
```

Do NOT depend on the author's real `~/skills` in tests — build fixtures with
Korean names/descriptions (see Tests below).

### Where the tokens flow

- `src/route-tokens.mjs` — `tokensFor`, `tokenForms`, `singularRouteToken`,
  `isRouteToken` (rejects length ≤ 1), `phraseKey` (joins token set).
- `src/route-selection.mjs` — consumers:
  - intent tokens (`:8`, `:29`), skill metadata tokens from
    `name + description` (`:37`), preference term tokens (`:55`, `:176`),
    capability tokens (`:112`), and `phraseKey` equality checks
    (`:28`, `:60`, `:65`, `:216-217`).

### Design (recommended)

Keep zero new dependencies and stay deterministic. Change `tokensFor` only;
downstream matching logic stays as-is.

1. Split on `/[^\p{L}\p{N}]+/u` instead of `/[^a-z0-9]+/u` (after
   `toLowerCase()`), so letter/number runs of any script survive.
2. Post-process each run:
   - ASCII runs: unchanged behavior — existing `tokenForms` (plural →
     singular) and stop-word filtering apply.
   - Runs containing CJK/Hangul (`/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u`):
     emit the **whole run** plus **all character bigrams** of the run.
     Bigrams make agglutinative suffixes/particles (조사) mostly harmless:
     "유튜브" → `유튜브, 유튜, 튜브`; intent "쇼츠를" and metadata "쇼츠" still
     share the `쇼츠` bigram.
   - Mixed runs (rare after splitting) may be treated as CJK runs.
3. `isRouteToken`: keep `length > 1` for ASCII, but **allow length 1 for CJK**
   (single-syllable words like "봇" are meaningful). Stop-word set stays
   ASCII-only for now; do not attempt Korean particle stripping (bigrams cover
   it, and a wrong strip is worse than none).
4. `singularRouteToken` must only ever run on pure-ASCII tokens (guard it).
5. `Intl.Segmenter` is available on Node ≥ 16 full-ICU but `engines` says
   `>=14.21` — do not use it, or use it only behind a capability check with
   the bigram path as the guaranteed fallback. The bigram-only approach is
   acceptable and simpler; pick one and note it in the CHANGELOG.

### Risk checklist (verify during implementation)

- **`phraseKey` stability:** it is used for runtime equality
  (intent vs preference term / capability / skill id), not as a persisted
  storage key, per `route-selection.mjs` usage. Re-verify with
  `grep -rn phraseKey src test` that nothing persists phrase keys to disk
  (config/inventory). If something does, that key format change needs a
  migration note.
- **Token-set ordering:** `phraseKey` joins a `Set` in insertion order; adding
  bigrams changes insertion order for CJK input only. ASCII-only inputs must
  produce byte-identical `phraseKey` output as before (add a regression test).
- **Performance:** tokensFor runs per skill per intent (~200 skills here).
  Bigrams add O(len) tokens per CJK run — negligible; no caching needed.
- **English regression:** the full suite (514 tests) must stay green.

### Tests (write first — repo uses `node --test`, fixtures in `test/fixtures.mjs`)

New `test/route-tokens-unicode.test.mjs`:
- `tokensFor("유튜브 쇼츠 영상 제작")` contains `유튜브`, `쇼츠`, `영상`, `제작`
  and their bigrams; no empty tokens.
- Particle tolerance: tokens of "쇼츠를 만들어줘" overlap tokens of "쇼츠 제작".
- ASCII behavior unchanged: `tokensFor("YouTube Shorts videos")` equals the
  pre-change token set (`youtube, shorts, short, videos, video`), and
  `phraseKey` for ASCII input is byte-identical to current output.
- Single CJK syllable ("봇") survives; single ASCII letter still dropped.

Extend routing/e2e coverage:
- `test/route-selection` level: fixture skill with description
  "OpenMontage 스타일 유튜브 쇼츠 제작 파이프라인" is recommended for intent
  "유튜브 쇼츠 영상 제작" and NOT for "회의록 요약".
- One `brief --intent` CLI test with a Korean intent against fixture config
  (mirror an existing case in `test/brief-cli.test.mjs`).

### Acceptance

- Korean, English, and mixed ("쇼츠 video 만들기") intents all route to the
  fixture skill; unrelated Korean intents yield no false positive above the
  existing score threshold.
- `npm run check` passes (syntax + tsc diagnostics + full 514+ tests).

---

## Task 2 (P1) — Explain v1/v2 flag vocabulary in usage errors

### Problem

Top-level help and `docs/reference.md` document
`route/can-use/guard ... --agent codex|claude|opencode|hermes`, but with a
**v1 policy** (`version: 1` config, e.g. the author's `~/skillboard.config.yaml`)
those commands only accept `--workflow` and reject `--agent` with a bare
`Usage: skillboard can-use <skill-id> --workflow <name>` — no explanation of
why, or how to move forward. New users following the docs hit a wall.

Relevant code: `src/cli.mjs` — v2 usage at `:608` / `:2097`, v1 usage at
`:590`, `:613`, `:639` (route/can-use/guard). Policy version is already known
where these errors are thrown.

### Design

When the flag mismatches the detected policy version, throw a self-explaining
error (keep exit code 1):

- v1 policy + `--agent`:
  `This workspace uses a version 1 policy, which selects with --workflow <name>.`
  `Either pass --workflow, or preview migration with: skillboard migrate v2 --config <path> --json`
- v2 policy + `--workflow`: mirror image pointing to `--agent`.

Also update the generic usage strings so each of route/can-use/guard mentions
both vocabularies in one line, e.g.
`--agent <name> (v2 policy) | --workflow <name> (v1 policy)`.

### Tests

- Extend the CLI usage-error tests (see `test/cli-help-safety.test.mjs`,
  `test/hook-json-errors.test.mjs` for patterns): v1 fixture + `--agent`
  asserts the guidance message and exit code 1; v2 fixture + `--workflow`
  asserts the mirror message.

---

## Task 3 (P1) — Help/reference consistency pass

- `docs/reference.md:19-21` and the top-level help block currently show only
  the `--agent` form. After Task 2, sweep both so every route/can-use/guard
  mention states the v1/v2 vocabulary split once, briefly.
- Optional stretch (separate commit, skip if time-boxed): shorten the
  top-level help — move the "v2 AI/automation control loop" philosophy block
  into `docs/reference.md` and leave a one-line pointer.

---

## Out of scope for the implementer (owner/operator task)

The author's own environment still runs a v1 policy with 52 pending decisions
(`doctor`: "Needs your decision: 52"), which blocks the 0.3.2 automatic
migration. After Tasks 1–3 land, the owner should process the decision queue
(`skillboard brief --include-actions`, one `apply-action` at a time) and let
`migrate v2` complete, so dogfooding exercises the v2 path. Do not automate
this inside this plan.

## Verification (run before marking consumed)

```bash
npm run check                      # syntax + tsc + full test suite
node --test test/route-tokens-unicode.test.mjs
node bin/skillboard.mjs brief --intent "유튜브 쇼츠 영상 제작" \
  --workflow claude-local-manual --config <fixture> --skills <fixture-skills> --json
```

## Changelog / release notes

- Add an `## Unreleased` entry: Added — Unicode (CJK/Hangul) intent
  tokenization for route/brief; Changed — route/can-use/guard usage errors now
  explain the v1/v2 flag vocabulary. Patch-level release (0.3.3) is
  appropriate; no schema change.

## Implementation Progress

- [x] Claim the plan and mark Current Plans as assigned (`f9c35ea`).
- [x] Confirm `phraseKey` is runtime-only under `src/` and `test/`.
- [x] Add failing Unicode token, route-selection, and Korean brief CLI tests.
- [x] Implement Unicode/CJK tokenization and pass focused tests.
- [ ] Add failing v1/v2 flag mismatch and help/reference tests.
- [ ] Implement flag guidance, help/reference consistency, and release notes.
- [ ] Pass diagnostics, full checks, and manual CLI QA.
- [ ] Mark the plan consumed and write the shared Codex work log.

### TDD Notes

- Pre-change RED evidence: token suite failed 4/5 cases and the focused Korean
  brief CLI test returned `recommended_skill: null`; ASCII baseline passed.
- Post-change GREEN evidence: all 5 Unicode/route tests and the focused Korean
  brief CLI test pass; `node --check src/route-tokens.mjs` exits 0.
- ASCII `phraseKey` baseline: `youtube shorts short videos video`.
- No persisted `phraseKey` consumer exists; all references are runtime route
  comparisons in `src/route-selection.mjs`.

### Resume State

Add v1 `--agent` and v2 `--workflow` mismatch tests for route, can-use, and
guard, capture the RED state, then update the shared CLI validation path.
