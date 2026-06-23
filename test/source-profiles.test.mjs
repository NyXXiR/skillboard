import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import YAML from "yaml";
import { importSource, loadSourceProfile, renderImportFragment } from "../src/index.mjs";

const execFileAsync = promisify(execFile);

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
    await writeSkill(join(root, "skills", "tdd", "SKILL.md"), "tdd", "Run test-driven development.");
    await writeSkill(join(root, "skills", "grill-me", "SKILL.md"), "grill-me", "Clarify vague requests.");

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
    assert.deepEqual(fragment.install_units["github.mattpocock.skills"].components.skills, ["matt.grill-me", "matt.tdd"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli import can safely merge a profile into config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-import-merge-test-"));
  try {
    const sourceRoot = join(root, "source");
    const configPath = join(root, "skillboard.config.yaml");
    await writeSkill(join(sourceRoot, "skills", "tdd", "SKILL.md"), "tdd", "Run test-driven development.");
    await writeFile(configPath, "# keep import comment\nversion: 1\nskills: {}\ninstall_units: {}\n", "utf8");

    const result = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "import",
      "--profile",
      "github.mattpocock.skills",
      "--source-root",
      sourceRoot,
      "--config",
      configPath,
      "--merge"
    ]);
    const merged = YAML.parse(await readFile(configPath, "utf8"));
    const mergedText = await readFile(configPath, "utf8");

    assert.match(result.stdout, /Import merged/);
    assert.match(mergedText, /# keep import comment/);
    assert.equal(merged.skills["matt.tdd"].owner_install_unit, "github.mattpocock.skills");
    assert.deepEqual(merged.install_units["github.mattpocock.skills"].components.skills, ["matt.tdd"]);
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

    await execFileAsync(process.execPath, [
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
    ]);
    const merged = YAML.parse(await readFile(configPath, "utf8"));

    assert.equal(merged.skills["matt.tdd"].path, "matt/tdd");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeSkill(path, name, description) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`, "utf8");
}
