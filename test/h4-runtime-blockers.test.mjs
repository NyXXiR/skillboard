import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildSkillBrief } from "../src/index.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("importing source cli does not execute the command router", async () => {
  const result = await runNode([
    "--input-type=module",
    "--eval",
    "import './src/cli.mjs'; console.log('imported');"
  ]);

  assert.equal(result.code, 0, commandFailure(result));
  assert.equal(result.stdout, "imported\n");
  assert.equal(result.stderr, "");
});

test("apply-action refuses v1 when only bridge files are missing and preserves bytes", async () => {
  await withNoBridgeReviewFixture(async ({ configPath, skillsRoot }) => {
    const before = await readFile(configPath, "utf8");
    const result = await runSkillboard([
      "apply-action",
      "review-install-unit:medium.pack",
      "--workflow",
      "agent",
      "--config",
      configPath,
      "--skills",
      skillsRoot,
      "--yes",
      "--json"
    ]);

    assert.notEqual(result.code, 0);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "migration-required");
    assert.equal(payload.error.message, "Version 1 policy is read-only. Run `skillboard migrate v2`.");
    assert.equal(await readFile(configPath, "utf8"), before);
  });
});

test("verified source failure keeps brief availability blocked", async () => {
  await withBadSourceDigestBriefFixture(async ({ configPath, root, skillsRoot }) => {
    const brief = await buildSkillBrief({
      configPath,
      root,
      skillsRoot,
      workflow: "agent",
      includeActions: true,
      verifySources: true
    });

    assert.equal(brief.ok, false);
    assert.equal(brief.health.mode, "failed");
    assert.equal(brief.health.policy.ok, true);
    assert.equal(brief.assistant_guidance.status, "blocked");
  });
});

async function withNoBridgeReviewFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-h4-no-bridge-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "medium-helper"), { recursive: true });
    await writeFile(
      join(skillsRoot, "medium-helper", "SKILL.md"),
      "---\nname: medium-helper\ndescription: Medium helper.\n---\n# medium-helper\n",
      "utf8"
    );
    await writeFile(configPath, noBridgeReviewConfig(), "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withBadSourceDigestBriefFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-h4-bad-source-digest-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    const sourceRoot = join(root, "source");
    await mkdir(join(skillsRoot, "local-helper"), { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(
      join(skillsRoot, "local-helper", "SKILL.md"),
      "---\nname: local-helper\ndescription: Local helper.\n---\n# local-helper\n",
      "utf8"
    );
    await writeFile(join(sourceRoot, "README.md"), "changed local source\n", "utf8");
    await writeFile(configPath, badSourceDigestConfig(sourceRoot), "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function noBridgeReviewConfig() {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  medium.helper:
    path: medium-helper
    status: active
    invocation: workflow-auto
    exposure: unit-managed
    category: plugin
    owner_install_unit: medium.pack
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - agent
workflows:
  agent:
    harness: codex
    active_skills:
      - medium.helper
    blocked_skills: []
install_units:
  medium.pack:
    kind: plugin
    source: npx medium install
    scope: user-global
    enabled: true
    trust_level: unreviewed
    permission_risk: medium
    source_digest: sha256:medium
    provided_components:
      - skills
    components:
      skills:
        - medium.helper
`;
}

function badSourceDigestConfig(sourceRoot) {
  return `version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  local.helper:
    path: local-helper
    status: active
    invocation: manual-only
    exposure: unit-managed
    category: user
    owner_install_unit: local.pack
capabilities: {}
harnesses:
  codex:
    status: primary
    workflows:
      - agent
workflows:
  agent:
    harness: codex
    active_skills:
      - local.helper
    blocked_skills: []
install_units:
  local.pack:
    kind: skill
    source: ${sourceRoot}
    scope: project
    enabled: true
    trust_level: trusted
    permission_risk: low
    source_digest: sha256:0000000000000000000000000000000000000000000000000000000000000000
    provided_components:
      - skills
    components:
      skills:
        - local.helper
`;
}

async function runSkillboard(args) {
  return await runNode(["bin/skillboard.mjs", ...args]);
}

async function runNode(args) {
  try {
    const result = await execFileAsync(process.execPath, args, { cwd: repoRoot });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

function commandFailure(result) {
  return `exit=${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}
