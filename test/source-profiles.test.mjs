import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import YAML from "yaml";
import { importSource, loadSourceProfile, renderImportFragment } from "../src/index.mjs";

const execFileAsync = promisify(execFile);
const SKILLBOARD_BIN = fileURLToPath(new URL("../bin/skillboard.mjs", import.meta.url));

test("source profiles import skill repositories into install-unit governed skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-profile-test-"));
  try {
    const sourceRoot = join(root, "repo");
    const profilePath = join(root, "profile.yaml");
    await writeSkill(join(sourceRoot, "skills", "router", "SKILL.md"), "workflow-router", "Route user tasks.");
    await writeSkill(join(sourceRoot, "skills", "review", "SKILL.md"), "review-work", "Review implementation work.");
    await writeFile(
      profilePath,
      `id: local.agent-skills-private
source: /tmp/agent-skills-private
kind: skill
namespace: private
target_path_prefix: private
scope: user-global
default_status: candidate
default_invocation: router-only
default_exposure: exported
default_category: meta
provided_components:
  - skills
skill_paths:
  - skills/*/SKILL.md
permission_risk: low
rollback: git
`,
      "utf8"
    );

    const profile = await loadSourceProfile(profilePath);
    const imported = await importSource({ profile, sourceRoot });
    const fragment = YAML.parse(renderImportFragment(imported));

    assert.deepEqual(imported.installUnit.components.skills, ["private.review", "private.router"]);
    assert.equal(fragment.skills["private.router"].owner_install_unit, "local.agent-skills-private");
    assert.equal(fragment.skills["private.router"].path, "private/router");
    assert.equal(fragment.skills["private.router"].invocation, "router-only");
    assert.equal(fragment.install_units["local.agent-skills-private"].permission_risk, "low");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli import uses built-in source profiles without repo-specific branches", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-builtin-profile-test-"));
  try {
    await writeSkill(join(root, "skills", "engineering", "tdd", "SKILL.md"), "tdd", "Run test-driven development.");
    await writeSkill(join(root, "skills", "productivity", "grill-me", "SKILL.md"), "grill-me", "Clarify vague requests.");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "import",
      "--profile",
      "github.mattpocock.skills",
      "--source-root",
      root
    ]);
    const fragment = YAML.parse(result.stdout);

    assert.deepEqual(Object.keys(fragment.skills).sort(), ["matt.grill-me", "matt.tdd"]);
    assert.equal(fragment.skills["matt.tdd"].owner_install_unit, "github.mattpocock.skills");
    assert.equal(fragment.skills["matt.tdd"].status, "vendor");
    assert.deepEqual(fragment.install_units["github.mattpocock.skills"].components.skills.sort(), ["matt.grill-me", "matt.tdd"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("built-in source profiles can derive category and lifecycle from repository paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-profile-path-rules-test-"));
  try {
    await writeSkill(join(root, "skills", "engineering", "tdd", "SKILL.md"), "tdd", "Run test-driven development.");
    await writeSkill(join(root, "skills", "deprecated", "qa", "SKILL.md"), "qa", "Legacy QA flow.");
    await writeSkill(join(root, "skills", "in-progress", "review", "SKILL.md"), "review", "Experimental review flow.");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "import",
      "--profile",
      "github.mattpocock.skills",
      "--source-root",
      root
    ]);
    const fragment = YAML.parse(result.stdout);

    assert.equal(fragment.skills["matt.tdd"].category, "engineering");
    assert.equal(fragment.skills["matt.tdd"].status, "vendor");
    assert.equal(fragment.skills["matt.tdd"].invocation, "manual-only");
    assert.equal(fragment.skills["matt.qa"].category, "deprecated");
    assert.equal(fragment.skills["matt.qa"].status, "deprecated");
    assert.equal(fragment.skills["matt.qa"].invocation, "deprecated");
    assert.equal(fragment.skills["matt.review"].category, "in-progress");
    assert.equal(fragment.skills["matt.review"].status, "candidate");
    assert.equal(fragment.skills["matt.review"].invocation, "manual-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli import refuses merging into v1 config and preserves bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-import-merge-test-"));
  try {
    const sourceRoot = join(root, "source");
    const configPath = join(root, "skillboard.config.yaml");
    await writeSkill(join(sourceRoot, "skills", "tdd", "SKILL.md"), "tdd", "Run test-driven development.");
    await writeFile(configPath, "# keep import comment\nversion: 1\nskills: {}\ninstall_units: {}\n", "utf8");
    const before = await readFile(configPath, "utf8");

    await assert.rejects(execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "import",
      "--profile",
      "github.mattpocock.skills",
      "--source-root",
      sourceRoot,
      "--config",
      configPath,
      "--merge",
      "--dry-run",
      "--json"
    ]), /Version 1 policy is read-only\. Run `skillboard migrate v2`\./);
    assert.equal(await readFile(configPath, "utf8"), before);

    await assert.rejects(execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "import",
      "--profile",
      "github.mattpocock.skills",
      "--source-root",
      sourceRoot,
      "--config",
      configPath,
      "--merge"
    ]), /Version 1 policy is read-only\. Run `skillboard migrate v2`\./);
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli import merge records v2 inventory and enables missing skills agent-locally without source gating", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-import-merge-"));
  try {
    const sourceRoot = join(root, "source");
    const profilePath = join(root, "unreviewed-profile.yaml");
    const configPath = join(root, "skillboard.config.yaml");
    await writeSkill(join(sourceRoot, "skills", "new", "SKILL.md"), "new", "New imported skill.");
    await writeFile(profilePath, `id: external.unreviewed
kind: skill
namespace: imported
target_path_prefix: imported
scope: project
default_status: quarantined
default_invocation: blocked
default_exposure: unit-managed
default_category: imported
trust_level: unreviewed
provided_components: [skills]
skill_paths: [skills/*/SKILL.md]
`, "utf8");
    await writeFile(configPath, "version: 2\nskills:\n  existing:\n    enabled: false\n    shared: false\n", "utf8");

    const result = await execFileAsync(process.execPath, [
      SKILLBOARD_BIN, "import", "--profile", profilePath, "--source-root", sourceRoot,
      "--config", configPath, "--merge", "--json"
    ], { cwd: root });

    const payload = JSON.parse(result.stdout);
    const config = YAML.parse(await readFile(configPath, "utf8"));
    const inventory = JSON.parse(await readFile(join(root, ".skillboard", "inventory.json"), "utf8"));
    assert.deepEqual(config.skills.existing, { enabled: false, shared: false });
    assert.deepEqual(config.skills["imported.new"], { enabled: true, shared: false });
    assert.equal("install_units" in config, false);
    assert.deepEqual(payload.addedSkills, ["imported.new"]);
    assert.equal(inventory.authoritative_for_availability, false);
    assert.equal(inventory.skills[0].id, "imported.new");
    assert.equal(inventory.install_units[0].trust_observation, "unreviewed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli import v1 refusal uses the user-level config and preserves bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-import-default-config-test-"));
  try {
    const sourceRoot = join(root, "source");
    const configPath = join(root, "skillboard.config.yaml");
    await writeSkill(join(sourceRoot, "skills", "tdd", "SKILL.md"), "tdd", "Run test-driven development.");
    await writeFile(configPath, "version: 1\nskills: {}\ninstall_units: {}\n", "utf8");
    const before = await readFile(configPath, "utf8");

    await assert.rejects(execFileAsync(process.execPath, [
      SKILLBOARD_BIN,
      "import",
      "--profile",
      "github.mattpocock.skills",
      "--source-root",
      sourceRoot,
      "--merge",
      "--dry-run",
      "--json"
    ], {
      cwd: root,
      env: { ...process.env, HOME: root, USERPROFILE: root }
    }), /Version 1 policy is read-only\. Run `skillboard migrate v2`\./);
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli import merge validates the merged config before writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-import-checked-write-test-"));
  try {
    const sourceRoot = join(root, "source");
    const profilePath = join(root, "unsafe-profile.yaml");
    const configPath = join(root, "skillboard.config.yaml");
    await writeSkill(join(sourceRoot, "skills", "auto", "SKILL.md"), "auto", "Auto-select this skill.");
    await writeFile(
      profilePath,
      `id: local.unsafe-auto
source: /tmp/unsafe-auto
kind: skill
namespace: unsafe
target_path_prefix: unsafe
scope: project
default_status: active
default_invocation: workflow-auto
default_exposure: unit-managed
provided_components:
  - skills
skill_paths:
  - skills/*/SKILL.md
permission_risk: medium
`,
      "utf8"
    );
    await writeFile(
      configPath,
      `version: 1
defaults:
  require_explicit_workflow: true
skills: {}
install_units: {}
`,
      "utf8"
    );
    const before = await readFile(configPath, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [
        SKILLBOARD_BIN,
        "import",
        "--profile",
        profilePath,
        "--source-root",
        sourceRoot,
        "--config",
        configPath,
        "--merge"
      ]),
      /Version 1 policy is read-only\. Run `skillboard migrate v2`\./
    );
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli import merge refuses duplicate ids unless replace is explicit", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-import-duplicate-test-"));
  try {
    const sourceRoot = join(root, "source");
    const configPath = join(root, "skillboard.config.yaml");
    await writeSkill(join(sourceRoot, "skills", "tdd", "SKILL.md"), "tdd", "Run test-driven development.");
    await writeFile(
      configPath,
      `version: 1
skills:
  matt.tdd:
    path: old/tdd
install_units: {}
`,
      "utf8"
    );
    const before = await readFile(configPath, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "import",
        "--profile",
        "github.mattpocock.skills",
        "--source-root",
        sourceRoot,
        "--config",
        configPath,
        "--merge"
      ]),
      /already exist/
    );

    await assert.rejects(execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "import",
      "--profile",
      "github.mattpocock.skills",
      "--source-root",
      sourceRoot,
      "--config",
      configPath,
      "--merge",
      "--replace"
    ]), /Version 1 policy is read-only\. Run `skillboard migrate v2`\./);
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeSkill(path, name, description) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`, "utf8");
}
