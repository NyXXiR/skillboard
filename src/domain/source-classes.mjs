export function installUnitSourceClass(unit) {
  if (unit.sourceClass !== undefined && unit.sourceClass.length > 0 && !RESERVED_SOURCE_CLASSES.has(unit.sourceClass)) {
    return unit.sourceClass;
  }
  if (unit.kind === "harness") {
    return "harness-bundle";
  }
  if (unit.kind === "workflow") {
    return "workflow-bundle";
  }
  if (unit.kind === "plugin" || unit.kind === "marketplace") {
    return "external-package";
  }
  if (unit.kind === "package-manager-dependency") {
    return "package-manager";
  }
  if (["mcp-server", "hook", "agent", "lsp"].includes(unit.kind)) {
    return "runtime-extension";
  }
  if (isUserControlledSource(unit)) {
    return "user";
  }
  if (unit.kind === "skill") {
    return "skill-pack";
  }
  return "unknown";
}

export function sourcePriority(sourceClass) {
  if (sourceClass === "user") {
    return 100;
  }
  if (sourceClass === "skill-pack") {
    return 70;
  }
  if (sourceClass === "workflow-bundle") {
    return 65;
  }
  if (sourceClass === "harness-bundle") {
    return 60;
  }
  if (sourceClass === "runtime-extension") {
    return 55;
  }
  if (sourceClass === "package-manager") {
    return 50;
  }
  if (sourceClass === "external-package") {
    return 40;
  }
  return 0;
}

export function installUnitPriority(unit) {
  if (unit.priority !== null && unit.priority !== undefined) {
    return unit.priority;
  }
  return sourcePriority(installUnitSourceClass(unit));
}

export function isUserControlledSource(unit) {
  return unit.kind === "skill" && isLocalSourceReference(unit.source);
}

export function isLocalSourceReference(source, options = {}) {
  const value = source.trim();
  if (value.length === 0 || isCommandSourceReference(value)) {
    return false;
  }
  if (value.startsWith("~/") || value.startsWith("./") || value.startsWith("../") || value === "." || value === "..") {
    return true;
  }
  if (isAbsolute(value)) {
    return true;
  }
  return options.allowBareRelative === true && !value.includes("://");
}

export function isCommandSourceReference(source) {
  const value = source.trim();
  return /^(?:npx|npm|pnpm|yarn|bunx|git|gh|curl|wget|uvx|pipx)\s+/u.test(value)
    || /^\/[A-Za-z][\w-]*\s+/u.test(value);
}

export function hasRuntimeComponents(unit) {
  return unit.components.commands.length > 0 || unit.components.hooks.length > 0 || unit.components.mcpServers.length > 0;
}

export function isModelSelectableInvocation(invocation) {
  return invocation === "router-only" || invocation === "workflow-auto" || invocation === "global-auto";
}

export const RESERVED_SOURCE_CLASSES = new Set(["user"]);
import { isAbsolute } from "node:path";
