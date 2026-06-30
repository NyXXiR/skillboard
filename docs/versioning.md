# Versioning

SkillBoard has several versioned surfaces. They should not all move at the same
pace, and not every skill file belongs in central version control.

This document defines the public alpha policy for releases, config compatibility,
source profiles, and the generated lockfile.

## Status

Current package version: `0.1.2`

Current config schema version:

```yaml
version: 1
```

The project is a public alpha. Breaking changes are allowed before `1.0.0`, but
they must be documented in release notes and should include a migration note when
they affect user config.

## Versioned Surfaces

SkillBoard versions these surfaces deliberately:

- CLI package version: the npm package and command behavior.
- Config schema version: the top-level `version` field in
  `skillboard.config.yaml`.
- Source profile format: YAML files under `profiles/` and project-specific
  `.skillboard/profiles/`.
- Workflow contracts: workflow names, required capabilities, active skill pools,
  required outputs, and harness choices.
- Capability contracts: canonical skill, alternatives, and default policy for a
  capability.
- Exported skill entries: shared or vendor skills governed by SkillBoard.
- Install-unit entries: plugin, marketplace, package, harness, MCP, hook, agent,
  and LSP sources.
- Lockfile data: pinned source/cache digest, skill content digests, policy, and
  compatible harnesses.

SkillBoard does not try to centrally version every prompt or helper skill. A
workflow-internal private skill can remain inside that workflow package until it
becomes shared, auto-invokable, vendor-provided, or cross-workflow.

## Release Versioning

The package follows SemVer with a stricter alpha convention:

- Patch: bug fixes, docs, new tests, safer validation, and non-breaking profile
  additions.
- Minor: new commands, new config fields with safe defaults, new report sections,
  new built-in source profiles, and new policy checks that are warnings first.
- Major: post-`1.0.0` breaking CLI, config, or policy behavior.

Before `1.0.0`, breaking changes may happen in minor releases, but the changelog
must call them out clearly.

Suggested tags:

- `v0.1.0-alpha`: first public GitHub alpha.
- `v0.2.0-alpha`: source inventory refresh, doctor/status, source pin refresh,
  installer/config detection, resilient detector warnings, and richer dry-run
  plans.
- `v0.3.0-alpha`: signed remote source verification hardening and migration
  workflow.
- `v1.0.0`: config schema and core CLI behavior are stable enough for external
  workflows to rely on.

## Config Schema Version

The top-level `version` field is the schema version, not the package version.

Rules:

- `version: 1` is the only supported schema today.
- Missing `version` is treated as `1` for early compatibility.
- Unsupported future versions must fail fast rather than silently parsing with
  older semantics.
- New fields should default to the safest behavior.
- New automatic invocation behavior must be opt-in.
- New policy checks should start as warnings unless they protect an important
  safety boundary.

Breaking schema changes need a migration note. A future `skillboard migrate`
command can automate those changes, but it is not implemented yet.

## Source Profile Versioning

Source profiles are data, not hardcoded adapter branches. Built-in profiles live
under `profiles/`; project profiles can live under `.skillboard/profiles/`.

Profile compatibility rules:

- Adding a new built-in profile is a patch or minor change.
- Changing a built-in profile's namespace, target path prefix, default status,
  default invocation, or default exposure is a breaking profile behavior change.
- External profiles should not grant `global-auto` unless they also mark the
  imported skills as `global-meta`.
- External repository skills should normally import as `vendor`, `candidate`, or
  `quarantined`, with `manual-only` or `router-only` invocation.
- Harness/plugin bundle profiles should use `unit-managed` for child skills when
  the parent bundle owns commands, hooks, MCP servers, or config mutation.

Profile imports can be reviewed as fragments or merged directly:

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/source \
  --out .skillboard/reports/import-fragment.yaml
```

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/source \
  --config skillboard.config.yaml \
  --merge \
  --dry-run
```

`--merge` is append-only by default. `--replace` is required to overwrite
existing skill or install-unit ids. Drop `--dry-run` only after reviewing the
reported text and YAML semantic change plan.

## Workflow And Capability Versioning

The primary unit of compatibility is the workflow, not an individual skill.

