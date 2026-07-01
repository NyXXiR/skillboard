# Adapter Model

SkillBoard should not hardcode one adapter per popular repository.

The core should stay generic, and repository-specific behavior should live in
data-driven source profiles wherever possible.

## Layers

1. Core scanners

   Generic code that understands common primitives:

   - `SKILL.md` folders with YAML frontmatter;
   - plugin or marketplace manifests;
   - package manager metadata;
   - known user/project install scopes;
   - command, hook, MCP, agent, and LSP component lists.

2. Source profiles

   Declarative profiles that describe how to interpret a source:

   ```yaml
   id: github.mattpocock.skills
   source: mattpocock/skills
   kind: marketplace
   namespace: matt
   target_path_prefix: matt
   default_status: vendor
   default_invocation: manual-only
   default_exposure: exported
   skill_paths:
     - "skills/**/SKILL.md"
     - "*/SKILL.md"
   category_path_segment: 1
   path_rules:
     - pattern: "skills/deprecated/**/SKILL.md"
       status: deprecated
       invocation: deprecated
       category: deprecated
   ```

   A profile can set namespace, default policy, component mapping, known manifest
   paths, category extraction, lifecycle overrides, and risk hints without
   requiring code changes.

   `category_path_segment` reads a slash-separated path segment from the matched
   `SKILL.md` path. For example, `skills/engineering/tdd/SKILL.md` with segment
   `1` becomes category `engineering`. `path_rules` apply first-match overrides
   for repository conventions such as `deprecated` or `in-progress` folders.

3. Detector plugins

   Code adapters are only for sources whose layout cannot be described
   declaratively, such as installers that mutate multiple config files or require
   command output parsing. These should be small detector modules that produce the
   same install-unit data model as profiles.

## Built-In Profiles Are Not Hardcoding

SkillBoard can ship built-in profiles for popular ecosystems, but they should be
treated as bundled data, not product logic. Users and communities should be able
to add or override profiles without forking the CLI.

Good built-ins:

- `mattpocock/skills`: skill pack profile.
- `code-yeongyu/oh-my-openagent`: harness/plugin bundle profile.
- `anthropics/skills`: standard Agent Skills profile.
- `wshobson/agents`: marketplace/plugin profile.
- `VoltAgent/awesome-agent-skills`: catalog profile.

Bad design:

- `if repo === "mattpocock/skills"` branches in the import logic;
- repo-specific policy decisions embedded in TypeScript;
- automatic global activation because a known repository was installed.

## Import Output Contract

Every profile or detector should output the same normalized shape:

- install units;
- declared skills;
- owner links via `owner_install_unit`;
- component lists;
- guessed capabilities;
- default invocation and exposure;
- warnings and decisions requiring user approval.

Current CLI surface:

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/source \
  --out .skillboard/reports/import-fragment.yaml
```

The command emits a config fragment rather than mutating policy automatically.
This keeps the control plane reviewable while still avoiding hardcoded adapter
branches.

When the fragment is acceptable, the same importer can merge it:

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/source \
  --config skillboard.config.yaml \
  --merge \
  --dry-run
```

Merge is append-only by default and refuses duplicate skill or install-unit ids.
`--replace` is the explicit overwrite escape hatch. Drop `--dry-run` after
reviewing the change plan.

The reconciler then applies the same policy rules regardless of source.

## Default Safety

New external skills should default to `vendor` or `candidate`, with
`manual-only` or `router-only` invocation. Personal control skills can become
`global-meta`, but external repositories should not gain `global-auto` through an
adapter.
