import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("public docs consistently define v2 availability", async () => {
  const files = [
    "README.md",
    "docs/ai-skill-routing-goal.md",
    "docs/user-flow.md",
    "docs/routing.md",
    "docs/reference.md",
    "docs/policy-model.md",
    "docs/install.md"
  ];
  const text = await combined(files);

  assert.match(text, /enable or disable/i);
  assert.match(text, /agent-local[^.]*shared|shared[^.]*agent-local/i);
  assert.match(text, /preference[^.]*never changes availability/i);
  assert.match(text, /installed[^.]*enabled[^.]*agent-local/i);
  assert.match(text, /audit metadata and never determine availability/i);
  assert.match(text, /runtime and action authorization are outside/i);
});

test("profiles and capabilities are routing or audit helpers, not authorization", async () => {
  const profiles = await readFile("docs/profiles.md", "utf8");
  const capabilities = await readFile("docs/capabilities.md", "utf8");

  assert.match(profiles, /Profile YAML structure/i);
  assert.match(profiles, /skill_paths/);
  assert.match(profiles, /path_rules/);
  assert.match(profiles, /do not authorize availability/i);
  assert.match(capabilities, /does not use capabilities for authorization/i);
  assert.match(capabilities, /Preference ranks only and never changes availability/i);
});

test("versioning documents package release and the bounded v1 reader", async () => {
  const text = await readFile("docs/versioning.md", "utf8");

  assert.match(text, /Release checklist/i);
  assert.match(text, /publish\.yml/);
  assert.match(text, /npm publish/);
  assert.match(text, /NPM_TOKEN/);
  assert.match(text, /NODE_AUTH_TOKEN/);
  assert.match(text, /OIDC/);
  assert.match(text, /provenance/);
  assert.match(text, /one-release read-only window/i);
  assert.match(text, /v0\.4\.0 removes the v1 reader/i);
});

test("install and reference distinguish global and source-tree commands", async () => {
  const text = await combined(["README.md", "docs/install.md", "docs/reference.md"]);
  assert.match(text, /npm install -g agent-skillboard/);
  assert.match(text, /replace `skillboard ` with\s+`node bin\/skillboard\.mjs `/i);
  assert.match(text, /SUDO_USER/);
  assert.match(text, /No separate setup command is required/i);
});

test("install docs give a non-destructive multi-prefix update recovery path", async () => {
  const text = await combined(["README.md", "docs/install.md", "docs/reference.md", "docs/versioning.md"]);

  assert.match(text, /skillboard doctor --summary/);
  assert.match(text, /npm config get prefix/);
  assert.match(text, /multiple SkillBoard installations|duplicate global installs/i);
  assert.match(text, /does not automatically uninstall|never automatically uninstalls/i);
  assert.match(text, /does not automatically migrate|never automatically migrates/i);
  assert.match(text, /restart or refresh/i);
});

test("primary examples are v2 and keep old authorization axes out", async () => {
  for (const file of ["examples/v2-multi-source.config.yaml", "examples/v2-policy-error.config.yaml"]) {
    const text = await readFile(file, "utf8");
    assert.match(text, /^version: 2$/m);
    assert.match(text, /enabled: (?:true|false)/);
    assert.match(text, /shared: (?:true|false|all)/);
    assert.doesNotMatch(text, /^\s+(?:status|invocation|exposure|trust_level|owner_install_unit):/m);
  }
});

async function combined(files) {
  return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
}
