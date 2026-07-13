import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { canUseSkill } from "../src/control/can-use-guard.mjs";
import { buildGeneratedInventory, mergeV2InventoryPolicy } from "../src/inventory-json.mjs";
import { loadWorkspace, serializeV2Policy } from "../src/workspace.mjs";
import { resolveUserStatePaths } from "../src/user-state-paths.mjs";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../bin/skillboard.mjs", import.meta.url));

test("v2 policy stores enabled plus opt-in sharing without workflow scope", async () => {
  await withFixture(async ({ configPath, inventoryPath }) => {
    await writeFile(configPath, `version: 2
skills:
  codex-only:
    enabled: true
    shared: false
  shared-test:
    enabled: true
    shared: true
    preference:
      intents: [tests]
      priority: 10
  disabled:
    enabled: false
    shared: false
`);
    await writeFile(inventoryPath, inventory([
      observed("codex-only", ["codex"]),
      observed("shared-test", ["codex", "hermes"]),
      observed("disabled", ["codex"])
    ]));

    const workspace = await loadWorkspace({ configPath, inventoryPath });
    assert.deepEqual(workspace.workflows, []);
    assert.deepEqual(workspace.skills, [
      { id: "codex-only", enabled: true, shared: false, preference: null },
      { id: "disabled", enabled: false, shared: false, preference: null },
      { id: "shared-test", enabled: true, shared: true, preference: { intents: ["tests"], priority: 10 } }
    ]);
    assert.equal(serializeV2Policy(workspace), `version: 2
skills:
  codex-only:
    enabled: true
    shared: false
  disabled:
    enabled: false
    shared: false
  shared-test:
    enabled: true
    shared: true
    preference:
      intents:
        - tests
      priority: 10
`);
  });
});

test("v2 guard uses enabled plus observed current-agent presence", () => {
  const workspace = {
    version: 2,
    workflows: [],
    skills: [
      { id: "local", enabled: true, shared: false, preference: null },
      { id: "shared", enabled: true, shared: true, preference: null },
      { id: "off", enabled: false, shared: false, preference: null }
    ],
    inventory: {
      integrityErrors: [],
      skillIds: ["local", "shared", "off"],
      skills: [observed("local", ["codex"]), observed("shared", ["codex", "hermes"]), observed("off", ["codex"])]
    }
  };

  assert.equal(canUseSkill(workspace, "local", undefined, "codex").allowed, true);
  assert.deepEqual(canUseSkill(workspace, "local", undefined, "hermes").reasons, [
    "Skill local is not installed for agent hermes."
  ]);
  assert.equal(canUseSkill(workspace, "shared", undefined, "hermes").allowed, true);
  assert.match(canUseSkill(workspace, "off", undefined, "codex").reasons.join("\n"), /disabled/);
});

test("generated inventory derives installed_on from owner and aliases", async () => {
  const generated = await buildGeneratedInventory({
    skills: [{
      id: "demo",
      path: "demo",
      ownerInstallUnit: "codex.user-skills",
      sourceAliases: [
        { ownerInstallUnit: "hermes.user-skills", path: "demo" },
        { ownerInstallUnit: "custom.vendor.skills", path: "demo" }
      ]
    }],
    installUnits: []
  });
  assert.deepEqual(generated.skills[0].installed_on, ["codex", "hermes"]);
});

test("newly observed skills default enabled but remain agent-local", () => {
  const merged = mergeV2InventoryPolicy("version: 2\nskills: {}\n", {
    skills: [{ id: "demo", path: "demo", ownerInstallUnit: "codex.user-skills" }]
  });
  assert.match(merged.text, /enabled: true/);
  assert.match(merged.text, /shared: false/);
  assert.doesNotMatch(merged.text, /scope:|workflows:/);
});

test("default state paths are user-level and independent of cwd", () => {
  const home = resolve("fixture-home");
  const first = resolveUserStatePaths({ home, cwd: resolve("project-a") });
  const second = resolveUserStatePaths({ home, cwd: resolve("project-b") });
  assert.deepEqual(first, second);
  assert.equal(first.configPath, join(home, "skillboard.config.yaml"));
  assert.equal(first.inventoryPath, join(home, ".skillboard", "inventory.json"));
});

