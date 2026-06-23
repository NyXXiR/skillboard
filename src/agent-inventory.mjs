import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import YAML from "yaml";
import { readString, requireRecord } from "./config-helpers.mjs";

export async function discoverAgentSkillInventory(options = {}) {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const roots = uniquePaths([
    ...defaultScanRoots(home, env),
    ...readCsv(env.SKILLBOARD_INIT_SCAN_ROOTS),
    ...(options.roots ?? [])
  ], home);
  const groups = [];

  for (const root of roots) {
    groups.push(...(await discoverRoot(root, home)));
  }

  return await inventoryFromGroups(groups, home);
}

export function mergeAgentSkillInventory(configText, inventory) {
  const document = YAML.parseDocument(configText);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  requireYamlMap(document.contents, "config root");

  const skillsMap = ensureMap(document, "skills");
  const unitsMap = ensureMap(document, "install_units");
  const addedSkills = [];
  const addedInstallUnits = [];
  const updatedInstallUnits = [];
  const skippedSkills = [];
  const managedSkillsByUnit = new Map();

  for (const skill of inventory.skills) {
    const existing = skillsMap.get(skill.id, true);
    if (existing === undefined) {
      skillsMap.set(skill.id, document.createNode(skillNode(skill)));
      addedSkills.push(skill.id);
      appendManagedSkill(managedSkillsByUnit, skill.ownerInstallUnit, skill.id);
      continue;
    }
    const owner = readYamlMapString(existing, "owner_install_unit", "");
    if (owner === skill.ownerInstallUnit) {
      appendManagedSkill(managedSkillsByUnit, skill.ownerInstallUnit, skill.id);
    } else {
      skippedSkills.push(skill.id);
    }
  }

  for (const unit of inventory.installUnits) {
    const managedSkills = managedSkillsByUnit.get(unit.id) ?? [];
    if (managedSkills.length === 0 && !hasRuntimeComponents(unit)) {
      continue;
    }
    const existing = unitsMap.get(unit.id, true);
    if (existing === undefined) {
      unitsMap.set(unit.id, document.createNode(installUnitNode(unit, managedSkills)));
      addedInstallUnits.push(unit.id);
      continue;
    }
    const unitMap = requireYamlMap(existing, `install_units.${unit.id}`);
    if (mergeInstallUnitNode(unitMap, unit, managedSkills, document)) {
      updatedInstallUnits.push(unit.id);
    }
  }

  const text = preserveLineEndings(String(document), configText);
  return {
    text,
    changed: text !== configText,
    addedSkills,
    addedInstallUnits,
    updatedInstallUnits,
    skippedSkills
  };
}

function defaultScanRoots(home, env) {
  const codexHome = env.CODEX_HOME ?? join(home, ".codex");
  return [
    join(codexHome, "skills", ".system"),
    join(codexHome, "skills"),
    join(codexHome, "plugins", "cache"),
    join(home, ".claude", "skills")
  ];
}

async function discoverRoot(root, home) {
  const path = resolvePath(root, home);
  if (!(await exists(path))) {
    return [];
  }
  if (path.endsWith("/plugins/cache") || path.endsWith("\\plugins\\cache")) {
    return await discoverPluginCache(path, home);
  }
  if (path.endsWith("/skills/.system") || path.endsWith("\\skills\\.system")) {
    return await discoverSkillDirectory(path, systemCodexUnit(path, home), { excludeSystem: false });
  }
  if (path.endsWith("/.codex/skills") || path.endsWith("\\.codex\\skills")) {
    return await discoverSkillDirectory(path, userCodexUnit(path, home), { excludeSystem: true });
  }
  if (path.endsWith("/.claude/skills") || path.endsWith("\\.claude\\skills")) {
    return await discoverSkillDirectory(path, userClaudeUnit(path, home), { excludeSystem: true });
  }
  return await discoverSkillDirectory(path, customUserUnit(path, home), { excludeSystem: true });
}

async function discoverSkillDirectory(root, unit, options) {
  const files = await findSkillFiles(root, root, options);
  return files.length === 0 ? [] : [{ unit, root, files }];
}

async function discoverPluginCache(root, home) {
  const manifests = await topLevelPluginManifests(root);
  const groups = [];
  const codexHome = dirname(dirname(root));
  for (const manifestPath of manifests) {
    const pluginRoot = dirname(dirname(manifestPath));
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const skillsRoot = resolve(pluginRoot, typeof manifest.skills === "string" ? manifest.skills : "skills");
    const files = await findSkillFiles(skillsRoot, skillsRoot, { excludeSystem: false });
    const unit = await pluginUnit(manifest, pluginRoot, manifestPath, { home, codexHome });
    if (files.length === 0 && !hasRuntimeComponents(unit)) {
      continue;
    }
    groups.push({
      unit,
      root: pluginRoot,
      files
    });
  }
  return groups;
}

