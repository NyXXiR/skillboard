// allow: SIZE_OK - ecosystem docs contract test split is deferred from the 0.2.7 release gate.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { STATUS_VALUES } from "../src/domain/constants.mjs";

test("CONTRIBUTING.md exists and covers development workflow", async () => {
  const text = await readFile(resolve("CONTRIBUTING.md"), "utf8");

  assert.match(text, /Development Environment/);
  assert.match(text, /Running Tests/);
  assert.match(text, /Adding a Built-In Source Profile/);
  assert.match(text, /npm run check/);
});

test("docs/profiles.md exists and explains source profile authoring", async () => {
  const text = await readFile(resolve("docs/profiles.md"), "utf8");

  assert.match(text, /Profile YAML Structure/);
  assert.match(text, /How to Add a Built-In Profile/);
  assert.match(text, /skill_paths/);
  assert.match(text, /path_rules/);
});

test("docs/profiles.md documents supported source profile default statuses", async () => {
  const text = await readFile(resolve("docs/profiles.md"), "utf8");

  assert.doesNotMatch(text, /Default skill `status`: `installed`/);
  for (const status of ["discovered", "vendor", "candidate", "active", "quarantined", "blocked", "deprecated"]) {
    assert.equal(STATUS_VALUES.has(status), true);
    assert.match(text, new RegExp(`\\b${status}\\b`));
  }
});

test("docs plan index matches completed MVP plan state", async () => {
  const text = await readFile(resolve("docs/plans/README.md"), "utf8");

  assert.match(text, /20260625-080025-skillboard-mvp-review\.md.+Status: completed/s);
  assert.doesNotMatch(text, /20260625-080025-skillboard-mvp-review\.md.+Status: pending/s);
});

test("docs/capabilities.md exists and explains global vs workflow-scoped capabilities", async () => {
  const text = await readFile(resolve("docs/capabilities.md"), "utf8");

  assert.match(text, /Global Capability Catalog/);
  assert.match(text, /Workflow-Scoped Requirements/);
  assert.match(text, /Resolution Flow/);
  assert.match(text, /canonical/);
  assert.match(text, /required_capabilities/);
});

test("docs explain runtime skill conflicts across guard brief and impact", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const policy = await readFile(resolve("docs/policy-model.md"), "utf8");
  const reference = await readFile(resolve("docs/reference.md"), "utf8");
  const combined = `${readme}\n${policy}\n${reference}`;

  assert.match(combined, /conflicts_with/);
  assert.match(combined, /guard use/);
  assert.match(combined, /Blocked for safety/);
  assert.match(combined, /impact disable <skill-id> --json/);
  assert.match(combined, /conflictingSkills/);
  assert.match(combined, /activeConflicts/);
  assert.match(readme, /Workflow conflict checks/);
});

test("docs document manual variant lifecycle without promising conversion", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const capabilities = await readFile(resolve("docs/capabilities.md"), "utf8");
  const policy = await readFile(resolve("docs/policy-model.md"), "utf8");
  const reference = await readFile(resolve("docs/reference.md"), "utf8");
  const guide = await readFile(resolve("docs/variant-lifecycle.md"), "utf8");
  const bridge = await readFile(resolve("src/lifecycle-content.mjs"), "utf8");
  const combined = `${readme}\n${capabilities}\n${policy}\n${reference}\n${guide}\n${bridge}`;

  assert.match(combined, /skillboard variant add/);
  assert.match(combined, /skillboard variant fork <variant-id>/);
  assert.match(combined, /skillboard variant status <variant-id>/);
  assert.match(combined, /skillboard variant approve <variant-id>/);
  assert.match(combined, /skillboard variant reset <variant-id>/);
  assert.match(combined, /manual adaptation lifecycle/);
  assert.match(combined, /policy registration/);
  assert.match(combined, /variant\.status/);
  assert.match(combined, /computed drift/);
  assert.match(combined, /raw snapshot/);
  assert.match(guide, /base:\n\s+content_digest: sha256:\.\.\.\n\s+snapshot: \.skillboard\/variant-snapshots\/claude\.a\/base\.md/);
  assert.match(guide, /approved:\n\s+content_digest: sha256:\.\.\.\n\s+snapshot: \.skillboard\/variant-snapshots\/claude\.a\/approved\.md/);
  assert.match(guide, /created lazily/);
  assert.match(reference, /\[--category <name>\] \[--owner-install-unit <unit-id>\]/);
  assert.match(guide, /\[--category <name>\] \[--owner-install-unit <unit-id>\]/);
  assert.match(readme, /\[Skill variant lifecycle\]\(docs\/variant-lifecycle\.md\)/);
  assert.match(combined, /does not convert skill bodies/);
  assert.doesNotMatch(combined, /Success payloads include `ok: true`/);
  assert.doesNotMatch(combined, /automatically (convert|rewrite|adapt)/i);
});

