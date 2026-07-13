import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { canUseSkill } from "../src/control/can-use-guard.mjs";
import { routeSkill } from "../src/route.mjs";
import { loadWorkspace } from "../src/workspace.mjs";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../bin/skillboard.mjs", import.meta.url));

function workspace(overrides = {}) {
  return {
    version: 2,
    inventory: {
      integrityErrors: [],
      skillIds: ["global", "scoped", "disabled", "other"],
      skills: [
        observed("global", ["codex"]), observed("scoped", ["codex"]),
        observed("disabled", ["codex"]), observed("other", ["hermes"])
      ]
    },
    workflows: [],
    installedSkills: [
      { id: "global", name: "Global", description: "write tests", path: "global" },
      { id: "scoped", name: "Scoped", description: "write tests", path: "scoped" },
      { id: "disabled", name: "Disabled", description: "write tests", path: "disabled" },
      { id: "other", name: "Other", description: "write tests", path: "other" }
    ],
    skills: [
      { id: "global", enabled: true, shared: false, preference: { intents: ["tests"], priority: 1 } },
      { id: "scoped", enabled: true, shared: false, preference: { intents: ["tests"], priority: 9 } },
      { id: "disabled", enabled: false, shared: false, preference: { intents: ["tests"], priority: 99 } },
      { id: "other", enabled: true, shared: true, preference: { intents: ["tests"], priority: 50 } }
    ],
    ...overrides
  };
}

test("v2 guard authorizes only inventory integrity, enabled, and current-agent presence", () => {
  const base = workspace();
  assert.equal(canUseSkill(base, "global", undefined, "codex").allowed, true);
  assert.equal(canUseSkill(base, "other", undefined, "hermes").allowed, true);
  assert.match(canUseSkill(base, "other", undefined, "codex").reasons.join("\n"), /not installed for agent codex/);
  assert.match(canUseSkill(base, "disabled", undefined, "codex").reasons.join("\n"), /disabled/);
  const missing = canUseSkill(base, "missing", undefined, "codex");
  assert.equal(missing.integrityError, true);
  assert.match(missing.reasons.join("\n"), /inventory.*missing/i);
});

test("v2 guard and route fail closed when the current agent is missing or unsupported", () => {
  const base = workspace();
  const missingAgent = canUseSkill(base, "other");
  assert.equal(missingAgent.allowed, false);
  assert.match(missingAgent.reasons.join("\n"), /current agent is required/i);

  const unsupportedAgent = canUseSkill(base, "global", undefined, "unknown-agent");
  assert.equal(unsupportedAgent.allowed, false);
  assert.match(unsupportedAgent.reasons.join("\n"), /unsupported agent/i);

  const route = routeSkill(base, { intent: "write tests" });
  assert.equal(route.recommended_skill, null);
  assert.doesNotMatch(JSON.stringify(route), /"guard_allowed":true/);
});

test("v2 guard reports malformed or stale inventory separately from policy denial", () => {
  const malformed = canUseSkill(workspace({ inventory: { integrityErrors: ["digest read failed"], skillIds: ["global"] } }), "global", undefined, "codex");
  assert.equal(malformed.allowed, false);
  assert.equal(malformed.integrityError, true);
  assert.match(malformed.reasons.join("\n"), /digest read failed/);

  const stale = canUseSkill(workspace({ inventory: { integrityErrors: [], skillIds: [] } }), "global", undefined, "codex");
  assert.equal(stale.integrityError, true);
  assert.match(stale.reasons.join("\n"), /inventory.*global/i);
});

test("v2 guard ignores trust, risk, digest, legacy policy, capabilities, and conflicts", () => {
  const noisy = workspace({
    inventory: {
      integrityErrors: [],
      skillIds: ["global", "scoped", "disabled", "other"],
      skills: [observed("global", ["codex"]), observed("scoped", ["codex"]), observed("disabled", ["codex"]), observed("other", ["hermes"])],
      trust: "blocked",
      permissionRisk: "high",
      digest: "changed"
    },
    installUnits: [{ id: "blocked", enabled: false, trustLevel: "blocked" }],
    capabilities: [{ name: "tests", canonical: "other" }]
  });
  Object.assign(noisy.skills[0], {
    status: "quarantined", invocation: "blocked", exposure: "private", conflictsWith: ["scoped"]
  });
  assert.equal(canUseSkill(noisy, "global", undefined, "codex").allowed, true);
});

test("v2 route and guard agree, rank preferences without widening agent presence, and honor explicit allowed selection", () => {
  const base = workspace();
  const daily = routeSkill(base, { intent: "write tests", agent: "codex" });
  assert.equal(daily.recommended_skill, "scoped");
  assert.equal(daily.guard.allowed, true);
  assert.deepEqual(daily.route_candidates.map(({ skill, guard_allowed }) => [skill, guard_allowed]), [
    ["scoped", true], ["global", true]
  ]);
  assert.equal(daily.policy_memory.selected_skill, "scoped");
  assert.equal(daily.post_use_policy_suggestion, null);

  const globalOnly = routeSkill(base, { intent: "write tests", agent: "hermes" });
  assert.equal(globalOnly.recommended_skill, "other");
  assert.equal(globalOnly.guard.allowed, true);

  const explicit = routeSkill(base, { intent: "use global to write tests", agent: "codex" });
  assert.equal(explicit.recommended_skill, "global");
  assert.equal(explicit.guard.allowed, true);
  assert.equal(explicit.match_source, "explicit-skill");

  const noMatch = routeSkill(base, { intent: "translate a document", agent: "codex" });
  assert.equal(noMatch.recommended_skill, null);
});

