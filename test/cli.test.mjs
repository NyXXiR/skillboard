import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("cli check and dashboard handle the multi-source example", async () => {
  const baseArgs = ["--config", "examples/multi-source.config.yaml", "--skills", "examples/multi-source-skills"];
  const check = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "check", ...baseArgs]);
  const dashboard = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "dashboard", ...baseArgs]);

  assert.match(check.stdout, /Policy check passed/);
  assert.match(dashboard.stdout, /github\.mattpocock\.skills/);
  assert.match(dashboard.stdout, /github\.code-yeongyu\.oh-my-openagent/);
  assert.match(dashboard.stdout, /owner: `github\.mattpocock\.skills`/);
  assert.match(dashboard.stdout, /owner: `local\.agent-skills-private`/);
});

test("cli multi-source example is runnable from the project root without local path edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-first-user-example-"));
  try {
    const baseArgs = ["--config", "examples/multi-source.config.yaml", "--skills", "examples/multi-source-skills"];
    const lockPath = join(root, "multi-source.lock.yaml");
    const hookPath = join(root, "codex-night-guard.sh");
    const check = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "check", ...baseArgs]);
    const list = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "list",
      "skills",
      ...baseArgs,
      "--workflow",
      "codex-night-workflow"
    ]);
    const explain = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "explain",
      "private.tdd-work-continuity",
      ...baseArgs
    ]);
    const canUse = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "can-use",
      "matt.tdd",
      "--workflow",
      "codex-night-workflow",
      ...baseArgs
    ]);
    const audit = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "audit",
      "sources",
      "--verify",
      ...baseArgs,
      "--json"
    ]);
    const lock = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "lock",
      "write",
      ...baseArgs,
      "--out",
      lockPath,
      "--json"
    ]);
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "hook",
      "install",
      "--workflow",
      "codex-night-workflow",
      ...baseArgs,
      "--out",
      hookPath,
      "--skillboard-bin",
      "node bin/skillboard.mjs"
    ]);
    const hook = await execFileAsync(hookPath, ["matt.tdd"]);
    const auditPayload = JSON.parse(audit.stdout);
    const lockText = await readFile(lockPath, "utf8");

    assert.match(check.stdout, /Policy check passed/);
    assert.match(list.stdout, /private\.tdd-work-continuity/);
    assert.match(explain.stdout, /Source: user/);
    assert.match(canUse.stdout, /Allowed: true/);
    assert.equal(auditPayload.ok, true);
    assert.equal(auditPayload.errors.length, 0);
    assert.equal(auditPayload.units.find((unit) => unit.id === "local.agent-skills-private").status, "verified-local");
    assert.equal(JSON.parse(lock.stdout).path, lockPath);
    assert.match(lockText, /local\.agent-skills-private/);
    assert.equal(hook.stdout, "allow\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli init bootstraps config and agent bridge files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-test-"));
  try {
    const first = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    const second = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    const config = await readFile(join(root, "skillboard.config.yaml"), "utf8");
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    const profilesReadme = await readFile(join(root, ".skillboard", "profiles", "README.md"), "utf8");
    const hooksReadme = await readFile(join(root, ".skillboard", "hooks", "README.md"), "utf8");
    const check = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "check",
      "--config",
      join(root, "skillboard.config.yaml"),
      "--skills",
      join(root, "skills")
    ]);

    assert.match(first.stdout, /Initialized SkillBoard/);
    assert.match(second.stdout, /SkillBoard already initialized/);
    assert.match(config, /invocation_policy: deny-by-default/);
    assert.match(agents, /BEGIN SKILLBOARD/);
    assert.match(agents, /skillboard check/);
    assert.match(agents, /skillboard import/);
    assert.match(agents, /skillboard guard use/);
    assert.match(agents, /skillboard can-use/);
    assert.match(agents, /skillboard audit sources/);
    assert.match(agents, /skillboard hook install/);
    assert.match(claude, /BEGIN SKILLBOARD/);
    assert.match(profilesReadme, /source profiles/);
    assert.match(hooksReadme, /skillboard hook install/);
    assert.equal(agents.match(/BEGIN SKILLBOARD/g).length, 1);
    assert.match(check.stdout, /Policy check passed/);
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

