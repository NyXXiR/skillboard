import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillBrief, initProject } from "../../src/index.mjs";
import {
  actionsConfig,
  missingProvenanceConfig,
  reviewedBlockedConfig,
  reviewedQuarantinedConfig
} from "./advisor-brief-action-fixtures.mjs";

export async function withActionsFixture(run) {
  return await withFixture("skillboard-brief-actions-test-", actionsConfig(), async (paths) => {
    await writeFixtureSkills(paths.skillsRoot, [
      "local-manual",
      "matt-tdd",
      "omo-runtime",
      "safe-helper",
      "medium-helper",
      "runtime-helper",
      "blocked-helper"
    ]);
    return await run(paths);
  });
}

export async function withMissingProvenanceFixture(run) {
  return await withFixture("skillboard-brief-missing-provenance-test-", missingProvenanceConfig(), async (paths) => {
    await writeFixtureSkills(paths.skillsRoot, ["broken-auto"]);
    return await run(paths);
  });
}

export async function withReviewedQuarantinedFixture(run) {
  return await withFixture("skillboard-brief-reviewed-quarantined-test-", reviewedQuarantinedConfig(), async (paths) => {
    await writeFixtureSkills(paths.skillsRoot, ["omo-programming"]);
    return await run(paths);
  });
}

export async function withReviewedBlockedFixture(run) {
  return await withFixture("skillboard-brief-reviewed-blocked-test-", reviewedBlockedConfig(), async (paths) => {
    await writeFixtureSkills(paths.skillsRoot, ["omo-blocked"]);
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

export function assertApplicationCommandObject(value, actionId) {
  assertCommandObject(value);
  assert.deepEqual(value.argv.slice(0, 3), ["skillboard", "apply-action", actionId]);
  assert.ok(value.argv.includes("--config"));
  assert.ok(value.argv.includes("--skills"));
  assert.ok(value.argv.includes("--json"));
  assert.match(value.display, /skillboard apply-action/);
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
name: ${name.split("-").join(".")}
description: Test skill ${name}.
---

# ${name}
`,
      "utf8"
    );
  }
}
