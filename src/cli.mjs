// allow: SIZE_OK - legacy CLI dispatcher split is deferred from the 0.2.7 release gate.
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { buildGeneratedInventory, mergeGeneratedInventory } from "./inventory-json.mjs";
import {
  activateSkill,
  addHarness,
  addSkill,
  addSkillVariant,
  addWorkflow,
  approveSkillVariant,
  auditSources,
  blockSkill,
  canUseSkill,
  checkPolicy,
  detectInstallOutput,
  doctorProject,
  explainSkill,
  forkSkillVariant,
  forgetV2Skill,
  importSource,
  installGuardHook,
  impactDisable,
  listHarnesses,
  listInstallUnits,
  listSkills,
  listWorkflows,
  loadSourceProfile,
  loadWorkspace,
  mergeImportFragment,
  preferSkill,
  quarantineSkill,
  removeSkill,
  resetSkillVariant,
  setV2SkillEnabled,
  setV2SkillPreference,
  setV2SkillShared,
  reconcileWorkspace,
  refreshAgentInventory,
  refreshSourcePins,
  renderDashboard,
  renderImportFragment,
  renderReconcilePlan,
  reviewInstallUnit,
  rolloutApply,
  rolloutAudit,
  rolloutPlan,
  rolloutReport,
  rolloutRollback,
  routeSkill,
  verifySources,
  variantLifecycleStatus,
  writeLockfile
} from "./index.mjs";
// SIZE_OK: src/cli.mjs is pre-existing command-router debt; brief behavior delegates to src/brief-cli.mjs and hook planning delegates through src/hook-plan.mjs until a broader router split.
import { ApplyActionError, applyActionErrorPayload, applyAdvisorAction } from "./advisor/apply-action.mjs";
import { importAgentSkill, renderImportAgentSkill } from "./agent-skill-import.mjs";
import { runBriefCommand } from "./brief-cli.mjs";
import { renderSkillBrief } from "./brief-renderer.mjs";
import { planGuardHookInstall } from "./control.mjs";
import { writeCheckedConfig } from "./control/config-write.mjs";
import { runInitCommand, runSetupCommand, runUninstallCommand } from "./lifecycle-cli.mjs";
import { migrateV2 } from "./migration/v2-transaction.mjs";
import { atomicWrite, optionalRead, withConfigLock } from "./migration/v2-files.mjs";
import { assertCurrentProjectionVersion } from "./compatibility.mjs";
import { renderRouteSectionLines } from "./route-renderer.mjs";
import { resolveUserStatePaths } from "./user-state-paths.mjs";
import { setSkillSharing } from "./shared-skill.mjs";
import { supportedAgentNames } from "./agent-skill-roots.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const APPLY_ACTION_VALUE_OPTIONS = new Set(["agent", "workflow", "intent", "dir", "config", "skills", "out", "skillboard-bin"]);
const COMMAND_USAGE = new Map([
  ["skill", ["enable|disable <skill-id> [--dry-run] [--json]", "share|unshare <skill-id> [--dry-run] [--json]", "preference <skill-id> --intent <term>[,<term>] --priority <integer> [--dry-run] [--json]", "forget <skill-id> [--dry-run] [--json]"]],
  ["setup", ["setup [--yes] [--agent codex[,claude,opencode,hermes]]"]],
  ["import-skill", ["import-skill --from <agent> --to <agent> --skill <id-or-dir> [--target-skill <id-or-dir>] [--adapted-file <path>] [--dry-run] [--yes] [--replace] [--json]"]],
  ["uninstall", ["uninstall --user (--dry-run|--yes) [--json]", "uninstall [--dir <path>] [--dry-run] [--keep-settings] [--purge] [--remove-config|--reset-config] [--remove-reports] [--remove-hooks] [--keep-empty-dirs] [--agent-layer] [--agent codex[,claude,opencode,hermes]]"]],
  [
    "inventory",
    [
      "inventory refresh [--dir <path>] [--config <path>] [--scan-root <dir>[,<dir>]] [--dry-run] [--json]",
      "inventory detect --unit <id> --config <path> [--install-output <path>] [--config-file a,b] [--source <value>] [--kind <kind>] [--scope <scope>] [--dry-run] [--json]"
    ]
  ],
  ["sources", ["sources refresh [--dir <path>] [--config <path>] [--unit <id>[,<id>]] [--cache-dir <dir>] [--dry-run] [--json]"]],
  ["import", ["import --profile <id-or-path> --source-root <dir> [--profile-dirs a,b] [--out <path>]", "import --profile <id-or-path> --source-root <dir> --config <path> --merge [--replace] [--dry-run]"]],
  ["scan", ["scan --config <path>"]],
  ["migrate", ["migrate v2 [--config <path>] [--skills <dir>] [--yes] [--rollback <backup>] [--json]"]],
  ["check", ["check --config <path> --skills <dir>"]],
  ["list", ["list [skills|workflows|harnesses|install-units] [--config <path>] [--skills <dir>] [--json]"]],
  ["explain", ["explain <skill-id> --config <path> --skills <dir> [--json]"]],
  ["can-use", ["can-use <skill-id> --agent codex|claude|opencode|hermes [--json]"]],
  ["audit", ["audit sources --config <path> --skills <dir> [--verify] [--json]"]],
  ["rollout", ["rollout [audit|plan|apply|rollback|report] [--dir <path>] [--config <path>] [--skills <dir>] [--transaction <id>] [--json]"]],
  ["hook", ["hook install --workflow <name> --config <path> --skills <dir> [--out <path>] [--skillboard-bin <path>] [--dry-run] [--json]"]],
  ["lock", ["lock write --config <path> --skills <dir> [--out <path>] [--replace] [--allow-unverified] [--json]"]],
  ["review", ["review is a v1 compatibility command; run migrate v2 before policy changes"]],
  ["add", ["add is a v1 compatibility command; run migrate v2, then use skill enable|disable|share|unshare|preference"]],
  ["variant", ["variant lifecycle is compatibility-only; keep relationships and checkpoints in content or inventory metadata"]],
  ["activate", ["activate is a v1 compatibility command; run migrate v2, then use skill enable"]],
  ["block", ["block is a v1 compatibility command; run migrate v2, then use skill disable"]],
  ["quarantine", ["quarantine is a v1 compatibility command; run migrate v2, then use skill disable"]],
  ["prefer", ["prefer is a v1 compatibility command; run migrate v2, then use skill preference"]],
  ["remove", ["remove skill <skill-id> --config <path> --skills <dir> [--force] [--dry-run] [--json]"]],
  ["dashboard", ["dashboard --config <path> --skills <dir> [--out <path>]"]],
  ["reconcile", ["reconcile --config <path> --skills <dir> [--actual-harnesses a,b] [--out <path>]"]],
  ["impact", ["impact disable <skill-id> --config <path> --skills <dir> [--out <path>] [--json]"]]
]);

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.stdout, process.stderr, process.stdin);
}

export async function main(argv, stdout, stderr, stdin = process.stdin) {
  try {
    return await run(argv, stdout, stderr, stdin);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}

async function run(argv, stdout, stderr, stdin) {
  const command = argv[0] ?? "help";
  const commandArgs = argv.slice(1);
  const options = parseOptions(commandArgs, command);
  const help = selectedHelpText(command, commandArgs, options);
  if (help !== null) {
    stdout.write(help);
    return 0;
  }
  switch (command) {
    case "setup":
      return await runSetupCommand(options, stdout, {
        cwd: process.cwd(),
        env: process.env,
        entrypointPath: process.argv[1],
        packageSpec: process.env.npm_config_package,
        stdin,
        stdout
      });
    case "import-skill":
      return await importSkillCommand(options, stdout);
    case "init":
      return await runInitCommand(options, stdout);
    case "uninstall":
      return await runUninstallCommand(options, stdout);
    case "inventory":
      return await inventory(argv.slice(1), options, stdout);
    case "sources":
      return await sources(argv.slice(1), options, stdout);
    case "import":
      return await importProfile(options, stdout);
    case "scan":
      return await scan(options, stdout);
    case "migrate":
      return await migrateCommand(argv.slice(1), options, stdout);
    case "check":
      return await check(options, stdout, stderr);
    case "doctor":
    case "status":
      return await doctor(options, stdout);
    case "brief":
      assertKnownOptions("brief", options, new Set(["agent", "workflow", "intent", "dir", "config", "skills", "include-actions", "verbose", "json"]));
      return await runBriefCommand(options, stdout, {
        configPath: configPath(options),
        skillsRoot: skillsRoot(options)
      });
    case "apply-action":
      return await applyActionCommand(argv.slice(1), options, stdout, stderr);
    case "skill":
      return await skillPolicy(argv.slice(1), options, stdout);
    case "list":
      return await list(argv.slice(1), options, stdout);
    case "explain":
      return await explain(argv.slice(1), options, stdout);
    case "route":
      return await route(argv.slice(1), options, stdout);
    case "can-use":
      return await canUse(argv.slice(1), options, stdout);
    case "guard":
      return await guard(argv.slice(1), options, stdout);
    case "audit":
      return await audit(argv.slice(1), options, stdout);
    case "hook":
      return await hook(argv.slice(1), options, stdout);
    case "lock":
      return await lock(argv.slice(1), options, stdout);
    case "review":
      return await review(argv.slice(1), options, stdout);
    case "rollout":
      return await rollout(argv.slice(1), options, stdout);
    case "activate":
      return await activate(argv.slice(1), options, stdout);
    case "add":
      return await add(argv.slice(1), options, stdout);
    case "variant":
      return await variant(argv.slice(1), options, stdout);
    case "block":
      return await block(argv.slice(1), options, stdout);
    case "quarantine":
      return await quarantine(argv.slice(1), options, stdout);
    case "prefer":
      return await prefer(argv.slice(1), options, stdout);
    case "remove":
      return await remove(argv.slice(1), options, stdout);
    case "dashboard":
      return await dashboard(options, stdout);
    case "reconcile":
      return await reconcile(options, stdout);
    case "impact":
      return await impact(argv.slice(1), options, stdout);
    case "help":
    case "--help":
    case "-h":
      stdout.write(helpText());
      return 0;
    case "--version":
    case "-v":
      stdout.write(`${VERSION}\n`);
      return 0;
    default:
      stderr.write(`Unknown command: ${command}\nRun skillboard help for usage.\n`);
      return 1;
  }
}

function selectedHelpText(command, args, options) {
  if (command === "help") {
    const topic = positionalArgs(args)[0];
    return topic === undefined ? helpText() : commandHelpText(topic) ?? helpText();
  }
  if (command === "--help" || command === "-h") {
    return helpText();
  }
  if (options.get("help") === "true" || args.includes("-h")) {
    return commandHelpText(command);
  }
  return null;
}

async function importProfile(options, stdout) {
  assertKnownOptions("import", options, new Set(["profile", "source-root", "profile-dirs", "merge", "out", "config", "skills", "replace", "dry-run", "json"]));
  const profileRef = options.get("profile");
  const sourceRoot = options.get("source-root");
  if (profileRef === undefined || sourceRoot === undefined) {
    throw new Error("Usage: skillboard import --profile <id-or-path> --source-root <dir>");
  }
  const profile = await loadSourceProfile(profileRef, { profileDirs: readCsv(options.get("profile-dirs")) });
  const imported = await importSource({ profile, sourceRoot });
  if (options.get("merge") === "true") {
    return await mergeImport(options, imported, stdout);
  }
  const fragment = renderImportFragment(imported);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(fragment);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, fragment, "utf8");
  stdout.write(`Import fragment written: ${out}\n`);
  return 0;
}

