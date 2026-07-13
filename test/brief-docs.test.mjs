import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { initProject } from "../src/index.mjs";
import { bridgeBlock } from "../src/lifecycle-content.mjs";

test("markdown and generated bridges use LF and the canonical v2 guidance", async () => {
  const attributes = await readFile(".gitattributes", "utf8");
  assert.match(attributes, /^\*\.md\s+text\s+eol=lf$/m);

  const root = await mkdtemp(join(tmpdir(), "skillboard-v2-bridge-"));
  try {
    await initProject({ root, scanInstalled: false });
    const expected = `${bridgeBlock()}\n`;
    for (const file of [join(root, "AGENTS.md"), join(root, "CLAUDE.md"), "AGENTS.md", "CLAUDE.md"]) {
      assert.equal(await readFile(file, "utf8"), expected);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated bridge teaches route guard policy change and stale-v1 migration", () => {
  const text = bridgeBlock();
  assert.match(text, /enabled/);
  assert.match(text, /scope/);
  assert.match(text, /preference[^.]*never changes availability/i);
  assert.match(text, /brief --intent/);
  assert.match(text, /guard use/);
  assert.match(text, /apply-action <action-id>/);
  assert.match(text, /one confirmation/i);
  assert.match(text, /skillboard migrate v2/);
  assert.match(text, /runtime and action authorization are outside/i);
  assert.doesNotMatch(text, /trust|quarantin|exposure|install-unit/i);
});

test("generated bridge does not pre-prompt allowed use or treat audit as policy", () => {
  const text = bridgeBlock();
  assert.match(text, /Do not ask for another approval when guard allows use/i);
  assert.match(text, /audit metadata and never\s+determine availability/i);
  assert.doesNotMatch(text, /ask (?:the user )?for approval when the guard allows/i);
});
