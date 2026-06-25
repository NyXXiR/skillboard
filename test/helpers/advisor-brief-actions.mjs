import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillBrief, initProject } from "../../src/index.mjs";

export async function withActionsFixture(run) {
  return await withFixture("skillboard-brief-actions-test-", actionsConfig(), async (paths) => {
    await writeFixtureSkills(paths.skillsRoot, ["local-manual", "matt-tdd", "omo-runtime", "blocked-helper"]);
    return await run(paths);
  });
}

export async function withMissingProvenanceFixture(run) {
  return await withFixture("skillboard-brief-missing-provenance-test-", missingProvenanceConfig(), async (paths) => {
    await writeFixtureSkills(paths.skillsRoot, ["broken-auto"]);
    return await run(paths);
  });
}

export async function parsedBrief(paths, options = {}) {
  const brief = await buildSkillBrief({
    root: paths.root,
    configPath: paths.configPath,
    skillsRoot: paths.skillsRoot,
    includeActions: true,
    ...options
  });
  return JSON.parse(JSON.stringify(brief));
}

export function actionByKindAndTarget(brief, kind, targetId) {
  return brief.actions.find((action) => {
    return action.kind === kind && action.applies_to?.id === targetId;
  });
}

export function actionsByKind(brief, kind) {
  return brief.actions.filter((action) => action.kind === kind);
}

export function assertCommandObject(value) {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.ok(Array.isArray(value.argv));
  assert.ok(value.argv.every((part) => typeof part === "string"));
  assert.equal(typeof value.display, "string");
  assert.notEqual(value.display.length, 0);
}

export function assertNoBareCommandStrings(actions) {
  for (const action of actions) {
    assert.notEqual(typeof action.dry_run, "string");
    assert.notEqual(typeof action.apply, "string");
    if (action.dry_run !== null) {
      assertCommandObject(action.dry_run);
    }
    if (action.apply !== null) {
      assertCommandObject(action.apply);
    }
  }
}

export async function pathExists(path) {
  return await access(path).then(
    () => true,
    () => false
  );
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
name: ${name.replaceAll("-", ".")}
description: Test skill ${name}.
---

# ${name}
`,
      "utf8"
    );
  }
}

function actionsConfig() {
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
      - agent
      - research
workflows:
  agent:
    harness: codex
    active_skills:
      - user.local-manual
      - omo.runtime
    blocked_skills: []
  research:
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
`;
}

function missingProvenanceConfig() {
  return `${baseConfig()}
skills:
  broken.auto:
    path: broken-auto
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - agent
      - research
workflows:
  agent:
    harness: codex
    active_skills: []
    blocked_skills: []
  research:
    harness: codex
    active_skills:
      - broken.auto
    blocked_skills: []
install_units: {}
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
