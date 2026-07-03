import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import YAML from "yaml";
import { textChangePlan } from "./change-plan.mjs";

export async function detectInstallOutput(options = {}) {
  const root = resolve(options.root ?? ".");
  const configPath = resolveUnderRoot(root, options.configPath ?? "skillboard.config.yaml");
  const unitId = requireOption(options.unitId, "unit");
  const dryRun = options.dryRun === true;
  const originalText = await readFile(configPath, "utf8");
  const document = YAML.parseDocument(originalText);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  const installOutput = options.installOutputPath === undefined ? "" : await readFile(options.installOutputPath, "utf8");
  const configFiles = options.configFiles ?? [];
  const configTexts = await Promise.all(configFiles.map(async (path) => {
    return { path, text: await readFile(path, "utf8").catch(() => "") };
  }));
  const detected = detectRuntimeMetadata(installOutput, configTexts, root);
  const unit = ensureInstallUnit(document, unitId, {
    kind: options.kind ?? "plugin",
    source: options.source ?? "",
    scope: options.scope ?? "user-global"
  });
  const changedFields = mergeDetectedMetadata(unit, detected, document);
  const nextText = preserveLineEndings(String(document), originalText);
  const plan = textChangePlan(originalText, nextText);
  if (plan.changed && !dryRun) {
    await writeFile(configPath, nextText, "utf8");
  }
  return {
    dryRun,
    configPath,
    unitId,
    changed: plan.changed,
    plan,
    detected,
    changedFields
  };
}

export function detectRuntimeMetadata(installOutput, configTexts = [], root = process.cwd()) {
  const commands = new Set();
  const hooks = new Set();
  const mcpServers = new Set();
  const modifiedConfigFiles = new Set();

  collectFromText(installOutput, { commands, hooks, mcpServers, modifiedConfigFiles }, root);
  for (const entry of configTexts) {
    if (entry.path !== undefined) {
      modifiedConfigFiles.add(displayPath(entry.path, root));
    }
    collectFromConfigText(entry.text, { commands, hooks, mcpServers });
  }

  return {
    commands: [...commands].sort((left, right) => left.localeCompare(right)),
    hooks: [...hooks].sort((left, right) => left.localeCompare(right)),
    mcpServers: [...mcpServers].sort((left, right) => left.localeCompare(right)),
    modifiedConfigFiles: [...modifiedConfigFiles].sort((left, right) => left.localeCompare(right))
  };
}

function collectFromText(text, output, root) {
  for (const match of text.matchAll(/\$[A-Za-z][A-Za-z0-9_:-]*/gu)) {
    output.commands.add(match[0]);
  }
  collectLabeledValues(text, /\bcommands?\b\s*[:=]\s*(?<values>[^\n]+)/giu, output.commands, normalizeCommand);
  collectLabeledValues(text, /\bhooks?\b\s*[:=]\s*(?<values>[^\n]+)/giu, output.hooks, normalizeHook);
  collectLabeledValues(text, /\bmcp[-_ ]?servers?\b\s*[:=]\s*(?<values>[^\n]+)/giu, output.mcpServers, normalizeIdentifier);
  collectLabeledValues(text, /\b(?:updated|modified|patched|wrote|writing)\s+(?<values>[^\n]+(?:config|settings)[^\n]*)/giu, output.modifiedConfigFiles, (value) => normalizePath(value, root));
}

function collectFromConfigText(text, output) {
  const parsed = parseJsonObject(text);
  if (parsed !== null) {
    collectFromObject(parsed, output);
  }
  collectLabeledValues(text, /\bcommands?\b\s*[:=]\s*\[?(?<values>[^\]\n]+)\]?/giu, output.commands, normalizeCommand);
  collectLabeledValues(text, /\bhooks?\b\s*[:=]\s*\[?(?<values>[^\]\n]+)\]?/giu, output.hooks, normalizeHook);
  for (const match of text.matchAll(/\[(?:mcp_servers|mcpServers)\.(?<name>[A-Za-z0-9_.:-]+)\]/gu)) {
    output.mcpServers.add(match.groups.name);
  }
  for (const match of text.matchAll(/"(?<name>[A-Za-z0-9_.:-]+)"\s*:\s*\{[^{}]*"command"\s*:/gu)) {
    output.mcpServers.add(match.groups.name);
  }
}

function collectFromObject(value, output) {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectFromObject(entry, output);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "commands") {
      collectStringValues(entry, output.commands, normalizeCommand);
    } else if (key === "hooks") {
      collectStringValues(entry, output.hooks, normalizeHook);
    } else if (key === "mcpServers" || key === "mcp_servers") {
      collectObjectKeys(entry, output.mcpServers);
    }
    collectFromObject(entry, output);
  }
}

