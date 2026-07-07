// allow: SIZE_OK - legacy CLI integration suite split is deferred from the 0.2.7 release gate.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import YAML from "yaml";
import { displayCommand } from "./helpers/expected-command.mjs";

const execFileAsync = promisify(execFile);

function testAgentEnv(home, overrides = {}) {
  return {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    HERMES_HOME: join(home, ".hermes"),
    CLAUDE_HOME: join(home, ".claude"),
    SKILLBOARD_INIT_SCAN_ROOTS: "",
    ...overrides
  };
}

async function execHookScript(path, args) {
  if (process.platform === "win32") {
    return await execFileAsync("bash", [path, ...args]);
  }
  return await execFileAsync(path, args);
}

function isPosixExecutableBitSupported() {
  return process.platform !== "win32";
}

function assertInitNextCommand(stdout, command, dir, suffix = "") {
  const prefix = `- node bin/skillboard.mjs ${command} --dir `;
  const line = stdout.split("\n").find((candidate) => {
    return candidate.startsWith(prefix)
      && candidate.includes(dir)
      && candidate.endsWith(suffix);
  });
  assert.ok(line, `expected init Next command ${command} for ${dir}${suffix}\n${stdout}`);
}

function assertInitNextWorkflowCommand(stdout, workflow, dir, suffix = "") {
  const prefix = `- node bin/skillboard.mjs brief --workflow ${workflow} --dir `;
  const line = stdout.split("\n").find((candidate) => {
    return candidate.startsWith(prefix)
      && candidate.includes(dir)
      && candidate.endsWith(suffix);
  });
  assert.ok(line, `expected init Next workflow brief for ${workflow} in ${dir}${suffix}\n${stdout}`);
}

function assertInitNextWorkflowIntentCommand(stdout, workflow, dir) {
  const prefix = `- node bin/skillboard.mjs brief --workflow ${workflow} --intent `;
  const line = stdout.split("\n").find((candidate) => {
    return candidate.startsWith(prefix)
      && candidate.includes("'write tests before implementation'")
      && candidate.includes(dir);
  });
  assert.ok(line, `expected init Next workflow intent brief for ${workflow} in ${dir}\n${stdout}`);
}

function variantAddCliConfig(options = {}) {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
skills:
  # variant add should preserve comments through control writes
  base.review:
    path: base/review
    status: active
    invocation: workflow-auto
    exposure: exported
    category: core
  canonical.review:
    path: canonical/review
    status: active
    invocation: manual-only
    exposure: exported
    category: core
  old.review:
    path: old/review
    status: active
    invocation: manual-only
    exposure: exported
    category: core
${options.variantSkill ?? ""}capabilities:
  task-review:
    canonical: canonical.review
    alternatives: []
    default_policy: router-only
harnesses:
  claude:
    status: available
    workflows:
      - claude-workflow
workflows:
  claude-workflow:
    harness: claude
    active_skills: []
    blocked_skills: []
    required_capabilities:
      task-review:
        preferred: old.review
        fallback: []
        policy: workflow-auto
${options.installUnits ?? ""}`;
}

async function withAppliedVariantAddFixture(prefix, callback) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(skillsRoot, { recursive: true });
    for (const skillPath of ["base/review", "canonical/review", "old/review", "claude/review"]) {
      await mkdir(join(skillsRoot, skillPath), { recursive: true });
      await writeFile(
        join(skillsRoot, skillPath, "SKILL.md"),
        `---\nname: ${skillPath}\ndescription: fixture skill\n---\n`,
        "utf8"
      );
    }
    await writeFile(configPath, variantAddCliConfig(), "utf8");
    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "variant",
      "add",
      "claude.review",
      "--from",
      "base.review",
      "--capability",
      "task-review",
      "--workflow",
      "claude-workflow",
      "--path",
      "claude/review",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--json"
    ]);

    await callback({ configPath, skillsRoot, root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

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

test("cli --version and -v print package version", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const longFlag = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "--version"]);
  const shortFlag = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "-v"]);
  assert.equal(longFlag.stdout.trim(), pkg.version);
  assert.equal(shortFlag.stdout.trim(), pkg.version);
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
    const hook = await execHookScript(hookPath, ["matt.tdd"]);
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

test("cli init initializes legacy config and agent bridge files", async () => {
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
    assert.match(agents, /answer skill availability questions from SkillBoard/i);
    assert.match(agents, /translate user intent into current action ids/i);
    assert.match(agents, /brief --intent <request>/i);
    assert.match(agents, /assistant_guidance\.route/);
    assert.match(agents, /recommended_skill/);
    assert.match(agents, /fallback_skills/);
    assert.match(agents, /route_candidates/);
    assert.match(agents, /overlap_resolution/);
    assert.match(agents, /policy_memory/);
    assert.match(agents, /post_use_policy_suggestion/);
    assert.match(agents, /ask after completion whether to remember the suggested policy/i);
    assert.match(agents, /guard_command/);
    assert.match(agents, /I will use <skill-id> for this request\./);
    assert.match(agents, /I used <skill-id> for this request\./);
    assert.match(agents, /ask a clarifying question/i);
    assert.match(agents, /ask for one confirmation/i);
    assert.match(agents, /apply one current action/i);
    assert.match(agents, /reread the post-apply brief/i);
    assert.match(agents, /run the guard automatically before invocation/i);
    assert.match(agents, /skillboard brief --json/);
    assert.match(agents, /skillboard apply-action <action-id>/);
    assert.match(agents, /skillboard guard use/);
    assert.match(agents, /skillboard can-use/);
    assert.match(agents, /skillboard audit sources/);
    assert.match(agents, /skillboard doctor/);
    assert.match(agents, /skillboard hook install/);
    assert.match(agents, /current brief/i);
    assert.match(agents, /cached or stale action ids/i);
    assert.match(agents, /do not infer availability from `SKILL\.md` bodies/i);
    assert.match(claude, /BEGIN SKILLBOARD/);
    assert.match(claude, /translate user intent into current action ids/i);
    assert.match(claude, /brief --intent <request>/i);
    assert.match(claude, /assistant_guidance\.route/);
    assert.match(claude, /route_candidates/);
    assert.match(claude, /overlap_resolution/);
    assert.match(claude, /policy_memory/);
    assert.match(claude, /post_use_policy_suggestion/);
    assert.match(profilesReadme, /source profiles/);
    assert.match(hooksReadme, /skillboard hook install/);
    assert.equal(agents.match(/BEGIN SKILLBOARD/g).length, 1);
    assert.match(check.stdout, /Policy check passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli supports a first-time local skill control flow", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-user-flow-test-"));
  try {
    const project = join(root, "project");
    const configPath = join(project, "skillboard.config.yaml");
    const skillsRoot = join(project, "skills");
    const skillPath = join(skillsRoot, "user-helper");
    const impactPath = join(project, ".skillboard", "reports", "user-helper-impact.md");
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];

    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", project, "--no-scan-installed"]);
    await writeSkill(skillPath, "user-helper");
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills: {}
capabilities:
  task-review:
    canonical: ""
    alternatives: []
    default_policy: manual-only
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills: []
    blocked_skills: []
    required_capabilities:
      task-review:
        preferred: ""
        fallback: []
        policy: manual-only
install_units: {}
`,
      "utf8"
    );
    const beforeAdd = await readFile(configPath, "utf8");
    const dryAdd = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "add",
      "skill",
      "user.helper",
      "--path",
      "user-helper",
      ...baseArgs,
      "--dry-run",
      "--json"
    ]);
    const dryAddPayload = JSON.parse(dryAdd.stdout);

    assert.equal(dryAddPayload.dryRun, true);
    assert.equal(await readFile(configPath, "utf8"), beforeAdd);
    assert.ok(dryAddPayload.plan.semanticChanges.some((change) => change.path === "/skills/user.helper"));

    const add = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "add",
      "skill",
      "user.helper",
      "--path",
      "user-helper",
      ...baseArgs
    ]);
    const explainCandidate = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "explain",
      "user.helper",
      ...baseArgs
    ]);
    let deniedBeforeActivation;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "can-use",
        "user.helper",
        "--workflow",
        "daily-workflow",
        ...baseArgs,
        "--json"
      ]);
    } catch (caught) {
      deniedBeforeActivation = caught;
    }

    assert.match(add.stdout, /Added user\.helper/);
    assert.match(explainCandidate.stdout, /Status: candidate/);
    assert.match(explainCandidate.stdout, /Source: user/);
    assert.equal(deniedBeforeActivation.code, 2);
    assert.match(JSON.parse(deniedBeforeActivation.stdout).reasons.join("\n"), /not active, preferred, or fallback/);

    const activate = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "activate",
      "user.helper",
      "--workflow",
      "daily-workflow",
      ...baseArgs
    ]);
    const allowed = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "can-use",
      "user.helper",
      "--workflow",
      "daily-workflow",
      ...baseArgs,
      "--json"
    ]);
    const list = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "list",
      "skills",
      "--workflow",
      "daily-workflow",
      ...baseArgs
    ]);
    const impact = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "impact",
      "disable",
      "user.helper",
      ...baseArgs,
      "--out",
      impactPath
    ]);
    const impactReport = await readFile(impactPath, "utf8");

    assert.match(activate.stdout, /Activated user\.helper/);
    assert.equal(JSON.parse(allowed.stdout).allowed, true);
    assert.equal(JSON.parse(allowed.stdout).automaticAllowed, false);
    assert.match(list.stdout, /user\.helper\tactive\tmanual-only\tuser\towner=direct\troles=active/);
    assert.match(impact.stdout, /Impact report written/);
    assert.match(impactReport, /Affected workflows: `daily-workflow`/);

    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "block",
      "user.helper",
      "--workflow",
      "daily-workflow",
      ...baseArgs
    ]);
    let deniedAfterBlock;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "can-use",
        "user.helper",
        "--workflow",
        "daily-workflow",
        ...baseArgs,
        "--json"
      ]);
    } catch (caught) {
      deniedAfterBlock = caught;
    }
    let removeWithoutForce;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "remove",
        "skill",
        "user.helper",
        ...baseArgs
      ]);
    } catch (caught) {
      removeWithoutForce = caught;
    }
    const beforeRemove = await readFile(configPath, "utf8");
    const dryRemove = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "remove",
      "skill",
      "user.helper",
      ...baseArgs,
      "--force",
      "--dry-run",
      "--json"
    ]);
    const dryRemovePayload = JSON.parse(dryRemove.stdout);

    assert.equal(deniedAfterBlock.code, 2);
    assert.match(JSON.parse(deniedAfterBlock.stdout).reasons.join("\n"), /blocks skill user\.helper/);
    assert.equal(removeWithoutForce.code, 1);
    assert.match(removeWithoutForce.stderr, /still referenced/);
    assert.equal(dryRemovePayload.dryRun, true);
    assert.equal(await readFile(configPath, "utf8"), beforeRemove);
    assert.ok(dryRemovePayload.plan.semanticChanges.some((change) => change.path === "/skills/user.helper"));

    const remove = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "remove",
      "skill",
      "user.helper",
      ...baseArgs,
      "--force"
    ]);
    const configAfterRemove = await readFile(configPath, "utf8");
    const check = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "check", ...baseArgs]);
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "uninstall", "--dir", project]);

    assert.match(remove.stdout, /Removed user\.helper/);
    assert.doesNotMatch(configAfterRemove, /user\.helper/);
    assert.equal(await readFile(join(skillPath, "SKILL.md"), "utf8").then((text) => text.includes("user-helper")), true);
    assert.match(check.stdout, /Policy check passed/);
    assert.equal(await readFile(join(skillPath, "SKILL.md"), "utf8").then((text) => text.includes("user-helper")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli add workflow and harness supports manual local growth", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-add-workflow-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];
    await writeSkill(join(skillsRoot, "user-helper"), "user-helper");
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  user.helper:
    path: user-helper
    status: candidate
    invocation: manual-only
    exposure: exported
    category: user
capabilities: {}
harnesses: {}
workflows: {}
install_units: {}
`,
      "utf8"
    );

    const addHarness = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "add",
      "harness",
      "codex",
      "--status",
      "configured",
      "--command",
      "$codex",
      ...baseArgs
    ]);
    const addWorkflow = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "add",
      "workflow",
      "daily-workflow",
      "--harness",
      "codex",
      "--skill",
      "user.helper",
      ...baseArgs
    ]);
    const allowed = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "can-use",
      "user.helper",
      "--workflow",
      "daily-workflow",
      ...baseArgs,
      "--json"
    ]);
    const config = await readFile(configPath, "utf8");
    const allowedPayload = JSON.parse(allowed.stdout);

    assert.match(addHarness.stdout, /Added harness codex/);
    assert.match(addWorkflow.stdout, /Added workflow daily-workflow/);
    assert.match(config, /commands:\n\s+- \$codex/);
    assert.match(config, /workflows:\n\s+- daily-workflow/);
    assert.match(config, /user\.helper:\n\s+path: user-helper\n\s+status: active\n\s+invocation: manual-only/);
    assert.equal(allowedPayload.allowed, true);
    assert.equal(allowedPayload.automaticAllowed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli add workflow refuses unreviewed non-user source manual bypass", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-runtime-bypass-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];
    await writeSkill(join(skillsRoot, "plugin-helper"), "plugin-helper");
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  plugin.helper:
    path: plugin-helper
    status: candidate
    invocation: manual-only
    exposure: unit-managed
    category: plugin
    owner_install_unit: acme.plugin
capabilities: {}
harnesses: {}
workflows: {}
install_units:
  acme.plugin:
    kind: plugin
    source: npx acme install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: high
    provided_components:
      - skills
      - commands
    components:
      skills:
        - plugin.helper
      commands:
        - $acme
`,
      "utf8"
    );
    const before = await readFile(configPath, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "add",
        "workflow",
        "unsafe-workflow",
        "--harness",
        "codex",
        "--skill",
        "plugin.helper",
        ...baseArgs
      ]);
    } catch (caught) {
      error = caught;
    }
    let denied;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "can-use",
        "plugin.helper",
        "--workflow",
        "unsafe-workflow",
        ...baseArgs,
        "--json"
      ]);
    } catch (caught) {
      denied = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /unreviewed non-user source acme\.plugin/);
    assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal(denied.code, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli add workflow refuses medium-risk unreviewed plugin manual bypass", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-plugin-bypass-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];
    await writeSkill(join(skillsRoot, "plugin-helper"), "plugin-helper");
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  plugin.helper:
    path: plugin-helper
    status: candidate
    invocation: manual-only
    exposure: unit-managed
    category: plugin
    owner_install_unit: acme.plugin
capabilities: {}
harnesses: {}
workflows: {}
install_units:
  acme.plugin:
    kind: plugin
    source: npx acme install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: medium
    provided_components:
      - skills
    components:
      skills:
        - plugin.helper
`,
      "utf8"
    );
    const before = await readFile(configPath, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "add",
        "workflow",
        "unsafe-workflow",
        "--harness",
        "codex",
        "--skill",
        "plugin.helper",
        ...baseArgs
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /unreviewed non-user source acme\.plugin/);
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli add skill with workflow validates immediate usability", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-add-skill-workflow-validation-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];
    await writeSkill(join(skillsRoot, "disabled-helper"), "disabled-helper");
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills: {}
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills: []
    blocked_skills: []
install_units:
  disabled.pack:
    kind: skill
    source: local disabled pack
    scope: local
    enabled: false
    trust_level: trusted
    permission_risk: low
    provided_components:
      - skills
    components:
      skills:
        - disabled.helper
`,
      "utf8"
    );
    const before = await readFile(configPath, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "add",
        "skill",
        "disabled.helper",
        "--path",
        "disabled-helper",
        "--owner-install-unit",
        "disabled.pack",
        "--workflow",
        "daily-workflow",
        ...baseArgs
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /Install unit disabled\.pack is disabled/);
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli add skill rejects paths outside the skills root", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-add-skill-path-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];
    await mkdir(skillsRoot, { recursive: true });
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills: {}
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills: []
    blocked_skills: []
