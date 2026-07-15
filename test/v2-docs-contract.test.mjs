import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { bridgeBlock } from "../src/lifecycle-content.mjs";

const PRIMARY_DOCS = [
  "README.md",
  "docs/ai-skill-routing-goal.md",
  "docs/user-flow.md",
  "docs/routing.md",
  "docs/policy-model.md",
  "docs/install.md"
];

test("primary onboarding teaches only the two v2 availability decisions", async () => {
  const text = await readCombined(PRIMARY_DOCS);

  assert.match(text, /enable or disable/i);
  assert.match(text, /agent-local[^.]*shared|shared[^.]*agent-local/i);
  assert.match(text, /preference[^.]*raw (?:model )?context/i);
  assert.match(text, /preference[^.]*never[^.]*availability/i);
  assert.match(text, /installed[^.]*enabled[^.]*agent-local/i);
  assert.match(text, /runtime[^.]*authorization[^.]*outside/i);
  assert.match(text, /source[^.]*audit metadata[^.]*never[^.]*availability/i);

  for (const term of ["invocation", "exposure", "trust_level", "quarantined", "global-auto", "workflow-auto", "router-only", "manual-only"]) {
    assert.doesNotMatch(text, new RegExp(`\\b${term}\\b`, "i"), `${term} leaked into primary v2 onboarding`);
  }
});

test("generated agent bridge teaches v2 route and guard with stale-v1 migration", () => {
  const text = bridgeBlock();

  assert.match(text, /enabled/);
  assert.match(text, /sharing/);
  assert.match(text, /preference[^.]*raw context/i);
  assert.match(text, /does not tokenize, score, match, or recommend from v2 request text/i);
  assert.match(text, /skillboard migrate v2/);
  assert.match(text, /guard use/);
  assert.doesNotMatch(text, /trust|quarantin|invocation|exposure|install-unit/i);
});

test("migration docs give exact preview apply rollback commands and a bounded v1 window", async () => {
  const text = await readCombined(["README.md", "docs/reference.md", "docs/versioning.md"]);

  assert.match(text, /skillboard migrate v2 --config <path> --json/);
  assert.match(text, /skillboard migrate v2 --config <path> --yes --json/);
  assert.match(text, /skillboard migrate v2 --config <path> --rollback <backup> --json/);
  assert.match(text, /one-release read-only window/i);
  assert.match(text, /v0\.4\.0[^.]*remove[^.]*v1/i);
});

test("reference documents selector vocabulary for v1 and v2 route surfaces", async () => {
  const text = await readFile("docs/reference.md", "utf8");

  for (const command of ["route <intent>", "can-use <skill-id>", "guard use <skill-id>"]) {
    assert.match(
      text,
      new RegExp(`skillboard ${command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[^\\n]*--agent[^\\n]*v2 policy[^\\n]*--workflow[^\\n]*v1 policy`, "i")
    );
  }
});

test("primary examples use v2 policy and keep observations outside authorization", async () => {
  for (const file of ["examples/v2-multi-source.config.yaml", "examples/v2-policy-error.config.yaml"]) {
    const text = await readFile(file, "utf8");
    assert.match(text, /^version: 2$/m);
    assert.match(text, /enabled: (?:true|false)/);
    assert.match(text, /shared: (?:true|false|all)/);
    assert.doesNotMatch(text, /^\s+(?:status|invocation|exposure|trust_level|owner_install_unit):/m);
  }
});

test("operator docs teach the exact v2 mutation and trust-neutral import commands", async () => {
  const text = await readCombined(["README.md", "docs/user-flow.md", "docs/reference.md", "docs/adapters.md"]);

  assert.match(text, /skillboard skill enable <skill-id>/);
  assert.match(text, /skillboard skill disable <skill-id>/);
  assert.match(text, /skillboard skill share <skill-id>/);
  assert.match(text, /skillboard skill unshare <skill-id>/);
  assert.match(text, /skillboard skill preference <skill-id> --intent <term>\[,<term>\] --priority <integer>/);
  assert.match(text, /skillboard skill forget <skill-id>/);
  assert.match(text, /skillboard uninstall --user --dry-run/);
  assert.match(text, /skillboard uninstall --user --yes/);
  assert.match(text, /forget[^.]*never deletes skill files/i);
  assert.match(text, /skillboard import --profile <id-or-path> --source-root <dir> --config <path> --merge --dry-run/);
  assert.match(text, /import[^.]*does not[^.]*trust|trust-neutral import/i);
});

test("policy action docs identify current v2 action cards and post-apply reread", async () => {
  const text = await readCombined(["README.md", "docs/user-flow.md", "docs/reference.md"]);

  assert.match(text, /brief --include-actions --json/);
  assert.match(text, /apply-action <action-id>[^\n]*--yes --json/);
  assert.match(text, /apply-action <action-id>[^\n]*--agent <agent>/);
  assert.match(text, /post-apply brief|rereads? the (?:returned|resulting) brief/i);
});

async function readCombined(files) {
  return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
}
