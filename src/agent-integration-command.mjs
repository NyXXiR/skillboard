import { isAbsolute, relative, resolve } from "node:path";

export function commandPrefix(runtime) {
  const entrypoint = runtime.entrypointPath ?? "";
  const normalized = entrypoint.replace(/\\/g, "/");
  if (normalized.includes("/_npx/")) {
    const packageSpec = runtime.packageSpec ?? "agent-skillboard";
    return `npx --yes --package ${shellQuote(packageSpec, runtime.platform)} skillboard`;
  }
  if (isSourceTreeEntrypoint(entrypoint)) {
    return `node ${sourceTreeEntrypoint(entrypoint, runtime.cwd ?? process.cwd(), runtime.platform)}`;
  }
  return "skillboard";
}

function isSourceTreeEntrypoint(entrypoint) {
  if (entrypoint === "") return false;
  const normalized = entrypoint.replace(/\\/g, "/");
  return (normalized === "bin/skillboard.mjs" || normalized.endsWith("/bin/skillboard.mjs"))
    && !normalized.includes("/node_modules/")
    && !normalized.includes("/_npx/")
    && !normalized.includes("/.npm/");
}

function sourceTreeEntrypoint(entrypoint, cwd, platform) {
  const absoluteEntrypoint = isAbsolute(entrypoint) ? entrypoint : resolve(cwd, entrypoint);
  const relativeEntrypoint = relative(cwd, absoluteEntrypoint).replace(/\\/g, "/");
  if (!relativeEntrypoint.startsWith("../") && relativeEntrypoint !== ".." && !isAbsolute(relativeEntrypoint)) {
    return shellQuote(relativeEntrypoint, platform);
  }
  return shellQuote(absoluteEntrypoint, platform);
}

export function shellQuote(value, platform = process.platform) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  if (platform === "win32") return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