install_units: {}
`,
      "utf8"
    );
    const before = await readFile(configPath, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "add",
        "skill",
        "escape.helper",
        "--path",
        "../../secret",
        "--workflow",
        "daily-workflow",
        "--invocation",
        "workflow-auto",
        ...baseArgs
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /skill path must stay under the skills root/);
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli check rejects configured skill paths outside the skills root", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-config-path-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(
      configPath,
      `version: 1
skills:
  escape.helper:
    path: ../../secret
workflows: {}
harnesses: {}
install_units: {}
`,
      "utf8"
    );

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "check",
        "--config",
        configPath,
        "--skills",
        join(root, "skills")
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /skills\.escape\.helper\.path must stay under the skills root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli doctor reports an uninitialized project without mutating it", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-doctor-empty-test-"));
  try {
    let error;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", root, "--json"]);
    } catch (caught) {
      error = caught;
    }
    const payload = JSON.parse(error.stdout);

    assert.equal(error.code, 1);
    assert.equal(payload.ok, false);
    assert.equal(payload.initialized, false);
    assert.equal(payload.config.exists, false);
    assert.equal(payload.workspace.skills.byStatus.quarantined, 0);
    assert.equal(payload.workspace.skills.byInvocation["workflow-auto"], 0);
    assert.equal(payload.workspace.installUnits.bySourceClass["runtime-extension"], 0);
    assert.equal(payload.bridges.every((bridge) => bridge.status === "absent"), true);
    assert.deepEqual(await readdir(root), []);
    assert.ok(payload.recommendations.includes("run skillboard setup once per user/agent install if agents should use SkillBoard for skill priority"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli doctor strict fails review-required state without source blocking warnings", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-doctor-strict-review-test-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await writeFile(
      join(root, "skillboard.config.yaml"),
      `version: 1
skills:
  local.quarantined:
    path: local-quarantined
    status: quarantined
    invocation: blocked
    exposure: exported
    category: user
workflows: {}
harnesses: {}
install_units: {}
`,
      "utf8"
    );

    const doctor = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", root, "--json"]);
    let strictError;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", root, "--strict", "--json"]);
    } catch (caught) {
      strictError = caught;
    }
    const payload = JSON.parse(doctor.stdout);
    const strictPayload = JSON.parse(strictError.stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.reviewRequired, true);
    assert.equal(payload.sources.blockingWarnings.length, 0);
    assert.equal(payload.strictOk, false);
    assert.equal(strictError.code, 1);
    assert.equal(strictPayload.mode, "safe-mode");
    assert.equal(strictPayload.strictOk, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli doctor and status summarize initialized lifecycle health", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-doctor-init-test-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    const doctor = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", root, "--json"]);
    const status = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "status", "--dir", root]);
    const statusJson = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "status", "--dir", root, "--json"]);
    const payload = JSON.parse(doctor.stdout);
    const statusPayload = JSON.parse(statusJson.stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.initialized, true);
    assert.equal(payload.config.valid, true);
    assert.equal(payload.workspace.skills.declared, 0);
    assert.equal(payload.policy.ok, true);
    assert.equal(payload.sources.ok, true);
    assert.equal(payload.bridges.every((bridge) => bridge.status === "installed"), true);
    assert.ok(payload.uninstall.removed.includes("AGENTS.md"));
    assert.ok(payload.uninstall.removed.includes("skillboard.config.yaml"));
    assert.ok(payload.uninstall.removed.includes(".skillboard"));
    assert.equal(statusPayload.ok, true);
    assert.equal(statusPayload.config.version, 1);
    assert.match(status.stdout, /SkillBoard doctor: passed/);
    assert.match(status.stdout, /Uninstall dry run: remove/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli doctor gives actionable guidance for unmanaged bridge files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-doctor-unmanaged-bridge-test-"));
  try {
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await writeFile(join(root, "AGENTS.md"), "# Existing unmanaged rules\n", "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", root, "--json"]);
    } catch (caught) {
      error = caught;
    }
    const payload = JSON.parse(error.stdout);

    assert.equal(error.code, 1);
    assert.equal(payload.ok, false);
    assert.equal(payload.bridges.find((bridge) => bridge.file === "AGENTS.md").status, "unmanaged");
    assert.ok(payload.recommendations.includes("legacy project bridge is unmanaged; run skillboard init only if maintaining deprecated project-local policy"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli doctor treats high-risk unreviewed runtime extensions as safe-mode review by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-doctor-high-risk-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await writeFile(
      configPath,
      `version: 1
skills: {}
workflows: {}
harnesses: {}
install_units:
  acme.runtime:
    kind: plugin
    source: npx acme-runtime install
    scope: user-global
    provided_components:
      - hook
    components:
      hooks:
        - pre-tool-use
    enabled: true
    permission_risk: high
`,
      "utf8"
    );

    const doctor = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", root, "--json"]);
    let strictError;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", root, "--strict", "--json"]);
    } catch (caught) {
      strictError = caught;
    }
    const payload = JSON.parse(doctor.stdout);
    const strictPayload = JSON.parse(strictError.stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.reviewRequired, true);
    assert.equal(payload.strictOk, false);
    assert.equal(payload.mode, "safe-mode");
    assert.equal(payload.sources.ok, true);
    assert.equal(payload.sources.blockingWarnings.length > 0, true);
    assert.ok(payload.recommendations.includes("review high-risk runtime extension warnings before enabling automatic invocation"));
    assert.equal(strictError.code, 1);
    assert.equal(strictPayload.strictOk, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli doctor reports standalone runtime extension install units without blocking default status", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-doctor-standalone-runtime-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", root, "--no-scan-installed"]);
    await writeFile(
      configPath,
      `version: 1
skills: {}
workflows: {}
harnesses: {}
install_units:
  local.mcp:
    kind: mcp-server
    source: npx local-mcp
    scope: user-global
    enabled: true
    permission_risk: medium
`,
      "utf8"
    );

    const doctor = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", root, "--json"]);
    let strictError;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "status", "--dir", root, "--strict", "--json"]);
    } catch (caught) {
      strictError = caught;
    }
    const payload = JSON.parse(doctor.stdout);
    const strictPayload = JSON.parse(strictError.stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.reviewRequired, true);
    assert.equal(payload.strictOk, false);
    assert.deepEqual(payload.workspace.installUnits.runtimeExtensions, ["local.mcp"]);
    assert.equal(payload.workspace.installUnits.bySourceClass["runtime-extension"], 1);
    assert.match(payload.sources.blockingWarnings.join("\n"), /runtime extension source is unreviewed/);
    assert.equal(strictError.code, 1);
    assert.equal(strictPayload.strictOk, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli doctor verify refuses to hash source paths outside the project root", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-doctor-verify-root-test-"));
  try {
    const project = join(root, "project");
    const outsideSource = join(root, "outside-source");
    await mkdir(outsideSource, { recursive: true });
    await writeFile(join(outsideSource, "README.md"), "outside source\n", "utf8");
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", project, "--no-scan-installed"]);
    await writeFile(
      join(project, "skillboard.config.yaml"),
      `version: 1