test("docs/versioning.md documents tag-based npm release automation", async () => {
  const text = await readFile(resolve("docs/versioning.md"), "utf8");

  assert.match(text, /Release Checklist/);
  assert.match(text, /agent-skillboard/);
  assert.match(text, /publish\.yml/);
  assert.match(text, /npm publish/);
  assert.match(text, /NPM_TOKEN/);
  assert.match(text, /NODE_AUTH_TOKEN/);
  assert.match(text, /registry URL in `setup-node`/);
  assert.match(text, /OIDC/);
  assert.match(text, /provenance/);
  assert.match(text, /exactly matches `package\.json`/);
  assert.match(text, /skips `npm publish` only when that exact version already exists on npm/);
});

test("public docs distinguish global and source-tree command forms", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const install = await readFile(resolve("docs/install.md"), "utf8");
  const reference = await readFile(resolve("docs/reference.md"), "utf8");
  const text = `${readme}\n${install}\n${reference}`;

  assert.match(text, /node bin\/skillboard\.mjs/);
  assert.match(text, /npm install -g agent-skillboard/);
  assert.match(text, /replace `skillboard ` with\s+`node bin\/skillboard\.mjs `/);
});

test("README shows the architecture diagram from a GitHub-hosted asset", async () => {
  const text = await readFile(resolve("README.md"), "utf8");

  assert.match(text, /SkillBoard architecture diagram/);
  assert.match(text, /https:\/\/raw\.githubusercontent\.com\/NyXXiR\/skillboard\/main\/skillboard\.png/);
});

