import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import YAML from "yaml";
import {
  customUserUnit,
  defaultScanRoots,
  displayPath,
  hermesProfileUnit,
  isHermesProfileSkillsPath,
  safeSegment,
  systemCodexUnit,
  userClaudeUnit,
  userCodexUnit,
  userHermesUnit
} from "./agent-inventory-platforms.mjs";
import { readString, requireRecord } from "./config-helpers.mjs";

export const agentInventoryDetectors = Object.freeze([
  {
    id: "codex-plugin-cache",
    matches(path) {
      return path.endsWith("/plugins/cache") || path.endsWith("\\plugins\\cache");
    },
    async discover(path, home) {
      return await discoverPluginCache(path, home);
    }
  },
  {
    id: "codex-system-skills",
    matches(path) {
      return path.endsWith("/skills/.system") || path.endsWith("\\skills\\.system");
    },
    async discover(path, home) {
      return await discoverSkillDirectory(path, systemCodexUnit(path, home), { excludeSystem: false });
    }
  },
  {
    id: "codex-user-skills",
    matches(path) {
      return path.endsWith("/.codex/skills")
        || path.endsWith("\\.codex\\skills")
        || path.endsWith("/.agents/skills")
        || path.endsWith("\\.agents\\skills");
    },
    async discover(path, home) {
      return await discoverSkillDirectory(path, userCodexUnit(path, home), { excludeSystem: true });
    }
  },
  {
    id: "claude-user-skills",
    matches(path) {
      return path.endsWith("/.claude/skills") || path.endsWith("\\.claude\\skills");
    },
    async discover(path, home) {
      return await discoverSkillDirectory(path, userClaudeUnit(path, home), { excludeSystem: true });
    }
  },
  {
    id: "hermes-user-skills",
    matches(path) {
      return path.endsWith("/.hermes/skills") || path.endsWith("\\.hermes\\skills");
    },
    async discover(path, home) {
      return await discoverSkillDirectory(path, userHermesUnit(path, home), { excludeSystem: true });
    }
  },
  {
    id: "hermes-profile-skills",
    matches(path) {
      return isHermesProfileSkillsPath(path);
    },
    async discover(path, home) {
      return await discoverSkillDirectory(path, hermesProfileUnit(path, home), { excludeSystem: true });
    }
  },
  {
    id: "custom-user-skill-root",
    matches() {
      return true;
    },
    async discover(path, home) {
      return await discoverSkillDirectory(path, customUserUnit(path, home), { excludeSystem: true });
    }
  }
]);

export async function discoverAgentSkillInventory(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? env.HOME ?? env.USERPROFILE ?? homedir();
  const detectors = options.detectors ?? agentInventoryDetectors;
  const roots = uniquePaths([
    ...(await defaultScanRoots(home, env)),
    ...readCsv(env.SKILLBOARD_INIT_SCAN_ROOTS),
    ...(options.roots ?? [])
  ], home);
  const groups = [];
  const warnings = [];

  for (const root of roots) {
    const discovered = await discoverRoot(root, home, detectors);
    groups.push(...discovered.groups);
    warnings.push(...discovered.warnings);
  }

  return await inventoryFromGroups(groups, home, warnings);
}

