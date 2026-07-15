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

test("v2 never interprets request text and exposes raw model selection context", () => {
  const base = workspace();
  const requests = [
    "write tests",
    "global을 사용해서 번역해줘",
    "한국어 라우팅 및 v2 마이그레이션을 검토해줘"
  ];

  const routes = requests.map((intent) => routeSkill(base, { intent, agent: "codex" }));
  for (const route of routes) {
    assert.equal(route.selection_mode, "model");
    assert.equal(route.recommended_skill, null);
    assert.equal(route.model_selection_required, true);
    assert.equal(route.match_source, "none");
    assert.deepEqual(route.matched_terms, []);
    assert.deepEqual(route.route_candidates, []);
    assert.deepEqual(route.candidates, []);
    assert.equal(route.guard, null);
    assert.equal(route.guard_command, null);
    assert.deepEqual(route.possible_skills, [
      {
        id: "global", name: "Global", description: "write tests", path: "global",
        preference: { intents: ["tests"], priority: 1 }, allowed: true
      },
      {
        id: "scoped", name: "Scoped", description: "write tests", path: "scoped",
        preference: { intents: ["tests"], priority: 9 }, allowed: true
      }
    ]);
  }

  const [firstContext, ...otherContexts] = routes.map(({ intent: _intent, ...route }) => route);
  for (const context of otherContexts) {
    assert.deepEqual(context, firstContext);
  }
});

test("v2 exposes raw preferences without widening current-agent presence", () => {
  const base = workspace();
  const daily = routeSkill(base, { intent: "write tests", agent: "codex" });
  assert.equal(daily.recommended_skill, null);
  assert.equal(daily.guard, null);
  assert.deepEqual(daily.possible_skills.map(({ id, preference }) => ({ id, preference })), [
    { id: "global", preference: { intents: ["tests"], priority: 1 } },
    { id: "scoped", preference: { intents: ["tests"], priority: 9 } }
  ]);

  const globalOnly = routeSkill(base, { intent: "write tests", agent: "hermes" });
  assert.equal(globalOnly.recommended_skill, null);
  assert.deepEqual(globalOnly.possible_skills.map(({ id }) => id), ["other"]);

  const explicit = routeSkill(base, { intent: "use global to write tests", agent: "codex" });
  assert.equal(explicit.recommended_skill, null);
  assert.equal(explicit.match_source, "none");

  const koreanSuffixedExplicit = routeSkill(base, {
    intent: "global을 사용해서 번역해줘", agent: "codex"
  });
  assert.equal(koreanSuffixedExplicit.recommended_skill, null);
  assert.equal(koreanSuffixedExplicit.match_source, "none");
  assert.deepEqual(koreanSuffixedExplicit.possible_skills, daily.possible_skills);

  assert.equal(canUseSkill(base, "global", undefined, "codex").allowed, true);
});

test("v2 model selection context has no pre-ranked candidates or policy memory", () => {
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
  assert.equal(route.recommended_skill, null);
  assert.equal(route.model_selection_required, true);
  assert.equal(route.overlap_resolution, null);
  assert.equal(route.policy_memory, null);
  assert.equal(route.post_use_policy_suggestion, null);
  assert.equal(route.usage_disclosure, null);
  assert.deepEqual(route.route_candidates, []);
  assert.deepEqual(route.possible_skills.map(({ id }) => id), ["global", "scoped"]);
});

test("v2 leaves metadata-only semantic selection to the active model", () => {
  const base = workspace({
    installedSkills: [
      {
        id: "global", name: "Global", path: "global",
        description: "한국어 트리거 작업 로그와 완료 기록 요청"
      },
      {
        id: "scoped", name: "Scoped", path: "scoped",
        description: "한국어 트리거 유튜브 쇼츠와 나레이션 요청"
      }
    ],
    inventory: {
      integrityErrors: [], skillIds: ["global", "scoped"],
      skills: [observed("global", ["codex"]), observed("scoped", ["codex"])]
    },
    skills: [
      { id: "global", enabled: true, shared: false, preference: null },
      { id: "scoped", enabled: true, shared: false, preference: null }
    ]
  });

  const route = routeSkill(base, {
    intent: "한국어 라우팅 및 v2 마이그레이션을 검토해줘", agent: "codex"
  });

  assert.equal(route.recommended_skill, null);
  assert.equal(route.model_selection_required, true);
  assert.equal(route.match_source, "none");
  assert.deepEqual(route.route_candidates, []);
  assert.deepEqual(route.possible_skills.map(({ id, description }) => ({ id, description })), [
    { id: "global", description: "한국어 트리거 작업 로그와 완료 기록 요청" },
    { id: "scoped", description: "한국어 트리거 유튜브 쇼츠와 나레이션 요청" }
  ]);
  assert.equal(route.guard, null);
  assert.equal(route.guard_command, null);
  assert.equal(route.usage_disclosure, null);
  assert.equal(route.post_use_policy_suggestion, null);
  assert.match(route.recommendation_reason, /does not interpret v2 request text/i);
});

