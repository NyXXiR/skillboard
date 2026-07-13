import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("README leads with the two v2 policy decisions", async () => {
  const text = await readFile("README.md", "utf8");
  const quickStart = text.indexOf("## 5-Minute Quick Start");
  const policy = text.indexOf("## The v2 policy");

  assert.match(text.slice(0, quickStart), /Enable or disable/);
  assert.match(text.slice(0, quickStart), /agent-local or shared across agents/);
  assert.ok(quickStart > 0);
  assert.ok(policy > quickStart);
});

test("README gives executable install migration and cleanup paths", async () => {
  const text = await readFile("README.md", "utf8");
  for (const command of [
    "npm install -g agent-skillboard",
    "skillboard migrate v2 --config <path> --json",
    "skillboard migrate v2 --config <path> --yes --json",
    "skillboard migrate v2 --config <path> --rollback <backup> --json",
    "skillboard uninstall --user --dry-run",
    "skillboard uninstall --user --yes"
  ]) {
    assert.match(text, new RegExp(escapeRegExp(command)));
  }
});

test("README keeps audit metadata and runtime permissions outside availability", async () => {
  const text = await readFile("README.md", "utf8");
  assert.match(text, /audit metadata and never determine availability/i);
  assert.match(text, /Runtime and action\s+authorization are outside SkillBoard's scope/i);
  assert.match(text, /v0\.4\.0 removes the v1\s+reader/i);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
