import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const V1_READ_ONLY_ERROR = "Version 1 policy is read-only. Run `skillboard migrate v2`.";

async function assertV1HookInstallRefused(args, configPath) {
  const before = await readFile(configPath);
  let error;
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "hook", "install", ...args]);
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.code, 1);
  assert.equal(error?.stderr, `${V1_READ_ONLY_ERROR}\n`);
  assert.deepEqual(await readFile(configPath), before);
}

async function execHookScript(path, args, options = {}) {
  if (process.platform === "win32") {
    return await execFileAsync("bash", [path, ...args], options);
  }
  return await execFileAsync(path, args, options);
}

function isPosixExecutableBitSupported() {
  return process.platform !== "win32";
}

test("cli hook install refuses v1 policy without writing a guard script", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hook-test-"));
  try {
    const hookPath = join(root, "codex-night-guard.sh");
    await assertV1HookInstallRefused([
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
    ], join(process.cwd(), "examples", "multi-source.config.yaml"));
    await assert.rejects(stat(hookPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli hook install refuses v1 before path handling and preserves config bytes", async () => {
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
    await assertV1HookInstallRefused([
      "--workflow",
      "../bad workflow",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--skillboard-bin",
      join(process.cwd(), "bin", "skillboard.mjs")
    ], configPath);

    assert.equal(error.code, 1);
    assert.match(error.stderr, /Refusing to overwrite existing hook path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
