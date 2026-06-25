import { dirname, isAbsolute } from "node:path";
import { buildSkillBrief } from "./advisor.mjs";
import { renderSkillBrief } from "./brief-renderer.mjs";

export async function runBriefCommand(options, stdout, paths) {
  const result = await buildSkillBrief({
    root: briefRoot(options),
    configPath: paths.configPath,
    skillsRoot: paths.skillsRoot,
    workflow: options.get("workflow"),
    includeActions: options.get("include-actions") === "true"
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
  return config !== undefined && isAbsolute(config) ? dirname(config) : ".";
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
  stdout.write(renderSkillBrief(result));
}