async function pluginUnit(manifest, pluginRoot, manifestPath, paths) {
  const name = safeSegment(typeof manifest.name === "string" ? manifest.name : basename(pluginRoot));
  const hooks = manifestStringList(manifest.hooks).map(hookId);
  const commands = manifestStringList(manifest.commands);
  const mcpServers = await manifestMcpServers(manifest.mcpServers, pluginRoot);
  const modifiedConfigFiles = await pluginModifiedConfigFiles(manifest, paths);
  const providedComponents = providedComponentList({ skills: [], commands, hooks, mcpServers });
  return {
    id: `codex.plugin.${name}`,
    kind: "plugin",
    sourceClass: undefined,
    priority: undefined,
    trustLevel: "unreviewed",
    source: displayPath(pluginRoot, paths.home),
    scope: "user-global",
    manifestPath: displayPath(manifestPath, paths.home),
    cachePath: displayPath(pluginRoot, paths.home),
    category: "plugin",
    providedComponents,
    commands,
    hooks,
    mcpServers,
    modifiedConfigFiles,
    permissionRisk: permissionRiskFor({ commands, hooks, mcpServers })
  };
}

async function topLevelPluginManifests(root) {
  const manifests = await findPluginManifests(root);
  return manifests.filter((manifest) => {
    const pluginRoot = dirname(dirname(manifest));
    return !manifests.some((candidate) => {
      const candidateRoot = dirname(dirname(candidate));
      return candidateRoot !== pluginRoot && pluginRoot.startsWith(`${candidateRoot}/`);
    });
  }).sort((left, right) => left.localeCompare(right));
}

async function findPluginManifests(root) {
  const manifests = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...(await findPluginManifests(path)));
    } else if (entry.isFile() && entry.name === "plugin.json" && basename(dirname(path)) === ".codex-plugin") {
      manifests.push(path);
    }
  }
  return manifests;
}

async function inventoryFromGroups(groups, home) {
  const skills = [];
  const installUnits = [];
  const usedSkillIds = new Set();

  for (const group of groups.sort((left, right) => left.unit.id.localeCompare(right.unit.id))) {
    const unitSkills = [];
    for (const file of group.files.sort((left, right) => left.localeCompare(right))) {
      const frontmatter = parseSkillFrontmatter(await readFile(file, "utf8"));
      const baseId = skillIdFor(group.unit, group.root, file, frontmatter);
      const id = uniqueId(baseId, usedSkillIds);
      usedSkillIds.add(id);
      unitSkills.push(id);
      skills.push({
        id,
        path: skillPath(group.root, file),
        status: "quarantined",
        invocation: "blocked",
        exposure: "exported",
        category: group.unit.category,
        ownerInstallUnit: group.unit.id,
        description: frontmatter.description
      });
    }
    if (unitSkills.length > 0) {
      group.unit.providedComponents = providedComponentList({ ...group.unit, skills: unitSkills });
    }
    if (unitSkills.length > 0 || hasRuntimeComponents(group.unit)) {
      installUnits.push(installUnitWithSkills(group.unit, unitSkills, group.root, home));
    }
  }

  return { skills, installUnits };
}

function installUnitWithSkills(unit, skills, root, home) {
  const commands = unit.commands ?? [];
  const hooks = unit.hooks ?? [];
  const mcpServers = unit.mcpServers ?? [];
  return {
    ...unit,
    source: unit.source || displayPath(root, home),
    cachePath: unit.cachePath ?? displayPath(root, home),
    providedComponents: providedComponentList({ skills, commands, hooks, mcpServers }),
    commands,
    hooks,
    mcpServers,
    modifiedConfigFiles: unit.modifiedConfigFiles ?? [],
    permissionRisk: unit.permissionRisk ?? permissionRiskFor({ commands, hooks, mcpServers }),
    skills
  };
}

function systemCodexUnit(path, home) {
  return {
    id: "codex.system-skills",
    kind: "agent",
    sourceClass: "runtime-extension",
    priority: 55,
    trustLevel: "reviewed",
    source: displayPath(path, home),
    scope: "user-global",
    manifestPath: "",
    cachePath: displayPath(path, home),
    category: "agent-runtime"
  };
}

