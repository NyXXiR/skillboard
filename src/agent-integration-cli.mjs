import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { commandPrefix, shellQuote } from "./agent-integration-command.mjs";
import { installAgentIntegration, uninstallAgentIntegration } from "./agent-integration-files.mjs";
import { applyOwnership, applyOwnershipTree, resolveSetupHome, setupOwnership } from "./agent-integration-home.mjs";
import { setupAgentSkillTargets, supportedAgentNames } from "./agent-skill-roots.mjs";
import {
  agentRootRegistryPath,
  loadRegisteredAgentRoots,
  mergeRegisteredAgentRoots,
  proposedAgentRoot,
  writeRegisteredAgentRoots
} from "./agent-root-registry.mjs";
import { refreshAgentInventory } from "./inventory-refresh.mjs";
import { reconcileSharedSkills } from "./shared-skill-reconcile.mjs";
import { upgradeLegacyUserPolicy } from "./setup-policy-migration.mjs";

export async function runSetupCommand(options, stdout, runtime = defaultRuntime()) {
  assertSetupOptions(options);
  if (options.get("dir") !== undefined) {
    throw new Error("skillboard setup is agent-layer setup and does not accept --dir");
  }
  const env = runtime.env ?? process.env;
  const home = await resolveSetupHome(env, runtime);
  const existingRoots = await loadRegisteredAgentRoots(home);
  const proposedRoot = await setupSkillRoot(options, home, runtime.cwd ?? process.cwd());
  const registeredRoots = mergeRegisteredAgentRoots(existingRoots, proposedRoot);
  const targets = await agentSetupTargets(options, runtime, home, registeredRoots);
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
  let inventory = await refreshAgentInventory({
    root: home,
    home,
    env,
    registeredRoots,
    preserveLegacyPolicy: true
  });
  const configPath = resolve(home, inventory.configPath);
  let inventoryPath = inventory.inventoryPath === null ? null : resolve(home, inventory.inventoryPath);
  const policyUpgrade = await upgradeLegacyUserPolicy({
    home,
    configPath,
    inventoryPath,
    observedSkillIds: inventory.observedSkillIds,
    failpoint: runtime.migrationFailpoint
  });
  if (policyUpgrade.status === "upgraded") {
    inventoryPath = policyUpgrade.inventoryPath;
    await applyOwnership(configPath, ownership);
    await applyOwnership(inventoryPath, ownership);
    for (const artifact of policyUpgrade.artifacts) await applyOwnership(artifact, ownership);
    inventory = await refreshAgentInventory({ root: home, home, env, registeredRoots });
  }
  const shared = inventoryPath === null
    ? { created: [], unchanged: [], preserved: [], blocked: [] }
    : await reconcileSharedSkills({ home, env, targets, configPath, inventoryPath });
  if (shared.created.length > 0) {
    inventory = await refreshAgentInventory({ root: home, home, env, registeredRoots });
  }
  for (const entry of [...shared.created, ...shared.unchanged]) {
    await applyOwnershipTree(entry.path, ownership);
  }
  if (proposedRoot !== undefined) {
    await writeRegisteredAgentRoots(home, registeredRoots);
    await applyOwnership(agentRootRegistryPath(home), ownership);
  }
  await applyOwnership(configPath, ownership);
  if (inventoryPath !== null) await applyOwnership(inventoryPath, ownership);
  stdout.write("SkillBoard agent integration installed.\n");
  writeList(stdout, "Created", result.created);
  writeList(stdout, "Updated", result.updated);
  writeList(stdout, "Unchanged", result.unchanged);
  writeList(stdout, "Preserved", result.preserved);
  if (proposedRoot !== undefined) stdout.write(`Registered agent roots: ${registeredRoots.length}\n`);
  if (shared.created.length > 0) stdout.write(`Created shared copies: ${shared.created.length}\n`);
  if (shared.unchanged.length > 0) stdout.write(`Unchanged shared copies: ${shared.unchanged.length}\n`);
  writeList(stdout, "Preserved shared copies", shared.preserved.map(formatSharedEntry));
  writeList(stdout, "Blocked shared copies", shared.blocked.map(formatBlockedEntry));
  stdout.write(`User policy: ${inventory.configPath}\n`);
  stdout.write(`Observed skills: ${inventory.scan.scannedSkills}\n`);
  if (policyUpgrade.status === "upgraded") {
    stdout.write("User policy upgraded automatically to version 2.\n");
    stdout.write(`Backup: ${policyUpgrade.backupPath}\n`);
  } else if (policyUpgrade.status === "decision-required") {
    stdout.write("Policy version 1 needs review before migration; no migration files were changed.\n");
    if (policyUpgrade.unobservedSkillIds.length > 0) {
      stdout.write(`Policy skills not currently observed: ${formatList(policyUpgrade.unobservedSkillIds)}\n`);
    }
    stdout.write(`Preview migration: ${commandPrefix(runtime)} migrate v2 --config ${shellQuote(configPath, runtime.platform)} --json\n`);
  }
  stdout.write("Next:\n");
  stdout.write("- Restart or refresh agents that cache user skills.\n");
  stdout.write("- Run skillboard doctor --summary to check policy and executable paths.\n");
  if (policyUpgrade.status === "decision-required") {
    stdout.write("- User-level policy was preserved and installed skills were rescanned; no project was initialized.\n");
  } else {
    stdout.write("- User-level policy and inventory were refreshed; no project was initialized.\n");
  }
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

async function agentSetupTargets(options, runtime, setupHome, registeredRoots) {
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
    targets.push(...await setupAgentSkillTargets(name, home, env, {
      includeFallback: requested.length > 0,
      registeredRoots
    }));
  }
  return targets;
}

async function setupSkillRoot(options, home, cwd) {
  const skillRoot = options.get("skill-root");
  if (skillRoot === undefined) return undefined;
  const requested = readCsv(options.get("agent"));
  if (requested.length !== 1) {
    throw new Error("--skill-root requires exactly one --agent value.");
  }
  return await proposedAgentRoot(home, requested[0], skillRoot, cwd);
}

function assertSetupOptions(options) {
  const allowed = new Set(["yes", "agent", "skill-root"]);
  for (const option of options.keys()) {
    if (!allowed.has(option)) throw new Error(`Unknown setup option: --${option}`);
  }
}

function formatSharedEntry(entry) {
  return `${entry.agent}:${entry.skill}:${entry.path}`;
}

function formatBlockedEntry(entry) {
  return `${entry.agent ?? "unknown"}:${entry.skill}:${entry.reason}`;
}
