# Changelog

## Unreleased

## 0.3.0 — 2026-07-13

### Changed

- Replaced the v1 policy matrix with schema v2's user-level decisions:
  enable/disable and explicit per-skill cross-agent sharing.
- Made valid installed skills enabled and agent-local by default; `shared: true`
  preserves originals while creating managed compatible copies.
- Added generated `installed_on` inventory so route and guard evaluate the
  selected agent without a user-managed agent matrix.
- Made normal setup, brief, route, guard, and policy mutations use home state
  from any working directory; project init is no longer part of the v2 flow.
- Limited optional preference to candidate ranking; preference never changes
  availability or sharing.
- Moved source, provenance, install-unit, digest, alias, and risk observations to
  optional generated audit metadata that cannot block a skill.
- Added explicit preview, apply, and byte-restoring rollback documentation for
  `skillboard migrate v2`.
- Scheduled removal of the one-release v1 read-only compatibility window for
  v0.4.0.
- Added `skill forget` for explicit policy-only cleanup after an owning
  installer removes a local skill.
- Added `uninstall --user` dry-run and confirmed apply flows that remove all
  marker-owned shared copies, managed guidance, and home state while preserving
  agent-owned and unmanaged skills.
- Restored the declared Node.js 14.21 runtime floor and added release gates for
  Node.js 14.21, 20, and 22 on Ubuntu, macOS, and Windows.

### Fixed

- Prevented removed skills from leaving unrecoverable stale policy that keeps
  doctor unhealthy.
- Prevented package removal from orphaning SkillBoard-managed shared copies in
  supported agent skill roots.
- Replaced Node 15/16-only clone, string replacement, recursive copy, and npm
  smoke-test APIs with Node.js 14.21-compatible paths.

### Security

- Clarified that SkillBoard does not authorize hooks, MCP servers, commands,
  external writes, destructive actions, or secrets; those remain runtime and
  harness permission decisions.

## 0.2.18 — 2026-07-07

### Changed

- Deprecated `skillboard init` from the normal first-use path across README,
  install docs, reference docs, CLI help, postinstall/setup guidance, and
  generated agent guidance.
- Reframed normal onboarding around global install/postinstall and agent-layer
  `skillboard setup`, with `init` reserved for legacy project-local policy
  workspaces.
- Updated `doctor` help and recommendations so it no longer reads as an
  `init` prerequisite for new users.

### Fixed

- Added regression coverage that prevents primary README/install/reference/help
  surfaces from reintroducing `init` or bare project-bootstrap wording as the
  normal setup flow.

## 0.2.17 — 2026-07-07

### Changed

- Reworked the README opening and quick start so developers using multiple
  agents, skill packs, plugins, MCP tools, or marketplaces can understand
  SkillBoard's purpose and try the CLI with read-only `npm exec` commands before
  installing it globally.

### Fixed

- Kept packaged npm smoke tests compatible with Node 20 release checks that run
  inside an outer `npx -p node@20 -c ...` invocation.

## 0.2.16 — 2026-07-06

### Changed

- Reframed SkillBoard as a permissive overlap-routing layer so agents continue
  working with already-allowed skills instead of interrupting users for
  pre-task settings.
- Split routing and agent-integration internals into smaller modules while
  preserving the existing CLI surface.
- Setup guidance now clarifies that postinstall performs agent-layer setup only;
  project initialization remains an explicit `skillboard init` step.

### Fixed

- Hardened setup and uninstall lifecycle cleanup around symlinked managed
  guidance paths and project state directories.
- Preserved Node.js 14.21 runtime compatibility by avoiding newer
  `replaceAll`/`.at()` APIs in shipped runtime paths.
- Avoided macOS false positives when agent homes live below symlinked system
  ancestors such as `/var`.

## 0.2.15 — 2026-07-03

### Fixed

- Sudo setup now restores ownership for content-identical managed guidance
  files reported as `Unchanged`, repairing existing root-owned guidance on
  reinstall or explicit `skillboard setup --yes`.

## 0.2.14 — 2026-07-03

### Fixed

- Sudo ownership restoration now only chowns managed guidance paths inside the
  resolved invoking user's home, avoiding accidental ownership changes for
  explicit agent roots outside that home.

## 0.2.13 — 2026-07-03

### Fixed

- Sudo-driven setup now restores ownership of managed agent guidance files and
  directories under the invoking user's home to `SUDO_UID:SUDO_GID`, avoiding
  root-owned `SKILL.md` files after `sudo npm install -g agent-skillboard`.

## 0.2.12 — 2026-07-03

### Changed

- Install help and docs now state that global npm installs and updates rerun
  agent-layer setup automatically, refreshing managed guidance files and
  installing into newly detected supported agent roots.

### Fixed

- Added regression coverage for update-style postinstall runs so managed
  SkillBoard guidance is refreshed and newly detected agent roots are installed
  during the same lifecycle pass.

## 0.2.11 — 2026-07-03

### Fixed

- Codex setup now creates and installs into `~/.agents/skills` when the user
  already has a `~/.agents` home, even if `~/.agents/skills` did not exist yet
  and `~/.codex/skills` was also detected.

