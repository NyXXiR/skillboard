import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, resolve } from "node:path";
import YAML from "yaml";
import { readBoolean, readOptionalNumber, readOptionalString, readString, readStringList, requireRecord } from "./config-helpers.mjs";
import {
  EXPOSURE_VALUES,
  INSTALL_UNIT_KIND_VALUES,
  INVOCATION_VALUES,
  PERMISSION_RISK_VALUES,
  STATUS_VALUES,
  TRUST_LEVEL_VALUES
} from "./domain/constants.mjs";

const PROFILE_DIR = fileURLToPath(new URL("../profiles", import.meta.url));

export async function loadSourceProfile(profileRef, options = {}) {
  const path = await resolveProfilePath(profileRef, options.profileDirs ?? []);
  const raw = requireRecord(YAML.parse(await readFile(path, "utf8")), `source profile ${profileRef}`);
  return parseSourceProfile(raw, path);
}

async function resolveProfilePath(profileRef, profileDirs) {
  if (looksLikePath(profileRef)) {
    return resolve(profileRef);
  }
  const dirs = [...profileDirs, PROFILE_DIR];
  for (const dir of dirs) {
    const entries = await readdir(dir).catch(() => []);
    for (const entry of entries) {
      if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) {
        continue;
      }
      const path = join(dir, entry);
      const profile = requireRecord(YAML.parse(await readFile(path, "utf8")), `source profile ${path}`);
      if (profile.id === profileRef) {
        return path;
      }
    }
  }
  throw new Error(`Unknown source profile: ${profileRef}`);
}

function looksLikePath(value) {
  return isAbsolute(value) || value.startsWith(".") || value.includes("/") || value.includes("\\");
}

function parseSourceProfile(raw, path) {
  const profile = {
    id: readString(raw, "id", ""),
    source: readString(raw, "source", ""),
    kind: readString(raw, "kind", "skill"),
    sourceClass: readOptionalString(raw, "source_class"),
    priority: readOptionalNumber(raw, "priority"),
    trustLevel: readString(raw, "trust_level", "unreviewed"),
    sourceDigest: readOptionalString(raw, "source_digest"),
    signature: readOptionalString(raw, "signature"),
    publicKey: readOptionalString(raw, "public_key"),
    verifiedAt: readOptionalString(raw, "verified_at"),
    namespace: readString(raw, "namespace", ""),
    targetPathPrefix: readString(raw, "target_path_prefix", readString(raw, "namespace", "")),
    idStrategy: readString(raw, "id_strategy", "path"),
    scope: readString(raw, "scope", "local"),
    manifestPath: readString(raw, "manifest_path", ""),
    cachePath: readString(raw, "cache_path", ""),
    defaultStatus: readString(raw, "default_status", "vendor"),
    defaultInvocation: readString(raw, "default_invocation", "manual-only"),
    defaultExposure: readString(raw, "default_exposure", "exported"),
    defaultCategory: readString(raw, "default_category", "uncategorized"),
    providedComponents: readStringList(raw, "provided_components"),
    skillPaths: readStringList(raw, "skill_paths"),
    components: parseProfileComponents(raw.components, `source profile ${path}.components`),
    modifiedConfigFiles: readStringList(raw, "modified_config_files"),
    autoUpdate: readBoolean(raw, "auto_update", false),
    enabled: readBoolean(raw, "enabled", true),
    workflowDependencies: readStringList(raw, "workflow_dependencies"),
    permissionRisk: readString(raw, "permission_risk", "unknown"),
    rollback: readString(raw, "rollback", "unknown")
  };
  if (profile.id.length === 0) {
    throw new Error(`Source profile ${path} is missing id`);
  }
  validateProfileValues(profile);
  return profile;
}

function parseProfileComponents(value, label) {
  const raw = requireRecord(value ?? {}, label);
  return {
    commands: readStringList(raw, "commands"),
    hooks: readStringList(raw, "hooks"),
    mcpServers: readStringList(raw, "mcp_servers")
  };
}

function validateProfileValues(profile) {
  if (!INSTALL_UNIT_KIND_VALUES.has(profile.kind)) {
    throw new Error(`Unsupported source profile kind for ${profile.id}: ${profile.kind}`);
  }
  if (!STATUS_VALUES.has(profile.defaultStatus)) {
    throw new Error(`Unsupported source profile default_status for ${profile.id}: ${profile.defaultStatus}`);
  }
  if (!INVOCATION_VALUES.has(profile.defaultInvocation)) {
    throw new Error(`Unsupported source profile default_invocation for ${profile.id}: ${profile.defaultInvocation}`);
  }
  if (!EXPOSURE_VALUES.has(profile.defaultExposure)) {
    throw new Error(`Unsupported source profile default_exposure for ${profile.id}: ${profile.defaultExposure}`);
  }
  if (!PERMISSION_RISK_VALUES.has(profile.permissionRisk)) {
    throw new Error(`Unsupported source profile permission_risk for ${profile.id}: ${profile.permissionRisk}`);
  }
  if (!TRUST_LEVEL_VALUES.has(profile.trustLevel)) {
    throw new Error(`Unsupported source profile trust_level for ${profile.id}: ${profile.trustLevel}`);
  }
  if (profile.defaultInvocation === "global-auto" && profile.defaultExposure !== "global-meta") {
    throw new Error(`Source profile ${profile.id} cannot grant global-auto to non-global-meta skills`);
  }
}