skills: {}
workflows: {}
harnesses: {}
install_units:
  local.outside:
    kind: skill
    source: ${outsideSource}
    scope: project
    enabled: true
    trust_level: trusted
    permission_risk: low
`,
      "utf8"
    );

    let error;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "doctor", "--dir", project, "--verify", "--json"]);
    } catch (caught) {
      error = caught;
    }
    const payload = JSON.parse(error.stdout);

    assert.equal(error.code, 1);
    assert.equal(payload.sources.ok, false);
    assert.match(payload.sources.errors.join("\n"), /outside the allowed root/);
    assert.equal(payload.sources.units[0].actualDigest, null);
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

test("cli impact disable --json writes a machine-readable payload", async () => {
  const result = await execFileAsync(process.execPath, [
    "bin/skillboard.mjs",
    "impact",
    "disable",
    "matt.tdd",
    "--config",
    "examples/skillboard.config.yaml",
    "--skills",
    "examples/skills",
    "--json"
  ]);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.skillId, "matt.tdd");
  assert.equal(payload.exists, true);
  assert.equal(payload.risk, "medium");
  assert.deepEqual(payload.affectedWorkflows, ["codex-night-workflow"]);
  assert.deepEqual(payload.affectedOutputs, ["diff_summary", "test_result_or_reason", "risk_notes"]);
  assert.deepEqual(payload.alternatives, ["meerkat.test-first-implementation"]);
});

test("cli init scans installed local user skills into manual workflow state", async () => {
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

    const env = testAgentEnv(home, { CODEX_HOME: codexHome });
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
    const localUse = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "can-use",
      "local-helper",
      "--workflow",
      "codex-local-manual",
      "--config",
      configPath,
      "--skills",
      join(project, "skills"),
      "--json"
    ], { env });
    const localUsePayload = JSON.parse(localUse.stdout);

    assert.match(init.stdout, /Scanned installed agent skills: 3/);
    assert.match(init.stdout, /Managed install units: 3/);
    assert.match(init.stdout, /Added workflows: `codex-local-manual`/);
    assert.match(init.stdout, /Added harnesses: `codex`/);
    assert.match(init.stdout, /Added managed skills: 3/);
    assert.match(init.stdout, /- `local-helper`/);
    assert.match(init.stdout, /Skill selection default:/);
    assert.match(init.stdout, /No automatic model invocation was enabled/);
    assert.match(init.stdout, /Imported local skills are available on request in generated local policy/);
    assert.match(init.stdout, /Runtime\/plugin\/system skills require source review before automatic invocation/);
    assert.match(init.stdout, /automatic skills enabled/);
    assert.match(init.stdout, /manual-only skills available/);
    assert.match(init.stdout, /blocked\/quarantined for safety/);
    assert.match(init.stdout, /Next:/);
    assert.match(init.stdout, /Ask your AI: "What skills can you use in this project\?"/);
    assertInitNextCommand(init.stdout, "doctor", project, " --summary");
    assert.match(init.stdout, /Choose a workflow: `codex-local-manual`/);
    assert.match(init.stdout, /Example workflow brief: `codex-local-manual`/);
    assertInitNextWorkflowCommand(init.stdout, "codex-local-manual", project);
    assert.match(init.stdout, /Example task routing: "write tests before implementation"/);
    assertInitNextWorkflowIntentCommand(init.stdout, "codex-local-manual", project);
    assert.match(config, /system-helper:/);
    assert.match(config, /local-helper:/);
    assert.match(config, /demo:review:/);
    assert.match(config, /status: quarantined/);
    assert.match(config, /invocation: blocked/);
    assert.match(config, /local-helper:\n\s+path: local-helper\n\s+status: active\n\s+invocation: manual-only/);
    assert.match(config, /codex-local-manual:\n\s+harness: codex\n\s+active_skills:\n\s+- local-helper/);
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
    assert.equal(localUsePayload.allowed, true);
    assert.equal(localUsePayload.automaticAllowed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli init scanned local skills remain routable by SKILL description metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-route-metadata-test-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const codexHome = join(home, ".codex");
    await mkdir(join(codexHome, "skills", "test-first"), { recursive: true });
    await mkdir(join(codexHome, "skills", "docs-writer"), { recursive: true });
    await writeFile(
      join(codexHome, "skills", "test-first", "SKILL.md"),
      "---\nname: test-first\ndescription: Write failing tests before implementation and keep a red green refactor loop.\n---\n# test-first\n",
      "utf8"
    );
    await writeFile(
      join(codexHome, "skills", "docs-writer", "SKILL.md"),
      "---\nname: docs-writer\ndescription: Write install guides, README copy, and quick starts.\n---\n# docs-writer\n",
      "utf8"
    );

    const env = testAgentEnv(home, { CODEX_HOME: codexHome });
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", project], { env });
    const configPath = join(project, "skillboard.config.yaml");
    const skillsRoot = join(project, "skills");
    const brief = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "brief",
      "--intent",
      "write failing tests before implementation",
      "--workflow",
      "codex-local-manual",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--json"
    ], { env });
    const payload = JSON.parse(brief.stdout);

    assert.equal(payload.assistant_guidance.route.match_source, "skill-metadata");
    assert.equal(payload.assistant_guidance.route.recommended_skill, "test-first");
    assert.ok(payload.assistant_guidance.route.matched_terms.includes("implementation"));
    assert.ok(payload.assistant_guidance.route.matched_terms.includes("failing"));
    assert.match(payload.assistant_guidance.route.recommendation_reason, /SKILL\.md description/);
    assert.equal(payload.assistant_guidance.route.guard_allowed, true);

    const textBrief = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "brief",
      "--intent",
      "write failing tests before implementation",
      "--workflow",
      "codex-local-manual",
      "--config",
      configPath,
      "--skills",
      skillsRoot
    ], { env });
    assert.match(
      textBrief.stdout,
      /Why: Matched workflow skill metadata for test-first through .*SKILL\.md description .*recommended test-first because the guard allows test-first\./
    );
    assert.match(
      textBrief.stdout,
      /Disclosure: run the guard automatically, state at the start that `test-first` is being used, and state at completion that it was used\. No extra user approval is needed when the guard allows it\./
    );

    const unrelated = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "organize a team calendar",
      "--workflow",
      "codex-local-manual",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--json"
    ], { env });
    const unrelatedPayload = JSON.parse(unrelated.stdout);
    assert.equal(unrelatedPayload.match_source, "none");
    assert.equal(unrelatedPayload.recommended_skill, null);
    assert.deepEqual(unrelatedPayload.matched_terms, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli init scans Codex-visible .agents skills into manual workflow state", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-agents-root-test-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const agentsSkills = join(home, ".agents", "skills");
    await mkdir(join(agentsSkills, "test-first"), { recursive: true });
    await writeFile(
      join(agentsSkills, "test-first", "SKILL.md"),
      "---\nname: test-first\ndescription: Write failing tests before implementation.\n---\n# test-first\n",
      "utf8"
    );

    const env = testAgentEnv(home);
    delete env.CODEX_HOME;
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", project], { env });
    const configPath = join(project, "skillboard.config.yaml");
    const config = await readFile(configPath, "utf8");

    assert.match(config, /owner_install_unit: codex\.user-skills/);
    assert.match(config, /codex-local-manual:/);
    assert.match(config, /test-first/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli inventory refresh rescans installed skills and supports dry-run", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-inventory-refresh-test-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const codexHome = join(home, ".codex");
    await writeSkill(join(codexHome, "skills", "local-helper"), "local-helper");
    await mkdir(join(codexHome, "skills", "broken-helper"), { recursive: true });
    await writeFile(join(codexHome, "skills", "broken-helper", "SKILL.md"), "# missing frontmatter\n", "utf8");
    const env = testAgentEnv(home, { CODEX_HOME: codexHome });
    await execFileAsync(process.execPath, ["bin/skillboard.mjs", "init", "--dir", project, "--no-scan-installed"], { env });
    const before = await readFile(join(project, "skillboard.config.yaml"), "utf8");

    const dryRun = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "inventory",
      "refresh",
      "--dir",
      project,
      "--dry-run",
      "--json"
    ], { env });
    const afterDryRun = await readFile(join(project, "skillboard.config.yaml"), "utf8");
    const dryRunPayload = JSON.parse(dryRun.stdout);

    assert.equal(dryRunPayload.dryRun, true);
    assert.equal(dryRunPayload.changed, true);
    assert.equal(dryRunPayload.plan.semanticAvailable, true);
    assert.ok(dryRunPayload.plan.semanticChanges.some((change) => change.path === "/skills/local-helper"));
    assert.deepEqual(dryRunPayload.scan.addedSkills, ["local-helper"]);
    assert.deepEqual(dryRunPayload.scan.addedWorkflows, ["codex-local-manual"]);
    assert.deepEqual(dryRunPayload.scan.addedHarnesses, ["codex"]);
    assert.match(dryRunPayload.scan.warnings.join("\n"), /broken-helper[\\/]SKILL\.md skipped/);
    assert.equal(afterDryRun, before);

    const refresh = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "inventory",
      "refresh",
      "--dir",
      project
    ], { env });
    const config = await readFile(join(project, "skillboard.config.yaml"), "utf8");

    assert.match(refresh.stdout, /Inventory refreshed/);
    assert.match(refresh.stdout, /Semantic changes:/);
    assert.match(refresh.stdout, /Added skills: `local-helper`/);
    assert.match(refresh.stdout, /Added workflows: `codex-local-manual`/);
    assert.match(refresh.stdout, /Added harnesses: `codex`/);
    assert.match(refresh.stdout, /Scan warnings: `.*broken-helper[\\/]SKILL\.md skipped/);
    assert.match(config, /local-helper:/);
    assert.match(config, /status: active/);
    assert.match(config, /invocation: manual-only/);
    assert.match(config, /codex-local-manual:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli init scans Hermes profile skills into canonical manual workflow state", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-hermes-init-scan-test-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const hermesHome = join(home, ".hermes");
    await writeSkill(join(hermesHome, "profiles", "codex", "skills", "apple-notes"), "apple-notes");
    await writeSkill(join(hermesHome, "profiles", "codex", "skills", "software", "review"), "software-review");

    const env = testAgentEnv(home, { HERMES_HOME: hermesHome });
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

    assert.match(init.stdout, /Scanned installed agent skills: 2/);
    assert.match(init.stdout, /Managed install units: 1/);
    assert.match(init.stdout, /Added workflows: `hermes-codex-local-manual`/);
    assert.match(init.stdout, /Added harnesses: `hermes`/);
    assert.match(config, /apple-notes:\n\s+path: apple-notes\n\s+status: active\n\s+invocation: manual-only/);
    assert.match(config, /software-review:\n\s+path: software\/review\n\s+status: active\n\s+invocation: manual-only/);
    assert.match(config, /owner_install_unit: hermes\.profile\.codex\.skills/);
    assert.match(config, /hermes-codex-local-manual:\n\s+harness: hermes\n\s+active_skills:\n\s+- apple-notes\n\s+- software-review/);
    assert.match(check.stdout, /Policy check passed/);
    assert.doesNotMatch(check.stdout, /SKILL-STATUS-001/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli init keeps duplicate skill ids canonical and records source aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-duplicate-skill-alias-test-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const codexHome = join(home, ".codex");
    const hermesHome = join(home, ".hermes");
    await writeSkill(join(codexHome, "skills", "airtable"), "airtable");
    await writeSkill(join(hermesHome, "profiles", "codex", "skills", "airtable"), "airtable");

    const env = testAgentEnv(home, { CODEX_HOME: codexHome, HERMES_HOME: hermesHome });
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

    assert.match(init.stdout, /Scanned installed agent skills: 2/);
    assert.match(init.stdout, /Added managed skills: 1/);
    assert.match(config, /^  airtable:\n\s+path: airtable\n\s+status: active\n\s+invocation: manual-only/m);
    assert.match(config, /owner_install_unit: codex\.user-skills/);
    assert.match(config, /source_aliases:\n\s+- owner_install_unit: hermes\.profile\.codex\.skills\n\s+path: airtable/);
    assert.doesNotMatch(config, /airtable-2:/);
    assert.match(config, /codex-local-manual:\n\s+harness: codex\n\s+active_skills:\n\s+- airtable/);
    assert.match(config, /hermes-codex-local-manual:\n\s+harness: hermes\n\s+active_skills:\n\s+- airtable/);
    assert.match(check.stdout, /Policy check passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli inventory refresh preserves existing workflows when importing local skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-inventory-existing-workflow-test-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const codexHome = join(home, ".codex");
    const configPath = join(project, "skillboard.config.yaml");
    await mkdir(project, { recursive: true });
    await writeSkill(join(codexHome, "skills", "local-helper"), "local-helper");
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills: {}
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills: []
    blocked_skills: []
install_units: {}
`,
      "utf8"
    );
    const env = testAgentEnv(home, { CODEX_HOME: codexHome });
    const refresh = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "inventory",
      "refresh",
      "--dir",
      project,
      "--json"
    ], { env });
    const payload = JSON.parse(refresh.stdout);
    const config = await readFile(configPath, "utf8");

    assert.deepEqual(payload.scan.addedSkills, ["local-helper"]);
    assert.deepEqual(payload.scan.addedWorkflows, []);
    assert.deepEqual(payload.scan.addedHarnesses, []);
    assert.match(payload.scan.reviewNotes.join("\n"), /manual-only candidate/);
    assert.match(config, /daily-workflow:/);
    assert.doesNotMatch(config, /codex-local-manual/);
    assert.match(config, /local-helper:\n\s+path: local-helper\n\s+status: candidate\n\s+invocation: manual-only/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli sources refresh fetches git sources and updates digest pins", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-source-refresh-test-"));
  try {
    const project = join(root, "project");
    const repo = join(root, "remote-repo");
    await mkdir(project, { recursive: true });
    await mkdir(repo, { recursive: true });
    await writeFile(join(repo, "README.md"), "remote source\n", "utf8");
    await execFileAsync("git", ["-C", repo, "init"]);
    await execFileAsync("git", ["-C", repo, "add", "README.md"]);
    await execFileAsync("git", ["-C", repo, "-c", "user.email=test@example.test", "-c", "user.name=SkillBoard Test", "commit", "-m", "init"]);
    const configPath = join(project, "skillboard.config.yaml");
    await writeFile(
      configPath,
      `version: 1
skills: {}
workflows: {}
harnesses: {}
install_units:
  remote.pack:
    kind: marketplace
    source: git clone file://${repo}
    scope: user-global
    enabled: true
    permission_risk: low
`,
      "utf8"
    );
    const before = await readFile(configPath, "utf8");

    const dryRun = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "sources",
      "refresh",
      "--dir",
      project,
      "--dry-run",
      "--json"
    ]);
    const dryRunPayload = JSON.parse(dryRun.stdout);

    assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal(dryRunPayload.dryRun, true);
    assert.equal(dryRunPayload.refreshed[0].id, "remote.pack");
    assert.ok(dryRunPayload.plan.semanticChanges.some((change) => change.path === "/install_units/remote.pack/source_digest"));

    const refresh = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "sources",
      "refresh",
      "--dir",
      project
    ]);
    const config = await readFile(configPath, "utf8");
    const audit = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "audit",
      "sources",
      "--verify",
      "--config",
      configPath,
      "--skills",
      join(project, "skills"),
      "--json"
    ]);
    const auditPayload = JSON.parse(audit.stdout);

    assert.match(refresh.stdout, /Source pins refreshed/);
    assert.match(refresh.stdout, /Refreshed units: `remote.pack`/);
    assert.match(config, /cache_path: \.skillboard\/sources\/remote.pack/);
    assert.match(config, /source_digest: sha256:/);
    assert.equal(auditPayload.ok, true);
    assert.equal(auditPayload.units[0].digestVerified, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli inventory detect merges installer output and mutated config metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-install-detect-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const installLog = join(root, "install.log");
    const runtimeConfig = join(root, "config.json");
    await writeFile(
      configPath,
      "version: 1\nskills: {}\nworkflows: {}\nharnesses: {}\ninstall_units: {}\n",
      "utf8"
    );
    await writeFile(
      installLog,
      "Installed commands: $acme-run $acme-check\nRegistered hooks: post-tool-use\nConfigured MCP servers: acme_mcp\nUpdated config: config.json\n",
      "utf8"
    );
    await writeFile(
      runtimeConfig,
      JSON.stringify({
        commands: ["$acme-config"],
        hooks: ["pre-tool-use"],
        mcpServers: { acme_config_mcp: { command: "node" } }
      }),
      "utf8"
    );
    const before = await readFile(configPath, "utf8");
    const dryRun = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "inventory",
      "detect",
      "--config",
      configPath,
      "--unit",
      "acme.runtime",
      "--source",
      "npx acme install",
      "--install-output",
      installLog,
      "--config-file",
      runtimeConfig,
      "--dry-run",
      "--json"
    ]);
    const dryRunPayload = JSON.parse(dryRun.stdout);

    assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal(dryRunPayload.detected.commands.includes("$acme-run"), true);
    assert.equal(dryRunPayload.detected.hooks.includes("pre-tool-use"), true);
    assert.equal(dryRunPayload.detected.mcpServers.includes("acme_config_mcp"), true);
    assert.ok(dryRunPayload.plan.semanticChanges.some((change) => change.path === "/install_units/acme.runtime"));

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "inventory",
      "detect",
      "--config",
      configPath,
      "--unit",
      "acme.runtime",
      "--source",
      "npx acme install",
      "--install-output",
      installLog,
      "--config-file",
      runtimeConfig
    ]);
    const config = await readFile(configPath, "utf8");

    assert.match(result.stdout, /Detected install metadata: acme\.runtime/);
    assert.match(result.stdout, /MCP servers: .*`acme_config_mcp`/);
    assert.match(config, /acme\.runtime:/);
    assert.match(config, /provided_components:\n\s+- commands\n\s+- hook\n\s+- mcp-server/);
    assert.match(config, /commands:\n\s+- \$acme-check\n\s+- \$acme-config\n\s+- \$acme-run/);
    assert.match(config, /hooks:\n\s+- post-tool-use\n\s+- pre-tool-use/);
    assert.match(config, /mcp_servers:\n\s+- acme_config_mcp\n\s+- acme_mcp/);
    assert.match(config, /modified_config_files:/);
    assert.match(config, /permission_risk: high/);
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
  const allowedText = await execFileAsync(process.execPath, [
    "bin/skillboard.mjs",
    "can-use",
    "private.tdd-work-continuity",
    ...baseArgs,
    "--workflow",
    "codex-night-workflow"
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
  const allowedPayload = JSON.parse(allowed.stdout);
  assert.equal(allowedPayload.allowed, true);
  assert.equal(allowedPayload.automaticAllowed, false);
  assert.equal(allowedPayload.allowedUse.confirmationRequired, false);
  assert.equal(allowedPayload.allowedUse.startMessage, "I will use private.tdd-work-continuity for this request.");
  assert.equal(allowedPayload.allowedUse.finishMessage, "I used private.tdd-work-continuity for this request.");
  assert.match(allowedPayload.allowedUse.askUserWhen, /guard denies use or a policy-changing action is needed/);
  assert.match(allowedText.stdout, /Allowed use: disclose the skill at the start and completion; do not ask for another approval\./);
  assert.equal(deniedError.code, 2);
  assert.equal(JSON.parse(deniedError.stdout).allowed, false);
});

test("cli route recommends a workflow skill from user intent", async () => {
  const result = await execFileAsync(process.execPath, [
    "bin/skillboard.mjs",
    "route",
    "write tests before implementation",
    "--config",
    "examples/multi-source.config.yaml",
    "--skills",
    "examples/multi-source-skills",
    "--workflow",
    "codex-night-workflow",
    "--json"
  ]);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.intent, "write tests before implementation");
  assert.equal(payload.workflow, "codex-night-workflow");
  assert.equal(payload.matched_capability, "test-first-implementation");
  assert.equal(payload.match_source, "capability");
  assert.equal(payload.confidence, "high");
  assert.equal(payload.recommended_skill, "matt.tdd");
  assert.deepEqual(payload.fallback_skills, ["private.tdd-work-continuity"]);
  assert.ok(payload.matched_terms.includes("test"));
  assert.match(payload.recommendation_reason, /Matched capability test-first-implementation/);
  assert.match(payload.recommendation_reason, /guard allows matt\.tdd/);
  assert.ok(!payload.fallback_skills.includes("wshobson.python-testing"));
  assert.equal(payload.usage_disclosure.confirmation_required, false);
  assert.match(payload.usage_disclosure.start, /State at the start that matt\.tdd is being used/);
  assert.match(payload.usage_disclosure.finish, /remembered or configured policy preferred it over other allowed skills/);
  assert.equal(payload.usage_disclosure.start_message, "I will use matt.tdd for this request.");
  assert.equal(payload.usage_disclosure.finish_message, "I used matt.tdd for this request because SkillBoard has a remembered or configured preference for it; other allowed skills were also available: private.tdd-work-continuity.");
  assert.equal(payload.policy_memory.selected_skill, "matt.tdd");
  assert.match(payload.guard_command, /skillboard guard use matt\.tdd/);
  assert.match(payload.guard_command, /--workflow codex-night-workflow/);
  assert.equal(payload.guard.allowed, true);

  const text = await execFileAsync(process.execPath, [
    "bin/skillboard.mjs",
    "route",
    "write tests before implementation",
    "--config",
    "examples/multi-source.config.yaml",
    "--skills",
    "examples/multi-source-skills",
    "--workflow",
    "codex-night-workflow"
  ]);
  assert.match(text.stdout, /Match source: capability/);
  assert.match(text.stdout, /Why: Matched capability test-first-implementation/);
  assert.match(text.stdout, /Matched terms: `implementation`, `test`/);
  assert.match(text.stdout, /Disclosure: run the guard automatically, state at the start that matt\.tdd is being used/);
  assert.match(text.stdout, /Policy preference: Remembered or configured policy selected matt\.tdd/);
  assert.match(text.stdout, /Say before use: "I will use matt\.tdd for this request\."/);
  assert.match(text.stdout, /Say after completion: "I used matt\.tdd for this request because SkillBoard has a remembered or configured preference for it; other allowed skills were also available: private\.tdd-work-continuity\."/);
});

test("cli route accepts unquoted multi-word intent", async () => {
  const result = await execFileAsync(process.execPath, [
    "bin/skillboard.mjs",
    "route",
    "write",
    "tests",
    "before",
    "implementation",
    "--config",
    "examples/multi-source.config.yaml",
    "--skills",
    "examples/multi-source-skills",
    "--workflow",
    "codex-night-workflow",
    "--json"
  ]);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.intent, "write tests before implementation");
  assert.equal(payload.matched_capability, "test-first-implementation");
  assert.equal(payload.match_source, "capability");
  assert.equal(payload.recommended_skill, "matt.tdd");
});

test("cli route can recommend a workflow skill from SKILL description metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-route-description-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "release-notes"), { recursive: true });
    await writeFile(
      join(skillsRoot, "release-notes", "SKILL.md"),
      "---\nname: release-helper\ndescription: Draft release notes and changelog summaries.\n---\n# release-helper\n",
      "utf8"
    );
    await writeFile(
      configPath,
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  user.release-helper:
    path: release-notes
    status: active
    invocation: router-only
    exposure: exported
    category: writing
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - user.release-helper
    blocked_skills: []
install_units: {}
`,
      "utf8"
    );

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "summarize the changelog",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--json"
    ]);
    const explicitSkillResult = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "use user.release-helper for this request",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);
    const explicitSkillPayload = JSON.parse(explicitSkillResult.stdout);

    assert.equal(payload.matched_capability, null);
    assert.equal(payload.matched_skill, "user.release-helper");
    assert.equal(payload.match_source, "skill-metadata");
    assert.equal(payload.recommended_skill, "user.release-helper");
    assert.ok(payload.matched_terms.includes("changelog"));
    assert.match(payload.recommendation_reason, /Matched workflow skill metadata/);
    assert.match(payload.recommendation_reason, /SKILL\.md description/);
    assert.equal(payload.guard.allowed, true);
    assert.equal(explicitSkillPayload.matched_capability, null);
    assert.equal(explicitSkillPayload.matched_skill, "user.release-helper");
    assert.equal(explicitSkillPayload.match_source, "skill-metadata");
    assert.equal(explicitSkillPayload.recommended_skill, "user.release-helper");
    assert.ok(explicitSkillPayload.matched_terms.includes("release"));
    assert.equal(explicitSkillPayload.guard.allowed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli route with denied guard does not present no-approval disclosure", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-route-denied-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "user-test-first"), { recursive: true });
    await writeFile(
      join(skillsRoot, "user-test-first", "SKILL.md"),
      "---\nname: test-first\ndescription: Write tests before implementation.\n---\n# test-first\n",
      "utf8"
    );
    await writeFile(configPath, deniedRouteConfig(), "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "write tests before implementation",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.recommended_skill, "user.test-first");
    assert.equal(payload.guard.allowed, false);
    assert.equal(payload.usage_disclosure, null);
    assert.match(payload.guard.reasons.join("\n"), /blocks skill user\.test-first/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli route explains preferred denied fallback allowed decisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-route-fallback-clarity-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "vendor-test-first"), { recursive: true });
    await mkdir(join(skillsRoot, "user-tdd"), { recursive: true });
    await writeFile(
      join(skillsRoot, "vendor-test-first", "SKILL.md"),
      "---\nname: vendor-test-first\ndescription: Write tests before implementation.\n---\n# vendor-test-first\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "user-tdd", "SKILL.md"),
      "---\nname: user-tdd\ndescription: Write tests before implementation with local project conventions.\n---\n# user-tdd\n",
      "utf8"
    );
    await writeFile(configPath, preferredDeniedFallbackAllowedRouteConfig(), "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "write tests before implementation",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.matched_capability, "test-first-implementation");
    assert.equal(payload.recommended_skill, "user.tdd");
    assert.deepEqual(payload.fallback_skills, []);
    assert.equal(payload.guard.allowed, true);
    assert.deepEqual(payload.post_use_policy_suggestion, {
      timing: "after_use",
      mode: "ask_after_use",
      reason: "SkillBoard selected fallback user.tdd because preferred skill vendor.test-first is denied. After completing the task, ask whether to remember user.tdd as the preferred skill for test-first-implementation in daily-workflow.",
      question: "Should I remember user.tdd as the preferred skill for similar test-first-implementation requests in daily-workflow?",
      requires_confirmation: true,
      suggested_policy: {
        kind: "prefer-skill",
        skill: "user.tdd",
        workflow: "daily-workflow",
        capability: "test-first-implementation",
        command_hint: displayCommand([
          "skillboard", "prefer", "user.tdd",
          "--workflow", "daily-workflow",
          "--capability", "test-first-implementation",
          "--config", configPath,
          "--skills", skillsRoot
        ])
      }
    });
    assert.deepEqual(payload.route_candidates.map((candidate) => ({
      skill: candidate.skill,
      role: candidate.role,
      selected: candidate.selected,
      guard_allowed: candidate.guard_allowed
    })), [
      {
        skill: "vendor.test-first",
        role: "preferred",
        selected: false,
        guard_allowed: false
      },
      {
        skill: "user.tdd",
        role: "fallback",
        selected: true,
        guard_allowed: true
      }
    ]);
    assert.match(payload.route_candidates[0].guard_reasons.join("\n"), /unreviewed non-user source vendor\.skills/);

    const text = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "write tests before implementation",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow"
    ]);
    assert.match(text.stdout, /Route candidates:/);
    assert.match(text.stdout, /Fallback skills: none/);
    assert.match(text.stdout, /vendor\.test-first .*preferred, denied/);
    assert.match(text.stdout, /user\.tdd .*fallback, selected, allowed/);
    assert.match(text.stdout, /After completion: ask whether to remember user\.tdd as the preferred skill for similar test-first-implementation requests in daily-workflow\./);
    assert.match(text.stdout, /Policy command after confirmation: skillboard prefer user\.tdd --workflow daily-workflow --capability test-first-implementation/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI route renders ask-after preference after allowed ambiguity", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-route-ambiguous-allowed-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "user-tdd"), { recursive: true });
    await mkdir(join(skillsRoot, "private-tdd"), { recursive: true });
    await writeFile(
      join(skillsRoot, "user-tdd", "SKILL.md"),
      "---\nname: user-tdd\ndescription: Write tests before implementation with local project conventions.\n---\n# user-tdd\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "private-tdd", "SKILL.md"),
      "---\nname: private-tdd\ndescription: Keep TDD work continuous while writing tests before implementation.\n---\n# private-tdd\n",
      "utf8"
    );
    await writeFile(configPath, ambiguousAllowedRouteConfig(), "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "write tests before implementation",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.matched_capability, "test-first-implementation");
    assert.equal(payload.recommended_skill, "user.tdd");
    assert.equal(payload.guard.allowed, true);
    assert.equal(payload.usage_disclosure.confirmation_required, false);
    assert.deepEqual(payload.route_candidates.map((candidate) => ({
      skill: candidate.skill,
      role: candidate.role,
      selected: candidate.selected,
      guard_allowed: candidate.guard_allowed
    })), [
      {
        skill: "user.tdd",
        role: "preferred",
        selected: true,
        guard_allowed: true
      },
      {
        skill: "private.tdd-work-continuity",
        role: "fallback",
        selected: false,
        guard_allowed: true
      }
    ]);
    assert.equal(payload.post_use_policy_suggestion.timing, "after_use");
    assert.equal(payload.post_use_policy_suggestion.mode, "ask_after_use");
    assert.equal(payload.post_use_policy_suggestion.requires_confirmation, true);
    assert.match(payload.post_use_policy_suggestion.reason, /multiple allowed skills/);
    assert.deepEqual(payload.overlap_resolution, {
      status: "resolved",
      mode: "permissive-routing",
      selected_skill: "user.tdd",
      matched_skills: ["user.tdd", "private.tdd-work-continuity"],
      allowed_skills: ["user.tdd", "private.tdd-work-continuity"],
      denied_skills: [],
      summary: "Multiple allowed skills match test-first-implementation; SkillBoard keeps them available and routes daily-workflow to user.tdd."
    });
    assert.equal(
      payload.post_use_policy_suggestion.suggested_policy.command_hint,
      displayCommand([
        "skillboard", "prefer", "user.tdd",
        "--workflow", "daily-workflow",
        "--capability", "test-first-implementation",
        "--config", configPath,
        "--skills", skillsRoot
      ])
    );

    const text = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "write tests before implementation",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow"
    ]);
    assert.match(text.stdout, /user\.tdd .*preferred, selected, allowed/);
    assert.match(text.stdout, /private\.tdd-work-continuity .*fallback, allowed/);
    assert.match(text.stdout, /Overlap: Multiple allowed skills match test-first-implementation; SkillBoard keeps them available and routes daily-workflow to user\.tdd\./);
    assert.match(text.stdout, /Disclosure: run the guard automatically/);
    assert.match(text.stdout, /Say before use: "I will use user\.tdd for this request\."/);
    assert.match(text.stdout, /After completion: ask whether to remember user\.tdd as the preferred skill for similar test-first-implementation requests in daily-workflow\./);
    assert.match(text.stdout, /Policy command after confirmation: skillboard prefer user\.tdd --workflow daily-workflow --capability test-first-implementation/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli route uses skill metadata to break overlapping capability ties", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-route-overlap-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "vendor-test-first"), { recursive: true });
    await mkdir(join(skillsRoot, "user-tdd"), { recursive: true });
    await mkdir(join(skillsRoot, "docs-handoff"), { recursive: true });
    await writeFile(
      join(skillsRoot, "vendor-test-first", "SKILL.md"),
      "---\nname: vendor-test-first\ndescription: Complex routing bug fixes, tests, implementation slices, and review evidence.\n---\n# vendor-test-first\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "user-tdd", "SKILL.md"),
      "---\nname: user-tdd\ndescription: Local test-first routing bug fixes, regression tests, implementation slices, and review evidence.\n---\n# user-tdd\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "docs-handoff", "SKILL.md"),
      "---\nname: docs-handoff\ndescription: Handoff notes and resumable plan updates.\n---\n# docs-handoff\n",
      "utf8"
    );
    await writeFile(configPath, overlappingCapabilityRouteConfig(), "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "Fix a routing bug with tests, keep a handoff plan, and prepare review evidence",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--workflow",
      "daily-workflow",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.matched_capability, "test-first-implementation");
    assert.equal(payload.recommended_skill, "user.tdd");
    assert.equal(payload.guard.allowed, true);
    assert.ok(payload.matched_terms.includes("bug"));
    assert.ok(payload.matched_terms.includes("test"));
    assert.deepEqual(payload.route_candidates.map((candidate) => ({
      skill: candidate.skill,
      role: candidate.role,
      selected: candidate.selected,
      guard_allowed: candidate.guard_allowed
    })), [
      {
        skill: "vendor.test-first",
        role: "preferred",
        selected: false,
        guard_allowed: false
      },
      {
        skill: "user.tdd",
        role: "fallback",
        selected: true,
        guard_allowed: true
      }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli route returns clarification-friendly no-match JSON", async () => {
  const result = await execFileAsync(process.execPath, [
    "bin/skillboard.mjs",
    "route",
    "draw a logo",
    "--config",
    "examples/multi-source.config.yaml",
    "--skills",
    "examples/multi-source-skills",
    "--workflow",
    "codex-night-workflow",
    "--json"
  ]);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.matched_capability, null);
  assert.equal(payload.match_source, "none");
  assert.equal(payload.confidence, "none");
  assert.equal(payload.recommended_skill, null);
  assert.deepEqual(payload.matched_terms, []);
  assert.match(payload.recommendation_reason, /No workflow capability or skill metadata matched/);
  assert.equal(payload.guard_command, null);
  assert.ok(payload.possible_skills.some((skill) => skill.id === "matt.tdd"));
});

