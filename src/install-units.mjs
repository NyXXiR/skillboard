import { readBoolean, readString, readStringList, requireRecord } from "./config-helpers.mjs";

const INSTALL_UNIT_KIND_VALUES = new Set([
  "skill",
  "plugin",
  "marketplace",
  "package-manager-dependency",
  "harness",
  "mcp-server",
  "hook",
  "agent",
  "lsp"
]);
const PERMISSION_RISK_VALUES = new Set(["low", "medium", "high", "unknown"]);

export function parseInstallUnits(value) {
  const raw = requireRecord(value ?? {}, "install_units");
  return Object.entries(raw).map(([id, entry]) => {
    const unit = requireRecord(entry, `install_units.${id}`);
    const kind = readString(unit, "kind", "skill");
    const permissionRisk = readString(unit, "permission_risk", "unknown");
    if (!INSTALL_UNIT_KIND_VALUES.has(kind)) {
      throw new Error(`Unsupported install unit kind for ${id}: ${kind}`);
    }
    if (!PERMISSION_RISK_VALUES.has(permissionRisk)) {
      throw new Error(`Unsupported permission risk for ${id}: ${permissionRisk}`);
    }
    return {
      id,
      kind,
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

function parseComponents(value, label) {
  const raw = requireRecord(value ?? {}, label);
  return {
    skills: readStringList(raw, "skills"),
    commands: readStringList(raw, "commands"),
    hooks: readStringList(raw, "hooks"),
    mcpServers: readStringList(raw, "mcp_servers")
  };
}
