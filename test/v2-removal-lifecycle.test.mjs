import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../bin/skillboard.mjs", import.meta.url));

test("skill forget removes only an absent unshared policy entry and restores doctor health", async () => {
  await withHome(async ({ home, env }) => {
    await installSkill(home, "demo");
    await run(["setup", "--agent", "codex", "--yes"], env);
    await rm(join(home, ".codex", "skills", "demo"), { recursive: true, force: true });
    await run(["inventory", "refresh", "--json"], env);

    const configPath = join(home, "skillboard.config.yaml");
    const before = await readFile(configPath, "utf8");
    const preview = await run(["skill", "forget", "demo", "--dry-run", "--json"], env);
    assert.equal(preview.code, 0, commandFailure(preview));
    assert.equal(JSON.parse(preview.stdout).dryRun, true);
    assert.equal(await readFile(configPath, "utf8"), before);

    const applied = await run(["skill", "forget", "demo", "--json"], env);
    assert.equal(applied.code, 0, commandFailure(applied));
    assert.equal(JSON.parse(applied.stdout).message, "Forgot demo");
    const config = YAML.parse(await readFile(configPath, "utf8"));
    assert.equal(config.skills.demo, undefined);

    const doctor = await run(["doctor", "--json"], env);
    assert.equal(doctor.code, 0, commandFailure(doctor));
    assert.equal(JSON.parse(doctor.stdout).ok, true);

    const installed = await run(["skill", "forget", "skillboard"], env);
    assert.equal(installed.code, 1);
    assert.match(installed.stderr, /still installed/i);
  });
});

test("skill forget refuses shared policy even when inventory no longer observes the skill", async () => {
  await withHome(async ({ home, env }) => {
    await installSkill(home, "demo");
    await run(["setup", "--agent", "codex", "--yes"], env);
    await run(["skill", "share", "demo", "--json"], env);
    await rm(join(home, ".codex", "skills", "demo"), { recursive: true, force: true });
    for (const path of managedDemoPaths(home)) {
      await rm(path, { recursive: true, force: true });
    }
    await run(["inventory", "refresh", "--json"], env);

    const configPath = join(home, "skillboard.config.yaml");
    const before = await readFile(configPath, "utf8");
    const result = await run(["skill", "forget", "demo"], env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /unshare/i);
    assert.equal(await readFile(configPath, "utf8"), before);
  });
});

test("brief offers one current forget action that apply-action previews and applies", async () => {
  await withHome(async ({ home, env }) => {
    await installSkill(home, "demo");
    await run(["setup", "--agent", "codex", "--yes"], env);
    await rm(join(home, ".codex", "skills", "demo"), { recursive: true, force: true });
    await run(["inventory", "refresh", "--json"], env);

    const brief = JSON.parse((await run([
      "brief", "--agent", "codex", "--include-actions", "--json"
    ], env)).stdout);
    const action = brief.actions.find((candidate) => candidate.id === "v2:forget-skill:demo");
    assert.ok(action);
    assert.equal(action.requires_user_confirmation, true);
    assert.match(action.application.apply.display, /--agent codex/);

    const configPath = join(home, "skillboard.config.yaml");
    const before = await readFile(configPath, "utf8");
    const preview = await run([
      "apply-action", action.id, "--agent", "codex", "--dry-run", "--json"
    ], env);
    assert.equal(preview.code, 0, commandFailure(preview));
    assert.equal(JSON.parse(preview.stdout).control.dryRun, true);
    assert.equal(await readFile(configPath, "utf8"), before);

    const applied = await run([
      "apply-action", action.id, "--agent", "codex", "--yes", "--json"
    ], env);
    assert.equal(applied.code, 0, commandFailure(applied));
    assert.equal(JSON.parse(applied.stdout).control.message, "Forgot demo");
    assert.equal(YAML.parse(await readFile(configPath, "utf8")).skills.demo, undefined);
  });
});

test("user uninstall previews then removes every managed artifact while preserving owner and unmanaged skills", async () => {
  await withHome(async ({ home, env }) => {
    await installSkill(home, "demo");
    await run(["setup", "--agent", "codex,claude,opencode,hermes", "--yes"], env);
    await run(["skill", "share", "demo", "--json"], env);
    const unmanaged = join(home, ".hermes", "skills", "manual", "SKILL.md");
    await mkdir(join(home, ".hermes", "skills", "manual"), { recursive: true });
    await cp("examples/skills/tdd/SKILL.md", unmanaged);
    await writeFile(join(home, "keep.txt"), "keep\n", "utf8");

    const preview = await run(["uninstall", "--user", "--dry-run", "--json"], env);
    assert.equal(preview.code, 0, commandFailure(preview));
    const previewValue = JSON.parse(preview.stdout);
    assert.equal(previewValue.dry_run, true);
    assert.equal(previewValue.managed_copies.length, 4);
    await access(join(home, ".agents", "shared-skills", "demo", ".skillboard-share.json"));
    await access(join(home, "skillboard.config.yaml"));

    const unconfirmed = await run(["uninstall", "--user", "--json"], env);
    assert.equal(unconfirmed.code, 1);
    assert.match(unconfirmed.stderr, /requires --yes/i);
    await access(join(home, ".claude", "skills", "demo", ".skillboard-share.json"));

    const unknown = await run(["uninstall", "--user", "--dry-run", "--unknown"], env);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /Unknown option.*--unknown/i);
    await access(join(home, "skillboard.config.yaml"));

    const applied = await run(["uninstall", "--user", "--yes", "--json"], env);
    assert.equal(applied.code, 0, commandFailure(applied));
    const appliedValue = JSON.parse(applied.stdout);
    assert.equal(appliedValue.dry_run, false);
    assert.equal(appliedValue.managed_copies.length, 4);

    await access(join(home, ".codex", "skills", "demo", "SKILL.md"));
    await access(unmanaged);
    assert.equal(await readFile(join(home, "keep.txt"), "utf8"), "keep\n");
    for (const path of managedDemoPaths(home)) {
      await assert.rejects(access(path), /ENOENT/);
    }
    for (const path of guidancePaths(home)) {
      await assert.rejects(access(path), /ENOENT/);
    }
    await assert.rejects(access(join(home, "skillboard.config.yaml")), /ENOENT/);
    await assert.rejects(access(join(home, ".skillboard")), /ENOENT/);
  });
});

