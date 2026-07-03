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
  assert.match(result.stdout, /^SkillBoard - AI-mediated workflow-scoped skill policy/m);
  assert.match(result.stdout, /After global install:/);
  assert.match(result.stdout, /npm install -g agent-skillboard/);
  assert.match(result.stdout, /sudo npm install -g agent-skillboard is also supported/);
  assert.match(result.stdout, /SUDO_USER's agent homes/);
  assert.match(result.stdout, /postinstall auto-runs agent-layer guidance setup on install and update/);
  assert.match(result.stdout, /Run skillboard setup later after adding another supported agent/);
  assert.match(result.stdout, /import-skill --from <agent> --to <agent>/);
  assert.match(result.stdout, /opencode/);
  assert.match(result.stdout, /AI\/automation control loop/);
  assert.doesNotMatch(result.stdout, /AI\/automation approval loop/);
  assert.match(result.stdout, /For an already-allowed skill, disclose the selected skill at start and completion/i);
  assert.match(result.stdout, /do not ask for another approval/i);
  assert.match(result.stdout, /apply-action re-resolves current actions/);
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
        usage: /^Usage: skillboard route <intent> --workflow <name>/m,
        forbidden: /Usage: skillboard route <intent> --workflow <name>\n$/
      },
      {
        args: ["bin/skillboard.mjs", "guard", "--help"],
        usage: /^Usage: skillboard guard use <skill-id> --workflow <name>/m,
        forbidden: /Usage: skillboard guard use <skill-id> --workflow <name>\n$/
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
  assert.match(result.stdout, /^Usage: skillboard route <intent> --workflow <name>/m);
  assert.match(result.stdout, /Suggests the best currently allowed skill/);
  assert.doesNotMatch(result.stdout, /^SkillBoard - AI-mediated workflow-scoped skill policy$/m);
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
    "can-use",
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
