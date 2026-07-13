import { basename, isAbsolute, relative, resolve } from "node:path";
import YAML from "yaml";
import { coalesceInventoryInstallUnits } from "./inventory-install-units.mjs";
import { normalizeSkillPath } from "./skill-paths.mjs";
import { skillContentDigest } from "./source-verification.mjs";

const FORMAT_VERSION = 1;

export async function buildGeneratedInventory(inventory, options = {}) {
  const redactions = redactionContext(options);
  const integrityErrors = [];
  const skills = [];
  for (const skill of [...(inventory.skills ?? [])].sort(byId)) {
    try {
      skills.push(await inventorySkillRecord(skill, redactions));
    } catch (error) {
      integrityErrors.push(`${skill?.id || "<missing-id>"}: ${errorMessage(error)}`);
    }
  }
  if (integrityErrors.length > 0) {
    throw new Error(`Inventory integrity error:\n${integrityErrors.join("\n")}`);
  }
  const installUnits = coalesceInventoryInstallUnits([...(inventory.installUnits ?? [])]
    .sort(byId)
    .map((unit) => inventoryInstallUnitRecord(unit, redactions)));
  return {
    format_version: FORMAT_VERSION,
    generated: true,
    authoritative_for_availability: false,
    skills,
    install_units: installUnits,
    redactions: {
      path_count: redactions.pathCount,
      warnings: [...redactions.warnings].sort()
    }
  };
}