test("cli impact can write disable reports to a file", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-impact-test-"));
  try {
    const out = join(root, "impact.md");
    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "impact",
      "disable",
      "matt.tdd",
      "--config",
      "examples/skillboard.config.yaml",
      "--skills",
      "examples/skills",
      "--out",
      out
    ]);
    const report = await readFile(out, "utf8");

    assert.match(result.stdout, /Impact report written/);
    assert.match(report, /Affected required outputs/);
    assert.match(report, /test_result_or_reason/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli init scans installed agent skills into quarantined managed state", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-scan-test-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const codexHome = join(home, ".codex");
    const pluginRoot = join(codexHome, "plugins", "cache", "acme", "demo", "1.0.0");
    await mkdir(codexHome, { recursive: true });
    await writeFile(join(codexHome, "config.toml"), "[plugins.demo]\nenabled = true\n", "utf8");
    await writeSkill(join(codexHome, "skills", ".system", "system-helper"), "system-helper");
    await writeSkill(join(codexHome, "skills", "local-helper"), "local-helper");
    await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
    await mkdir(join(pluginRoot, "hooks"), { recursive: true });
    await writeFile(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "demo",
        skills: "./skills",
        commands: ["$demo-command"],
        hooks: ["./hooks/pre-tool-use-demo.json"],
        mcpServers: "./.mcp.json"
      }),
      "utf8"
    );
    await writeFile(
      join(pluginRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { demo_mcp: { command: "node", args: ["server.js"] } } }),
      "utf8"
    );
    await writeFile(join(pluginRoot, "hooks", "pre-tool-use-demo.json"), "{}", "utf8");
    await writeSkill(join(pluginRoot, "skills", "review"), "review");

    const env = { ...process.env, HOME: home, CODEX_HOME: codexHome, SKILLBOARD_INIT_SCAN_ROOTS: "" };
    const init = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", project], { env });
    const configPath = join(project, "skillboard.config.yaml");
    const config = await readFile(configPath, "utf8");
    const check = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "check",
      "--config",
      configPath,
      "--skills",
      join(project, "skills")
    ], { env });
    const units = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "list",
      "install-units",
      "--config",
      configPath,
      "--skills",
      join(project, "skills")
    ], { env });

    assert.match(init.stdout, /Scanned installed agent skills: 3/);
    assert.match(init.stdout, /Managed install units: 3/);
    assert.match(config, /system-helper:/);
    assert.match(config, /local-helper:/);
    assert.match(config, /demo:review:/);
    assert.match(config, /status: quarantined/);
    assert.match(config, /invocation: blocked/);
    assert.match(config, /owner_install_unit: codex\.system-skills/);
    assert.match(config, /owner_install_unit: codex\.user-skills/);
    assert.match(config, /owner_install_unit: codex\.plugin\.demo/);
    assert.match(config, /provided_components:\n\s+- skills\n\s+- commands\n\s+- hook\n\s+- mcp-server/);
    assert.match(config, /commands:\n\s+- \$demo-command/);
    assert.match(config, /hooks:\n\s+- pre-tool-use-demo/);
    assert.match(config, /mcp_servers:\n\s+- demo_mcp/);
    assert.match(config, /modified_config_files:\n\s+- ~\/\.codex\/config\.toml/);
    assert.match(config, /permission_risk: high/);
    assert.match(check.stdout, /Policy check passed/);
    assert.match(check.stdout, /provides runtime components but is unreviewed/);
    assert.match(units.stdout, /codex\.system-skills\tagent\truntime-extension/);
    assert.match(units.stdout, /codex\.user-skills\tskill\tuser/);
    assert.match(units.stdout, /codex\.plugin\.demo\tplugin\texternal-package.*risk=high/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli list, explain, and can-use expose source-aware control state", async () => {
  const baseArgs = ["--config", "examples/multi-source.config.yaml", "--skills", "examples/multi-source-skills"];
  const list = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "list", "skills", ...baseArgs, "--workflow", "codex-night-workflow"]);
  const explain = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "explain", "private.tdd-work-continuity", ...baseArgs]);
  const allowed = await execFileAsync(process.execPath, [
    "bin/skillboard.mjs",
    "can-use",
    "private.tdd-work-continuity",
    ...baseArgs,
    "--workflow",
    "codex-night-workflow",
    "--json"
  ]);
  let deniedError;
  try {
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "can-use",
      "matt.grill-me",
      ...baseArgs,
      "--workflow",
      "codex-night-workflow",
      "--json"
    ]);
  } catch (error) {
    deniedError = error;
  }

  assert.match(list.stdout, /private\.tdd-work-continuity\tactive\trouter-only\tuser/);
  assert.match(list.stdout, /matt\.tdd\tactive\tworkflow-auto\texternal-package/);
  assert.match(explain.stdout, /Source: user/);
  assert.equal(JSON.parse(allowed.stdout).allowed, true);
  assert.equal(JSON.parse(allowed.stdout).automaticAllowed, false);
  assert.equal(deniedError.code, 2);
  assert.equal(JSON.parse(deniedError.stdout).allowed, false);
});

