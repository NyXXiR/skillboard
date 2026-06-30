import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
const outputLimit = 1024 * 1024 * 10;

const temp = await mkdtemp(join(tmpdir(), "skillboard-ci-smoke-"));

try {
  const packageRoot = process.cwd();
  const projectRoot = join(temp, "project");
  const packRoot = join(temp, "package");
  const codexHome = join(temp, "codex-home");
  const repoRoot = join(temp, "source-repo");

  await mkdir(projectRoot, { recursive: true });
  await mkdir(packRoot, { recursive: true });
  await mkdir(join(codexHome, "skills", "smoke-skill"), { recursive: true });
  await writeFile(
    join(codexHome, "skills", "smoke-skill", "SKILL.md"),
    "---\nname: Smoke Skill\ndescription: CI inventory smoke\n---\n",
    "utf8"
  );

  await assertPackContents(packageRoot);

  const tarball = await packPackage(packRoot);
  await npm(["exec", "--yes", "--package", tarball, "--", "skillboard", "help"]);
  await npm(["exec", "--yes", "--package", tarball, "--", "skillboard", "init", "--dir", projectRoot, "--no-scan-installed"]);

  await node(["bin/skillboard.mjs", "inventory", "refresh", "--dir", projectRoot, "--dry-run"], {
    env: { CODEX_HOME: codexHome }
  });
  await node(["bin/skillboard.mjs", "inventory", "refresh", "--dir", projectRoot], {
    env: { CODEX_HOME: codexHome }
  });
  await assertFileContains(join(projectRoot, "skillboard.config.yaml"), "smoke-skill");

  await node(["bin/skillboard.mjs", "doctor", "--dir", projectRoot]);
  await node(["bin/skillboard.mjs", "status", "--dir", projectRoot, "--json"]);
  await node(["bin/skillboard.mjs", "check", "--config", join(projectRoot, "skillboard.config.yaml"), "--skills", join(projectRoot, "skills")]);

  await writeFile(
    join(projectRoot, "install.log"),
    "Installed commands: $smoke-run\nRegistered hooks: post-tool-use\nConfigured MCP servers: smoke_mcp\nUpdated config: smoke-config.json\n",
    "utf8"
  );
  await writeFile(
    join(projectRoot, "smoke-config.json"),
    JSON.stringify({ commands: ["$smoke-config"], mcpServers: { smoke_config_mcp: { command: "node" } } }),
    "utf8"
  );
  await node([
    "bin/skillboard.mjs",
    "inventory",
    "detect",
    "--config",
    join(projectRoot, "skillboard.config.yaml"),
    "--unit",
    "smoke.runtime",
    "--source",
    "npx smoke install",
    "--install-output",
    join(projectRoot, "install.log"),
    "--config-file",
    join(projectRoot, "smoke-config.json")
  ]);
  await assertFileContains(join(projectRoot, "skillboard.config.yaml"), "smoke.runtime");

  await createSourceRepo(repoRoot);
  await addRemoteSource(join(projectRoot, "skillboard.config.yaml"), repoRoot);
  await node(["bin/skillboard.mjs", "sources", "refresh", "--dir", projectRoot, "--unit", "smoke.remote"]);
  await assertFileContains(join(projectRoot, "skillboard.config.yaml"), "source_digest: sha256:");

  await node(["bin/skillboard.mjs", "uninstall", "--dir", projectRoot, "--dry-run"]);
  await node(["bin/skillboard.mjs", "uninstall", "--dir", projectRoot]);
} finally {
  await rm(temp, { recursive: true, force: true });
}

async function assertPackContents(packageRoot) {
  const result = await npm(["pack", "--dry-run", "--json"], { cwd: packageRoot });
  const [pack] = JSON.parse(result.stdout.toString());
  const paths = pack.files.map((file) => file.path);

  for (const required of [
    "bin/skillboard.mjs",
    "src/doctor.mjs",
    "src/source-cache.mjs",
    "src/install-output-detector.mjs",
    "docs/install.md"
  ]) {
    assert.ok(paths.includes(required), `missing ${required}`);
  }

  for (const blocked of [".omo/", "test/"]) {
    assert.equal(paths.some((path) => path.startsWith(blocked)), false, `packed internal path ${blocked}`);
  }
}

async function packPackage(destination) {
  const result = await npm(["pack", "--json", "--pack-destination", destination]);
  const [pack] = JSON.parse(result.stdout.toString());

  return join(destination, pack.filename);
}

async function createSourceRepo(repoRoot) {
  await mkdir(repoRoot, { recursive: true });
  await git(["-C", repoRoot, "init"]);
  await writeFile(join(repoRoot, "README.md"), "source smoke\n", "utf8");
  await git(["-C", repoRoot, "add", "README.md"]);
  await git(["-C", repoRoot, "-c", "user.email=ci@example.test", "-c", "user.name=SkillBoardCI", "commit", "-m", "init"]);
}

async function addRemoteSource(configPath, repoRoot) {
  const doc = YAML.parseDocument(await readFile(configPath, "utf8"));
  const currentUnits = doc.get("install_units", true);
  const units = YAML.isMap(currentUnits) ? currentUnits : doc.createNode({});

  if (!YAML.isMap(units)) {
    throw new Error("expected install_units to be a YAML map");
  }
  if (!YAML.isMap(currentUnits)) {
    doc.set("install_units", units);
  }

  units.set("smoke.remote", doc.createNode({
    kind: "marketplace",
    source: `git clone ${pathToFileURL(repoRoot).href}`,
    scope: "user-global",
    enabled: true,
    permission_risk: "low"
  }));
  await writeFile(configPath, String(doc), "utf8");
}

async function assertFileContains(path, expected) {
  const text = await readFile(path, "utf8");

  assert.ok(text.includes(expected), `expected ${path} to contain ${expected}`);
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

function git(args, options = {}) {
  return execFileAsync("git", args, mergedOptions(options));
}

function mergedOptions(options) {
  return {
    cwd: process.cwd(),
    ...options,
    env: {
      ...process.env,
      ...(options.env ?? {})
    },
    maxBuffer: outputLimit
  };
}
