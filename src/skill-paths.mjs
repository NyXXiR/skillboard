export function normalizeSkillPath(value, label = "skill path") {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (value.includes("\0")) {
    throw new Error(`${label} must not contain null bytes`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.startsWith("//") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`${label} must be relative to the skills root`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} must stay under the skills root`);
  }
  return normalized;
}
