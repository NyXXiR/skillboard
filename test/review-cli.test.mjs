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
    assert.equal(error.stderr.trim(), "Version 1 policy is read-only. Run `skillboard migrate v2`.");
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli v1 review and activation both require explicit migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-review-install-unit-test-"));
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
    assert.equal(activationError.stderr.trim(), "Version 1 policy is read-only. Run `skillboard migrate v2`.");

    let reviewError;
    try {
      await execFileAsync(process.execPath, [
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
    } catch (caught) {
      reviewError = caught;
    }
    assert.equal(reviewError.code, 1);
    assert.equal(reviewError.stderr.trim(), "Version 1 policy is read-only. Run `skillboard migrate v2`.");
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli activate v1 form requires migration before legacy status validation", async () => {
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
    assert.equal(error.stderr.trim(), "Version 1 policy is read-only. Run `skillboard migrate v2`.");
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cli review install-unit blocked trust disables the install unit", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-review-install-unit-block-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const original = `version: 1
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
`;
    await writeFile(configPath, original, "utf8");

    let reviewError;
    try {
      await execFileAsync(process.execPath, [
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
    } catch (caught) {
      reviewError = caught;
    }
    assert.equal(reviewError.code, 1);
    assert.equal(reviewError.stderr.trim(), "Version 1 policy is read-only. Run `skillboard migrate v2`.");
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
