#!/usr/bin/env node

import { runSetupCommand } from "../src/lifecycle-cli.mjs";

if (isTruthy(process.env.SKILLBOARD_SKIP_POSTINSTALL)) {
  process.exit(0);
}

process.stderr.write(`${[
  "SkillBoard installed or updated.",
  "It can refresh user-agent guidance on global installs, but it does not initialize projects.",
  "skillboard init is deprecated project-local policy bootstrap and is not needed for normal use.",
  ""
].join("\n")}\n`);

if (!shouldAutoSetup(process.env)) {
  process.stderr.write(`${[
    "Global installs and updates auto-run agent setup when supported agent homes are detected.",
    "Run skillboard setup later after adding another supported agent:",
    "  skillboard setup",
    "",
    "Setup writes user-agent guidance, reconciles shared skills, and refreshes the user-level policy and inventory.",
    "skillboard init is deprecated project-local policy bootstrap and is not needed for normal use.",
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
    process.stderr.write("Agent setup complete. Package updates rerun this setup automatically; run skillboard setup later after adding another supported agent. No project init was run.\n");
    process.stderr.write("Run skillboard doctor --summary to check policy and executable paths after the update.\n");
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
