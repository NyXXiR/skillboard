import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputLimit = 1024 * 1024 * 10;
const temp = await mkdtemp(join(tmpdir(), "skillboard-ci-smoke-"));

try {
  const packageRoot = process.cwd();
  const projectRoot = join(temp, "project");
  const packRoot = join(temp, "package");
  const installRoot = join(temp, "installed");
  const home = join(temp, "home");
  const codexHome = join(home, ".codex");
  const skillPath = join(codexHome, "skills", "smoke-skill");
  const env = { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome };

  await mkdir(projectRoot, { recursive: true });
  await mkdir(packRoot, { recursive: true });
  await mkdir(installRoot, { recursive: true });
  await mkdir(skillPath, { recursive: true });
  for (const root of [
    join(home, ".claude", "skills"),
    join(home, ".config", "opencode", "skills"),
    join(home, ".hermes", "skills")
  ]) {
    await mkdir(root, { recursive: true });
  }
  await writeFile(
    join(skillPath, "SKILL.md"),
    "---\nname: smoke-skill\ndescription: CI inventory smoke\n---\n",
    "utf8"
  );

  await assertPackContents(packageRoot);
  const tarball = await packPackage(packRoot);
  const packagedCli = await installPackage(tarball, installRoot, env);
  const run = (args) => node([packagedCli, ...args], { cwd: projectRoot, env });

  await run(["help"]);
  await run(["setup", "--yes", "--agent", "codex"]);
  const brief = JSON.parse((await run([
    "brief", "--agent", "codex", "--intent", "CI inventory smoke", "--json"
  ])).stdout.toString());
  assert.equal(brief.health.config.version, 2);
  assert.equal(brief.assistant_guidance.route.recommended_skill, "smoke-skill");

  const allowed = JSON.parse((await run([
    "guard", "use", "smoke-skill", "--agent", "codex", "--json"
  ])).stdout.toString());
  assert.equal(allowed.allowed, true);

  await run(["skill", "disable", "smoke-skill", "--json"]);
  await assertCommandFails(run([
    "guard", "use", "smoke-skill", "--agent", "codex", "--json"
  ]), /disabled/i, 2);
  await run(["skill", "enable", "smoke-skill", "--json"]);

  await run(["skill", "share", "smoke-skill", "--json"]);
  const shared = JSON.parse((await run([
    "guard", "use", "smoke-skill", "--agent", "hermes", "--json"
  ])).stdout.toString());
  assert.equal(shared.allowed, true);
  await run(["skill", "unshare", "smoke-skill", "--json"]);
  await assertCommandFails(run([
    "guard", "use", "smoke-skill", "--agent", "hermes", "--json"
  ]), /not installed for agent hermes/i, 2);

  const migrationRoot = join(temp, "migration");
  const migrationConfig = join(migrationRoot, "skillboard.config.yaml");
  await mkdir(migrationRoot, { recursive: true });
  await writeFile(migrationConfig, legacyMigrationFixture(), "utf8");
  const migrated = JSON.parse((await run([
    "migrate", "v2", "--config", migrationConfig, "--yes", "--json"
  ])).stdout.toString());
  assert.match(await readFile(migrationConfig, "utf8"), /version: 2/);
  await run([
    "migrate", "v2", "--config", migrationConfig,
    "--rollback", join(migrationRoot, migrated.backup), "--json"
  ]);
  assert.match(await readFile(migrationConfig, "utf8"), /version: 1/);

  const preview = JSON.parse((await run(["uninstall", "--user", "--dry-run", "--json"])).stdout.toString());
  assert.equal(preview.dry_run, true);
  await access(join(home, "skillboard.config.yaml"));
  await run(["uninstall", "--user", "--yes", "--json"]);
  await access(join(skillPath, "SKILL.md"));
  await assertMissing(join(home, "skillboard.config.yaml"));
  await assertMissing(join(home, ".skillboard"));
  await assertMissing(join(projectRoot, "skillboard.config.yaml"));
} finally {
  await rm(temp, { recursive: true, force: true });
}

async function assertPackContents(packageRoot) {
  const result = await npm(["pack", "--dry-run", "--json"], { cwd: packageRoot });
  const [pack] = JSON.parse(result.stdout.toString());
  const paths = pack.files.map((file) => file.path);

  for (const required of [
    "bin/skillboard.mjs",
    "src/control/v2-skill-forget.mjs",
    "src/user-uninstall.mjs",
    "docs/install.md"
  ]) {
    assert.ok(paths.includes(required), `missing ${required}`);
  }
  for (const blocked of [".omo/", "test/"]) {
    assert.equal(paths.some((path) => path.startsWith(blocked)), false, `packed internal path ${blocked}`);
  }
}

async function packPackage(destination) {
  const result = await npm(["pack", process.cwd(), "--json"], { cwd: destination });
  const [pack] = JSON.parse(result.stdout.toString());
  return join(destination, pack.filename);
}

async function installPackage(tarball, installRoot, env) {
  await writeFile(join(installRoot, "package.json"), JSON.stringify({ private: true }), "utf8");
  await npm(["install", "--no-audit", "--no-fund", tarball], { cwd: installRoot, env });
  return join(installRoot, "node_modules", "agent-skillboard", "bin", "skillboard.mjs");
}

async function assertCommandFails(promise, pattern, expectedCode) {
  try {
    await promise;
    assert.fail("expected command to fail");
  } catch (error) {
    if (typeof error !== "object" || error === null) throw error;
    assert.equal(Reflect.get(error, "code"), expectedCode);
    assert.match(`${Reflect.get(error, "stdout") ?? ""}\n${Reflect.get(error, "stderr") ?? ""}`, pattern);
  }
}

async function assertMissing(path) {
  await assert.rejects(
    access(path),
    (error) => typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT"
  );
}

function node(args, options = {}) {
  return execFileAsync(process.execPath, args, mergedOptions(options));
}

function npm(args, options = {}) {
  if (process.env.npm_execpath === undefined) {
    return execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      ...mergedOptions(options),
      shell: process.platform === "win32"
    });
  }
  return execFileAsync(process.execPath, [process.env.npm_execpath, ...args], mergedOptions(options));
}

function mergedOptions(options) {
  return {
    cwd: process.cwd(),
    ...options,
    env: withoutNestedNpmExecConfig({
      ...process.env,
      ...(options.env ?? {})
    }),
    maxBuffer: outputLimit
  };
}

function withoutNestedNpmExecConfig(env) {
  const sanitized = { ...env };
  delete sanitized.npm_config_call;
  return sanitized;
}

function legacyMigrationFixture() {
  return `version: 1
skills:
  smoke-skill:
    path: smoke-skill
    status: active
    invocation: manual-only
    exposure: exported
workflows:
  daily:
    harness: codex
    active_skills: [smoke-skill]
    blocked_skills: []
`;
}
