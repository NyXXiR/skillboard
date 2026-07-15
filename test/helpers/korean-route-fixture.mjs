import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withKoreanRouteFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-korean-route-"));
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  const skillRoot = join(skillsRoot, "openmontage-qwen-shorts");
  try {
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      [
        "---",
        "name: openmontage-qwen-shorts",
        "description: OpenMontage 스타일 유튜브 쇼츠 제작 파이프라인 for YouTube Shorts video production.",
        "---",
        "# OpenMontage Qwen Shorts",
        ""
      ].join("\n"),
      "utf8"
    );
    await writeFile(configPath, koreanRouteConfig(), "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function koreanRouteConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  openmontage-qwen-shorts:
    path: openmontage-qwen-shorts
    status: active
    invocation: manual-only
    exposure: exported
    category: video
workflows:
  codex-local-manual:
    harness: codex
    active_skills:
      - openmontage-qwen-shorts
harnesses:
  codex:
    status: primary
    workflows:
      - codex-local-manual
`;
}
