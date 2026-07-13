# Adapter Model

Adapters discover skills and runtime components. They do not decide whether a
skill is available.

## Layers

1. Core scanners read common `SKILL.md`, manifest, package, and component shapes.
2. Source profiles describe repository paths and stable id mapping as data.
3. Detector plugins handle installers whose layout cannot be expressed by a
   profile.

Every layer produces deterministic generated inventory. Source, provenance,
path, digest, aliases, install-unit, and runtime-component observations are
optional audit metadata and never determine availability.

## Profile example

```yaml
id: example-pack
source: example/skills
namespace: example
skill_paths:
  - "skills/**/SKILL.md"
path_rules:
  - pattern: "skills/deprecated/**/SKILL.md"
    category: deprecated
```

Profiles may classify paths and describe components. They cannot enable,
disable, share, or unshare skills.

## Import contract

```bash
skillboard import --profile <id-or-path> --source-root <dir> --out <fragment>
skillboard import --profile <id-or-path> --source-root <dir> --config <path> --merge --dry-run
```

Import and inventory refresh create a missing valid v2 entry as
`enabled: true`, `shared: false`, while preserving existing policy. Runtime and
action permission remains with the agent or
harness.

This is a trust-neutral import: import does not review or approve a source and
does not authorize any runtime component. Audit observations remain
informational regardless of whether the fragment is only emitted or merged.

Historical profile fields that encoded status, mode, exposure, or source review
belong only to the v1 migration reader. New profiles must not emit them as
availability policy.
