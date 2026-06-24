import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("package manifest excludes internal work artifacts from npm pack", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));

  assert.deepEqual(manifest.files, ["bin", "src", "docs", "examples", "profiles", "README.md", "LICENSE", "tsconfig.lsp.json"]);
});

test("package manifest is publishable as the SkillBoard CLI", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));

  assert.equal(manifest.name, "agent-skillboard");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.bin.skillboard, "bin/skillboard.mjs");
  assert.equal(manifest.publishConfig.access, "public");
});

test("source-tree SkillBoard CLI entrypoint is executable for generated hooks", async () => {
  const stats = await stat(resolve("bin/skillboard.mjs"));

  assert.equal(stats.mode & 0o111, 0o111);
});

test("package manifest includes the rollout operator runbook", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const runbook = await readFile(resolve("docs/rollout-runbook.md"), "utf8");

  assert.match(readme, /skillboard rollout \[audit\|plan\|apply\|rollback\|report\]/);
  assert.match(runbook, /## Emergency rollback/);
  assert.match(runbook, /healthy.*0/s);
  assert.match(runbook, /rollback-needed.*4/s);
});

test("npm pack dry-run includes public runtime files and excludes work artifacts", async () => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = await execFileAsync(npm, ["pack", "--dry-run", "--json"]);
  const [pack] = JSON.parse(result.stdout);
  const paths = pack.files.map((file) => file.path);

  assert.ok(paths.includes("bin/skillboard.mjs"));
  assert.ok(paths.includes("src/doctor.mjs"));
  assert.ok(paths.includes("src/source-cache.mjs"));
  assert.ok(paths.includes("src/install-output-detector.mjs"));
  assert.ok(paths.includes("docs/install.md"));
  assert.ok(paths.includes("docs/rollout-runbook.md"));
  assert.equal(paths.some((path) => path.startsWith(".omo/")), false);
  assert.equal(paths.some((path) => path.startsWith("test/")), false);
  assert.equal(paths.includes("package-lock.json"), false);
});