export function mergeAgentSkillInventory(configText, inventory) {
  const document = YAML.parseDocument(configText);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  requireYamlMap(document.contents, "config root");

  const skillsMap = ensureMap(document, "skills");
  const unitsMap = ensureMap(document, "install_units");
  const workflowsMap = ensureMap(document, "workflows");
  const harnessesMap = ensureMap(document, "harnesses");
  const hadWorkflows = workflowsMap.items.length > 0;
  const unitById = new Map(inventory.installUnits.map((unit) => [unit.id, unit]));
  const addedSkills = [];
  const addedInstallUnits = [];
  const updatedInstallUnits = [];
  const addedWorkflows = [];
  const addedHarnesses = [];
  const skippedSkills = [];
  const reviewNotes = [];
  const managedSkillsByUnit = new Map();
  const localWorkflowSkillsByUnit = new Map();
  const aliasSkillsByUnit = new Map();

  for (const skill of inventory.skills) {
    const unit = unitById.get(skill.ownerInstallUnit);
    const defaults = skillDefaultsFor(unit, { attachLocalWorkflow: !hadWorkflows });
    const existing = skillsMap.get(skill.id, true);
    if (existing === undefined) {
      skillsMap.set(skill.id, document.createNode(skillNode(skill, defaults)));
      addedSkills.push(skill.id);
      appendManagedSkill(managedSkillsByUnit, skill.ownerInstallUnit, skill.id);
      appendSourceAliasSkills(aliasSkillsByUnit, skill.sourceAliases ?? [], skill.id);
      if (defaults.attachLocalWorkflow) {
        appendManagedSkill(localWorkflowSkillsByUnit, skill.ownerInstallUnit, skill.id);
        appendLocalWorkflowAliasSkills(localWorkflowSkillsByUnit, skill.sourceAliases ?? [], skill.id);
      } else if (isTrustedLocalUserUnit(unit)) {
        reviewNotes.push(`Local skill ${skill.id} imported as manual-only candidate; use skillboard add workflow to attach it.`);
      }
      continue;
    }
    const owner = readYamlMapString(existing, "owner_install_unit", "");
    if (owner === skill.ownerInstallUnit) {
      appendManagedSkill(managedSkillsByUnit, skill.ownerInstallUnit, skill.id);
      appendSourceAliases(existing, skill.sourceAliases ?? [], document);
      appendSourceAliasSkills(aliasSkillsByUnit, skill.sourceAliases ?? [], skill.id);
      if (defaults.attachLocalWorkflow) {
        appendManagedSkill(localWorkflowSkillsByUnit, skill.ownerInstallUnit, skill.id);
        appendLocalWorkflowAliasSkills(localWorkflowSkillsByUnit, skill.sourceAliases ?? [], skill.id);
      }
    } else {
      const alias = sourceAliasForSkill(skill);
      appendSourceAliases(existing, [alias], document);
      appendManagedSkill(aliasSkillsByUnit, skill.ownerInstallUnit, skill.id);
      if (defaults.attachLocalWorkflow) {
        appendManagedSkill(localWorkflowSkillsByUnit, skill.ownerInstallUnit, skill.id);
      }
    }
  }

  for (const unit of inventory.installUnits) {
    const managedSkills = managedSkillsByUnit.get(unit.id) ?? [];
    const aliasSkills = aliasSkillsByUnit.get(unit.id) ?? [];
    if (managedSkills.length === 0 && aliasSkills.length === 0 && !hasRuntimeComponents(unit)) {
      continue;
    }
    const existing = unitsMap.get(unit.id, true);
    if (existing === undefined) {
      unitsMap.set(unit.id, document.createNode(installUnitNode(unit, managedSkills, aliasSkills)));
      addedInstallUnits.push(unit.id);
      continue;
    }
    const unitMap = requireYamlMap(existing, `install_units.${unit.id}`);
    if (mergeInstallUnitNode(unitMap, unit, managedSkills, aliasSkills, document)) {
      updatedInstallUnits.push(unit.id);
    }
  }

  for (const [unitId, skills] of localWorkflowSkillsByUnit) {
    const unit = unitById.get(unitId);
    const target = localWorkflowTarget(unit);
    const harnessAdded = ensureHarnessWorkflow(harnessesMap, target.harness, target.workflow, document);
    const workflowAdded = ensureLocalWorkflow(workflowsMap, target, skills, document);
    if (harnessAdded) {
      addedHarnesses.push(target.harness);
    }
    if (workflowAdded) {
      addedWorkflows.push(target.workflow);
    }
  }

  if (!hadWorkflows && localWorkflowSkillsByUnit.size === 0 && inventory.installUnits.some((unit) => hasRuntimeComponents(unit))) {
    reviewNotes.push("Workflow metadata not detected for runtime install units; use skillboard add workflow before activating skills.");
  }

  const text = preserveLineEndings(String(document), configText);
  return {
    text,
    changed: text !== configText,
    addedSkills,
    addedInstallUnits,
    updatedInstallUnits,
    addedWorkflows,
    addedHarnesses,
    reviewNotes,
    skippedSkills
  };
}

function skillDefaultsFor(unit, options) {
  if (isTrustedLocalUserUnit(unit)) {
    return options.attachLocalWorkflow
      ? { status: "active", invocation: "manual-only", attachLocalWorkflow: true }
      : { status: "candidate", invocation: "manual-only", attachLocalWorkflow: false };
  }
  return { status: "quarantined", invocation: "blocked", attachLocalWorkflow: false };
}

function isTrustedLocalUserUnit(unit) {
  return unit !== undefined && unit.kind === "skill" && unit.trustLevel === "trusted" && unit.category === "user";
}

function localWorkflowTarget(unit) {
  if (unit?.id === "codex.user-skills") {
    return { harness: "codex", workflow: "codex-local-manual" };
  }
  if (unit?.id === "claude.user-skills") {
    return { harness: "claude", workflow: "claude-local-manual" };
  }
  if (unit?.id === "hermes.user-skills") {
    return { harness: "hermes", workflow: "hermes-local-manual" };
  }
  if (unit?.id.startsWith("hermes.profile.") && unit.id.endsWith(".skills")) {
    const profile = unit.id.slice("hermes.profile.".length, -".skills".length);
    return { harness: "hermes", workflow: `hermes-${profile}-local-manual` };
  }
  const base = safeSegment(unit?.id ?? "local").replace(/\./g, "-");
  return { harness: "local", workflow: `${base}-local-manual` };
}