test("CLI route keeps no-match as clarification without post-use policy suggestion", async () => {
  const result = await execFileAsync(process.execPath, [
    "bin/skillboard.mjs",
    "route",
    "draw a logo",
    "--config",
    "examples/multi-source.config.yaml",
    "--skills",
    "examples/multi-source-skills",
    "--workflow",
    "codex-night-workflow",
    "--json"
  ]);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.match_source, "none");
  assert.equal(payload.recommended_skill, null);
  assert.equal(payload.guard_command, null);
  assert.equal(payload.usage_disclosure, null);
  assert.equal(payload.post_use_policy_suggestion, null);
  assert.equal(payload.overlap_resolution, null);
  assert.match(payload.recommendation_reason, /Ask a clarifying question/);
});

test("brief intent learns ask-after preference through explicit prefer command and ask-after routing end-to-end CLI smoke", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-ask-after-e2e-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "user-tdd"), { recursive: true });
    await mkdir(join(skillsRoot, "private-tdd"), { recursive: true });
    await writeFile(
      join(skillsRoot, "user-tdd", "SKILL.md"),
      "---\nname: user-tdd\ndescription: Write tests before implementation with local project conventions.\n---\n# user-tdd\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "private-tdd", "SKILL.md"),
      "---\nname: private-tdd\ndescription: Keep TDD work continuous while writing tests before implementation.\n---\n# private-tdd\n",
      "utf8"
    );
    await writeFile(configPath, ambiguousAllowedRouteConfig(), "utf8");
    const baseArgs = ["--config", configPath, "--skills", skillsRoot, "--workflow", "daily-workflow"];

    const route = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "write tests before implementation",
      ...baseArgs,
      "--json"
    ]);
    const routePayload = JSON.parse(route.stdout);
    assert.equal(routePayload.recommended_skill, "user.tdd");
    assert.equal(routePayload.post_use_policy_suggestion.suggested_policy.capability, "test-first-implementation");

    const brief = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "brief",
      "--intent",
      "write tests before implementation",
      ...baseArgs,
      "--json"
    ]);
    const briefPayload = JSON.parse(brief.stdout);
    const selectedSkill = briefPayload.assistant_guidance.route.recommended_skill;
    const matchedCapability = briefPayload.assistant_guidance.route.matched_capability;
    assert.equal(selectedSkill, "user.tdd");
    assert.equal(matchedCapability, "test-first-implementation");
    assert.equal(briefPayload.assistant_guidance.route.post_use_policy_suggestion.requires_confirmation, true);

    const guard = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "guard",
      "use",
      selectedSkill,
      ...baseArgs,
      "--json"
    ]);
    const guardPayload = JSON.parse(guard.stdout);
    assert.equal(guardPayload.allowed, true);
    assert.equal(guardPayload.allowedUse.confirmationRequired, false);
    assert.equal(guardPayload.allowedUse.startMessage, "I will use user.tdd for this request.");
    assert.equal(guardPayload.allowedUse.finishMessage, "I used user.tdd for this request.");

    const preference = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "prefer",
      selectedSkill,
      "--capability",
      matchedCapability,
      ...baseArgs,
      "--json"
    ]);
    const preferencePayload = JSON.parse(preference.stdout);
    assert.equal(preferencePayload.changed, true);
    assert.match(preferencePayload.message, /Preferred user\.tdd/);

    const secondBrief = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "brief",
      "--intent",
      "write tests before implementation",
      ...baseArgs,
      "--json"
    ]);
    const secondPayload = JSON.parse(secondBrief.stdout);
    assert.equal(secondPayload.assistant_guidance.route.recommended_skill, "user.tdd");
    assert.equal(secondPayload.assistant_guidance.route.post_use_policy_suggestion, null);
    assert.deepEqual(secondPayload.assistant_guidance.route.policy_memory, {
      status: "applied",
      mode: "remembered-or-configured-preference",
      selected_skill: "user.tdd",
      available_alternatives: ["private.tdd-work-continuity"],
      summary: "Remembered or configured policy selected user.tdd for test-first-implementation in daily-workflow; other allowed skills were also available: private.tdd-work-continuity.",
      finish_disclosure: "I used user.tdd for this request because SkillBoard has a remembered or configured preference for it; other allowed skills were also available: private.tdd-work-continuity."
    });
    assert.equal(
      secondPayload.assistant_guidance.route.usage_disclosure.finish_message,
      "I used user.tdd for this request because SkillBoard has a remembered or configured preference for it; other allowed skills were also available: private.tdd-work-continuity."
    );

    const reroute = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "route",
      "write tests before implementation",
      ...baseArgs,
      "--json"
    ]);
    const reroutePayload = JSON.parse(reroute.stdout);
    assert.equal(reroutePayload.recommended_skill, "user.tdd");
    assert.equal(reroutePayload.post_use_policy_suggestion, null);
    assert.equal(reroutePayload.policy_memory.selected_skill, "user.tdd");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief intent suppresses ask-after suggestions for no-match and guard-denied routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-ask-after-suppression-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "user-test-first"), { recursive: true });
    await writeFile(
      join(skillsRoot, "user-test-first", "SKILL.md"),
      "---\nname: user-test-first\ndescription: Write tests before implementation.\n---\n# user-test-first\n",
      "utf8"
    );
    await writeFile(configPath, deniedRouteConfig(), "utf8");
    const baseArgs = ["--config", configPath, "--skills", skillsRoot, "--workflow", "daily-workflow"];

    let denied;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "brief",
        "--intent",
        "write tests before implementation",
        ...baseArgs,
        "--json"
      ]);
    } catch (caught) {
      denied = caught;
    }
    assert.equal(denied.code, 1);
    const deniedPayload = JSON.parse(denied.stdout);
    assert.equal(deniedPayload.assistant_guidance.route.recommended_skill, "user.test-first");
    assert.equal(deniedPayload.assistant_guidance.route.guard_allowed, false);
    assert.equal(deniedPayload.assistant_guidance.route.usage_disclosure, null);
    assert.equal(deniedPayload.assistant_guidance.route.post_use_policy_suggestion, null);

    let noMatch;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "brief",
        "--intent",
        "draw a logo",
        ...baseArgs,
        "--json"
      ]);
    } catch (caught) {
      noMatch = caught;
    }
    assert.equal(noMatch.code, 1);
    const noMatchPayload = JSON.parse(noMatch.stdout);
    assert.equal(noMatchPayload.assistant_guidance.route.recommended_skill, null);
    assert.equal(noMatchPayload.assistant_guidance.route.guard_command, null);
    assert.equal(noMatchPayload.assistant_guidance.route.usage_disclosure, null);
    assert.equal(noMatchPayload.assistant_guidance.route.post_use_policy_suggestion, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli guard, brief, and impact surface active workflow conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-conflict-runtime-cli-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await writeSkill(join(skillsRoot, "alpha"), "skill.alpha");
    await writeSkill(join(skillsRoot, "beta"), "skill.beta");
    await writeFile(configPath, conflictRuntimeConfig(), "utf8");
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];

    let guardError;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "guard",
        "use",
        "skill.alpha",
        "--workflow",
        "daily-workflow",
        ...baseArgs,
        "--json"
      ]);
    } catch (error) {
      guardError = error;
    }
    assert.equal(guardError.code, 2);
    const guardPayload = JSON.parse(guardError.stdout);
    assert.equal(guardPayload.allowed, false);
    assert.equal(guardPayload.allowedUse, null);
    assert.match(guardPayload.reasons.join("\n"), /Skill skill\.alpha conflicts with active skill skill\.beta in workflow daily-workflow/);

    let briefError;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "brief",
        "--workflow",
        "daily-workflow",
        ...baseArgs,
        "--json"
      ]);
    } catch (error) {
      briefError = error;
    }
    assert.equal(briefError.code, 1);
    const briefPayload = JSON.parse(briefError.stdout);
    const alpha = briefPayload.skills.blocked.find((skill) => skill.id === "skill.alpha");
    assert.match(alpha.reason, /conflicts with active skill skill\.beta/);

    const impact = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "impact",
      "disable",
      "skill.alpha",
      ...baseArgs,
      "--json"
    ]);
    const impactPayload = JSON.parse(impact.stdout);
    assert.deepEqual(impactPayload.conflictingSkills, ["skill.beta"]);
    assert.deepEqual(impactPayload.activeConflicts, [
      {
        workflow: "daily-workflow",
        skill: "skill.alpha",
        conflictingSkill: "skill.beta"
      }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function deniedRouteConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  user.test-first:
    path: user-test-first
    status: active
    invocation: workflow-auto
    exposure: exported
    category: testing
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - user.test-first
    blocked_skills:
      - user.test-first
install_units: {}
`;
}

function preferredDeniedFallbackAllowedRouteConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  vendor.test-first:
    path: vendor-test-first
    status: active
    invocation: manual-only
    exposure: exported
    category: testing
    owner_install_unit: vendor.skills
  user.tdd:
    path: user-tdd
    status: active
    invocation: manual-only
    exposure: exported
    category: testing
capabilities:
  test-first-implementation:
    canonical: vendor.test-first
    alternatives:
      - user.tdd
    default_policy: manual-only
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - vendor.test-first
      - user.tdd
    blocked_skills: []
    required_capabilities:
      test-first-implementation:
        preferred: vendor.test-first
        fallback:
          - user.tdd
        policy: manual-only
install_units:
  vendor.skills:
    kind: marketplace
    source: npx skills add vendor/test-first
    scope: user-global
    provided_components:
      - skills
    components:
      skills:
        - vendor.test-first
    enabled: true
    trust_level: unreviewed
    permission_risk: medium
    rollback: reinstall
`;
}

function ambiguousAllowedRouteConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  user.tdd:
    path: user-tdd
    status: active
    invocation: manual-only
    exposure: exported
    category: testing
  private.tdd-work-continuity:
    path: private-tdd
    status: active
    invocation: manual-only
    exposure: exported
    category: testing
capabilities:
  test-first-implementation:
    canonical: user.tdd
    alternatives:
      - private.tdd-work-continuity
    default_policy: manual-only
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - user.tdd
      - private.tdd-work-continuity
    blocked_skills: []
install_units: {}
`;
}

function overlappingCapabilityRouteConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  vendor.test-first:
    path: vendor-test-first
    status: active
    invocation: manual-only
    exposure: exported
    category: engineering
    owner_install_unit: vendor.skills
  user.tdd:
    path: user-tdd
    status: active
    invocation: manual-only
    exposure: exported
    category: engineering
  user.docs-handoff:
    path: docs-handoff
    status: active
    invocation: manual-only
    exposure: exported
    category: handoff
capabilities:
  test-first-implementation:
    canonical: vendor.test-first
    alternatives:
      - user.tdd
    default_policy: manual-only
  handoff-continuity:
    canonical: user.docs-handoff
    alternatives: []
    default_policy: manual-only
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - vendor.test-first
      - user.tdd
      - user.docs-handoff
    blocked_skills: []
    required_capabilities:
      test-first-implementation:
        preferred: vendor.test-first
        fallback:
          - user.tdd
        policy: manual-only
      handoff-continuity:
        preferred: user.docs-handoff
        fallback: []
        policy: manual-only
install_units:
  vendor.skills:
    kind: marketplace
    source: npx skills add vendor/test-first
    scope: user-global
    provided_components:
      - skills
    components:
      skills:
        - vendor.test-first
    enabled: true
    trust_level: unreviewed
    permission_risk: medium
    rollback: reinstall
`;
}

function conflictRuntimeConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  skill.alpha:
    path: alpha
    status: active
    invocation: workflow-auto
    exposure: exported
    category: testing
    conflicts_with:
      - skill.beta
  skill.beta:
    path: beta
    status: active
    invocation: workflow-auto
    exposure: exported
    category: testing
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - daily-workflow
workflows:
  daily-workflow:
    harness: codex
    active_skills:
      - skill.alpha
      - skill.beta
    blocked_skills: []
install_units: {}
`;
}

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

test("cli variant add dry-run reports semantic changes without writing config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-add-dry-run-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await writeFile(configPath, variantAddCliConfig(), "utf8");
    const before = await readFile(configPath, "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "variant",
      "add",
      "claude.review",
      "--from",
      "base.review",
      "--capability",
      "task-review",
      "--workflow",
      "claude-workflow",
      "--path",
      "claude/review",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--dry-run",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);
    const semanticPaths = payload.plan.semanticChanges.map((change) => change.path);

    assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.changed, true);
    assert.equal(payload.plan.semanticAvailable, true);
    assert.ok(semanticPaths.includes("/skills/claude.review"));
    assert.ok(semanticPaths.includes("/capabilities/task-review/alternatives/base.review"));
    assert.ok(semanticPaths.includes("/capabilities/task-review/alternatives/claude.review"));
    assert.ok(semanticPaths.includes("/workflows/claude-workflow/required_capabilities/task-review/preferred"));
    assert.ok(semanticPaths.some((path) => path.startsWith("/workflows/claude-workflow/required_capabilities/task-review/fallback/")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli variant add writes config and preserves YAML comments", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-add-apply-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await writeFile(configPath, variantAddCliConfig(), "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "variant",
      "add",
      "claude.review",
      "--from",
      "base.review",
      "--capability",
      "task-review",
      "--workflow",
      "claude-workflow",
      "--path",
      "claude/review",
      "--mode",
      "router-only",
      "--category",
      "agent-bridge",
      "--config",
      configPath,
      "--skills",
      skillsRoot
    ]);
    const configText = await readFile(configPath, "utf8");
    const config = YAML.parse(configText);

    assert.match(result.stdout, /Added variant claude\.review for base\.review in claude-workflow/);
    assert.match(configText, /# variant add should preserve comments through control writes/);
    assert.deepEqual(config.skills["claude.review"], {
      path: "claude/review",
      status: "active",
      invocation: "router-only",
      exposure: "exported",
      category: "agent-bridge"
    });
    assert.deepEqual(config.capabilities["task-review"].alternatives, ["base.review", "claude.review"]);
    assert.equal(config.workflows["claude-workflow"].required_capabilities["task-review"].preferred, "claude.review");
    assert.deepEqual(
      config.workflows["claude-workflow"].required_capabilities["task-review"].fallback,
      ["old.review", "base.review", "canonical.review"]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli variant add preserves declared variant skill fields without path", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-add-existing-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await writeFile(configPath, variantAddCliConfig({
      variantSkill: `  claude.review:
    path: declared/claude-review
    status: active
    invocation: router-only
    exposure: private
    category: declared-category
