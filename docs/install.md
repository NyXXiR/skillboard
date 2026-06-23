# Install And Bootstrap

SkillBoard sits one layer above skill installers, plugin marketplaces, harness
bundles, and local skill repositories.

## Install From npm

After publishing:

```bash
npm install -g agent-skillboard
skillboard init
```

The executable remains `skillboard` even though the npm package name is
`agent-skillboard`.

## Install From A Clone

```bash
git clone <your-skillboard-repo-url>
cd skillboard
npm install
npm link
skillboard init --dir /path/to/your/project
```

## What init Does

`skillboard init` is the safe mutating step. npm installation itself does not
modify a project, but init creates the files that let agents discover the control
plane without a manual prompt and inventories already installed local agent
skills.

Created project files:

- `skillboard.config.yaml`: desired state for workflows, capabilities, skills,
  harnesses, and install units.
- `skills/`: local skill root.
- `.skillboard/reports/`: generated dashboard and reconcile output location.
- `.skillboard/profiles/`: project-specific source profile location.
- `AGENTS.md`: Codex-style project instruction bridge.
- `CLAUDE.md`: Claude Code project instruction bridge.

The bridge block is marked with `BEGIN SKILLBOARD` / `END SKILLBOARD` and is
idempotent. Running init again does not duplicate it.

By default, init scans known local agent skill roots such as Codex user skills,
Codex system skills, and Codex plugin-cache manifests. Discovered skills are
written to `skillboard.config.yaml` as managed install-unit components with
`status: quarantined` and `invocation: blocked`, so the first run creates
visibility without granting call permission. Plugin hooks, MCP servers,
commands, and modified config files are recorded on the owning install unit when
manifest metadata exposes them, which lets policy checks flag high-risk runtime
extensions without flattening them into loose skills. Use `--no-scan-installed`
for a scaffold-only bootstrap, or `--scan-root <dir>[,<dir>]` to add
server-specific skill roots during bootstrap.

## Uninstall From A Project

Package removal and project cleanup are intentionally separate. `npm uninstall
-g agent-skillboard` removes the CLI package, but it does not edit a project.
Use the project cleanup command when you want to remove the bridge files created
by init:

```bash
skillboard uninstall --dir /path/to/your/project --dry-run
skillboard uninstall --dir /path/to/your/project
```

Default uninstall behavior is conservative:

- removes only the `BEGIN SKILLBOARD` / `END SKILLBOARD` bridge block from
  `AGENTS.md` and `CLAUDE.md`;
- deletes a bridge file only when it has no user content left;
- deletes `.skillboard/profiles/README.md` and `.skillboard/hooks/README.md`
  only when they still exactly match the generated text;
- removes empty generated directories;
- preserves `skillboard.config.yaml`, `skills/`, reports, and modified files by
  default.

Use `--remove-config` to delete `skillboard.config.yaml` only when it still
matches the untouched default config. If the config contains scanned skills or
user edits, uninstall preserves it and reports it under `Preserved`.

## Upper-Layer Control

After installing skill packs or harness bundles, represent them as install
units:

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/mattpocock-skills \
  --out .skillboard/reports/mattpocock-import.yaml
```

The import output is a reviewable YAML fragment. Merge the accepted `skills` and
`install_units` into `skillboard.config.yaml`; imported skills stay inactive
until workflows and policies explicitly use them.

For a direct but still safe apply path:

```bash
skillboard import \
  --profile github.mattpocock.skills \
  --source-root /path/to/mattpocock-skills \
  --config skillboard.config.yaml \
  --merge
```

`--merge` refuses to overwrite existing `skills` or `install_units`. Add
`--replace` only when you intentionally want the imported source profile to
replace those entries. The merge uses a structured YAML writer that keeps normal
comments and ordering where possible, but review the diff before committing
hand-edited formatting.

```yaml
install_units:
  github.mattpocock.skills:
    kind: marketplace
    source: npx skills@latest add mattpocock/skills
    scope: user-global
    provided_components:
      - skills
    components:
      skills:
        - matt.tdd
```

Then link each governed skill back to its owner:

```yaml
skills:
  matt.tdd:
    path: matt/tdd
    status: active
    invocation: workflow-auto
    exposure: exported
    owner_install_unit: github.mattpocock.skills
```

Run:

```bash
skillboard check --config skillboard.config.yaml --skills skills
skillboard dashboard --config skillboard.config.yaml --skills skills --out .skillboard/reports/skill-map.md
```

This keeps multiple installed repositories visible as managed units instead of
turning every skill into a global invocation candidate.

## Adapter Direction

Import support should be profile-driven, not hardcoded. A popular source such as
`mattpocock/skills` or `oh-my-openagent` may ship with a built-in source profile,
but that profile should be data that maps repository layout and defaults into the
same install-unit model. Source-specific code should be limited to detector
plugins for layouts that cannot be described declaratively.

See [adapters.md](adapters.md).