test("user uninstall includes registered custom roots and removes their managed copies", async () => {
  await withHome(async ({ home, env }) => {
    const customRoot = join(home, "custom-hermes", "skills");
    const historicalHermesGuidance = join(home, ".hermes", "skills", "skillboard");
    const customEnv = { ...env };
    delete customEnv.HERMES_HOME;
    await installSkill(home, "demo");
    await run(["setup", "--agent", "codex,claude,opencode,hermes", "--yes"], customEnv);
    await access(join(historicalHermesGuidance, "SKILL.md"));
    await run(["setup", "--agent", "hermes", "--skill-root", customRoot, "--yes"], customEnv);
    await run(["skill", "share", "demo", "--json"], customEnv);
    await access(join(customRoot, "demo", ".skillboard-share.json"));
    const malformedMarkerSkill = join(customRoot, "unmanaged");
    await mkdir(malformedMarkerSkill, { recursive: true });
    await writeFile(join(malformedMarkerSkill, "SKILL.md"), "---\nname: unmanaged\ndescription: Preserve invalid marker.\n---\n");
    await writeFile(join(malformedMarkerSkill, ".skillboard-share.json"), "not-json\n");

    const preview = JSON.parse((await run(["uninstall", "--user", "--dry-run", "--json"], customEnv)).stdout);
    assert.ok(preview.managed_copies.some((copy) => copy.path === join(customRoot, "demo")));
    assert.ok(preview.guidance.removed.some((path) => path.includes(customRoot)));

    const applied = await run(["uninstall", "--user", "--yes", "--json"], customEnv);
    assert.equal(applied.code, 0, commandFailure(applied));
    await access(join(home, ".codex", "skills", "demo", "SKILL.md"));
    await assert.rejects(access(join(customRoot, "demo")), /ENOENT/);
    await assert.rejects(access(join(customRoot, "skillboard")), /ENOENT/);
    await assert.rejects(access(historicalHermesGuidance), /ENOENT/);
    await access(join(malformedMarkerSkill, "SKILL.md"));
    await assert.rejects(access(join(home, ".skillboard")), /ENOENT/);
  });
});

test("user uninstall never follows a symlinked agent skill root", async () => {
  const outside = await mkdtemp(join(tmpdir(), "skillboard-user-uninstall-outside-"));
  await withHome(async ({ home, env }) => {
    const target = join(outside, "demo");
    await mkdir(target, { recursive: true });
    await cp("examples/skills/tdd/SKILL.md", join(target, "SKILL.md"));
    await writeFile(join(target, ".skillboard-share.json"), `${JSON.stringify({
      version: 1,
      managed_by: "skillboard",
      mode: "agent-copy",
      skill: "demo",
      source_agent: "codex",
      target_agent: "claude"
    })}\n`, "utf8");
    await mkdir(join(home, ".claude"), { recursive: true });
    await symlink(outside, join(home, ".claude", "skills"), "dir");

    const result = await run(["uninstall", "--user", "--yes", "--json"], env);
    assert.equal(result.code, 0, commandFailure(result));
    assert.match(JSON.stringify(JSON.parse(result.stdout).preserved), /\.claude.*skills/);
    await access(join(target, "SKILL.md"));
  });
  await rm(outside, { recursive: true, force: true });
});

async function withHome(callback) {
  const home = await mkdtemp(join(tmpdir(), "skillboard-v2-removal-"));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_HOME: join(home, ".claude"),
    OPENCODE_HOME: join(home, ".config", "opencode"),
    HERMES_HOME: join(home, ".hermes")
  };
  try {
    await callback({ home, env });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function installSkill(home, id) {
  const target = join(home, ".codex", "skills", id);
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "SKILL.md"),
    `---\nname: ${id}\ndescription: Removal lifecycle fixture.\n---\n# ${id}\n`,
    "utf8"
  );
}

function managedDemoPaths(home) {
  return [
    join(home, ".agents", "shared-skills", "demo"),
    join(home, ".claude", "skills", "demo"),
    join(home, ".config", "opencode", "skills", "demo"),
    join(home, ".hermes", "skills", "demo")
  ];
}

function guidancePaths(home) {
  return [
    join(home, ".codex", "skills", "skillboard", "SKILL.md"),
    join(home, ".claude", "skills", "skillboard", "SKILL.md"),
    join(home, ".config", "opencode", "skills", "skillboard", "SKILL.md"),
    join(home, ".hermes", "skills", "skillboard", "SKILL.md")
  ];
}

async function run(args, env) {
  try {
    const result = await execFileAsync(process.execPath, [CLI, ...args], { env });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

function commandFailure(result) {
  return `exit=${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}