`
    }), "utf8");

    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "variant",
      "add",
      "claude.review",
      "--from",
      "base.review",
      "--capability",
      "task-review",
      "--workflow",
      "claude-workflow",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--json"
    ]);
    const config = YAML.parse(await readFile(configPath, "utf8"));

    assert.deepEqual(config.skills["claude.review"], {
      path: "declared/claude-review",
      status: "active",
      invocation: "router-only",
      exposure: "private",
      category: "declared-category"
    });
    assert.equal(config.workflows["claude-workflow"].required_capabilities["task-review"].preferred, "claude.review");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli variant add requires path for undeclared variants without changing config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-add-missing-path-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await writeFile(configPath, variantAddCliConfig(), "utf8");
    const before = await readFile(configPath, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "variant",
        "add",
        "claude.review",
        "--from",
        "base.review",
        "--capability",
        "task-review",
        "--workflow",
        "claude-workflow",
        "--config",
        configPath,
        "--skills",
        skillsRoot
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /--path is required/);
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli variant add reports unknown base capability and workflow through control errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-add-unknown-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await writeFile(configPath, variantAddCliConfig(), "utf8");
    const before = await readFile(configPath, "utf8");
    const cases = [
      { override: ["--from", "missing.review"], message: /Unknown skill: missing\.review/ },
      { override: ["--capability", "missing-capability"], message: /Unknown capability: missing-capability/ },
      { override: ["--workflow", "missing-workflow"], message: /Unknown workflow: missing-workflow/ }
    ];

    for (const { override, message } of cases) {
      const args = [
        "bin/skillboard.mjs",
        "variant",
        "add",
        "claude.review",
        "--from",
        "base.review",
        "--capability",
        "task-review",
        "--workflow",
        "claude-workflow",
        "--path",
        "claude/review",
        "--config",
        configPath,
        "--skills",
        skillsRoot
      ];
      const optionIndex = args.indexOf(override[0]);
      args.splice(optionIndex, 2, ...override);

      let error;
      try {
        await execFileAsync(process.execPath, args);
      } catch (caught) {
        error = caught;
      }
      assert.equal(error.code, 1);
      assert.match(error.stderr, message);
      assert.equal(await readFile(configPath, "utf8"), before);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli variant add owner records a reviewed install unit component", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-add-owner-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await writeFile(configPath, variantAddCliConfig({
      installUnits: `install_units:
  user.local:
    kind: skill
    source: ./skills
    scope: project
    provided_components:
      - skills
    components:
      skills:
        - base.review
    enabled: true
    trust_level: reviewed
    permission_risk: low
