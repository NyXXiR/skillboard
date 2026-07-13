import { isAbsolute, relative, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { installAgentIntegration, uninstallAgentIntegration } from "./agent-integration-files.mjs";
import { applyOwnership, resolveSetupHome, setupOwnership } from "./agent-integration-home.mjs";
import { setupAgentSkillTargets, supportedAgentNames } from "./agent-skill-roots.mjs";
import { refreshAgentInventory } from "./inventory-refresh.mjs";

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
  const ownership = setupOwnership(env, runtime, home);
  const result = await installAgentIntegration(targets, ownership);
  await mkdir(home, { recursive: true });
  const inventory = await refreshAgentInventory({ root: home, home, env });
  await applyOwnership(resolve(home, inventory.configPath), ownership);
  if (inventory.inventoryPath !== null) await applyOwnership(resolve(home, inventory.inventoryPath), ownership);
  stdout.write("SkillBoard agent integration installed.\n");
  writeList(stdout, "Created", result.created);
  writeList(stdout, "Updated", result.updated);
  writeList(stdout, "Unchanged", result.unchanged);
  writeList(stdout, "Preserved", result.preserved);
  stdout.write(`User policy: ${inventory.configPath}\n`);
  stdout.write(`Observed skills: ${inventory.scan.scannedSkills}\n`);
  stdout.write("Next:\n");
  stdout.write("- Restart or refresh agents that cache user skills.\n");
  stdout.write("- User-level policy and inventory were refreshed; no project was initialized.\n");
  stdout.write('- Ask the agent in a workspace: "Review this plan and point out weak assumptions."\n');
  stdout.write("- SkillBoard will step in when skills overlap, routing is ambiguous, or you ask for a skill decision.\n");
  return 0;
}

export async function runAgentLayerUninstallCommand(options, stdout, runtime = defaultRuntime()) {
  if (options.get("dir") !== undefined) {
    throw new Error("skillboard uninstall --agent-layer is agent-layer cleanup and does not accept --dir");
  }
  for (const option of ["remove-config", "reset-config", "purge", "keep-settings", "remove-reports", "remove-hooks"]) {
    if (options.get(option) === "true") {
      throw new Error(`--${option} cannot be combined with --agent-layer`);
    }
  }
  const env = runtime.env ?? process.env;
  const home = await resolveSetupHome(env, runtime);
  const targets = await agentSetupTargets(options, runtime, home);
  if (targets.length === 0) {
    stdout.write("No supported agent user skill roots were detected.\n");
    return 0;
  }
  const dryRun = options.get("dry-run") === "true";
  const result = await uninstallAgentIntegration(targets, dryRun);
  stdout.write(`${dryRun ? "Dry run: " : ""}Uninstalled SkillBoard agent integration.\n`);
  writeList(stdout, "Removed", result.removed);
  writeList(stdout, "Updated", result.updated);
  writeList(stdout, "Preserved", result.preserved);
  writeList(stdout, "Absent", result.absent);
  return 0;
}

function writeList(stdout, label, values) {
  if (values.length > 0) {
    stdout.write(`${label}: ${formatList(values)}\n`);
  }
}

function writeSetupConfirmation(stdout, targets, command) {
  stdout.write("SkillBoard setup installs agent-layer integration, not project files.\n");
  stdout.write("It writes a SkillBoard guidance skill into detected user agent skill roots so agents can resolve skill priority when choices overlap.\n");
  stdout.write("It creates ~/skillboard.config.yaml and ~/.skillboard/inventory.json as one user-level control plane; skillboard init is not needed for normal use.\n");
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
