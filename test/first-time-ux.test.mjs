import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { loadWorkspace } from "../src/index.mjs";
import { runInitCommand } from "../src/lifecycle-cli.mjs";
import { pathTailRegex } from "./helpers/path-pattern.mjs";

const execFileAsync = promisify(execFile);

const BIN = join(process.cwd(), "bin", "skillboard.mjs");

function testAgentEnv(home, overrides = {}) {
  return {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    HERMES_HOME: join(home, ".hermes"),
    CLAUDE_HOME: join(home, ".claude"),
    OPENCODE_HOME: join(home, ".config", "opencode"),
    SKILLBOARD_INIT_SCAN_ROOTS: "",
    ...overrides
  };
}

function withoutEnvKeys(env, keys) {
  const copy = { ...env };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
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

async function makeInitializedProject() {
  const root = await mkdtemp(join(tmpdir(), "skillboard-ux-test-"));
  await execFileAsync(process.execPath, [BIN, "init", "--dir", root, "--no-scan-installed"]);
  return {
    root,
    configPath: join(root, "skillboard.config.yaml"),
    skillsRoot: join(root, "skills"),
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("missing SKILL.md frontmatter explains what frontmatter should look like", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-frontmatter-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const badSkill = join(skillsRoot, "bad");
    await mkdir(badSkill, { recursive: true });
    await writeFile(join(badSkill, "SKILL.md"), "# Bad Skill\n", "utf8");
    await writeFile(
      configPath,
      `version: 1\nskills:\n  bad:\n    path: bad\n    status: candidate\n    invocation: manual-only\n    exposure: exported\n`,
      "utf8"
    );

    await assert.rejects(
      () => loadWorkspace({ configPath, skillsRoot }),
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /missing YAML frontmatter/);
        assert.match(message, /name:/);
        assert.match(message, /description:/);
        assert.match(message, /docs\/user-flow\.md/);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("add workflow without --harness suggests available harnesses", async () => {
  const project = await makeInitializedProject();
  try {
    await execFileAsync(process.execPath, [BIN, "add", "harness", "codex", "--config", project.configPath, "--skills", project.skillsRoot]);
    const { stderr } = await execFileAsync(process.execPath, [BIN, "add", "workflow", "daily", "--config", project.configPath, "--skills", project.skillsRoot]).catch((error) => error);

    assert.match(stderr, /--harness is required/);
    assert.match(stderr, /Available harnesses: codex/);
    assert.doesNotMatch(stderr, /Usage: skillboard add workflow.*--config.*--skills/);
  } finally {
    await project.cleanup();
  }
});

test("add workflow without --harness suggests adding a harness when none exist", async () => {
  const project = await makeInitializedProject();
  try {
    const { stderr } = await execFileAsync(process.execPath, [BIN, "add", "workflow", "daily", "--config", project.configPath, "--skills", project.skillsRoot]).catch((error) => error);

    assert.match(stderr, /--harness is required/);
    assert.match(stderr, /No harnesses are configured yet/);
  } finally {
    await project.cleanup();
  }
});

test("doctor --summary prints compact status", async () => {
  const project = await makeInitializedProject();
  try {
    const summary = await execFileAsync(process.execPath, [BIN, "doctor", "--summary", "--dir", project.root]);
    const full = await execFileAsync(process.execPath, [BIN, "doctor", "--dir", project.root]);

    assert.match(summary.stdout, /SkillBoard doctor:/);
    assert.match(summary.stdout, /Workspace:/);
    assert.match(summary.stdout, /Source audit:/);
    assert.match(summary.stdout, /Policy:/);
    assert.ok(summary.stdout.split("\n").length < full.stdout.split("\n").length, "summary should be shorter than full output");
  } finally {
    await project.cleanup();
  }
});

test("doctor --summary separates agent setup from project lifecycle for an uninitialized project", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-doctor-attach-"));
  try {
    const result = await execFileAsync(process.execPath, [BIN, "doctor", "--summary", "--dir", root]).catch((error) => error);

    assert.equal(result.code, 1);
    assert.match(result.stdout, /SkillBoard doctor: needs attention/);
    assert.match(result.stdout, /No local SkillBoard policy file was found in this directory/);
    assert.match(result.stdout, /project management belongs to the agent\/workspace layer/);
    assert.match(result.stdout, /run skillboard setup once per user\/agent install/i);
    assert.doesNotMatch(result.stdout, /skillboard init --dir/);
    assert.deepEqual(await readFile(join(root, "skillboard.config.yaml"), "utf8").catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup without confirmation explains the agent-layer boundary without mutating", async () => {
  const home = await mkdtemp(join(tmpdir(), "skillboard-setup-confirm-"));
  try {
    const result = await execFileAsync(process.execPath, [BIN, "setup", "--agent", "codex"], {
      cwd: home,
      env: testAgentEnv(home)
    }).catch((error) => error);

    assert.equal(result.code, 1);
    assert.match(result.stdout, /SkillBoard setup installs agent-layer integration, not project files/);
    assert.match(result.stdout, /Run with --yes to install agent-layer integration/);
    assert.match(result.stdout, /setup --agent codex --yes/);
    assert.equal(await readFile(join(home, ".codex", "skills", "skillboard", "SKILL.md"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(home, "skillboard.config.yaml"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(home, "AGENTS.md"), "utf8").catch(() => null), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("setup --yes installs agent-layer guidance without project initialization", async () => {
  const home = await mkdtemp(join(tmpdir(), "skillboard-setup-yes-"));
  try {
    const setup = await execFileAsync(process.execPath, [BIN, "setup", "--yes", "--agent", "codex,opencode"], {
      cwd: home,
      env: testAgentEnv(home)
    });
    const skill = await readFile(join(home, ".codex", "skills", "skillboard", "SKILL.md"), "utf8");
    const openCodeSkill = await readFile(join(home, ".config", "opencode", "skills", "skillboard", "SKILL.md"), "utf8");

    assert.match(setup.stdout, /SkillBoard agent integration installed/);
    assert.match(setup.stdout, /opencode:/);
    assert.doesNotMatch(setup.stdout, /skillboard init --dir/);
    assert.match(skill, /name: skillboard/);
    assert.match(skill, /SkillBoard Agent Integration/);
    assert.match(skill, /Installed user skills are usable by default/);
    assert.match(skill, /workflow priority/);
    assert.match(skill, /Do not ask for permission merely because you selected a skill/);
    assert.match(skill, /skillboard import-skill --from <source-agent> --to <this-agent>/);
    assert.match(skill, /needs-adaptation/);
    assert.equal(openCodeSkill, skill);
    assert.equal(await readFile(join(home, "skillboard.config.yaml"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(home, "AGENTS.md"), "utf8").catch(() => null), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("setup --yes detects Codex .agents skill roots without CODEX_HOME", async () => {
  const home = await mkdtemp(join(tmpdir(), "skillboard-setup-agents-root-"));
  try {
    const agentsSkills = join(home, ".agents", "skills");
    await mkdir(agentsSkills, { recursive: true });

    const setup = await execFileAsync(process.execPath, [BIN, "setup", "--yes"], {
      cwd: home,
      env: withoutEnvKeys(testAgentEnv(home), ["CODEX_HOME"])
    });
    const skill = await readFile(join(agentsSkills, "skillboard", "SKILL.md"), "utf8");

    assert.match(setup.stdout, /SkillBoard agent integration installed/);
    assert.match(setup.stdout, pathTailRegex(".agents", "skills", "skillboard", "SKILL.md"));
    assert.match(skill, /SkillBoard Agent Integration/);
    assert.equal(await readFile(join(home, ".codex", "skills", "skillboard", "SKILL.md"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(home, "skillboard.config.yaml"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(home, "AGENTS.md"), "utf8").catch(() => null), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("setup --yes creates Codex .agents skills root when .agents home exists", async () => {
  const home = await mkdtemp(join(tmpdir(), "skillboard-setup-agents-parent-"));
  try {
    const agentsHome = join(home, ".agents");
    const agentsSkill = join(agentsHome, "skills", "skillboard", "SKILL.md");
    await mkdir(agentsHome, { recursive: true });
    await mkdir(join(home, ".codex", "skills"), { recursive: true });

    const setup = await execFileAsync(process.execPath, [BIN, "setup", "--yes", "--agent", "codex"], {
      cwd: home,
      env: testAgentEnv(home)
    });
    const skill = await readFile(agentsSkill, "utf8");
    const codexSkill = await readFile(join(home, ".codex", "skills", "skillboard", "SKILL.md"), "utf8");

    assert.match(setup.stdout, /SkillBoard agent integration installed/);
    assert.match(setup.stdout, pathTailRegex(".agents", "skills", "skillboard", "SKILL.md"));
    assert.match(skill, /SkillBoard Agent Integration/);
    assert.equal(codexSkill, skill);
    assert.equal(await readFile(join(home, "skillboard.config.yaml"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(home, "AGENTS.md"), "utf8").catch(() => null), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("init next commands keep no-prompt npx spelling", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-npx-next-"));
  try {
    const output = [];
    await runInitCommand(
      new Map([
        ["dir", root],
        ["no-scan-installed", "true"]
      ]),
      { write: (chunk) => output.push(chunk) },
      {
        cwd: process.cwd(),
        entrypointPath: "/tmp/_npx/agent-skillboard/node_modules/.bin/skillboard",
        packageSpec: "agent-skillboard"
      }
    );

    const stdout = output.join("");
    assert.match(stdout, /npx --yes --package agent-skillboard skillboard doctor --dir .* --summary/);
    assert.match(stdout, /npx --yes --package agent-skillboard skillboard brief --dir /);
    assert.doesNotMatch(stdout, /npx agent-skillboard/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init summarizes large installed skill scans instead of printing the whole inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-compact-output-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const hermesSkills = join(home, ".hermes", "profiles", "codex", "skills");
    for (let index = 1; index <= 12; index += 1) {
      const skillId = `skill-${String(index).padStart(2, "0")}`;
      await writeSkill(join(hermesSkills, skillId), skillId);
    }

    const init = await execFileAsync(process.execPath, [BIN, "init", "--dir", project], {
      env: testAgentEnv(home)
    });

    assert.match(init.stdout, /Initialized SkillBoard:/);
    assert.match(init.stdout, /Scanned installed agent skills: 12/);
    assert.match(init.stdout, /Managed install units: 1/);
    assert.match(init.stdout, /Added workflows: `hermes-codex-local-manual`/);
    assert.match(init.stdout, /Added harnesses: `hermes`/);
    assert.match(init.stdout, /Added managed skills: 12/);
    assert.match(init.stdout, /- `skill-01`/);
    assert.match(init.stdout, /- `skill-05`/);
    assert.match(init.stdout, /- \.\.\. 7 more/);
    assert.doesNotMatch(init.stdout, /skill-12`/);
    assert.match(init.stdout, /Skill selection default:/);
    assert.match(init.stdout, /No automatic model invocation was enabled/);
    assert.match(init.stdout, /12 manual-only skills available/);
    assert.match(init.stdout, /Next:/);
    assert.match(init.stdout, /Ask your AI: "What skills can you use in this project\?"/);
    assertInitNextCommand(init.stdout, "doctor", project, " --summary");
    assert.match(init.stdout, /Choose a workflow: `hermes-codex-local-manual`/);
    assert.match(init.stdout, /Example workflow brief: `hermes-codex-local-manual`/);
    assertInitNextWorkflowCommand(init.stdout, "hermes-codex-local-manual", project);
    assert.match(init.stdout, /Example task routing: "write tests before implementation"/);
    assertInitNextWorkflowIntentCommand(init.stdout, "hermes-codex-local-manual", project);
    assertInitNextWorkflowCommand(init.stdout, "hermes-codex-local-manual", project, " --verbose");
    assert.doesNotMatch(init.stdout, /node bin\/skillboard\.mjs brief --dir .* --verbose/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init safety summary does not parse local SKILL.md files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-bad-local-skill-"));
  try {
    const badSkill = join(root, "skills", "bad");
    await mkdir(badSkill, { recursive: true });
    await writeFile(join(badSkill, "SKILL.md"), "# missing frontmatter\n", "utf8");

    const init = await execFileAsync(process.execPath, [BIN, "init", "--dir", root, "--no-scan-installed"]);

    assert.match(init.stdout, /Initialized SkillBoard:/);
    assert.match(init.stdout, /Skill selection default:/);
    assert.match(init.stdout, /0 automatic skills enabled/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init safety summary counts router-only skills separately", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-router-summary-"));
  try {
    await writeFile(
      join(root, "skillboard.config.yaml"),
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  router.helper:
    path: router-helper
    status: active
    invocation: router-only
    exposure: exported
capabilities: {}
harnesses: {}
workflows: {}
install_units: {}
`,
      "utf8"
    );

    const init = await execFileAsync(process.execPath, [BIN, "init", "--dir", root, "--no-scan-installed"]);

    assert.match(init.stdout, /Skill selection default:/);
    assert.match(init.stdout, /0 manual-only skills available/);
    assert.match(init.stdout, /1 router-only skills available/);
    assert.match(init.stdout, /0 blocked\/quarantined for safety/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init safety summary counts policy-valid legacy and canonical callable states", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-policy-summary-"));
  try {
    const skills = {
      "legacy.manual": { path: "legacy-manual", status: "active-manual", invocation: "manual-only", exposure: "exported" },
      "active.manual": { path: "active-manual", status: "active", invocation: "manual-only", exposure: "exported" },
      "legacy.router": { path: "legacy-router", status: "active-router", invocation: "router-only", exposure: "exported" },
      "legacy.auto": { path: "legacy-auto", status: "active-auto", invocation: "workflow-auto", exposure: "exported" },
      "canonical.workflow": { path: "canonical-workflow", status: "canonical", invocation: "workflow-auto", exposure: "exported" },
      "canonical.global": { path: "canonical-global", status: "canonical", invocation: "global-auto", exposure: "global-meta" },
      "quarantined.blocked": { path: "quarantined-blocked", status: "quarantined", invocation: "blocked", exposure: "exported" },
      "deprecated.removed": { path: "deprecated-removed", status: "deprecated", invocation: "deprecated", exposure: "exported" }
    };
    for (const [id, skill] of Object.entries(skills)) {
      await writeSkill(join(root, "skills", skill.path), id);
    }
    await writeFile(
      join(root, "skillboard.config.yaml"),
      `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
${Object.entries(skills).map(([id, skill]) => `  ${id}:
    path: ${skill.path}
    status: ${skill.status}
    invocation: ${skill.invocation}
    exposure: ${skill.exposure}`).join("\n")}
capabilities: {}
harnesses:
  codex:
    status: configured
    workflows:
    - daily
workflows:
  daily:
    harness: codex
    active_skills:
    - legacy.auto
    - canonical.workflow
    blocked_skills: []
    required_capabilities: {}
install_units: {}
`,
      "utf8"
    );

    const check = await execFileAsync(process.execPath, [BIN, "check", "--config", join(root, "skillboard.config.yaml"), "--skills", join(root, "skills")]);
    const init = await execFileAsync(process.execPath, [BIN, "init", "--dir", root, "--no-scan-installed"]);

    assert.match(check.stdout, /Policy check passed/);
    assert.match(init.stdout, /Skill selection default:/);
    assert.match(init.stdout, /3 automatic skills enabled/);
    assert.match(init.stdout, /2 manual-only skills available/);
    assert.match(init.stdout, /1 router-only skills available/);
    assert.match(init.stdout, /2 blocked\/quarantined for safety/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("commands default --skills to skills/ in cwd", async () => {
  const project = await makeInitializedProject();
  try {
    const check = await execFileAsync(process.execPath, [BIN, "check", "--config", "skillboard.config.yaml"], { cwd: project.root });
    assert.match(check.stdout, /Policy check passed/);

    const list = await execFileAsync(process.execPath, [BIN, "list", "skills", "--config", "skillboard.config.yaml"], { cwd: project.root });
    assert.match(list.stdout, /skills:/);
  } finally {
    await project.cleanup();
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
