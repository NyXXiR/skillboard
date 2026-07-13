import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { runSetupCommand, runUninstallCommand } from "../src/lifecycle-cli.mjs";
import { pathTailPattern } from "./helpers/path-pattern.mjs";

const execFileAsync = promisify(execFile);

test("package manifest excludes internal work artifacts from npm pack", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));

  assert.deepEqual(manifest.files, ["bin", "src", "docs/*.md", "examples", "profiles", "README.md", "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE", "tsconfig.lsp.json"]);
});

test("package manifest is publishable as the SkillBoard CLI", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));

  assert.equal(manifest.name, "agent-skillboard");
  assert.equal(manifest.description, "Keep agent skills broadly available while routing overlaps consistently.");
  assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.bin, {
    skillboard: "bin/skillboard.mjs",
    "agent-skillboard": "bin/skillboard.mjs"
  });
  assert.equal(manifest.scripts.postinstall, "node bin/postinstall.mjs");
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.engines.node, ">=14.21");
  assert.deepEqual(manifest.repository, {
    type: "git",
    url: "git+https://github.com/NyXXiR/skillboard.git"
  });
  assert.deepEqual(manifest.bugs, {
    url: "https://github.com/NyXXiR/skillboard/issues"
  });
  assert.equal(manifest.homepage, "https://github.com/NyXXiR/skillboard#readme");
  for (const keyword of ["ai-agent", "agent-skills", "skills", "skill-routing", "overlap-routing", "workflow", "codex", "claude-code", "policy"]) {
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

test("repository attributes keep script and docs line endings stable", async () => {
  const attributes = await readFile(resolve(".gitattributes"), "utf8");

  assert.match(attributes, /^\*\.md text eol=lf$/m);
  assert.match(attributes, /^\*\.mjs text eol=lf$/m);
  assert.match(attributes, /^AGENTS\.md text eol=lf$/m);
  assert.match(attributes, /^CLAUDE\.md text eol=lf$/m);
});

test("package manifest includes the rollout operator runbook", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const reference = await readFile(resolve("docs/reference.md"), "utf8");
  const runbook = await readFile(resolve("docs/rollout-runbook.md"), "utf8");

  assert.match(readme, /\[Rollout runbook\]\(docs\/rollout-runbook\.md\)/);
  assert.match(reference, /Advanced operator commands/);
  assert.match(reference, /rollout/);
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
  assert.match(workflow, /node-version: 22/);
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

  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /macos-15-intel/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /-\s+14/);
  assert.match(workflow, /-\s+20/);
  assert.match(workflow, /-\s+22/);
  assert.match(workflow, /matrix\.node == 14/);
  assert.match(workflow, /npm install --ignore-scripts --production/);
  assert.match(workflow, /matrix\.node != 14/);
  assert.match(workflow, /npm run check/);
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

  assert.equal(pack.version, "0.3.1");
  assert.ok(paths.includes("bin/skillboard.mjs"));
  assert.ok(paths.includes("bin/postinstall.mjs"));
  assert.ok(paths.includes("src/doctor.mjs"));
  assert.ok(paths.includes("src/source-cache.mjs"));
  assert.ok(paths.includes("src/install-output-detector.mjs"));
  assert.ok(paths.includes("docs/install.md"));
  assert.ok(paths.includes("docs/reference.md"));
  assert.ok(paths.includes("docs/policy-model.md"));
  assert.ok(paths.includes("docs/versioning.md"));
  assert.ok(paths.includes("docs/rollout-runbook.md"));
  assert.equal(paths.includes("skillboard.png"), false);
  assert.equal(paths.some((path) => path.startsWith("docs/plan/")), false);
  assert.equal(paths.some((path) => path.startsWith("docs/plans/")), false);
  assert.equal(paths.some((path) => path.startsWith(".omo/")), false);
  assert.equal(paths.some((path) => path.startsWith("test/")), false);
  assert.equal(paths.includes("package-lock.json"), false);
});

