import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";

export const BASE_SKILL_CONTENT = "---\nname: base-review\ndescription: Base review skill.\n---\n# Base Review\n";
export const CHANGED_SKILL_CONTENT = `${BASE_SKILL_CONTENT}\nManual Claude adaptation.\n`;

export function rawSha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function withControlVariantWorkspace(options = {}, run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-control-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const baseFile = join(skillsRoot, "base", "review", "SKILL.md");
    const variantFile = join(skillsRoot, "claude", "review", "SKILL.md");
    await mkdir(dirname(configPath), { recursive: true });
    if (options.createBase !== false) {
      await mkdir(dirname(baseFile), { recursive: true });
      await writeFile(baseFile, options.baseContent ?? BASE_SKILL_CONTENT, "utf8");
    }
    if (options.variantContent !== undefined) {
      await mkdir(dirname(variantFile), { recursive: true });
      await writeFile(variantFile, options.variantContent, "utf8");
    }
    await writeFile(configPath, controlVariantConfig(options), "utf8");
    return await run({ configPath, root, skillsRoot, baseFile, variantFile });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function readConfig(configPath) {
  return YAML.parse(await readFile(configPath, "utf8"));
}

export function snapshotPath(skillId, name) {
  return `.skillboard/variant-snapshots/${encodeURIComponent(skillId)}/${name}.md`;
}

export async function writeSnapshot(root, storedPath, content) {
  const path = join(root, storedPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return path;
}

export function lifecycleVariantSkill(options = {}) {
  const baseDigest = options.baseDigest ?? rawSha256(BASE_SKILL_CONTENT);
  const approvedDigest = options.approvedDigest;
  const owner = options.ownerInstallUnit === undefined ? "" : `    owner_install_unit: ${options.ownerInstallUnit}\n`;
  const approvedBlock = approvedDigest === undefined ? "" : `      approved:\n        content_digest: ${approvedDigest}\n        snapshot: ${options.approvedSnapshot ?? snapshotPath("claude.review", "approved")}\n`;
  return `  claude.review:\n    path: claude/review\n    status: ${options.skillStatus ?? "candidate"}\n    invocation: ${options.invocation ?? "manual-only"}\n    exposure: exported\n    category: agent\n${owner}    variant:\n      of: base.review\n      adapted_for: Claude review\n      capability: task-review\n      workflow: claude-workflow\n      status: ${options.variantStatus ?? "draft"}\n      base:\n        content_digest: ${baseDigest}\n        snapshot: ${options.baseSnapshot ?? snapshotPath("claude.review", "base")}\n${approvedBlock}`;
}

function controlVariantConfig(options = {}) {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
skills:
  base.review:
    path: base/review
    status: active
    invocation: workflow-auto
    exposure: exported
    category: core
${options.variantSkill ?? ""}capabilities:
  task-review:
    canonical: base.review
    alternatives: []
    default_policy: workflow-auto
harnesses:
  claude:
    status: available
    workflows:
      - claude-workflow
workflows:
  claude-workflow:
    harness: claude
    active_skills:
      - base.review
    blocked_skills: []
    required_capabilities:
      task-review:
        preferred: base.review
        fallback: []
        policy: workflow-auto
${options.installUnits ?? ""}`;
}
