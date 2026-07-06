import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "../../src/index.mjs";

export async function withGroupsFixture(run) {
  return await withFixture("skillboard-brief-groups-test-", groupsConfig(), async (paths) => {
    await writeFixtureSkills(paths.skillsRoot, [
      "local-manual",
      "matt-tdd",
      "omo-runtime",
      "omo-detached",
      "detached-helper",
      "blocked-helper",
      "installed-only"
    ]);
    return await run(paths);
  });
}

export async function withMultiWorkflowGroupsFixture(run) {
  return await withFixture("skillboard-brief-multi-groups-test-", multiWorkflowConfig(), async (paths) => {
    await writeFixtureSkills(paths.skillsRoot, ["local-manual", "matt-tdd", "installed-only"]);
    return await run(paths);
  });
}

async function withFixture(prefix, config, run) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await initProject({ root, scanInstalled: false });
    await writeFile(configPath, config, "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeFixtureSkills(skillsRoot, names) {
  for (const name of names) {
    await mkdir(join(skillsRoot, name), { recursive: true });
    await writeFile(
      join(skillsRoot, name, "SKILL.md"),
      `---
name: ${skillName(name)}
description: Test skill ${skillName(name)}.
---

# ${skillName(name)}
`,
      "utf8"
    );
  }
}

function skillName(name) {
  return name.split("-").join(".");
}

function groupsConfig() {
  return `${baseConfig()}
skills:
  user.local-manual:
    path: local-manual
    status: active
    invocation: manual-only
    exposure: exported
    category: user
  matt.tdd:
    path: matt-tdd
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
    owner_install_unit: matt.pack
  omo.runtime:
    path: omo-runtime
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
    owner_install_unit: omo.pack
  omo.detached:
    path: omo-detached
    status: active
    invocation: manual-only
    exposure: unit-managed
    category: plugin
    owner_install_unit: omo.pack
  user.detached:
    path: detached-helper
    status: active
    invocation: manual-only
    exposure: exported
    category: user
  user.blocked:
    path: blocked-helper
    status: blocked
    invocation: blocked
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
      - user.local-manual
      - matt.tdd
      - omo.runtime
    blocked_skills: []
install_units:
${installUnits()}
`;
}

function multiWorkflowConfig() {
  return `${baseConfig()}
skills:
  user.local-manual:
    path: local-manual
    status: active
    invocation: manual-only
    exposure: exported
    category: user
  matt.tdd:
    path: matt-tdd
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
    owner_install_unit: matt.pack
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
      - research-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - user.local-manual
    blocked_skills: []
  research-workflow:
    harness: codex
    active_skills:
      - matt.tdd
    blocked_skills: []
install_units:
  matt.pack:
    kind: plugin
    source: npx matt install
    scope: user-global
    enabled: true
    trust_level: reviewed
    permission_risk: medium
    source_digest: sha256:matt
    provided_components:
      - skills
    components:
      skills:
        - matt.tdd
`;
}

function baseConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
`;
}

function installUnits() {
  return `  matt.pack:
    kind: plugin
    source: npx matt install
    scope: user-global
    enabled: true
    trust_level: reviewed
    permission_risk: medium
    source_digest: sha256:matt
    provided_components:
      - skills
    components:
      skills:
        - matt.tdd
  omo.pack:
    kind: plugin
    source: npx omo install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: high
    provided_components:
      - skills
    components:
      skills:
        - omo.runtime
        - omo.detached`;
}
