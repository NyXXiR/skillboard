import { execFile } from "node:child_process";
import { access, chown, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { setupAgentSkillTargets, supportedAgentNames } from "./agent-skill-roots.mjs";
import { initProject } from "./init.mjs";
import { uninstallProject } from "./uninstall.mjs";

const AGENT_INTEGRATION_START = "<!-- BEGIN SKILLBOARD AGENT INTEGRATION -->";
const AGENT_INTEGRATION_END = "<!-- END SKILLBOARD AGENT INTEGRATION -->";
const execFileAsync = promisify(execFile);

export async function runInitCommand(options, stdout, runtime = defaultRuntime()) {
  const root = resolve(options.get("dir") ?? ".");
  const result = await initProject({
    root,
    scanInstalled: options.get("scan-installed") !== "false" && options.get("no-scan-installed") !== "true",
    scanRoots: readCsv(options.get("scan-root"))
  });
  if (result.alreadyInitialized) {
    stdout.write(`SkillBoard already initialized: ${root}\n`);
    return 0;
  }
  stdout.write(`Initialized SkillBoard: ${root}\n`);
  writeList(stdout, "Created", result.created);
  writeList(stdout, "Updated", result.updated);
  if (result.scan.scannedSkills > 0 || result.scan.scannedInstallUnits > 0) {
    stdout.write(`Scanned installed agent skills: ${result.scan.scannedSkills}\n`);
    stdout.write(`Managed install units: ${result.scan.scannedInstallUnits}\n`);
  }
  writeCountedList(stdout, "Added managed skills", result.scan.addedSkills);
  writeList(stdout, "Added install units", result.scan.addedInstallUnits);
  writeList(stdout, "Added workflows", result.scan.addedWorkflows ?? []);
  writeList(stdout, "Added harnesses", result.scan.addedHarnesses ?? []);
  writeList(stdout, "Skipped existing skills", result.scan.skippedSkills);
  writeCountedList(stdout, "Review notes", result.scan.reviewNotes ?? []);
  writeList(stdout, "Scan warnings", result.scan.warnings ?? []);
  writeSafetyDefault(stdout, result.safety);
  writeNextCommands(stdout, {
    command: commandPrefix(runtime),
    dir: options.get("dir"),
    workflows: result.scan.addedWorkflows ?? []
  });
  return 0;
}

export async function runSetupCommand(options, stdout, runtime = defaultRuntime()) {
  if (options.get("dir") !== undefined) {
    throw new Error("skillboard setup is agent-layer setup and does not accept --dir");
  }
  const env = runtime.env ?? process.env;
  const home = await resolveSetupHome(env, runtime);
  const targets = await agentSetupTargets(options, runtime, home);
  if (targets.length === 0) {
    stdout.write("No supported agent user skill roots were detected.\n");
    stdout.write(`Create a supported agent home or pass --agent ${supportedAgentNames().join(",")} to choose targets.\n`);
    return 1;
  }
  if (options.get("yes") !== "true") {
    writeSetupConfirmation(stdout, targets, commandPrefix(runtime));
    if (!canPrompt(runtime)) {
      return 1;
    }
    const confirmed = await promptForSetup(runtime);
    if (!confirmed) {
      stdout.write("Skipped SkillBoard setup.\n");
      return 1;
    }
  }
  const result = await installAgentIntegration(targets, setupOwnership(env, runtime, home));
  stdout.write("SkillBoard agent integration installed.\n");
  writeList(stdout, "Created", result.created);
  writeList(stdout, "Updated", result.updated);
  writeList(stdout, "Unchanged", result.unchanged);
  writeList(stdout, "Preserved", result.preserved);
  stdout.write("Next:\n");
  stdout.write("- Restart or refresh agents that cache user skills.\n");
  stdout.write('- Ask the agent in a workspace: "Which skill should you use for this?"\n');
  return 0;
}

export async function runUninstallCommand(options, stdout) {
  const removeConfig = options.get("remove-config") === "true";
  const resetConfig = options.get("reset-config") === "true";
  const purge = options.get("purge") === "true";
  if (removeConfig && resetConfig) {
    throw new Error("--remove-config and --reset-config are mutually exclusive");
  }
  if (removeConfig && purge) {
    throw new Error("--remove-config cannot be combined with --purge");
  }
  const root = resolve(options.get("dir") ?? ".");
  const result = await uninstallProject({
    root,
    dryRun: options.get("dry-run") === "true",
    removeConfig,
    resetConfig: resetConfig || purge,
    removeReports: options.get("remove-reports") === "true" || purge,
    removeHooks: options.get("remove-hooks") === "true" || purge,
    removeProjectState: purge,
    removeEmptyDirs: options.get("keep-empty-dirs") !== "true"
  });
  stdout.write(`${result.dryRun ? "Dry run: " : ""}Uninstalled SkillBoard: ${root}\n`);
  writeList(stdout, "Removed", result.removed);
  writeList(stdout, "Updated", result.updated);
  writeList(stdout, "Preserved", result.preserved);
  return 0;
}

function writeList(stdout, label, values) {
  if (values.length > 0) {
    stdout.write(`${label}: ${formatList(values)}\n`);
  }
}

function writeCountedList(stdout, label, values) {
  if (values.length === 0) {
    return;
  }
  stdout.write(`${label}: ${values.length}\n`);
  for (const value of sorted(values).slice(0, 5)) {
    stdout.write(`- \`${value}\`\n`);
  }
  const hidden = values.length - 5;
  if (hidden > 0) {
    stdout.write(`- ... ${hidden} more\n`);
  }
}

function writeSafetyDefault(stdout, safety) {
  stdout.write("Skill selection default:\n");
  stdout.write("- Installed user skills are usable unless runtime, user, or local instructions disable them.\n");
  if (safety.automatic === 0) {
    stdout.write("- No automatic model invocation was enabled.\n");
  } else {
    stdout.write(`- ${safety.automatic} automatic skills enabled by existing policy.\n`);
  }
  stdout.write("- Imported local skills are available on request in generated local policy.\n");
  stdout.write("- Runtime/plugin/system skills require source review before automatic invocation.\n");
  stdout.write(`- ${safety.automatic} automatic skills enabled\n`);
  stdout.write(`- ${safety.manualOnly} manual-only skills available\n`);
  stdout.write(`- ${safety.routerOnly} router-only skills available\n`);
  stdout.write(`- ${safety.blocked} blocked/quarantined for safety\n`);
}

function writeNextCommands(stdout, next) {
  const dir = next.dir === undefined ? "" : ` --dir ${shellQuote(next.dir)}`;
  const workflows = sorted(next.workflows ?? []);
  stdout.write("Next:\n");
  stdout.write('- Ask your AI: "What skills can you use in this project?"\n');
  stdout.write(`- ${next.command} doctor${dir} --summary\n`);
  if (workflows.length === 0) {
    stdout.write(`- ${next.command} brief${dir}\n`);
    stdout.write(`- ${next.command} brief${dir} --verbose\n`);
    return;
  }
  const workflow = workflows[0];
  stdout.write(`Choose a workflow: ${formatList(workflows)}\n`);
  stdout.write(`Example workflow brief: ${formatList([workflow])}\n`);
  stdout.write(`- ${next.command} brief --workflow ${shellQuote(workflow)}${dir}\n`);
  stdout.write('Example task routing: "write tests before implementation"\n');
  stdout.write(`- ${next.command} brief --workflow ${shellQuote(workflow)} --intent ${shellQuote("write tests before implementation")}${dir}\n`);
  stdout.write(`- ${next.command} brief --workflow ${shellQuote(workflow)}${dir} --verbose\n`);
}

function writeSetupConfirmation(stdout, targets, command) {
  stdout.write("SkillBoard setup installs agent-layer integration, not project files.\n");
  stdout.write("It writes a SkillBoard guidance skill into detected user agent skill roots so agents can resolve skill priority when choices overlap.\n");
  stdout.write("Targets:\n");
  for (const target of targets) {
    stdout.write(`- ${target.agent}: ${target.skillPath}\n`);
  }
  stdout.write("Run with --yes to install agent-layer integration:\n");
  stdout.write(`- ${command} setup --agent ${targets.map((target) => target.agent).join(",")} --yes\n`);
}

function canPrompt(runtime) {
  return runtime.stdin?.isTTY === true && runtime.stdout?.isTTY === true;
}

async function promptForSetup(runtime) {
  const rl = createInterface({
    input: runtime.stdin,
    output: runtime.stdout
  });
  try {
    const answer = await question(rl, "Install SkillBoard agent integration now? [y/N] ");
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function formatList(values) {
  return values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", ");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function readCsv(value) {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function defaultRuntime() {
  return {
    cwd: process.cwd(),
    entrypointPath: process.argv[1],
    packageSpec: process.env.npm_config_package
  };
}

async function agentSetupTargets(options, runtime, setupHome) {
  const env = runtime.env ?? process.env;
  const home = setupHome ?? await resolveSetupHome(env, runtime);
  const requested = readCsv(options.get("agent"));
  const supported = new Set(supportedAgentNames());
  const names = requested.length === 0 ? supportedAgentNames() : requested;
  const targets = [];
  for (const name of names) {
    if (!supported.has(name)) {
      throw new Error(`Unsupported setup agent: ${name}`);
    }
    targets.push(...await setupAgentSkillTargets(name, home, env, { includeFallback: requested.length > 0 }));
  }
  return targets;
}

async function resolveSetupHome(env, runtime) {
  const explicit = nonEmpty(env.SKILLBOARD_SETUP_HOME);
  if (explicit !== null) {
    return explicit;
  }
  if (shouldUseSudoUserHome(env)) {
    const sudoHome = nonEmpty(env.SUDO_HOME)
      ?? await passwdHome(env.SUDO_USER, runtime.passwdPath ?? "/etc/passwd")
      ?? await getentHome(env.SUDO_USER, env)
      ?? await conventionalUserHome(env.SUDO_USER);
    if (sudoHome !== null) {
      return sudoHome;
    }
  }
  return env.HOME ?? env.USERPROFILE;
}

function setupOwnership(env, runtime, home) {
  if (process.platform === "win32" || !shouldUseSudoUserHome(env)) {
    return null;
  }
  const uid = parseNonNegativeInteger(env.SUDO_UID);
  const gid = parseNonNegativeInteger(env.SUDO_GID);
  if (uid === null || gid === null) {
    return null;
  }
  const chownFunction = runtime.chown ?? chown;
  if (runtime.chown === undefined && !canApplyProcessOwnership(uid, gid)) {
    return null;
  }
  return {
    uid,
    gid,
    home: resolve(home),
    chown: chownFunction
  };
}

function canApplyProcessOwnership(uid, gid) {
  if (typeof process.getuid !== "function") {
    return false;
  }
  if (process.getuid() === 0) {
    return true;
  }
  if (typeof process.getgid !== "function") {
    return process.getuid() === uid;
  }
  return process.getuid() === uid && process.getgid() === gid;
}

function parseNonNegativeInteger(value) {
  if (value === undefined || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function shouldUseSudoUserHome(env) {
  const sudoUser = nonEmpty(env.SUDO_USER);
  return process.platform !== "win32"
    && sudoUser !== null
    && sudoUser !== "root"
    && (
      env.SUDO_UID !== undefined
      || env.SUDO_GID !== undefined
      || env.USER === "root"
      || env.LOGNAME === "root"
      || env.HOME === "/root"
    );
}

async function passwdHome(user, passwdPath) {
  const text = await readFile(passwdPath, "utf8").catch(() => "");
  for (const line of text.split("\n")) {
    if (line.startsWith(`${user}:`)) {
      return nonEmpty(line.split(":")[5]);
    }
  }
  return null;
}

async function getentHome(user, env) {
  try {
    const { stdout } = await execFileAsync("getent", ["passwd", user], {
      env,
      timeout: 1000
    });
    return nonEmpty(stdout.trim().split(":")[5]);
  } catch {
    return null;
  }
}

async function conventionalUserHome(user) {
  const candidates = process.platform === "darwin"
    ? [`/Users/${user}`]
    : [`/home/${user}`];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

function nonEmpty(value) {
  return value === undefined || value.trim() === "" ? null : value;
}

async function installAgentIntegration(targets, ownership = null) {
  const created = [];
  const updated = [];
  const unchanged = [];
  const preserved = [];
  const content = agentIntegrationSkill();
  for (const target of targets) {
    const existing = await readFile(target.skillPath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    });
    if (existing === content) {
      await applyOwnership(target.skillPath, ownership);
      unchanged.push(`${target.agent}:${target.skillPath}`);
      continue;
    }
    if (existing !== null && !existing.includes(AGENT_INTEGRATION_START)) {
      preserved.push(`${target.agent}:${target.skillPath}`);
      continue;
    }
    await mkdir(dirname(target.skillPath), { recursive: true });
    await writeFile(target.skillPath, content, "utf8");
    await applyOwnership(target.skillPath, ownership);
    (existing === null ? created : updated).push(`${target.agent}:${target.skillPath}`);
  }
  return { created, updated, unchanged, preserved };
}

async function applyOwnership(path, ownership) {
  if (ownership === null) {
    return;
  }
  for (const ownedPath of ownershipPaths(path, ownership.home)) {
    await ownership.chown(ownedPath, ownership.uid, ownership.gid);
  }
}

function ownershipPaths(path, home) {
  const resolvedHome = resolve(home);
  const resolvedPath = resolve(path);
  if (!isInside(resolvedPath, resolvedHome)) {
    return [];
  }
  const directories = [];
  let current = dirname(resolvedPath);
  while (current !== resolvedHome && isInside(current, resolvedHome)) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return [...directories.reverse(), resolvedPath];
}

function isInside(path, parent) {
  const relativePath = relative(parent, path);
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function agentIntegrationSkill() {
  return `---
name: skillboard
description: Use SkillBoard when several installed skills could apply, a skill choice is ambiguous, or the user asks which skill should be used, preferred, avoided, reviewed, or prioritized for the current workflow.
---
${AGENT_INTEGRATION_START}
# SkillBoard Agent Integration

Use this skill to let SkillBoard guide skill selection above individual projects.

## Layering

- SkillBoard is the user-level control plane for skill priority, overlap resolution, and workflow-aware routing.
- Project management belongs to the agent or workspace layer. Do not initialize, attach, rewrite, or manage a project just because SkillBoard is installed.
- Package install and \`skillboard setup\` install user-agent guidance only.

## Default Behavior

- Installed user skills are usable by default unless the runtime, user, or local instructions disable them.
- Do not ask for permission merely because you selected a skill.
- When you use a skill, disclose it briefly at the start and completion.
- Use SkillBoard when more than one skill matches, when skills overlap, or when workflow priority should choose between plausible skills.

## Cross-Agent Skill Reuse

- When the user wants to use a skill from another agent, run \`skillboard import-skill --from <source-agent> --to <this-agent> --skill <skill> --json\`.
- If SkillBoard reports the skill is compatible, install it with \`--yes\` and use the copied target-agent skill.
- If SkillBoard reports \`needs-adaptation\`, explain the compatibility reasons and ask before changing the skill body for this agent.
- If the user approves, inspect the source skill, write an adapted \`SKILL.md\` for this agent, then install it with \`skillboard import-skill --from <source-agent> --to <this-agent> --skill <skill> --adapted-file <adapted-skill.md> --yes --json\`.
- This is still user-agent setup. Do not create or mutate project policy files for cross-agent skill reuse.

## Ambiguity Resolution

1. Identify the candidate skills that match the request.
2. Prefer the skill whose description, workflow guidance, and local instructions most directly match the user's task.
3. If a project or agent has explicit SkillBoard policy, use \`skillboard brief --intent <request> --json\` or \`skillboard route <intent> --workflow <name> --json\` to break ties.
4. If the best choice is still ambiguous or the choice would change persistent policy, ask the user which priority to remember.
5. Continue with the selected skill; do not stop only because other candidate skills exist.

${AGENT_INTEGRATION_END}
`;
}

function commandPrefix(runtime) {
  const entrypoint = runtime.entrypointPath ?? "";
  const normalized = entrypoint.replace(/\\/g, "/");
  if (normalized.includes("/_npx/")) {
    const packageSpec = runtime.packageSpec ?? "agent-skillboard";
    return `npx --yes --package ${shellQuote(packageSpec)} skillboard`;
  }
  if (isSourceTreeEntrypoint(entrypoint)) {
    return `node ${sourceTreeEntrypoint(entrypoint, runtime.cwd ?? process.cwd())}`;
  }
  return "skillboard";
}

function isSourceTreeEntrypoint(entrypoint) {
  if (entrypoint === "") {
    return false;
  }
  const normalized = entrypoint.replace(/\\/g, "/");
  return (normalized === "bin/skillboard.mjs" || normalized.endsWith("/bin/skillboard.mjs"))
    && !normalized.includes("/node_modules/")
    && !normalized.includes("/_npx/")
    && !normalized.includes("/.npm/");
}

function sourceTreeEntrypoint(entrypoint, cwd) {
  const absoluteEntrypoint = isAbsolute(entrypoint) ? entrypoint : resolve(cwd, entrypoint);
  const relativeEntrypoint = relative(cwd, absoluteEntrypoint).replace(/\\/g, "/");
  if (!relativeEntrypoint.startsWith("../") && relativeEntrypoint !== ".." && !isAbsolute(relativeEntrypoint)) {
    return shellQuote(relativeEntrypoint);
  }
  return shellQuote(absoluteEntrypoint);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
