import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import YAML from "yaml";
import {
  readBoolean,
  readOptionalString,
  readString,
  readStringList,
  requireRecord
} from "./config-helpers.mjs";
import { parseInstallUnits } from "./install-units.mjs";

const STATUS_VALUES = new Set([
  "discovered",
  "quarantined",
  "vendor",
  "candidate",
  "active",
  "active-manual",
  "active-router",
  "active-auto",
  "canonical",
  "blocked",
  "deprecated",
  "archived",
  "removed"
]);
const INVOCATION_VALUES = new Set([
  "manual-only",
  "router-only",
  "workflow-auto",
  "global-auto",
  "blocked",
  "deprecated"
]);
const HARNESS_STATUS_VALUES = new Set(["available", "configured", "primary", "fallback", "disabled", "removed"]);
const EXPOSURE_VALUES = new Set(["exported", "global-meta", "unit-managed", "private"]);

export async function loadWorkspace(options) {
  const configText = await readFile(options.configPath, "utf8");
  const parsed = YAML.parse(configText);
  const config = requireRecord(parsed, "config root");
  const version = parseVersion(config.version);
  const skills = parseSkills(config.skills);
  return {
    version,
    defaults: parseDefaults(config.defaults),
    installedSkills: await discoverInstalledSkills(options.skillsRoot, skills),
    skills,
    capabilities: parseCapabilities(config.capabilities),
    harnesses: parseHarnesses(config.harnesses),
    installUnits: parseInstallUnits(config.install_units),
    workflows: parseWorkflows(config.workflows)
  };
}

async function discoverInstalledSkills(skillsRoot, declaredSkills) {
  if (skillsRoot === undefined) {
    return [];
  }
  const skillFiles = await findSkillFiles(skillsRoot);
  const installed = [];
  for (const file of skillFiles) {
    const frontmatter = parseSkillFrontmatter(await readFile(file, "utf8"));
    const path = relative(skillsRoot, file).replace(/\/SKILL\.md$/, "");
    const declared = declaredSkills.find((skill) => skill.path === path);
    installed.push({
      id: declared?.id ?? frontmatter.name ?? path,
      name: frontmatter.name,
      description: frontmatter.description,
      path
    });
  }
  return installed.sort((left, right) => left.path.localeCompare(right.path));
}

async function findSkillFiles(root) {
  const files = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSkillFiles(path)));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(path);
    }
  }
  return files;
}

function parseSkillFrontmatter(text) {
  const match = /^---[ \t]*\r?\n(?<body>[\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (match?.groups === undefined) {
    throw new Error("SKILL.md is missing YAML frontmatter");
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
  if (value !== 1) {
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
      path: readString(skill, "path", id),
      status,
      invocation,
      exposure,
      category: readString(skill, "category", "uncategorized"),
      canonicalFor: readStringList(skill, "canonical_for"),
      conflictsWith: readStringList(skill, "conflicts_with"),
      replacedBy: readOptionalString(skill, "replaced_by"),
      ownerInstallUnit: readOptionalString(skill, "owner_install_unit")
    };
  });
}

function parseCapabilities(value) {
  const raw = requireRecord(value ?? {}, "capabilities");
  return Object.entries(raw).map(([name, entry]) => {
    const capability = requireRecord(entry, `capabilities.${name}`);
    return {
      name,
      canonical: readString(capability, "canonical", ""),
      alternatives: readStringList(capability, "alternatives"),
      defaultPolicy: readString(capability, "default_policy", "manual-only")
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
    return {
      name,
      preferred: readString(capability, "preferred", ""),
      fallback: readStringList(capability, "fallback"),
      policy: readString(capability, "policy", "manual-only")
    };
  });
}