Version these centrally:

- workflow name and intent;
- harness and fallback harness assumptions;
- required capabilities;
- active, blocked, and manual-only skill pools;
- required outputs;
- exported skill contracts used by more than one workflow;
- policy decisions that allow automatic invocation.

Avoid central versioning for:

- one-off prompts;
- workflow-internal helper skills;
- private skills used by only one workflow;
- temporary templates that are not auto-invokable;
- implementation details inside a harness bundle.

When a workflow changes its required outputs, required capabilities, or
workflow-auto skill set, treat it as a compatibility change even if no file paths
changed.

## Lockfile Policy

`skillboard lock write` generates `skillboard.lock.yaml` from the current
workspace.

The lockfile pins:

- config schema version;
- install-unit source, cache path, verified path, digest, and trust status;
- skill id, path, and content hash;
- workflow/capability bindings;
- generated timestamp.

The lockfile should represent a verified working set, not a desired-state file.
Users should edit `skillboard.config.yaml`; tools should generate the lockfile.
Local `source` and `cache_path` entries are digest-verified by `skillboard audit
sources --verify`. Remote or command-based sources need a configured
`source_digest` and, when signatures are used, a matching `public_key`.
Fetchable Git sources can be materialized and pinned with `skillboard sources
refresh`, which updates `cache_path`, `source_digest`, and `verified_at` in the
config after cloning into `.skillboard/sources/`.
Relative local paths are resolved from the config directory first and then from
the current working directory, so bundled examples can use project-root-relative
paths while project configs can still keep config-local paths.
`skillboard lock write` refuses to write when verification has errors unless
`--allow-unverified` is passed explicitly for investigation artifacts.

## Release Checklist

Before tagging a public release:

- Run `npm run check`.
- Run `node --check` across `src`, `test`, and `bin`.
- Run `npm pack --dry-run --json` and confirm internal artifacts are excluded.
- Run at least one CLI smoke test through the public surface.
- Confirm docs mention any breaking config, profile, or CLI changes.
- Update package version and release notes.
- Confirm npm Trusted Publisher is configured for package `agent-skillboard`,
  repository `NyXXiR/skillboard`, workflow filename `publish.yml`, and allowed
  action `npm publish`.
  - If `npm trust github agent-skillboard --repo NyXXiR/skillboard --file
    publish.yml --allow-publish` cannot configure it from the CLI, use the npm
    package settings page and add a GitHub Actions trusted publisher with the
    same repository, workflow filename, and allowed action.
  - The publish job uses GitHub Actions OIDC and `npm publish --provenance`
    without `NPM_TOKEN`; do not add `NODE_AUTH_TOKEN` or a setup-node
    `registry-url` that creates a token placeholder.
- Push a version tag that exactly matches `package.json`, for example `v0.1.2`
  for package version `0.1.2`.
- Let `.github/workflows/publish.yml` publish from the tag. The workflow runs
  the full check suite, validates that the tag matches the package version, and
  skips `npm publish` only when that exact version already exists on npm.

For alpha releases, include a short "completion notes" section. Current
completion notes:

- source inventory refresh covers known local agent skill roots, plugin-cache
  manifests, and user-supplied scan roots;
- `sources refresh` covers Git-compatible remote sources and digest pin refresh;
- `inventory detect` covers installer output and explicit mutated config files
  for commands, hooks, MCP servers, and modified config paths;
- dry-run plans report a capped YAML semantic change list rather than full patch
  hunks;
- unusual YAML trivia may still be normalized during structured config writes.

## 0.1.1 Completion Notes

- duplicate installed skill IDs are consolidated into one canonical skill entry
  with duplicate source locations preserved as metadata;
- canonical duplicate skills can be shared by Codex and Hermes local workflows
  without generating user-visible `-2` suffixes;
- README and install docs include a Hermes system prompt bridge for profiles
  that do not automatically read `AGENTS.md` or `CLAUDE.md`.

## 0.1.2 Completion Notes

- add `--version` and `-v` flags to the CLI for fast version verification in
  npm, global, source-tree, and tarball installs;
- add a dedicated test for the version flags;
- update README quick-start to verify the installed version before running
  policy commands.
