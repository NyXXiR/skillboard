// allow: SIZE_OK - lifecycle reset CLI test split is deferred from the 0.2.7 release gate.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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
    assert.equal(dryRun.stdout.includes("`.skillboard`"), true);
    assert.match(await readFile(join(root, ".skillboard", "reports", "skill-map.md"), "utf8"), /SkillBoard/);

    const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--reset-config", "--remove-reports"]);
    assert.match(result.stdout, /Removed: .*`skillboard\.config\.yaml`/);
    assert.equal(result.stdout.includes("`.skillboard`"), true);
    await assert.rejects(readFile(join(root, "skillboard.config.yaml"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, "AGENTS.md"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, "CLAUDE.md"), "utf8"), /ENOENT/);
    await assert.rejects(readdir(join(root, ".skillboard")), /ENOENT/);
    assert.match(await readFile(join(root, "skills", "local-helper", "SKILL.md"), "utf8"), /Local clean uninstall fixture/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli uninstall purge removes SkillBoard policy footprint while preserving local skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-purge-uninstall-test-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await mkdir(join(root, "skills", "local-helper"), { recursive: true });
    await writeFile(
      join(root, "skills", "local-helper", "SKILL.md"),
      "---\nname: local-helper\ndescription: Local purge uninstall fixture.\n---\n# Local helper\n",
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
      "purge-workflow",
      "--harness",
      "codex",
      "--skill",
      "user.local-helper",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills")
    ]);
    await writeFile(join(root, "skillboard.config.yaml"), `${await readFile(join(root, "skillboard.config.yaml"), "utf8")}# remembered policy choice\n`, "utf8");
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "hook",
      "install",
      "--workflow",
      "purge-workflow",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills"),
      "--out",
      join(root, ".skillboard", "hooks", "purge-workflow-guard.sh"),
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
    await mkdir(join(root, ".skillboard", "sources", "example-source"), { recursive: true });
    await writeFile(join(root, ".skillboard", "sources", "example-source", "source-cache.txt"), "source cache\n", "utf8");
    await mkdir(join(root, ".skillboard", "rollouts", "txn-1"), { recursive: true });
    await writeFile(join(root, ".skillboard", "rollouts", "txn-1", "plan.json"), "{}\n", "utf8");
    await mkdir(join(root, ".skillboard", "variant-snapshots"), { recursive: true });
    await writeFile(join(root, ".skillboard", "variant-snapshots", "snapshot.md"), "snapshot\n", "utf8");
    await writeFile(join(root, ".skillboard", "profiles", "custom.yaml"), "id: custom\n", "utf8");

    const dryRun = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--purge", "--dry-run"]);
    assert.match(dryRun.stdout, /Removed: .*`skillboard\.config\.yaml`/);
    assert.equal(dryRun.stdout.includes("`.skillboard`"), true);
    assert.match(await readFile(join(root, "skillboard.config.yaml"), "utf8"), /remembered policy choice/);
    assert.match(await readFile(join(root, ".skillboard", "sources", "example-source", "source-cache.txt"), "utf8"), /source cache/);
    assert.match(await readFile(join(root, ".skillboard", "profiles", "custom.yaml"), "utf8"), /custom/);
    assert.match(await readFile(join(root, "skills", "local-helper", "SKILL.md"), "utf8"), /Local purge uninstall fixture/);

    const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--purge"]);
    assert.match(result.stdout, /Removed: .*`skillboard\.config\.yaml`/);
    assert.equal(result.stdout.includes("`.skillboard`"), true);
    await assert.rejects(readFile(join(root, "skillboard.config.yaml"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, "AGENTS.md"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, "CLAUDE.md"), "utf8"), /ENOENT/);
    await assert.rejects(readdir(join(root, ".skillboard")), /ENOENT/);
    assert.match(await readFile(join(root, "skills", "local-helper", "SKILL.md"), "utf8"), /Local purge uninstall fixture/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli uninstall purge removes a .skillboard symlink without deleting its target", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-purge-symlink-test-"));
  const target = await mkdtemp(join(tmpdir(), "skillboard-purge-symlink-target-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await rm(join(root, ".skillboard"), { recursive: true, force: true });
    await writeFile(join(target, "external-state.txt"), "keep target\n", "utf8");
    await symlink(target, join(root, ".skillboard"));

    const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--purge"]);
    assert.equal(result.stdout.includes("`.skillboard`"), true);
    await assert.rejects(access(join(root, ".skillboard")), /ENOENT/);
    assert.equal(await readFile(join(target, "external-state.txt"), "utf8"), "keep target\n");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
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
    assert.match(result.stdout, /Removed: .*`\.skillboard`/);
    await assert.rejects(readdir(join(root, ".skillboard")), /ENOENT/);
    assert.match(await readFile(join(root, "skills", "local-helper", "SKILL.md"), "utf8"), /Local hook cleanup fixture/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