function userCodexUnit(path, home) {
  return {
    id: "codex.user-skills",
    kind: "skill",
    sourceClass: undefined,
    priority: 100,
    trustLevel: "trusted",
    source: displayPath(path, home),
    scope: "user-global",
    manifestPath: "",
    cachePath: displayPath(path, home),
    category: "user"
  };
}

function userClaudeUnit(path, home) {
  return {
    id: "claude.user-skills",
    kind: "skill",
    sourceClass: undefined,
    priority: 100,
    trustLevel: "trusted",
    source: displayPath(path, home),
    scope: "user-global",
    manifestPath: "",
    cachePath: displayPath(path, home),
    category: "user"
  };
}

function customUserUnit(path, home) {
  return {
    id: `custom.${safeSegment(basename(path))}.skills`,
    kind: "skill",
    sourceClass: undefined,
    priority: 100,
    trustLevel: "trusted",
    source: displayPath(path, home),
    scope: "local",
    manifestPath: "",
    cachePath: displayPath(path, home),
    category: "user"
  };
}

async function findSkillFiles(root, base, options) {
  const files = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    const rel = relative(base, path).replaceAll("\\", "/");
    if (options.excludeSystem === true && (rel === ".system" || rel.startsWith(".system/"))) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await findSkillFiles(path, base, options)));
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

function skillIdFor(unit, root, file, frontmatter) {
  const rel = skillPath(root, file);
  const fallback = rel.split("/").map(safeSegment).join(".");
  const name = validId(frontmatter.name) ? frontmatter.name : fallback;
  if (unit.id.startsWith("codex.plugin.")) {
    const pluginName = unit.id.slice("codex.plugin.".length);
    return name.includes(":") ? name : `${pluginName}:${name}`;
  }
  return name;
}

function skillPath(root, file) {
  return relative(root, dirname(file)).replaceAll("\\", "/");
}

function skillNode(skill) {
  return {
    path: skill.path,
    status: skill.status,
    invocation: skill.invocation,
    exposure: skill.exposure,
    category: skill.category,
    owner_install_unit: skill.ownerInstallUnit
  };
}

function installUnitNode(unit, skills) {
  return stripUndefined({
    kind: unit.kind,
    source_class: unit.sourceClass,
    priority: unit.priority,
    trust_level: unit.trustLevel,
    source: unit.source,
    scope: unit.scope,
    manifest_path: unit.manifestPath,
    cache_path: unit.cachePath,
    provided_components: unit.providedComponents,
    components: {
      skills,
      commands: unit.commands,
      hooks: unit.hooks,
      mcp_servers: unit.mcpServers
    },
    modified_config_files: unit.modifiedConfigFiles,
    auto_update: false,
    enabled: true,
    permission_risk: unit.permissionRisk,
    rollback: "manual"
  });
}

function mergeInstallUnitNode(unitMap, unit, skills, document) {
  let changed = false;
  const components = ensureNestedMap(unitMap, "components", document);
  changed = appendNestedSequenceValues(components, "skills", skills, document) || changed;
  changed = appendNestedSequenceValues(components, "commands", unit.commands ?? [], document) || changed;
  changed = appendNestedSequenceValues(components, "hooks", unit.hooks ?? [], document) || changed;
  changed = appendNestedSequenceValues(components, "mcp_servers", unit.mcpServers ?? [], document) || changed;
  changed = appendNestedSequenceValues(unitMap, "provided_components", unit.providedComponents ?? [], document) || changed;
  changed = appendNestedSequenceValues(unitMap, "modified_config_files", unit.modifiedConfigFiles ?? [], document) || changed;
  changed = setMapStringIfMissing(unitMap, "manifest_path", unit.manifestPath) || changed;
  changed = setMapStringIfMissing(unitMap, "cache_path", unit.cachePath) || changed;
  changed = setMapStringIfMissing(unitMap, "source", unit.source) || changed;
  changed = setMapStringIfMissing(unitMap, "permission_risk", unit.permissionRisk) || changed;
  return changed;
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.length === 0 ? undefined : value.map(stripUndefined);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, stripUndefined(entry)])
        .filter(([, entry]) => entry !== undefined && entry !== "")
    );
  }
  return value;
}

function appendManagedSkill(map, unitId, skillId) {
  const values = map.get(unitId) ?? [];
  values.push(skillId);
  map.set(unitId, values);
}

async function manifestMcpServers(value, pluginRoot) {
  if (typeof value === "string") {
    const path = resolve(pluginRoot, value);
    if (!(await exists(path))) {
      return [];
    }
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return objectKeys(parsed.mcpServers);
  }
  return manifestStringList(value);
}