async function mergeImport(options, imported, stdout) {
  const path = configPath(options);
  const result = await withConfigLock(path, async () => {
    const originalBytes = await readFile(path);
    const originalText = originalBytes.toString("utf8");
    const originalMode = (await stat(path)).mode & 0o777;
    const merged = mergeImportFragment(originalText, imported, { replace: options.get("replace") === "true" });
    const document = YAML.parseDocument(merged.text);
    if (document.errors.length > 0) {
      throw new Error(`Invalid YAML config after import merge: ${document.errors.map((error) => error.message).join("; ")}`);
    }
    const inventoryPath = resolve(dirname(path), ".skillboard", "inventory.json");
    const previousInventory = document.get("version") === 2 ? await optionalRead(inventoryPath) : null;
    const previousInventoryMode = previousInventory === null ? null : (await stat(inventoryPath)).mode & 0o777;
    let inventoryText = null;
    if (document.get("version") === 2) {
      const added = await buildGeneratedInventory({
        skills: imported.skills,
        installUnits: [imported.installUnit]
      }, { root: dirname(path), home: process.env.HOME });
      inventoryText = mergeGeneratedInventory(previousInventory?.toString("utf8") ?? null, added, {
        replace: options.get("replace") === "true"
      });
    }
    const checked = await writeCheckedConfig(document, originalText, {
      configPath: path,
      skillsRoot: skillsRoot(options),
      dryRun: options.get("dry-run") === "true"
    }, "Import merged");
    if (inventoryText !== null && options.get("dry-run") !== "true") {
      try {
        await atomicWrite(inventoryPath, Buffer.from(inventoryText));
        await chmod(inventoryPath, 0o600);
        if (process.env.SKILLBOARD_IMPORT_FAILPOINT === "after-inventory-write") {
          throw new Error("Injected import failure after inventory write.");
        }
        await loadWorkspace({ configPath: path, skillsRoot: skillsRoot(options) });
      } catch (error) {
        await atomicWrite(path, originalBytes);
        await chmod(path, originalMode);
        if (previousInventory === null) await rm(inventoryPath, { force: true });
        else {
          await atomicWrite(inventoryPath, previousInventory);
          await chmod(inventoryPath, previousInventoryMode);
        }
        throw error;
      }
    }
    return {
      ...checked,
      addedSkills: merged.addedSkills,
      addedInstallUnits: merged.addedInstallUnits,
      replacedSkills: merged.replacedSkills,
      replacedInstallUnits: merged.replacedInstallUnits,
      inventoryPath: inventoryText === null ? null : ".skillboard/inventory.json"
    };
  });
  writeOutput(stdout, result, options, () => renderImportMerge(result));
  return 0;
}

async function importSkillCommand(options, stdout) {
  const result = await importAgentSkill({
    from: options.get("from"),
    to: options.get("to"),
    skill: options.get("skill"),
    targetSkill: options.get("target-skill"),
    adaptedFile: options.get("adapted-file"),
    dryRun: options.get("dry-run") === "true",
    yes: options.get("yes") === "true",
    replace: options.get("replace") === "true",
    env: process.env
  });
  writeOutput(stdout, result, options, () => renderImportAgentSkill(result));
  return result.status === "needs-adaptation" ? 2 : 0;
}

async function inventory(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] === "detect") {
    return await inventoryDetect(options, stdout);
  }
  if (args[0] !== "refresh") {
    throw new Error("Usage: skillboard inventory refresh|detect ...");
  }
  const allowedOptions = new Set(["dir", "config", "scan-root", "dry-run", "json", "help"]);
  const unknownOption = [...options.keys()].find((key) => !allowedOptions.has(key));
  if (unknownOption !== undefined) {
    throw new Error(`Unknown inventory refresh option: --${unknownOption}`);
  }
  const state = statePaths(options);
  const result = await refreshAgentInventory({
    root: options.get("dir") ?? dirname(state.configPath),
    configPath: state.configPath,
    roots: readCsv(options.get("scan-root")),
    dryRun: options.get("dry-run") === "true",
    home: state.home,
    env: process.env
  });
  writeOutput(stdout, result, options, () => renderInventoryRefresh(result));
  return 0;
}

async function inventoryDetect(options, stdout) {
  const result = await detectInstallOutput({
    root: options.get("dir") ?? ".",
    configPath: options.get("config"),
    unitId: options.get("unit"),
    installOutputPath: options.get("install-output"),
    configFiles: readCsv(options.get("config-file")),
    kind: options.get("kind"),
    source: options.get("source"),
    scope: options.get("scope"),
    dryRun: options.get("dry-run") === "true"
  });
  writeOutput(stdout, result, options, () => renderInstallDetection(result));
  return 0;
}

async function sources(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] !== "refresh") {
    throw new Error("Usage: skillboard sources refresh [--dir <path>] [--config <path>] [--unit <id>[,<id>]] [--cache-dir <dir>] [--dry-run] [--json]");
  }
  const result = await refreshSourcePins({
    root: options.get("dir") ?? ".",
    configPath: options.get("config"),
    cacheDir: options.get("cache-dir"),
    units: readCsv(options.get("unit")),
    dryRun: options.get("dry-run") === "true"
  });
  writeOutput(stdout, result, options, () => renderSourceRefresh(result));
  return 0;
}

async function scan(options, stdout) {
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  stdout.write(`${JSON.stringify(workspace, null, 2)}\n`);
  return 0;
}

async function check(options, stdout, stderr) {
  assertKnownOptions("check", options, new Set(["config", "skills", "json"]));
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = checkPolicy(workspace);
  const output = [...result.errors, ...result.warnings].join("\n");
  if (output.length > 0) {
    (result.ok ? stdout : stderr).write(`${output}\n`);
  }
  stdout.write(result.ok ? "Policy check passed\n" : "Policy check failed\n");
  return result.ok ? 0 : 1;
}

async function migrateCommand(argv, options, stdout) {
  const allowedOptions = new Set(["config", "skills", "yes", "rollback", "json", "help"]);
  const unknownOption = [...options.keys()].find((key) => !allowedOptions.has(key));
  if (unknownOption !== undefined) {
    throw new Error(`Unknown migrate option: --${unknownOption}`);
  }
  const args = argv.filter((arg) => !arg.startsWith("--"));
  if (args[0] !== "v2") {
    throw new Error("Usage: skillboard migrate v2 [--config <path>] [--skills <dir>] [--yes] [--rollback <backup>] [--json]");
  }
  if (options.has("yes") && options.has("rollback")) {
    throw new Error("Choose either --yes to apply migration or --rollback <backup>, not both.");
  }
  const result = await migrateV2({
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    apply: options.get("yes") === "true",
    rollbackPath: options.get("rollback"),
    failpoint: process.env.SKILLBOARD_MIGRATION_FAILPOINT
  });
  writeOutput(stdout, result, options, () => renderMigration(result));
  return 0;
}

async function doctor(options, stdout) {
  assertKnownOptions("doctor", options, new Set(["dir", "config", "skills", "strict", "verify", "summary", "json"]));
  const state = statePaths(options);
  const result = await doctorProject({
    root: options.get("dir") ?? dirname(state.configPath),
    configPath: state.configPath,
    skillsRoot: options.get("skills"),
    verifySources: options.get("verify") === "true"
  });
  const summary = options.get("summary") === "true";
  writeOutput(stdout, result, options, () => summary ? renderDoctorSummary(result) : renderDoctor(result));
  return (options.get("strict") === "true" ? result.strictOk : result.ok) ? 0 : 1;
}

async function applyActionCommand(argv, options, stdout, stderr) {
  try {
    assertKnownOptions("apply-action", options, new Set([
      "agent", "workflow", "intent", "dir", "config", "skills", "dry-run", "yes", "allow-destructive", "out", "skillboard-bin", "json"
    ]));
    const actionIds = positionalArgs(argv, APPLY_ACTION_VALUE_OPTIONS);
    if (actionIds.length !== 1) {
      throw new ApplyActionError(
        actionIds.length === 0 ? "missing-action-id" : "multiple-action-ids",
        "Usage: skillboard apply-action <action-id>; apply exactly one action at a time."
      );
    }
    const [actionId] = actionIds;
    const state = statePaths(options);
    const result = await applyAdvisorAction(actionId, {
      root: commandRoot(options),
      agent: options.get("agent"),
      workflow: options.get("workflow"),
      intent: options.get("intent"),
      configPath: configPath(options),
      inventoryPath: state.inventoryPath,
      home: state.home,
      env: process.env,
      skillsRoot: skillsRoot(options),
      dryRun: options.get("dry-run") === "true",
      yes: options.get("yes") === "true",
      allowDestructive: options.get("allow-destructive") === "true",
      hookOut: options.get("out"),
      skillboardBin: options.get("skillboard-bin")
    });
    writeOutput(stdout, result, options, () => renderApplyAction(result));
    return 0;
  } catch (error) {
    const payload = applyActionErrorPayload(error);
    if (jsonRequested(options, argv)) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      stderr.write(`${payload.error.message}\n`);
    }
    return 1;
  }
}

