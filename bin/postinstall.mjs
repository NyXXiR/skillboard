#!/usr/bin/env node

import { runSetupCommand } from "../src/lifecycle-cli.mjs";

if (isTruthy(process.env.SKILLBOARD_SKIP_POSTINSTALL)) {
  process.exit(0);
}

process.stderr.write(`${[
  "SkillBoard installed or updated.",
  "It does not change agent configs or project files.",
  ""
].join("\n")}\n`);

if (!shouldAutoSetup(process.env)) {
  process.stderr.write(`${[
    "Global installs and updates auto-run agent setup when supported agent homes are detected.",
    "Run skillboard setup later after adding another supported agent:",
    "  skillboard setup",
    "",
    "Setup only writes user agent skill files and does not initialize projects.",
    ""
  ].join("\n")}`);
  process.exit(0);
}

process.stderr.write("Auto-running agent setup for detected supported agents.\n");

const stderr = {
  write(chunk) {
    process.stderr.write(chunk);
  }
};

try {
  const exitCode = await runSetupCommand(new Map([["yes", "true"]]), stderr, {
    cwd: process.env.INIT_CWD ?? process.cwd(),
    env: process.env,
    entrypointPath: "skillboard",
    packageSpec: "agent-skillboard"
  });
  if (exitCode === 0) {
    process.stderr.write("Agent setup complete. Package updates rerun this setup automatically; run skillboard setup later after adding another supported agent.\n");
  } else {
    process.stderr.write("Agent setup did not find supported agent homes. Run skillboard setup after installing or enabling a supported agent.\n");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Agent setup skipped: ${message}\n`);
  process.stderr.write("Run skillboard setup after install if supported agents should recognize SkillBoard.\n");
}

function shouldAutoSetup(env) {
  return isTruthy(env.SKILLBOARD_POSTINSTALL_SETUP)
    || env.npm_config_global === "true"
    || env.npm_config_location === "global";
}

function isTruthy(value) {
  return /^(1|true|yes)$/i.test(value ?? "");
}
