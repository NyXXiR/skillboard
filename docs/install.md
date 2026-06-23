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
plane without a manual prompt.

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
replace those entries. The merge rewrites YAML formatting for the config file, so
keep custom comments in separate docs if they matter.

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
