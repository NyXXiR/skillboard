# Versioning

SkillBoard is public alpha. Package releases follow semantic versioning; policy
schema versions are explicit inside `skillboard.config.yaml`.

## Policy schema timeline

- v0.3.0 introduces policy schema v2; later v0.3.x releases continue to write it.
- v0.3.x provides a one-release read-only window for policy schema v1.
- v0.4.0 removes the v1 reader and v1 compatibility projection.
- v1 mutation is never supported after v2 ships; migrate first.

Exact migration commands:

```bash
skillboard migrate v2 --config <path> --json
skillboard migrate v2 --config <path> --yes --json
skillboard migrate v2 --config <path> --rollback <backup> --json
```

Preview is non-mutating, apply creates an adjacent byte-for-byte backup, and
rollback restores the selected backup. Old action ids, hooks, and lock
projections are invalid after migration.

Starting in 0.3.2, setup and global package updates automatically migrate a
valid version 1 user policy when all migration choices are understood. They use
the same exact-backup, atomic-write, validation, and recovery transaction as
the explicit command. Unknown future ambiguity leaves the policy unchanged and
prints the preview command. A policy skill that is not currently observed also
requires review, preserving future denial semantics. Doctor and project-local
commands remain non-mutating.

## Versioned v2 contract

Policy availability requires `enabled: true` and generated installation presence
for the selected agent. `shared` controls only explicit managed propagation.
Preference ranks only. Source and provenance observations are informational and
cannot change availability. Runtime and action authorization remain outside the
schema.

## Release checklist

1. Run `npm run check`.
2. Run `npm pack --dry-run --json` and inspect public contents.
3. Install the tarball into an isolated prefix and run
   `skillboard doctor --summary`; verify fresh setup, safe v1 auto-migration,
   exact backup preservation, and a
   late-agent shared-skill reconciliation.
4. Confirm `CHANGELOG.md` includes the package version.
5. Push `main` and wait for the complete cross-platform check matrix.
6. Create a matching `vX.Y.Z` tag on that exact green commit.
7. `.github/workflows/publish.yml` verifies the tag exactly matches
   `package.json`, configures the registry URL in `setup-node`, then runs
   `npm publish` with provenance.

After publish, verify the registry version from a clean install. On development
machines with system npm plus a Node version manager, use `npm config get
prefix` and doctor to detect multiple SkillBoard installations; release tooling
never automatically uninstalls another prefix.

Publishing uses `NPM_TOKEN` through `NODE_AUTH_TOKEN`. Prefer npm trusted
publishing with OIDC when available. Release automation skips `npm publish`
only when that exact version already exists on npm.
