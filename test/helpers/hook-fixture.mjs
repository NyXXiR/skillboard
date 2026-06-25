import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeHookFixture(root, workflowName) {
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  await mkdir(skillsRoot, { recursive: true });
  await writeFile(
    configPath,
    `version: 1
skills: {}
workflows:
  ${JSON.stringify(workflowName)}:
    harness: codex
    active_skills: []
    blocked_skills: []
harnesses:
  codex:
    status: primary
    workflows:
      - ${JSON.stringify(workflowName)}
`,
    "utf8"
  );
  return { configPath, skillsRoot };
}
