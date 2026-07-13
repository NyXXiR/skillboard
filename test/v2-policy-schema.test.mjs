import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadWorkspace, serializeV2Policy } from "../src/workspace.mjs";
import { checkPolicy } from "../src/policy.mjs";
import { withFixture } from "./fixtures.mjs";

test("loadWorkspace preserves version 1 read compatibility", async () => {
  // Given: the repository's representative version 1 fixture.
  await withFixture(async ({ configPath, skillsRoot }) => {
    // When: the workspace is loaded through the public parser boundary.
    const workspace = await loadWorkspace({ configPath, skillsRoot });

    // Then: the existing schema remains readable without projection to version 2.
    assert.equal(workspace.version, 1);
    assert.ok(workspace.skills.length > 0);
    assert.equal(typeof workspace.skills[0].status, "string");
  });
});

const VALID_V2 = `version: 2
skills:
  user.local:
    enabled: true
    shared: false
  user.shared:
    enabled: false
    shared: true
    preference:
      intents:
        - implementation
        - testing
      priority: 100
`;

test("loadWorkspace parses the minimal version 2 policy domain", async () => {
  await withConfig(VALID_V2, async (configPath) => {
    const workspace = await loadWorkspace({ configPath });

    assert.equal(workspace.version, 2);
    assert.deepEqual(workspace.workflows, []);
    assert.deepEqual(workspace.skills, [
      { id: "user.local", enabled: true, shared: false, preference: null },
      {
        id: "user.shared",
        enabled: false,
        shared: true,
        preference: { intents: ["implementation", "testing"], priority: 100 }
      }
    ]);
    assert.deepEqual(checkPolicy(workspace), { ok: true, errors: [], warnings: [] });
  });
});

test("version 2 serialization is byte-stable after parse and write", async () => {
  await withConfig(VALID_V2, async (configPath) => {
    const first = await loadWorkspace({ configPath });
    const serialized = serializeV2Policy(first);
    await writeFile(configPath, serialized, "utf8");
    const second = await loadWorkspace({ configPath });

    assert.equal(serializeV2Policy(second), serialized);
  });
});

test("version 1 rejects a version 2 policy entry instead of silently mixing schemas", async () => {
  const mixed = `version: 1
skills:
  legacy.skill:
    status: active
    invocation: manual-only
  modern.skill:
    enabled: true
    shared: false
`;

  await withConfig(mixed, async (configPath) => {
    await assert.rejects(
      loadWorkspace({ configPath }),
      /skills\.modern\.skill uses version 2 key enabled, shared in a version 1 config.*skillboard migrate v2/
    );
  });
});

test("version 2 rejects legacy harness and install-unit policy sections", async () => {
const mixed = `version: 2
skills: {}
harnesses: {}
install_units: {}
`;

  await withConfig(mixed, async (configPath) => {
    await assert.rejects(
      loadWorkspace({ configPath }),
      /unsupported policy section: harnesses, install_units.*skillboard migrate v2/
    );
  });
});

test("version 2 rejects path-like skill ids before file operations", async () => {
  await withConfig("version: 2\nskills:\n  suite/demo:\n    enabled: true\n    shared: false\n", async (configPath) => {
    await assert.rejects(loadWorkspace({ configPath }), /invalid skill id: suite\/demo/);
  });
});

const INVALID_V2_CASES = [
  {
    name: "missing enabled",
    entry: "shared: false",
    message: /skills\.user\.test\.enabled is required and must be a boolean/
  },
  {
    name: "missing shared",
    entry: "enabled: true",
    message: /skills\.user\.test\.shared is required and must be a boolean/
  },
  {
    name: "a non-boolean shared value",
    entry: "enabled: true\n    shared: all",
    message: /skills\.user\.test\.shared is required and must be a boolean/
  },
  {
    name: "legacy workflow scope",
    entry: "enabled: true\n    shared: false\n    scope: global",
    message: /skills\.user\.test mixes version 1 key scope with version 2 policy.*skillboard migrate v2/
  },
  {
    name: "an unknown policy key",
    entry: "enabled: true\n    shared: false\n    trust_level: trusted",
    message: /skills\.user\.test contains unsupported version 2 policy key: trust_level.*skillboard migrate v2/
  },
  {
    name: "mixed version 1 and version 2 keys",
    entry: "enabled: true\n    shared: false\n    status: active",
    message: /skills\.user\.test mixes version 1 key status with version 2 policy.*skillboard migrate v2/
  },
  {
    name: "duplicate preference intents",
    entry: "enabled: true\n    shared: false\n    preference:\n      intents: [testing, testing]\n      priority: 10",
    message: /skills\.user\.test\.preference\.intents must not contain duplicates: testing/
  }
];

for (const invalid of INVALID_V2_CASES) {
  test(`loadWorkspace rejects ${invalid.name}`, async () => {
    const text = `version: 2\nskills:\n  user.test:\n    ${invalid.entry}\n`;

    await withConfig(text, async (configPath) => {
      await assert.rejects(loadWorkspace({ configPath }), invalid.message);
    });
  });
}

async function withConfig(text, callback) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-schema-"));
  const configPath = join(root, "skillboard.config.yaml");
  try {
    await writeFile(configPath, text, "utf8");
    await callback(configPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
