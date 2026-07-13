import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export function resolveUserStatePaths(options = {}) {
  const home = resolve(options.home ?? options.env?.HOME ?? options.env?.USERPROFILE ?? homedir());
  const configPath = options.configPath === undefined
    ? join(home, "skillboard.config.yaml")
    : resolveFrom(options.configPath, options.cwd ?? process.cwd());
  const inventoryPath = options.inventoryPath === undefined
    ? options.configPath === undefined
      ? join(home, ".skillboard", "inventory.json")
      : join(dirname(configPath), ".skillboard", "inventory.json")
    : resolveFrom(options.inventoryPath, options.cwd ?? process.cwd());
  return { home, configPath, inventoryPath, stateRoot: dirname(inventoryPath) };
}

function resolveFrom(path, cwd) {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}
