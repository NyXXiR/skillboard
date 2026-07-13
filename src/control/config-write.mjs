import { open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import YAML from "yaml";
import { loadWorkspace } from "../workspace.mjs";
import { checkPolicy } from "../policy.mjs";
import { textChangePlan } from "../change-plan.mjs";
import { canUseSkill } from "./can-use-guard.mjs";
import { assertV2MutationVersion } from "../compatibility.mjs";

export async function loadConfig(path) {
  const text = await readFile(path, "utf8");
  const document = YAML.parseDocument(text);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  requireYamlMap(document.contents, "config root");
  return {
    document,
    originalText: text
  };
}

export async function writeCheckedConfig(document, originalText, options, message) {
  assertV2MutationVersion(document.get("version") ?? 1);
  const nextText = preserveLineEndings(String(document), originalText);
  const plan = textChangePlan(originalText, nextText);
  const tempPath = tempConfigPath(options.configPath);
  const originalMode = (await stat(options.configPath)).mode & 0o777;
  await writeFile(tempPath, nextText, { encoding: "utf8", flag: "wx", mode: originalMode });
  try {
    const workspace = await loadWorkspace({ configPath: tempPath, skillsRoot: options.skillsRoot });
    const policy = checkPolicy(workspace);
    if (!policy.ok) {
      throw new Error(`Policy update would create invalid config:\n${policy.errors.join("\n")}`);
    }
    const validateUses = options.validateUses ?? (options.validateUse === undefined ? [] : [options.validateUse]);
    for (const useRequest of validateUses) {
      const use = canUseSkill(workspace, useRequest.skillId, useRequest.workflow);
      if (!use.allowed) {
        throw new Error(`Control update would not be usable:\n${use.reasons.join("\n")}`);
      }
    }
    if (options.dryRun === true) {
      return { message, policy, dryRun: true, changed: plan.changed, plan };
    }
    if (plan.changed) {
      await rename(tempPath, options.configPath);
    }
    return { message, policy, dryRun: false, changed: plan.changed, plan };
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function withPolicyMutationLock(configPath, operation) {
  const canonicalPath = await realpath(configPath);
  const lockPath = `${canonicalPath}.migrate.lock`;
  const deadline = Date.now() + 5_000;
  let handle;
  while (handle === undefined) {
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST" || Date.now() >= deadline) {
        throw error?.code === "EEXIST"
          ? new Error("Another policy update is already using this config.")
          : error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    await handle.sync();
    return await operation(canonicalPath);
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

function tempConfigPath(configPath) {
  return join(dirname(configPath), `.${basename(configPath)}.${randomUUID()}.tmp`);
}

function preserveLineEndings(text, reference) {
  return reference.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}

export function requireMapAt(document, path, label) {
  return requireYamlMap(document.getIn(path, true), label);
}

export function ensureMapAt(document, path, label) {
  const existing = document.getIn(path, true);
  if (existing !== undefined) {
    const map = requireYamlMap(existing, label);
    map.flow = false;
    return map;
  }
  const next = document.createNode({});
  next.flow = false;
  document.setIn(path, next);
  return next;
}

export function requireYamlMap(value, label) {
  if (!YAML.isMap(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
}

export function ensureSeq(map, key, document) {
  const existing = map.get(key, true);
  if (existing === undefined) {
    const next = document.createNode([]);
    next.flow = false;
    map.set(key, next);
    return next;
  }
  if (!YAML.isSeq(existing)) {
    throw new Error(`${key} must be a list`);
  }
  existing.flow = false;
  return existing;
}

export function optionalSeq(map, key) {
  const existing = map.get(key, true);
  if (existing === undefined) {
    return undefined;
  }
  if (!YAML.isSeq(existing)) {
    throw new Error(`${key} must be a list`);
  }
  return existing;
}

export function optionalMap(map, key) {
  const existing = map.get(key, true);
  if (existing === undefined) {
    return undefined;
  }
  return requireYamlMap(existing, key);
}

export function mapValues(map, label) {
  return map.items.map((pair) => requireYamlMap(pair.value, label));
}

export function readMapString(map, key, fallback) {
  const value = map.get(key);
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

export function addUnique(values, value) {
  if (!sequenceIncludes(values, value)) {
    values.add(value);
  }
}

export function removeValue(values, value) {
  for (let index = values.items.length - 1; index >= 0; index -= 1) {
    if (nodeScalarValue(values.items[index]) === value) {
      values.delete(index);
    }
  }
}

export function optionalRootMap(document, key) {
  const existing = document.get(key, true);
  return existing === undefined ? undefined : requireYamlMap(existing, key);
}

export function sequenceIncludes(sequence, value) {
  return sequence.items.some((item) => nodeScalarValue(item) === value);
}

export function uniqueValues(values) {
  return [...new Set(values)];
}

export function nodeScalarValue(node) {
  return node !== null && typeof node === "object" && "value" in node ? node.value : node;
}
