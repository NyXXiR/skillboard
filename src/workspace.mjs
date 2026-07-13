import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import YAML from "yaml";
import {
  readBoolean,
  readOptionalRecord,
  readOptionalString,
  readRequiredString,
  readString,
  readStringList,
  requireRecord
} from "./config-helpers.mjs";
import {
  EXPOSURE_VALUES,
  HARNESS_STATUS_VALUES,
  INVOCATION_VALUES,
  STATUS_VALUES
} from "./domain/constants.mjs";
import { parseInstallUnits } from "./install-units.mjs";
import { normalizeSkillPath } from "./skill-paths.mjs";
import { parseV2Policy, serializeV2Policy } from "./domain/v2-policy.mjs";
import { loadV2InventoryIndex } from "./control/v2-guard.mjs";
import { compatibilityForVersion } from "./compatibility.mjs";

export { serializeV2Policy };

/** @returns {Promise<any>} */
export async function loadWorkspace(options) {
  const configText = await readFile(options.configPath, "utf8");
  const parsed = YAML.parse(configText);
  const config = requireRecord(parsed, "config root");
  const version = parseVersion(config.version);
  if (version === 2) {
    return loadV2Workspace(config, options);
  }
  const skills = parseSkills(config.skills);
  const installUnits = parseInstallUnits(config.install_units);
  return {
    version,
    compatibility: compatibilityForVersion(version),
    defaults: parseDefaults(config.defaults),
    installedSkills: await discoverInstalledSkills(options.skillsRoot, skills, {
      configPath: options.configPath,
      env: options.env ?? process.env,
      home: options.home,
      installUnits
    }),
    skills,
    capabilities: parseCapabilities(config.capabilities),
    harnesses: parseHarnesses(config.harnesses),
    installUnits,
    workflows: parseWorkflows(config.workflows)
  };
}

async function loadV2Workspace(config, options) {
  const { workflows, skills } = parseV2Policy(config);
  const inventoryPath = options.inventoryPath ?? join(dirname(options.configPath), ".skillboard", "inventory.json");
  const inventory = await loadV2InventoryIndex(inventoryPath);
  return {
    version: 2,
    compatibility: null,
    defaults: {},
    installedSkills: await discoverInstalledSkills(options.skillsRoot, skills, {
      configPath: options.configPath,
      env: options.env ?? process.env,
      home: options.home,
      installUnits: []
    }),
    skills,
    capabilities: [],
    harnesses: [],
    installUnits: inventory.installUnits ?? [],
    workflows,
    inventory
  };
}

async function discoverInstalledSkills(skillsRoot, declaredSkills, options = {}) {
  const installed = [];
  const installedKeys = new Set();
  if (skillsRoot !== undefined) {
    const skillFiles = await findSkillFiles(skillsRoot);
    for (const file of skillFiles) {
      const frontmatter = parseSkillFrontmatter(await readFile(file, "utf8"));
      const path = relative(skillsRoot, file).replace(/\\/g, "/").replace(/\/SKILL\.md$/, "");
      const declared = declaredSkills.find((skill) => skill.path === path);
      appendInstalledSkill(installed, installedKeys, {
        id: declared?.id ?? frontmatter.name ?? path,
        name: frontmatter.name,
        description: frontmatter.description,
        path
      });
    }
  }
  await appendInstallUnitSkillMetadata(installed, installedKeys, declaredSkills, options);
  return installed.sort((left, right) => left.path.localeCompare(right.path));
}

async function appendInstallUnitSkillMetadata(installed, installedKeys, declaredSkills, options) {
  const units = new Map((options.installUnits ?? []).map((unit) => [unit.id, unit]));
  for (const skill of declaredSkills) {
    if (installedKeys.has(skill.id) || installedKeys.has(skill.path)) {
      continue;
    }
    const unit = units.get(skill.ownerInstallUnit);
    const root = resolveStoredPath(unit?.cachePath, options);
    if (root === undefined) {
      continue;
    }
    const frontmatter = await readOptionalSkillFrontmatter(join(root, skill.path, "SKILL.md"));
    if (frontmatter === null) {
      continue;
    }
    appendInstalledSkill(installed, installedKeys, {
      id: skill.id,
      name: frontmatter.name,
      description: frontmatter.description,
      path: skill.path
    });
  }
}

