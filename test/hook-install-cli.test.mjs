import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function execHookScript(path, args, options = {}) {
  if (process.platform === "win32") {
    return await execFileAsync("bash", [path, ...args], options);
  }
  return await execFileAsync(path, args, options);
}

function isPosixExecutableBitSupported() {
  return process.platform !== "win32";
}

test("cli hook install emits an executable guard script", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hook-test-"));
  try {
    const hookPath = join(root, "codex-night-guard.sh");
    const install = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "hook",
      "install",
      "--workflow",
      "codex-night-workflow",
      "--config",
      "examples/multi-source.config.yaml",
      "--skills",
      "examples/multi-source-skills",
      "--out",
      hookPath,
      "--skillboard-bin",
      join(process.cwd(), "bin", "skillboard.mjs")
    ]);
    const script = await readFile(hookPath, "utf8");
    const mode = (await stat(hookPath)).mode;
    const guard = await execHookScript(hookPath, ["private.tdd-work-continuity"]);

    assert.match(install.stdout, /Installed guard hook/);
    assert.match(script, /guard use/);
    if (isPosixExecutableBitSupported()) {
      assert.equal((mode & 0o111) !== 0, true);
    }
    assert.equal(guard.stdout, "allow\n");
    const guardWithEnvOverrideAttempt = await execHookScript(hookPath, ["private.tdd-work-continuity"], {
      env: {
        ...process.env,
        SKILLBOARD_BIN: process.platform === "win32" ? "cmd /c exit 0" : "/bin/true",
        SKILLBOARD_CONFIG: join(root, "fake-config.yaml"),
        SKILLBOARD_SKILLS: join(root, "fake-skills"),
        SKILLBOARD_WORKFLOW: "fake-workflow"
      }
    });
    assert.equal(guardWithEnvOverrideAttempt.stdout, "allow\n");

    const commandHook = join(root, "codex-night-guard-node.sh");
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "hook",
      "install",
      "--workflow",
      "codex-night-workflow",
      "--config",
      "examples/multi-source.config.yaml",
      "--skills",
      "examples/multi-source-skills",
      "--out",
      commandHook,
      "--skillboard-bin",
      `${process.execPath} ${join(process.cwd(), "bin", "skillboard.mjs")}`
    ]);
    const commandGuard = await execHookScript(commandHook, ["matt.tdd"]);

    assert.equal(commandGuard.stdout, "allow\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli hook install rejects existing paths and sanitizes default workflow filenames", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hook-safety-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const linkPath = join(root, "guard.sh");
    await writeFile(configPath, `version: 1
skills: {}
workflows:
  "../bad workflow":
    harness: codex
    active_skills: []
    blocked_skills: []
harnesses:
  codex:
    status: primary
    workflows:
      - "../bad workflow"
`, "utf8");
    await symlink(join(root, "target.sh"), linkPath);

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "hook",
        "install",
        "--workflow",
        "../bad workflow",
        "--config",
        configPath,
        "--skills",
        join(root, "skills"),
        "--out",
        linkPath
      ]);
    } catch (caught) {
      error = caught;
    }
    const installed = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "hook",
      "install",
      "--workflow",
      "../bad workflow",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--skillboard-bin",
      join(process.cwd(), "bin", "skillboard.mjs")
    ]);

    assert.equal(error.code, 1);
    assert.match(error.stderr, /Refusing to overwrite existing hook path/);
    assert.match(installed.stdout, /\.skillboard[\\/]hooks[\\/]skillboard-guard-bad-workflow\.sh/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
