import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import YAML from "yaml";

import { canUseSkill } from "../src/control/can-use-guard.mjs";
import { mergeV2InventoryPolicy } from "../src/inventory-json.mjs";
import { bridgeBlock, defaultConfig } from "../src/lifecycle-content.mjs";
import { routeSkill } from "../src/route.mjs";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../bin/skillboard.mjs", import.meta.url));

test("explicit legacy init writes minimal v2 policy and brief reports config version 2", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-init-contract-"));
  try {
    await run(["init", "--dir", root, "--no-scan-installed"]);
    const config = await readFile(join(root, "skillboard.config.yaml"), "utf8");
    assert.equal(config, "version: 2\nskills: {}\n");

    const brief = JSON.parse((await run(["brief", "--dir", root, "--json"])).stdout);
    assert.equal(brief.health.config.version, 2);
    assert.equal(brief.compatibility, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup creates home state and reaches guard from a project without init", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-setup-first-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const codexHome = join(home, ".codex");
    await mkdir(join(codexHome, "skills", "demo"), { recursive: true });
    await mkdir(project, { recursive: true });
    await cp("examples/skills/tdd/SKILL.md", join(codexHome, "skills", "demo", "SKILL.md"));
    const env = { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome };

    await run(["setup", "--yes", "--agent", "codex"], env);
    const brief = JSON.parse((await run([
      "brief", "--agent", "codex", "--intent", "write tests before implementation", "--json"
    ], env, project)).stdout);
    const guard = JSON.parse((await run([
      "guard", "use", "tdd", "--agent", "codex", "--json"
    ], env)).stdout);

    assert.equal(brief.health.config.version, 2);
    assert.equal(brief.assistant_guidance.route.recommended_skill, "tdd");
    assert.equal(guard.allowed, true);
    await assert.rejects(readFile(join(project, "skillboard.config.yaml"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief rejects unknown options without printing a success payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-brief-options-"));
  try {
    await run(["init", "--dir", root, "--no-scan-installed"]);
    await assert.rejects(
      run(["brief", "--dir", root, "--unknown", "--json"]),
      (error) => error instanceof Error
        && "code" in error && error.code === 1
        && "stdout" in error && error.stdout === ""
        && "stderr" in error && typeof error.stderr === "string"
        && /Unknown brief option: --unknown/.test(error.stderr)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inventory refresh rejects unknown options before bootstrapping", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-inventory-options-"));
  try {
    await assert.rejects(
      run(["inventory", "refresh", "--dir", root, "--unknown", "--json"]),
      (error) => error instanceof Error
        && "code" in error && error.code === 1
        && "stdout" in error && error.stdout === ""
        && "stderr" in error && typeof error.stderr === "string"
        && /Unknown inventory refresh option: --unknown/.test(error.stderr)
    );
    await assert.rejects(readFile(join(root, "skillboard.config.yaml"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("default config contains no legacy authorization axes", () => {
  assert.equal(defaultConfig(), "version: 2\nskills: {}\n");
  assert.doesNotMatch(defaultConfig(), /status|invocation|exposure|trust/);
});

test("fresh init generated bridges equal the canonical bridge", async () => {
  const root = await freshRoot();
  try {
    const expected = `${bridgeBlock()}\n`;
    assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), expected);
    assert.equal(await readFile(join(root, "CLAUDE.md"), "utf8"), expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("valid v2 example passes the real check command", async () => {
  const result = await run(["check", "--config", "examples/v2-multi-source.config.yaml", "--skills", "examples/multi-source-skills"]);
  assert.match(result.stdout, /Policy check passed/);
});

test("invalid v2 example fails at the minimal policy boundary", async () => {
  await assert.rejects(
    run(["check", "--config", "examples/v2-policy-error.config.yaml", "--skills", "examples/multi-source-skills"]),
    (error) => error instanceof Error
      && "code" in error && error.code === 1
      && "stderr" in error && typeof error.stderr === "string"
      && /unsupported|shared|policy/i.test(error.stderr)
  );
});

test("main help exposes v2 core without legacy authorization vocabulary", async () => {
  const help = (await run(["help"])).stdout;
  const v2 = help.slice(help.indexOf("v2 AI/automation control loop:"));
  assert.match(v2, /enabled\/disabled and per-skill opt-in sharing/);
  assert.doesNotMatch(v2, /invocation|exposure|trust_level|quarantined|manual-only|router-only|workflow-auto/i);
});

test("brief accepts every documented v2 read option", async () => {
  const root = await freshRoot();
  try {
    const result = await run(["brief", "--dir", root, "--intent", "write tests", "--include-actions", "--verbose", "--json"]);
    assert.equal(JSON.parse(result.stdout).health.config.version, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inventory merge adds enabled local policy without overwriting existing sharing", () => {
  const original = "version: 2\nskills:\n  kept:\n    enabled: false\n    shared: true\n";
  const merged = mergeV2InventoryPolicy(original, {
    skills: [
      { id: "kept", path: "kept", ownerInstallUnit: "local" },
      { id: "new", path: "new", ownerInstallUnit: "local" }
    ]
  });
  const policy = YAML.parse(merged.text);
  assert.deepEqual(policy.skills.kept, { enabled: false, shared: true });
  assert.deepEqual(policy.skills.new, { enabled: true, shared: false });
});

test("fresh inventory refresh registers custom roots without claiming an agent installation", async () => {
  const root = await freshRoot();
  try {
    const skillsRoot = join(root, "skills");
    const codexHome = join(root, ".codex");
    const env = { HOME: root, USERPROFILE: root, CODEX_HOME: codexHome };
    await mkdir(join(skillsRoot, "demo"), { recursive: true });
    await mkdir(join(codexHome, "skills"), { recursive: true });
    await cp("examples/skills/tdd/SKILL.md", join(skillsRoot, "demo", "SKILL.md"));

    await run(["inventory", "refresh", "--dir", root, "--scan-root", skillsRoot, "--json"], env);
    const brief = JSON.parse((await run([
      "brief", "--dir", root, "--skills", skillsRoot,
      "--agent", "codex", "--intent", "write tests before implementation", "--json"
    ], env)).stdout);

    assert.equal(brief.skills.automatic_allowed.some(({ id }) => id === "tdd"), false);
    assert.equal(brief.skills.blocked.some(({ id }) => id === "tdd"), true);
    assert.equal(brief.skills.installed_only.some(({ id }) => id === "tdd"), false);
    assert.equal(brief.assistant_guidance.route.recommended_skill, null);
    await assert.rejects(run([
      "guard", "use", "tdd", "--agent", "codex", "--config", join(root, "skillboard.config.yaml"),
      "--skills", skillsRoot, "--json"
    ], env), (error) => error instanceof Error
      && "code" in error && error.code === 2
      && "stdout" in error && /not installed for agent codex/.test(String(error.stdout)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 guard allows enabled policy installed for the current agent", () => {
  assert.equal(canUseSkill(v2Workspace(), "global", undefined, "codex").allowed, true);
});

test("v2 guard denies an enabled skill absent from another agent", () => {
  assert.equal(canUseSkill(v2Workspace(), "scoped", undefined, "codex").allowed, true);
  assert.equal(canUseSkill(v2Workspace(), "scoped", undefined, "hermes").allowed, false);
});

test("v2 guard denies disabled policy regardless of preference", () => {
  assert.equal(canUseSkill(v2Workspace(), "disabled", undefined, "codex").allowed, false);
});

test("v2 preference ranks only enabled candidates installed for the current agent", () => {
  const route = routeSkill(v2Workspace(), { intent: "write tests", agent: "codex" });
  assert.equal(route.recommended_skill, "scoped");
  assert.equal(route.guard.allowed, true);
  assert.doesNotMatch(JSON.stringify(route.route_candidates), /disabled/);
});

test("explicit user selection wins among enabled installed candidates", () => {
  const route = routeSkill(v2Workspace(), { intent: "use global to write tests", agent: "codex" });
  assert.equal(route.recommended_skill, "global");
  assert.equal(route.match_source, "explicit-skill");
});

test("variant lifecycle docs label legacy modes compatibility-only", async () => {
  const text = await readFile("docs/variant-lifecycle.md", "utf8");
  assert.match(text, /Version 1 compatibility reference/);
  assert.match(text, /do not\s+authorize v2 availability/i);
});

test("rollout runbook treats source findings as informational", async () => {
  const text = await readFile("docs/rollout-runbook.md", "utf8");
  assert.match(text, /never change\s+availability/i);
  assert.match(text, /operator execution health, not skill availability/i);
});

test("all packaged markdown keeps runtime authorization outside policy", async () => {
  for (const file of ["README.md", "docs/policy-model.md", "docs/reference.md", "docs/positioning.md"]) {
    assert.match(await readFile(file, "utf8"), /Runtime and action authorization|Runtime\/action authorization|runtime and action\s+authorization/i);
  }
});

test("README value proof names executable v2 integration tests", async () => {
  const text = await readFile("docs/value-proof.md", "utf8");
  assert.match(text, /test\/v2-onboarding-behavior\.test\.mjs/);
  assert.match(text, /test\/v2-guard-route\.test\.mjs/);
});

test("migration docs preserve exact preview apply and rollback commands", async () => {
  const text = `${await readFile("README.md", "utf8")}\n${await readFile("docs/reference.md", "utf8")}`;
  assert.match(text, /skillboard migrate v2 --config <path> --json/);
  assert.match(text, /skillboard migrate v2 --config <path> --yes --json/);
  assert.match(text, /skillboard migrate v2 --config <path> --rollback <backup> --json/);
});

function run(args, env = {}, cwd = process.cwd()) {
  return execFileAsync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, ...env }
  });
}

async function freshRoot() {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-fresh-"));
  await run(["init", "--dir", root, "--no-scan-installed"]);
  return root;
}

function v2Workspace() {
  return {
    version: 2,
    inventory: {
      integrityErrors: [], skillIds: ["global", "scoped", "disabled"],
      skills: [
        { id: "global", installed_on: ["codex"] },
        { id: "scoped", installed_on: ["codex"] },
        { id: "disabled", installed_on: ["codex"] }
      ]
    },
    workflows: [],
    installedSkills: [
      { id: "global", name: "Global", description: "write tests", path: "global" },
      { id: "scoped", name: "Scoped", description: "write tests", path: "scoped" },
      { id: "disabled", name: "Disabled", description: "write tests", path: "disabled" }
    ],
    skills: [
      { id: "global", enabled: true, shared: false, preference: { intents: ["tests"], priority: 1 } },
      { id: "scoped", enabled: true, shared: false, preference: { intents: ["tests"], priority: 9 } },
      { id: "disabled", enabled: false, shared: false, preference: { intents: ["tests"], priority: 100 } }
    ]
  };
}