function ensureHarnessWorkflow(harnessesMap, harnessName, workflowName, document) {
  const existing = harnessesMap.get(harnessName, true);
  if (existing === undefined) {
    harnessesMap.set(harnessName, document.createNode({
      status: "configured",
      workflows: [workflowName]
    }));
    return true;
  }
  const harness = requireYamlMap(existing, `harnesses.${harnessName}`);
  appendNestedSequenceValues(harness, "workflows", [workflowName], document);
  return false;
}

function ensureLocalWorkflow(workflowsMap, target, skills, document) {
  if (workflowsMap.get(target.workflow, true) !== undefined) {
    return false;
  }
  workflowsMap.set(target.workflow, document.createNode({
    harness: target.harness,
    active_skills: skills,
    blocked_skills: []
  }));
  return true;
}

async function discoverRoot(root, home, detectors) {
  const path = resolvePath(root, home);
  if (!(await exists(path))) {
    return { groups: [], warnings: [] };
  }
  const warnings = [];
  const detector = detectors.find((candidate) => {
    try {
      return candidate.matches(path);
    } catch (error) {
      warnings.push(`detector ${candidate.id ?? "unknown"} failed while matching ${displayPath(path, home)}: ${errorMessage(error)}`);
      return false;
    }
  });
  if (detector === undefined) {
    return { groups: [], warnings };
  }
  try {
    const result = normalizeDiscoveryResult(await detector.discover(path, home));
    return { groups: result.groups, warnings: [...warnings, ...result.warnings] };
  } catch (error) {
    warnings.push(`detector ${detector.id ?? "unknown"} failed while scanning ${displayPath(path, home)}: ${errorMessage(error)}`);
    return { groups: [], warnings };
  }
}

async function discoverSkillDirectory(root, unit, options) {
  const files = await findSkillFiles(root, root, options);
  return files.length === 0 ? [] : [{ unit, root, files }];
}

async function discoverPluginCache(root, home) {
  const manifests = await topLevelPluginManifests(root);
  const groups = [];
  const warnings = [];
  const codexHome = dirname(dirname(root));
  for (const manifestPath of manifests) {
    try {
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
    } catch (error) {
      warnings.push(`plugin manifest ${displayPath(manifestPath, home)} skipped: ${errorMessage(error)}`);
    }
  }
  return { groups, warnings };
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
      return candidateRoot !== pluginRoot && isPathInside(pluginRoot, candidateRoot);
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

async function inventoryFromGroups(groups, home, initialWarnings = []) {
  const skills = [];
  const installUnits = [];
  const skillById = new Map();
  const warnings = [...initialWarnings];
  let scannedSkills = 0;

  for (const group of groups.sort(compareInventoryGroups)) {
    const unitSkills = [];
    const aliasSkills = [];
    for (const file of group.files.sort((left, right) => left.localeCompare(right))) {
      let frontmatter;
      try {
        frontmatter = parseSkillFrontmatter(await readFile(file, "utf8"));
      } catch (error) {
        warnings.push(`skill file ${displayPath(file, home)} skipped: ${errorMessage(error)}`);
        continue;
      }
      scannedSkills += 1;
      const id = skillIdFor(group.unit, group.root, file, frontmatter);
      const sourceAlias = {
        ownerInstallUnit: group.unit.id,
        path: skillPath(group.root, file)
      };
      const existing = skillById.get(id);
      if (existing !== undefined) {
        existing.sourceAliases.push(sourceAlias);
        aliasSkills.push(id);
        continue;
      }
      unitSkills.push(id);
      const skill = {
        id,
        path: sourceAlias.path,
        status: "quarantined",
        invocation: "blocked",
        exposure: "exported",
        category: group.unit.category,
        ownerInstallUnit: group.unit.id,
        description: frontmatter.description,
        sourceAliases: []
      };
      skillById.set(id, skill);
      skills.push(skill);
    }
    if (unitSkills.length > 0) {
      group.unit.providedComponents = providedComponentList({ ...group.unit, skills: unitSkills });
    }
    if (unitSkills.length > 0 || aliasSkills.length > 0 || hasRuntimeComponents(group.unit)) {
      installUnits.push(installUnitWithSkills(group.unit, unitSkills, aliasSkills, group.root, home));
    }
  }

  return { skills, installUnits, scannedSkills, warnings };
}

function compareInventoryGroups(left, right) {
  const rank = inventoryUnitRank(left.unit) - inventoryUnitRank(right.unit);
  return rank === 0 ? left.unit.id.localeCompare(right.unit.id) : rank;
}

function inventoryUnitRank(unit) {
  if (isTrustedLocalUserUnit(unit)) {
    return 0;
  }
  if (unit.kind === "skill") {
    return 1;
  }
  return 2;
}

function normalizeDiscoveryResult(result) {
  if (Array.isArray(result)) {
    return { groups: result, warnings: [] };
  }
  if (result !== null && typeof result === "object") {
    return {
      groups: Array.isArray(result.groups) ? result.groups : [],
      warnings: Array.isArray(result.warnings) ? result.warnings.filter((warning) => typeof warning === "string") : []
    };
  }
  return { groups: [], warnings: [] };
}

function installUnitWithSkills(unit, skills, aliasSkills, root, home) {
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
    skills,
    sourceAliasSkills: aliasSkills
  };
}

