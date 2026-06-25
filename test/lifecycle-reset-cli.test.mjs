import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("cli uninstall reset-config discards modified policy and allows fresh init lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-uninstall-reset-test-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await mkdir(join(root, "skills", "local-helper"), { recursive: true });
    await writeFile(
      join(root, "skills", "local-helper", "SKILL.md"),
      "---\nname: local-helper\ndescription: Local lifecycle fixture.\n---\n# Local helper\n",
      "utf8"
    );
    await writeFile(
      join(root, "skillboard.config.yaml"),
      "version: 1\nskills:\n  user.local-helper:\n    path: local-helper\n",
      "utf8"
    );

    const dryRun = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--reset-config", "--dry-run"]);
    assert.match(dryRun.stdout, /Removed: .*`skillboard\.config\.yaml`/);
    assert.match(await readFile(join(root, "skillboard.config.yaml"), "utf8"), /user\.local-helper/);

    const reset = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--reset-config"]);
    assert.match(reset.stdout, /Removed: .*`skillboard\.config\.yaml`/);
    await assert.rejects(readFile(join(root, "skillboard.config.yaml"), "utf8"), /ENOENT/);
    assert.match(await readFile(join(root, "skills", "local-helper", "SKILL.md"), "utf8"), /Local lifecycle fixture/);

    let doctorError;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", root, "--json"]);
    } catch (caught) {
      doctorError = caught;
    }
    const notInitialized = JSON.parse(doctorError.stdout);
    assert.equal(doctorError.code, 1);
    assert.equal(notInitialized.initialized, false);
    assert.equal(notInitialized.mode, "not-initialized");

    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    const doctor = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", root, "--json"]);
    const initialized = JSON.parse(doctor.stdout);
    assert.equal(initialized.initialized, true);
    assert.equal(initialized.workspace.skills.declared, 0);
    assert.equal(initialized.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli uninstall reset-config remove-reports cleans SkillBoard scaffolding while preserving local skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-clean-uninstall-test-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await mkdir(join(root, "skills", "local-helper"), { recursive: true });
    await writeFile(
      join(root, "skills", "local-helper", "SKILL.md"),
      "---\nname: local-helper\ndescription: Local clean uninstall fixture.\n---\n# Local helper\n",
      "utf8"
    );
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "add", "harness", "codex", "--config", join(root, "skillboard.config.yaml"), "--skills", join(root, "skills")]);
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "add",
      "skill",
      "user.local-helper",
      "--path",
      "local-helper",
      "--status",
      "candidate",
      "--invocation",
      "manual-only",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills")
    ]);
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "add",
      "workflow",
      "clean-workflow",
      "--harness",
      "codex",
      "--skill",
      "user.local-helper",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills")
    ]);
    const canUse = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "can-use",
      "user.local-helper",
      "--workflow",
      "clean-workflow",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills"),
      "--json"
    ]);
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "dashboard",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills"),
      "--out",
      join(root, ".skillboard", "reports", "skill-map.md")
    ]);

    const dryRun = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--reset-config", "--remove-reports", "--dry-run"]);
    assert.equal(JSON.parse(canUse.stdout).allowed, true);
    assert.match(dryRun.stdout, /Removed: .*`skillboard\.config\.yaml`/);
    assert.equal(dryRun.stdout.includes("`.skillboard/reports`"), true);
    assert.match(await readFile(join(root, ".skillboard", "reports", "skill-map.md"), "utf8"), /SkillBoard/);

    const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--reset-config", "--remove-reports"]);
    assert.match(result.stdout, /Removed: .*`skillboard\.config\.yaml`/);
    assert.equal(result.stdout.includes("`.skillboard/reports`"), true);
    await assert.rejects(readFile(join(root, "skillboard.config.yaml"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, "AGENTS.md"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, "CLAUDE.md"), "utf8"), /ENOENT/);
    await assert.rejects(readdir(join(root, ".skillboard")), /ENOENT/);
    assert.match(await readFile(join(root, "skills", "local-helper", "SKILL.md"), "utf8"), /Local clean uninstall fixture/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli uninstall remove-hooks can fully reset generated guard hooks without deleting skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-clean-hooks-uninstall-test-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await mkdir(join(root, "skills", "local-helper"), { recursive: true });
    await writeFile(
      join(root, "skills", "local-helper", "SKILL.md"),
      "---\nname: local-helper\ndescription: Local hook cleanup fixture.\n---\n# Local helper\n",
      "utf8"
    );
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "add", "harness", "codex", "--config", join(root, "skillboard.config.yaml"), "--skills", join(root, "skills")]);
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "add",
      "skill",
      "user.local-helper",
      "--path",
      "local-helper",
      "--status",
      "candidate",
      "--invocation",
      "manual-only",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills")
    ]);
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "add",
      "workflow",
      "clean-workflow",
      "--harness",
      "codex",
      "--skill",
      "user.local-helper",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills")
    ]);
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "hook",
      "install",
      "--workflow",
      "clean-workflow",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills"),
      "--out",
      join(root, ".skillboard", "hooks", "clean-workflow-guard.sh"),
      "--skillboard-bin",
      join(process.cwd(), "bin", "skillboard.mjs")
    ]);
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "dashboard",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills"),
      "--out",
      join(root, ".skillboard", "reports", "skill-map.md")
    ]);

    const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--reset-config", "--remove-reports", "--remove-hooks"]);
    assert.match(result.stdout, /Removed: .*`\.skillboard\/hooks`/);
    await assert.rejects(readdir(join(root, ".skillboard")), /ENOENT/);
    assert.match(await readFile(join(root, "skills", "local-helper", "SKILL.md"), "utf8"), /Local hook cleanup fixture/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
