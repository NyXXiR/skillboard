import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

test("package manifest excludes internal work artifacts from npm pack", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));

  assert.deepEqual(manifest.files, ["bin", "src", "docs", "examples", "profiles", "README.md", "LICENSE"]);
});

test("package manifest is publishable as the SkillBoard CLI", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));

  assert.equal(manifest.name, "agent-skillboard");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.bin.skillboard, "bin/skillboard.mjs");
  assert.equal(manifest.publishConfig.access, "public");
});
