import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import YAML from "yaml";
import { auditSources, canUseSkill } from "../src/control.mjs";
import { buildGeneratedInventory, mergeGeneratedInventory } from "../src/inventory-json.mjs";
import { refreshAgentInventory } from "../src/inventory-refresh.mjs";
import { initProject } from "../src/init.mjs";
import { verifySources } from "../src/source-verification.mjs";
import { loadWorkspace } from "../src/workspace.mjs";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../bin/skillboard.mjs", import.meta.url));

test("fresh v2 init without scanning writes a protected empty generated inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-init-empty-inventory-"));
  try {
    const result = await initProject({ root, scanInstalled: false });
    const inventoryPath = join(root, ".skillboard", "inventory.json");
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
    assert.equal(inventory.generated, true);
    assert.equal(inventory.authoritative_for_availability, false);
    assert.deepEqual(inventory.skills, []);
    assert.deepEqual(inventory.install_units, []);
    if (process.platform !== "win32") assert.equal((await stat(inventoryPath)).mode & 0o777, 0o600);
    assert.equal(result.created.includes(".skillboard/inventory.json"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing refresh restores policy and inventory when the policy commit fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-refresh-rollback-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const inventoryPath = join(root, ".skillboard", "inventory.json");
    const config = "version: 2\nskills: {}\n";
    const inventory = Buffer.from('{"fixture":"before"}\n');
    await mkdir(join(root, ".skillboard"));
    await writeFile(configPath, config);
    await writeFile(inventoryPath, inventory);

    await assert.rejects(
      refreshAgentInventory({
        root,
        roots: [],
        inventory: {
          skills: [{ id: "added", path: "added", ownerInstallUnit: "fixture" }],
          installUnits: [],
          warnings: []
        },
        writeConfig: async () => { throw new Error("injected existing config failure"); }
      }),
      /injected existing config failure/
    );

    assert.equal(await readFile(configPath, "utf8"), config);
    assert.deepEqual(await readFile(inventoryPath), inventory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh rejects an absolute config outside its project root without changing bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-refresh-config-root-"));
  try {
    const project = join(root, "project");
    const outside = join(root, "outside.yaml");
    const before = "version: 2\nskills: {}\n";
    await mkdir(project);
    await writeFile(outside, before);

    await assert.rejects(
      refreshAgentInventory({ root: project, configPath: outside, roots: [] }),
      /config path.*project root/i
    );
    assert.equal(await readFile(outside, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated inventory uses portable path tokens and is written with mode 0600", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-inventory-portable-"));
  try {
    const project = join(root, "project");
    const home = join(root, "home");
    const external = join(root, "external", "manifest.json");
    const skillFile = join(home, ".codex", "skills", "portable", "SKILL.md");
    await mkdir(join(project, ".skillboard"), { recursive: true });
    await mkdir(join(skillFile, ".."), { recursive: true });
    await mkdir(join(external, ".."), { recursive: true });
    await writeFile(skillFile, "---\nname: portable\ndescription: Portable paths.\n---\n");
    await writeFile(external, "{}\n");
    await writeFile(join(project, "skillboard.config.yaml"), "version: 2\nskills: {}\n");

    const generated = await buildGeneratedInventory({
      skills: [{ id: "portable", path: "portable", ownerInstallUnit: "fixture", skillFile }],
      installUnits: [{
        id: "fixture",
        source: join(project, "vendor"),
        cachePath: join(home, ".cache", "fixture"),
        manifestPath: external,
        sourceClass: "skill-pack",
        trustLevel: "unreviewed",
        permissionRisk: "low"
      }]
    }, { root: project, home });
    const text = JSON.stringify(generated);
    assert.equal(text.includes(root), false);
    assert.equal(generated.install_units[0].source, "${PROJECT}/vendor");
    assert.equal(generated.install_units[0].cache_path, "${HOME}/.cache/fixture");
    assert.equal(generated.install_units[0].manifest_path, "<external>/manifest.json");
    assert.equal(generated.redactions.path_count, 3);
    assert.equal(generated.redactions.warnings.length, 1);

    const result = await refreshAgentInventory({ root: project, roots: [], home, env: { HOME: home, SKILLBOARD_INIT_SCAN_ROOTS: "" } });
    const inventoryPath = join(project, ".skillboard", "inventory.json");
    if (process.platform !== "win32") assert.equal((await stat(inventoryPath)).mode & 0o777, 0o600);
    assert.equal(result.configPath, "skillboard.config.yaml");
    assert.equal(result.inventoryPath, ".skillboard/inventory.json");
    assert.equal(JSON.stringify(result).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 workspace projects inventory install-unit observations into audit only", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-inventory-audit-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const inventoryPath = join(root, ".skillboard", "inventory.json");
    await mkdir(join(root, ".skillboard"));
    await writeFile(configPath, "version: 2\nskills:\n  usable:\n    enabled: true\n    shared: false\n");
    await writeFile(inventoryPath, `${JSON.stringify({
      format_version: 1,
      generated: true,
      authoritative_for_availability: false,
      skills: [{ id: "usable", path: "usable", owner_install_unit: "plugin.risky", installed_on: ["codex"] }],
      install_units: [{
        id: "plugin.risky",
        kind: "plugin",
        source: "${PROJECT}/missing-plugin",
        source_class: "runtime-extension",
        trust_observation: "unreviewed",
        permission_risk: "high",
        signature_observed: false,
        runtime_components: { commands: [], hooks: ["pre-use"], mcp_servers: [] },
        skills: ["usable"],
        alias_skills: []
      }]
    }, null, 2)}\n`);

    const workspace = await loadWorkspace({ configPath });
    const before = canUseSkill(workspace, "usable", undefined, "codex");
    const audit = auditSources(workspace);
    const after = canUseSkill(workspace, "usable", undefined, "codex");

    assert.equal(workspace.installUnits.length, 1);
    assert.equal(audit.units[0].trustLevel, "unreviewed");
    assert.equal(audit.units[0].permissionRisk, "high");
    assert.equal(audit.warnings.length > 0, true);
    assert.deepEqual(after, before);
    assert.equal(after.allowed, true);
    const verified = await verifySources(workspace, { configPath, rootDir: root, restrictToRoot: true });
    assert.equal(verified.ok, false);
    assert.equal(JSON.stringify(verified).includes(root), false);
    assert.match(verified.errors[0], /\$\{PROJECT\}/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated inventory merge preserves existing records and adds observations deterministically", async () => {
  const existing = `${JSON.stringify({
    format_version: 1,
    generated: true,
    authoritative_for_availability: false,
    skills: [{ id: "existing", path: "existing", owner_install_unit: "fixture.old" }],
    install_units: [{ id: "fixture.old", kind: "skill", runtime_components: { commands: [], hooks: [], mcp_servers: [] } }]
  })}\n`;
  const added = {
    format_version: 1,
    generated: true,
    authoritative_for_availability: false,
    skills: [{ id: "new", path: "new", owner_install_unit: "fixture.new" }],
    install_units: [{ id: "fixture.new", kind: "skill", cache_path: "${HOME}/fixture", runtime_components: { commands: [], hooks: [], mcp_servers: [] } }],
    redactions: { path_count: 1, warnings: [] }
  };

  const first = mergeGeneratedInventory(existing, added);
  const second = mergeGeneratedInventory(first, added);
  assert.equal(second, first);
  assert.equal(JSON.parse(first).redactions.path_count, 1);
  assert.deepEqual(JSON.parse(first).skills.map((skill) => skill.id), ["existing", "new"]);
  assert.deepEqual(JSON.parse(first).install_units.map((unit) => unit.id), ["fixture.new", "fixture.old"]);
});

test("generated inventory coalesces duplicate install-unit observations by id", async () => {
  const generated = await buildGeneratedInventory({
    skills: [],
    installUnits: [
      { id: "plugin.same", kind: "plugin", source: "z-source", trustLevel: "reviewed", permissionRisk: "low", commands: ["z"], skills: ["z"] },
      { id: "plugin.same", kind: "plugin", source: "a-source", trustLevel: "unreviewed", permissionRisk: "high", hooks: ["pre-use"], skills: ["a"] }
    ]
  });

  assert.equal(generated.install_units.length, 1);
  assert.equal(generated.install_units[0].id, "plugin.same");
  assert.deepEqual(generated.install_units[0].runtime_components, {
    commands: ["z"],
    hooks: ["pre-use"],
    mcp_servers: []
  });
  assert.deepEqual(generated.install_units[0].skills, ["a", "z"]);
  assert.equal(generated.install_units[0].trust_observation, "unreviewed");
  assert.equal(generated.install_units[0].permission_risk, "high");
  assert.deepEqual(generated.install_units[0].source_observations, ["a-source", "z-source"]);
});

test("packed v2 import preserves scoped policy and existing guard inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-packed-import-"));
  try {
    const sourceRoot = join(root, "source");
    const configPath = join(root, "skillboard.config.yaml");
    const inventoryPath = join(root, ".skillboard", "inventory.json");
    const profilePath = join(root, "profile.yaml");
    await mkdir(join(sourceRoot, "skills", "new"), { recursive: true });
    await mkdir(join(root, ".skillboard"));
    await writeFile(join(sourceRoot, "skills", "new", "SKILL.md"), "---\nname: new\ndescription: New skill.\n---\n");
    await writeFile(profilePath, "id: imported.pack\nkind: skill\nnamespace: imported\ntarget_path_prefix: imported\nscope: project\nprovided_components: [skills]\nskill_paths: [skills/*/SKILL.md]\n");
    await writeFile(configPath, "version: 2\nskills:\n  existing.allowed:\n    enabled: true\n    shared: true\n  existing.disabled:\n    enabled: false\n    shared: false\n");
    await writeFile(inventoryPath, `${JSON.stringify({
      format_version: 1,
      generated: true,
      authoritative_for_availability: false,
      skills: [
        { id: "existing.allowed", path: "existing-allowed", owner_install_unit: "existing.pack", installed_on: ["codex"] },
        { id: "existing.disabled", path: "existing-disabled", owner_install_unit: "existing.pack", installed_on: ["codex"] }
      ],
      install_units: [{ id: "existing.pack", kind: "skill", runtime_components: { commands: [], hooks: [], mcp_servers: [] } }]
    }, null, 2)}\n`);

    await execFileAsync(process.execPath, [CLI, "import", "--profile", profilePath, "--source-root", sourceRoot, "--config", configPath, "--merge", "--json"], { cwd: root });

    const config = YAML.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(config.skills["existing.allowed"], { enabled: true, shared: true });
    assert.deepEqual(config.skills["existing.disabled"], { enabled: false, shared: false });
    assert.deepEqual(config.skills["imported.new"], { enabled: true, shared: false });
    const workspace = await loadWorkspace({ configPath, inventoryPath });
    if (process.platform !== "win32") assert.equal((await stat(inventoryPath)).mode & 0o777, 0o600);
    assert.equal(canUseSkill(workspace, "existing.allowed", "review", "codex").allowed, true);
    assert.equal(canUseSkill(workspace, "existing.disabled", "review", "codex").allowed, false);
    const imported = canUseSkill(workspace, "imported.new", undefined, "codex");
    assert.equal(imported.allowed, false);
    assert.match(imported.reasons.join("\n"), /not installed for agent codex/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
