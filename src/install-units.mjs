import { readBoolean, readOptionalNumber, readOptionalString, readString, readStringList, requireRecord } from "./config-helpers.mjs";
import { INSTALL_UNIT_KIND_VALUES, PERMISSION_RISK_VALUES, TRUST_LEVEL_VALUES } from "./domain/constants.mjs";

export function parseInstallUnits(value) {
  const raw = requireRecord(value ?? {}, "install_units");
  return Object.entries(raw).map(([id, entry]) => {
    const unit = requireRecord(entry, `install_units.${id}`);
    const kind = readString(unit, "kind", "skill");
    const permissionRisk = readString(unit, "permission_risk", "unknown");
    const trustLevel = readString(unit, "trust_level", "unreviewed");
    const sourceDigest = readOptionalString(unit, "source_digest");
    const signature = readOptionalString(unit, "signature");
    const publicKey = readOptionalString(unit, "public_key");
    const verifiedAt = readOptionalString(unit, "verified_at");
    if (!INSTALL_UNIT_KIND_VALUES.has(kind)) {
      throw new Error(`Unsupported install unit kind for ${id}: ${kind}`);
    }
    if (!PERMISSION_RISK_VALUES.has(permissionRisk)) {
      throw new Error(`Unsupported permission risk for ${id}: ${permissionRisk}`);
    }
    if (!TRUST_LEVEL_VALUES.has(trustLevel)) {
      throw new Error(`Unsupported trust level for ${id}: ${trustLevel}`);
    }
    return {
      id,
      kind,
      sourceClass: readOptionalString(unit, "source_class"),
      priority: readOptionalNumber(unit, "priority"),
      trustLevel,
      sourceDigest: nonEmpty(sourceDigest),
      signature: nonEmpty(signature),
      publicKey: nonEmpty(publicKey),
      verifiedAt: nonEmpty(verifiedAt),
      source: readString(unit, "source", ""),
      scope: readString(unit, "scope", "local"),
      manifestPath: readString(unit, "manifest_path", ""),
      cachePath: readString(unit, "cache_path", ""),
      providedComponents: readStringList(unit, "provided_components"),
      components: parseComponents(unit.components, `install_units.${id}.components`),
      modifiedConfigFiles: readStringList(unit, "modified_config_files"),
      autoUpdate: readBoolean(unit, "auto_update", false),
      enabled: readBoolean(unit, "enabled", false),
      workflowDependencies: readStringList(unit, "workflow_dependencies"),
      permissionRisk,
      rollback: readString(unit, "rollback", "unknown")
    };
  });
}

function nonEmpty(value) {
  return value === undefined || value.trim() === "" ? undefined : value;
}

function parseComponents(value, label) {
  const raw = requireRecord(value ?? {}, label);
  return {
    skills: readStringList(raw, "skills"),
    commands: readStringList(raw, "commands"),
    hooks: readStringList(raw, "hooks"),
    mcpServers: readStringList(raw, "mcp_servers")
  };
}
