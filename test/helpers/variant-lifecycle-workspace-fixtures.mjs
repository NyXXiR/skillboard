import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BASE_DIGEST = `sha256:${"a".repeat(64)}`;
export const APPROVED_DIGEST = `sha256:${"b".repeat(64)}`;

export async function withVariantWorkspace(configText, run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-lifecycle-workspace-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "base", "review"), { recursive: true });
    await mkdir(join(skillsRoot, "codex", "review"), { recursive: true });
    await writeFile(
      join(skillsRoot, "base", "review", "SKILL.md"),
      "---\nname: base-review\ndescription: Base review skill.\n---\n# Base Review\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "codex", "review", "SKILL.md"),
      "---\nname: codex-review\ndescription: Codex review skill.\n---\n# Codex Review\n",
      "utf8"
    );
    await writeFile(configPath, configText, "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function declaredBriefEntries(brief) {
  return Object.entries(brief.skills)
    .filter(([group]) => group !== "installed_only")
    .flatMap(([, entries]) => entries);
}

export function variantConfig(options = {}) {
  const skillStatus = options.skillStatus ?? "candidate";
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
skills:
  base.review:
    path: base/review
    status: active
    invocation: manual-only
    exposure: exported
    category: core
  codex.review:
    path: codex/review
    status: ${skillStatus}
    invocation: manual-only
    exposure: exported
    category: core
    variant:
      of: base.review
      adapted_for: Codex night workflow
      capability: task-review
      workflow: codex-workflow
      status: approved
      base:
        content_digest: ${BASE_DIGEST}
        snapshot: .skillboard/variant-snapshots/codex.review/base.md
      approved:
        content_digest: ${APPROVED_DIGEST}
        snapshot: .skillboard/variant-snapshots/codex.review/approved.md
capabilities:
  task-review:
    canonical: base.review
    alternatives:
      - codex.review
    default_policy: manual-only
harnesses:
  codex:
    status: primary
    workflows:
      - codex-workflow
workflows:
  codex-workflow:
    harness: codex
    active_skills:
      - base.review
    blocked_skills: []
    required_capabilities:
      task-review:
        preferred: base.review
        fallback: []
        policy: manual-only
`;
}

export function invalidVariantConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
skills:
  base.review:
    path: base/review
    status: active
    invocation: manual-only
    exposure: exported
  bad.status:
    path: bad/status
    status: candidate
    invocation: manual-only
    exposure: exported
    variant:
      of: base.review
      capability: task-review
      workflow: codex-workflow
      status: ready
      base:
        content_digest: ${BASE_DIGEST}
        snapshot: .skillboard/variant-snapshots/bad.status/base.md
  bad.digest:
    path: bad/digest
    status: candidate
    invocation: manual-only
    exposure: exported
    variant:
      of: base.review
      capability: task-review
      workflow: codex-workflow
      status: draft
      base:
        content_digest: sha256:not-a-hex-digest
        snapshot: .skillboard/variant-snapshots/bad.digest/base.md
  bad.snapshot:
    path: bad/snapshot
    status: candidate
    invocation: manual-only
    exposure: exported
    variant:
      of: base.review
      capability: task-review
      workflow: codex-workflow
      status: draft
      base:
        content_digest: ${BASE_DIGEST}
        snapshot: .skillboard/variant-snapshots/../escape.md
  bad.of:
    path: bad/of
    status: candidate
    invocation: manual-only
    exposure: exported
    variant:
      of: missing.base
      capability: task-review
      workflow: codex-workflow
      status: draft
      base:
        content_digest: ${BASE_DIGEST}
        snapshot: .skillboard/variant-snapshots/bad.of/base.md
  bad.capability:
    path: bad/capability
    status: candidate
    invocation: manual-only
    exposure: exported
    variant:
      of: base.review
      capability: missing-capability
      workflow: codex-workflow
      status: draft
      base:
        content_digest: ${BASE_DIGEST}
        snapshot: .skillboard/variant-snapshots/bad.capability/base.md
  bad.workflow:
    path: bad/workflow
    status: candidate
    invocation: manual-only
    exposure: exported
    variant:
      of: base.review
      capability: task-review
      workflow: missing-workflow
      status: draft
      base:
        content_digest: ${BASE_DIGEST}
        snapshot: .skillboard/variant-snapshots/bad.workflow/base.md
capabilities:
  task-review:
    canonical: base.review
    alternatives: []
    default_policy: manual-only
harnesses:
  codex:
    status: primary
    workflows:
      - codex-workflow
workflows:
  codex-workflow:
    harness: codex
    active_skills:
      - base.review
    blocked_skills: []
    required_capabilities:
      task-review:
        preferred: base.review
        fallback: []
        policy: manual-only
`;
}
