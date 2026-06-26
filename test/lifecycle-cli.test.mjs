import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { runInitCommand } from "../src/lifecycle-cli.mjs";

const execFileAsync = promisify(execFile);

test("init next commands preserve GitHub npx package specs", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-npx-github-test-"));
  try {
    let stdout = "";
    const code = await runInitCommand(new Map([
      ["dir", root],
      ["no-scan-installed", "true"]
    ]), {
      write(chunk) {
        stdout += chunk;
      }
    }, {
      cwd: process.cwd(),
      entrypointPath: "/tmp/_npx/demo/node_modules/agent-skillboard/bin/skillboard.mjs",
      packageSpec: "github:NyXXiR/skillboard"
    });

    assert.equal(code, 0);
    assert.match(stdout, /Next:/);
    assert.match(stdout, /npm exec --yes --package github:NyXXiR\/skillboard -- skillboard doctor/);
    assert.match(stdout, /npm exec --yes --package github:NyXXiR\/skillboard -- skillboard brief/);
    assert.doesNotMatch(stdout, /npx agent-skillboard/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli uninstall removes SkillBoard scaffolding without deleting user content", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-uninstall-test-"));
  try {
    await writeFile(join(root, "AGENTS.md"), "# Existing agent rules\n\nKeep this line.\n", "utf8");
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await writeFile(join(root, ".skillboard", "reports", "user-report.md"), "keep report\n", "utf8");
    await writeFile(join(root, "skillboard.config.yaml"), `${await readFile(join(root, "skillboard.config.yaml"), "utf8")}# user setting\n`, "utf8");

    const dryRun = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--dry-run"]);
    assert.match(dryRun.stdout, /Dry run: Uninstalled SkillBoard/);
    assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /BEGIN SKILLBOARD/);
    assert.match(await readFile(join(root, "CLAUDE.md"), "utf8"), /BEGIN SKILLBOARD/);

    const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root]);
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    const config = await readFile(join(root, "skillboard.config.yaml"), "utf8");
    const reports = await readdir(join(root, ".skillboard", "reports"));

    assert.match(result.stdout, /Updated: `AGENTS\.md`/);
    assert.match(result.stdout, /Removed: .*`CLAUDE\.md`/);
    assert.match(result.stdout, /Preserved: .*`skillboard\.config\.yaml`/);
    assert.match(agents, /Keep this line/);
    assert.doesNotMatch(agents, /BEGIN SKILLBOARD/);
    assert.match(config, /# user setting/);
    assert.deepEqual(reports, ["user-report.md"]);
    await assert.rejects(readFile(join(root, "CLAUDE.md"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, ".skillboard", "profiles", "README.md"), "utf8"), /ENOENT/);
    assert.equal(await readFile(join(root, ".skillboard", "reports", "user-report.md"), "utf8"), "keep report\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli uninstall preserves symlinked bridge files instead of editing targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-uninstall-symlink-test-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    const bridgeText = await readFile(join(root, "AGENTS.md"), "utf8");
    const target = join(root, "external-agents.md");
    await writeFile(target, bridgeText, "utf8");
    await rm(join(root, "AGENTS.md"));
    await symlink(target, join(root, "AGENTS.md"));

    const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root]);
    const targetAfter = await readFile(target, "utf8");

    assert.match(result.stdout, /Preserved: .*`AGENTS\.md`/);
    assert.match(targetAfter, /BEGIN SKILLBOARD/);
    assert.equal(await readlink(join(root, "AGENTS.md")), target);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli uninstall rejects mutually exclusive config removal flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-uninstall-flags-test-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    let error;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--remove-config", "--reset-config"]);
    } catch (caught) {
      error = caught;
    }
    assert.equal(error?.code, 1);
    assert.match(error.stderr, /--remove-config and --reset-config are mutually exclusive/);
    assert.match(await readFile(join(root, "skillboard.config.yaml"), "utf8"), /version: 1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli uninstall remove-config deletes only untouched generated config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-uninstall-config-test-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--remove-config"]);
    assert.match(result.stdout, /Removed: .*`skillboard\.config\.yaml`/);
    await assert.rejects(readFile(join(root, "skillboard.config.yaml"), "utf8"), /ENOENT/);

    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await writeFile(join(root, "skillboard.config.yaml"), "version: 1\nskills:\n  user.skill:\n    path: user/skill\n", "utf8");
    const preserved = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", root, "--remove-config"]);

    assert.match(preserved.stdout, /Preserved: .*`skillboard\.config\.yaml`/);
    assert.match(await readFile(join(root, "skillboard.config.yaml"), "utf8"), /user\.skill/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
