import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("package manifest excludes internal work artifacts from npm pack", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));

  assert.deepEqual(manifest.files, ["bin", "src", "docs/*.md", "docs/plans", "examples", "profiles", "README.md", "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE", "tsconfig.lsp.json"]);
});

test("package manifest is publishable as the SkillBoard CLI", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));

  assert.equal(manifest.name, "agent-skillboard");
  assert.equal(manifest.description, "Let AI agents pick and use allowed skills in each workflow.");
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
  for (const keyword of ["ai-agent", "agent-skills", "skills", "skill-routing", "workflow", "codex", "claude-code", "policy"]) {
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
  assert.match(workflow, /registry-url: https:\/\/registry\.npmjs\.org/);
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
  assert.match(workflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
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
  assert.equal(paths.some((path) => path.startsWith("docs/plan/")), false);
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

    assert.match(help.stdout, /^SkillBoard - AI-mediated workflow-scoped skill policy$/m);
    assert.match(help.stdout, /init \[--dir <path>\]/);
    assert.match(npxAlias.stdout, /^SkillBoard - AI-mediated workflow-scoped skill policy$/m);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("packed package drives fresh project through intent brief and guard", async () => {
  const temp = await mkdtemp(join(tmpdir(), "skillboard-npm-intent-test-"));
  try {
    const project = join(temp, "project");
    const skillsRoot = join(project, "skills");
    const skillPath = join(skillsRoot, "user-test-first");
    const configPath = join(project, "skillboard.config.yaml");
    const packResult = await execNpm(["pack", "--json", "--pack-destination", temp]);
    const [pack] = JSON.parse(packResult.stdout);
    const tarballPath = join(temp, pack.filename);
    const skillboard = (args) => execNpm(["exec", "--yes", "--package", tarballPath, "--", "skillboard", ...args], { cwd: temp });

    await skillboard(["init", "--dir", project, "--no-scan-installed"]);
    const agentsBridge = await readFile(join(project, "AGENTS.md"), "utf8");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: test-first\ndescription: Write tests before implementation.\n---\n# test-first\n",
      "utf8"
    );
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];
    await skillboard(["add", "skill", "user.test-first", "--path", "user-test-first", "--category", "testing", ...baseArgs]);
    await skillboard(["add", "workflow", "daily-workflow", "--harness", "codex", "--skill", "user.test-first", ...baseArgs]);

    const brief = await skillboard([
      "brief",
      "--intent",
      "write tests before implementation",
      "--workflow",
      "daily-workflow",
      ...baseArgs,
      "--json"
    ]);
    const payload = JSON.parse(brief.stdout);
    const guard = await skillboard(["guard", "use", "user.test-first", "--workflow", "daily-workflow", ...baseArgs, "--json"]);

    assert.match(agentsBridge, /brief --intent <request>/i);
    assert.match(agentsBridge, /assistant_guidance\.route/);
    assert.match(agentsBridge, /route_candidates/);
    assert.match(agentsBridge, /post_use_policy_suggestion/);
    assert.match(agentsBridge, /ask after completion whether to remember the suggested policy/i);
    assert.match(agentsBridge, /I will use <skill-id> for this request\./);
    assert.match(agentsBridge, /I used <skill-id> for this request\./);
    assert.match(agentsBridge, /ask a clarifying question/i);
    assert.equal(payload.assistant_guidance.status, "ready");
    assert.equal(payload.assistant_guidance.route.workflow, "daily-workflow");
    assert.equal(payload.assistant_guidance.route.matched_capability, null);
    assert.equal(payload.assistant_guidance.route.matched_skill, "user.test-first");
    assert.equal(payload.assistant_guidance.route.recommended_skill, "user.test-first");
    assert.equal(payload.assistant_guidance.route.route_candidates[0].skill, "user.test-first");
    assert.equal(payload.assistant_guidance.route.route_candidates[0].selected, true);
    assert.equal(payload.assistant_guidance.route.route_candidates[0].guard_allowed, true);
    assert.equal(payload.assistant_guidance.route.usage_disclosure.confirmation_required, false);
    assert.match(payload.assistant_guidance.route.usage_disclosure.start, /State at the start that user\.test-first is being used/);
    assert.match(payload.assistant_guidance.route.usage_disclosure.finish, /State at completion that user\.test-first was used/);
    assert.equal(payload.assistant_guidance.route.usage_disclosure.start_message, "I will use user.test-first for this request.");
    assert.equal(payload.assistant_guidance.route.usage_disclosure.finish_message, "I used user.test-first for this request.");
    assert.equal(payload.assistant_guidance.route.guard_allowed, true);
    assert.match(payload.assistant_guidance.route.guard_command, /skillboard guard use user\.test-first/);
    assert.equal(JSON.parse(guard.stdout).allowed, true);
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
