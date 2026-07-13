import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import YAML from "yaml";
import { readString, requireRecord } from "./config-helpers.mjs";
import { textChangePlan } from "./change-plan.mjs";
import { loadSourceProfile } from "./source-profile-loader.mjs";

export { loadSourceProfile };

export async function importSource(options) {
  const sourceRoot = resolve(options.sourceRoot);
  const profile = options.profile;
  const files = await findSkillFiles(sourceRoot);
  const matchedFiles = files
    .map((file) => ({
      file,
      relativeFile: relative(sourceRoot, file).replace(/\\/g, "/")
    }))
    .filter((entry) => matchesAnyProfilePattern(entry.relativeFile, profile.skillPaths))
    .sort((left, right) => left.relativeFile.localeCompare(right.relativeFile));
  const skills = [];
  const warnings = [];

  for (const entry of matchedFiles) {
    const frontmatter = parseSkillFrontmatter(await readFile(entry.file, "utf8"));
    const pathRule = matchingPathRule(entry.relativeFile, profile);
    const slug = skillSlug(entry.relativeFile, frontmatter, profile);
    const id = skillId(slug, frontmatter, profile);
    const path = skillTargetPath(slug, profile);
    skills.push({
      id,
      path,
      skillFile: entry.file,
      status: pathRule?.status ?? profile.defaultStatus,
      invocation: safeDefaultInvocation(pathRule?.invocation ?? profile.defaultInvocation),
      exposure: pathRule?.exposure ?? profile.defaultExposure,
      category: pathRule?.category ?? categoryFromPath(entry.relativeFile, profile) ?? profile.defaultCategory,
      ownerInstallUnit: profile.id,
      description: frontmatter.description
    });
  }

  if (skills.length === 0) {
    warnings.push(`No SKILL.md files matched profile ${profile.id} under ${sourceRoot}`);
  }

  return {
    profile,
    sourceRoot,
    skills,
    installUnit: {
      id: profile.id,
      kind: profile.kind,
      sourceClass: profile.sourceClass,
      priority: profile.priority,
      trustLevel: profile.trustLevel,
      sourceDigest: profile.sourceDigest,
      signature: profile.signature,
      publicKey: profile.publicKey,
      verifiedAt: profile.verifiedAt,
      source: profile.source || sourceRoot,
      scope: profile.scope,
      manifestPath: profile.manifestPath,
      cachePath: profile.cachePath,
      providedComponents: profile.providedComponents,
      components: {
        skills: skills.map((skill) => skill.id),
        commands: profile.components.commands,
        hooks: profile.components.hooks,
        mcpServers: profile.components.mcpServers
      },
      modifiedConfigFiles: profile.modifiedConfigFiles,
      autoUpdate: profile.autoUpdate,
      enabled: profile.enabled,
      workflowDependencies: profile.workflowDependencies,
      permissionRisk: profile.permissionRisk,
      rollback: profile.rollback
    },
    warnings
  };
}

export function renderImportFragment(imported) {
  return YAML.stringify(importFragment(imported));
}

export function mergeImportFragment(configText, imported, options = {}) {
  const document = YAML.parseDocument(configText);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  requireYamlMap(document.contents, "config root");
  if (document.get("version") === 2) {
    return mergeV2ImportFragment(document, configText, imported);
  }
  const fragment = importFragment(imported);
  const replace = options.replace === true;
  const skillIds = Object.keys(fragment.skills);
  const unitIds = Object.keys(fragment.install_units);
  const existingSkills = ensureMap(document, "skills");
  const existingUnits = ensureMap(document, "install_units");
  const duplicateSkills = skillIds.filter((id) => existingSkills.get(id, true) !== undefined);
  const duplicateUnits = unitIds.filter((id) => existingUnits.get(id, true) !== undefined);

  if (!replace && (duplicateSkills.length > 0 || duplicateUnits.length > 0)) {
    throw new Error(duplicateMessage(duplicateSkills, duplicateUnits));
  }

  for (const skillId of skillIds) {
    existingSkills.set(skillId, document.createNode(fragment.skills[skillId]));
  }
  for (const unitId of unitIds) {
    existingUnits.set(unitId, document.createNode(fragment.install_units[unitId]));
  }
  const text = preserveLineEndings(String(document), configText);
  const plan = textChangePlan(configText, text);
  return {
    text,
    changed: plan.changed,
    plan,
    addedSkills: skillIds,
    addedInstallUnits: unitIds,
    replacedSkills: duplicateSkills,
    replacedInstallUnits: duplicateUnits
  };
}