async function pluginModifiedConfigFiles(manifest, paths) {
  const configured = [
    ...manifestStringList(manifest.modified_config_files),
    ...manifestStringList(manifest.modifiedConfigFiles)
  ];
  const codexConfig = join(paths.codexHome, "config.toml");
  if (await exists(codexConfig)) {
    configured.push(displayPath(codexConfig, paths.home));
  }
  return uniqueStrings(configured);
}

function manifestStringList(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.filter((entry) => typeof entry === "string"));
  }
  if (typeof value === "string") {
    return value.trim().length === 0 ? [] : [value];
  }
  if (value !== null && typeof value === "object") {
    return objectKeys(value);
  }
  return [];
}

function objectKeys(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(Object.keys(value));
}

function hookId(value) {
  return basename(value).replace(/\.json$/u, "");
}

function providedComponentList(unit) {
  const components = [];
  if ((unit.skills ?? []).length > 0) {
    components.push("skills");
  }
  if ((unit.commands ?? []).length > 0) {
    components.push("commands");
  }
  if ((unit.hooks ?? []).length > 0) {
    components.push("hook");
  }
  if ((unit.mcpServers ?? []).length > 0) {
    components.push("mcp-server");
  }
  return components;
}

function permissionRiskFor(unit) {
  if ((unit.hooks ?? []).length > 0 || (unit.mcpServers ?? []).length > 0) {
    return "high";
  }
  if ((unit.commands ?? []).length > 0) {
    return "medium";
  }
  return "low";
}

function hasRuntimeComponents(unit) {
  return (unit.commands ?? []).length > 0 || (unit.hooks ?? []).length > 0 || (unit.mcpServers ?? []).length > 0;
}

function ensureMap(document, key) {
  const existing = document.get(key, true);
  if (existing === undefined) {
    const next = document.createNode({});
    next.flow = false;
    document.set(key, next);
    return next;
  }
  return requireYamlMap(existing, key);
}

function ensureNestedMap(parent, key, document) {
  const existing = parent.get(key, true);
  if (existing === undefined) {
    const next = document.createNode({});
    next.flow = false;
    parent.set(key, next);
    return next;
  }
  return requireYamlMap(existing, key);
}

function ensureNestedSeq(parent, key, document) {
  const existing = parent.get(key, true);
  if (existing === undefined) {
    const next = document.createNode([]);
    next.flow = false;
    parent.set(key, next);
    return next;
  }
  if (!YAML.isSeq(existing)) {
    throw new Error(`${key} must be a sequence`);
  }
  return existing;
}

function addUniqueScalar(seq, value, document) {
  if (seq.items.some((item) => item?.value === value)) {
    return;
  }
  seq.add(document.createNode(value));
}

function appendNestedSequenceValues(parent, key, values, document) {
  if (values.length === 0) {
    return false;
  }
  const seq = ensureNestedSeq(parent, key, document);
  const before = seq.items.length;
  for (const value of values) {
    addUniqueScalar(seq, value, document);
  }
  return seq.items.length !== before;
}

function setMapStringIfMissing(map, key, value) {
  if (value === undefined || value === "") {
    return false;
  }
  const current = map.get(key);
  if (current !== undefined && current !== "") {
    return false;
  }
  map.set(key, value);
  return true;
}

function requireYamlMap(value, label) {
  if (!YAML.isMap(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  value.flow = false;
  return value;
}

function readYamlMapString(value, key, fallback) {
  if (!YAML.isMap(value)) {
    return fallback;
  }
  const raw = value.get(key);
  return typeof raw === "string" ? raw : fallback;
}

function preserveLineEndings(text, reference) {
  return reference.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}

function uniqueId(base, used) {
  if (!used.has(base)) {
    return base;
  }
  let counter = 2;
  while (used.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

function safeSegment(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.length === 0 ? "skill" : normalized;
}

function validId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

function resolvePath(path, home) {
  if (path === "~") {
    return home;
  }
  if (path.startsWith("~/")) {
    return join(home, path.slice(2));
  }
  return resolve(path);
}

function displayPath(path, home) {
  const resolvedHome = resolve(home);
  const resolvedPath = resolve(path);
  if (resolvedPath === resolvedHome) {
    return "~";
  }
  if (resolvedPath.startsWith(`${resolvedHome}/`)) {
    return `~/${relative(resolvedHome, resolvedPath).replaceAll("\\", "/")}`;
  }
  return resolvedPath;
}

function readCsv(value) {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function uniquePaths(values, home) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const key = resolve(trimmed.startsWith("~/") ? join(home, trimmed.slice(2)) : trimmed);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}