test("postinstall auto-runs agent setup for global installs without project files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-postinstall-global-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const result = await execFileAsync(process.execPath, ["bin/postinstall.mjs"], {
      env: {
        ...process.env,
        HOME: home,
        INIT_CWD: project,
        CODEX_HOME: join(home, ".codex"),
        OPENCODE_HOME: join(home, ".config", "opencode"),
        npm_config_global: "true"
      }
    });
    const codexSkill = await readFile(join(home, ".codex", "skills", "skillboard", "SKILL.md"), "utf8");
    const openCodeSkill = await readFile(join(home, ".config", "opencode", "skills", "skillboard", "SKILL.md"), "utf8");

    assert.equal(result.stdout, "");
    assert.match(result.stderr, /SkillBoard installed/);
    assert.match(result.stderr, /does not initialize projects/i);
    assert.match(result.stderr, /skillboard init is deprecated project-local policy bootstrap/i);
    assert.match(result.stderr, /not needed for normal use/i);
    assert.match(result.stderr, /Auto-running agent setup/);
    assert.match(result.stderr, /SkillBoard agent integration installed/);
    assert.match(result.stderr, /No project init was run/);
    assert.match(result.stderr, /setup later after adding another supported agent/i);
    assert.match(codexSkill, /SkillBoard Agent Integration/);
    assert.match(codexSkill, /integration is running for agent `codex`/i);
    assert.match(openCodeSkill, /integration is running for agent `opencode`/i);
    assert.doesNotMatch(result.stderr, /skillboard init --dir/);
    assert.equal(await readFile(join(project, "skillboard.config.yaml"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(project, "AGENTS.md"), "utf8").catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("postinstall global update refreshes managed guidance and new agent roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-postinstall-update-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    const codexSkillPath = join(home, ".codex", "skills", "skillboard", "SKILL.md");
    const agentsSkillPath = join(home, ".agents", "skills", "skillboard", "SKILL.md");
    await mkdir(join(home, ".agents"), { recursive: true });
    await mkdir(join(home, ".codex", "skills", "skillboard"), { recursive: true });
    await writeFile(codexSkillPath, [
      "---",
      "name: skillboard",
      "description: old managed guidance",
      "---",
      "<!-- BEGIN SKILLBOARD AGENT INTEGRATION -->",
      "# Old SkillBoard Integration",
      "old update guidance",
      "<!-- END SKILLBOARD AGENT INTEGRATION -->",
      ""
    ].join("\n"), "utf8");

    const result = await execFileAsync(process.execPath, ["bin/postinstall.mjs"], {
      env: {
        ...process.env,
        HOME: home,
        INIT_CWD: project,
        CODEX_HOME: join(home, ".codex"),
        npm_config_global: "true"
      }
    });
    const codexSkill = await readFile(codexSkillPath, "utf8");
    const agentsSkill = await readFile(agentsSkillPath, "utf8");

    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Auto-running agent setup/);
    assert.match(result.stderr, new RegExp(`Updated: .*${pathTailPattern(".codex", "skills", "skillboard", "SKILL.md")}`));
    assert.match(result.stderr, new RegExp(`Created: .*${pathTailPattern(".agents", "skills", "skillboard", "SKILL.md")}`));
    assert.match(codexSkill, /SkillBoard Agent Integration/);
    assert.doesNotMatch(codexSkill, /old update guidance/);
    assert.equal(agentsSkill, codexSkill);
    assert.equal(await readFile(join(project, "skillboard.config.yaml"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(project, "AGENTS.md"), "utf8").catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("postinstall global update restores registered roots and reconciles existing shared skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-postinstall-registered-root-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const customHermesRoot = join(home, "custom-hermes", "skills");
  const cli = resolve("bin/skillboard.mjs");
  const env = withoutKeys({
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome
  }, ["HERMES_HOME"]);
  try {
    await mkdir(join(codexHome, "skills", "demo"), { recursive: true });
    await writeFile(join(codexHome, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Shared update workflow.\n---\n");
    await execFileAsync(process.execPath, [cli, "setup", "--agent", "codex", "--yes"], { env });
    await execFileAsync(process.execPath, [cli, "skill", "share", "demo", "--json"], { env });
    await execFileAsync(process.execPath, [
      cli, "setup", "--agent", "hermes", "--skill-root", customHermesRoot, "--yes"
    ], { env });
    await rm(customHermesRoot, { recursive: true, force: true });

    const result = await execFileAsync(process.execPath, ["bin/postinstall.mjs"], {
      env: { ...env, INIT_CWD: join(root, "project"), npm_config_global: "true" }
    });
    assert.match(result.stderr, /Auto-running agent setup/);
    assert.match(result.stderr, /Created shared copies: [1-9][0-9]*/);
    assert.match(await readFile(join(customHermesRoot, "skillboard", "SKILL.md"), "utf8"), /agent `hermes`/);
    assert.match(await readFile(join(customHermesRoot, "demo", "SKILL.md"), "utf8"), /Shared update workflow/);
    assert.match(await readFile(join(home, "skillboard.config.yaml"), "utf8"), /demo:[\s\S]*shared: true/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("postinstall sudo global setup targets the invoking user's agent home", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-postinstall-sudo-"));
  try {
    const sudoUser = "skillboardsudo";
    const rootHome = join(root, "root-home");
    const userHome = join(root, "user-home");
    const fakeBin = join(root, "bin");
    await mkdir(join(userHome, ".agents", "skills"), { recursive: true });
    await mkdir(rootHome, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    const getent = join(fakeBin, "getent");
    await writeFile(getent, [
      "#!/bin/sh",
      `if [ "$1" = "passwd" ] && [ "$2" = "${sudoUser}" ]; then`,
      `  printf '%s\\n' '${sudoUser}:x:1000:1000:SkillBoard:${userHome}:/bin/sh'`,
      "  exit 0",
      "fi",
      "exit 2",
      ""
    ].join("\n"), "utf8");
    await chmod(getent, 0o755);

    const result = await execFileAsync(process.execPath, ["bin/postinstall.mjs"], {
      env: {
        HOME: rootHome,
        INIT_CWD: root,
        LOGNAME: "root",
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        SUDO_GID: "1000",
        SUDO_HOME: userHome,
        SUDO_UID: "1000",
        SUDO_USER: sudoUser,
        USER: "root",
        npm_config_global: "true"
      }
    });
    const userSkill = await readFile(join(userHome, ".agents", "skills", "skillboard", "SKILL.md"), "utf8");

    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Auto-running agent setup/);
    assert.match(result.stderr, /SkillBoard agent integration installed/);
    assert.match(userSkill, /SkillBoard Agent Integration/);
    assert.equal(await readFile(join(rootHome, ".agents", "skills", "skillboard", "SKILL.md"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(root, "skillboard.config.yaml"), "utf8").catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("postinstall sudo setup still installs when non-root cannot chown", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-postinstall-sudo-no-chown-"));
  try {
    const sudoUser = "skillboardsudo";
    const rootHome = join(root, "root-home");
    const userHome = join(root, "user-home");
    const fakeBin = join(root, "bin");
    await mkdir(join(userHome, ".agents", "skills"), { recursive: true });
    await mkdir(rootHome, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    const getent = join(fakeBin, "getent");
    await writeFile(getent, [
      "#!/bin/sh",
      `if [ "$1" = "passwd" ] && [ "$2" = "${sudoUser}" ]; then`,
      `  printf '%s\\n' '${sudoUser}:x:1234:5678:SkillBoard:${userHome}:/bin/sh'`,
      "  exit 0",
      "fi",
      "exit 2",
      ""
    ].join("\n"), "utf8");
    await chmod(getent, 0o755);

    const result = await execFileAsync(process.execPath, ["bin/postinstall.mjs"], {
      env: {
        HOME: rootHome,
        INIT_CWD: root,
        LOGNAME: "root",
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        SUDO_GID: "5678",
        SUDO_HOME: userHome,
        SUDO_UID: "1234",
        SUDO_USER: sudoUser,
        USER: "root",
        npm_config_global: "true"
      }
    });
    const userSkill = await readFile(join(userHome, ".agents", "skills", "skillboard", "SKILL.md"), "utf8");

    assert.equal(result.stdout, "");
    assert.match(result.stderr, /SkillBoard agent integration installed/);
    assert.doesNotMatch(result.stderr, /Agent setup skipped/);
    assert.match(userSkill, /SkillBoard Agent Integration/);
    assert.equal(await readFile(join(rootHome, ".agents", "skills", "skillboard", "SKILL.md"), "utf8").catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup under sudo chowns managed guidance to the invoking user", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-sudo-chown-"));
  try {
    const rootHome = join(root, "root-home");
    const userHome = join(root, "user-home");
    const codexHome = join(userHome, ".codex");
    await mkdir(rootHome, { recursive: true });
    const chowns = [];
    const stdout = [];

    const code = await runSetupCommand(new Map([
      ["yes", "true"],
      ["agent", "codex"]
    ]), {
      write(chunk) {
        stdout.push(chunk);
      }
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: rootHome,
        CODEX_HOME: codexHome,
        LOGNAME: "root",
        SUDO_GID: "5678",
        SUDO_HOME: userHome,
        SUDO_UID: "1234",
        SUDO_USER: "skillboardsudo",
        USER: "root"
      },
      packageSpec: "agent-skillboard",
      chown(path, uid, gid) {
        chowns.push({ path, uid, gid });
        return Promise.resolve();
      }
    });
    const skillPath = join(codexHome, "skills", "skillboard", "SKILL.md");
    const skill = await readFile(skillPath, "utf8");

    assert.equal(code, 0);
    assert.match(stdout.join(""), /SkillBoard agent integration installed/);
    assert.match(skill, /SkillBoard Agent Integration/);
    assert.deepEqual(chowns.find((entry) => entry.path === skillPath), {
      path: skillPath,
      uid: 1234,
      gid: 5678
    });
    assert.ok(chowns.some((entry) => entry.path === join(codexHome, "skills", "skillboard")));
    assert.ok(chowns.every((entry) => entry.uid === 1234 && entry.gid === 5678));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup under sudo chowns unchanged managed guidance to the invoking user", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-sudo-chown-unchanged-"));
  try {
    const rootHome = join(root, "root-home");
    const userHome = join(root, "user-home");
    const codexHome = join(userHome, ".codex");
    await mkdir(rootHome, { recursive: true });

    const firstCode = await runSetupCommand(new Map([
      ["yes", "true"],
      ["agent", "codex"]
    ]), {
      write() {}
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: userHome,
        CODEX_HOME: codexHome
      },
      packageSpec: "agent-skillboard"
    });
    assert.equal(firstCode, 0);

    const chowns = [];
    const stdout = [];
    const secondCode = await runSetupCommand(new Map([
      ["yes", "true"],
      ["agent", "codex"]
    ]), {
      write(chunk) {
        stdout.push(chunk);
      }
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: rootHome,
        CODEX_HOME: codexHome,
        LOGNAME: "root",
        SUDO_GID: "5678",
        SUDO_HOME: userHome,
        SUDO_UID: "1234",
        SUDO_USER: "skillboardsudo",
        USER: "root"
      },
      packageSpec: "agent-skillboard",
      chown(path, uid, gid) {
        chowns.push({ path, uid, gid });
        return Promise.resolve();
      }
    });
    const skillPath = join(codexHome, "skills", "skillboard", "SKILL.md");

    assert.equal(secondCode, 0);
    assert.match(stdout.join(""), /Unchanged: `codex:/);
    assert.deepEqual(chowns.find((entry) => entry.path === skillPath), {
      path: skillPath,
      uid: 1234,
      gid: 5678
    });
    assert.ok(chowns.every((entry) => entry.uid === 1234 && entry.gid === 5678));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup under sudo chowns reconciled shared skill contents to the invoking user", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-sudo-chown-shared-"));
  try {
    const rootHome = join(root, "root-home");
    const userHome = join(root, "user-home");
    const codexHome = join(userHome, ".codex");
    const customRoot = join(userHome, "custom-hermes", "skills");
    const source = join(codexHome, "skills", "demo");
    const cli = resolve("bin/skillboard.mjs");
    const userEnv = { ...process.env, HOME: userHome, USERPROFILE: userHome, CODEX_HOME: codexHome };
    await mkdir(join(source, "scripts"), { recursive: true });
    await mkdir(rootHome, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "---\nname: demo\ndescription: Sudo shared reconcile.\n---\n");
    await writeFile(join(source, "scripts", "check.sh"), "exit 0\n");
    await execFileAsync(process.execPath, [cli, "setup", "--agent", "codex", "--yes"], { env: userEnv });
    await execFileAsync(process.execPath, [cli, "skill", "share", "demo", "--json"], { env: userEnv });

    const chowns = [];
    const code = await runSetupCommand(new Map([
      ["yes", "true"],
      ["agent", "hermes"],
      ["skill-root", customRoot]
    ]), { write() {} }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: rootHome,
        CODEX_HOME: codexHome,
        LOGNAME: "root",
        SUDO_GID: "5678",
        SUDO_HOME: userHome,
        SUDO_UID: "1234",
        SUDO_USER: "skillboardsudo",
        USER: "root"
      },
      packageSpec: "agent-skillboard",
      chown(path, uid, gid) {
        chowns.push({ path, uid, gid });
        return Promise.resolve();
      }
    });

    assert.equal(code, 0);
    for (const path of [
      join(customRoot, "demo"),
      join(customRoot, "demo", "SKILL.md"),
      join(customRoot, "demo", "scripts"),
      join(customRoot, "demo", "scripts", "check.sh"),
      join(customRoot, "demo", ".skillboard-share.json")
    ]) {
      assert.ok(chowns.some((entry) => entry.path === path), `missing chown for ${path}`);
    }
    assert.ok(chowns.every((entry) => entry.uid === 1234 && entry.gid === 5678));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup preserves a symlinked managed agent skill directory without writing through it", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-setup-symlink-dir-"));
  try {
    const rootHome = join(root, "root-home");
    const userHome = join(root, "user-home");
    const codexHome = join(userHome, ".codex");
    const skillRoot = join(codexHome, "skills");
    const outside = join(root, "outside-skillboard");
    const outsideSkill = join(outside, "SKILL.md");
    const oldManaged = oldAgentIntegrationSkill("# Old outside guidance\n");
    await mkdir(rootHome, { recursive: true });
    await mkdir(skillRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(outsideSkill, oldManaged, "utf8");
    await symlink(outside, join(skillRoot, "skillboard"), "dir");
    const chowns = [];
    const stdout = [];

    const code = await runSetupCommand(new Map([
      ["yes", "true"],
      ["agent", "codex"]
    ]), {
      write(chunk) {
        stdout.push(chunk);
      }
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: rootHome,
        CODEX_HOME: codexHome,
        LOGNAME: "root",
        SUDO_GID: "5678",
        SUDO_HOME: userHome,
        SUDO_UID: "1234",
        SUDO_USER: "skillboardsudo",
        USER: "root"
      },
      packageSpec: "agent-skillboard",
      chown(path, uid, gid) {
        chowns.push({ path, uid, gid });
        return Promise.resolve();
      }
    });

    assert.equal(code, 0);
    assert.match(stdout.join(""), /Preserved: `codex:/);
    assert.equal(await readFile(outsideSkill, "utf8"), oldManaged);
    assert.equal((await lstat(join(skillRoot, "skillboard"))).isSymbolicLink(), true);
    assert.deepEqual(chowns, homeStateChowns(userHome));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup preserves a symlinked agent skill root without writing through it", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-setup-symlink-root-"));
  try {
    const rootHome = join(root, "root-home");
    const userHome = join(root, "user-home");
    const codexHome = join(userHome, ".codex");
    const skillRoot = join(codexHome, "skills");
    const outside = join(root, "outside-skills-root");
    await mkdir(rootHome, { recursive: true });
    await mkdir(codexHome, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, skillRoot, "dir");
    const chowns = [];
    const stdout = [];

    const code = await runSetupCommand(new Map([
      ["yes", "true"],
      ["agent", "codex"]
    ]), {
      write(chunk) {
        stdout.push(chunk);
      }
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: rootHome,
        CODEX_HOME: codexHome,
        LOGNAME: "root",
        SUDO_GID: "5678",
        SUDO_HOME: userHome,
        SUDO_UID: "1234",
        SUDO_USER: "skillboardsudo",
        USER: "root"
      },
      packageSpec: "agent-skillboard",
      chown(path, uid, gid) {
        chowns.push({ path, uid, gid });
        return Promise.resolve();
      }
    });

    assert.equal(code, 0);
    assert.match(stdout.join(""), /Preserved: `codex:/);
    assert.equal(await readFile(join(outside, "skillboard", "SKILL.md"), "utf8").catch(() => null), null);
    assert.equal(await readlink(skillRoot), outside);
    assert.deepEqual(chowns, homeStateChowns(userHome));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup allows a home path below a symlinked temp ancestor", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-setup-home-ancestor-symlink-"));
  try {
    const realBase = join(root, "private");
    const linkedBase = join(root, "var");
    const userHome = join(linkedBase, "user-home");
    const codexHome = join(userHome, ".codex");
    await mkdir(realBase, { recursive: true });
    await symlink(realBase, linkedBase, "dir");
    const stdout = [];

    const code = await runSetupCommand(new Map([
      ["yes", "true"],
      ["agent", "codex"]
    ]), {
      write(chunk) {
        stdout.push(chunk);
      }
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: userHome,
        CODEX_HOME: codexHome
      },
      packageSpec: "agent-skillboard"
    });

    assert.equal(code, 0);
    assert.match(stdout.join(""), /Created: `codex:/);
    assert.match(await readFile(join(codexHome, "skills", "skillboard", "SKILL.md"), "utf8"), /SkillBoard Agent Integration/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup preserves a symlinked agent SKILL.md without writing through it", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-setup-symlink-file-"));
  try {
    const userHome = join(root, "user-home");
    const codexHome = join(userHome, ".codex");
    const skillDir = join(codexHome, "skills", "skillboard");
    const outsideSkill = join(root, "outside-SKILL.md");
    const oldManaged = oldAgentIntegrationSkill("# Old outside guidance\n");
    await mkdir(skillDir, { recursive: true });
    await writeFile(outsideSkill, oldManaged, "utf8");
    await symlink(outsideSkill, join(skillDir, "SKILL.md"));
    const stdout = [];

    const code = await runSetupCommand(new Map([
      ["yes", "true"],
      ["agent", "codex"]
    ]), {
      write(chunk) {
        stdout.push(chunk);
      }
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: userHome,
        CODEX_HOME: codexHome
      },
      packageSpec: "agent-skillboard"
    });

    assert.equal(code, 0);
    assert.match(stdout.join(""), /Preserved: `codex:/);
    assert.equal(await readFile(outsideSkill, "utf8"), oldManaged);
    assert.equal(await readlink(join(skillDir, "SKILL.md")), outsideSkill);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-layer uninstall preserves a symlinked managed skill directory without removing through it", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-uninstall-symlink-dir-"));
  try {
    const userHome = join(root, "user-home");
    const codexHome = join(userHome, ".codex");
    const skillRoot = join(codexHome, "skills");
    const outside = join(root, "outside-skillboard");
    const outsideSkill = join(outside, "SKILL.md");
    const oldManaged = oldAgentIntegrationSkill("");
    await mkdir(skillRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(outsideSkill, oldManaged, "utf8");
    await symlink(outside, join(skillRoot, "skillboard"), "dir");
    const stdout = [];

    const code = await runUninstallCommand(new Map([
      ["agent-layer", "true"],
      ["agent", "codex"]
    ]), {
      write(chunk) {
        stdout.push(chunk);
      }
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: userHome,
        CODEX_HOME: codexHome
      },
      packageSpec: "agent-skillboard"
    });

    assert.equal(code, 0);
    assert.match(stdout.join(""), /Preserved: `codex:/);
    assert.equal(await readFile(outsideSkill, "utf8"), oldManaged);
    assert.equal((await lstat(join(skillRoot, "skillboard"))).isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-layer uninstall preserves a symlinked agent skill root without removing through it", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-uninstall-symlink-root-"));
  try {
    const userHome = join(root, "user-home");
    const codexHome = join(userHome, ".codex");
    const skillRoot = join(codexHome, "skills");
    const outside = join(root, "outside-skills-root");
    const outsideSkill = join(outside, "skillboard", "SKILL.md");
    const oldManaged = oldAgentIntegrationSkill("");
    await mkdir(codexHome, { recursive: true });
    await mkdir(join(outside, "skillboard"), { recursive: true });
    await writeFile(outsideSkill, oldManaged, "utf8");
    await symlink(outside, skillRoot, "dir");
    const stdout = [];

    const code = await runUninstallCommand(new Map([
      ["agent-layer", "true"],
      ["agent", "codex"]
    ]), {
      write(chunk) {
        stdout.push(chunk);
      }
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: userHome,
        CODEX_HOME: codexHome
      },
      packageSpec: "agent-skillboard"
    });

    assert.equal(code, 0);
    assert.match(stdout.join(""), /Preserved: `codex:/);
    assert.equal(await readFile(outsideSkill, "utf8"), oldManaged);
    assert.equal(await readlink(skillRoot), outside);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-layer uninstall preserves a symlinked agent SKILL.md without removing through it", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-uninstall-symlink-file-"));
  try {
    const userHome = join(root, "user-home");
    const codexHome = join(userHome, ".codex");
    const skillDir = join(codexHome, "skills", "skillboard");
    const outsideSkill = join(root, "outside-SKILL.md");
    const oldManaged = oldAgentIntegrationSkill("");
    await mkdir(skillDir, { recursive: true });
    await writeFile(outsideSkill, oldManaged, "utf8");
    await symlink(outsideSkill, join(skillDir, "SKILL.md"));
    const stdout = [];

    const code = await runUninstallCommand(new Map([
      ["agent-layer", "true"],
      ["agent", "codex"]
    ]), {
      write(chunk) {
        stdout.push(chunk);
      }
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: userHome,
        CODEX_HOME: codexHome
      },
      packageSpec: "agent-skillboard"
    });

    assert.equal(code, 0);
    assert.match(stdout.join(""), /Preserved: `codex:/);
    assert.equal(await readFile(outsideSkill, "utf8"), oldManaged);
    assert.equal(await readlink(join(skillDir, "SKILL.md")), outsideSkill);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup under sudo skips chown at and below a symlinked ownership component", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-sudo-chown-symlink-component-"));
  try {
    const rootHome = join(root, "root-home");
    const userHome = join(root, "user-home");
    const realCodexHome = join(root, "real-codex-home");
    const linkedCodexHome = join(userHome, ".codex");
    await mkdir(rootHome, { recursive: true });
    await mkdir(userHome, { recursive: true });
    await mkdir(join(realCodexHome, "skills"), { recursive: true });
    await symlink(realCodexHome, linkedCodexHome, "dir");
    const chowns = [];

    const code = await runSetupCommand(new Map([
      ["yes", "true"],
      ["agent", "codex"]
    ]), {
      write() {}
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: rootHome,
        CODEX_HOME: linkedCodexHome,
        LOGNAME: "root",
        SUDO_GID: "5678",
        SUDO_HOME: userHome,
        SUDO_UID: "1234",
        SUDO_USER: "skillboardsudo",
        USER: "root"
      },
      packageSpec: "agent-skillboard",
      chown(path, uid, gid) {
        chowns.push({ path, uid, gid });
        return Promise.resolve();
      }
    });

    assert.equal(code, 0);
    assert.equal(await readFile(join(realCodexHome, "skills", "skillboard", "SKILL.md"), "utf8").catch(() => null), null);
    assert.deepEqual(chowns, homeStateChowns(userHome));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup under sudo does not chown agent guidance outside the invoking user's home", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "skillboard-sudo-chown-boundary-"));
  try {
    const rootHome = join(root, "root-home");
    const userHome = join(root, "user-home");
    const codexHome = join(root, "outside-codex");
    await mkdir(rootHome, { recursive: true });
    const chowns = [];

    const code = await runSetupCommand(new Map([
      ["yes", "true"],
      ["agent", "codex"]
    ]), {
      write() {}
    }, {
      cwd: root,
      entrypointPath: "skillboard",
      env: {
        HOME: rootHome,
        CODEX_HOME: codexHome,
        LOGNAME: "root",
        SUDO_GID: "5678",
        SUDO_HOME: userHome,
        SUDO_UID: "1234",
        SUDO_USER: "skillboardsudo",
        USER: "root"
      },
      packageSpec: "agent-skillboard",
      chown(path, uid, gid) {
        chowns.push({ path, uid, gid });
        return Promise.resolve();
      }
    });
    const skillPath = join(codexHome, "skills", "skillboard", "SKILL.md");
    const skill = await readFile(skillPath, "utf8");

    assert.equal(code, 0);
    assert.match(skill, /SkillBoard Agent Integration/);
    assert.deepEqual(chowns, homeStateChowns(userHome));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("postinstall non-global lifecycle is visible but non-mutating", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-postinstall-target-"));
  try {
    const home = join(root, "home");
    const result = await execFileAsync(process.execPath, ["bin/postinstall.mjs"], {
      env: {
        ...process.env,
        HOME: home,
        INIT_CWD: root,
        CODEX_HOME: join(home, ".codex")
      }
    });

    assert.equal(result.stdout, "");
    assert.match(result.stderr, /SkillBoard installed/);
    assert.match(result.stderr, /Global installs and updates auto-run agent setup/);
    assert.match(result.stderr, /skillboard setup/);
    assert.match(result.stderr, /later after adding another supported agent/i);
    assert.doesNotMatch(result.stderr, /skillboard init --dir/);
    assert.equal(await readFile(join(home, ".codex", "skills", "skillboard", "SKILL.md"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(root, "skillboard.config.yaml"), "utf8").catch(() => null), null);
    assert.equal(await readFile(join(root, "AGENTS.md"), "utf8").catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release notes include the current package version", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  const changelog = await readFile(resolve("CHANGELOG.md"), "utf8");

  assert.match(changelog, new RegExp(`## ${manifest.version.split(".").join("\\.")}\\b`));
});

test("packed package runs through npm exec agent-layer setup surface", async () => {
  const temp = await mkdtemp(join(tmpdir(), "skillboard-npm-exec-test-"));
  try {
    const packResult = await execNpm(["pack", "--json", "--pack-destination", temp]);
    const [pack] = JSON.parse(packResult.stdout);
    const tarballPath = join(temp, pack.filename);
    const help = await execNpm(["exec", "--yes", "--package", tarballPath, "--", "skillboard", "help"], { cwd: temp });
    const npxAlias = await execNpm(["exec", "--yes", "--package", tarballPath, "--", "agent-skillboard", "help"], { cwd: temp });

    assert.match(help.stdout, /^SkillBoard - permissive AI skill overlap routing$/m);
    assert.match(help.stdout, /Legacy v1 project policy mode:/);
    assert.match(help.stdout, /init \[--dir <path>\]/);
    assert.match(help.stdout, /deprecated project-local policy bootstrap/i);
    assert.match(npxAlias.stdout, /^SkillBoard - permissive AI skill overlap routing$/m);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("packed package fresh v1 project refuses mutation and preserves bytes", async () => {
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
    await writeFile(configPath, "version: 1\nskills: {}\nworkflows: {}\nharnesses: {}\ninstall_units: {}\n", "utf8");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: test-first\ndescription: Write tests before implementation.\n---\n# test-first\n",
      "utf8"
    );
    const baseArgs = ["--config", configPath, "--skills", skillsRoot];
    const configBytes = await readFile(configPath, "utf8");
    await assert.rejects(
      skillboard(["add", "skill", "user.test-first", "--path", "user-test-first", "--category", "testing", ...baseArgs]),
      /Version 1 policy is read-only\. Run `skillboard migrate v2`\./
    );
    assert.equal(await readFile(configPath, "utf8"), configBytes);

    assert.match(agentsBridge, /brief --intent <request>/i);
    assert.match(agentsBridge, /enabled/);
    assert.match(agentsBridge, /sharing/);
    assert.match(agentsBridge, /preference ranks enabled skills installed for the current\s+agent/i);
    assert.match(agentsBridge, /guard use <skill-id>/);
    assert.match(agentsBridge, /Do not ask for another approval when guard allows use/i);
    assert.match(agentsBridge, /skillboard migrate v2/);
    assert.match(agentsBridge, /audit metadata and never\s+determine availability/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("packed inventory refresh rejects invalid v2 policy before changing project bytes", async () => {
  const temp = await mkdtemp(join(tmpdir(), "skillboard-packed-invalid-refresh-"));
  try {
    const project = join(temp, "project");
    const configPath = join(project, "skillboard.config.yaml");
    const inventoryPath = join(project, ".skillboard", "inventory.json");
    await mkdir(join(project, ".skillboard"), { recursive: true });
    const config = "version: 2\nskills:\n  bad:\n    enabled: true\n    shared: all\n";
    const inventory = Buffer.from("{\"existing\":true}\n");
    await writeFile(configPath, config, "utf8");
    await writeFile(inventoryPath, inventory);
    const packResult = await execNpm(["pack", "--json", "--pack-destination", temp]);
    const [pack] = JSON.parse(packResult.stdout);
    const tarballPath = join(temp, pack.filename);

    await assert.rejects(
      execNpm(["exec", "--yes", "--package", tarballPath, "--", "skillboard", "inventory", "refresh", "--dir", project, "--json"], { cwd: temp }),
      /skills\.bad\.shared is required and must be a boolean/
    );
    assert.equal(await readFile(configPath, "utf8"), config);
    assert.deepEqual(await readFile(inventoryPath), inventory);
    await assert.rejects(stat(join(project, ".skillboard-inventory-refresh.lock")), /ENOENT/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

function homeStateChowns(home) {
  return [
    { path: join(home, "skillboard.config.yaml"), uid: 1234, gid: 5678 },
    { path: join(home, ".skillboard"), uid: 1234, gid: 5678 },
    { path: join(home, ".skillboard", "inventory.json"), uid: 1234, gid: 5678 }
  ];
}

function execNpm(args, options = {}) {
  const env = withoutNestedNpmExecConfig(options.env ?? process.env);
  const mergedOptions = {
    ...options,
    env
  };

  if (process.env.npm_execpath === undefined) {
    return execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      shell: process.platform === "win32",
      ...mergedOptions
    });
  }
  return execFileAsync(process.execPath, [process.env.npm_execpath, ...args], mergedOptions);
}

function withoutNestedNpmExecConfig(env) {
  const sanitized = { ...env };
  delete sanitized.npm_config_call;
  return sanitized;
}

function withoutKeys(env, keys) {
  const sanitized = { ...env };
  for (const key of keys) delete sanitized[key];
  return sanitized;
}

function oldAgentIntegrationSkill(body) {
  return [
    "---",
    "name: skillboard",
    "description: old managed guidance",
    "---",
    "<!-- BEGIN SKILLBOARD AGENT INTEGRATION -->",
    body,
    "<!-- END SKILLBOARD AGENT INTEGRATION -->",
    ""
  ].join("\n");
}