test("v2 ambiguous allowed route asks after use and can remember an intent preference", () => {
  const base = workspace({
    skills: [
      { id: "global", enabled: true, shared: false, preference: null },
      { id: "scoped", enabled: true, shared: false, preference: null },
      { id: "disabled", enabled: false, shared: false, preference: null },
      { id: "other", enabled: true, shared: true, preference: null }
    ]
  });
  const route = routeSkill(base, {
    intent: "write tests", agent: "codex", configPath: "custom.yaml", skillsRoot: "custom-skills"
  });
  assert.equal(route.recommended_skill, "global");
  assert.equal(route.overlap_resolution.mode, "permissive-routing");
  assert.equal(route.policy_memory, null);
  assert.equal(route.post_use_policy_suggestion.timing, "after_use");
  assert.equal(route.post_use_policy_suggestion.requires_confirmation, true);
  assert.deepEqual(route.post_use_policy_suggestion.suggested_policy, {
    kind: "prefer-skill",
    skill: "global",
    workflow: null,
    intent: "write tests",
    command_hint: "skillboard skill preference global --intent 'write tests' --priority 100 --config custom.yaml --skills custom-skills"
  });
  assert.equal(route.usage_disclosure.confirmation_required, false);
  assert.match(route.post_use_policy_suggestion.question, /Should I remember global/);
});

test("v2 workspace loads the generated inventory index used by guard and route", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-guard-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(configPath, "version: 2\nskills:\n  global:\n    enabled: true\n    shared: false\n", "utf8");
    await mkdir(join(root, ".skillboard"));
    await writeFile(join(root, ".skillboard", "inventory.json"), JSON.stringify({
      format_version: 1,
      generated: true,
      authoritative_for_availability: false,
      skills: [{ id: "global", path: "global", owner_install_unit: "plugin.x", installed_on: ["codex"] }],
      install_units: []
    }), "utf8");
    const loaded = await loadWorkspace({ configPath });
    assert.deepEqual(loaded.inventory, {
      path: join(root, ".skillboard", "inventory.json"),
      integrityErrors: [],
      skillIds: ["global"],
      skills: [{ id: "global", path: "global", owner_install_unit: "plugin.x", installed_on: ["codex"] }],
      installUnits: []
    });
    assert.equal(canUseSkill(loaded, "global", undefined, "codex").allowed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 workspace converts malformed generated inventory into an integrity verdict", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-guard-malformed-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    await writeFile(configPath, "version: 2\nskills:\n  global:\n    enabled: true\n    shared: false\n", "utf8");
    await mkdir(join(root, ".skillboard"));
    await writeFile(join(root, ".skillboard", "inventory.json"), "{not-json", "utf8");
    const loaded = await loadWorkspace({ configPath });
    const result = canUseSkill(loaded, "global", undefined, "codex");
    assert.equal(result.allowed, false);
    assert.equal(result.integrityError, true);
    assert.match(result.reasons.join("\n"), /invalid JSON/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 CLI accepts user-level policy and denies a skill absent from the selected agent", async () => {
  const root = await cliFixture(2);
  try {
    for (const args of [
      ["guard", "use", "global", "--agent", "codex"],
      ["can-use", "global", "--agent", "codex"],
      ["route", "use global", "--agent", "codex"]
    ]) {
      const result = await runCli([...args, "--config", join(root, "skillboard.config.yaml"), "--json"]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed ?? JSON.parse(result.stdout).guard.allowed, true);
    }
    const denied = await runCli(["guard", "use", "other", "--agent", "codex", "--config", join(root, "skillboard.config.yaml"), "--json"]);
    assert.equal(denied.code, 2);
    assert.doesNotMatch(denied.stderr, /Usage:/);
    assert.match(denied.stdout, /not installed for agent codex/);

    for (const args of [["guard", "use", "global"], ["can-use", "global"], ["route", "use global"]]) {
      const missingAgent = await runCli([...args, "--config", join(root, "skillboard.config.yaml")]);
      assert.equal(missingAgent.code, 1);
      assert.match(missingAgent.stderr, /version 2.*--agent/i);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v1 CLI still requires workflow before guard, can-use, and route", async () => {
  const root = await cliFixture(1);
  try {
    for (const args of [["guard", "use", "global"], ["can-use", "global"], ["route", "use global"]]) {
      const result = await runCli([...args, "--config", join(root, "skillboard.config.yaml")]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Usage: skillboard (?:guard use|can-use|route).*--workflow <name>/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function cliFixture(version) {
  const root = await mkdtemp(join(tmpdir(), `skillboard-v${version}-cli-`));
  if (version === 1) {
    await writeFile(join(root, "skillboard.config.yaml"), "version: 1\nskills: {}\n", "utf8");
    return root;
  }
  await writeFile(join(root, "skillboard.config.yaml"), `version: 2
skills:
  global:
    enabled: true
    shared: false
  other:
    enabled: true
    shared: true
`, "utf8");
  await mkdir(join(root, ".skillboard"));
  await writeFile(join(root, ".skillboard", "inventory.json"), JSON.stringify({
    format_version: 1, generated: true, authoritative_for_availability: false,
    skills: [
      { id: "global", path: "global", owner_install_unit: "codex.user-skills", installed_on: ["codex"] },
      { id: "other", path: "other", owner_install_unit: "hermes.user-skills", installed_on: ["hermes"] }
    ], install_units: []
  }), "utf8");
  return root;
}

function observed(id, installedOn) {
  return { id, path: id, owner_install_unit: `${installedOn[0]}.user-skills`, installed_on: installedOn };
}

async function runCli(args) {
  try {
    const result = await execFileAsync(process.execPath, [CLI, ...args]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}