test("cli guard exposes hook-friendly allow and deny decisions", async () => {
  const baseArgs = ["--config", "examples/multi-source.config.yaml", "--skills", "examples/multi-source-skills"];
  const allowed = await execFileAsync(process.execPath, [
    "bin/skillboard.mjs",
    "guard",
    "use",
    "private.tdd-work-continuity",
    ...baseArgs,
    "--workflow",
    "codex-night-workflow"
  ]);
  let deniedError;
  try {
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "guard",
      "use",
      "matt.grill-me",
      ...baseArgs,
      "--workflow",
      "codex-night-workflow"
    ]);
  } catch (error) {
    deniedError = error;
  }

  assert.equal(allowed.stdout, "allow\n");
  assert.equal(deniedError.code, 2);
  assert.match(deniedError.stdout, /^deny\n/);
  assert.match(deniedError.stdout, /blocks skill matt\.grill-me/);
});

test("cli audit sources reports trust findings without blocking reviewed sources", async () => {
  const result = await execFileAsync(process.execPath, [
    "bin/skillboard.mjs",
    "audit",
    "sources",
    "--config",
    "examples/multi-source.config.yaml",
    "--skills",
    "examples/multi-source-skills",
    "--json"
  ]);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.errors.length, 0);
  assert.ok(payload.warnings.some((warning) => warning.includes("source is not pinned")));
  assert.equal(payload.units.find((unit) => unit.id === "github.mattpocock.skills").trustLevel, "reviewed");
});

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
    const guard = await execFileAsync(hookPath, ["private.tdd-work-continuity"]);

    assert.match(install.stdout, /Installed guard hook/);
    assert.match(script, /guard use/);
    assert.equal((mode & 0o111) !== 0, true);
    assert.equal(guard.stdout, "allow\n");

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
    const commandGuard = await execFileAsync(commandHook, ["matt.tdd"]);

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
    assert.match(installed.stdout, /\.skillboard\/hooks\/skillboard-guard-bad-workflow\.sh/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli can-use denies model-selectable skills from unreviewed external sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-unreviewed-source-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(
      configPath,
      `version: 1
skills:
  vendor.router:
    path: vendor/router
    status: active
    invocation: router-only
    exposure: exported
    owner_install_unit: github.vendor.skills
workflows:
  review-workflow:
    harness: codex
    active_skills:
      - vendor.router
    blocked_skills: []
harnesses:
  codex:
    status: primary
    workflows:
      - review-workflow
install_units:
  github.vendor.skills:
    kind: marketplace
    source: github.com/vendor/skills
    scope: project
    provided_components:
      - skills
    components:
      skills:
        - vendor.router
    enabled: true
    permission_risk: medium
`,
      "utf8"
    );
    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "can-use",
        "vendor.router",
        "--workflow",
        "review-workflow",
        "--config",
        configPath,
        "--skills",
        join(root, "skills"),
        "--json"
      ]);
    } catch (caught) {
      error = caught;
    }
    const payload = JSON.parse(error.stdout);

    assert.equal(error.code, 2);
    assert.equal(payload.allowed, false);
    assert.match(payload.reasons.join("\n"), /source github\.vendor\.skills is unreviewed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli can-use denies skills from disabled install units", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-disabled-unit-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(
      configPath,
      `version: 1
skills:
  vendor.router:
    path: vendor/router
    status: active
    invocation: router-only
    exposure: exported
    owner_install_unit: github.vendor.skills
workflows:
  review-workflow:
    harness: codex
    active_skills:
      - vendor.router
    blocked_skills: []
harnesses:
  codex:
    status: primary
    workflows:
      - review-workflow
install_units:
  github.vendor.skills:
    kind: marketplace
    source: github.com/vendor/skills
    scope: project
    provided_components:
      - skills
    components:
      skills:
        - vendor.router
    enabled: false
    trust_level: reviewed
    permission_risk: medium
`,
      "utf8"
    );
    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "can-use",
        "vendor.router",
        "--workflow",
        "review-workflow",
        "--config",
        configPath,
        "--skills",
        join(root, "skills"),
        "--json"
      ]);
    } catch (caught) {
      error = caught;
    }
    const payload = JSON.parse(error.stdout);

    assert.equal(error.code, 2);
    assert.equal(payload.allowed, false);
    assert.match(payload.reasons.join("\n"), /Install unit github\.vendor\.skills is disabled/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli audit treats empty source_digest as unpinned", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-empty-digest-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(
      configPath,
      `version: 1
skills: {}
workflows: {}
install_units:
  github.vendor.skills:
    kind: marketplace
    source: github.com/vendor/skills
    scope: project
    source_digest: ""
    enabled: true
    trust_level: reviewed
    permission_risk: medium
`,
      "utf8"
    );
    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "audit",
      "sources",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.units[0].pinned, false);
    assert.match(payload.warnings.join("\n"), /source is not pinned/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli audit verify checks local source digests and lock write records verified sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-source-verify-test-"));
  try {
    const sourceRoot = join(root, "source");
    const configPath = join(root, "skillboard.config.yaml");
    const lockPath = join(root, "skillboard.lock.yaml");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, "README.md"), "local skill source\n", "utf8");
    await writeFile(
      configPath,
      `version: 1
skills: {}
workflows: {}
install_units:
  local.verified:
    kind: skill
    source: ${sourceRoot}
    scope: project
    enabled: true
    trust_level: trusted
    permission_risk: low
`,
      "utf8"
    );
    const firstAudit = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "audit",
      "sources",
      "--verify",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--json"
    ]);
    const firstPayload = JSON.parse(firstAudit.stdout);
    const digest = firstPayload.units[0].actualDigest;
    await writeFile(
      configPath,
      `version: 1
skills: {}
workflows: {}
install_units:
  local.verified:
    kind: skill
    source: ${sourceRoot}
    scope: project
    source_digest: ${digest}
    enabled: true
    trust_level: trusted
    permission_risk: low
`,
      "utf8"
    );
    const verifiedAudit = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "audit",
      "sources",
      "--verify",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--json"
    ]);
    const lock = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "lock",
      "write",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--out",
      lockPath,
      "--json"
    ]);
    const verifiedPayload = JSON.parse(verifiedAudit.stdout);
    const lockText = await readFile(lockPath, "utf8");

    assert.equal(verifiedPayload.units[0].digestVerified, true);
    assert.equal(JSON.parse(lock.stdout).path, lockPath);
    assert.match(lockText, /digest_verified: true/);
    assert.match(lockText, new RegExp(digest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli audit verify treats slash command sources as metadata sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-slash-source-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(
      configPath,
      `version: 1
skills: {}
workflows: {}
install_units:
  command.source:
    kind: marketplace
    source: /plugin marketplace add anthropics/skills
    scope: project
    enabled: true
    trust_level: reviewed
    permission_risk: medium
`,
      "utf8"
    );
    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "audit",
      "sources",
      "--verify",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.errors.length, 0);
    assert.equal(payload.units[0].status, "metadata-only");
    assert.match(payload.warnings.join("\n"), /remote or command source has no source_digest pin/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli lock write refuses verification errors by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-lock-failure-test-"));
  try {
    const sourceRoot = join(root, "source");
    const configPath = join(root, "skillboard.config.yaml");
    const lockPath = join(root, "skillboard.lock.yaml");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, "README.md"), "changed local source\n", "utf8");
    await writeFile(
      configPath,
      `version: 1
skills: {}
workflows: {}
install_units:
  local.bad-digest:
    kind: skill
    source: ${sourceRoot}
    scope: project
    source_digest: sha256:0000000000000000000000000000000000000000000000000000000000000000
    enabled: true
    trust_level: trusted
    permission_risk: low
`,
      "utf8"
    );

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "lock",
        "write",
        "--config",
        configPath,
        "--skills",
        join(root, "skills"),
        "--out",
        lockPath
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /Cannot write lockfile because source verification failed/);
    await assert.rejects(readFile(lockPath, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli lock write allow-unverified records an explicit unverified lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-lock-allow-unverified-test-"));
  try {
    const sourceRoot = join(root, "source");
    const configPath = join(root, "skillboard.config.yaml");
    const lockPath = join(root, "skillboard.lock.yaml");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, "README.md"), "changed local source\n", "utf8");
    await writeFile(
      configPath,
      `version: 1
skills: {}
workflows: {}
install_units:
  local.bad-digest:
    kind: skill
    source: ${sourceRoot}
    scope: project
    source_digest: sha256:0000000000000000000000000000000000000000000000000000000000000000
    enabled: true
    trust_level: trusted
    permission_risk: low
`,
      "utf8"
    );

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "lock",
      "write",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--out",
      lockPath,
      "--allow-unverified",
      "--json"
    ]);
    const lockText = await readFile(lockPath, "utf8");

    assert.equal(JSON.parse(result.stdout).path, lockPath);
    assert.match(lockText, /digest_verified: false/);
    assert.match(lockText, /source_digest: sha256:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli activate refuses unusable unreviewed automatic external skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-activate-trust-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const original = `version: 1
skills:
  vendor.router:
    path: vendor/router
    status: candidate
    invocation: manual-only
    exposure: exported
    owner_install_unit: github.vendor.skills
workflows:
  review-workflow:
    harness: codex
    active_skills: []
    blocked_skills: []
harnesses:
  codex:
    status: primary
    workflows:
      - review-workflow
install_units:
  github.vendor.skills:
    kind: marketplace
    source: github.com/vendor/skills
    scope: project
    provided_components:
      - skills
    components:
      skills:
        - vendor.router
    enabled: true
    trust_level: unreviewed
    permission_risk: medium
`;
    await writeFile(configPath, original, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "activate",
        "vendor.router",
        "--workflow",
        "review-workflow",
        "--mode",
        "workflow-auto",
        "--config",
        configPath,
        "--skills",
        join(root, "skills")
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /Control update would not be usable/);
    assert.match(error.stderr, /source github\.vendor\.skills is unreviewed/);
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli prefer refuses unusable unreviewed automatic external skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-prefer-trust-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const original = `version: 1
skills:
  vendor.router:
    path: vendor/router
    status: quarantined
    invocation: blocked
    exposure: exported
    owner_install_unit: github.vendor.skills
capabilities:
  code-review:
    canonical: vendor.router
    alternatives: []
    default_policy: workflow-auto
workflows:
  review-workflow:
    harness: codex
    active_skills: []
    blocked_skills: []
    required_capabilities:
      code-review:
        preferred: ""
        fallback: []
        policy: workflow-auto
harnesses:
  codex:
    status: primary
    workflows:
      - review-workflow
install_units:
  github.vendor.skills:
    kind: marketplace
    source: github.com/vendor/skills
    scope: project
    provided_components:
      - skills
    components:
      skills:
        - vendor.router
    enabled: true
    trust_level: unreviewed
    permission_risk: medium
`;
    await writeFile(configPath, original, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "prefer",
        "vendor.router",
        "--workflow",
        "review-workflow",
        "--capability",
        "code-review",
        "--config",
        configPath,
        "--skills",
        join(root, "skills")
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /Control update would not be usable/);
    assert.match(error.stderr, /source github\.vendor\.skills is unreviewed/);
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli prefer lets user skills take workflow capability priority", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-prefer-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const sourceConfig = (await readFile("examples/multi-source.config.yaml", "utf8"))
      .replace(/  private\.tdd-work-continuity:\r?\n/, "  # user preference should survive control writes\n  private.tdd-work-continuity:\n");
    await writeFile(configPath, sourceConfig, "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "prefer",
      "private.tdd-work-continuity",
      "--workflow",
      "codex-night-workflow",
      "--capability",
      "test-first-implementation",
      "--config",
      configPath,
      "--skills",
      "examples/multi-source-skills"
    ]);
    const canUse = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "can-use",
      "private.tdd-work-continuity",
      "--workflow",
      "codex-night-workflow",
      "--config",
      configPath,
      "--skills",
      "examples/multi-source-skills",
      "--json"
    ]);
    const config = await readFile(configPath, "utf8");

    assert.match(result.stdout, /Preferred private\.tdd-work-continuity/);
    assert.match(config, /# user preference should survive control writes/);
    assert.match(config, /preferred: private\.tdd-work-continuity/);
    assert.match(config, /- matt\.tdd/);
    assert.deepEqual(JSON.parse(canUse.stdout).roles, ["active", "preferred"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli dry-run validates a control change without writing config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-dry-run-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(configPath, await readFile("examples/multi-source.config.yaml", "utf8"), "utf8");
    const before = await readFile(configPath, "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "prefer",
      "private.tdd-work-continuity",
      "--workflow",
      "codex-night-workflow",
      "--capability",
      "test-first-implementation",
      "--config",
      configPath,
      "--skills",
      "examples/multi-source-skills",
      "--dry-run",
      "--json"
    ]);
    const after = await readFile(configPath, "utf8");
    const payload = JSON.parse(result.stdout);

    assert.equal(after, before);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.changed, true);
    assert.equal(payload.plan.changedLineCount > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli failed control writes preserve the original config and cleanup temp files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-atomic-failure-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const original = `version: 1
skills:
  sample.skill:
    path: sample
    status: candidate
    invocation: manual-only
    exposure: exported
workflows:
  broken-workflow:
    harness: missing-harness
    active_skills: []
    blocked_skills: []
`;
    await writeFile(configPath, original, "utf8");
    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "activate",
        "sample.skill",
        "--workflow",
        "broken-workflow",
        "--mode",
        "workflow-auto",
        "--config",
        configPath,
        "--skills",
        join(root, "skills")
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /Policy update would create invalid config/);
    assert.equal(await readFile(configPath, "utf8"), original);
    assert.deepEqual((await readdir(root)).filter((entry) => entry.includes(".tmp")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli block removes a skill from workflow active and capability slots", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-block-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(configPath, await readFile("examples/multi-source.config.yaml", "utf8"), "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "block",
      "matt.tdd",
      "--workflow",
      "codex-night-workflow",
      "--config",
      configPath,
      "--skills",
      "examples/multi-source-skills"
    ]);
    const canUseError = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "check",
      "--config",
      configPath,
      "--skills",
      "examples/multi-source-skills"
    ]);
    const config = await readFile(configPath, "utf8");

    assert.match(result.stdout, /Blocked matt\.tdd/);
    assert.match(canUseError.stdout, /Policy check passed/);
    assert.match(config, /blocked_skills:\r?\n\s+- matt\.grill-me\r?\n\s+- matt\.tdd/);
    assert.doesNotMatch(config, /preferred: matt\.tdd/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli classifies workflow bundles as their own install-unit source", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-workflow-unit-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(
      configPath,
      `version: 1
skills: {}
workflows: {}
install_units:
  team.release-workflow:
    kind: workflow
    source: github.com/example/release-workflow
    scope: project
    enabled: true
    permission_risk: medium
`,
      "utf8"
    );

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "list",
      "install-units",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--json"
    ]);
    const units = JSON.parse(result.stdout);

    assert.equal(units[0].kind, "workflow");
    assert.equal(units[0].sourceClass, "workflow-bundle");
    assert.equal(units[0].priority, 65);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli accepts config-driven custom skill source classes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-custom-source-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(
      configPath,
      `version: 1
skills:
  org.review-gate:
    path: org/review-gate
    status: active
    invocation: router-only
    exposure: exported
    category: review
    owner_install_unit: org.platform-baseline
workflows:
  review-workflow:
    harness: codex
    active_skills:
      - org.review-gate
    blocked_skills: []
harnesses:
  codex:
    status: primary
    workflows:
      - review-workflow
install_units:
  org.platform-baseline:
    kind: custom
    source_class: org-baseline
    priority: 95
    source: https://example.test/org/skills
    scope: org
    provided_components:
      - skills
    components:
      skills:
        - org.review-gate
    enabled: true
    permission_risk: medium
`,
      "utf8"
    );

    const list = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "list",
      "skills",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--workflow",
      "review-workflow"
    ]);
    const explain = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "explain",
      "org.review-gate",
      "--config",
      configPath,
      "--skills",
      join(root, "skills"),
      "--json"
    ]);

    assert.match(list.stdout, /org\.review-gate\tactive\trouter-only\torg-baseline/);
    assert.equal(JSON.parse(explain.stdout).source.class, "org-baseline");
    assert.equal(JSON.parse(explain.stdout).source.priority, 95);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeSkill(root, name) {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "SKILL.md"),
    `---
name: ${name}
description: Test skill ${name}.
---

# ${name}
`,
    "utf8"
  );
}
