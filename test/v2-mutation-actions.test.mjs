import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import YAML from "yaml";
import { buildSkillBrief } from "../src/advisor.mjs";
import { applyAdvisorAction, ApplyActionError } from "../src/advisor/apply-action.mjs";

const execFileAsync = promisify(execFile);

test("v2 skill commands update enabled, sharing, and sorted preference", async () => {
  await fixture(2, async ({ configPath, skillsRoot, env }) => {
    await cli(["skill", "disable", "demo", "--config", configPath, "--skills", skillsRoot, "--json"], env);
    await cli(["skill", "share", "demo", "--config", configPath, "--json"], env);
    await cli(["skill", "preference", "demo", "--intent", "tests, review,tests", "--priority", "25", "--config", configPath, "--skills", skillsRoot, "--json"], env);
    const config = YAML.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(config.skills.demo, {
      enabled: false,
      shared: true,
      preference: { intents: ["review", "tests"], priority: 25 }
    });
    await cli(["skill", "enable", "demo", "--config", configPath, "--skills", skillsRoot], env);
    await cli(["skill", "unshare", "demo", "--config", configPath], env);
    assert.equal(YAML.parse(await readFile(configPath, "utf8")).skills.demo.shared, false);
  });
});

test("legacy mutation commands refuse v1 with exact migration instruction", async () => {
  await fixture(1, async ({ configPath, skillsRoot }) => {
    const before = await readFile(configPath, "utf8");
    for (const args of [
      ["activate", "demo", "--workflow", "alpha"],
      ["block", "demo", "--workflow", "alpha"],
      ["prefer", "demo", "--workflow", "alpha", "--capability", "tests"],
      ["add", "skill", "new", "--path", "new"]
    ]) {
      await assert.rejects(cli([...args, "--config", configPath, "--skills", skillsRoot]), (error) =>
        error instanceof Error && /** @type {Error & { stderr?: string }} */ (error).stderr === "Version 1 policy is read-only. Run `skillboard migrate v2`.\n");
      assert.equal(await readFile(configPath, "utf8"), before);
    }
  });
});

test("v2 action cards apply current enable and disable actions and return a fresh brief", async () => {
  await fixture(2, async ({ root, configPath, skillsRoot }) => {
    const first = await buildSkillBrief({ root, configPath, skillsRoot, agent: "codex", includeActions: true });
    const disable = first.actions.find((action) => action.id === "v2:disable-skill:demo");
    assert.ok(disable);
    assert.equal(disable.application.blocked_reason, null);
    assert.match(disable.application.apply.display, /apply-action v2:disable-skill:demo/);
    assert.deepEqual(disable.application.apply.argv.slice(-4), ["--json", "--agent", "codex", "--yes"]);
    const applied = await applyAdvisorAction(disable.id, { root, configPath, skillsRoot, agent: "codex", yes: true });
    assert.equal(applied.changed, true);
    assert.deepEqual(applied.brief.skills.blocked.map((skill) => skill.id), ["demo"]);
    assert.ok(applied.brief.actions.some((action) => action.id === "v2:enable-skill:demo"));
    await assert.rejects(
      applyAdvisorAction(disable.id, { root, configPath, skillsRoot, agent: "codex", yes: true }),
      (error) => error instanceof ApplyActionError && error.code === "stale-action"
    );
  });
});

test("v2 action cards apply sharing and matching preference with stale ids", async () => {
  await fixture(2, async ({ root, configPath, skillsRoot, env }) => {
    const first = await buildSkillBrief({ root, configPath, skillsRoot, intent: "write tests", includeActions: true });
    const share = first.actions.find((action) => action.id === "v2:share-skill:demo");
    const prefer = first.actions.find((action) => action.kind === "v2:prefer-skill");
    assert.ok(share);
    assert.ok(prefer);

    const shared = await applyAdvisorAction(share.id, {
      root, configPath, skillsRoot, home: root, env, intent: "write tests", yes: true
    });
    assert.ok(shared.brief.actions.some((action) => action.id === "v2:unshare-skill:demo"));
    await assert.rejects(
      applyAdvisorAction(share.id, { root, configPath, skillsRoot, home: root, env, intent: "write tests", yes: true }),
      (error) => error instanceof ApplyActionError && error.code === "stale-action"
    );

    const currentPreference = shared.brief.actions.find((action) => action.kind === "v2:prefer-skill");
    const preferred = await applyAdvisorAction(currentPreference.id, {
      root, configPath, skillsRoot, intent: "write tests", yes: true
    });
    assert.equal(preferred.brief.actions.some((action) => action.id === currentPreference.id), false);
    await assert.rejects(
      applyAdvisorAction(currentPreference.id, { root, configPath, skillsRoot, intent: "write tests", yes: true }),
      (error) => error instanceof ApplyActionError && error.code === "stale-action"
    );
  });
});

