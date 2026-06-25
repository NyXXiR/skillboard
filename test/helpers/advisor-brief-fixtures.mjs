import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "../../src/index.mjs";

export async function withBriefFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await initProject({ root, scanInstalled: false });
    await writeSkill(join(skillsRoot, "local-helper"), "local-helper");
    await writeFile(configPath, briefConfig(), "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function withSourceReviewFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-review-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await initProject({ root, scanInstalled: false });
    await writeSkill(join(skillsRoot, "vendor-auto"), "vendor-auto");
    await writeFile(configPath, sourceReviewConfig(), "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function withReviewQueueOrderingFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-review-order-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await initProject({ root, scanInstalled: false });
    await writeSkill(join(skillsRoot, "acme-helper"), "acme-helper");
    await writeSkill(join(skillsRoot, "matt-tdd"), "matt-tdd");
    await writeFile(configPath, reviewQueueOrderingConfig(), "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeSkill(root, name) {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "SKILL.md"),
    `---
name: ${name}
description: Test skill ${name}.
---

# ${name}
`,
    "utf8"
  );
}

function briefConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  user.local-helper:
    path: local-helper
    status: active
    invocation: manual-only
    exposure: exported
    category: user
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - user.local-helper
    blocked_skills: []
install_units: {}
`;
}

function sourceReviewConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  vendor.auto:
    path: vendor-auto
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
    owner_install_unit: acme.pack
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - vendor.auto
    blocked_skills: []
install_units:
  acme.pack:
    kind: plugin
    source: npx acme install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: high
    provided_components:
      - skills
      - commands
    components:
      skills:
        - vendor.auto
      commands:
        - $acme
	`;
}

function reviewQueueOrderingConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  acme.helper:
    path: acme-helper
    status: active
    invocation: manual-only
    exposure: unit-managed
    category: plugin
    owner_install_unit: acme.pack
  matt.tdd:
    path: matt-tdd
    status: active
    invocation: manual-only
    exposure: unit-managed
    category: plugin
    owner_install_unit: matt.pack
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - acme.helper
      - matt.tdd
    blocked_skills: []
install_units:
  acme.pack:
    kind: plugin
    source: npx acme install
    scope: user-global
    enabled: true
    trust_level: reviewed
    permission_risk: medium
    provided_components:
      - skills
    components:
      skills:
        - acme.helper
  matt.pack:
    kind: plugin
    source: npx matt install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: medium
    provided_components:
      - skills
    components:
      skills:
        - matt.tdd
`;
}