`
    }), "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "variant",
      "add",
      "claude.review",
      "--from",
      "base.review",
      "--capability",
      "task-review",
      "--workflow",
      "claude-workflow",
      "--path",
      "claude/review",
      "--owner-install-unit",
      "user.local",
      "--mode",
      "manual-only",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);
    const config = YAML.parse(await readFile(configPath, "utf8"));

    assert.equal(payload.changed, true);
    assert.equal(config.skills["claude.review"].owner_install_unit, "user.local");
    assert.deepEqual(config.install_units["user.local"].components.skills, ["base.review", "claude.review"]);
    assert.equal(config.install_units["user.local"].trust_level, "reviewed");
    assert.equal(config.install_units["user.local"].enabled, true);
    assert.deepEqual(config.install_units["user.local"].provided_components, ["skills"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli variant add owner refuses an unknown install unit without changing config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-add-owner-unknown-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await writeFile(configPath, variantAddCliConfig(), "utf8");
    const before = await readFile(configPath, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "variant",
        "add",
        "claude.review",
        "--from",
        "base.review",
        "--capability",
        "task-review",
        "--workflow",
        "claude-workflow",
        "--path",
        "claude/review",
        "--owner-install-unit",
        "missing.unit",
        "--config",
        configPath,
        "--skills",
        skillsRoot
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /Unknown install unit: missing\.unit/);
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli variant add owner option preserves an existing variant owner fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-add-owner-existing-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await writeFile(configPath, variantAddCliConfig({
      variantSkill: `  claude.review:
    path: declared/claude-review
    status: active
    invocation: manual-only
    exposure: exported
    category: declared-category
    owner_install_unit: user.existing
`,
      installUnits: `install_units:
  user.existing:
    kind: skill
    source: ./existing
    scope: project
    provided_components:
      - skills
    components:
      skills:
        - claude.review
    enabled: true
    trust_level: reviewed
    permission_risk: low
  user.other:
    kind: skill
    source: ./other
    scope: project
    provided_components:
      - skills
    components:
      skills:
        - base.review
    enabled: true
    trust_level: trusted
    permission_risk: low
`
    }), "utf8");

    await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "variant",
      "add",
      "claude.review",
      "--from",
      "base.review",
      "--capability",
      "task-review",
      "--workflow",
      "claude-workflow",
      "--owner-install-unit",
      "user.other",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--json"
    ]);
    const config = YAML.parse(await readFile(configPath, "utf8"));

    assert.deepEqual(config.skills["claude.review"], {
      path: "declared/claude-review",
      status: "active",
      invocation: "manual-only",
      exposure: "exported",
      category: "declared-category",
      owner_install_unit: "user.existing"
    });
    assert.deepEqual(config.install_units["user.existing"].components.skills, ["claude.review"]);
    assert.deepEqual(config.install_units["user.other"].components.skills, ["base.review"]);
    assert.equal(config.workflows["claude-workflow"].required_capabilities["task-review"].preferred, "claude.review");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli variant add unreviewed non-user owner is refused and preserves config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-variant-add-unreviewed-owner-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const original = variantAddCliConfig({
      installUnits: `install_units:
  github.vendor.skills:
    kind: marketplace
    source: github.com/vendor/skills
    scope: project
    provided_components:
      - skills
    components:
      skills:
        - base.review
    enabled: true
    trust_level: unreviewed
    permission_risk: medium
`
    });
    await writeFile(configPath, original, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "variant",
        "add",
        "vendor.review",
        "--from",
        "base.review",
        "--capability",
        "task-review",
        "--workflow",
        "claude-workflow",
        "--path",
        "vendor/review",
        "--owner-install-unit",
        "github.vendor.skills",
        "--mode",
        "manual-only",
        "--config",
        configPath,
        "--skills",
        skillsRoot
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /Control update would not be usable|belongs to unreviewed non-user source|source github\.vendor\.skills is unreviewed/);
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli variant add inspection passes check and brief exposes the preferred workflow skill", async () => {
  await withAppliedVariantAddFixture("skillboard-variant-add-inspection-test-", async ({ configPath, skillsRoot }) => {
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];
    const check = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "check", ...baseArgs]);
    let brief;
    try {
      brief = await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "brief",
        "--workflow",
        "claude-workflow",
        ...baseArgs,
        "--json"
      ]);
    } catch (caught) {
      brief = caught;
    }
    const payload = JSON.parse(brief.stdout);
    const usable = [
      ...payload.skills.automatic_allowed,
      ...payload.skills.manual_allowed
    ];
    const variant = usable.find((skill) => skill.id === "claude.review");

    assert.match(check.stdout, /Policy check passed/);
    assert.equal(payload.health.policy.ok, true);
    assert.ok(variant, "expected claude.review in a usable brief group");
    assert.deepEqual(variant.advanced.workflow_roles, ["active", "preferred"]);
    assert.deepEqual(variant.advanced.capability_roles, [
      { capability: "task-review", role: "preferred", policy: "workflow-auto" }
    ]);
  });
});

test("cli variant add can-use allows the preferred active variant and denies blocked mutations", async () => {
  await withAppliedVariantAddFixture("skillboard-variant-add-can-use-test-", async ({ configPath, skillsRoot }) => {
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];
    const canUse = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "can-use",
      "claude.review",
      "--workflow",
      "claude-workflow",
      ...baseArgs,
      "--json"
    ]);
    const allowed = JSON.parse(canUse.stdout);

    assert.equal(allowed.allowed, true);
    assert.equal(allowed.automaticAllowed, true);
    assert.ok(allowed.roles.includes("active"));
    assert.ok(allowed.roles.includes("preferred"));
    assert.deepEqual(allowed.capabilityRoles, [
      { capability: "task-review", role: "preferred", policy: "workflow-auto" }
    ]);

    const config = YAML.parse(await readFile(configPath, "utf8"));
    config.workflows["claude-workflow"].blocked_skills.push("claude.review");
    await writeFile(configPath, YAML.stringify(config), "utf8");

    let checkError;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "check", ...baseArgs]);
    } catch (caught) {
      checkError = caught;
    }
    let blockedError;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "can-use",
        "claude.review",
        "--workflow",
        "claude-workflow",
        ...baseArgs,
        "--json"
      ]);
    } catch (caught) {
      blockedError = caught;
    }
    const blocked = JSON.parse(blockedError.stdout);

    assert.equal(checkError.code, 1);
    assert.equal(blockedError.code, 2);
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reasons.join("\n"), /blocks skill claude\.review|prefers blocked skill: claude\.review/);
  });
});

test("cli variant add explain reports capability alternative and workflow preferred state", async () => {
  await withAppliedVariantAddFixture("skillboard-variant-add-explain-test-", async ({ configPath, skillsRoot }) => {
    const explain = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "explain",
      "claude.review",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--json"
    ]);
    const payload = JSON.parse(explain.stdout);

    assert.ok(payload.capabilities.some((capability) => {
      return capability.name === "task-review" && capability.role === "alternative";
    }));
    assert.deepEqual(payload.workflows, [
      {
        workflow: "claude-workflow",
        roles: ["active", "preferred"],
        capabilityRoles: [
          { capability: "task-review", role: "preferred", policy: "workflow-auto" }
        ]
      }
    ]);
  });
});

test("cli variant add impact reports capability alternatives for the base skill", async () => {
  await withAppliedVariantAddFixture("skillboard-variant-add-impact-test-", async ({ configPath, skillsRoot }) => {
    const impact = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "impact",
      "disable",
      "base.review",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--json"
    ]);
    const payload = JSON.parse(impact.stdout);

    assert.equal(payload.skillId, "base.review");
    assert.ok(payload.alternatives.includes("claude.review"));
  });
});

test("cli variant add help shows public command usage", async () => {
  const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "--help"]);

  assert.match(result.stdout, /route <intent> --workflow <name>/);
  assert.match(result.stdout, /variant add <variant-id> --from <base-id> --capability <name> --workflow <name>/);
  assert.match(result.stdout, /\[--mode manual-only\|router-only\|workflow-auto\]/);
  assert.match(result.stdout, /\[--owner-install-unit <unit-id>\]/);
});

test("cli prefer refuses unusable unreviewed external skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-prefer-trust-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const original = `version: 1
skills:
  vendor.router:
    path: vendor/router
    status: active
    invocation: manual-only
    exposure: exported
    owner_install_unit: github.vendor.skills
