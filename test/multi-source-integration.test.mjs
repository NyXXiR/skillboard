import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPolicy, impactDisable, loadWorkspace, renderDashboard } from "../src/index.mjs";

const CONFIG = "examples/multi-source.config.yaml";
const SKILLS = "examples/multi-source-skills";

test("workspace consistently manages private skills and five external repositories", async () => {
  const workspace = await loadWorkspace({ configPath: CONFIG, skillsRoot: SKILLS });
  const policy = checkPolicy(workspace);
  const dashboard = renderDashboard(workspace);
  const impact = impactDisable(workspace, "matt.tdd");

  assert.equal(policy.ok, true, policy.errors.join("\n"));
  assert.equal(workspace.installUnits.length, 6);
  assert.equal(workspace.installedSkills.length, 10);
  assert.deepEqual(impact.affectedWorkflows, ["codex-night-workflow"]);
  assert.deepEqual(impact.alternatives, ["private.tdd-work-continuity", "wshobson.python-testing"]);
  assert.match(dashboard, /github\.mattpocock\.skills/);
  assert.match(dashboard, /github\.code-yeongyu\.oh-my-openagent/);
  assert.match(dashboard, /github\.anthropics\.skills/);
  assert.match(dashboard, /github\.wshobson\.agents/);
  assert.match(dashboard, /github\.voltagent\.awesome-agent-skills/);
  assert.match(dashboard, /`matt\.tdd` — active, workflow-auto, exported, engineering, owner: `github\.mattpocock\.skills`/);
  assert.match(dashboard, /`omo\.ulw-plan` — vendor, manual-only, unit-managed, handoff, owner: `github\.code-yeongyu\.oh-my-openagent`/);
  assert.match(dashboard, /`private\.workflow-router` — active, global-auto, global-meta, meta, owner: `local\.agent-skills-private`/);
});
