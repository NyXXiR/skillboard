import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import YAML from "yaml";

import {
  V1_COMPATIBILITY_NOTICE,
  V1_COMPATIBILITY_REMOVAL_VERSION
} from "../src/compatibility.mjs";

const CURRENT_RELEASE = "0.3.0";
const V1_REMOVAL_RELEASE = "v0.4.0";
const execFileAsync = promisify(execFile);
const CLI = resolve("bin/skillboard.mjs");

test("release identity is v0.3.0 across package metadata and changelog", async () => {
  // Given: the repository release metadata.
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  const lockfile = JSON.parse(await readFile(resolve("package-lock.json"), "utf8"));
  const changelog = await readFile(resolve("CHANGELOG.md"), "utf8");

  // When: the release identities are compared.
  const identities = [manifest.version, lockfile.version, lockfile.packages[""].version];

  // Then: every publish surface identifies the v2 release as v0.3.0.
  assert.deepEqual(identities, [CURRENT_RELEASE, CURRENT_RELEASE, CURRENT_RELEASE]);
  assert.match(changelog, /^## 0\.3\.0\b/m);
});

test("v1 compatibility ends in package release v0.4.0", () => {
  // Given: the exported v1 compatibility contract.
  // When: consumers render its removal boundary.
  // Then: it names a package release, never a schema version.
  assert.equal(V1_COMPATIBILITY_REMOVAL_VERSION, V1_REMOVAL_RELEASE);
  assert.match(V1_COMPATIBILITY_NOTICE, /Support ends in package release v0\.4\.0\./);
  assert.doesNotMatch(V1_COMPATIBILITY_NOTICE, /schema version 3/i);
});

test("repository dogfood policy uses v2 with generated audit-only inventory", async () => {
  // Given: the checked-in repository dogfood artifacts.
  const policy = YAML.parse(await readFile(resolve("skillboard.config.yaml"), "utf8"));
  const inventory = JSON.parse(await readFile(resolve(".skillboard/inventory.json"), "utf8"));

  // When: their schema roles are inspected.
  // Then: policy owns availability and inventory owns observations only.
  assert.equal(policy.version, 2);
  assert.equal("workflows" in policy, false);
  assert.deepEqual(policy.skills, {});
  assert.equal(inventory.format_version, 1);
  assert.equal(inventory.authoritative_for_availability, false);
  assert.ok(Array.isArray(inventory.skills));
  assert.equal(inventory.migration?.source_document, undefined);
  assert.equal("status" in policy, false);
  assert.equal("sources" in policy, false);
  assert.equal("install_units" in policy, false);
});

test("clean checkout dogfood artifacts load together through the real brief CLI", async () => {
  // Given: only the tracked dogfood policy and generated inventory in a clean workspace.
  const root = await mkdtemp(join(tmpdir(), "skillboard-dogfood-contract-"));
  const config = await readFile(resolve("skillboard.config.yaml"));
  const inventory = await readFile(resolve(".skillboard/inventory.json"));
  const ignore = await readFile(resolve(".gitignore"), "utf8");
  try {
    await mkdir(join(root, ".skillboard"), { recursive: true });
    await mkdir(join(root, "skills"), { recursive: true });
    await writeFile(join(root, "skillboard.config.yaml"), config);
    await writeFile(join(root, ".skillboard", "inventory.json"), inventory);

    // When: a consumer reads the copied pair through the public CLI.
    const result = await execFileAsync(process.execPath, [
      CLI,
      "brief",
      "--config", join(root, "skillboard.config.yaml"),
      "--skills", join(root, "skills"),
      "--json"
    ]);
    const brief = JSON.parse(result.stdout);

    // Then: the pair is valid and only inventory.json is unignored.
    assert.equal(brief.health.config.version, 2);
    assert.equal(brief.health.config.valid, true);
    assert.match(ignore, /^!\.skillboard\/$/m);
    assert.match(ignore, /^\.skillboard\/\*$/m);
    assert.match(ignore, /^!\.skillboard\/inventory\.json$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operator docs describe native v2 reconcile, impact, and variant boundaries", async () => {
  // Given: release-facing operator documentation.
  const reference = await readFile(resolve("docs/reference.md"), "utf8");
  const variants = await readFile(resolve("docs/variant-lifecycle.md"), "utf8");

  // When: advanced v2 surfaces are read.
  // Then: each command states its v2 behavior without reviving v1 authorization state.
  assert.match(reference, /reconcile[^.]*missing valid inventory skills[^.]*enabled[^.]*agent-local\s+recommendations/i);
  assert.match(reference, /impact disable[^.]*enabled[^.]*sharing\s+consequences/i);
  assert.match(variants, /variant status[^.]*read-only[^.]*content and\s+inventory lifecycle/i);
  assert.match(variants, /fork|approve|reset/i);
  assert.match(variants, /authorization-mutating[^.]*compatibility/i);
});