async function readOptionalSkillFrontmatter(file) {
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) {
    return null;
  }
  try {
    return parseSkillFrontmatter(text);
  } catch {
    return null;
  }
}

function appendInstalledSkill(installed, installedKeys, skill) {
  installed.push(skill);
  installedKeys.add(skill.id);
  installedKeys.add(skill.path);
}

function resolveStoredPath(value, options) {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const home = options.home ?? options.env?.HOME ?? options.env?.USERPROFILE ?? homedir();
  if (value === "~") {
    return home;
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(home, value.slice(2));
  }
  if (isAbsolute(value)) {
    return value;
  }
  return resolve(dirname(options.configPath ?? "."), value);
}

async function findSkillFiles(root, seen = new Set()) {
  const files = [];
  const resolvedRoot = await realpath(root).catch(() => root);
  if (seen.has(resolvedRoot)) {
    return files;
  }
  seen.add(resolvedRoot);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSkillFiles(path, seen)));
    } else if (entry.isSymbolicLink()) {
      const target = await stat(path).catch(() => undefined);
      if (target?.isDirectory()) {
        files.push(...(await findSkillFiles(path, seen)));
      } else if (target?.isFile() && entry.name === "SKILL.md") {
        files.push(path);
      }
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(path);
    }
  }
  return files;
}

