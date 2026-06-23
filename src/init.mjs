import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverAgentSkillInventory, mergeAgentSkillInventory } from "./agent-inventory.mjs";
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
    ? { scannedSkills: 0, scannedInstallUnits: 0, changed: false, addedSkills: [], addedInstallUnits: [], updatedInstallUnits: [], skippedSkills: [] }
    : await mergeInstalledAgentSkills(configPath, {
      roots: options.scanRoots,
      home: options.home,
      env: options.env
    });
  if (scan.changed && !configCreated) {
    updated.push("skillboard.config.yaml");
  }
  return {
    created,
    updated,
    scan,
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
  const inventory = await discoverAgentSkillInventory(options);
  const current = await readFile(configPath, "utf8");
  const merged = mergeAgentSkillInventory(current, inventory);
  if (merged.changed) {
    await writeFile(configPath, merged.text, "utf8");
  }
  return {
    scannedSkills: inventory.skills.length,
    scannedInstallUnits: inventory.installUnits.length,
    changed: merged.changed,
    addedSkills: merged.addedSkills,
    addedInstallUnits: merged.addedInstallUnits,
    updatedInstallUnits: merged.updatedInstallUnits,
    skippedSkills: merged.skippedSkills
  };
}
