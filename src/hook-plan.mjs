import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadWorkspace } from "./workspace.mjs";
import { V1_MUTATION_ERROR } from "./compatibility.mjs";

export const GUARD_HOOK_MODE = 0o755;

export async function planGuardHookInstall(options) {
  const { plan } = await buildGuardHookInstallPlan(options);
  return plan;
}

export async function buildGuardHookInstallPlan(options) {
  const workspace = await loadWorkspace({ configPath: options.configPath, skillsRoot: options.skillsRoot });
  requireWorkflow(workspace, options.workflow);
  const out = options.out ?? join(dirname(options.configPath), ".skillboard", "hooks", `skillboard-guard-${safeHookFilePart(options.workflow)}.sh`);
  if (workspace.version === 2) await assertHookTargetContained(options.configPath, out);
  const command = options.command ?? "skillboard";
  const skillsRoot = options.skillsRoot ?? "skills";
  const script = renderGuardHookScript({
    command,
    workflow: options.workflow,
    configPath: options.configPath,
    skillsRoot
  });
  const target = await inspectHookTarget(out);
  const plannedMode = modeToOctal(GUARD_HOOK_MODE);
  const plan = {
    policy_projection_version: workspace.version,
    path: out,
    workflow: options.workflow,
    command,
    target_exists: target.exists,
    target_type: target.type,
    planned_mode: plannedMode,
    permissions: modeToPermissions(GUARD_HOOK_MODE),
    would_be_executable: (GUARD_HOOK_MODE & 0o111) !== 0,
    preview: {
      display: `Install executable guard hook for workflow ${options.workflow} at ${out}`,
      shell: renderGuardHookInstallShellPreview({ path: out, mode: plannedMode, script })
    }
  };

  return { plan, script };
}

export async function assertHookTargetContained(configPath, targetPath) {
  const root = await realpath(dirname(resolve(configPath)));
  const target = resolve(targetPath);
  const targetRelative = relative(root, target);
  if (targetRelative === "" || targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
    throw new Error("Guard hook target must remain inside the config directory.");
  }
  let current = root;
  for (const part of targetRelative.split(/[\\/]/u).slice(0, -1)) {
    current = join(current, part);
    const stats = await lstat(current).catch(missingOnly);
    if (stats === undefined) continue;
    if (stats.isSymbolicLink()) throw new Error("Guard hook parent must not be a symbolic link.");
    if (!stats.isDirectory()) throw new Error("Guard hook parent must be a directory.");
  }
}

export function assertGuardHookPlanIsInstallable(plan) {
  if (plan.policy_projection_version !== 2) throw new Error(V1_MUTATION_ERROR);
  if (plan.target_exists) {
    throw new Error(`Refusing to overwrite existing hook path: ${plan.path}`);
  }
}

function requireWorkflow(workspace, name) {
  const workflow = workspace.workflows.find((candidate) => candidate.name === name);
  if (workflow === undefined) {
    throw new Error(`Unknown workflow: ${name}`);
  }
}

function renderGuardHookScript(options) {
  return `#!/usr/bin/env sh
set -eu

# SkillBoard policy projection version: 2

SKILLBOARD_BIN=${shellQuote(options.command)}
SKILLBOARD_CONFIG=${shellQuote(options.configPath)}
SKILLBOARD_SKILLS=${shellQuote(options.skillsRoot)}
SKILLBOARD_WORKFLOW=${shellQuote(options.workflow)}
SKILLBOARD_POLICY_PROJECTION_VERSION=2
export SKILLBOARD_POLICY_PROJECTION_VERSION

if [ "\${SKILLBOARD_SKILL_ID:-}" != "" ]; then
  skill_id="$SKILLBOARD_SKILL_ID"
elif [ "\${1:-}" != "" ]; then
  skill_id="$1"
else
  echo "SKILLBOARD_SKILL_ID or first argument is required" >&2
  exit 64
fi

# Split the install-time command so hooks can use commands like:
#   --skillboard-bin "node bin/skillboard.mjs"
# Paths containing spaces should be provided through an environment wrapper.
set -- $SKILLBOARD_BIN
exec "$@" guard use "$skill_id" --hook-projection-version 2 --workflow "$SKILLBOARD_WORKFLOW" --config "$SKILLBOARD_CONFIG" --skills "$SKILLBOARD_SKILLS"
`;
}

function renderGuardHookInstallShellPreview(options) {
  const delimiter = uniqueHeredocDelimiter(options.script);
  return [
    `mkdir -p ${shellQuote(dirname(options.path))}`,
    `cat > ${shellQuote(options.path)} <<'${delimiter}'`,
    options.script,
    delimiter,
    `chmod ${options.mode} ${shellQuote(options.path)}`
  ].join("\n");
}

function uniqueHeredocDelimiter(body) {
  const usedLines = new Set(body.split(/\r?\n/u));
  const base = "SKILLBOARD_GUARD_HOOK";
  if (!usedLines.has(base)) {
    return base;
  }
  for (let index = 1; ; index += 1) {
    const candidate = `${base}_${index}`;
    if (!usedLines.has(candidate)) {
      return candidate;
    }
  }
}

async function inspectHookTarget(path) {
  const existing = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (existing === undefined) {
    return { exists: false, type: "missing" };
  }
  if (existing.isSymbolicLink()) {
    return { exists: true, type: "symlink" };
  }
  if (existing.isFile()) {
    return { exists: true, type: "file" };
  }
  if (existing.isDirectory()) {
    return { exists: true, type: "directory" };
  }
  return { exists: true, type: "other" };
}

function missingOnly(error) {
  if (error?.code === "ENOENT") return undefined;
  throw error;
}

function modeToOctal(mode) {
  return mode.toString(8).padStart(4, "0");
}

function modeToPermissions(mode) {
  const triplets = [
    [0o400, 0o200, 0o100],
    [0o040, 0o020, 0o010],
    [0o004, 0o002, 0o001]
  ];
  return triplets.map(([read, write, execute]) => {
    return `${mode & read ? "r" : "-"}${mode & write ? "w" : "-"}${mode & execute ? "x" : "-"}`;
  }).join("");
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function safeHookFilePart(value) {
  const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length === 0 ? "workflow" : cleaned;
}