async function skillPolicy(argv, options, stdout) {
  assertKnownOptions("skill", options, new Set(["config", "skills", "dry-run", "json", "intent", "priority"]));
  const args = positionalArgs(argv);
  const operation = args[0];
  const skillId = args[1];
  if (skillId === undefined) throw new Error("Usage: skillboard skill enable|disable|share|unshare|preference|forget <skill-id>");
  const common = { skillId, configPath: configPath(options), skillsRoot: skillsRoot(options), dryRun: options.get("dry-run") === "true" };
  let result;
  if (operation === "enable" || operation === "disable") {
    result = await setV2SkillEnabled({ ...common, enabled: operation === "enable" });
  } else if (operation === "share" || operation === "unshare") {
    const state = statePaths(options);
    result = await setSkillSharing({
      ...common,
      shared: operation === "share",
      configPath: state.configPath,
      inventoryPath: state.inventoryPath,
      home: state.home,
      env: process.env
    });
    writeOutput(stdout, result, options, () => `${operation === "share" ? "Shared" : "Unshared"} ${skillId}\n`);
    return 0;
  } else if (operation === "preference") {
    const priority = Number(options.get("priority"));
    result = await setV2SkillPreference({ ...common, intents: readCsv(options.get("intent")), priority });
  } else if (operation === "forget") {
    const state = statePaths(options);
    result = await forgetV2Skill({
      ...common,
      configPath: state.configPath,
      inventoryPath: state.inventoryPath
    });
  } else {
    throw new Error(`Unknown skill policy operation: ${operation}`);
  }
  writeControlResult(stdout, result, options);
  return 0;
}

async function list(argv, options, stdout) {
  assertKnownOptions("list", options, new Set(["workflow", "config", "skills", "json"]));
  const kind = positionalArgs(argv)[0] ?? "skills";
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  let result;
  if (kind === "skills") {
    result = listSkills(workspace, { workflow: options.get("workflow") });
  } else if (kind === "workflows") {
    result = listWorkflows(workspace);
  } else if (kind === "harnesses") {
    result = listHarnesses(workspace);
  } else if (kind === "install-units") {
    result = listInstallUnits(workspace);
  } else {
    throw new Error("Usage: skillboard list [skills|workflows|harnesses|install-units]");
  }
  writeOutput(stdout, result, options, () => renderList(kind, result));
  return 0;
}

