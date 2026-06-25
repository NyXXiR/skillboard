export const BRIDGE_START = "<!-- BEGIN SKILLBOARD -->";
export const BRIDGE_END = "<!-- END SKILLBOARD -->";

export function defaultConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true

skills: {}
capabilities: {}
harnesses: {}
workflows: {}
install_units: {}
`;
}

export function bridgeBlock() {
  return `${BRIDGE_START}
# SkillBoard Control Plane

This project uses SkillBoard as the source of truth for agent skill activation.

- Read \`skillboard.config.yaml\` before assuming an installed skill is active.
- Installed \`SKILL.md\` files are not automatically callable.
- When a user asks what skills are available, run \`skillboard brief --json --config skillboard.config.yaml --skills skills\` before answering. If the workflow is known, include \`--workflow <name>\`; add \`--include-actions\` only when the user wants change suggestions.
- Treat the brief sections headed "What your AI can use now", "Needs review", and "Blocked for safety" as the availability summary; do not infer availability from \`SKILL.md\` bodies.
- Immediately before actual invocation, run \`skillboard guard use <skill-id> --workflow <name> --config skillboard.config.yaml --skills skills\`.
- Use \`skillboard can-use <skill-id> --workflow <name> --config skillboard.config.yaml --skills skills --json\` for machine-readable agent decisions.
- Action cards are suggestions, not authorization. Request user confirmation before applying any action card that mutates policy, trust, hooks, reset state, or skill references.
- After applying any mutating action card, rerun \`skillboard brief --json --config skillboard.config.yaml --skills skills\` before answering the next availability question or applying another action.
- Run \`skillboard audit sources --config skillboard.config.yaml --skills skills\` before trusting newly imported external skill sources.
- Run \`skillboard review install-unit <unit-id> --trust-level reviewed --config skillboard.config.yaml --skills skills\` after reviewing an external source and before enabling automatic invocation from it.
- Preview guard hook installation with \`skillboard hook install --workflow <name> --config skillboard.config.yaml --skills skills --out .skillboard/hooks/<name>-guard.sh --dry-run --json\`; inspect \`planned.preview.shell\`, then run the same command without \`--dry-run --json\` only when ready to materialize an executable guard hook.
- Prefer workflow-scoped skills over global skill invocation.
- Only \`global-meta\` skills may be treated as globally available.
- Run \`skillboard doctor --config skillboard.config.yaml --skills skills\` or \`skillboard status --config skillboard.config.yaml --skills skills --json\` to inspect control-plane health; add \`--strict\` when review-needed safe mode should fail automation.
- Run \`skillboard check --config skillboard.config.yaml --skills skills\` when policy state matters.
- Run \`skillboard dashboard --config skillboard.config.yaml --skills skills --out .skillboard/reports/skill-map.md\` to refresh the visible control map.
- Run \`skillboard add skill <skill-id> --path <relative-skill-path> --config skillboard.config.yaml --skills skills\` to register a user-owned skill without treating the file as automatically active.
- Run \`skillboard add harness <harness-name> --config skillboard.config.yaml --skills skills\` and \`skillboard add workflow <workflow-name> --harness <harness-name> --config skillboard.config.yaml --skills skills --skill <skill-id>\` to add local growth paths without editing YAML by hand.
- Use \`skillboard activate <skill-id> --workflow <name> --config skillboard.config.yaml --skills skills\` and \`skillboard block <skill-id> --workflow <name> --config skillboard.config.yaml --skills skills\` for workflow-scoped enablement.
- Use \`skillboard remove skill <skill-id> --config skillboard.config.yaml --skills skills --force\` only after reviewing \`skillboard impact disable <skill-id> --config skillboard.config.yaml --skills skills\`; removal updates policy references while leaving \`SKILL.md\` files on disk.
- Run \`skillboard inventory refresh --dry-run --config skillboard.config.yaml\` after installing a new local agent skill pack, plugin, workflow bundle, or harness.
- Run \`skillboard import --profile <id-or-path> --source-root <repo> --out .skillboard/reports/import-fragment.yaml\` after installing a new skill repository, then review the fragment before merging it into \`skillboard.config.yaml\`.

${BRIDGE_END}`;
}

export function profileReadme() {
  return `# SkillBoard source profiles

Put project-specific source profiles here when a skill repository or harness
bundle is not covered by a built-in profile.

Use:

\`\`\`bash
skillboard import --profile .skillboard/profiles/example.yaml --source-root /path/to/repo
\`\`\`

The import command emits a YAML fragment with governed \`skills\` and
\`install_units\`. Review the fragment before merging it into
\`skillboard.config.yaml\`; imported skills are not automatically active.
`;
}

export function hookReadme() {
  return `# SkillBoard hooks

Use this directory for executable guard scripts generated by:

\`\`\`bash
skillboard hook install --workflow <name> --config skillboard.config.yaml --skills skills --out .skillboard/hooks/<name>-guard.sh --dry-run --json
skillboard hook install --workflow <name> --config skillboard.config.yaml --skills skills --out .skillboard/hooks/<name>-guard.sh
\`\`\`

Preview the JSON plan first and inspect \`planned.preview.shell\` before applying.
The generated script delegates to \`skillboard guard use\` and can be wired into
the hook mechanism of the active harness.
`;
}