test("v2 leaves explicit-looking text and metadata alternatives to the model", () => {
  const base = workspace({
    installedSkills: [
      { id: "global", name: "Global", description: "routing control", path: "global" },
      { id: "scoped", name: "Scoped", description: "translate documents", path: "scoped" }
    ],
    inventory: {
      integrityErrors: [], skillIds: ["global", "scoped"],
      skills: [observed("global", ["codex"]), observed("scoped", ["codex"])]
    },
    skills: [
      { id: "global", enabled: true, shared: false, preference: null },
      { id: "scoped", enabled: true, shared: false, preference: null }
    ]
  });

  const route = routeSkill(base, {
    intent: "global을 사용해서 문서를 translate 해줘", agent: "codex"
  });

  assert.equal(route.recommended_skill, null);
  assert.equal(route.match_source, "none");
  assert.deepEqual(route.route_candidates, []);
  assert.deepEqual(route.possible_skills.map(({ id, description }) => ({ id, description })), [
    { id: "global", description: "routing control" },
    { id: "scoped", description: "translate documents" }
  ]);
  assert.deepEqual(route.fallback_skills, []);
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
      ["can-use", "global", "--agent", "codex"]
    ]) {
      const result = await runCli([...args, "--config", join(root, "skillboard.config.yaml"), "--json"]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed, true);
    }
    const routed = await runCli([
      "route", "use global", "--agent", "codex",
      "--config", join(root, "skillboard.config.yaml"), "--json"
    ]);
    assert.equal(routed.code, 0, routed.stderr);
    const route = JSON.parse(routed.stdout);
    assert.equal(route.selection_mode, "model");
    assert.equal(route.recommended_skill, null);
    assert.equal(route.guard, null);
    assert.deepEqual(route.possible_skills.map(({ id }) => id), ["global"]);
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
      assert.match(
        result.stderr,
        /Usage: skillboard (?:guard use|can-use|route).*--agent <name> \(v2 policy\).*--workflow <name> \(v1 policy\)/
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI explains v1 and v2 selector flag mismatches", async () => {
  const commands = [
    ["route", "use global"],
    ["can-use", "global"],
    ["guard", "use", "global"]
  ];
  const v1Root = await cliFixture(1);
  const v2Root = await cliFixture(2);
  try {
    const v1Config = join(v1Root, "skillboard.config.yaml");
    const v2Config = join(v2Root, "skillboard.config.yaml");
    const expectedV1ConfigArgument = process.platform === "win32"
      ? `"${v1Config.replace(/"/g, '""')}"`
      : v1Config;
    for (const args of commands) {
      const v1Mismatch = await runCli([...args, "--agent", "codex", "--config", v1Config]);
      assert.equal(v1Mismatch.code, 1, v1Mismatch.stderr);
      assert.match(v1Mismatch.stderr, /workspace uses a version 1 policy/i);
      assert.match(v1Mismatch.stderr, /--workflow <name>/);
      assert.match(
        v1Mismatch.stderr,
        new RegExp(`skillboard migrate v2 --config ${escapeRegExp(expectedV1ConfigArgument)} --json`)
      );

      const v2Mismatch = await runCli([...args, "--workflow", "legacy", "--config", v2Config]);
      assert.equal(v2Mismatch.code, 1, v2Mismatch.stderr);
      assert.match(v2Mismatch.stderr, /workspace uses a version 2 policy/i);
      assert.match(v2Mismatch.stderr, /--agent <name>/);
      assert.match(v2Mismatch.stderr, /instead of --workflow/i);
    }
  } finally {
    await rm(v1Root, { recursive: true, force: true });
    await rm(v2Root, { recursive: true, force: true });
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