function collectStringValues(value, target, normalize) {
  if (typeof value === "string") {
    addNormalized(target, normalize(value));
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringValues(entry, target, normalize);
    }
  } else if (value !== null && typeof value === "object") {
    collectObjectKeys(value, target);
  }
}

function collectObjectKeys(value, target) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      addNormalized(target, normalizeIdentifier(key));
    }
  }
}

function collectLabeledValues(text, pattern, target, normalize) {
  for (const match of text.matchAll(pattern)) {
    for (const value of splitValues(match.groups.values)) {
      addNormalized(target, normalize(value));
    }
  }
}

function splitValues(value) {
  return value
    .split(/[,\s]+/u)
    .map((entry) => entry.trim().replace(/^['"`\[]+|['"`\].:;]+$/gu, ""))
    .filter((entry) => entry.length > 0);
}

function mergeDetectedMetadata(unit, detected, document) {
  const changedFields = [];
  const components = ensureNestedMap(unit, "components", document);
  if (appendValues(components, "commands", detected.commands, document)) {
    changedFields.push("components.commands");
  }
  if (appendValues(components, "hooks", detected.hooks, document)) {
    changedFields.push("components.hooks");
  }
  if (appendValues(components, "mcp_servers", detected.mcpServers, document)) {
    changedFields.push("components.mcp_servers");
  }
  const provided = componentNames(detected);
  if (appendValues(unit, "provided_components", provided, document)) {
    changedFields.push("provided_components");
  }
  if (appendValues(unit, "modified_config_files", detected.modifiedConfigFiles, document)) {
    changedFields.push("modified_config_files");
  }
  const risk = detected.hooks.length > 0 || detected.mcpServers.length > 0
    ? "high"
    : detected.commands.length > 0 ? "medium" : "";
  if (setIfHigherRisk(unit, risk)) {
    changedFields.push("permission_risk");
  }
  return changedFields;
}

function ensureInstallUnit(document, id, defaults) {
  const units = ensureMap(document, "install_units");
  const existing = units.get(id, true);
  if (existing !== undefined) {
    return requireYamlMap(existing, `install_units.${id}`);
  }
  const unit = document.createNode({
    kind: defaults.kind,
    trust_level: "unreviewed",
    source: defaults.source,
    scope: defaults.scope,
    provided_components: [],
    components: {},
    modified_config_files: [],
    auto_update: false,
    enabled: true,
    permission_risk: "unknown",
    rollback: "manual"
  });
  units.set(id, unit);
  return requireYamlMap(unit, `install_units.${id}`);
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

function appendValues(parent, key, values, document) {
  if (values.length === 0) {
    return false;
  }
  const seq = ensureSeq(parent, key, document);
  const before = seq.items.length;
  for (const value of values) {
    if (!seq.items.some((item) => item?.value === value)) {
      seq.add(document.createNode(value));
    }
  }
  return seq.items.length !== before;
}

function ensureSeq(parent, key, document) {
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

function requireYamlMap(value, label) {
  if (!YAML.isMap(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  value.flow = false;
  return value;
}

function setIfHigherRisk(unit, risk) {
  if (risk.length === 0) {
    return false;
  }
  const rank = { unknown: 0, low: 1, medium: 2, high: 3 };
  const current = unit.get("permission_risk");
  if ((rank[risk] ?? 0) <= (rank[current] ?? 0)) {
    return false;
  }
  unit.set("permission_risk", risk);
  return true;
}

function componentNames(detected) {
  const names = [];
  if (detected.commands.length > 0) {
    names.push("commands");
  }
  if (detected.hooks.length > 0) {
    names.push("hook");
  }
  if (detected.mcpServers.length > 0) {
    names.push("mcp-server");
  }
  return names;
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function addNormalized(target, value) {
  if (value.length > 0) {
    target.add(value);
  }
}

function normalizeCommand(value) {
  const trimmed = normalizeIdentifier(value);
  return trimmed.startsWith("$") ? trimmed : `$${trimmed}`;
}

function normalizeHook(value) {
  return normalizeIdentifier(value).replace(/\.json$/u, "");
}

function normalizeIdentifier(value) {
  return value.trim().replace(/^['"`\[]+|['"`\].:;]+$/gu, "");
}

function normalizePath(value, root) {
  return displayPath(normalizeIdentifier(value), root);
}

function displayPath(path, root) {
  if (!isAbsolute(path)) {
    return path.replace(/\\/g, "/");
  }
  const rel = relative(root, path).replace(/\\/g, "/");
  return rel.startsWith("..") ? path : rel;
}

function resolveUnderRoot(root, path) {
  return isAbsolute(path) ? path : resolve(root, path);
}

function preserveLineEndings(text, reference) {
  return reference.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}

function requireOption(value, name) {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required option: --${name}`);
  }
  return value;
}
