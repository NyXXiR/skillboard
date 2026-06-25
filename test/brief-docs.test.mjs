import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { initProject } from "../src/index.mjs";
import { bridgeBlock } from "../src/lifecycle-content.mjs";

const execFileAsync = promisify(execFile);

test("brief docs bridge orders brief before guard and confirmation before apply", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-docs-bridge-"));
  try {
    await initProject({ root, scanInstalled: false });
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    const bridge = bridgeBlock();

    for (const text of [agents, bridge]) {
      assertOrder(text, "skillboard brief --json", "skillboard guard use");
      assertOrder(text.toLowerCase(), "confirmation", "apply");
      assert.match(text, /action card/i);
      for (const heading of ["What your AI can use now", "Needs review", "Blocked for safety"]) {
        assert.match(text, new RegExp(escapeRegExp(heading)));
      }
      assert.doesNotMatch(text, /What needs review|What is blocked for safety/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief docs require hook dry-run json preview before hook apply", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-docs-hook-preview-"));
  try {
    await initProject({ root, scanInstalled: false });
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    const bridge = bridgeBlock();
    const docs = await combinedText(["README.md", "docs/install.md", "docs/user-flow.md", "src/lifecycle-content.mjs"]);

    for (const text of [agents, bridge, docs]) {
      assert.match(text, /hook install[\s\S]*--dry-run --json/i);
      assert.match(text, /preview/i);
      assertOrder(text, "--dry-run --json", "materialize an executable guard hook");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief docs mention AI-mediated flow and lifecycle safety terms", async () => {
  const files = [
    "README.md",
    "docs/install.md",
    "docs/user-flow.md",
    "docs/policy-model.md",
    "src/lifecycle-content.mjs"
  ];
  const text = await combinedText(files);

  for (const term of ["brief --json", "What your AI can use", "confirmation", "action card", "remove-hooks"]) {
    assert.match(text, new RegExp(escapeRegExp(term), "i"));
  }
  assert.doesNotMatch(text, /auto-trust|auto trust|deletes.*SKILL\.md|delete.*SKILL\.md/i);
});

test("brief docs help includes the brief command", async () => {
  const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "help"]);

  assert.match(result.stdout, /brief \[--workflow <name>\]/);
});

async function combinedText(files) {
  const parts = [];
  for (const file of files) {
    parts.push(await readFile(file, "utf8"));
  }
  return parts.join("\n");
}

function assertOrder(text, before, after) {
  const beforeIndex = text.indexOf(before);
  const afterIndex = text.indexOf(after);

  assert.notEqual(beforeIndex, -1, `missing ${before}`);
  assert.notEqual(afterIndex, -1, `missing ${after}`);
  assert.ok(beforeIndex < afterIndex, `${before} must appear before ${after}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
