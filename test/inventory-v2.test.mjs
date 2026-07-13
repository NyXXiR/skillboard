import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { refreshAgentInventory } from "../src/inventory-refresh.mjs";
import { buildGeneratedInventory, mergeV2InventoryPolicy } from "../src/inventory-json.mjs";

async function writeSkill(root, relativePath, name) {
  const directory = join(root, relativePath);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: Test skill.\n---\n`, "utf8");
}

test("generated inventory is deterministic, observation-only, and preserves v2 policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-inventory-"));
  try {
    const project = join(root, "project");
    const home = join(root, "home");
    const codexSkills = join(home, ".codex", "skills");
    const hermesSkills = join(home, ".hermes", "skills");
    await mkdir(project, { recursive: true });
    await writeSkill(codexSkills, "shared", "shared");
    await writeSkill(hermesSkills, "shared", "shared");
    await writeSkill(hermesSkills, "new-helper", "new-helper");
    const configPath = join(project, "skillboard.config.yaml");
    await writeFile(configPath, "version: 2\nskills:\n  shared:\n    enabled: false\n    shared: true\n", "utf8");
    const options = {
      root: project,
      home,
      env: {
        HOME: home,
        USERPROFILE: home,
        CODEX_HOME: join(home, ".codex"),
        HERMES_HOME: join(home, ".hermes"),
        CLAUDE_HOME: join(home, ".claude"),
        SKILLBOARD_INIT_SCAN_ROOTS: ""
      }
    };

    const first = await refreshAgentInventory(options);
    const inventoryPath = join(project, ".skillboard", "inventory.json");
    const firstInventory = await readFile(inventoryPath, "utf8");
    const firstConfig = await readFile(configPath, "utf8");
    const second = await refreshAgentInventory(options);

    assert.equal(await readFile(inventoryPath, "utf8"), firstInventory);
    assert.equal(await readFile(configPath, "utf8"), firstConfig);
    assert.equal(first.inventoryChanged, true);
    assert.equal(second.inventoryChanged, false);
    const generated = JSON.parse(firstInventory);
    assert.equal(generated.generated, true);
    assert.equal(generated.authoritative_for_availability, false);
    assert.deepEqual(generated.skills.map((skill) => skill.id), ["new-helper", "shared"]);
    assert.equal(generated.skills[1].aliases.length, 1);
    assert.equal(new Set(generated.skills[1].aliases.map(JSON.stringify)).size, 1);
    assert.equal("enabled" in generated.skills[0], false);
    assert.equal("scope" in generated.skills[0], false);
    assert.match(generated.skills[0].content_digest, /^sha256:/);
    assert.equal(generated.install_units.some((unit) => unit.trust_observation === "trusted"), true);
    const policy = YAML.parse(firstConfig);
    assert.deepEqual(policy.skills.shared, { enabled: false, shared: true });
    assert.deepEqual(policy.skills["new-helper"], { enabled: true, shared: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source warnings do not change v2 policy defaults", () => {
  const config = "version: 2\nskills: {}\n";
  const inventory = { skills: [{ id: "safe", path: "safe", ownerInstallUnit: "plugin.x", sourceAliases: [] }] };
  const clean = mergeV2InventoryPolicy(config, inventory);
  const warned = mergeV2InventoryPolicy(config, { ...inventory, warnings: ["unreviewed source"] });
  assert.equal(warned.text, clean.text);
  assert.deepEqual(warned.policyProjection.safe, { enabled: true, shared: false });
});

test("malformed and out-of-root skill observations fail integrity without usable records", async () => {
  const inventory = {
    skills: [
      { id: "escape", path: "../escape", ownerInstallUnit: "unit", sourceAliases: [] },
      { id: "", path: "valid", ownerInstallUnit: "unit", sourceAliases: [] }
    ],
    installUnits: []
  };
  await assert.rejects(() => buildGeneratedInventory(inventory), /inventory integrity/i);
});

test("refresh rejects a symlinked generated inventory directory outside the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-inventory-link-"));
  try {
    const project = join(root, "project");
    const outside = join(root, "outside");
    const home = join(root, "home");
    await mkdir(project, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(project, ".skillboard"), "dir");
    await writeSkill(join(home, ".codex", "skills"), "safe", "safe");
    const configPath = join(project, "skillboard.config.yaml");
    const original = "version: 2\nskills: {}\n";
    await writeFile(configPath, original, "utf8");

    await assert.rejects(
      () => refreshAgentInventory({ root: project, home, roots: [join(home, ".codex", "skills")], env: { SKILLBOARD_INIT_SCAN_ROOTS: "" } }),
      /inventory target.*outside.*project root/i
    );
    assert.equal(await readFile(configPath, "utf8"), original);
    await assert.rejects(() => access(join(outside, "inventory.json")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inventory write failure cannot commit v2 policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-inventory-write-failure-"));
  try {
    const project = join(root, "project");
    const home = join(root, "home");
    await mkdir(project, { recursive: true });
    await writeSkill(join(home, ".codex", "skills"), "safe", "safe");
    const configPath = join(project, "skillboard.config.yaml");
    const original = "version: 2\nskills: {}\n";
    await writeFile(configPath, original, "utf8");

    await assert.rejects(
      () => refreshAgentInventory({
        root: project,
        home,
        roots: [join(home, ".codex", "skills")],
        env: { SKILLBOARD_INIT_SCAN_ROOTS: "" },
        writeInventory: async () => { throw new Error("injected inventory write failure"); }
      }),
      /injected inventory write failure/
    );
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh bootstraps a missing project config as minimal v2 policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-inventory-bootstrap-"));
  try {
    const project = join(root, "project");
    const home = join(root, "home");
    await mkdir(project, { recursive: true });
    await writeSkill(join(home, ".codex", "skills"), "safe", "safe");

    const result = await refreshAgentInventory({
      root: project,
      home,
      roots: [join(home, ".codex", "skills")],
      env: { SKILLBOARD_INIT_SCAN_ROOTS: "" }
    });

    assert.equal(result.bootstrappedV2, true);
    assert.deepEqual(YAML.parse(await readFile(join(project, "skillboard.config.yaml"), "utf8")), {
      version: 2,
      skills: { safe: { enabled: true, shared: false } }
    });
    assert.equal(JSON.parse(await readFile(join(project, ".skillboard", "inventory.json"), "utf8")).skills[0].id, "safe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed fresh bootstrap removes the new config and inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-inventory-bootstrap-failure-"));
  try {
    const project = join(root, "project");
    const home = join(root, "home");
    await mkdir(project, { recursive: true });
    await writeSkill(join(home, ".codex", "skills"), "safe", "safe");

    await assert.rejects(
      refreshAgentInventory({
        root: project,
        home,
        roots: [join(home, ".codex", "skills")],
        env: { SKILLBOARD_INIT_SCAN_ROOTS: "" },
        writeInventory: async () => { throw new Error("injected fresh inventory failure"); }
      }),
      /injected fresh inventory failure/
    );
    await assert.rejects(access(join(project, "skillboard.config.yaml")), /ENOENT/);
    await assert.rejects(access(join(project, ".skillboard", "inventory.json")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed fresh config commit removes the staged inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-inventory-config-failure-"));
  try {
    const project = join(root, "project");
    const home = join(root, "home");
    await mkdir(project, { recursive: true });
    await writeSkill(join(home, ".codex", "skills"), "safe", "safe");
    await assert.rejects(refreshAgentInventory({
      root: project,
      home,
      roots: [join(home, ".codex", "skills")],
      env: { SKILLBOARD_INIT_SCAN_ROOTS: "" },
      writeConfig: async () => { throw new Error("injected fresh config failure"); }
    }), /injected fresh config failure/);
    await assert.rejects(access(join(project, "skillboard.config.yaml")), /ENOENT/);
    await assert.rejects(access(join(project, ".skillboard", "inventory.json")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fresh refresh rejects a symlink config and preserves its target", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-inventory-config-link-"));
  try {
    const project = join(root, "project");
    const outside = join(root, "outside.yaml");
    await mkdir(project, { recursive: true });
    await writeFile(outside, "version: 2\nskills: {}\n", "utf8");
    await symlink(outside, join(project, "skillboard.config.yaml"));
    await assert.rejects(refreshAgentInventory({ root: project, roots: [] }), /config path must not be a symbolic link/i);
    assert.equal(await readFile(outside, "utf8"), "version: 2\nskills: {}\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent fresh refresh is rejected while the first transaction holds the lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-inventory-concurrent-"));
  try {
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    /** @type {() => void} */
    let release = () => {};
    const blocked = new Promise((resolve) => { release = () => resolve(); });
    /** @type {() => void} */
    let entered = () => {};
    const started = new Promise((resolve) => { entered = () => resolve(); });
    const first = refreshAgentInventory({
      root: project,
      roots: [],
      writeInventory: async (path, text) => {
        entered();
        await blocked;
        await writeFile(path, text, "utf8");
      }
    });
    await started;
    await assert.rejects(refreshAgentInventory({ root: project, roots: [] }), /another inventory refresh/i);
    release();
    await first;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing semantically invalid policies fail before config or inventory writes", async () => {
  const invalidPolicies = [
    ["legacy workflows", "version: 2\nworkflows: [daily]\nskills: {}\n"],
    ["missing shared", "version: 2\nskills:\n  bad:\n    enabled: true\n"],
    ["invalid shared", "version: 2\nskills:\n  bad:\n    enabled: true\n    shared: all\n"],
    ["unknown key", "version: 2\nskills:\n  bad:\n    enabled: true\n    shared: false\n    trust: reviewed\n"],
    ["mixed v1 v2", "version: 1\nskills:\n  bad:\n    path: bad\n    enabled: true\n    shared: false\n"]
  ];
  for (const [label, config] of invalidPolicies) {
    const root = await mkdtemp(join(tmpdir(), "skillboard-v2-inventory-invalid-"));
    try {
      const configPath = join(root, "skillboard.config.yaml");
      const inventoryPath = join(root, ".skillboard", "inventory.json");
      const inventory = Buffer.from(`{"fixture":"${label}"}\n`);
      await mkdir(join(root, ".skillboard"));
      await writeFile(configPath, config, "utf8");
      await writeFile(inventoryPath, inventory);

      await assert.rejects(refreshAgentInventory({ root, roots: [] }));
      assert.equal(await readFile(configPath, "utf8"), config, label);
      assert.deepEqual(await readFile(inventoryPath), inventory, label);
      assert.deepEqual((await access(join(root, ".skillboard-inventory-refresh.lock")).then(() => "present", () => "missing")), "missing", label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