export function renderGeneratedInventory(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function mergeGeneratedInventory(existingText, added, options = {}) {
  const existing = parseExistingInventory(existingText);
  const replace = options.replace === true;
  const skills = mergeRecords(existing.skills, added.skills ?? [], replace);
  const installUnits = mergeRecords(existing.install_units ?? [], added.install_units ?? [], replace);
  const warnings = uniqueStrings([
    ...(existing.redactions?.warnings ?? []),
    ...(added.redactions?.warnings ?? [])
  ]);
  return renderGeneratedInventory({
    ...existing,
    format_version: FORMAT_VERSION,
    generated: true,
    authoritative_for_availability: false,
    skills,
    install_units: installUnits,
    redactions: {
      path_count: countPortablePaths(skills, installUnits),
      warnings
    }
  });
}

export function mergeV2InventoryPolicy(configText, inventory) {
  const document = YAML.parseDocument(configText);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  if (document.get("version") !== 2) {
    throw new Error("v2 inventory policy projection requires config version 2");
  }
  let skills = document.get("skills", true);
  if (skills === undefined) {
    skills = document.createNode({});
    document.set("skills", skills);
  }
  if (!YAML.isMap(skills)) {
    throw new Error("skills must be a mapping");
  }
  const addedSkills = [];
  for (const skill of [...(inventory.skills ?? [])].sort(byId)) {
    validateSkillIdentity(skill);
    if (skills.get(skill.id, true) !== undefined) {
      continue;
    }
    skills.set(skill.id, document.createNode({ enabled: true, shared: false }));
    addedSkills.push(skill.id);
  }
  const parsed = document.toJS();
  const policyProjection = Object.fromEntries(
    Object.entries(parsed.skills ?? {}).map(([id, policy]) => [id, policy])
  );
  const text = preserveLineEndings(String(document), configText);
  return { text, changed: text !== configText, addedSkills, policyProjection };
}

async function inventorySkillRecord(skill, redactions) {
  validateSkillIdentity(skill);
  const aliases = uniqueAliases(skill.sourceAliases ?? []);
  let contentDigest = null;
  if (typeof skill.skillFile === "string" && skill.skillFile.length > 0) {
    if (!isAbsolute(skill.skillFile)) {
      throw new Error("skill file must be absolute");
    }
    contentDigest = await skillContentDigest(skill.skillFile);
  }
  return compact({
    id: skill.id,
    path: normalizeSkillPath(skill.path, `inventory skill ${skill.id} path`),
    owner_install_unit: nonEmptyString(skill.ownerInstallUnit, `inventory skill ${skill.id} owner install unit`),
    source: portableSource(skill.source, redactions),
    category: skill.category,
    description: skill.description,
    content_digest: contentDigest,
    installed_on: installedAgents(skill),
    aliases
  });
}

function installedAgents(skill) {
  return uniqueStrings([
    agentForInstallUnit(skill.ownerInstallUnit),
    ...(skill.sourceAliases ?? []).map((alias) => agentForInstallUnit(alias.ownerInstallUnit))
  ]);
}

function agentForInstallUnit(unitId) {
  if (typeof unitId !== "string") return "";
  for (const agent of ["codex", "claude", "opencode", "hermes"]) {
    if (unitId === agent || unitId.startsWith(`${agent}.`)) return agent;
  }
  return "";
}

function inventoryInstallUnitRecord(unit, redactions) {
  return compact({
    id: nonEmptyString(unit.id, "inventory install unit id"),
    kind: unit.kind,
    source: portableSource(unit.source, redactions),
    source_class: unit.sourceClass,
    manifest_path: portablePath(unit.manifestPath, redactions),
    cache_path: portablePath(unit.cachePath, redactions),
    trust_observation: unit.trustLevel,
    permission_risk: unit.permissionRisk,
    source_digest: unit.sourceDigest,
    signature_observed: typeof unit.signature === "string" && unit.signature.length > 0,
    runtime_components: {
      commands: uniqueStrings(unit.commands ?? unit.components?.commands ?? []),
      hooks: uniqueStrings(unit.hooks ?? unit.components?.hooks ?? []),
      mcp_servers: uniqueStrings(unit.mcpServers ?? unit.components?.mcpServers ?? [])
    },
    skills: uniqueStrings(unit.skills ?? unit.components?.skills ?? []),
    alias_skills: uniqueStrings(unit.sourceAliasSkills ?? [])
  });
}

function validateSkillIdentity(skill) {
  if (skill === null || typeof skill !== "object") {
    throw new Error("inventory skill must be an object");
  }
  nonEmptyString(skill.id, "inventory skill id");
  normalizeSkillPath(skill.path, `inventory skill ${skill.id} path`);
  nonEmptyString(skill.ownerInstallUnit, `inventory skill ${skill.id} owner install unit`);
}

function uniqueAliases(aliases) {
  const seen = new Set();
  const result = [];
  for (const alias of aliases) {
    const owner = nonEmptyString(alias.ownerInstallUnit, "inventory alias owner install unit");
    const path = normalizeSkillPath(alias.path, "inventory alias path");
    const key = `${owner}\0${path}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ owner_install_unit: owner, path });
    }
  }
  return result.sort((left, right) => `${left.owner_install_unit}\0${left.path}`.localeCompare(`${right.owner_install_unit}\0${right.path}`));
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function mergeRecords(existing, added, replace) {
  const records = new Map(existing.map((record) => [record.id, record]));
  for (const record of added) {
    if (replace || !records.has(record.id)) records.set(record.id, record);
  }
  return [...records.values()].sort(byId);
}

function parseExistingInventory(text) {
  if (text === null || text === undefined || text.trim() === "") {
    return { skills: [], install_units: [] };
  }
  const value = JSON.parse(text);
  if (value?.format_version !== FORMAT_VERSION || value.generated !== true || value.authoritative_for_availability !== false) {
    throw new Error("Existing generated inventory has an unsupported format");
  }
  if (!Array.isArray(value.skills) || (value.install_units !== undefined && !Array.isArray(value.install_units))) {
    throw new Error("Existing generated inventory records must be arrays");
  }
  return value;
}

function countPortablePaths(skills, installUnits) {
  return [
    ...skills.map((skill) => skill.source),
    ...installUnits.flatMap((unit) => [
      ...(unit.source_observations ?? [unit.source]),
      ...(unit.manifest_path_observations ?? [unit.manifest_path]),
      ...(unit.cache_path_observations ?? [unit.cache_path])
    ])
  ].filter((value) => typeof value === "string" && /^(?:\$\{PROJECT\}|\$\{HOME\}|<external>)(?:\/|$)/u.test(value)).length;
}

function redactionContext(options) {
  return {
    root: options.root === undefined ? undefined : resolve(options.root),
    home: options.home === undefined ? undefined : resolve(options.home),
    pathCount: 0,
    warnings: new Set()
  };
}

function portableSource(value, context) {
  return typeof value === "string" && (isAbsolute(value) || value.startsWith("~/"))
    ? portablePath(value, context)
    : value;
}

function portablePath(value, context) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (value.startsWith("~/")) {
    context.pathCount += 1;
    return `\${HOME}/${value.slice(2)}`;
  }
  if (!isAbsolute(value)) return value;
  context.pathCount += 1;
  const projectPath = tokenizedPath(value, context.root, "PROJECT");
  if (projectPath !== null) return projectPath;
  const homePath = tokenizedPath(value, context.home, "HOME");
  if (homePath !== null) return homePath;
  context.warnings.add("Generated inventory redacted one or more external absolute paths.");
  return `<external>/${basename(value)}`;
}

function tokenizedPath(path, base, token) {
  if (base === undefined) return null;
  const rel = relative(base, resolve(path));
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel === "" ? `\${${token}}` : `\${${token}}/${rel.replace(/\\/g, "/")}`;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function byId(left, right) {
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

function preserveLineEndings(text, original) {
  return original.includes("\r\n") ? text.replace(/(?<!\r)\n/g, "\r\n") : text;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
