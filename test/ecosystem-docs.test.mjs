import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { STATUS_VALUES } from "../src/domain/constants.mjs";

test("CONTRIBUTING.md exists and covers development workflow", async () => {
  const text = await readFile(resolve("CONTRIBUTING.md"), "utf8");

  assert.match(text, /Development Environment/);
  assert.match(text, /Running Tests/);
  assert.match(text, /Adding a Built-In Source Profile/);
  assert.match(text, /npm run check/);
});

test("docs/profiles.md exists and explains source profile authoring", async () => {
  const text = await readFile(resolve("docs/profiles.md"), "utf8");

  assert.match(text, /Profile YAML Structure/);
  assert.match(text, /How to Add a Built-In Profile/);
  assert.match(text, /skill_paths/);
  assert.match(text, /path_rules/);
});

test("docs/profiles.md documents supported source profile default statuses", async () => {
  const text = await readFile(resolve("docs/profiles.md"), "utf8");

  assert.doesNotMatch(text, /Default skill `status`: `installed`/);
  for (const status of ["discovered", "vendor", "candidate", "active", "quarantined", "blocked", "deprecated"]) {
    assert.equal(STATUS_VALUES.has(status), true);
    assert.match(text, new RegExp(`\\b${status}\\b`));
  }
});

test("docs plan index matches completed MVP plan state", async () => {
  const text = await readFile(resolve("docs/plans/README.md"), "utf8");

  assert.match(text, /20260625-080025-skillboard-mvp-review\.md.+Status: completed/s);
  assert.doesNotMatch(text, /20260625-080025-skillboard-mvp-review\.md.+Status: pending/s);
});

test("docs/capabilities.md exists and explains global vs workflow-scoped capabilities", async () => {
  const text = await readFile(resolve("docs/capabilities.md"), "utf8");

  assert.match(text, /Global Capability Catalog/);
  assert.match(text, /Workflow-Scoped Requirements/);
  assert.match(text, /Resolution Flow/);
  assert.match(text, /canonical/);
  assert.match(text, /required_capabilities/);
});

test("docs/versioning.md documents tag-based npm release automation", async () => {
  const text = await readFile(resolve("docs/versioning.md"), "utf8");

  assert.match(text, /Release Checklist/);
  assert.match(text, /npm Trusted Publisher/);
  assert.match(text, /agent-skillboard/);
  assert.match(text, /NyXXiR\/skillboard/);
  assert.match(text, /publish\.yml/);
  assert.match(text, /npm publish/);
  assert.match(text, /npm trust github agent-skillboard/);
  assert.match(text, /package settings page/);
  assert.match(text, /GitHub Actions trusted publisher/);
  assert.match(text, /exactly matches `package\.json`/);
  assert.match(text, /skips `npm publish` only when that exact version already exists on npm/);
});

test("README distinguishes global and source-tree command forms", async () => {
  const text = await readFile(resolve("README.md"), "utf8");

  assert.match(text, /node bin\/skillboard\.mjs/);
  assert.match(text, /npm install -g agent-skillboard/);
  assert.match(text, /replace `skillboard ` with `node bin\/skillboard\.mjs `/);
});

test("README shows the architecture diagram from a GitHub-hosted asset", async () => {
  const text = await readFile(resolve("README.md"), "utf8");

  assert.match(text, /SkillBoard architecture diagram/);
  assert.match(text, /https:\/\/raw\.githubusercontent\.com\/NyXXiR\/skillboard\/main\/skillboard\.png/);
});

test("README and install docs lead with npm quick start after registry publish", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const install = await readFile(resolve("docs/install.md"), "utf8");

  assert.match(readme, /## 5-Minute Quick Start/);
  assert.match(readme, /npx agent-skillboard init/);
  assert.match(readme, /npx agent-skillboard brief/);
  assert.match(readme, /npx agent-skillboard doctor --summary/);
  assert.match(readme, /npx agent-skillboard init --dir \/path\/to\/your\/project/);
  assert.match(readme, /Unreleased GitHub builds/);
  assert.match(readme, /npx --yes --package github:NyXXiR\/skillboard skillboard init/);
  assert.match(readme, /git clone https:\/\/github\.com\/NyXXiR\/skillboard\.git/);
  assert.match(readme, /node bin\/skillboard\.mjs init --dir \/path\/to\/your\/project/);
  assert.match(readme, /node bin\/skillboard\.mjs brief --dir \/path\/to\/your\/project/);
  assert.match(readme, /node bin\/skillboard\.mjs doctor --dir \/path\/to\/your\/project --summary/);

  assert.match(install, /## Install From npm/);
  assert.match(install, /npx agent-skillboard init/);
  assert.match(install, /npx agent-skillboard brief/);
  assert.match(install, /npx agent-skillboard doctor --summary/);
  assert.match(install, /npx --yes --package agent-skillboard skillboard init/);
  assert.match(install, /npm exec --yes --package agent-skillboard -- skillboard init/);
  assert.match(install, /## Run Unreleased Builds From GitHub/);
  assert.match(install, /npx --yes --package github:NyXXiR\/skillboard skillboard init/);
  assert.match(install, /npm exec --yes --package github:NyXXiR\/skillboard -- skillboard init/);
  assert.match(install, /## Install From A Clone/);
  assert.doesNotMatch(install, /not published yet/i);
});

test("project dogfoods AGENTS.md and CLAUDE.md bridge files", async () => {
  const agents = await readFile(resolve("AGENTS.md"), "utf8");
  const claude = await readFile(resolve("CLAUDE.md"), "utf8");

  assert.match(agents, /<!-- BEGIN SKILLBOARD -->/);
  assert.match(agents, /<!-- END SKILLBOARD -->/);
  assert.match(claude, /<!-- BEGIN SKILLBOARD -->/);
  assert.match(claude, /<!-- END SKILLBOARD -->/);
});

test("project dogfoods skillboard.config.yaml", async () => {
  const config = await readFile(resolve("skillboard.config.yaml"), "utf8");

  assert.match(config, /version: 1/);
  assert.match(config, /invocation_policy: deny-by-default/);
});
