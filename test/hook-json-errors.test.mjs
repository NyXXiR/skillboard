import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { writeHookFixture } from "./helpers/hook-fixture.mjs";

const execFileAsync = promisify(execFile);

test("hook install dry-run json refuses existing target without modifying it", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hook-existing-dry-run-test-"));
  try {
    const { configPath, skillsRoot } = await writeHookFixture(root, "codex-night-workflow");
    const hookPath = join(root, ".skillboard", "hooks", "guard.sh");
    await mkdir(join(root, ".skillboard", "hooks"), { recursive: true });
    await writeFile(hookPath, "original hook bytes\n", "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "hook",
        "install",
        "--workflow",
        "codex-night-workflow",
        "--config",
        configPath,
        "--skills",
        skillsRoot,
        "--out",
        hookPath,
        "--dry-run",
        "--json"
      ]);
    } catch (caught) {
      error = caught;
    }
    const payload = JSON.parse(error.stdout);

    assert.equal(error.code, 1);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "hook_path_exists");
    assert.match(payload.error.message, /Refusing to overwrite existing hook path/);
    assert.equal(payload.planned.path, hookPath);
    assert.equal(payload.planned.target_exists, true);
    assert.equal(payload.planned.would_be_executable, true);
    assert.equal(await readFile(hookPath, "utf8"), "original hook bytes\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hook install json apply refuses existing target with structured stdout", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hook-existing-apply-json-test-"));
  try {
    const { configPath, skillsRoot } = await writeHookFixture(root, "codex-night-workflow");
    const hookPath = join(root, ".skillboard", "hooks", "guard.sh");
    await mkdir(join(root, ".skillboard", "hooks"), { recursive: true });
    await writeFile(hookPath, "original hook bytes\n", "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "hook",
        "install",
        "--workflow",
        "codex-night-workflow",
        "--config",
        configPath,
        "--skills",
        skillsRoot,
        "--out",
        hookPath,
        "--json"
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error?.code, 1);
    assert.equal(error.stderr, "");
    const payload = JSON.parse(error.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "hook_path_exists");
    assert.match(payload.error.message, /Refusing to overwrite existing hook path/);
    assert.equal(payload.planned.path, hookPath);
    assert.equal(payload.planned.target_exists, true);
    assert.equal(await readFile(hookPath, "utf8"), "original hook bytes\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