function mergeV2ImportFragment(document, configText, imported) {
  const existingSkills = ensureMap(document, "skills");
  const addedSkills = [];
  for (const skill of imported.skills) {
    if (existingSkills.get(skill.id, true) !== undefined) {
      continue;
    }
    existingSkills.set(skill.id, document.createNode({ enabled: true, shared: false }));
    addedSkills.push(skill.id);
  }
  const text = preserveLineEndings(String(document), configText);
  const plan = textChangePlan(configText, text);
  return {
    text,
    changed: plan.changed,
    plan,
    addedSkills,
    addedInstallUnits: [],
    replacedSkills: [],
    replacedInstallUnits: []
  };
}

function ensureMap(document, key) {
  const existing = document.get(key, true);
  if (existing === undefined) {
    const next = document.createNode({});
    document.set(key, next);
    return next;
  }
  return requireYamlMap(existing, key);
}

function requireYamlMap(value, label) {
  if (!YAML.isMap(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
}

function preserveLineEndings(text, reference) {
  return reference.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}

function importFragment(imported) {
  const skills = {};
  for (const skill of imported.skills) {
    skills[skill.id] = {
      path: skill.path,
      status: skill.status,
      invocation: skill.invocation,
      exposure: skill.exposure,
      category: skill.category,
      owner_install_unit: skill.ownerInstallUnit
    };
  }
  const unit = imported.installUnit;
  return stripUndefined({
    skills,
    install_units: {
      [unit.id]: {
        kind: unit.kind,
        source_class: unit.sourceClass,
        priority: unit.priority,
        trust_level: unit.trustLevel,
        source_digest: unit.sourceDigest,
        signature: unit.signature,
        public_key: unit.publicKey,
        verified_at: unit.verifiedAt,
        source: unit.source,
        scope: unit.scope,
        manifest_path: unit.manifestPath,
        cache_path: unit.cachePath,
        provided_components: unit.providedComponents,
        components: {
          skills: unit.components.skills,
          commands: unit.components.commands,
          hooks: unit.components.hooks,
          mcp_servers: unit.components.mcpServers
        },
        modified_config_files: unit.modifiedConfigFiles,
        auto_update: unit.autoUpdate,
        enabled: unit.enabled,
        workflow_dependencies: unit.workflowDependencies,
        permission_risk: unit.permissionRisk,
        rollback: unit.rollback
      }
    }
  });
}

function duplicateMessage(skillIds, unitIds) {
  const parts = [];
  if (skillIds.length > 0) {
    parts.push(`skills already exist: ${skillIds.join(", ")}`);
  }
  if (unitIds.length > 0) {
    parts.push(`install units already exist: ${unitIds.join(", ")}`);
  }
  return `${parts.join("; ")}. Re-run with --replace to overwrite.`;
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

function matchesAnyProfilePattern(file, patterns) {
  const activePatterns = patterns.length === 0 ? ["**/SKILL.md"] : patterns;
  return activePatterns.some((pattern) => patternToRegExp(pattern).test(file));
}

function matchingPathRule(file, profile) {
  return (profile.pathRules ?? []).find((rule) => patternToRegExp(rule.pattern).test(file));
}

function patternToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .split("**").join("\0")
    .split("*").join("[^/]*")
    .split("\0").join(".*");
  return new RegExp(`^${escaped}$`);
}

function skillSlug(relativeFile, frontmatter, profile) {
  if (profile.idStrategy === "frontmatter-name" && frontmatter.name.length > 0) {
    const segments = frontmatter.name.split(".");
    return normalizeSlug(segments[segments.length - 1]);
  }
  return normalizeSlug(basename(dirname(relativeFile)));
}

function skillId(slug, frontmatter, profile) {
  if (profile.idStrategy === "frontmatter-name" && frontmatter.name.includes(".")) {
    return frontmatter.name;
  }
  return profile.namespace.length === 0 ? slug : `${profile.namespace}.${slug}`;
}

function skillTargetPath(slug, profile) {
  return profile.targetPathPrefix.length === 0 ? slug : `${profile.targetPathPrefix}/${slug}`;
}

function categoryFromPath(relativeFile, profile) {
  if (profile.categoryPathSegment === undefined) {
    return undefined;
  }
  const segment = relativeFile.split("/")[profile.categoryPathSegment];
  if (segment === undefined || segment.endsWith(".md")) {
    return undefined;
  }
  const category = normalizeSlug(segment);
  return category.length === 0 ? undefined : category;
}

function normalizeSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeDefaultInvocation(invocation) {
  return invocation === "global-auto" ? "blocked" : invocation;
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .map(([key, entryValue]) => [key, stripUndefined(entryValue)]));
  }
  return value;
}