test("setup creates one home control plane and normal commands never initialize projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-home-flow-"));
  const home = join(root, "home");
  const projectA = join(root, "project-a");
  const projectB = join(root, "project-b");
  const codexHome = join(home, ".codex");
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome };
  try {
    await mkdir(join(codexHome, "skills", "demo"), { recursive: true });
    await mkdir(projectA);
    await mkdir(projectB);
    await writeFile(join(codexHome, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Review code and tests.\n---\n");

    await execFileAsync(process.execPath, [CLI, "setup", "--agent", "codex", "--yes"], { cwd: projectA, env });
    const config = await readFile(join(home, "skillboard.config.yaml"), "utf8");
    assert.match(config, /demo:/);
    assert.match(config, /shared: false/);

    const first = JSON.parse((await execFileAsync(process.execPath, [
      CLI, "brief", "--agent", "codex", "--intent", "review code and tests", "--json"
    ], { cwd: projectA, env })).stdout);
    const second = JSON.parse((await execFileAsync(process.execPath, [
      CLI, "brief", "--agent", "codex", "--intent", "review code and tests", "--json"
    ], { cwd: projectB, env })).stdout);
    assert.equal(first.assistant_guidance.route.recommended_skill, "demo");
    assert.equal(second.assistant_guidance.route.recommended_skill, "demo");
    await assert.rejects(readFile(join(projectA, "skillboard.config.yaml")), /ENOENT/);
    await assert.rejects(readFile(join(projectB, "skillboard.config.yaml")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup registers a late custom agent root and reconciles existing shared skills idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-late-custom-agent-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const customHermesRoot = join(home, "agent-homes", "hermes", "skills");
  const env = withoutEnvKeys({
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome
  }, ["HERMES_HOME"]);
  try {
    await mkdir(join(codexHome, "skills", "demo"), { recursive: true });
    await writeFile(join(codexHome, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Portable testing workflow.\n---\n");
    await execFileAsync(process.execPath, [CLI, "setup", "--agent", "codex", "--yes"], { env });
    await execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--json"], { env });

    const first = await execFileAsync(process.execPath, [
      CLI, "setup", "--agent", "hermes", "--skill-root", customHermesRoot, "--yes"
    ], { env });
    const registry = JSON.parse(await readFile(join(home, ".skillboard", "agent-roots.json"), "utf8"));
    assert.deepEqual(registry.roots, [{ agent: "hermes", path: "agent-homes/hermes/skills" }]);
    assert.match(first.stdout, /Registered agent roots: 1/);
    assert.match(first.stdout, /Created shared copies: 1/);
    assert.match(await readFile(join(customHermesRoot, "demo", "SKILL.md"), "utf8"), /Portable testing workflow/);

    await rm(join(home, ".hermes", "skills", "demo"), { recursive: true, force: true });
    const second = await execFileAsync(process.execPath, [CLI, "setup", "--agent", "hermes", "--yes"], { env });
    assert.match(second.stdout, /Unchanged shared copies: 1/);
    const guard = JSON.parse((await execFileAsync(process.execPath, [
      CLI, "guard", "use", "demo", "--agent", "hermes", "--json"
    ], { env })).stdout);
    assert.equal(guard.allowed, true);

    await execFileAsync(process.execPath, [CLI, "skill", "unshare", "demo", "--json"], { env });
    await assert.rejects(readFile(join(customHermesRoot, "demo", "SKILL.md")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registered roots remain additive when a conventional root has agent-owned skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-additive-agent-root-"));
  const home = join(root, "home");
  const conventionalHermesRoot = join(home, ".hermes", "skills");
  const customHermesRoot = join(home, "agent-homes", "hermes", "skills");
  const env = withoutEnvKeys({
    ...process.env,
    HOME: home,
    USERPROFILE: home
  }, ["HERMES_HOME"]);
  try {
    await mkdir(join(conventionalHermesRoot, "hermes-local"), { recursive: true });
    await writeFile(join(conventionalHermesRoot, "hermes-local", "SKILL.md"), "---\nname: hermes-local\ndescription: Local Hermes workflow.\n---\n");
    await writeFile(join(conventionalHermesRoot, "hermes-local", ".skillboard-share.json"), "not-json\n");

    await execFileAsync(process.execPath, [
      CLI, "setup", "--agent", "hermes", "--skill-root", customHermesRoot, "--yes"
    ], { env });

    const inventory = JSON.parse(await readFile(join(home, ".skillboard", "inventory.json"), "utf8"));
    assert.deepEqual(inventory.skills.find(({ id }) => id === "hermes-local").installed_on, ["hermes"]);
    const guard = JSON.parse((await execFileAsync(process.execPath, [
      CLI, "guard", "use", "hermes-local", "--agent", "hermes", "--json"
    ], { env })).stdout);
    assert.equal(guard.allowed, true);
    assert.match(await readFile(join(customHermesRoot, "skillboard", "SKILL.md"), "utf8"), /agent `hermes`/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup creates a late Hermes profile skill root and reconciles shared skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-late-hermes-profile-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const profileHome = join(home, ".hermes", "profiles", "work");
  const profileSkills = join(profileHome, "skills");
  const env = withoutEnvKeys({
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome
  }, ["HERMES_HOME"]);
  try {
    await mkdir(join(codexHome, "skills", "demo"), { recursive: true });
    await writeFile(join(codexHome, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Portable profile workflow.\n---\n");
    await execFileAsync(process.execPath, [CLI, "setup", "--agent", "codex", "--yes"], { env });
    await execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--json"], { env });
    await mkdir(profileHome, { recursive: true });

    const setup = await execFileAsync(process.execPath, [CLI, "setup", "--agent", "hermes", "--yes"], { env });
    assert.match(setup.stdout, /Created shared copies: 1/);
    assert.match(await readFile(join(profileSkills, "skillboard", "SKILL.md"), "utf8"), /agent `hermes`/);
    assert.match(await readFile(join(profileSkills, "demo", "SKILL.md"), "utf8"), /Portable profile workflow/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup rejects a registered skill root outside the invoking user's home", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-unsafe-agent-root-"));
  const home = join(root, "home");
  const outside = join(root, "outside", "skills");
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        CLI, "setup", "--agent", "hermes", "--skill-root", outside, "--yes"
      ], { env }),
      /registered skill root must remain inside the invoking user's home/i
    );
    await assert.rejects(readFile(join(home, ".skillboard", "agent-roots.json")), /ENOENT/);
    await assert.rejects(readFile(join(outside, "skillboard", "SKILL.md")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup rejects a registered skill root that traverses a symbolic link", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-symlink-agent-root-"));
  const home = join(root, "home");
  const outside = join(root, "outside");
  const linkedHome = join(home, "linked-agent");
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(outside, "skills"), { recursive: true });
    await symlink(outside, linkedHome, "dir");
    await assert.rejects(
      execFileAsync(process.execPath, [
        CLI, "setup", "--agent", "hermes", "--skill-root", join(linkedHome, "skills"), "--yes"
      ], { env }),
      /registered skill root must not traverse a symbolic link/i
    );
    await assert.rejects(readFile(join(home, ".skillboard", "agent-roots.json")), /ENOENT/);
    await assert.rejects(readFile(join(outside, "skills", "skillboard", "SKILL.md")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup rejects one custom skill root being assigned to different agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-ambiguous-agent-root-"));
  const home = join(root, "home");
  const sharedRoot = join(home, "custom-agent", "skills");
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  try {
    await execFileAsync(process.execPath, [
      CLI, "setup", "--agent", "hermes", "--skill-root", sharedRoot, "--yes"
    ], { env });
    const originalGuidance = await readFile(join(sharedRoot, "skillboard", "SKILL.md"), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [
        CLI, "setup", "--agent", "claude", "--skill-root", sharedRoot, "--yes"
      ], { env }),
      /already registered for agent hermes/i
    );
    assert.equal(await readFile(join(sharedRoot, "skillboard", "SKILL.md"), "utf8"), originalGuidance);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup preserves a symlinked shared target instead of trusting its external marker", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-reconcile-symlink-target-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const customRoot = join(home, "custom-hermes", "skills");
  const outside = join(root, "outside-demo");
  const env = withoutEnvKeys({ ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome }, ["HERMES_HOME"]);
  try {
    await mkdir(join(codexHome, "skills", "demo"), { recursive: true });
    await writeFile(join(codexHome, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Symlink reconcile fixture.\n---\n");
    await execFileAsync(process.execPath, [CLI, "setup", "--agent", "codex", "--yes"], { env });
    await execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--json"], { env });
    await mkdir(customRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "SKILL.md"), "external\n");
    await writeFile(join(outside, ".skillboard-share.json"), `${JSON.stringify({
      version: 1,
      managed_by: "skillboard",
      mode: "agent-copy",
      skill: "demo",
      source_agent: "codex",
      target_agent: "hermes"
    })}\n`);
    await symlink(outside, join(customRoot, "demo"), "dir");

    const setup = await execFileAsync(process.execPath, [
      CLI, "setup", "--agent", "hermes", "--skill-root", customRoot, "--yes"
    ], { env });
    assert.match(setup.stdout, /Preserved shared copies/);
    assert.doesNotMatch(setup.stdout, /Unchanged shared copies/);
    assert.equal(await readFile(join(outside, "SKILL.md"), "utf8"), "external\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("share and unshare promote one skill across agents while preserving its owner original", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-share-flow-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const claudeHome = join(home, ".claude");
  const hermesHome = join(home, ".hermes");
  const opencodeHome = join(home, ".config", "opencode");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome,
    CLAUDE_HOME: claudeHome,
    HERMES_HOME: hermesHome,
    OPENCODE_HOME: opencodeHome
  };
  try {
    await mkdir(join(codexHome, "skills", "demo", "scripts"), { recursive: true });
    await writeFile(join(codexHome, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Portable testing workflow.\n---\n");
    await writeFile(join(codexHome, "skills", "demo", "scripts", "check.sh"), "exit 0\n");
    await execFileAsync(process.execPath, [CLI, "setup", "--agent", "codex,claude,opencode,hermes", "--yes"], { env });

    const shared = JSON.parse((await execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--json"], { env })).stdout);
    assert.equal(shared.shared, true);
    assert.deepEqual(shared.installed_on, ["claude", "codex", "hermes", "opencode"]);
    assert.equal(await readFile(join(home, ".agents", "shared-skills", "demo", "scripts", "check.sh"), "utf8"), "exit 0\n");
    assert.equal(await readFile(join(hermesHome, "skills", "demo", "scripts", "check.sh"), "utf8"), "exit 0\n");
    assert.match(await readFile(join(home, "skillboard.config.yaml"), "utf8"), /demo:[\s\S]*shared: true/);

    const unshared = JSON.parse((await execFileAsync(process.execPath, [CLI, "skill", "unshare", "demo", "--json"], { env })).stdout);
    assert.equal(unshared.shared, false);
    assert.deepEqual(unshared.installed_on, ["codex"]);
    const inventoryAfterUnshare = JSON.parse(await readFile(join(home, ".skillboard", "inventory.json"), "utf8"));
    assert.deepEqual(inventoryAfterUnshare.skills.find(({ id }) => id === "demo").installed_on, ["codex"]);
    assert.equal(await readFile(join(codexHome, "skills", "demo", "SKILL.md"), "utf8"), "---\nname: demo\ndescription: Portable testing workflow.\n---\n");
    await assert.rejects(readFile(join(hermesHome, "skills", "demo", "SKILL.md")), /ENOENT/);
    await assert.rejects(readFile(join(home, ".agents", "shared-skills", "demo", "SKILL.md")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("share and unshare roll back policy and managed copies after an interrupted transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-share-rollback-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const hermesHome = join(home, ".hermes");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome,
    CLAUDE_HOME: join(home, ".claude"),
    HERMES_HOME: hermesHome,
    OPENCODE_HOME: join(home, ".config", "opencode")
  };
  try {
    await mkdir(join(codexHome, "skills", "demo"), { recursive: true });
    await writeFile(join(codexHome, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Portable workflow.\n---\n");
    await execFileAsync(process.execPath, [CLI, "setup", "--agent", "codex,claude,opencode,hermes", "--yes"], { env });

    await assert.rejects(execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--json"], {
      env: { ...env, SKILLBOARD_SHARE_FAILPOINT: "after-copy-target-created" }
    }), /Injected sharing failure/);
    assert.match(await readFile(join(home, "skillboard.config.yaml"), "utf8"), /demo:[\s\S]*shared: false/);
    await assert.rejects(readFile(join(home, ".agents", "shared-skills", "demo", "SKILL.md")), /ENOENT/);

    await assert.rejects(execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--json"], {
      env: { ...env, SKILLBOARD_SHARE_FAILPOINT: "after-policy-write" }
    }), /Injected sharing failure/);
    assert.match(await readFile(join(home, "skillboard.config.yaml"), "utf8"), /demo:[\s\S]*shared: false/);
    await assert.rejects(readFile(join(hermesHome, "skills", "demo", "SKILL.md")), /ENOENT/);

    await execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--json"], { env });
    await assert.rejects(execFileAsync(process.execPath, [CLI, "skill", "unshare", "demo", "--json"], {
      env: { ...env, SKILLBOARD_SHARE_FAILPOINT: "after-files-staged" }
    }), /Injected sharing failure/);
    assert.match(await readFile(join(home, "skillboard.config.yaml"), "utf8"), /demo:[\s\S]*shared: true/);
    assert.match(await readFile(join(hermesHome, "skills", "demo", "SKILL.md"), "utf8"), /Portable workflow/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("share dry-run reports an unmanaged target collision before confirmation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-share-collision-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const hermesHome = join(home, ".hermes");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome,
    CLAUDE_HOME: join(home, ".claude"),
    HERMES_HOME: hermesHome,
    OPENCODE_HOME: join(home, ".config", "opencode")
  };
  try {
    await mkdir(join(codexHome, "skills", "demo"), { recursive: true });
    await writeFile(join(codexHome, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Portable workflow.\n---\n");
    await mkdir(join(hermesHome, "skills", "demo"), { recursive: true });
    await execFileAsync(process.execPath, [CLI, "setup", "--agent", "codex,claude,opencode,hermes", "--yes"], { env });

    await assert.rejects(
      execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--dry-run", "--json"], { env }),
      /already exists and is not managed by SkillBoard/
    );
    assert.match(await readFile(join(home, "skillboard.config.yaml"), "utf8"), /demo:[\s\S]*shared: false/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("share preserves a valid skill already owned by another agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-share-existing-agent-skill-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const hermesHome = join(home, ".hermes");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome,
    CLAUDE_HOME: join(home, ".claude"),
    HERMES_HOME: hermesHome,
    OPENCODE_HOME: join(home, ".config", "opencode")
  };
  try {
    await mkdir(join(codexHome, "skills", "demo"), { recursive: true });
    await mkdir(join(hermesHome, "skills", "demo"), { recursive: true });
    await writeFile(join(codexHome, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Portable primary workflow.\n---\n");
    const hermesContent = "---\nname: demo\ndescription: Hermes-owned workflow.\n---\n";
    await writeFile(join(hermesHome, "skills", "demo", "SKILL.md"), hermesContent);
    await execFileAsync(process.execPath, [CLI, "setup", "--agent", "codex,claude,opencode,hermes", "--yes"], { env });

    const shared = JSON.parse((await execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--json"], { env })).stdout);
    assert.equal(shared.shared, true);
    assert.equal(await readFile(join(hermesHome, "skills", "demo", "SKILL.md"), "utf8"), hermesContent);
    await assert.rejects(readFile(join(hermesHome, "skills", "demo", ".skillboard-share.json")), /ENOENT/);
    await readFile(join(env.CLAUDE_HOME, "skills", "demo", ".skillboard-share.json"));

    await execFileAsync(process.execPath, [CLI, "skill", "unshare", "demo", "--json"], { env });
    assert.equal(await readFile(join(hermesHome, "skills", "demo", "SKILL.md"), "utf8"), hermesContent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("share refuses a symlinked target root without writing through it", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-share-symlink-"));
  const home = join(root, "home");
  const outside = join(root, "outside");
  const codexHome = join(home, ".codex");
  const hermesHome = join(home, ".hermes");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome,
    CLAUDE_HOME: join(home, ".claude"),
    HERMES_HOME: hermesHome,
    OPENCODE_HOME: join(home, ".config", "opencode")
  };
  try {
    await mkdir(join(codexHome, "skills", "demo"), { recursive: true });
    await writeFile(join(codexHome, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Portable workflow.\n---\n");
    await mkdir(hermesHome, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(hermesHome, "skills"));
    await execFileAsync(process.execPath, [CLI, "setup", "--agent", "codex,claude,opencode,hermes", "--yes"], { env });

    await assert.rejects(
      execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--json"], { env }),
      /symbolic link|symlink/i
    );
    await assert.rejects(readFile(join(outside, "demo", "SKILL.md")), /ENOENT/);
    assert.match(await readFile(join(home, "skillboard.config.yaml"), "utf8"), /demo:[\s\S]*shared: false/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("share copies the contents of an intentionally linked source skill", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-share-linked-source-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const hermesHome = join(home, ".hermes");
  const origin = join(home, "skill-sources", "demo");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome,
    CLAUDE_HOME: join(home, ".claude"),
    HERMES_HOME: hermesHome,
    OPENCODE_HOME: join(home, ".config", "opencode")
  };
  try {
    await mkdir(join(codexHome, "skills"), { recursive: true });
    await mkdir(join(origin, "scripts"), { recursive: true });
    await writeFile(join(origin, "SKILL.md"), "---\nname: demo\ndescription: Linked portable workflow.\n---\n");
    await writeFile(join(origin, "scripts", "check.sh"), "exit 0\n");
    await symlink(origin, join(codexHome, "skills", "demo"));
    await execFileAsync(process.execPath, [CLI, "setup", "--agent", "codex,claude,opencode,hermes", "--yes"], { env });

    await execFileAsync(process.execPath, [CLI, "skill", "share", "demo", "--json"], { env });
    assert.equal(await readFile(join(hermesHome, "skills", "demo", "scripts", "check.sh"), "utf8"), "exit 0\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unshare rejects a policy id that escapes managed skill roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-unshare-escape-"));
  const home = join(root, "home");
  const escaped = join(home, ".agents", "outside");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_HOME: join(home, ".claude"),
    HERMES_HOME: join(home, ".hermes"),
    OPENCODE_HOME: join(home, ".config", "opencode")
  };
  try {
    await mkdir(join(home, ".skillboard"), { recursive: true });
    await mkdir(escaped, { recursive: true });
    await writeFile(join(home, "skillboard.config.yaml"), "version: 2\nskills:\n  ../outside:\n    enabled: true\n    shared: true\n");
    await writeFile(join(home, ".skillboard", "inventory.json"), inventory([
      observed("../outside", ["codex"])
    ]));
    await writeFile(join(escaped, ".skillboard-share.json"), `${JSON.stringify({
      version: 1, managed_by: "skillboard", mode: "shared-source", skill: "../outside",
      source_agent: "codex", target_agent: null
    }, null, 2)}\n`);

    await assert.rejects(
      execFileAsync(process.execPath, [CLI, "skill", "unshare", "../outside", "--json"], { env }),
      /invalid skill id: \.\.\/outside/
    );
    assert.match(await readFile(join(escaped, ".skillboard-share.json"), "utf8"), /\.\.\/outside/);
    assert.match(await readFile(join(home, "skillboard.config.yaml"), "utf8"), /shared: true/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sharing rejects path-like ids before any managed file mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-unshare-nested-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const hermesHome = join(home, ".hermes");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome,
    CLAUDE_HOME: join(home, ".claude"),
    HERMES_HOME: hermesHome,
    OPENCODE_HOME: join(home, ".config", "opencode")
  };
  try {
    await mkdir(join(codexHome, "skills", "suite", "demo"), { recursive: true });
    await mkdir(join(home, ".skillboard"), { recursive: true });
    await writeFile(join(codexHome, "skills", "suite", "demo", "SKILL.md"), "---\nname: suite.demo\ndescription: Nested portable workflow.\n---\n");
    await writeFile(join(home, "skillboard.config.yaml"), "version: 2\nskills:\n  suite/demo:\n    enabled: true\n    shared: false\n");
    await writeFile(join(home, ".skillboard", "inventory.json"), inventory([{
      ...observed("suite/demo", ["codex"]), path: "suite/demo"
    }]));
    await assert.rejects(
      execFileAsync(process.execPath, [CLI, "skill", "share", "suite/demo", "--json"], { env }),
      /invalid skill id: suite\/demo/
    );
    await assert.rejects(readFile(join(hermesHome, "skills", "suite", "demo", "SKILL.md")), /ENOENT/);
    assert.match(await readFile(join(home, "skillboard.config.yaml"), "utf8"), /shared: false/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function withFixture(callback) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-agent-sharing-"));
  const configPath = join(root, "skillboard.config.yaml");
  const inventoryPath = join(root, ".skillboard", "inventory.json");
  try {
    await mkdir(join(root, ".skillboard"), { recursive: true });
    await callback({ root, configPath, inventoryPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function observed(id, installedOn) {
  return {
    id,
    path: id,
    owner_install_unit: `${installedOn[0] ?? "custom"}.user-skills`,
    installed_on: installedOn,
    aliases: []
  };
}

function inventory(skills) {
  return `${JSON.stringify({
    format_version: 1,
    generated: true,
    authoritative_for_availability: false,
    skills,
    install_units: []
  }, null, 2)}\n`;
}

function withoutEnvKeys(env, keys) {
  const copy = { ...env };
  for (const key of keys) delete copy[key];
  return copy;
}
