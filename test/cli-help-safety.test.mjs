import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("direct source cli help renders AI-mediated help", async () => {
  const result = await runNode(["src/cli.mjs", "--help"]);

  assert.equal(result.code, 0, commandFailure(result));
  assert.match(result.stdout, /^SkillBoard - permissive AI skill overlap routing/m);
  assert.match(result.stdout, /After global install:/);
  assert.match(result.stdout, /npm install -g agent-skillboard/);
  assert.match(result.stdout, /sudo npm install -g agent-skillboard is also supported/);
  assert.match(result.stdout, /SUDO_USER's agent homes/);
  assert.match(result.stdout, /postinstall auto-runs agent-layer guidance setup on install and update/);
  assert.match(result.stdout, /Run skillboard setup later after adding another supported agent/);
  assert.match(result.stdout, /skillboard uninstall --user --dry-run before package removal/);
  assert.match(result.stdout, /skill forget <skill-id>/);
  assert.match(result.stdout, /import-skill --from <agent> --to <agent>/);
  const automationSection = result.stdout.slice(
    result.stdout.indexOf("Core AI/automation operations:"),
    result.stdout.indexOf("Legacy v1 project policy mode:")
  );
  for (const command of ["route <intent>", "can-use <skill-id>", "guard use <skill-id>"]) {
    assert.match(
      automationSection,
      new RegExp(`${command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[^\\n]*--agent[^\\n]*v2 policy[^\\n]*--workflow[^\\n]*v1 policy`, "i")
    );
  }
  assert.doesNotMatch(automationSection, /^\s+init /m);
  assert.match(result.stdout, /Legacy v1 project policy mode:/);
  assert.match(result.stdout, /init \[--dir <path>\]/);
  assert.match(result.stdout, /deprecated project-local policy bootstrap/i);
  assert.match(result.stdout, /opencode/);
  assert.match(result.stdout, /v2 AI\/automation control loop/);
  assert.doesNotMatch(result.stdout, /AI\/automation approval loop/);
  assert.match(result.stdout, /Optional preference ranks only and never changes availability/i);
  assert.match(result.stdout, /work without another approval/i);
  assert.match(result.stdout, /Runtime\/action authorization is outside SkillBoard/i);
  const v2Section = result.stdout.slice(result.stdout.indexOf("v2 AI/automation control loop:"));
  assert.doesNotMatch(v2Section, /\b(?:invocation|exposure|trust_level|quarantined|manual-only|router-only|workflow-auto)\b/i);
});

test("direct source cli unknown command points to help", async () => {
  const result = await runNode(["src/cli.mjs", "definitely-not-a-command"]);

  assert.equal(result.code, 1, commandFailure(result));
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command: definitely-not-a-command/);
  assert.match(result.stderr, /Run skillboard help for usage\./);
});

