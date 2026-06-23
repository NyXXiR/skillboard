import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  checkPolicy,
  importSource,
  initProject,
  impactDisable,
  loadSourceProfile,
  loadWorkspace,
  mergeImportFragment,
  reconcileWorkspace,
  renderDashboard,
  renderImportFragment,
  renderReconcilePlan
} from "./index.mjs";

export async function main(argv, stdout, stderr) {
  try {
    return await run(argv, stdout, stderr);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function run(argv, stdout, stderr) {
  const command = argv[0] ?? "help";
  const options = parseOptions(argv.slice(1));
  switch (command) {
    case "init":
      return await init(options, stdout);
    case "import":
      return await importProfile(options, stdout);
    case "scan":
      return await scan(options, stdout);
    case "check":
      return await check(options, stdout, stderr);
    case "dashboard":
      return await dashboard(options, stdout);
    case "reconcile":
      return await reconcile(options, stdout);
    case "impact":
      return await impact(argv.slice(1), options, stdout);
    case "help":
    case "--help":
    case "-h":
      stdout.write(helpText());
      return 0;
    default:
      stderr.write(`Unknown command: ${command}\n`);
      stdout.write(helpText());
      return 1;
  }
}

async function importProfile(options, stdout) {
  const profileRef = options.get("profile");
  const sourceRoot = options.get("source-root");
  if (profileRef === undefined || sourceRoot === undefined) {
    throw new Error("Usage: skillboard import --profile <id-or-path> --source-root <dir>");
  }
  const profile = await loadSourceProfile(profileRef, { profileDirs: readCsv(options.get("profile-dirs")) });
  const imported = await importSource({ profile, sourceRoot });
  if (options.get("merge") === "true") {
    return await mergeImport(options, imported, stdout);
  }
  const fragment = renderImportFragment(imported);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(fragment);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, fragment, "utf8");
  stdout.write(`Import fragment written: ${out}\n`);
  return 0;
}

async function mergeImport(options, imported, stdout) {
  const path = options.get("config");
  if (path === undefined) {
    throw new Error("Usage: skillboard import --profile <id-or-path> --source-root <dir> --config <path> --merge");
  }
  const merged = mergeImportFragment(await readFile(path, "utf8"), imported, { replace: options.get("replace") === "true" });
  await writeFile(path, merged.text, "utf8");
  stdout.write(`Import merged: ${path}\n`);
  stdout.write(`Skills: ${formatList(merged.addedSkills)}\n`);
  stdout.write(`Install units: ${formatList(merged.addedInstallUnits)}\n`);
  if (merged.replacedSkills.length > 0 || merged.replacedInstallUnits.length > 0) {
    stdout.write(`Replaced skills: ${formatList(merged.replacedSkills)}\n`);
    stdout.write(`Replaced install units: ${formatList(merged.replacedInstallUnits)}\n`);
  }
  return 0;
}

async function init(options, stdout) {
  const root = resolve(options.get("dir") ?? ".");
  const result = await initProject({ root });
  if (result.alreadyInitialized) {
    stdout.write(`SkillBoard already initialized: ${root}\n`);
    return 0;
  }
  stdout.write(`Initialized SkillBoard: ${root}\n`);
  if (result.created.length > 0) {
    stdout.write(`Created: ${formatList(result.created)}\n`);
  }
  if (result.updated.length > 0) {
    stdout.write(`Updated: ${formatList(result.updated)}\n`);
  }
  return 0;
}

async function scan(options, stdout) {
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  stdout.write(`${JSON.stringify(workspace, null, 2)}\n`);
  return 0;
}

async function check(options, stdout, stderr) {
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = checkPolicy(workspace);
  const output = [...result.errors, ...result.warnings].join("\n");
  if (output.length > 0) {
    (result.ok ? stdout : stderr).write(`${output}\n`);
  }
  stdout.write(result.ok ? "Policy check passed\n" : "Policy check failed\n");
  return result.ok ? 0 : 1;
}

async function dashboard(options, stdout) {
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const markdown = renderDashboard(workspace);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(markdown);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  stdout.write(`Dashboard written: ${out}\n`);
  return 0;
}

async function reconcile(options, stdout) {
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const plan = reconcileWorkspace(workspace, { actualHarnesses: readCsv(options.get("actual-harnesses")) });
  const markdown = renderReconcilePlan(plan);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(markdown);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  stdout.write(`Reconcile plan written: ${out}\n`);
  return 0;
}

async function impact(argv, options, stdout) {
  if (argv[0] !== "disable" || argv[1] === undefined) {
    throw new Error("Usage: skillboard impact disable <skill-id>");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = impactDisable(workspace, argv[1]);
  const markdown = renderImpact(result);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(markdown);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  stdout.write(`Impact report written: ${out}\n`);
  return 0;
}

function renderImpact(result) {
  return [
    `# Disable Impact: ${result.skillId}`,
    "",
    `- Found: \`${result.exists}\``,
    `- Risk: ${result.risk}`,
    `- Affected workflows: ${formatList(result.affectedWorkflows)}`,
    `- Affected required outputs: ${formatList(result.affectedOutputs)}`,
    `- Alternatives: ${formatList(result.alternatives)}`,
    ""
  ].join("\n");
}

function configPath(options) {
  return options.get("config") ?? "skillboard.config.yaml";
}

function skillsRoot(options) {
  return options.get("skills");
}

function parseOptions(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      options.set(key, "true");
      continue;
    }
    options.set(key, value);
    index += 1;
  }
  return options;
}

function formatList(values) {
  return values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", ");
}

function readCsv(value) {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function helpText() {
  return `SkillBoard - workflow-scoped agent skill policy\n\nCommands:\n  init [--dir <path>]\n  import --profile <id-or-path> --source-root <dir> [--profile-dirs a,b] [--out <path>]\n  import --profile <id-or-path> --source-root <dir> --config <path> --merge [--replace]\n  scan --config <path>\n  check --config <path> --skills <dir>\n  dashboard --config <path> --skills <dir> [--out <path>]\n  reconcile --config <path> --skills <dir> [--actual-harnesses a,b] [--out <path>]\n  impact disable <skill-id> --config <path> --skills <dir> [--out <path>]\n`;
}