## 0.2.10 — 2026-07-03

### Fixed

- `sudo npm install -g agent-skillboard` now resolves `SUDO_USER` during
  install-time setup so the SkillBoard guidance skill is written to the
  invoking user's agent homes instead of `/root`.

### Changed

- Install docs and CLI help now describe both normal global npm installs and
  sudo/system npm installs, including the distinction between agent-home setup
  and npm's executable prefix.

## 0.2.9 — 2026-07-03

### Changed

- Lowered the published runtime engine requirement from Node.js `>=20` to
  `>=14.21` after validating CLI smoke on Node 14.21 and 16.20 plus the full
  test suite on Node 18.19.

### Fixed

- Replaced runtime use of `node:readline/promises` and
  `String.prototype.replaceAll` so the CLI can load and run on older Node.js
  versions without npm `EBADENGINE` warnings on common system Node installs.

## 0.2.8 — 2026-07-03

### Added

- `skillboard import-skill` can reuse a user skill across Codex, Claude,
  OpenCode, and Hermes by copying compatible skills or installing an
  user-approved adapted `SKILL.md` with provenance.
- Global npm installs now run best-effort agent-layer setup for detected
  supported user skill roots; `skillboard setup` remains available for later
  agent additions, skipped lifecycle scripts, or repair.

### Changed

- Agent root scanning is now shared across setup, cross-agent import, and
  installed-skill inventory. Codex detection includes `CODEX_HOME/skills`,
  `AGENTS_HOME/skills`, `~/.agents/skills`, and `~/.codex/skills`.
- Setup stays conservative: broad auto-detection writes only to explicit env
  roots or existing known roots, while `--agent` keeps an explicit fallback for
  fresh agent homes.

## 0.2.7 — 2026-07-03

### Fixed

- Direct `skillboard activate` and `skillboard prefer` now refuse reviewed
  runtime/plugin skills that remain `status: blocked`, preserving the blocked
  state outside action-card flows.

## 0.2.6 — 2026-07-03

### Fixed

- Reviewed runtime/plugin skills with `status: blocked` no longer receive
  activation action cards or apply through `apply-action`; only reviewed
  quarantined blocked-invocation skills can be activated as manual-only.

## 0.2.5 — 2026-07-03

### Fixed

- Reset-cleanup action cards now use the same full `.skillboard/` purge
  semantics as `skillboard uninstall --purge` for both preview and apply.

## 0.2.4 — 2026-07-03

### Changed

- `skillboard uninstall --purge` now removes the entire `.skillboard/` project
  state directory, including source caches, rollout logs, variant snapshots, and
  profiles, while preserving local skill files.

## 0.2.3 — 2026-07-03

### Added

- `skillboard uninstall --purge` removes SkillBoard config, reports, hooks,
  bridge blocks, and empty generated directories while preserving local skill
  files.

### Changed

- Cleanup action cards now present the shorter purge command instead of the
  three-flag reset form.
- Uninstall help and docs clarify the difference between conservative bridge
  removal and full SkillBoard policy-footprint removal.

## 0.2.2 — 2026-07-03

### Changed

- High-risk runtime/plugin source action cards now recommend a one-time source review instead of defaulting to a block action.
- Reviewed quarantined runtime/plugin skills can be activated into a workflow as `manual-only` skills, keeping ask-after preference learning separate from source trust review.
- Bootstrap and install docs explain source review followed by manual activation for runtime/plugin skills.
- Generated guard hooks pin their install-time SkillBoard command, config, skills root, and workflow instead of accepting environment overrides for those trust-boundary values.
- README now surfaces public alpha and config schema v1 status near the quick product summary.
- npm package contents exclude historical planning documents under `docs/plans`.
- CI check matrix includes Node 24 before publish-time verification.

## 0.2.1 — 2026-07-02

### Added

- Ask-after skill routing guidance for ambiguous or fallback skill choices.
- Packaged runtime smoke coverage for npm-installed SkillBoard usage.

### Changed

- Release automation now skips publishing only when the exact npm version already exists.
- AI bridge guidance emphasizes route candidates, post-use policy suggestions, and guard disclosure.

## 0.2.0 — 2026-06-30

### Added

- AI-mediated brief/action-card flow with current action IDs and post-apply brief refresh.
- Source inventory refresh, doctor/status summaries, source pin refresh, and install-output detection.
- Richer dry-run plans for lifecycle, import, hook, and cleanup workflows.

### Changed

- README and install docs now lead with low-burden npm usage instead of source-tree setup.
- Workflow routing now separates installed skills from currently allowed skills more explicitly.

## 0.1.2 — 2026-06-29

### Added

- CLI `--version` and `-v` flags for quick version verification across npm, global, source-tree, and tarball installs.
- Test coverage for the new version flags.

### Changed

- README 5-Minute Quick Start now verifies the installed version as a first step.

## 0.1.1 — 2026-06-26

### Added

- npm publication for `agent-skillboard`.
- Consolidation of duplicate installed skill IDs into canonical entries.
- Hermes system prompt bridge guide in README and install docs.