test("v2 apply-action preview validates sharing conflicts before confirmation", async () => {
  await fixture(2, async ({ root, configPath, skillsRoot, env }) => {
    await mkdir(join(root, ".hermes", "skills", "demo"), { recursive: true });
    const brief = await buildSkillBrief({ root, configPath, skillsRoot, agent: "codex", includeActions: true });
    const share = brief.actions.find((action) => action.id === "v2:share-skill:demo");
    assert.ok(share);

    await assert.rejects(
      applyAdvisorAction(share.id, {
        root, configPath, skillsRoot, agent: "codex", home: root, env, dryRun: true
      }),
      /already exists and is not managed by SkillBoard/
    );
    assert.match(await readFile(configPath, "utf8"), /demo:[\s\S]*shared: false/);
  });
});

test("v2 action cards ignore legacy workflow options instead of creating scope", async () => {
  await fixture(2, async ({ root, configPath, skillsRoot }) => {
    const before = await readFile(configPath, "utf8");
    const brief = await buildSkillBrief({
      root, configPath, skillsRoot, workflow: "typo", includeActions: true
    });
    assert.equal(brief.ok, true);
    assert.ok(brief.actions.some((action) => action.id === "v2:disable-skill:demo"));
    await applyAdvisorAction("v2:disable-skill:demo", { root, configPath, skillsRoot, workflow: "typo", yes: true });
    assert.notEqual(await readFile(configPath, "utf8"), before);
  });
});

test("v2 preference action preserves existing intent terms", async () => {
  await fixture(2, async ({ root, configPath, skillsRoot }) => {
    await cli([
      "skill", "preference", "demo", "--intent", "deploy", "--priority", "50",
      "--config", configPath, "--skills", skillsRoot
    ]);
    const brief = await buildSkillBrief({ root, configPath, skillsRoot, intent: "write tests", includeActions: true });
    const action = brief.actions.find((candidate) => candidate.kind === "v2:prefer-skill");
    assert.ok(action);
    assert.deepEqual(action.advanced.intents, ["deploy", "write tests"]);
    await applyAdvisorAction(action.id, {
      root, configPath, skillsRoot, intent: "write tests", yes: true
    });
    assert.deepEqual(YAML.parse(await readFile(configPath, "utf8")).skills.demo.preference, {
      intents: ["deploy", "write tests"], priority: 100
    });
  });
});

test("primary v2 help teaches only the minimal policy vocabulary", async () => {
  const { stdout } = await cli(["skill", "--help"]);
  assert.match(stdout, /skill enable/);
  assert.match(stdout, /skill share/);
  assert.match(stdout, /skill preference/);
  assert.doesNotMatch(stdout, /invocation|exposure|trust|quarantine|activate|block/i);
});

async function cli(args, env = process.env) {
  try {
    return await execFileAsync(process.execPath, ["bin/skillboard.mjs", ...args], { cwd: process.cwd(), env });
  } catch (error) {
    throw Object.assign(error, { stderr: error.stderr });
  }
}

async function fixture(version, run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-crud-"));
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  const env = {
    ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: join(root, ".codex"), CLAUDE_HOME: join(root, ".claude"),
    OPENCODE_HOME: join(root, ".config", "opencode"), HERMES_HOME: join(root, ".hermes")
  };
  await mkdir(skillsRoot);
  if (version === 2) {
    await writeFile(configPath, "version: 2\nskills:\n  demo:\n    enabled: true\n    shared: false\n");
    await mkdir(join(root, ".codex", "skills", "demo"), { recursive: true });
    await writeFile(join(root, ".codex", "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Write tests.\n---\n");
    await mkdir(join(root, ".skillboard"));
    await writeFile(join(root, ".skillboard", "inventory.json"), JSON.stringify({
      format_version: 1, generated: true, authoritative_for_availability: false,
      skills: [{ id: "demo", path: "demo", owner_install_unit: "codex.user-skills", installed_on: ["codex"] }],
      install_units: []
    }));
  } else {
    await writeFile(configPath, "version: 1\nworkflows:\n  alpha:\n    harness: codex\n    active_skills: [demo]\n    blocked_skills: []\nharnesses:\n  codex:\n    status: configured\n    workflows: [alpha]\nskills:\n  demo:\n    path: demo\n    status: active\n    invocation: manual-only\n    exposure: exported\n");
  }
  try { await run({ root, configPath, skillsRoot, env }); } finally { await rm(root, { recursive: true, force: true }); }
}