async function findSkillFiles(root, base, options, seen = new Set()) {
  const files = [];
  const resolvedRoot = await realpath(root).catch(() => root);
  if (seen.has(resolvedRoot)) {
    return files;
  }
  seen.add(resolvedRoot);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    const rel = relative(base, path).replace(/\\/g, "/");
    if (options.excludeSystem === true && (rel === ".system" || rel.startsWith(".system/"))) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await findSkillFiles(path, base, options, seen)));
    } else if (entry.isSymbolicLink()) {
      const target = await stat(path).catch(() => undefined);
      if (target?.isDirectory()) {
        files.push(...(await findSkillFiles(path, base, options, seen)));
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
  return relative(root, dirname(file)).replace(/\\/g, "/");
}

function skillNode(skill, defaults = {}) {
  return stripUndefined({
    path: skill.path,
    status: defaults.status ?? skill.status,
    invocation: defaults.invocation ?? skill.invocation,
    exposure: skill.exposure,
    category: skill.category,
    owner_install_unit: skill.ownerInstallUnit,
    source_aliases: sourceAliasesNode(skill.sourceAliases ?? [])
  });
}

function installUnitNode(unit, skills, aliasSkills = []) {
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
      source_aliases: aliasSkills,
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

function mergeInstallUnitNode(unitMap, unit, skills, aliasSkills, document) {
  let changed = false;
  const components = ensureNestedMap(unitMap, "components", document);
  changed = appendNestedSequenceValues(components, "skills", skills, document) || changed;
  changed = appendNestedSequenceValues(components, "source_aliases", aliasSkills, document) || changed;
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

function appendSourceAliasSkills(map, sourceAliases, skillId) {
  for (const alias of sourceAliases) {
    appendManagedSkill(map, alias.ownerInstallUnit, skillId);
  }
}

function appendLocalWorkflowAliasSkills(map, sourceAliases, skillId) {
  for (const alias of sourceAliases) {
    appendManagedSkill(map, alias.ownerInstallUnit, skillId);
  }
}

function sourceAliasForSkill(skill) {
  return {
    ownerInstallUnit: skill.ownerInstallUnit,
    path: skill.path
  };
}

function sourceAliasesNode(sourceAliases) {
  const aliases = sourceAliases
    .filter((alias) => alias.ownerInstallUnit !== undefined && alias.path !== undefined)
    .map((alias) => ({
      owner_install_unit: alias.ownerInstallUnit,
      path: alias.path
    }));
  return aliases.length === 0 ? undefined : aliases;
}

function appendSourceAliases(skillNodeValue, sourceAliases, document) {
  const skillMap = requireYamlMap(skillNodeValue, "skills.<id>");
  const validAliases = sourceAliases.filter((alias) => alias.ownerInstallUnit !== undefined && alias.path !== undefined);
  if (validAliases.length === 0) {
    return false;
  }
  const seq = ensureNestedSeq(skillMap, "source_aliases", document);
  const before = seq.items.length;
  for (const alias of validAliases) {
    if (sourceAliasExists(seq, alias)) {
      continue;
    }
    seq.add(document.createNode({
      owner_install_unit: alias.ownerInstallUnit,
      path: alias.path
    }));
  }
  return seq.items.length !== before;
}

function sourceAliasExists(seq, alias) {
  return seq.items.some((item) => {
    if (!YAML.isMap(item)) {
      return false;
    }
    return item.get("owner_install_unit") === alias.ownerInstallUnit && item.get("path") === alias.path;
  });
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
  const map = requireYamlMap(existing, key);
  map.flow = false;
  return map;
}

function ensureNestedMap(parent, key, document) {
  const existing = parent.get(key, true);
  if (existing === undefined) {
    const next = document.createNode({});
    next.flow = false;
    parent.set(key, next);
    return next;
  }
  const map = requireYamlMap(existing, key);
  map.flow = false;
  return map;
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
  existing.flow = false;
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

function isPathInside(child, parent) {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}
