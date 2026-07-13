import { lstat, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { analyzeAgentCompatibility } from "./agent-skill-import.mjs";
import {
  assertShareTargetAvailable,
  copyManaged,
  managedShareMetadata,
  marker,
  shareTarget
} from "./shared-skill.mjs";
import { loadWorkspace } from "./workspace.mjs";

export async function reconcileSharedSkills(options) {
  const workspace = await loadWorkspace({
    configPath: options.configPath,
    inventoryPath: options.inventoryPath
  });
  const targets = uniqueTargets(options.targets ?? []);
  const created = [];
  const unchanged = [];
  const preserved = [];
  const blocked = [];

  try {
    for (const policy of workspace.skills.filter((skill) => skill.shared)) {
      const source = shareTarget(join(options.home, ".agents", "shared-skills"), policy.id);
      const sourceMarker = await managedShareMetadata(source, policy.id);
      if (sourceMarker?.mode !== "shared-source") {
        blocked.push({ skill: policy.id, reason: "managed shared source is missing" });
        continue;
      }
      const content = await readFile(join(source, "SKILL.md"), "utf8");
      for (const target of targets) {
        const path = shareTarget(target.root, policy.id);
        const existing = await pathStats(path);
        if (existing !== null) {
          if (await managedShareMetadata(path, policy.id) !== null) {
            unchanged.push({ agent: target.agent, skill: policy.id, path });
          } else {
            preserved.push({ agent: target.agent, skill: policy.id, path });
          }
          continue;
        }
        if (target.agent !== sourceMarker.source_agent) {
          const compatibility = analyzeAgentCompatibility(content, {
            sourceAgent: sourceMarker.source_agent,
            targetAgent: target.agent
          });
          if (!compatibility.compatible) {
            blocked.push({
              agent: target.agent,
              skill: policy.id,
              path,
              reason: compatibility.reasons.join("; ")
            });
            continue;
          }
        }
        await assertShareTargetAvailable(target.root, path, options.home, policy.id);
        if (await copyManaged(source, path, marker(
          policy.id,
          sourceMarker.source_agent,
          "agent-copy",
          target.agent
        ), options)) {
          created.push({ agent: target.agent, skill: policy.id, path });
        }
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of created.reverse()) {
      await rm(entry.path, { recursive: true, force: true }).catch((rollbackError) => rollbackErrors.push(rollbackError));
    }
    if (rollbackErrors.length === 0) throw error;
    const original = error instanceof Error ? error.message : String(error);
    const rollback = rollbackErrors.map((entry) => entry instanceof Error ? entry.message : String(entry)).join("; ");
    throw new Error(`${original} Reconcile rollback also failed: ${rollback}`);
  }

  return { created, unchanged, preserved, blocked };
}

function uniqueTargets(targets) {
  const byRoot = new Map();
  for (const target of targets) {
    byRoot.set(resolve(target.root), { agent: target.agent, root: resolve(target.root) });
  }
  return [...byRoot.values()].sort((left, right) => left.root.localeCompare(right.root));
}

async function pathStats(path) {
  return await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}
