import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("package manifest excludes internal work artifacts from npm pack", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));

  assert.deepEqual(manifest.files, ["bin", "src", "docs", "examples", "profiles", "README.md", "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE", "tsconfig.lsp.json"]);
});

test("package manifest is publishable as the SkillBoard CLI", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));

  assert.equal(manifest.name, "agent-skillboard");
  assert.equal(manifest.description, "Know, gate, and audit which AI agent skills can run in each workflow.");
  assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.bin, {
    skillboard: "bin/skillboard.mjs",
    "agent-skillboard": "bin/skillboard.mjs"
  });
  assert.equal(manifest.publishConfig.access, "public");
  assert.deepEqual(manifest.repository, {
    type: "git",
    url: "git+https://github.com/NyXXiR/skillboard.git"
  });
  assert.deepEqual(manifest.bugs, {
    url: "https://github.com/NyXXiR/skillboard/issues"
  });
  assert.equal(manifest.homepage, "https://github.com/NyXXiR/skillboard#readme");
  for (const keyword of ["ai-agent", "skills", "codex", "claude-code", "policy"]) {
    assert.ok(manifest.keywords.includes(keyword));
  }
});

test("source-tree SkillBoard CLI entrypoint is executable for generated hooks", async () => {
  if (process.platform === "win32") {
    const bin = await readFile(resolve("bin/skillboard.mjs"), "utf8");
    assert.match(bin, /^#!\/usr\/bin\/env node/);
    return;
  }

  const stats = await stat(resolve("bin/skillboard.mjs"));

  assert.equal(stats.mode & 0o111, 0o111);
});

test("package manifest includes the rollout operator runbook", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const reference = await readFile(resolve("docs/reference.md"), "utf8");
  const runbook = await readFile(resolve("docs/rollout-runbook.md"), "utf8");

  assert.match(readme, /\[Rollout runbook\]\(docs\/rollout-runbook\.md\)/);
  assert.match(reference, /skillboard rollout \[audit\|plan\|apply\|rollback\|report\]/);
  assert.match(runbook, /## Emergency rollback/);
  assert.match(runbook, /healthy.*0/s);
  assert.match(runbook, /rollback-needed.*4/s);
});

test("GitHub Actions publish workflow releases npm package from version tags", async () => {
  const workflow = await readFile(resolve(".github/workflows/publish.yml"), "utf8");

  assert.match(workflow, /name: publish/);
  assert.match(workflow, /tags:\s*\n\s+- 'v\*'/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /node-version: 24/);
  assert.doesNotMatch(workflow, /registry-url:/);
  assert.doesNotMatch(workflow, /cache: npm/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /Validate release tag/);
  assert.match(workflow, /GITHUB_REF_NAME/);
  assert.match(workflow, /Check npm registry/);
  assert.match(workflow, /published=true/);
  assert.match(workflow, /already published; skipping npm publish/);
  assert.match(workflow, /npm publish --provenance --access public/);
  assert.match(workflow, /if: steps\.registry\.outputs\.published != 'true'/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
});

test("GitHub Actions check workflow runs package smoke through a cross-platform Node script", async () => {
  const workflow = await readFile(resolve(".github/workflows/check.yml"), "utf8");

  assert.match(workflow, /package and lifecycle smoke/);
  assert.match(workflow, /node \.github\/scripts\/ci-package-lifecycle-smoke\.mjs/);
  assert.doesNotMatch(workflow, /shell: bash/);
  assert.doesNotMatch(workflow, /mktemp/);
  assert.doesNotMatch(workflow, /grep -q/);
  assert.doesNotMatch(workflow, /file:\/\/\$\{?repo/);
});

test("npm pack dry-run includes public runtime files and excludes work artifacts", async () => {
  const result = process.env.npm_execpath === undefined
    ? await execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json"], { shell: process.platform === "win32" })
    : await execFileAsync(process.execPath, [process.env.npm_execpath, "pack", "--dry-run", "--json"]);
  const [pack] = JSON.parse(result.stdout);
  const paths = pack.files.map((file) => file.path);

  assert.ok(paths.includes("bin/skillboard.mjs"));
  assert.ok(paths.includes("src/doctor.mjs"));
  assert.ok(paths.includes("src/source-cache.mjs"));
  assert.ok(paths.includes("src/install-output-detector.mjs"));
  assert.ok(paths.includes("docs/install.md"));
  assert.ok(paths.includes("docs/reference.md"));
  assert.ok(paths.includes("docs/rollout-runbook.md"));
  assert.equal(paths.includes("skillboard.png"), false);
  assert.equal(paths.some((path) => path.startsWith(".omo/")), false);
  assert.equal(paths.some((path) => path.startsWith("test/")), false);
  assert.equal(paths.includes("package-lock.json"), false);
});

test("packed package runs through npm exec one-command bootstrap surface", async () => {
  const temp = await mkdtemp(join(tmpdir(), "skillboard-npm-exec-test-"));
  try {
    const packResult = await execNpm(["pack", "--json", "--pack-destination", temp]);
    const [pack] = JSON.parse(packResult.stdout);
    const tarballPath = join(temp, pack.filename);
    const help = await execNpm(["exec", "--yes", "--package", tarballPath, "--", "skillboard", "help"], { cwd: temp });
    const npxAlias = await execNpm(["exec", "--yes", "--package", tarballPath, "--", "agent-skillboard", "help"], { cwd: temp });

    assert.match(help.stdout, /SkillBoard - workflow-scoped agent skill policy/);
    assert.match(help.stdout, /init \[--dir <path>\]/);
    assert.match(npxAlias.stdout, /SkillBoard - workflow-scoped agent skill policy/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

function execNpm(args, options = {}) {
  if (process.env.npm_execpath === undefined) {
    return execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      shell: process.platform === "win32",
      ...options
    });
  }
  return execFileAsync(process.execPath, [process.env.npm_execpath, ...args], options);
}
