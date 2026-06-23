recommendation: REJECT

blockers:
- Standalone runtime-extension install units are hidden from the doctor/status runtime-unit summary. `src/domain/source-classes.mjs:17` to `src/domain/source-classes.mjs:18` classifies `mcp-server`, `hook`, `agent`, and `lsp` install-unit kinds as `runtime-extension`, but `src/doctor.mjs:148` to `src/doctor.mjs:150` builds `workspace.installUnits.runtimeExtensions` only from `hasRuntimeComponents(unit)`. `hasRuntimeComponents` only checks nested component arrays at `src/domain/source-classes.mjs:85` to `src/domain/source-classes.mjs:86`; standalone runtime units parsed with empty components at `src/install-units.mjs:54` to `src/install-units.mjs:61` are omitted. Direct probe: a config with one `kind: mcp-server` unit produced `bySourceClass.runtime-extension = 1`, `runtimeExtensions = []`, and text output `Runtime extension units: none`.
- The same predicate gap under-reports unreviewed standalone runtime extensions. `src/control.mjs:394` to `src/control.mjs:395` warns on unreviewed runtime extensions only when `hasRuntimeComponents(unit)` is true. A direct probe with `kind: mcp-server`, `trust_level: unreviewed`, and `permission_risk: medium` returned `ok: true`, `blockingWarnings: []`, and only the generic unpinned-source warning, despite the unit being classified as `runtime-extension`.
- Existing tests do not cover the failing class. The added doctor/status tests in `test/cli.test.mjs:141` to `test/cli.test.mjs:216` cover an uninitialized directory, a scaffolded project, text/JSON aliasing, and unmanaged bridge guidance, but not standalone `mcp-server`/`hook`/`agent`/`lsp` install units or their warning status. This leaves a core requested diagnostic surface under-tested.

originalIntent:
Add `skillboard doctor` and `skillboard status` for first-user lifecycle health reporting before continuing inventory refresh work.

desiredOutcome:
The CLI should provide read-only text and JSON health reports that surface config validity, bridge state, workspace counts, source/policy/uninstall summaries, high-risk install units, runtime-extension install units, docs/help/bridge references, and npm package inclusion.

userOutcomeReview:
FAIL. The commands exist, aliases work, output supports text and JSON, initialized and empty-project probes are read-only, docs/help/bridge text mention the commands, and npm pack dry-run includes the new runtime file. However, a valid standalone runtime-extension install unit is reported in the source-class count while the user-facing runtime-extension list says none. That contradicts the requested runtime-unit health surface and can mislead users or agents about MCP server, hook, agent, or LSP install units.

checkedArtifactPaths:
- `/mnt/i/workspace/skill-control-plane/src/doctor.mjs`
- `/mnt/i/workspace/skill-control-plane/src/cli.mjs`
- `/mnt/i/workspace/skill-control-plane/src/index.mjs`
- `/mnt/i/workspace/skill-control-plane/src/lifecycle-content.mjs`
- `/mnt/i/workspace/skill-control-plane/src/domain/source-classes.mjs`
- `/mnt/i/workspace/skill-control-plane/src/install-units.mjs`
- `/mnt/i/workspace/skill-control-plane/src/control.mjs`
- `/mnt/i/workspace/skill-control-plane/src/uninstall.mjs`
- `/mnt/i/workspace/skill-control-plane/test/cli.test.mjs`
- `/mnt/i/workspace/skill-control-plane/test/package.test.mjs`
- `/mnt/i/workspace/skill-control-plane/README.md`
- `/mnt/i/workspace/skill-control-plane/docs/install.md`
- `/mnt/i/workspace/skill-control-plane/package.json`
- `/mnt/i/workspace/skill-control-plane/.omo/evidence/skillboard-doctor-status-code-review.md`
- `/mnt/i/workspace/skill-control-plane/.omo/evidence/skillboard-doctor-status-cli/`
- `/mnt/i/workspace/skill-control-plane/.omo/evidence/skillboard-review-notepad.md`

directVerification:
- Loaded and applied `omo:remove-ai-slops` and `omo:programming` criteria directly. No deletion-only tests or tautological removal tests were found in the doctor/status tests, but coverage is too narrow for the requested runtime-extension diagnostic class. The touched `src/cli.mjs` and `test/cli.test.mjs` remain oversized; this is a residual maintainability risk, but the runtime-unit behavior defect is the approval blocker.
- `npm test`: PASS, 67 tests, 0 failures.
- `npm run diagnostics`: PASS.
- `npm run check`: PASS, including syntax check, diagnostics, and 67 tests.
- `node bin/skillboard.mjs --help`: PASS; help lists `doctor` and `status`.
- Initialized temp project probe: PASS; `doctor` text and `status --json` exit 0 and report config, bridges, policy/source summaries, and uninstall dry-run arrays/counts without mutating outside the temp fixture.
- Empty temp project probe: PASS; `doctor --json` exits 1 and leaves the directory empty.
- `npm pack --dry-run --json`: PASS; includes `src/doctor.mjs`, excludes `.omo/`, `test/`, and `package-lock.json`.
- Standalone runtime-unit probe: FAIL; `kind: mcp-server` is counted as `runtime-extension=1` but omitted from `runtimeExtensions` and text says `Runtime extension units: none`.
- Unreviewed standalone runtime-unit probe: FAIL; `kind: mcp-server` with `trust_level: unreviewed` returns `ok: true` and `blockingWarnings: []`.

exactEvidenceGaps:
- No current passing code-review artifact supports approval for the latest doctor/status implementation. The available `.omo/evidence/skillboard-doctor-status-code-review.md` includes a skill-perspective check, but it is a FAIL report and remains consistent with the reproduced runtime-extension class gap after partial fixes.
- Existing doctor/status QA artifacts cover help, empty project, initialized project, and alias JSON, but they do not cover standalone runtime-extension kinds, broken bridge status, invalid config text output, or source/policy warning detail visibility.
- Text-mode uninstall output reports counts only, while JSON includes the arrays. This is not the main blocker, but the completeness of the requested text "uninstall summary" remains less evidenced than JSON.
