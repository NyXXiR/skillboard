import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSkillBrief,
  checkPolicy,
  explainSkill,
  listSkills,
  loadWorkspace
} from "../src/index.mjs";
import { withFixture } from "./fixtures.mjs";
import {
  APPROVED_DIGEST,
  BASE_DIGEST,
  declaredBriefEntries,
  invalidVariantConfig,
  variantConfig,
  withVariantWorkspace
} from "./helpers/variant-lifecycle-workspace-fixtures.mjs";

test("baseline config without variant remains parseable and projections stay valid", async () => {
  await withFixture(async ({ configPath, root, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });

    assert.equal(workspace.skills.every((skill) => skill.variant === null), true);

    const listed = listSkills(workspace);
    assert.equal(listed.length > 0, true);
    assert.equal(listed.every((skill) => skill.variant === null), true);

    const explanation = explainSkill(workspace, "matt.tdd");
    assert.equal(explanation.variant, null);

    const brief = await buildSkillBrief({
      configPath,
      root,
      skillsRoot,
      workflow: "codex-night-workflow"
    });
    const declaredEntries = declaredBriefEntries(brief);
    assert.equal(declaredEntries.length > 0, true);
    assert.equal(declaredEntries.every((entry) => entry.advanced.variant === null), true);
  });
});

test("parses nested variant metadata and projects it through list explain and brief", async () => {
  await withVariantWorkspace(variantConfig(), async ({ configPath, root, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const skill = workspace.skills.find((candidate) => candidate.id === "codex.review");
    const expectedVariant = {
      of: "base.review",
      adaptedFor: "Codex night workflow",
      capability: "task-review",
      workflow: "codex-workflow",
      status: "approved",
      base: {
        contentDigest: BASE_DIGEST,
        snapshot: ".skillboard/variant-snapshots/codex.review/base.md"
      },
      approved: {
        contentDigest: APPROVED_DIGEST,
        snapshot: ".skillboard/variant-snapshots/codex.review/approved.md"
      }
    };

    assert.deepEqual(skill.variant, expectedVariant);
    assert.deepEqual(checkPolicy(workspace), { ok: true, errors: [], warnings: [] });

    const summary = listSkills(workspace).find((candidate) => candidate.id === "codex.review");
    assert.deepEqual(summary.variant, expectedVariant);

    const explanation = explainSkill(workspace, "codex.review");
    assert.deepEqual(explanation.variant, expectedVariant);

    const brief = await buildSkillBrief({ configPath, root, skillsRoot, workflow: "codex-workflow" });
    const briefEntry = declaredBriefEntries(brief).find((entry) => entry.id === "codex.review");
    assert.deepEqual(briefEntry.advanced.variant, expectedVariant);
  });
});

test("rejects invalid nested variant metadata through policy validation", async () => {
  await withVariantWorkspace(invalidVariantConfig(), async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    const result = checkPolicy(workspace);
    const errors = result.errors.join("\n");

    assert.equal(result.ok, false);
    assert.match(errors, /bad\.status variant\.status must be one of: draft, approved; got ready/);
    assert.match(errors, /bad\.digest variant\.base\.content_digest must match sha256:<64 hex chars>/);
    assert.match(errors, /bad\.snapshot variant\.base\.snapshot must be a relative path under \.skillboard\/variant-snapshots\//);
    assert.match(errors, /bad\.of variant\.of references undeclared skill: missing\.base/);
    assert.match(errors, /bad\.capability variant\.capability references undeclared capability: missing-capability/);
    assert.match(errors, /bad\.workflow variant\.workflow references undeclared workflow: missing-workflow/);
  });
});

test("does not treat variant lifecycle status as a top-level skill status", async () => {
  await withVariantWorkspace(variantConfig({ skillStatus: "draft" }), async ({ configPath, skillsRoot }) => {
    await assert.rejects(
      loadWorkspace({ configPath, skillsRoot }),
      /Unsupported status for codex\.review: draft/
    );
  });
});
