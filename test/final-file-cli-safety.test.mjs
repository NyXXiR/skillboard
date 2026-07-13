import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), "bin", "skillboard.mjs");

test("concurrent v2 disable and preference preserve both updates and config mode", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    await chmod(configPath, 0o600);

    await Promise.all([
      runCli(["skill", "disable", "demo", "--config", configPath, "--skills", skillsRoot]),
      runCli(["skill", "preference", "demo", "--intent", "release", "--priority", "10", "--config", configPath, "--skills", skillsRoot])
    ]);

    const config = YAML.parse(await readFile(configPath, "utf8"));
    assert.equal(config.skills.demo.enabled, false);
    assert.deepEqual(config.skills.demo.preference, { intents: ["release"], priority: 10 });
    if (process.platform !== "win32") assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    await assert.rejects(lstat(`${configPath}.migrate.lock`), { code: "ENOENT" });
  });
});

test("legacy hook install fails closed without writing through a project symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hook-parent-link-"));
  const outside = await mkdtemp(join(tmpdir(), "skillboard-hook-outside-"));
  try {
    const fixture = await createFixture(root);
    await writeFile(fixture.configPath, `version: 1
workflows:
  release:
    harness: codex
    active_skills: [demo]
harnesses:
  codex:
    status: configured
    workflows: [release]
skills:
  demo:
    path: demo
    status: active
    invocation: manual-only
    exposure: exported
`);
    await rm(join(root, ".skillboard"), { recursive: true, force: true });
    await symlink(outside, join(root, ".skillboard"));

    await assert.rejects(
      runCli(["hook", "install", "--workflow", "release", "--config", fixture.configPath, "--skills", fixture.skillsRoot]),
      (error) => /read-only|symbolic link|symlink|outside/i.test(errorText(error))
    );
    await assert.rejects(lstat(join(outside, "hooks")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("legacy positional guard grammar without a projection marker fails stale", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    await assert.rejects(
      runCli(["guard", "demo", "--workflow", "release", "--config", configPath, "--skills", skillsRoot]),
      (error) => /pre-v2 policy projection is stale/i.test(errorText(error))
    );
  });
});

test("missing option values and unknown options fail at the command boundary", async () => {
  await assert.rejects(
    runCli(["explain", "demo", "--config"]),
    (error) => /Missing value for explain option: --config/.test(errorText(error))
  );
  await assert.rejects(
    runCli(["hook", "install", "--workflow"]),
    (error) => /Missing value for hook option: --workflow/.test(errorText(error))
  );
  await assert.rejects(
    runCli(["explain", "demo", "--banana", "value"]),
    (error) => /Unknown explain option: --banana/.test(errorText(error))
  );
  await assert.rejects(
    runCli(["guard", "use", "demo", "--banana", "value"]),
    (error) => /Unknown guard option: --banana/.test(errorText(error))
  );
});

test("plain v2 explain renders policy and observations without fabricated trust", async () => {
  await withFixture(async ({ configPath, skillsRoot }) => {
    const result = await runCli(["explain", "demo", "--config", configPath, "--skills", skillsRoot]);
    assert.match(result.stdout, /Skill: demo/);
    assert.match(result.stdout, /Enabled: true/);
    assert.match(result.stdout, /Shared: false/);
    assert.match(result.stdout, /Installed on: codex/);
    assert.match(result.stdout, /Inventory path: demo\/path/);
    assert.doesNotMatch(result.stdout, /Trust observation:|Invocation:|Status:|TypeError|undefined/);
  });
});

test("v2 import restores config and inventory snapshots after an injected second-write failure", async () => {
  await withFixture(async ({ root, configPath, skillsRoot }) => {
    const sourceRoot = join(root, "source");
    const profilePath = join(root, "profile.yaml");
    const skillDir = join(sourceRoot, "skills", "new");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: new\ndescription: New skill.\n---\n");
    await writeFile(profilePath, "id: external.test\nkind: skill\nnamespace: imported\ntarget_path_prefix: imported\nscope: project\ndefault_status: active\ndefault_invocation: manual-only\ndefault_exposure: exported\ndefault_category: imported\ntrust_level: unreviewed\nprovided_components: [skills]\nskill_paths: [skills/*/SKILL.md]\n");
    const inventoryPath = join(root, ".skillboard", "inventory.json");
    await chmod(inventoryPath, 0o640);
    const configBefore = await readFile(configPath);
    const inventoryBefore = await readFile(inventoryPath);

    await assert.rejects(
      runCli([
        "import", "--profile", profilePath, "--source-root", sourceRoot, "--config", configPath, "--skills", skillsRoot, "--merge"
      ], { env: { ...process.env, SKILLBOARD_IMPORT_FAILPOINT: "after-inventory-write" } }),
      (error) => /Injected import failure/.test(errorText(error))
    );

    assert.deepEqual(await readFile(configPath), configBefore);
    assert.deepEqual(await readFile(inventoryPath), inventoryBefore);
    if (process.platform !== "win32") {
      assert.equal((await stat(configPath)).mode & 0o777, 0o600);
      assert.equal((await stat(inventoryPath)).mode & 0o777, 0o640);
    }
    await assert.rejects(lstat(`${configPath}.migrate.lock`), { code: "ENOENT" });
  });
});

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-file-cli-safety-"));
  try {
    await run(await createFixture(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createFixture(root) {
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  await mkdir(skillsRoot, { recursive: true });
  await writeFile(configPath, "version: 2\nskills:\n  demo:\n    enabled: true\n    shared: false\n", { mode: 0o600 });
  const inventoryDir = join(root, ".skillboard");
  await mkdir(inventoryDir);
  await writeFile(join(inventoryDir, "inventory.json"), `${JSON.stringify({
    format_version: 1,
    generated: true,
    authoritative_for_availability: false,
    skills: [{ id: "demo", path: "demo/path", owner_install_unit: "fixture", installed_on: ["codex"], trust_observation: null }],
    install_units: []
  }, null, 2)}\n`);
  return { root, configPath, skillsRoot };
}

async function runCli(args, options = {}) {
  return await execFileAsync(process.execPath, [cli, ...args], { cwd: process.cwd(), ...options });
}

function errorText(error) {
  if (!(error instanceof Error)) return String(error);
  return `${/** @type {Error & { stderr?: string }} */ (error).stderr ?? ""}${error.message}`;
}