function parseSkillFrontmatter(text) {
  const match = /^---[ \t]*\r?\n(?<body>[\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (match?.groups === undefined) {
    throw new Error(
      "SKILL.md is missing YAML frontmatter. " +
      "Add --- delimiters at the top of the file with at least 'name' and 'description'.\n" +
      "Example:\n" +
      "---\n" +
      "name: my-skill\n" +
      "description: What this skill does in one sentence.\n" +
      "---\n" +
      "See docs/user-flow.md for the first-time skill guide."
    );
  }
  const raw = requireRecord(YAML.parse(match.groups.body), "SKILL.md frontmatter");
  return {
    name: readString(raw, "name", ""),
    description: readString(raw, "description", "")
  };
}

function parseVersion(value) {
  if (value === undefined) {
    return 1;
  }
  if (value !== 1 && value !== 2) {
    throw new Error(`Unsupported config version: ${value}`);
  }
  return value;
}

function parseDefaults(value) {
  const raw = requireRecord(value ?? {}, "defaults");
  return {
    invocationPolicy: readString(raw, "invocation_policy", "deny-by-default"),
    allowModelInvocation: readBoolean(raw, "allow_model_invocation", false),
    requireExplicitWorkflow: readBoolean(raw, "require_explicit_workflow", true)
  };
}

function parseSkills(value) {
  const raw = requireRecord(value ?? {}, "skills");
  return Object.entries(raw).map(([id, entry]) => {
    const skill = requireRecord(entry, `skills.${id}`);
    const v2Keys = ["enabled", "shared", "preference"].filter((key) => Object.prototype.hasOwnProperty.call(skill, key));
    if (v2Keys.length > 0) {
      throw new Error(
        `skills.${id} uses version 2 key ${v2Keys.join(", ")} in a version 1 config. ` +
        "Run `skillboard migrate v2` to convert the complete policy."
      );
    }
    const status = readString(skill, "status", "vendor");
    const invocation = readString(skill, "invocation", "manual-only");
    const exposure = readString(skill, "exposure", "exported");
    if (!STATUS_VALUES.has(status)) {
      throw new Error(`Unsupported status for ${id}: ${status}`);
    }
    if (!INVOCATION_VALUES.has(invocation)) {
      throw new Error(`Unsupported invocation for ${id}: ${invocation}`);
    }
    if (!EXPOSURE_VALUES.has(exposure)) {
      throw new Error(`Unsupported exposure for ${id}: ${exposure}`);
    }
    return {
      id,
      path: normalizeSkillPath(readString(skill, "path", id), `skills.${id}.path`),
      status,
      invocation,
      exposure,
      category: readString(skill, "category", "uncategorized"),
      canonicalFor: readStringList(skill, "canonical_for"),
      conflictsWith: readStringList(skill, "conflicts_with"),
      replacedBy: readOptionalString(skill, "replaced_by"),
      ownerInstallUnit: readOptionalString(skill, "owner_install_unit"),
      variant: parseSkillVariant(skill, `skills.${id}.variant`)
    };
  });
}

function parseSkillVariant(skill, label) {
  const raw = readOptionalRecord(skill, "variant", label);
  if (raw === undefined) {
    return null;
  }
  const approved = readOptionalRecord(raw, "approved", `${label}.approved`);
  return {
    of: readRequiredString(raw, "of", `${label}.of`),
    adaptedFor: readOptionalString(raw, "adapted_for") ?? null,
    capability: readRequiredString(raw, "capability", `${label}.capability`),
    workflow: readRequiredString(raw, "workflow", `${label}.workflow`),
    status: readRequiredString(raw, "status", `${label}.status`),
    base: parseVariantCheckpoint(raw, "base", `${label}.base`),
    ...(approved === undefined ? {} : { approved: parseVariantCheckpoint(raw, "approved", `${label}.approved`) })
  };
}

function parseVariantCheckpoint(raw, key, label) {
  const checkpoint = readOptionalRecord(raw, key, label);
  if (checkpoint === undefined) {
    throw new Error(`${label} must be a mapping`);
  }
  return {
    contentDigest: readRequiredString(checkpoint, "content_digest", `${label}.content_digest`),
    snapshot: readRequiredString(checkpoint, "snapshot", `${label}.snapshot`)
  };
}

function parseCapabilities(value) {
  const raw = requireRecord(value ?? {}, "capabilities");
  return Object.entries(raw).map(([name, entry]) => {
    const capability = requireRecord(entry, `capabilities.${name}`);
    const defaultPolicy = readString(capability, "default_policy", "manual-only");
    if (!INVOCATION_VALUES.has(defaultPolicy)) {
      throw new Error(`Unsupported capability default_policy for ${name}: ${defaultPolicy}`);
    }
    return {
      name,
      canonical: readString(capability, "canonical", ""),
      alternatives: readStringList(capability, "alternatives"),
      defaultPolicy
    };
  });
}

function parseHarnesses(value) {
  const raw = requireRecord(value ?? {}, "harnesses");
  return Object.entries(raw).map(([name, entry]) => {
    const harness = requireRecord(entry, `harnesses.${name}`);
    const status = readString(harness, "status", "available");
    if (!HARNESS_STATUS_VALUES.has(status)) {
      throw new Error(`Unsupported harness status for ${name}: ${status}`);
    }
    return {
      name,
      status,
      workflows: readStringList(harness, "workflows"),
      commands: readStringList(harness, "commands")
    };
  });
}

function parseWorkflows(value) {
  const raw = requireRecord(value ?? {}, "workflows");
  return Object.entries(raw).map(([name, entry]) => {
    const workflow = requireRecord(entry, `workflows.${name}`);
    return {
      name,
      harness: readString(workflow, "harness", "unspecified"),
      activeSkills: readStringList(workflow, "active_skills"),
      blockedSkills: readStringList(workflow, "blocked_skills"),
      requiredOutputs: readStringList(workflow, "required_outputs"),
      requiredCapabilities: parseRequiredCapabilities(workflow.required_capabilities, `workflows.${name}.required_capabilities`)
    };
  });
}

function parseRequiredCapabilities(value, label) {
  const raw = requireRecord(value ?? {}, label);
  return Object.entries(raw).map(([name, entry]) => {
    const capability = requireRecord(entry, `${label}.${name}`);
    const policy = readString(capability, "policy", "manual-only");
    if (!INVOCATION_VALUES.has(policy)) {
      throw new Error(`Unsupported capability policy for ${label}.${name}: ${policy}`);
    }
    return {
      name,
      preferred: readString(capability, "preferred", ""),
      fallback: readStringList(capability, "fallback"),
      policy
    };
  });
}
