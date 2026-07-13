import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import YAML from "yaml";
import { textChangePlan } from "./change-plan.mjs";
import { TRUST_LEVEL_VALUES } from "./domain/constants.mjs";
import { checkPolicy } from "./policy.mjs";
import { loadWorkspace } from "./workspace.mjs";
import { assertV2MutationVersion } from "./compatibility.mjs";

export async function reviewInstallUnit(options) {
  const trustLevel = options.trustLevel ?? "reviewed";
  if (!TRUST_LEVEL_VALUES.has(trustLevel)) {
    throw new Error(`review install-unit requires --trust-level ${[...TRUST_LEVEL_VALUES].join("|")}; got ${trustLevel}`);
  }

  const { document, originalText } = await loadConfig(options.configPath);
  assertV2MutationVersion(document.get("version") ?? 1);
  const installUnits = requireMapAt(document, ["install_units"], "install_units");
  const unit = installUnits.get(options.unitId, true);
  if (unit === undefined) {
    throw new Error(`Unknown install unit: ${options.unitId}`);
  }
  const unitMap = requireYamlMap(unit, `install_units.${options.unitId}`);
  unitMap.set("trust_level", trustLevel);
  if (trustLevel === "blocked") {
    unitMap.set("enabled", false);
  }

  return await writeCheckedConfig(
    document,
    originalText,
    options,
    `Reviewed install unit ${options.unitId} as ${trustLevel}`
  );
}

async function loadConfig(path) {
  const text = await readFile(path, "utf8");
  const document = YAML.parseDocument(text);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  requireYamlMap(document.contents, "config root");
  return { document, originalText: text };
}

async function writeCheckedConfig(document, originalText, options, message) {
  const nextText = preserveLineEndings(String(document), originalText);
  const plan = textChangePlan(originalText, nextText);
  const tempPath = join(dirname(options.configPath), `.${basename(options.configPath)}.${randomUUID()}.tmp`);
  await writeFile(tempPath, nextText, { encoding: "utf8", flag: "wx" });
  try {
    const workspace = await loadWorkspace({ configPath: tempPath, skillsRoot: options.skillsRoot });
    const policy = checkPolicy(workspace);
    if (!policy.ok) {
      throw new Error(`Policy update would create invalid config:\n${policy.errors.join("\n")}`);
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

function requireMapAt(document, path, label) {
  const value = document.getIn(path, true);
  if (value === undefined) {
    const map = document.createNode({});
    document.setIn(path, map);
    return map;
  }
  return requireYamlMap(value, label);
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