async function explain(argv, options, stdout) {
  assertKnownOptions("explain", options, new Set(["config", "skills", "json"]));
  const skillId = positionalArgs(argv)[0];
  if (skillId === undefined) {
    throw new Error("Usage: skillboard explain <skill-id>");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = explainSkill(workspace, skillId);
  writeOutput(stdout, result, options, () => renderExplain(result));
  return 0;
}

async function route(argv, options, stdout) {
  assertKnownOptions("route", options, new Set(["agent", "workflow", "config", "skills", "json"]));
  const intent = positionalArgs(argv).join(" ").trim();
  const workflow = options.get("workflow");
  if (intent.length === 0) {
    throw new Error("Usage: skillboard route <intent> [--agent <name>]");
  }
  const config = configPath(options);
  const skills = skillsRoot(options);
  const workspace = await loadWorkspace({ configPath: config, skillsRoot: skills });
  assertV2AgentOption(workspace, options, "skillboard route <intent> --agent <name>");
  if (workspace.version === 1 && workflow === undefined) {
    throw new Error("Usage: skillboard route <intent> --workflow <name>");
  }
  const result = routeSkill(workspace, {
    intent,
    workflow,
    agent: options.get("agent"),
    configPath: config,
    skillsRoot: skills
  });
  writeOutput(stdout, result, options, () => renderRoute(result));
  return 0;
}

async function canUse(argv, options, stdout) {
  assertKnownOptions("can-use", options, new Set(["agent", "workflow", "config", "skills", "json"]));
  const skillId = positionalArgs(argv)[0];
  const workflow = options.get("workflow");
  if (skillId === undefined) {
    throw new Error("Usage: skillboard can-use <skill-id> [--agent <name>]");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  assertV2AgentOption(workspace, options, "skillboard can-use <skill-id> --agent <name>");
  if (workspace.version === 1 && workflow === undefined) {
    throw new Error("Usage: skillboard can-use <skill-id> --workflow <name>");
  }
  const result = canUseSkill(workspace, skillId, workflow, options.get("agent"));
  writeOutput(stdout, result, options, () => renderCanUse(result));
  return result.allowed ? 0 : 2;
}

async function guard(argv, options, stdout) {
  assertKnownOptions("guard", options, new Set(["agent", "workflow", "config", "skills", "json", "hook-projection-version"]));
  const args = positionalArgs(argv);
  const skillId = args[0] === "use" ? args[1] : args[0];
  const workflow = options.get("workflow");
  if (skillId === undefined) {
    throw new Error("Usage: skillboard guard use <skill-id> [--agent <name>]");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const hookProjection = options.get("hook-projection-version") ?? process.env.SKILLBOARD_POLICY_PROJECTION_VERSION;
  if (args[0] !== "use" && hookProjection === undefined) {
    throw new Error("This pre-v2 policy projection is stale; regenerate the guard hook from version 2 policy.");
  }
  if (process.env.SKILLBOARD_SKILL_ID !== undefined && hookProjection === undefined) {
    throw new Error("This pre-v2 policy projection is stale; regenerate the guard hook from version 2 policy.");
  }
  assertCurrentProjectionVersion(hookProjection, workspace.version);
  assertV2AgentOption(workspace, options, "skillboard guard use <skill-id> --agent <name>");
  if (workspace.version === 1 && workflow === undefined) {
    throw new Error("Usage: skillboard guard use <skill-id> --workflow <name>");
  }
  const result = canUseSkill(workspace, skillId, workflow, options.get("agent"));
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write(result.allowed ? "allow\n" : `deny\n${result.reasons.map((reason) => `- ${reason}`).join("\n")}\n`);
  }
  return result.allowed ? 0 : 2;
}

async function audit(argv, options, stdout) {
  assertKnownOptions("audit", options, new Set(["verify", "config", "skills", "json"]));
  const args = positionalArgs(argv);
  if ((args[0] ?? "sources") !== "sources") {
    throw new Error("Usage: skillboard audit sources --config <path> --skills <dir> [--json]");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = options.get("verify") === "true"
    ? await verifySources(workspace, { configPath: configPath(options) })
    : auditSources(workspace);
  writeOutput(stdout, result, options, () => renderSourceAudit(result));
  return result.ok ? 0 : 1;
}

async function rollout(argv, options, stdout) {
  const action = positionalArgs(argv)[0] ?? "audit";
  const rolloutOptions = {
    root: options.get("dir") ?? ".",
    configPath: options.get("config"),
    skillsRoot: options.get("skills"),
    rolloutsDir: options.get("rollouts-dir"),
    transaction: options.get("transaction")
  };
  let result;
  if (action === "audit") {
    result = await rolloutAudit(rolloutOptions);
  } else if (action === "plan") {
    result = await rolloutPlan(rolloutOptions);
  } else if (action === "apply") {
    result = await rolloutApply(rolloutOptions);
  } else if (action === "rollback") {
    result = await rolloutRollback(rolloutOptions);
  } else if (action === "report") {
    result = await rolloutReport(rolloutOptions);
  } else {
    throw new Error("Usage: skillboard rollout [audit|plan|apply|rollback|report] [--dir <path>] [--config <path>] [--skills <dir>] [--json]");
  }
  writeOutput(stdout, result, options, () => renderRollout(result));
  return result.exitCode;
}

async function hook(argv, options, stdout) {
  assertKnownOptions("hook", options, new Set(["workflow", "out", "skillboard-bin", "config", "skills", "dry-run", "json"]));
  const args = positionalArgs(argv);
  if (args[0] !== "install") {
    throw new Error("Usage: skillboard hook install --workflow <name> [--out <path>] [--skillboard-bin <path>] [--dry-run]");
  }
  const workflow = options.get("workflow");
  if (workflow === undefined) {
    throw new Error("Usage: skillboard hook install --workflow <name> [--out <path>] [--skillboard-bin <path>] [--dry-run]");
  }
  const hookOptions = {
    workflow,
    out: options.get("out"),
    command: options.get("skillboard-bin"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options)
  };
  if (options.get("dry-run") === "true") {
    return await dryRunHookInstall(hookOptions, options, stdout);
  }
  return await applyHookInstall(hookOptions, options, stdout);
}

async function dryRunHookInstall(hookOptions, options, stdout) {
  let planned;
  try {
    planned = await planGuardHookInstall(hookOptions);
  } catch (error) {
    return writeHookInstallError(stdout, options, hookInstallError(error));
  }
  if (planned.target_exists) {
    return writeHookInstallError(stdout, options, {
      code: "hook_path_exists",
      message: `Refusing to overwrite existing hook path: ${planned.path}`
    }, planned);
  }
  const result = { ok: true, planned };
  writeOutput(stdout, result, options, () => renderHookInstallDryRun(result));
  return 0;
}

async function applyHookInstall(hookOptions, options, stdout) {
  let planned;
  try {
    planned = await planGuardHookInstall(hookOptions);
    if (planned.target_exists) {
      return writeHookInstallError(stdout, options, {
        code: "hook_path_exists",
        message: `Refusing to overwrite existing hook path: ${planned.path}`
      }, planned);
    }
    const result = await installGuardHook(hookOptions);
    writeOutput(stdout, result, options, () => `Installed guard hook: ${result.path}\n`);
    return 0;
  } catch (error) {
    return writeHookInstallError(stdout, options, hookInstallError(error), planned);
  }
}

async function lock(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] !== "write") {
    throw new Error("Usage: skillboard lock write --config <path> --skills <dir> [--out <path>] [--replace] [--allow-unverified] [--json]");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const out = options.get("out") ?? "skillboard.lock.yaml";
  const result = await writeLockfile(workspace, {
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    out,
    replace: options.get("replace") === "true",
    allowUnverified: options.get("allow-unverified") === "true"
  });
  writeOutput(stdout, result, options, () => `Lockfile written: ${result.path}\n`);
  return 0;
}

async function review(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] !== "install-unit" || args[1] === undefined) {
    throw new Error("Usage: skillboard review install-unit <unit-id> [--trust-level trusted|reviewed|unreviewed|blocked] --config <path> --skills <dir> [--dry-run] [--json]");
  }
  const result = await reviewInstallUnit({
    unitId: args[1],
    trustLevel: options.get("trust-level"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function activate(argv, options, stdout) {
  const skillId = positionalArgs(argv)[0];
  const workflow = options.get("workflow");
  if (skillId === undefined || workflow === undefined) {
    throw new Error("Usage: skillboard activate <skill-id> --workflow <name> [--mode manual-only|router-only|workflow-auto]");
  }
  const result = await activateSkill({
    skillId,
    workflow,
    mode: options.get("mode"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function add(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] === "workflow") {
    return await addWorkflowCommand(args, options, stdout);
  }
  if (args[0] === "harness") {
    return await addHarnessCommand(args, options, stdout);
  }
  if (args[0] !== "skill" || args[1] === undefined || options.get("path") === undefined) {
    throw new Error("Usage: skillboard add skill <skill-id> --path <relative-skill-path> --config <path> --skills <dir> [--workflow <name>] [--dry-run] [--json]");
  }
  const result = await addSkill({
    skillId: args[1],
    path: options.get("path"),
    status: options.get("status"),
    invocation: options.get("invocation"),
    exposure: options.get("exposure"),
    category: options.get("category"),
    ownerInstallUnit: options.get("owner-install-unit"),
    workflow: options.get("workflow"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function addWorkflowCommand(args, options, stdout) {
  const workflow = args[1];
  let harness = options.get("harness");
  if (workflow === undefined || harness === undefined) {
    if (workflow !== undefined && harness === undefined) {
      const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
      const available = workspace.harnesses.map((h) => h.name).sort();
      const hint = available.length === 0
        ? "No harnesses are configured yet. Add one with: skillboard add harness <name>"
        : `Available harnesses: ${available.join(", ")}`;
      throw new Error(`--harness is required for workflow "${workflow}".\n${hint}\n\nUsage: skillboard add workflow <workflow-name> --harness <harness-name> [--skill <id>[,<id>]] [--harness-status <status>] [--require-existing-harness] [--dry-run] [--json]`);
    }
    throw new Error("Usage: skillboard add workflow <workflow-name> --harness <harness-name> --config <path> --skills <dir> [--skill <id>[,<id>]] [--harness-status <status>] [--require-existing-harness] [--dry-run] [--json]");
  }
  const result = await addWorkflow({
    workflow,
    harness,
    skills: readCsv(options.get("skill")),
    harnessStatus: options.get("harness-status"),
    requireExistingHarness: options.get("require-existing-harness") === "true",
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function addHarnessCommand(args, options, stdout) {
  const harness = args[1];
  if (harness === undefined) {
    throw new Error("Usage: skillboard add harness <harness-name> --config <path> --skills <dir> [--status <status>] [--command <cmd>[,<cmd>]] [--dry-run] [--json]");
  }
  const result = await addHarness({
    harness,
    status: options.get("status"),
    commands: readCsv(options.get("command")),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function variant(argv, options, stdout) {
  try {
    assertKnownOptions("variant", options, new Set([
      "from", "capability", "workflow", "path", "mode", "category", "owner-install-unit",
      "adapted-for", "config", "skills", "to-base", "to-approved", "yes", "dry-run", "json"
    ]));
    return await runVariant(argv, options, stdout);
  } catch (error) {
    const payload = variantErrorPayload(error);
    if (options.get("json") === "true") {
      stdout.write(`${JSON.stringify({ ok: false, error: payload.error }, null, 2)}\n`);
      return payload.exitCode;
    }
    throw Object.assign(new Error(payload.error.message), { exitCode: payload.exitCode });
  }
}

async function runVariant(argv, options, stdout) {
  const args = positionalArgs(argv);
  const subcommand = args[0];
  if (options.get("config") !== undefined && ["add", "fork", "status", "approve", "reset"].includes(subcommand)) {
    await assertVariantPolicyBoundary(configPath(options), subcommand);
  }
  if (subcommand === "add") {
    return await variantAddCommand(args, options, stdout);
  }
  if (subcommand === "fork") {
    return await variantForkCommand(args, options, stdout);
  }
  if (subcommand === "status") {
    return await variantStatusCommand(args, options, stdout);
  }
  if (subcommand === "approve") {
    return await variantApproveCommand(args, options, stdout);
  }
  if (subcommand === "reset") {
    return await variantResetCommand(args, options, stdout);
  }
  throw new VariantCliError("unknown_variant_subcommand", `Unknown variant subcommand: ${subcommand ?? "<missing>"}`, 2);
}

async function assertVariantPolicyBoundary(path, subcommand) {
  const document = YAML.parseDocument(await readFile(path, "utf8"));
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML config: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  if (document.get("version") === 2 && subcommand !== "status") {
    throw new VariantCliError(
      "compatibility_error",
      "Variant policy mutation is unavailable for version 2; use skill enable, disable, share, unshare, or preference. Read-only variant status remains available.",
      1
    );
  }
}

async function variantAddCommand(args, options, stdout) {
  const variantId = args[1];
  const baseId = options.get("from");
  const capability = options.get("capability");
  const workflow = options.get("workflow");
  if (variantId === undefined || baseId === undefined || capability === undefined || workflow === undefined) {
    throw new VariantCliError("usage_error", variantAddUsage(), 2);
  }
  const result = await addSkillVariant({
    variantId,
    baseId,
    capability,
    workflow,
    path: options.get("path"),
    mode: options.get("mode"),
    category: options.get("category"),
    ownerInstallUnit: options.get("owner-install-unit"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function variantForkCommand(args, options, stdout) {
  const variantId = args[1];
  const baseId = options.get("from");
  const capability = options.get("capability");
  const workflow = options.get("workflow");
  if (variantId === undefined || baseId === undefined || capability === undefined || workflow === undefined || options.get("path") === undefined) {
    throw new VariantCliError("usage_error", variantForkUsage(), 2);
  }
  const result = await forkSkillVariant({
    variantId,
    baseId,
    capability,
    workflow,
    path: options.get("path"),
    adaptedFor: options.get("adapted-for"),
    category: options.get("category"),
    ownerInstallUnit: options.get("owner-install-unit"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeLifecycleResult(stdout, result, options);
  return 0;
}

async function variantStatusCommand(args, options, stdout) {
  const variantId = args[1];
  if (variantId === undefined) {
    throw new VariantCliError("usage_error", "Usage: skillboard variant status <variant-id> --config <path> --skills <dir> [--json]", 2);
  }
  const result = await variantLifecycleStatus({ variantId, configPath: configPath(options), skillsRoot: skillsRoot(options) });
  writeOutput(stdout, result, options, () => renderVariantStatus(result));
  return 0;
}

async function variantApproveCommand(args, options, stdout) {
  const variantId = args[1];
  if (variantId === undefined) {
    throw new VariantCliError("usage_error", "Usage: skillboard variant approve <variant-id> --config <path> --skills <dir> [--mode manual-only|router-only|workflow-auto] [--dry-run] [--json]", 2);
  }
  const result = await approveSkillVariant({
    variantId,
    mode: options.get("mode"),
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeLifecycleResult(stdout, result, options);
  return 0;
}

async function variantResetCommand(args, options, stdout) {
  const variantId = args[1];
  if (variantId === undefined) {
    throw new VariantCliError("usage_error", "Usage: skillboard variant reset <variant-id> --to-base|--to-approved --config <path> --skills <dir> [--yes] [--dry-run] [--mode manual-only|router-only|workflow-auto] [--json]", 2);
  }
  const result = await resetSkillVariant({
    variantId,
    toBase: options.get("to-base") === "true",
    toApproved: options.get("to-approved") === "true",
    mode: options.get("mode"),
    yes: options.get("yes") === "true",
    dryRun: options.get("dry-run") === "true",
    configPath: configPath(options),
    skillsRoot: skillsRoot(options)
  });
  writeLifecycleResult(stdout, result, options);
  return 0;
}

function variantAddUsage() {
  return "Usage: skillboard variant add <variant-id> --from <base-id> --capability <name> --workflow <name> --config <path> --skills <dir> [--path <relative-skill-path>] [--mode manual-only|router-only|workflow-auto] [--category <name>] [--owner-install-unit <unit-id>] [--dry-run] [--json]";
}

function variantForkUsage() {
  return "Usage: skillboard variant fork <variant-id> --from <base-id> --capability <name> --workflow <name> --path <relative-skill-path> --config <path> --skills <dir> [--adapted-for <label>] [--category <name>] [--owner-install-unit <unit-id>] [--dry-run] [--json]";
}

class VariantCliError extends Error {
  constructor(code, message, exitCode) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function variantErrorPayload(error) {
  if (error instanceof VariantCliError) {
    return { exitCode: error.exitCode, error: { code: error.code, message: error.message } };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.startsWith("Usage:")
    || message.includes("requires exactly one of --to-base or --to-approved")
    || message.includes("requires --mode manual-only")
  ) {
    return { exitCode: 2, error: { code: "usage_error", message } };
  }
  if (message.includes("requires --yes")) {
    return { exitCode: 1, error: { code: "confirmation_required", message } };
  }
  if (message.toLowerCase().includes("snapshot")) {
    return { exitCode: 1, error: { code: "snapshot_error", message } };
  }
  if (message.toLowerCase().includes("symlink") || message.toLowerCase().includes("path")) {
    return { exitCode: 1, error: { code: "path_error", message } };
  }
  return { exitCode: 1, error: { code: "lifecycle_error", message } };
}

function writeLifecycleResult(stdout, result, options) {
  const warnings = result.warnings ?? result.policy?.warnings ?? [];
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify({
      message: result.message,
      dryRun: result.dryRun,
      changed: result.changed,
      plan: result.plan,
      filePlan: result.filePlan ?? [],
      skill: result.skill,
      variant: result.variant,
      warnings
    }, null, 2)}\n`);
    return;
  }
  stdout.write(`${result.dryRun ? "Dry run: " : ""}${result.message}\n`);
  stdout.write(renderChangePlan(result.plan));
  stdout.write(renderFilePlan(result.filePlan ?? []));
  if (warnings.length > 0) {
    stdout.write(`${warnings.join("\n")}\n`);
  }
}

function renderFilePlan(filePlan) {
  if (filePlan.length === 0) {
    return "File operations: none\n";
  }
  return `File operations:\n${filePlan.map((item) => `- ${item.operation ?? "write"} ${item.path ?? item.target ?? "unknown"}`).join("\n")}\n`;
}

function renderVariantStatus(result) {
  return [
    `Variant ${result.skill}: ${result.computedStatus}`,
    `Live digest: ${result.liveDigest ?? "missing"}`,
    `Base digest: ${result.baseDigest}`,
    `Approved digest: ${result.approvedDigest ?? "none"}`,
    `Live file: ${result.files.live.path}`,
    `Base snapshot: ${result.files.baseSnapshot.path}`,
    `Approved snapshot: ${result.files.approvedSnapshot?.path ?? "none"}`,
    `Warnings: ${result.warnings.length === 0 ? "none" : result.warnings.join("; ")}`,
    ""
  ].join("\n");
}

async function block(argv, options, stdout) {
  const skillId = positionalArgs(argv)[0];
  const workflow = options.get("workflow");
  if (skillId === undefined || workflow === undefined) {
    throw new Error("Usage: skillboard block <skill-id> --workflow <name>");
  }
  const result = await blockSkill({
    skillId,
    workflow,
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function quarantine(argv, options, stdout) {
  const skillId = positionalArgs(argv)[0];
  if (skillId === undefined) {
    throw new Error("Usage: skillboard quarantine <skill-id>");
  }
  const result = await quarantineSkill({
    skillId,
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function prefer(argv, options, stdout) {
  const skillId = positionalArgs(argv)[0];
  const workflow = options.get("workflow");
  const capability = options.get("capability");
  if (skillId === undefined || workflow === undefined || capability === undefined) {
    throw new Error("Usage: skillboard prefer <skill-id> --workflow <name> --capability <name>");
  }
  const result = await preferSkill({
    skillId,
    workflow,
    capability,
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function remove(argv, options, stdout) {
  const args = positionalArgs(argv);
  if (args[0] !== "skill" || args[1] === undefined) {
    throw new Error("Usage: skillboard remove skill <skill-id> --config <path> --skills <dir> [--force] [--dry-run] [--json]");
  }
  const result = await removeSkill({
    skillId: args[1],
    force: options.get("force") === "true",
    configPath: configPath(options),
    skillsRoot: skillsRoot(options),
    dryRun: options.get("dry-run") === "true"
  });
  writeControlResult(stdout, result, options);
  return 0;
}

async function dashboard(options, stdout) {
  assertKnownOptions("dashboard", options, new Set(["config", "skills", "out", "json"]));
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const markdown = renderDashboard(workspace);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(markdown);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  stdout.write(`Dashboard written: ${out}\n`);
  return 0;
}

async function reconcile(options, stdout) {
  assertKnownOptions("reconcile", options, new Set(["config", "skills", "actual-harnesses", "out", "json"]));
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const plan = reconcileWorkspace(workspace, { actualHarnesses: readCsv(options.get("actual-harnesses")) });
  const markdown = renderReconcilePlan(plan);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(markdown);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  stdout.write(`Reconcile plan written: ${out}\n`);
  return 0;
}

async function impact(argv, options, stdout) {
  assertKnownOptions("impact", options, new Set(["config", "skills", "out", "json"]));
  if (argv[0] !== "disable" || argv[1] === undefined) {
    throw new Error("Usage: skillboard impact disable <skill-id>");
  }
  const workspace = await loadWorkspace({ configPath: configPath(options), skillsRoot: skillsRoot(options) });
  const result = impactDisable(workspace, argv[1]);
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const markdown = renderImpact(result);
  const out = options.get("out");
  if (out === undefined) {
    stdout.write(markdown);
    return 0;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  stdout.write(`Impact report written: ${out}\n`);
  return 0;
}

function renderImpact(result) {
  return [
    `# Disable Impact: ${result.skillId}`,
    "",
    `- Found: \`${result.exists}\``,
    `- Risk: ${result.risk}`,
    `- Affected workflows: ${formatList(result.affectedWorkflows)}`,
    `- Affected required outputs: ${formatList(result.affectedOutputs)}`,
    `- Alternatives: ${formatList(result.alternatives)}`,
    `- Conflicting skills: ${formatList(result.conflictingSkills ?? [])}`,
    `- Active conflicts: ${formatActiveConflicts(result.activeConflicts ?? [])}`,
    ""
  ].join("\n");
}

function formatActiveConflicts(entries) {
  if (entries.length === 0) {
    return "none";
  }
  return entries
    .map((entry) => `\`${entry.workflow}:${entry.skill}<->${entry.conflictingSkill}\``)
    .join(", ");
}

function configPath(options) {
  return statePaths(options).configPath;
}

function skillsRoot(options) {
  return options.get("skills");
}

function commandRoot(options) {
  return options.get("dir") ?? dirname(configPath(options));
}

function statePaths(options) {
  const dir = options.get("dir");
  return resolveUserStatePaths({
    env: process.env,
    cwd: process.cwd(),
    configPath: options.get("config") ?? (dir === undefined ? undefined : resolve(dir, "skillboard.config.yaml"))
  });
}

function assertV2AgentOption(workspace, options, usage) {
  if (workspace.version !== 2) return;
  const agent = options.get("agent");
  if (agent === undefined) {
    throw new Error(`Version 2 availability requires --agent. Usage: ${usage}`);
  }
  if (!supportedAgentNames().includes(agent)) {
    throw new Error(`Unsupported agent: ${agent}. Expected one of: ${supportedAgentNames().join(", ")}.`);
  }
}

const VALUE_OPTIONS = new Set([
  "actual-harnesses", "adapted-file", "adapted-for", "agent", "cache-dir", "capability", "category",
  "command", "config", "config-file", "dir", "exposure", "from", "harness", "harness-status",
  "hook-projection-version", "install-output", "intent", "invocation", "kind", "mode", "out",
  "owner-install-unit", "path", "priority", "profile", "profile-dirs", "rollback", "rollouts-dir",
  "scan-root", "scope", "skill", "skillboard-bin", "skills", "source", "source-root", "status",
  "target-skill", "to", "transaction", "trust-level", "unit", "workflow"
]);

function parseOptions(args, command) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      if (VALUE_OPTIONS.has(key)) throw new Error(`Missing value for ${command} option: --${key}`);
      options.set(key, "true");
      continue;
    }
    options.set(key, value);
    index += 1;
  }
  return options;
}

function assertKnownOptions(command, options, allowed) {
  for (const option of options.keys()) {
    if (!allowed.has(option)) {
      throw new Error(`Unknown ${command} option: --${option}`);
    }
  }
}

function formatList(values) {
  return values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", ");
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

function readCsv(value) {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function renderImportMerge(result) {
  const lines = [
    `${result.dryRun ? "Dry run: " : ""}${result.message}`,
    renderChangePlan(result.plan).trimEnd(),
    `Skills: ${formatList(result.addedSkills)}`,
    `Install units: ${formatList(result.addedInstallUnits)}`
  ];
  if (result.replacedSkills.length > 0 || result.replacedInstallUnits.length > 0) {
    lines.push(`Replaced skills: ${formatList(result.replacedSkills)}`);
    lines.push(`Replaced install units: ${formatList(result.replacedInstallUnits)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderInventoryRefresh(result) {
  const lines = [
    `${result.dryRun ? "Dry run: " : ""}Inventory refreshed: ${result.configPath}`,
    ...(result.bootstrappedV2 ? ["Bootstrapped minimal SkillBoard v2 policy."] : []),
    renderChangePlan(result.plan).trimEnd(),
    `Scanned skills: ${result.scan.scannedSkills}`,
    `Scanned install units: ${result.scan.scannedInstallUnits}`,
    `Added skills: ${formatList(result.scan.addedSkills)}`,
    `Added install units: ${formatList(result.scan.addedInstallUnits)}`,
    `Updated install units: ${formatList(result.scan.updatedInstallUnits)}`,
    `Added workflows: ${formatList(result.scan.addedWorkflows ?? [])}`,
    `Added harnesses: ${formatList(result.scan.addedHarnesses ?? [])}`,
    `Skipped existing skills: ${formatList(result.scan.skippedSkills)}`,
    `Review notes: ${formatList(result.scan.reviewNotes ?? [])}`,
    `Scan warnings: ${formatList(result.scan.warnings ?? [])}`,
    ""
  ];
  return lines.join("\n");
}

function renderInstallDetection(result) {
  return [
    `${result.dryRun ? "Dry run: " : ""}Detected install metadata: ${result.unitId}`,
    renderChangePlan(result.plan).trimEnd(),
    `Commands: ${formatList(result.detected.commands)}`,
    `Hooks: ${formatList(result.detected.hooks)}`,
    `MCP servers: ${formatList(result.detected.mcpServers)}`,
    `Modified config files: ${formatList(result.detected.modifiedConfigFiles)}`,
    `Changed fields: ${formatList(result.changedFields)}`,
    ""
  ].join("\n");
}

function renderSourceRefresh(result) {
  const lines = [
    `${result.dryRun ? "Dry run: " : ""}Source pins refreshed: ${result.configPath}`,
    renderChangePlan(result.plan).trimEnd(),
    `Refreshed units: ${formatList(result.refreshed.map((unit) => unit.id))}`
  ];
  if (result.skipped.length > 0) {
    lines.push(`Skipped units: ${formatList(result.skipped.map((unit) => `${unit.id}:${unit.reason}`))}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderChangePlan(plan) {
  const lines = [
    `Changed: ${plan.changed}`,
    `Changed line positions: ${plan.changedLineCount}`
  ];
  if (plan.semanticAvailable) {
    const suffix = plan.semanticTruncated ? " (truncated)" : "";
    lines.push(`Semantic changes: ${plan.semanticChangeCount}${suffix}`);
    for (const change of plan.semanticChanges.slice(0, 10)) {
      lines.push(`- ${change.type} ${change.path}: ${change.before} -> ${change.after}`);
    }
  } else {
    lines.push(`Semantic changes: unavailable (${plan.semanticError})`);
  }
  return `${lines.join("\n")}\n`;
}

function renderApplyAction(result) {
  if (result.mode === "preview") {
    return [
      `Preview action: ${result.action.id}`,
      "Changed: false",
      "Re-run with --yes to apply.",
      ""
    ].join("\n");
  }
  return [
    `Applied action: ${result.action.id}`,
    `Changed: ${result.changed}`,
    "",
    "Returned post-apply brief:",
    "",
    renderSkillBrief(result.brief)
  ].join("\n");
}

function positionalArgs(args, valueOptions = null) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      values.push(arg);
      continue;
    }
    const value = args[index + 1];
    const optionName = arg.slice(2);
    if ((valueOptions === null || valueOptions.has(optionName)) && value !== undefined && !value.startsWith("--")) {
      index += 1;
    }
  }
  return values;
}

function jsonRequested(options, argv) {
  return options.get("json") === "true" || argv.includes("--json");
}

function writeOutput(stdout, value, options, renderText) {
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  stdout.write(renderText());
}

function writeControlResult(stdout, result, options) {
  const warnings = result.policy.warnings;
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify({
      message: result.message,
      dryRun: result.dryRun,
      changed: result.changed,
      plan: result.plan,
      warnings
    }, null, 2)}\n`);
    return;
  }
  stdout.write(`${result.dryRun ? "Dry run: " : ""}${result.message}\n`);
  stdout.write(renderChangePlan(result.plan));
  if (warnings.length > 0) {
    stdout.write(`${warnings.join("\n")}\n`);
  }
}

function writeHookInstallError(stdout, options, error, planned) {
  if (options.get("json") === "true") {
    stdout.write(`${JSON.stringify({
      ok: false,
      error,
      ...(planned === undefined ? {} : { planned })
    }, null, 2)}\n`);
    return 1;
  }
  throw new Error(error.message);
}

function hookInstallError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Unknown workflow:")) {
    return { code: "unknown_workflow", message };
  }
  if (message.startsWith("Refusing to overwrite existing hook path:")) {
    return { code: "hook_path_exists", message };
  }
  if (message.startsWith("Unsupported config version:")
    || message.includes("config root")
    || message.includes("must be a")
    || message.includes("Invalid YAML")) {
    return { code: "invalid_config", message };
  }
  if (error?.code === "ENOENT") {
    return { code: "missing_config", message };
  }
  return { code: "hook_install_failed", message };
}

function renderHookInstallDryRun(result) {
  return [
    "Dry run: would install guard hook",
    `Path: ${result.planned.path}`,
    `Workflow: ${result.planned.workflow}`,
    `Command: ${result.planned.command}`,
    `Target exists: ${result.planned.target_exists}`,
    `Planned mode: ${result.planned.planned_mode} (${result.planned.permissions})`,
    `Would be executable: ${result.planned.would_be_executable}`,
    `Preview: ${result.planned.preview.display}`,
    ""
  ].join("\n");
}

function renderList(kind, values) {
  if (values.length === 0) {
    return `${kind}: none\n`;
  }
  if (kind === "skills") {
    return `${values.map((skill) => {
      if (typeof skill.enabled === "boolean") {
        const inventory = skill.inventory ?? { path: skill.path ?? null, owner_install_unit: null };
        return `${skill.id}\tenabled=${skill.enabled}\tshared=${skill.shared}\tagents=${(inventory.installed_on ?? []).join(",") || "none"}\tpath=${inventory.path ?? "none"}\towner=${inventory.owner_install_unit ?? "none"}`;
      }
      const roles = skill.workflowRoles.length === 0 ? "none" : skill.workflowRoles.join(",");
      const owner = skill.ownerInstallUnit ?? "direct";
      return `${skill.id}\t${skill.status}\t${skill.invocation}\t${skill.sourceClass}\towner=${owner}\troles=${roles}`;
    }).join("\n")}\n`;
  }
  if (kind === "workflows") {
    return `${values.map((workflow) => {
      return `${workflow.name}\tharness=${workflow.harness}\tactive=${workflow.activeSkills.length}\tblocked=${workflow.blockedSkills.length}\tcapabilities=${workflow.requiredCapabilities.join(",") || "none"}`;
    }).join("\n")}\n`;
  }
  if (kind === "harnesses") {
    return `${values.map((harness) => {
      return `${harness.name}\t${harness.status}\tworkflows=${harness.workflows.join(",") || "none"}\tcommands=${harness.commands.join(",") || "none"}`;
    }).join("\n")}\n`;
  }
  return `${values.map((unit) => {
    return `${unit.id}\t${unit.kind}\t${unit.sourceClass}\tpriority=${unit.priority}\ttrust=${unit.trustLevel}\tenabled=${unit.enabled}\tskills=${unit.skills.length}\trisk=${unit.permissionRisk}`;
  }).join("\n")}\n`;
}

function renderExplain(result) {
  if (typeof result.enabled === "boolean") {
    const inventory = result.inventory ?? { path: result.path ?? null, owner_install_unit: null };
    return [
      `Skill: ${result.id}`,
      `Enabled: ${result.enabled}`,
      `Shared: ${result.shared}`,
      `Installed on: ${(inventory.installed_on ?? []).join(", ") || "none"}`,
      `Inventory path: ${inventory.path ?? "none"}`,
      `Inventory owner: ${inventory.owner_install_unit ?? "none"}`,
      ""
    ].join("\n");
  }
  const workflows = result.workflows.length === 0
    ? "none"
    : result.workflows.map((workflow) => `${workflow.workflow}:${workflow.roles.join(",")}`).join(", ");
  const capabilities = result.capabilities.length === 0
    ? "none"
    : result.capabilities.map((capability) => `${capability.name}:${capability.role}`).join(", ");
  return [
    `Skill: ${result.id}`,
    `Status: ${result.status}`,
    `Invocation: ${result.invocation}`,
    `Source: ${result.source.class} (${result.source.detail})`,
    `Trust: ${result.trust.level}${result.trust.pinned ? ", pinned" : ""}${result.trust.signed ? ", signed" : ""}`,
    `Owner install unit: ${result.ownerInstallUnit ?? "direct"}`,
    `Workflows: ${workflows}`,
    `Capabilities: ${capabilities}`,
    `Replaced by: ${result.replacedBy ?? "none"}`,
    ""
  ].join("\n");
}

function renderCanUse(result) {
  const lines = [
    `Allowed: ${result.allowed}`,
    `Automatic allowed: ${result.automaticAllowed}`,
    `Skill: ${result.skill}`,
    `Workflow: ${result.workflow}`,
    `Invocation: ${result.invocation ?? "unknown"}`,
    `Trust: ${result.trust === null ? "unknown" : result.trust.level}`,
    `Roles: ${result.roles.length === 0 ? "none" : result.roles.join(", ")}`
  ];
  if (result.allowed) {
    lines.push("Allowed use: disclose the skill at the start and completion; do not ask for another approval.");
  }
  if (result.reasons.length > 0) {
    lines.push("Reasons:");
    for (const reason of result.reasons) {
      lines.push(`- ${reason}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderRoute(result) {
  const lines = renderRouteSectionLines(result, { format: "cli", includeWorkflow: true });
  if (result.matched_capability === null) {
    lines.push("Possible skills:");
    for (const skill of result.possible_skills.slice(0, 5)) {
      lines.push(`- ${skill.id} (${skill.category ?? "uncategorized"}, allowed=${skill.allowed})`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderMigration(result) {
  const lines = [
    `SkillBoard v2 migration: ${result.mode}`,
    `Changed: ${result.changed}`,
    `Target version: ${result.target_version}`,
    `Input SHA-256: ${result.input_sha256}`,
    `Config SHA-256: ${result.config_sha256}`
  ];
  if (result.inventory_sha256 !== null) lines.push(`Inventory SHA-256: ${result.inventory_sha256}`);
  if (result.backup !== null) lines.push(`Backup: ${result.backup}`);
  if (result.counts !== undefined) {
    lines.push(`Skills: ${result.counts.skills} (${result.counts.enabled} enabled, ${result.counts.disabled} disabled)`);
    lines.push(`Warnings: ${result.counts.warnings}; losses: ${result.counts.losses}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderSourceAudit(result) {
  const lines = [
    `Source audit: ${result.ok ? "passed" : "failed"}`,
    `Errors: ${result.errors.length}`,
    `Warnings: ${result.warnings.length}`
  ];
  for (const unit of result.units) {
    const findings = unit.findings.length === 0
      ? "ok"
      : unit.findings.map((finding) => `${finding.severity}:${finding.message}`).join("; ");
    const pinned = unit.pinned ?? unit.digestVerified ?? false;
    const signed = unit.signed ?? unit.signatureVerified ?? false;
    const status = unit.status === undefined ? "" : `\tstatus=${unit.status}`;
    lines.push(`${unit.id}\t${unit.sourceClass}\ttrust=${unit.trustLevel}\trisk=${unit.permissionRisk}\tpinned=${pinned}\tsigned=${signed}${status}\t${findings}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderRollout(result) {
  const lines = [
    `SkillBoard rollout: ${result.status}`,
    `Command: ${result.command}`,
    `Exit code: ${result.exitCode}`,
    `Non-interactive: ${result.nonInteractive}`,
    `Summary: policyErrors=${result.summary.policyErrors}, sourceErrors=${result.summary.sourceErrors}, sourceWarnings=${result.summary.sourceWarnings}, blockingWarnings=${result.summary.blockingWarnings}`,
    `Fleet: healthy=${result.fleet.byStatus.healthy}, safe-mode=${result.fleet.byStatus["safe-mode"]}, strict-failed=${result.fleet.byStatus["strict-failed"]}, apply-failed=${result.fleet.byStatus["apply-failed"]}, rollback-needed=${result.fleet.byStatus["rollback-needed"]}`
  ];
  if (result.transaction !== undefined) {
    lines.push(`Transaction: ${result.transaction.state}${result.transaction.id === undefined ? "" : ` ${result.transaction.id}`}`);
  }
  if (result.errors.length > 0) {
    lines.push("Errors:");
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderDoctorSummary(result) {
  const status = result.ok ? result.reviewRequired ? "safe mode, review needed" : "passed" : "needs attention";
  const lines = [
    `SkillBoard doctor: ${status}`,
    `Workspace: ${result.workspace.skills.declared} skills, ${result.workspace.workflows} workflows, ${result.workspace.harnesses} harnesses, ${result.workspace.installUnits.total} install units`,
    `Source audit: ${result.sources.ok ? "passed" : "failed"} (${result.sources.errors.length} errors, ${result.sources.warnings.length} warnings, ${result.sources.blockingWarnings.length} blocking)`,
    `Policy: ${result.policy.ok ? "passed" : "failed"} (${result.policy.errors.length} errors, ${result.policy.warnings.length} warnings)`
  ];
  const concerns = [
    ...result.sources.blockingWarnings.slice(0, 3).map((w) => `Blocking: ${w}`),
    ...result.sources.warnings.slice(0, 3).map((w) => `Warning: ${w}`),
    ...result.policy.errors.slice(0, 3).map((e) => `Policy error: ${e}`),
    ...result.policy.warnings.slice(0, 3).map((w) => `Policy warning: ${w}`)
  ];
  if (concerns.length > 0) {
    lines.push("Top concerns:");
    for (const concern of concerns) {
      lines.push(`- ${concern}`);
    }
  }
  appendNotInitializedAttachGuidance(lines, result);
  if (result.recommendations.length > 0) {
    lines.push("Recommendations:");
    for (const recommendation of result.recommendations.slice(0, 3)) {
      lines.push(`- ${recommendation}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderDoctor(result) {
  const bridges = result.bridges.map((bridge) => `${bridge.file}=${bridge.status}`).join(", ");
  const sourceMode = result.sources.verified ? "verified" : "audit";
  const status = result.ok ? result.reviewRequired ? "safe mode, review needed" : "passed" : "needs attention";
  const lines = [
    `SkillBoard doctor: ${status}`,
    `Root: ${result.root}`,
    `Config: ${result.config.exists ? result.config.valid ? `valid v${result.config.version}` : `invalid (${result.config.error})` : "missing"}`,
    `Bridge: ${bridges}`,
    `Workspace: ${result.workspace.skills.declared} declared skills, ${result.workspace.skills.installed} installed skills, ${result.workspace.workflows} workflows, ${result.workspace.harnesses} harnesses, ${result.workspace.installUnits.total} install units`,
    `Skill states: ${renderCounts(result.workspace.skills.byStatus)}`,
    `Invocations: ${renderCounts(result.workspace.skills.byInvocation)}`,
    `Source classes: ${renderCounts(result.workspace.installUnits.bySourceClass)}`,
    `Source ${sourceMode}: ${result.sources.ok ? "passed" : "failed"} (${result.sources.errors.length} errors, ${result.sources.warnings.length} warnings, ${result.sources.blockingWarnings.length} blocking warnings)`,
    `Policy: ${result.policy.ok ? "passed" : "failed"} (${result.policy.errors.length} errors, ${result.policy.warnings.length} warnings)`,
    `Strict gate: ${result.strictOk ? "passed" : "review needed"}`,
    `Review required: ${result.reviewRequired}`,
    `High-risk install units: ${formatList(result.workspace.installUnits.highRisk)}`,
    `Runtime extension units: ${formatList(result.workspace.installUnits.runtimeExtensions)}`,
    `Uninstall dry run: remove ${result.uninstall.removed.length}, update ${result.uninstall.updated.length}, preserve ${result.uninstall.preserved.length}`
  ];
  appendNotInitializedAttachGuidance(lines, result);
  if (result.recommendations.length > 0) {
    lines.push("Recommendations:");
    for (const recommendation of result.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function appendNotInitializedAttachGuidance(lines, result) {
  if (result.mode !== "not-initialized") {
    return;
  }
  lines.push("SkillBoard state:");
  lines.push("- No local SkillBoard policy file was found in this directory.");
  lines.push("- That is OK: project management belongs to the agent/workspace layer.");
  lines.push("- Global install normally runs agent setup automatically; run skillboard setup later only after adding another supported agent or if install scripts were skipped.");
}

function renderCounts(counts) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  return entries.length === 0
    ? "none"
    : entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

function helpText() {
  return [
    "SkillBoard - permissive AI skill overlap routing",
    "Version: see skillboard --version",
    "",
    "After global install:",
    "  npm install -g agent-skillboard",
    "  sudo npm install -g agent-skillboard is also supported when system npm requires it.",
    "  The package postinstall auto-runs agent-layer guidance setup on install and update.",
    "  Under sudo, setup targets SUDO_USER's agent homes while npm still controls the binary prefix.",
    "  Run skillboard setup later after adding another supported agent or when install scripts were skipped.",
    "  Preview skillboard uninstall --user --dry-run before package removal to clean every managed artifact.",
    "",
    "Core AI/automation operations:",
    "  setup [--yes] [--agent codex[,claude,opencode,hermes]]",
    "  import-skill --from <agent> --to <agent> --skill <id-or-dir> [--target-skill <id-or-dir>] [--adapted-file <path>] [--dry-run] [--yes] [--replace] [--json]",
    "  uninstall --user (--dry-run|--yes) [--json]",
    "  inventory refresh [--dir <path>] [--config <path>] [--scan-root <dir>[,<dir>]] [--dry-run] [--json]",
    "  doctor [--dir <path>] [--config <path>] [--skills <dir>] [--verify] [--strict] [--summary] [--json]",
    "  status [--dir <path>] [--config <path>] [--skills <dir>] [--verify] [--strict] [--summary] [--json]",
    "  brief [--agent codex|claude|opencode|hermes] [--intent <request>] [--config <path>] [--include-actions] [--verbose] [--json]",
    "  apply-action <action-id> [--agent codex|claude|opencode|hermes] [--intent <text>] [--config <path>] [--dry-run] [--yes] [--allow-destructive] [--json]",
    "  skill enable|disable <skill-id> [--dry-run] [--json]",
    "  skill share|unshare <skill-id> [--dry-run] [--json]",
    "  skill preference <skill-id> --intent <term>[,<term>] --priority <integer> [--dry-run] [--json]",
    "  skill forget <skill-id> [--dry-run] [--json]",
    "  migrate v2 [--config <path>] [--skills <dir>] [--yes] [--rollback <backup>] [--json]",
    "  check --config <path> --skills <dir>",
    "  list [skills|workflows|harnesses|install-units] [--config <path>] [--skills <dir>] [--json]",
    "  explain <skill-id> [--config <path>] [--skills <dir>] [--json]",
    "  route <intent> --agent codex|claude|opencode|hermes [--config <path>] [--skills <dir>] [--json]",
    "  can-use <skill-id> --agent codex|claude|opencode|hermes [--config <path>] [--skills <dir>] [--json]",
    "  guard use <skill-id> --agent codex|claude|opencode|hermes [--config <path>] [--skills <dir>] [--json]",
    "",
    "Advanced operator commands:",
    "  Import, audit, rollout, hook, lock, variant, reconcile, impact, dashboard, and v1 lifecycle commands remain available through command-specific help and docs/reference.md.",
    "  Audit metadata never changes skill availability; runtime/action permission remains with the agent or harness.",
    "",
    "Legacy v1 project policy mode:",
    "  init [--dir <path>] [--scan-root <dir>[,<dir>]] [--no-scan-installed]",
    "  Deprecated project-local policy bootstrap; not needed for normal use.",
    "",
    "v2 AI/automation control loop:",
    "  Policy decides only enabled/disabled and per-skill opt-in sharing; see docs/ai-skill-routing-goal.md.",
    "  Valid installed skills default to enabled and agent-local. Optional preference ranks only and never changes availability.",
    "  Read brief --intent --agent <agent>, select an enabled installed skill, and run guard use automatically before use.",
    "  For an allowed skill, work without another approval; ask once only before a persistent policy change.",
    "  Source/provenance observations are audit metadata, never availability. Runtime/action authorization is outside SkillBoard.",
    "  Stale v1 policy is read-only: preview with skillboard migrate v2 --config <path> --json, apply with --yes --json, or restore with --rollback <backup> --json.",
    ""
  ].join("\n");
}

function commandHelpText(command) {
  if (command === "skill") {
    return skillHelpText();
  }
  if (command === "brief") {
    return briefHelpText();
  }
  if (command === "init") {
    return initHelpText();
  }
  if (command === "setup") {
    return setupHelpText();
  }
  if (command === "import-skill") {
    return importSkillHelpText();
  }
  if (command === "uninstall") {
    return uninstallHelpText();
  }
  if (command === "doctor" || command === "status") {
    return doctorHelpText();
  }
  if (command === "route") {
    return routeHelpText();
  }
  if (command === "can-use") {
    return canUseHelpText();
  }
  if (command === "guard") {
    return guardHelpText();
  }
  if (command === "apply-action") {
    return applyActionHelpText();
  }
  const usage = COMMAND_USAGE.get(command);
  return usage === undefined ? null : genericCommandHelpText(usage);
}

function skillHelpText() {
  return [
    "Usage: skillboard skill enable|disable <skill-id> [--dry-run] [--json]",
    "Usage: skillboard skill share|unshare <skill-id> [--dry-run] [--json]",
    "Usage: skillboard skill preference <skill-id> --intent <term>[,<term>] --priority <integer> [--dry-run] [--json]",
    "Usage: skillboard skill forget <skill-id> [--dry-run] [--json]",
    "",
    "Policy records enablement and explicit per-skill sharing. Skills remain agent-local by default.",
    "Preference only ranks enabled skills installed for the current agent; it never changes availability.",
    "Forget removes policy only after an unshared skill is no longer present in generated inventory; it never deletes skill files.",
    ""
  ].join("\n");
}

function genericCommandHelpText(usageLines) {
  return [
    ...usageLines.map((line) => `Usage: skillboard ${line}`),
    "",
    "This help is read-only. It does not load config or change project files.",
    "Run skillboard help for the full command catalog.",
    ""
  ].join("\n");
}

function initHelpText() {
  return [
    "Usage: skillboard init [--dir <path>] [--scan-root <dir>[,<dir>]] [--no-scan-installed]",
    "",
    "Deprecated project-local policy bootstrap. This command is not needed for normal use.",
    "Normal flow: install agent-skillboard globally, let postinstall/setup refresh agent-layer guidance, then ask your AI normal work requests.",
    "Use init only for an existing workspace that intentionally maintains local SkillBoard policy files.",
    "",
    "Options:",
    "  --dir <path>              Project root to initialize; defaults to the current directory.",
    "  --scan-root <dir>[,<dir>] Add extra skill roots to scan during setup.",
    "  --no-scan-installed       Create the files without scanning installed agent skills.",
    "",
    "What changes:",
    "  Writes skillboard.config.yaml, skills/, .skillboard/, AGENTS.md, and CLAUDE.md as needed.",
    "  Scans installed skills into generated inventory without source-based authorization.",
    "",
    "Legacy next steps:",
    "  Run skillboard doctor --summary.",
    "  Ask your AI: \"What skills can you use in this project?\"",
    ""
  ].join("\n");
}

function setupHelpText() {
  return [
    "Usage: skillboard setup [--yes] [--agent codex[,claude,opencode,hermes]]",
    "",
    "Installs or refreshes SkillBoard at the agent layer, not into a project.",
    "A normal global package install already runs this automatically for detected supported agents.",
    "Use setup later after adding another supported agent, enabling a new agent home, or skipping install scripts.",
    "skillboard init is deprecated project-local policy bootstrap and is not needed for normal use.",
    "Without --yes, setup explains the user agent skill files it will write and asks before installing when run in a TTY.",
    "In non-interactive automation, rerun with --yes after choosing the target agents.",
    "",
    "What changes after confirmation:",
    "  Writes a SkillBoard guidance skill into detected user agent skill roots.",
    "  Creates ~/skillboard.config.yaml and ~/.skillboard/inventory.json; it writes no project files.",
    "  Teaches agents to use local skills by default and share only user-selected skills.",
    "  Remove this managed guidance later with skillboard uninstall --agent-layer.",
    "",
    "Supported agent homes:",
    "  codex: CODEX_HOME, AGENTS_HOME, ~/.agents, or ~/.codex",
    "  claude: CLAUDE_HOME or ~/.claude",
    "  opencode: OPENCODE_HOME or ~/.config/opencode",
    "  hermes: HERMES_HOME or ~/.hermes",
    "",
    "Examples:",
    "  skillboard setup",
    "  skillboard setup --yes",
    "  skillboard setup --agent codex,claude,opencode,hermes --yes",
    ""
  ].join("\n");
}

function importSkillHelpText() {
  return [
    "Usage: skillboard import-skill --from <agent> --to <agent> --skill <id-or-dir> [--target-skill <id-or-dir>] [--adapted-file <path>] [--dry-run] [--yes] [--replace] [--json]",
    "",
    "Copies a user skill from one agent skill root into another agent skill root.",
    "This is an agent-layer operation. It does not initialize, attach, or modify a project.",
    "",
    "Supported agents:",
    "  codex: CODEX_HOME, AGENTS_HOME, ~/.agents, or ~/.codex",
    "  claude: CLAUDE_HOME or ~/.claude",
    "  opencode: OPENCODE_HOME or ~/.config/opencode",
    "  hermes: HERMES_HOME or ~/.hermes",
    "",
    "AI use:",
    "  Run this when a user asks to reuse a skill from another agent.",
    "  If the source looks compatible, rerun with --yes to install it as-is.",
    "  If the result status is needs-adaptation, explain the reasons and ask before changing the skill for the target agent.",
    "  After user approval, write the adapted SKILL.md body yourself and pass it with --adapted-file <path> --yes.",
    "",
    "Examples:",
    "  skillboard import-skill --from codex --to opencode --skill test-first --json",
    "  skillboard import-skill --from codex --to opencode --skill codex-hook --target-skill opencode-hook --adapted-file /tmp/opencode-hook.SKILL.md --yes --json",
    ""
  ].join("\n");
}

function uninstallHelpText() {
  return [
    "Usage: skillboard uninstall --user (--dry-run|--yes) [--json]",
    "Usage: skillboard uninstall [--dir <path>] [--dry-run] [--keep-settings] [--purge] [--remove-config|--reset-config] [--remove-reports] [--remove-hooks] [--keep-empty-dirs] [--agent-layer] [--agent codex[,claude,opencode,hermes]]",
    "",
    "This help is read-only. It does not load config or change project files.",
    "",
    "Removes complete user-level SkillBoard state, project bridge files, generated lifecycle scaffolding, or managed agent-layer guidance.",
    "Default project cleanup removes SkillBoard settings and generated project state while preserving local skills and user-authored non-SkillBoard content.",
    "",
    "Options:",
    "  --user              Remove all marker-owned shared copies, managed guidance, home policy, and generated user state.",
    "  --yes               Confirm the user-level removal after previewing it.",
    "  --dir <path>        Project root to clean up; defaults to the current directory.",
    "  --dry-run           Preview the cleanup without writing changes.",
    "  --keep-settings     Preserve project SkillBoard settings and bridge guidance during default cleanup.",
    "  --purge             Explicit alias for the default clean project removal; kept for existing scripts.",
    "  --remove-config     Legacy partial cleanup: delete skillboard.config.yaml only if generated default.",
    "  --reset-config      Legacy partial cleanup: delete skillboard.config.yaml even with policy choices.",
    "  --remove-reports    Legacy partial cleanup: delete .skillboard/reports/.",
    "  --remove-hooks      Legacy partial cleanup: delete .skillboard/hooks/.",
    "  --keep-empty-dirs   Preserve empty generated directories.",
    "  --agent-layer       Remove managed user-agent skillboard guidance instead of project files.",
    "  --agent <list>      Target supported agents for --agent-layer cleanup.",
    "  --json              Print a machine-readable user-level removal plan or result.",
    "",
    "User-level cleanup:",
    "  Run skillboard uninstall --user --dry-run, inspect the complete plan, then apply it with --yes.",
    "  Removes only marker-owned shared copies and managed guidance; agent-owned and unmanaged skills are preserved.",
    "  Removes ~/skillboard.config.yaml and ~/.skillboard only after managed copies and guidance are handled.",
    "",
    "Default project cleanup:",
    "  Removes SkillBoard config, bridge blocks, and the entire .skillboard/ project state directory.",
    "  This includes reports, hooks, source caches, rollout logs, variant snapshots, and profiles.",
    "  It does not delete local skills under skills/.",
    "  Add --keep-settings when you want to leave project SkillBoard policy and bridge guidance in place.",
    "  Passing a legacy partial cleanup flag without --purge cleans only that requested area instead.",
    "",
    "Agent layer:",
    "  Removes only managed skillboard/SKILL.md guidance files containing the SkillBoard agent integration marker.",
    "  It preserves other agent skills and user-authored skillboard skills without that marker.",
    "  Run this before npm uninstall -g agent-skillboard when agent guidance should be removed.",
    ""
  ].join("\n");
}

function doctorHelpText() {
  return [
    "Usage: skillboard doctor [--dir <path>] [--config <path>] [--skills <dir>] [--verify] [--strict] [--summary] [--json]",
    "",
    "Checks the user-level policy and generated inventory health.",
    "The status command is an alias for doctor.",
    "",
    "Options:",
    "  --dir <path>       Advanced legacy workspace root override.",
    "  --config <path>    Use a specific skillboard.config.yaml.",
    "  --skills <dir>     Use a specific skills directory.",
    "  --verify           Verify local source/cache digests when available.",
    "  --strict           Return a failing exit code for review-needed safe mode.",
    "  --summary          Print a short human summary.",
    "  --json             Print an agent-readable payload.",
    "",
    "Without path overrides, this checks ~/skillboard.config.yaml and ~/.skillboard/inventory.json from any directory.",
    "It is read-only.",
    ""
  ].join("\n");
}

function briefHelpText() {
  return [
    "Usage: skillboard brief [--agent codex|claude|opencode|hermes] [--intent <request>] [--config <path>] [--skills <dir>] [--include-actions] [--verbose] [--json]",
    "",
    "Reads the current user-level SkillBoard brief without changing files.",
    "Use it when a user asks what skills the AI can use, a request has ambiguous skill overlap, or a policy change needs approval.",
    "",
    "Options:",
    "  --agent <name>        Evaluate actual installation for the current agent; required for v2 availability and routing.",
    "  --intent <request>    Add a natural-language request so SkillBoard can suggest a skill.",
    "  --config <path>       Advanced policy override; defaults to ~/skillboard.config.yaml.",
    "  --skills <dir>        Use a specific skills directory.",
    "  --include-actions     Include current action ids in JSON output.",
    "  --verbose             Show full lists instead of compact previews.",
    "  --json                Print an agent-readable payload.",
    "",
    "AI use:",
    "  Read this before answering availability questions.",
    "  Run skillboard guard use <skill-id> --agent <agent> before invoking a skill.",
    "  If guard allows use, disclose the skill at the start and completion; do not ask for another approval.",
    "  If a policy change is needed, ask the user to approve one current action id from this brief.",
    ""
  ].join("\n");
}

function routeHelpText() {
  return [
    "Usage: skillboard route <intent> --agent codex|claude|opencode|hermes [--config <path>] [--skills <dir>] [--json]",
    "",
    "Suggests the routed skill for a user request when several allowed skills may overlap.",
    "Use it when the AI needs a skill recommendation without changing policy.",
    "",
    "Options:",
    "  <intent>           Natural-language request, such as \"write tests first\".",
    "  --agent <name>     Route among skills installed for this agent.",
    "  --config <path>    Use a specific skillboard.config.yaml.",
    "  --skills <dir>     Use a specific skills directory.",
    "  --json             Print an agent-readable payload.",
    "",
    "AI use:",
    "  If a skill is recommended, run the guard automatically before invoking it.",
    "  If the guard allows use, disclose the skill at start and completion; do not ask for another approval.",
    "  If policy memory would reduce ambiguity, ask after completion whether to remember the routed skill.",
    "  If no skill matches, ask a clarifying question instead of guessing.",
    ""
  ].join("\n");
}

function canUseHelpText() {
  return [
    "Usage: skillboard can-use <skill-id> --agent codex|claude|opencode|hermes [--config <path>] [--skills <dir>] [--json]",
    "",
    "Checks whether one skill is enabled and installed for the selected agent without changing policy.",
    "Use it when the AI needs an availability answer for a named skill.",
    "",
    "Options:",
    "  <skill-id>         Skill id to check.",
    "  --agent <name>     Agent that would use the skill.",
    "  --config <path>    Use a specific skillboard.config.yaml.",
    "  --skills <dir>     Use a specific skills directory.",
    "  --json             Print an agent-readable payload.",
    "",
    "AI use:",
    "  If allowed, use the skill after the final guard check.",
    "  If allowed, disclose the skill at the start and completion; do not ask for another approval.",
    "  If denied, explain the reason or ask for the needed policy change before using it.",
    ""
  ].join("\n");
}

function guardHelpText() {
  return [
    "Usage: skillboard guard use <skill-id> --agent codex|claude|opencode|hermes [--config <path>] [--skills <dir>] [--json]",
    "",
    "Checks whether one skill may be used right now.",
    "Run this immediately before the AI invokes a skill.",
    "",
    "Options:",
    "  use                Guard a skill invocation.",
    "  <skill-id>         Skill id to check.",
    "  --agent <name>     Agent that will use the skill.",
    "  --config <path>    Use a specific skillboard.config.yaml.",
    "  --skills <dir>     Use a specific skills directory.",
    "  --json             Print an agent-readable payload.",
    "",
    "AI use:",
    "  If allowed, disclose the skill at the start and completion; do not ask for another approval.",
    "  If denied, do not invoke the skill. Explain the reason or ask for the needed policy change.",
    ""
  ].join("\n");
}

function applyActionHelpText() {
  return [
    "Usage: skillboard apply-action <action-id> [--agent codex|claude|opencode|hermes] [--intent <text>] [--config <path>] [--skills <dir>] [--dry-run] [--yes] [--allow-destructive] [--json]",
    "",
    "Applies one current action id from the latest brief.",
    "Use it only after the user confirms a policy-changing action.",
    "",
    "Options:",
    "  <action-id>             One action id from the current brief.",
    "  --agent <name>           Preserve the brief's current-agent context in preview and post-apply output.",
    "  --intent <text>         Intent bound to a current preference action.",
    "  --dir <path>            Advanced legacy workspace root override.",
    "  --config <path>         Use a specific skillboard.config.yaml.",
    "  --skills <dir>          Use a specific skills directory.",
    "  --dry-run               Preview the action without writing changes.",
    "  --yes                   Apply the action after user confirmation.",
    "  --allow-destructive     Permit destructive reset or cleanup actions.",
    "  --json                  Print an agent-readable payload.",
    "",
    "AI use:",
    "  Apply exactly one current action id.",
    "  Read the returned post-apply brief before making another availability decision.",
    ""
  ].join("\n");
}
