import { dirname, isAbsolute } from "node:path";
import { buildSkillBrief } from "./advisor.mjs";
import { renderSkillBrief } from "./brief-renderer.mjs";

export async function runBriefCommand(options, stdout, paths) {
  const json = options.get("json") === "true";
  const result = await buildSkillBrief({
    root: briefRoot(options) ?? dirname(paths.configPath),
    configPath: paths.configPath,
    skillsRoot: paths.skillsRoot,
    workflow: options.get("workflow"),
    intent: options.get("intent"),
    agent: options.get("agent"),
    includeActions: options.get("include-actions") === "true" || !json
  });
  writeBriefOutput(stdout, result, options);
  return briefExitCode(result);
}

function briefRoot(options) {
  const dir = options.get("dir");
  if (dir !== undefined) {
    return dir;
  }
  const config = options.get("config");
  return config !== undefined && isAbsolute(config) ? dirname(config) : undefined;
}

function briefExitCode(result) {
  if (result.ok) {
    return 0;
  }
  return result.error?.code === "unknown-workflow" ? 2 : 1;
}

function writeBriefOutput(stdout, result, options) {
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  stdout.write(renderSkillBrief(result, { verbose: options.get("verbose") === "true" }));
}