test("primary AI-loop commands expose safe command-local help", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-primary-help-"));
  try {
    const cases = [
      {
        args: ["bin/skillboard.mjs", "setup", "--agent", "codex", "--help"],
        usage: /^Usage: skillboard setup /m,
        forbidden: /SkillBoard agent integration installed/
      },
      {
        args: ["bin/skillboard.mjs", "import-skill", "--help"],
        usage: /^Usage: skillboard import-skill --from <agent> --to <agent>/m,
        forbidden: /Imported skill/
      },
      {
        args: ["bin/skillboard.mjs", "init", "--dir", root, "--help"],
        usage: /^Usage: skillboard init /m,
        forbidden: /Initialized SkillBoard/
      },
      {
        args: ["bin/skillboard.mjs", "doctor", "--dir", root, "--help"],
        usage: /^Usage: skillboard doctor /m,
        forbidden: /SkillBoard doctor:/
      },
      {
        args: ["bin/skillboard.mjs", "route", "--help"],
        usage: /^Usage: skillboard route <intent> --agent codex\|claude\|opencode\|hermes/m,
        forbidden: /Usage: skillboard route <intent> --agent codex\|claude\|opencode\|hermes\n$/
      },
      {
        args: ["bin/skillboard.mjs", "guard", "--help"],
        usage: /^Usage: skillboard guard use <skill-id> --agent codex\|claude\|opencode\|hermes/m,
        forbidden: /Usage: skillboard guard use <skill-id> --agent codex\|claude\|opencode\|hermes\n$/
      },
      {
        args: ["bin/skillboard.mjs", "can-use", "--help"],
        usage: /^Usage: skillboard can-use <skill-id> --agent codex\|claude\|opencode\|hermes/m,
        forbidden: /Usage: skillboard can-use <skill-id> --agent codex\|claude\|opencode\|hermes\n$/
      },
      {
        args: ["bin/skillboard.mjs", "apply-action", "--help"],
        usage: /^Usage: skillboard apply-action <action-id>/m,
        forbidden: /apply exactly one action at a time\.\n$/
      }
    ];

    for (const entry of cases) {
      const result = await runNode(entry.args);

      assert.equal(result.code, 0, commandFailure(result));
      assert.equal(result.stderr, "");
      assert.match(result.stdout, entry.usage);
      if (entry.args[1] === "uninstall") {
        assert.match(result.stdout, /--user/);
        assert.match(result.stdout, /marker-owned shared copies/i);
        assert.match(result.stdout, /--agent-layer/);
        assert.match(result.stdout, /--keep-settings/);
        assert.match(result.stdout, /Default project cleanup removes SkillBoard settings/i);
        assert.match(result.stdout, /preserves other agent skills/i);
      }
      if (entry.args[1] === "guard") {
        assert.match(result.stdout, /If allowed, disclose the skill at the start and completion; do not ask for another approval/i);
      }
      if (["route", "guard", "can-use"].includes(entry.args[1])) {
        assert.match(
          result.stdout,
          /--agent <name> \(v2 policy\) \| --workflow <name> \(v1 policy\)/i
        );
      }
      if (entry.args[1] === "init") {
        assert.match(result.stdout, /Deprecated project-local policy bootstrap/i);
        assert.match(result.stdout, /not needed for normal use/i);
        assert.match(result.stdout, /Normal flow/i);
        assert.doesNotMatch(result.stdout, /Use it once per project before asking the AI/i);
      }
      if (entry.args[1] === "doctor") {
        assert.match(result.stdout, /Checks the user-level policy and generated inventory health/i);
        assert.match(result.stdout, /running package and PATH-selected SkillBoard executable/i);
        assert.match(result.stdout, /does not execute PATH candidates/i);
        assert.doesNotMatch(result.stdout, /after init/i);
        assert.doesNotMatch(result.stdout, /SkillBoard project is ready/i);
      }
      if (entry.args[1] === "can-use") {
        assert.match(result.stdout, /If allowed, use the skill after the final guard check/i);
        assert.match(result.stdout, /disclose the skill at the start and completion; do not ask for another approval/i);
      }
      assert.doesNotMatch(result.stdout, entry.forbidden);
    }
    await assert.rejects(access(join(root, "skillboard.config.yaml")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("topic help exposes the route command without loading project config", async () => {
  const result = await runSkillboard(["help", "route"]);

  assert.equal(result.code, 0, commandFailure(result));
  assert.match(result.stdout, /^Usage: skillboard route <intent> --agent codex\|claude\|opencode\|hermes/m);
  assert.match(result.stdout, /Suggests the routed skill for a user request when several allowed skills may overlap/);
  assert.match(result.stdout, /If the guard allows use, disclose the skill at start and completion; do not ask for another approval/i);
  assert.match(result.stdout, /If policy memory would reduce ambiguity, ask after completion whether to remember the routed skill/i);
  assert.doesNotMatch(result.stdout, /^SkillBoard - permissive AI skill overlap routing$/m);
});

test("known secondary command help is non-mutating", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-secondary-help-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const agentPath = join(root, "AGENTS.md");
    await mkdir(join(root, "skills"), { recursive: true });
    await mkdir(join(root, ".skillboard", "profiles"), { recursive: true });
    await writeFile(configPath, "version: 1\nskills: {}\ninstall_units: {}\n", "utf8");
    await writeFile(agentPath, "keep me\n", "utf8");
    const originalConfig = await readFile(configPath, "utf8");
    const originalAgent = await readFile(agentPath, "utf8");

    const cases = [
      {
        args: ["bin/skillboard.mjs", "uninstall", "--dir", root, "--help"],
        usage: /^Usage: skillboard uninstall /m,
        forbidden: /Uninstalled SkillBoard/
      },
      {
        args: ["bin/skillboard.mjs", "inventory", "refresh", "--dir", root, "--config", configPath, "--help"],
        usage: /^Usage: skillboard inventory /m,
        forbidden: /Inventory refreshed:/
      },
      {
        args: ["bin/skillboard.mjs", "sources", "refresh", "--dir", root, "--config", configPath, "--help"],
        usage: /^Usage: skillboard sources /m,
        forbidden: /Source pins refreshed:/
      }
    ];

    for (const entry of cases) {
      const result = await runNode(entry.args);

      assert.equal(result.code, 0, commandFailure(result));
      assert.equal(result.stderr, "");
      assert.match(result.stdout, entry.usage);
      assert.doesNotMatch(result.stdout, entry.forbidden);
    }
    assert.equal(await readFile(configPath, "utf8"), originalConfig);
    assert.equal(await readFile(agentPath, "utf8"), originalAgent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("known secondary commands have read-only generic help", async () => {
  const commands = [
    "uninstall",
    "inventory",
    "sources",
    "import",
    "scan",
    "check",
    "list",
    "explain",
    "audit",
    "rollout",
    "hook",
    "lock",
    "review",
    "add",
    "variant",
    "activate",
    "block",
    "quarantine",
    "prefer",
    "remove",
    "dashboard",
    "reconcile",
    "impact"
  ];

  for (const command of commands) {
    const result = await runSkillboard([command, "--help"]);

    assert.equal(result.code, 0, `${command}\n${commandFailure(result)}`);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, new RegExp(`^Usage: skillboard ${command.replace("-", "\\-")}`, "m"));
    assert.match(result.stdout, /This help is read-only/);
  }
});

async function runSkillboard(args) {
  return await runNode(["bin/skillboard.mjs", ...args]);
}

async function runNode(args) {
  try {
    const result = await execFileAsync(process.execPath, args, { cwd: repoRoot });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

function commandFailure(result) {
  return `exit=${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}
