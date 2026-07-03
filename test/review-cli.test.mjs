// allow: SIZE_OK - review CLI test split is deferred from the 0.2.7 release gate.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("cli activate refuses unusable unreviewed automatic external skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-activate-trust-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const original = `version: 1
skills:
  vendor.router:
    path: vendor/router
    status: candidate
    invocation: manual-only
    exposure: exported
    owner_install_unit: github.vendor.skills
workflows:
  review-workflow:
    harness: codex
    active_skills: []
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
    trust_level: unreviewed
    permission_risk: medium
`;
    await writeFile(configPath, original, "utf8");

    let error;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "activate",
        "vendor.router",
        "--workflow",
        "review-workflow",
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
    assert.match(error.stderr, /Control update would not be usable/);
    assert.match(error.stderr, /source github\.vendor\.skills is unreviewed/);
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli review install-unit lets reviewed external skills be activated", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-review-install-unit-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(
      configPath,
      `version: 1
skills:
  vendor.router:
    path: vendor/router
    status: candidate
    invocation: manual-only
    exposure: exported
    owner_install_unit: github.vendor.skills
workflows:
  review-workflow:
    harness: codex
    active_skills: []
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
    trust_level: unreviewed
    permission_risk: medium
`,
      "utf8"
    );

    let activationError;
    try {
      await execFileAsync(process.execPath, [
        "bin/skillboard.mjs",
        "activate",
        "vendor.router",
        "--workflow",
        "review-workflow",
        "--mode",
        "workflow-auto",
        "--config",
        configPath,
        "--skills",
        join(root, "skills")
      ]);
    } catch (caught) {
      activationError = caught;
    }
    assert.equal(activationError.code, 1);
    assert.match(activationError.stderr, /source github\.vendor\.skills is unreviewed/);

    const review = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "review",
      "install-unit",
      "github.vendor.skills",
      "--trust-level",
      "reviewed",
      "--config",
      configPath,
      "--skills",
      join(root, "skills")
    ]);
    const activate = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "activate",
      "vendor.router",
      "--workflow",
      "review-workflow",
      "--mode",
      "workflow-auto",
      "--config",
      configPath,
      "--skills",
      join(root, "skills")
    ]);
    const canUse = await execFileAsync(process.execPath, [
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
    const payload = JSON.parse(canUse.stdout);

    assert.match(review.stdout, /Reviewed install unit github\.vendor\.skills as reviewed/);
    assert.match(activate.stdout, /Activated vendor\.router/);
    assert.equal(payload.allowed, true);
    assert.equal(payload.automaticAllowed, true);
    assert.match(await readFile(configPath, "utf8"), /trust_level: reviewed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli activate refuses reviewed blocked runtime skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-activate-blocked-test-"));
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
workflows:
  review-workflow:
    harness: codex
    active_skills: []
    blocked_skills: []
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
        "activate",
        "omo.blocked",
        "--workflow",
        "review-workflow",
        "--mode",
        "manual-only",
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

test("cli review install-unit blocked trust disables the install unit", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-review-install-unit-block-test-"));
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
    enabled: true
    trust_level: reviewed
    permission_risk: medium
`,
      "utf8"
    );

    const review = await execFileAsync(process.execPath, [
      "bin/skillboard.mjs",
      "review",
      "install-unit",
      "github.vendor.skills",
      "--trust-level",
      "blocked",
      "--config",
      configPath,
      "--skills",
      join(root, "skills")
    ]);
    const config = await readFile(configPath, "utf8");

    assert.match(review.stdout, /Reviewed install unit github\.vendor\.skills as blocked/);
    assert.match(config, /trust_level: blocked/);
    assert.match(config, /enabled: false/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
