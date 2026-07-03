import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { writeHookFixture } from "./helpers/hook-fixture.mjs";

const execFileAsync = promisify(execFile);

test("hook install dry-run json plans default hook without writing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hook-dry-run-test-"));
  try {
    const { configPath, skillsRoot } = await writeHookFixture(root, "codex-night-workflow");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "hook",
      "install",
      "--workflow",
      "codex-night-workflow",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--dry-run",
      "--json",
      "--skillboard-bin",
      join(process.cwd(), "bin", "skillboard.mjs")
    ]);
    const payload = JSON.parse(result.stdout);
    const plannedPath = join(root, ".skillboard", "hooks", "skillboard-guard-codex-night-workflow.sh");

    assert.equal(payload.ok, true);
    assert.equal(payload.planned.path, plannedPath);
    assert.equal(payload.planned.workflow, "codex-night-workflow");
    assert.equal(payload.planned.command, join(process.cwd(), "bin", "skillboard.mjs"));
    assert.equal(payload.planned.target_exists, false);
    assert.equal(payload.planned.planned_mode, "0755");
    assert.equal(payload.planned.permissions, "rwxr-xr-x");
    assert.equal(payload.planned.would_be_executable, true);
    assert.match(payload.planned.preview.display, /codex-night-workflow/);
    assert.match(payload.planned.preview.shell, /chmod 0755/);
    assert.doesNotMatch(payload.planned.preview.shell, /SKILLBOARD_BIN=\$\{SKILLBOARD_BIN:-/);
    assert.doesNotMatch(payload.planned.preview.shell, /SKILLBOARD_CONFIG=\$\{SKILLBOARD_CONFIG:-/);
    assert.doesNotMatch(payload.planned.preview.shell, /SKILLBOARD_SKILLS=\$\{SKILLBOARD_SKILLS:-/);
    assert.doesNotMatch(payload.planned.preview.shell, /SKILLBOARD_WORKFLOW=\$\{SKILLBOARD_WORKFLOW:-/);
    await assert.rejects(readdir(join(root, ".skillboard", "hooks")), /ENOENT/);
    await assert.rejects(readFile(plannedPath, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hook install dry-run json preview resists heredoc delimiter injection from skillboard bin", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hook-heredoc-injection-test-"));
  try {
    const { configPath, skillsRoot } = await writeHookFixture(root, "codex-night-workflow");
    const injectedBin = [
      join(process.cwd(), "bin", "skillboard.mjs"),
      "SKILLBOARD_GUARD_HOOK",
      "echo PWNED >&2"
    ].join("\n");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "hook",
      "install",
      "--workflow",
      "codex-night-workflow",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--dry-run",
      "--json",
      "--skillboard-bin",
      injectedBin
    ]);
    const payload = JSON.parse(result.stdout);
    const shellLines = payload.planned.preview.shell.split("\n");
    const heredocLine = shellLines.find((line) => line.startsWith("cat > ") && line.includes("<<'"));
    const delimiter = heredocLine?.match(/<<'([^']+)'$/)?.[1];

    assert.equal(payload.ok, true);
    assert.ok(delimiter, "preview should use a quoted heredoc delimiter");
    assert.equal(shellLines.filter((line) => line === delimiter).length, 1);
    assert.equal(shellLines.includes("SKILLBOARD_GUARD_HOOK"), true);
    assert.ok(shellLines.some((line) => line.includes("echo PWNED >&2")));
    assert.ok(shellLines.findIndex((line) => line.includes("echo PWNED >&2")) < shellLines.lastIndexOf(delimiter));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hook install dry-run json sanitizes unsafe workflow filename without writing hooks", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hook-unsafe-workflow-dry-run-test-"));
  try {
    const { configPath, skillsRoot } = await writeHookFixture(root, "../bad workflow");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "hook",
      "install",
      "--workflow",
      "../bad workflow",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--dry-run",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.ok, true);
    assert.equal(basename(payload.planned.path), "skillboard-guard-bad-workflow.sh");
    assert.equal(payload.planned.target_exists, false);
    await assert.rejects(readdir(join(root, ".skillboard", "hooks")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hook install dry-run json refuses existing symlink path without mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hook-symlink-dry-run-test-"));
  try {
    const { configPath, skillsRoot } = await writeHookFixture(root, "../bad workflow");
    const linkPath = join(root, "guard.sh");
    const linkTarget = join(root, "target.sh");
    await symlink(linkTarget, linkPath);

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
        skillsRoot,
        "--out",
        linkPath,
        "--dry-run",
        "--json"
      ]);
    } catch (caught) {
      error = caught;
    }
    const payload = JSON.parse(error.stdout);
    const linkStats = await lstat(linkPath);

    assert.equal(error.code, 1);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "hook_path_exists");
    assert.equal(payload.planned.path, linkPath);
    assert.equal(payload.planned.target_exists, true);
    assert.equal(payload.planned.target_type, "symlink");
    assert.equal(linkStats.isSymbolicLink(), true);
    assert.equal(await readlink(linkPath), linkTarget);
    await assert.rejects(readFile(linkTarget, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