test("README and install docs lead with npm quick start after registry publish", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const install = await readFile(resolve("docs/install.md"), "utf8");
  const reference = await readFile(resolve("docs/reference.md"), "utf8");

  assert.match(readme, /## 5-Minute Quick Start/);
  assert.match(readme, /npm install -g agent-skillboard/);
  assert.match(readme, /sudo npm install -g\s+agent-skillboard/);
  assert.match(readme, /SUDO_USER/);
  assert.match(readme, /restored\s+to the invoking user's ownership/);
  assert.match(readme, /No separate setup\s+command is required after a normal global install or update/);
  assert.match(readme, /run agent-layer setup automatically/i);
  assert.match(readme, /does not run `skillboard init`/);
  assert.match(readme, /~\/\.agents\/skills/);
  assert.match(readme, /If `~\/\.agents` already exists, setup creates `~\/\.agents\/skills`/);
  assert.match(readme, /skillboard setup --agent codex,claude,opencode,hermes --yes/);
  assert.match(readme, /skillboard import-skill --from codex --to opencode --skill <skill> --json/);
  assert.match(readme, /Use the Codex test-first skill in OpenCode too/);
  assert.match(readme, /does not create `skillboard\.config\.yaml`,\s+`\.skillboard\/`, `AGENTS\.md`, or `CLAUDE\.md` in projects/);
  assert.match(readme, /Write tests before implementation/);
  assert.match(readme, /SkillBoard runs behind the scenes only when skill choices\s+overlap/);
  assert.match(readme, /npx --yes --package agent-skillboard skillboard init/);
  assert.match(readme, /npx --yes --package agent-skillboard skillboard doctor --summary/);
  assert.match(readme, /npx --yes --package agent-skillboard skillboard brief --workflow <workflow-from-init>/);
  assert.match(readme, /skillboard uninstall --agent-layer --dry-run/);
  assert.match(readme, /preserves other agent skills\s+and user-authored `skillboard` skills/i);
  assert.match(readme, /If you intentionally maintain local workspace policy files/);
  assert.match(readme, /\[docs\/install\.md\]\(docs\/install\.md\)/);
  assert.match(readme, /\[docs\/reference\.md\]\(docs\/reference\.md\)/);
  assert.doesNotMatch(readme, /npx agent-skillboard init/);
  assert.doesNotMatch(readme, /Unreleased GitHub builds/);
  assert.doesNotMatch(readme, /git clone https:\/\/github\.com\/NyXXiR\/skillboard\.git/);

  assert.match(install, /## Install From npm/);
  assert.match(install, /npm install -g agent-skillboard/);
  assert.match(install, /sudo npm install -g agent-skillboard/);
  assert.match(install, /instead of writing guidance under `\/root`/);
  assert.match(install, /`SUDO_UID:SUDO_GID` ownership/);
  assert.match(install, /Global install auto-runs agent integration/);
  assert.match(install, /does not run `skillboard init`/);
  assert.match(install, /No separate setup command is required after a normal global install or update/);
  assert.match(install, /package updates rerun the agent-home scan/);
  assert.match(install, /skillboard setup --agent codex,claude,opencode,hermes --yes/);
  assert.match(install, /skillboard uninstall --agent-layer --dry-run/);
  assert.match(install, /npm\s+uninstall should not be relied on to edit agent homes or projects/);
  assert.match(install, /preserves other agent\s+skills and user-authored `skillboard` skills/i);
  assert.match(install, /OPENCODE_HOME/);
  assert.match(install, /~\/\.agents\/skills/);
  assert.match(install, /If `~\/\.agents` exists but `~\/\.agents\/skills` does not, setup creates the\s+`skills` directory/);
  assert.match(install, /skillboard import-skill --from codex --to opencode --skill <skill>/);
  assert.match(install, /needs-adaptation/);
  assert.match(install, /npx --yes --package agent-skillboard skillboard init/);
  assert.match(install, /npx --yes --package agent-skillboard skillboard doctor --summary/);
  assert.match(install, /npx --yes --package agent-skillboard skillboard brief --workflow <workflow-from-init>/);
  assert.match(install, /skipped lifecycle scripts/);
  assert.match(install, /need to repair the\s+agent-layer guidance install/);
  assert.match(install, /npm exec --yes --package agent-skillboard -- skillboard init/);
  assert.match(install, /npm exec --yes --package agent-skillboard -- skillboard doctor --summary/);
  assert.match(install, /npm exec --yes --package agent-skillboard -- skillboard brief --workflow <workflow-from-init>/);
  assert.match(install, /If `init` does not print a\s+workflow, run the unscoped `brief`\s+command it prints instead/);
  assert.doesNotMatch(install, /npx agent-skillboard init/);
  assert.match(install, /## Run Unreleased Builds From GitHub/);
  assert.match(install, /npx --yes --package github:NyXXiR\/skillboard skillboard init/);
  assert.match(install, /npx --yes --package github:NyXXiR\/skillboard skillboard brief --workflow <workflow-from-init>/);
  assert.match(install, /npm exec --yes --package github:NyXXiR\/skillboard -- skillboard init/);
  assert.match(install, /npm exec --yes --package github:NyXXiR\/skillboard -- skillboard brief --workflow <workflow-from-init>/);
  assert.match(install, /## Install From A Clone/);
  assert.match(reference, /git clone https:\/\/github\.com\/NyXXiR\/skillboard\.git/);
  assert.match(reference, /skillboard setup \[--yes\] \[--agent codex\[,claude,opencode,hermes\]\]/);
  assert.match(reference, /skillboard uninstall \[--dir <path>\].*\[--agent-layer\]/);
  assert.match(reference, /skillboard import-skill --from <agent> --to <agent> --skill <id-or-dir>/);
  assert.match(reference, /~\/\.agents\/skills/);
  assert.match(reference, /## Agent Skill Reuse/);
  assert.match(reference, /This is separate from `variant` commands/);
  assert.doesNotMatch(reference, /skillboard attach \[--dir <path>\]/);
  assert.match(reference, /node bin\/skillboard\.mjs init --dir \/path\/to\/your\/project/);
  assert.match(reference, /node bin\/skillboard\.mjs brief --dir \/path\/to\/your\/project --workflow <workflow-from-init>/);
  assert.match(reference, /If `init` does not print a workflow, run the unscoped `brief` command it prints\s+instead/);
  assert.doesNotMatch(install, /not published yet/i);
});

test("public docs surface alpha status and intentional policy-failure fixture", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const versioning = await readFile(resolve("docs/versioning.md"), "utf8");
  const example = await readFile(resolve("examples/skillboard.config.yaml"), "utf8");
  const valueProof = await readFile(resolve("docs/value-proof.md"), "utf8");

  assert.match(readme, /public alpha/i);
  assert.match(readme, /config schema v1/i);
  assert.match(readme, /before `1\.0\.0`/);
  assert.match(versioning, /The project is a public alpha/);
  assert.match(example, /Intentional policy-failure fixture/i);
  assert.match(valueProof, /examples\/skillboard\.config\.yaml/);
  assert.match(valueProof, /intentional policy-failure fixture/i);
});

test("user docs frame commands as AI automation details, not a memorized user loop", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const userFlow = await readFile(resolve("docs/user-flow.md"), "utf8");
  const install = await readFile(resolve("docs/install.md"), "utf8");
  const policy = await readFile(resolve("docs/policy-model.md"), "utf8");
  const combined = `${readme}\n${userFlow}\n${install}\n${policy}`;

  assert.match(combined, /Ask your AI/i);
  assert.match(combined, /You\s+do\s+not need to\s+memorize the SkillBoard command loop/i);
  assert.match(combined, /behind the scenes/i);
  assert.match(combined, /AI\/automation\/operator details/i);
  assert.match(userFlow, /When you ask your AI/i);
  assert.match(install, /After install, ask your AI/i);
  assert.match(policy, /The user does\s+not need to know the command loop/i);
  assert.match(combined, /already-allowed skills/i);
  assert.match(combined, /not ask for another\s+approval/i);
  assert.match(combined, /disclose the selected skill/i);
  assert.match(combined, /audit trace,\s+not a permission prompt/i);

  assert.match(combined, /read the current brief/i);
  assert.match(combined, /current action id/i);
  assert.doesNotMatch(combined, /apply cached action-card commands/i);
  assert.doesNotMatch(combined, /infer availability from raw SKILL\.md/i);
  assert.doesNotMatch(combined, /run these commands every time you need a skill/i);
});

test("AI development docs preserve the permissive routing goal document", async () => {
  const goal = await readFile(resolve("docs/ai-skill-routing-goal.md"), "utf8");
  const readme = await readFile(resolve("README.md"), "utf8");
  const userFlow = await readFile(resolve("docs/user-flow.md"), "utf8");
  const policy = await readFile(resolve("docs/policy-model.md"), "utf8");
  const bridge = await readFile(resolve("src/lifecycle-content.mjs"), "utf8");
  const agents = await readFile(resolve("AGENTS.md"), "utf8");
  const claude = await readFile(resolve("CLAUDE.md"), "utf8");
  const combined = `${readme}\n${userFlow}\n${policy}\n${bridge}\n${agents}\n${claude}`;

  assert.match(goal, /permissive AI skill routing layer/i);
  assert.match(goal, /multiple allowed matching skills stay available while the routed skill is deterministic/i);
  assert.match(goal, /observe\s*→\s*route\s*→\s*work\s*→\s*explain briefly\s*→\s*ask after\s*→\s*remember policy/i);
  assert.match(goal, /SkillBoard does not rewrite `SKILL\.md` bodies/i);
  for (const mode of ["always use", "prefer", "reference only", "ask after use", "ask before use", "avoid", "block"]) {
    assert.match(goal, new RegExp(mode, "i"));
  }
  assert.match(goal, /MVP acceptance criteria/i);
  assert.match(combined, /docs\/ai-skill-routing-goal\.md/);
  assert.match(combined, /Read `docs\/ai-skill-routing-goal\.md` before changing routing, brief, bridge, policy, or workflow UX/i);
});

test("public docs explain read-only routing for choosing a skill", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const reference = await readFile(resolve("docs/reference.md"), "utf8");
  const userFlow = await readFile(resolve("docs/user-flow.md"), "utf8");
  const combined = `${readme}\n${reference}\n${userFlow}`;

  assert.match(readme, /Write tests before implementation/);
  assert.match(readme, /`brief`, `route`, `can-use`, and `guard use`/);
  assert.match(reference, /skillboard brief \[--workflow <name>\] \[--intent <request>\]/);
  assert.match(reference, /assistant_guidance/);
  assert.match(reference, /assistant_guidance\.goal_document/);
  assert.match(reference, /loop/);
  assert.match(reference, /simplification_rule/);
  assert.match(reference, /brief --intent/);
  assert.match(reference, /skillboard route <intent> --workflow <name>/);
  assert.match(reference, /## Capability Routing/);
  assert.match(reference, /matched_capability: null/);
  assert.match(reference, /workflow-bound skill id, path, category, `SKILL\.md` name, and `SKILL\.md`\s+description metadata/);
  assert.match(combined, /match_source/);
  assert.match(combined, /matched_terms/);
  assert.match(combined, /recommendation_reason/);
  assert.match(reference, /disclose the skill at start and completion/i);
  assert.match(userFlow, /skillboard brief --intent "write tests before implementation"/);
  assert.match(userFlow, /assistant_guidance\.route/);
  assert.match(userFlow, /skillboard guard use/);
  assert.match(combined, /read-only recommendation surface/i);
  assert.match(combined, /does not inspect or\s+semantically rank `SKILL\.md` bodies/i);
  assert.match(combined, /limited to the\s+selected workflow's active,\s+required, or global-auto bindings/i);
});

test("README and install docs include a Hermes system prompt bridge guide", async () => {
  const readme = await readFile(resolve("README.md"), "utf8");
  const install = await readFile(resolve("docs/install.md"), "utf8");
  const combined = `${readme}\n${install}`;

  assert.match(combined, /Hermes System Prompt Bridge/);
  assert.match(combined, /Hermes does not automatically read `AGENTS\.md` or `CLAUDE\.md`/);
  assert.match(combined, /skillboard brief --workflow <workflow-name> --json --include-actions --dir \/path\/to\/your\/project/);
  assert.match(combined, /skillboard brief --workflow <workflow-name> --intent <request> --json --dir \/path\/to\/your\/project/);
  assert.match(combined, /assistant_guidance\.route/);
  assert.match(combined, /recommended_skill/);
  assert.match(combined, /fallback_skills/);
  assert.match(combined, /route_candidates/);
  assert.match(combined, /post_use_policy_suggestion/);
  assert.match(combined, /overlap_resolution/);
  assert.match(combined, /policy_memory/);
  assert.match(combined, /guard_command/);
  assert.match(combined, /ask after completion whether to\s+remember the suggested\s+policy/i);
  assert.match(combined, /ask a clarifying question before choosing a\s+skill/i);
  assert.match(combined, /skillboard guard use <skill-id> --workflow <workflow-name> --dir \/path\/to\/your\/project/);
  assert.match(combined, /skillboard apply-action <action-id> --workflow <workflow-name> --dir \/path\/to\/your\/project --yes --json/);
  assert.match(combined, /do not ask the user for another\s+approval/i);
  assert.match(combined, /I will use <skill-id> for this request\./);
  assert.match(combined, /I used <skill-id> for this request\./);
});

test("project dogfoods AGENTS.md and CLAUDE.md bridge files", async () => {
  const agents = await readFile(resolve("AGENTS.md"), "utf8");
  const claude = await readFile(resolve("CLAUDE.md"), "utf8");

  assert.match(agents, /<!-- BEGIN SKILLBOARD -->/);
  assert.match(agents, /<!-- END SKILLBOARD -->/);
  assert.match(claude, /<!-- BEGIN SKILLBOARD -->/);
  assert.match(claude, /<!-- END SKILLBOARD -->/);
  assert.match(agents, /do not ask for another approval/i);
  assert.match(agents, /brief --intent <request>/i);
  assert.match(agents, /assistant_guidance\.route/);
  assert.match(agents, /route_candidates/);
  assert.match(agents, /overlap_resolution/);
  assert.match(agents, /policy_memory/);
  assert.match(agents, /post_use_policy_suggestion/);
  assert.match(agents, /ask after completion whether to remember the suggested policy/i);
  assert.match(agents, /I will use <skill-id> for this request\./);
  assert.match(agents, /I used <skill-id> for this request\./);
  assert.match(agents, /ask a clarifying question/i);
  assert.match(claude, /do not ask for another approval/i);
  assert.match(claude, /brief --intent <request>/i);
  assert.match(claude, /assistant_guidance\.route/);
  assert.match(claude, /route_candidates/);
  assert.match(claude, /overlap_resolution/);
  assert.match(claude, /policy_memory/);
  assert.match(claude, /post_use_policy_suggestion/);
  assert.match(claude, /ask after completion whether to remember the suggested policy/i);
  assert.match(claude, /I will use <skill-id> for this request\./);
  assert.match(claude, /I used <skill-id> for this request\./);
  assert.match(claude, /ask a clarifying question/i);
});

test("project dogfoods skillboard.config.yaml", async () => {
  const config = await readFile(resolve("skillboard.config.yaml"), "utf8");

  assert.match(config, /version: 1/);
  assert.match(config, /invocation_policy: deny-by-default/);
});
