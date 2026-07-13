import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildSkillBrief } from "../src/advisor.mjs";
import { applyAdvisorAction, ApplyActionError } from "../src/advisor/apply-action.mjs";
import { V1_COMPATIBILITY_NOTICE, V1_COMPATIBILITY_REMOVAL_VERSION } from "../src/compatibility.mjs";
import { canUseSkill } from "../src/control.mjs";
import { doctorProject } from "../src/doctor.mjs";
import { renderDashboard } from "../src/report.mjs";
import { loadWorkspace } from "../src/workspace.mjs";
import { buildGuardHookInstallPlan, assertGuardHookPlanIsInstallable } from "../src/hook-plan.mjs";
import { renderLockfile } from "../src/source-verification.mjs";
import * as publicApi from "../src/index.mjs";

const execFileAsync = promisify(execFile);

test("v2 brief, guard, doctor, and dashboard share enabled/agent-sharing semantics and keep audit informational", async () => {
  await withV2Fixture(async ({ root, configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    assert.equal(canUseSkill(workspace, "global.on", undefined, "codex").allowed, true);
    assert.equal(canUseSkill(workspace, "scoped.on", undefined, "hermes").allowed, true);
    assert.equal(canUseSkill(workspace, "global.on", undefined, "hermes").allowed, false);
    assert.equal(canUseSkill(workspace, "global.off", undefined, "codex").allowed, false);

    const brief = await buildSkillBrief({ root, configPath, skillsRoot, agent: "codex", includeActions: true });
    assert.deepEqual(
      [...brief.skills.manual_allowed, ...brief.skills.automatic_allowed].map((entry) => entry.id).sort(),
      ["global.on", "scoped.on"]
    );
    assert.deepEqual(brief.skills.blocked.map((entry) => entry.id), ["global.off"]);
    assert.deepEqual(brief.review_queue, []);
    assert.equal(brief.actions.some((action) => /trust|review-install-unit/.test(action.kind)), false);

    const doctor = await doctorProject({ root, configPath, skillsRoot, workspace });
    assert.equal(doctor.config.version, 2);
    assert.equal(doctor.reviewRequired, false);
    assert.equal(doctor.workspace.skills.enabled, 2);
    assert.equal(doctor.workspace.skills.disabled, 1);

    const dashboard = renderDashboard(workspace);
    assert.match(dashboard, /`global\.on`.*enabled.*agent-local/);
    assert.match(dashboard, /`scoped\.on`.*enabled.*shared across agents/);
    assert.match(dashboard, /`global\.off`.*disabled/);
    assert.doesNotMatch(dashboard, /Invocation policy|Trust level/);

    await assert.rejects(
      buildGuardHookInstallPlan({ configPath, skillsRoot, workflow: "release" }),
      /Unknown workflow: release/
    );

    const lock = await renderLockfile(workspace, { generatedAt: "2026-07-13T00:00:00.000Z" });
    assert.match(lock, /policy_projection_version: 2/);
    assert.match(lock, /enabled: true/);
    assert.doesNotMatch(lock, /trust_level|invocation|exposure/);

    const beforeAudit = canUseSkill(workspace, "global.on", undefined, "codex");
    const inventoryPath = join(root, ".skillboard", "inventory.json");
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
    inventory.skills[0].audit = { source: "changed", trust_level: "blocked", digest: "mismatch" };
    await writeFile(inventoryPath, JSON.stringify(inventory));
    const afterAudit = canUseSkill(await loadWorkspace({ configPath, skillsRoot }), "global.on", undefined, "codex");
    assert.deepEqual(afterAudit, beforeAudit);

    await assert.rejects(
      execFileAsync(process.execPath, ["bin/skillboard.mjs", "guard", "use", "global.on", "--config", configPath, "--skills", skillsRoot], {
        cwd: process.cwd(), env: { ...process.env, SKILLBOARD_POLICY_PROJECTION_VERSION: "1" }
      }),
      isStaleProjectionCliError
    );

    const directArgs = ["bin/skillboard.mjs", "guard", "use", "global.on", "--agent", "codex", "--config", configPath, "--skills", skillsRoot, "--json"];
    const directBefore = JSON.parse((await execFileAsync(process.execPath, directArgs, { cwd: process.cwd() })).stdout);
    const audit = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "audit", "sources", "--config", configPath, "--skills", skillsRoot, "--json"], { cwd: process.cwd() });
    assert.equal(JSON.parse(audit.stdout).ok, true);
    const directAfter = JSON.parse((await execFileAsync(process.execPath, directArgs, { cwd: process.cwd() })).stdout);
    assert.deepEqual(directAfter, directBefore);

    const historicalHook = join(root, "historical-v1-hook.sh");
    await writeFile(historicalHook, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} bin/skillboard.mjs guard use "$SKILLBOARD_SKILL_ID" --workflow release --config ${JSON.stringify(configPath)} --skills ${JSON.stringify(skillsRoot)}\n`);
    await chmod(historicalHook, 0o755);
    await assert.rejects(
      execFileAsync(historicalHook, [], { cwd: process.cwd(), env: { ...process.env, SKILLBOARD_SKILL_ID: "global.on" } }),
      (error) => error instanceof Error && /pre-v2 policy projection is stale/i.test(/** @type {Error & {stderr?: string}} */ (error).stderr ?? "")
    );
  });
});

test("v1 reads expose one bounded notice and mutations refuse the exact migration command", async () => {
  await withV1Fixture(async ({ root, configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    assert.equal(workspace.compatibility.notice, V1_COMPATIBILITY_NOTICE);
    assert.equal(workspace.compatibility.removalVersion, V1_COMPATIBILITY_REMOVAL_VERSION);

    const brief = await buildSkillBrief({ root, configPath, skillsRoot, workflow: "agent", includeActions: true });
    assert.equal(brief.compatibility.notice, V1_COMPATIBILITY_NOTICE);
    assert.equal((JSON.stringify(brief).match(/skillboard migrate v2/g) ?? []).length, 1);

    await assert.rejects(
      applyAdvisorAction("activate-skill:legacy", { root, configPath, skillsRoot, workflow: "agent", yes: true }),
      (error) => error instanceof ApplyActionError
        && error.code === "migration-required"
        && error.message === "Version 1 policy is read-only. Run `skillboard migrate v2`."
    );
    assert.match(await readFile(configPath, "utf8"), /version: 1/);
    const { plan } = await buildGuardHookInstallPlan({ configPath, skillsRoot, workflow: "agent" });
    assert.equal(plan.policy_projection_version, 1);
    assert.throws(() => assertGuardHookPlanIsInstallable(plan), /Version 1 policy is read-only.*skillboard migrate v2/);
  });
});

test("pre-v2 action identifiers fail as stale policy projections", async () => {
  await withV2Fixture(async ({ root, configPath, skillsRoot }) => {
    await assert.rejects(
      applyAdvisorAction("review-install-unit:old-source", { root, configPath, skillsRoot, workflow: "release", yes: true }),
      (error) => error instanceof ApplyActionError
        && error.code === "stale-policy-version"
        && /pre-v2 action id.*skillboard brief --include-actions/i.test(error.message)
    );
  });
});

test("lockfiles are write-only audit artifacts with no historical projection consumer", () => {
  assert.equal("readLockfile" in publicApi, false);
  assert.equal("loadLockfile" in publicApi, false);
  assert.equal(typeof publicApi.writeLockfile, "function");
});

async function withV2Fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-surface-"));
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  await mkdir(skillsRoot);
  await writeFile(configPath, `version: 2\nskills:\n  global.on:\n    enabled: true\n    shared: false\n  scoped.on:\n    enabled: true\n    shared: true\n  global.off:\n    enabled: false\n    shared: false\n`);
  await mkdir(join(root, ".skillboard"));
  await writeFile(join(root, ".skillboard", "inventory.json"), JSON.stringify({
    format_version: 1,
    generated: true,
    authoritative_for_availability: false,
    skills: [
      { id: "global.on", path: "global.on", owner_install_unit: "codex.user-skills", installed_on: ["codex"] },
      { id: "scoped.on", path: "scoped.on", owner_install_unit: "codex.user-skills", installed_on: ["codex", "hermes"] },
      { id: "global.off", path: "global.off", owner_install_unit: "codex.user-skills", installed_on: ["codex"] }
    ],
    install_units: []
  }));
  try { await run({ root, configPath, skillsRoot }); } finally { await rm(root, { recursive: true, force: true }); }
}

/** @param {unknown} error */
function isStaleProjectionCliError(error) {
  if (!(error instanceof Error)) return false;
  const processError = /** @type {Error & { code?: number, stderr?: string }} */ (error);
  return processError.code === 1 && /pre-v2 policy projection is stale/i.test(processError.stderr ?? "");
}

async function withV1Fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v1-surface-"));
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  await mkdir(skillsRoot);
  await writeFile(configPath, `version: 1\ndefaults:\n  invocation_policy: deny-by-default\nworkflows:\n  agent:\n    harness: codex\n    active_skills: [legacy]\nharnesses:\n  codex:\n    status: configured\n    workflows: [agent]\nskills:\n  legacy:\n    path: legacy\n    status: active\n    invocation: manual-only\n    exposure: exported\n`);
  try { await run({ root, configPath, skillsRoot }); } finally { await rm(root, { recursive: true, force: true }); }
}
