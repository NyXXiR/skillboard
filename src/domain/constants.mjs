export const STATUS_VALUES = new Set([
  "discovered",
  "quarantined",
  "vendor",
  "candidate",
  "active",
  "active-manual",
  "active-router",
  "active-auto",
  "canonical",
  "blocked",
  "deprecated",
  "archived",
  "removed"
]);

export const INVOCATION_VALUES = new Set([
  "manual-only",
  "router-only",
  "workflow-auto",
  "global-auto",
  "blocked",
  "deprecated"
]);

export const HARNESS_STATUS_VALUES = new Set(["available", "configured", "primary", "fallback", "disabled", "removed"]);
export const EXPOSURE_VALUES = new Set(["exported", "global-meta", "unit-managed", "private"]);

export const INSTALL_UNIT_KIND_VALUES = new Set([
  "skill",
  "workflow",
  "plugin",
  "marketplace",
  "package-manager-dependency",
  "harness",
  "mcp-server",
  "hook",
  "agent",
  "lsp",
  "custom"
]);

export const PERMISSION_RISK_VALUES = new Set(["low", "medium", "high", "unknown"]);
export const TRUST_LEVEL_VALUES = new Set(["trusted", "reviewed", "unreviewed", "blocked"]);

export const NON_CALLABLE_WORKFLOW_STATUSES = new Set(["blocked", "quarantined", "deprecated", "archived", "removed"]);
export const NON_CALLABLE_WORKFLOW_INVOCATIONS = new Set(["blocked", "deprecated"]);
