import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BRIDGE_START = "<!-- BEGIN SKILLBOARD -->";
const BRIDGE_END = "<!-- END SKILLBOARD -->";

export async function initProject(options) {
  const root = options.root;
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  const reportRoot = join(root, ".skillboard", "reports");
  const profileRoot = join(root, ".skillboard", "profiles");
  const created = [];
  const updated = [];
  await mkdir(skillsRoot, { recursive: true });
  await mkdir(reportRoot, { recursive: true });
  await mkdir(profileRoot, { recursive: true });
  if (!(await exists(configPath))) {
    await writeFile(configPath, defaultConfig(), "utf8");
    created.push("skillboard.config.yaml");
  }
  const profileReadmePath = join(profileRoot, "README.md");
  if (!(await exists(profileReadmePath))) {
    await writeFile(profileReadmePath, profileReadme(), "utf8");
    created.push(".skillboard/profiles/README.md");
  }
  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    const result = await ensureBridge(join(root, filename));
    if (result === "created") {
      created.push(filename);
    } else if (result === "updated") {
      updated.push(filename);
    }
  }
  return { created, updated, alreadyInitialized: created.length === 0 && updated.length === 0 };
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function ensureBridge(path) {
  const block = bridgeBlock();
  if (!(await exists(path))) {
    await writeFile(path, `${block}\n`, "utf8");
    return "created";
  }
  const current = await readFile(path, "utf8");
  if (current.includes(BRIDGE_START)) {
    return "unchanged";
  }
  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(path, `${current}${separator}${block}\n`, "utf8");
  return "updated";
}

function defaultConfig() {
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

function bridgeBlock() {
  return `${BRIDGE_START}
# SkillBoard Control Plane

This project uses SkillBoard as the source of truth for agent skill activation.

- Read \`skillboard.config.yaml\` before assuming an installed skill is active.
- Installed \`SKILL.md\` files are not automatically callable.
- Prefer workflow-scoped skills over global skill invocation.
- Only \`global-meta\` skills may be treated as globally available.
- Run \`skillboard check --config skillboard.config.yaml --skills skills\` when policy state matters.
- Run \`skillboard dashboard --config skillboard.config.yaml --skills skills --out .skillboard/reports/skill-map.md\` to refresh the visible control map.
- Run \`skillboard import --profile <id-or-path> --source-root <repo> --out .skillboard/reports/import-fragment.yaml\` after installing a new skill repository, then review the fragment before merging it into \`skillboard.config.yaml\`.

${BRIDGE_END}`;
}

function profileReadme() {
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