capabilities:
  code-review:
    canonical: vendor.router
    alternatives: []
    default_policy: manual-only
workflows:
  review-workflow:
    harness: codex
    active_skills: []
    blocked_skills: []
    required_capabilities:
      code-review:
        preferred: ""
        fallback: []
        policy: manual-only
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
    assert.match(error.stderr, /unreviewed non-user source github\.vendor\.skills/);
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli prefer refuses reviewed blocked runtime skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-prefer-blocked-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const original = `version: 1
skills:
  omo.blocked:
    path: omo/blocked
    status: blocked
    invocation: blocked
    exposure: exported
    owner_install_unit: omo.runtime
capabilities:
  coding:
    canonical: omo.blocked
    alternatives: []
    default_policy: manual-only
workflows:
  review-workflow:
    harness: codex
    active_skills: []
    blocked_skills: []
    required_capabilities:
      coding:
        preferred: ""
        fallback: []
        policy: manual-only
harnesses:
  codex:
    status: primary
    workflows:
      - review-workflow
install_units:
  omo.runtime:
    kind: plugin
    source: ~/.codex/plugins/cache/sisyphuslabs/omo
    scope: user-global
    provided_components:
      - skills
      - hook
    components:
      skills:
        - omo.blocked
    enabled: true
    trust_level: reviewed
    permission_risk: high
`;
    await writeFile(configPath, original, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "prefer",
        "omo.blocked",
        "--workflow",
        "review-workflow",
        "--capability",
        "coding",
        "--config",
        configPath,
        "--skills",
        join(root, "skills")
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.equal(error.code, 1);
    assert.match(error.stderr, /status: blocked/);
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
    assert.equal(payload.plan.semanticAvailable, true);
    assert.ok(payload.plan.semanticChanges.some((change) => change.path.includes("/preferred")));
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

test("cli help documents the rollout operator command surface", async () => {
  const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "--help"]);

  assert.match(result.stdout, /rollout \[audit\|plan\|apply\|rollback\|report\]/);
  assert.match(result.stdout, /--json/);
});

test("cli rollout audit and plan expose non-interactive deterministic JSON without mutating files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-rollout-readiness-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(configPath, await readFile("examples/multi-source.config.yaml", "utf8"), "utf8");
    const before = await readFile(configPath, "utf8");
    const baseArgs = ["--dir", root, "--config", configPath, "--skills", "examples/multi-source-skills", "--json"];

    const audit = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "rollout", "audit", ...baseArgs]);
    const plan = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "rollout", "plan", ...baseArgs]);
    const auditPayload = JSON.parse(audit.stdout);
    const planPayload = JSON.parse(plan.stdout);

    assert.equal(await readFile(configPath, "utf8"), before);
    assert.equal(auditPayload.command, "rollout audit");
    assert.equal(auditPayload.status, "healthy");
    assert.equal(auditPayload.exitCode, 0);
    assert.equal(auditPayload.nonInteractive, true);
    assert.deepEqual(Object.keys(auditPayload.summary).sort(), ["blockingWarnings", "policyErrors", "sourceErrors", "sourceWarnings"].sort());
    assert.equal(planPayload.command, "rollout plan");
    assert.equal(planPayload.status, "healthy");
    assert.equal(planPayload.mutation.planned, false);
    assert.equal(planPayload.transaction.required, true);
    assert.equal(planPayload.paths.root, "[REDACTED]");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli rollout apply creates a transaction manifest and rollback restores exact config bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-rollout-transaction-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(configPath, await readFile("examples/multi-source.config.yaml", "utf8"), "utf8");
    const before = await readFile(configPath, "utf8");
    const baseArgs = ["--dir", root, "--config", configPath, "--skills", "examples/multi-source-skills", "--json"];

    const apply = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "rollout", "apply", ...baseArgs]);
    const applyPayload = JSON.parse(apply.stdout);
    const manifestPath = join(root, ".skillboard", "rollouts", applyPayload.transaction.id, "manifest.json");
    await writeFile(configPath, `${before}
# accidental operator edit
`, "utf8");
    const rollback = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "rollout", "rollback", ...baseArgs, "--transaction", applyPayload.transaction.id]);
    const rollbackPayload = JSON.parse(rollback.stdout);

    assert.equal(applyPayload.command, "rollout apply");
    assert.equal(applyPayload.status, "healthy");
    assert.equal(applyPayload.transaction.required, true);
    assert.equal(applyPayload.transaction.state, "committed");
    assert.match(applyPayload.transaction.id, /^rollout-/);
    assert.equal(JSON.stringify(applyPayload).includes(root), false);
    assert.equal(JSON.stringify(rollbackPayload).includes(root), false);
    assert.equal(await readFile(manifestPath, "utf8").then((payload) => JSON.parse(payload).files.length), 3);
    assert.equal(rollbackPayload.command, "rollout rollback");
    assert.equal(rollbackPayload.status, "healthy");
    assert.equal(rollbackPayload.transaction.state, "rolled-back");
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli rollout report classifies strict failures and redacts paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-rollout-report-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(
      configPath,
      `version: 1
skills:
  vendor.router:
    path: vendor/router
    status: active
    invocation: workflow-auto
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
    kind: plugin
    source: https://github.com/vendor/skills?token=***
    scope: project
    enabled: true
    trust_level: unreviewed
    permission_risk: high
`,
      "utf8"
    );

    let failure;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "rollout", "report", "--dir", root, "--config", configPath, "--skills", join(root, "skills"), "--json"]);
    } catch (caught) {
      failure = caught;
    }
    const payload = JSON.parse(failure.stdout);

    assert.equal(failure.code, 2);
    assert.equal(payload.command, "rollout report");
    assert.equal(payload.status, "strict-failed");
    assert.equal(payload.fleet.total, 1);
    assert.equal(payload.fleet.byStatus["strict-failed"], 1);
    assert.equal(payload.paths.root, "[REDACTED]");
    assert.equal(JSON.stringify(payload).includes(root), false);
    assert.equal(JSON.stringify(payload).includes("SECRET"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli rollout apply keeps status and fleet counters consistent when strict gates block apply", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-rollout-apply-failed-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(configPath, strictRolloutFixture(), "utf8");

    let failure;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "rollout", "apply", "--dir", root, "--config", configPath, "--skills", join(root, "skills"), "--json"]);
    } catch (caught) {
      failure = caught;
    }
    const payload = JSON.parse(failure.stdout);

    assert.equal(failure.code, 3);
    assert.equal(payload.status, "apply-failed");
    assert.equal(payload.exitCode, 3);
    assert.equal(payload.fleet.byStatus["apply-failed"], 1);
    assert.equal(payload.fleet.byStatus["strict-failed"], 0);
    assert.equal(JSON.stringify(payload).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli rollout rollback missing transaction returns redacted JSON failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-rollout-missing-rollback-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(configPath, await readFile("examples/multi-source.config.yaml", "utf8"), "utf8");

    let failure;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "rollout", "rollback", "--dir", root, "--config", configPath, "--skills", "examples/multi-source-skills", "--transaction", "rollout-missing", "--json"]);
    } catch (caught) {
      failure = caught;
    }
    const payload = JSON.parse(failure.stdout);

    assert.equal(failure.code, 4);
    assert.equal(failure.stderr, "");
    assert.equal(payload.command, "rollout rollback");
    assert.equal(payload.status, "rollback-needed");
    assert.equal(payload.exitCode, 4);
    assert.equal(payload.transaction.state, "rollback-needed");
    assert.equal(JSON.stringify(payload).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli rollout rollback rejects tampered manifests that point outside the transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-rollout-tamper-test-"));
  const victimPath = join(root, "..", `skillboard-rollout-victim-${Date.now()}.txt`);
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(configPath, await readFile("examples/multi-source.config.yaml", "utf8"), "utf8");
    await writeFile(victimPath, "do not overwrite", "utf8");
    const baseArgs = ["--dir", root, "--config", configPath, "--skills", "examples/multi-source-skills", "--json"];
    const apply = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "rollout", "apply", ...baseArgs]);
    const applyPayload = JSON.parse(apply.stdout);
    const manifestPath = join(root, ".skillboard", "rollouts", applyPayload.transaction.id, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files[0].path = victimPath;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    let failure;
    try {
      await execFileAsync(process.execPath, ["bin/skillboard.mjs", "rollout", "rollback", ...baseArgs, "--transaction", applyPayload.transaction.id]);
    } catch (caught) {
      failure = caught;
    }
    const payload = JSON.parse(failure.stdout);

    assert.equal(failure.code, 4);
    assert.equal(payload.status, "rollback-needed");
    assert.match(payload.errors.join("\n"), /manifest/i);
    assert.equal(await readFile(victimPath, "utf8"), "do not overwrite");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(victimPath, { force: true });
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

function strictRolloutFixture() {
  return `version: 1
skills:
  vendor.router:
    path: vendor/router
    status: active
    invocation: workflow-auto
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
    kind: plugin
    source: https://github.com/vendor/skills?token=***
    scope: project
    enabled: true
    trust_level: unreviewed
    permission_risk: high
`;
}

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
