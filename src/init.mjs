import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { NON_CALLABLE_WORKFLOW_INVOCATIONS, NON_CALLABLE_WORKFLOW_STATUSES } from "./domain/constants.mjs";
import { isValidSkillState } from "./domain/skill-state-matrix.mjs";
import { refreshAgentInventory } from "./inventory-refresh.mjs";
import { BRIDGE_START, bridgeBlock, defaultConfig, hookReadme, profileReadme } from "./lifecycle-content.mjs";

export async function initProject(options) {
  const root = options.root;
  const configPath = join(root, "skillboard.config.yaml");
  const skillsRoot = join(root, "skills");
  const reportRoot = join(root, ".skillboard", "reports");
  const profileRoot = join(root, ".skillboard", "profiles");
  const hookRoot = join(root, ".skillboard", "hooks");
  const created = [];
  const updated = [];
  await mkdir(skillsRoot, { recursive: true });
  await mkdir(reportRoot, { recursive: true });
  await mkdir(profileRoot, { recursive: true });
  await mkdir(hookRoot, { recursive: true });
  const configCreated = !(await exists(configPath));
  if (configCreated) {
    await writeFile(configPath, defaultConfig(), "utf8");
    created.push("skillboard.config.yaml");
  }
  if (configCreated && options.scanInstalled === false) {
    await refreshAgentInventory({
      root,
      configPath,
      inventory: { skills: [], installUnits: [], scannedSkills: 0, warnings: [] }
    });
    created.push(".skillboard/inventory.json");
  }
  const profileReadmePath = join(profileRoot, "README.md");
  if (!(await exists(profileReadmePath))) {
    await writeFile(profileReadmePath, profileReadme(), "utf8");
    created.push(".skillboard/profiles/README.md");
  }
  const hookReadmePath = join(hookRoot, "README.md");
  if (!(await exists(hookReadmePath))) {
    await writeFile(hookReadmePath, hookReadme(), "utf8");
    created.push(".skillboard/hooks/README.md");
  }
  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    const result = await ensureBridge(join(root, filename));
    if (result === "created") {
      created.push(filename);
    } else if (result === "updated") {
      updated.push(filename);
    }
  }
  const scan = options.scanInstalled === false
    ? { scannedSkills: 0, scannedInstallUnits: 0, changed: false, addedSkills: [], addedInstallUnits: [], updatedInstallUnits: [], addedWorkflows: [], addedHarnesses: [], skippedSkills: [], reviewNotes: [], warnings: [] }
    : await mergeInstalledAgentSkills(configPath, {
      roots: options.scanRoots,
      home: options.home,
      env: options.env
    });
  if (scan.changed && !configCreated) {
    updated.push("skillboard.config.yaml");
  }
  const safety = await summarizeSafety(configPath);
  return {
    created,
    updated,
    scan,
    safety,
    alreadyInitialized: created.length === 0 && updated.length === 0 && !scan.changed
  };
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function ensureBridge(path) {
  const block = bridgeBlock();
  if (!(await exists(path))) {
    await writeFile(path, `${block}\n`, "utf8");
    return "created";
  }
  const current = await readFile(path, "utf8");
  if (current.includes(BRIDGE_START)) {
    return "unchanged";
  }
  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(path, `${current}${separator}${block}\n`, "utf8");
  return "updated";
}

async function mergeInstalledAgentSkills(configPath, options) {
  const result = await refreshAgentInventory({
    root: dirname(configPath),
    configPath,
    roots: options.roots,
    home: options.home,
    env: options.env
  });
  return {
    scannedSkills: result.scan.scannedSkills,
    scannedInstallUnits: result.scan.scannedInstallUnits,
    changed: result.changed,
    addedSkills: result.scan.addedSkills,
    addedInstallUnits: result.scan.addedInstallUnits,
    updatedInstallUnits: result.scan.updatedInstallUnits,
    addedWorkflows: result.scan.addedWorkflows,
    addedHarnesses: result.scan.addedHarnesses,
    skippedSkills: result.scan.skippedSkills,
    reviewNotes: result.scan.reviewNotes,
    warnings: result.scan.warnings
  };
}

async function summarizeSafety(configPath) {
  const config = YAML.parse(await readFile(configPath, "utf8")) ?? {};
  const skills = config.skills && typeof config.skills === "object" ? Object.values(config.skills) : [];
  if (config.version === 2) {
    return {
      enabled: skills.filter((skill) => skill?.enabled === true).length,
      disabled: skills.filter((skill) => skill?.enabled === false).length,
      shared: skills.filter((skill) => skill?.enabled === true && skill.shared === true).length,
      local: skills.filter((skill) => skill?.enabled === true && skill.shared !== true).length
    };
  }
  let automatic = 0;
  let manualOnly = 0;
  let routerOnly = 0;
  let blocked = 0;
  for (const rawSkill of skills) {
    const skill = rawSkill && typeof rawSkill === "object" ? rawSkill : {};
    const status = typeof skill.status === "string" ? skill.status : "vendor";
    const invocation = typeof skill.invocation === "string" ? skill.invocation : "manual-only";
    if (NON_CALLABLE_WORKFLOW_STATUSES.has(status) || NON_CALLABLE_WORKFLOW_INVOCATIONS.has(invocation)) {
      blocked += 1;
      continue;
    }
    if (!isValidSkillState(status, invocation)) {
      continue;
    }
    if (["workflow-auto", "global-auto"].includes(invocation)) {
      automatic += 1;
    }
    if (invocation === "manual-only") {
      manualOnly += 1;
    }
    if (invocation === "router-only") {
      routerOnly += 1;
    }
  }
  return { enabled: automatic + manualOnly + routerOnly, disabled: blocked, global: 0, scoped: automatic + manualOnly + routerOnly };
}
