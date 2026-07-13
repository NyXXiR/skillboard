import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";

export function expandPortablePath(value, paths) {
  if (value === "${PROJECT}") return paths.rootDir;
  if (value.startsWith("${PROJECT}/")) return resolve(paths.rootDir, value.slice("${PROJECT}/".length));
  if (value === "${HOME}") return homedir();
  if (value.startsWith("${HOME}/")) return resolve(homedir(), value.slice("${HOME}/".length));
  if (value === "<external>" || value.startsWith("<external>/")) return null;
  return value;
}

export function portableObservation(value, options) {
  if (value.startsWith("${PROJECT}") || value.startsWith("${HOME}") || value.startsWith("<external>")) return value;
  if (value.startsWith("~/")) return `\${HOME}/${value.slice(2)}`;
  return isAbsolute(value) ? auditPath(value, options) : value;
}

export function auditPath(path, options) {
  const project = relative(options.rootDir, path);
  if (!project.startsWith("..") && !isAbsolute(project)) {
    return project === "" ? "${PROJECT}" : `\${PROJECT}/${project.replace(/\\/g, "/")}`;
  }
  const home = relative(homedir(), path);
  if (!home.startsWith("..") && !isAbsolute(home)) {
    return home === "" ? "${HOME}" : `\${HOME}/${home.replace(/\\/g, "/")}`;
  }
  return `<external>/${basename(path)}`;
}

export function redactPathError(error, options) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(options.rootDir, "${PROJECT}")
    .replaceAll(options.configDir, "${PROJECT}")
    .replaceAll(homedir(), "${HOME}");
}
