import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildSkillBrief } from "../src/index.mjs";
import {
  withBriefFixture,
  withReviewQueueOrderingFixture,
  withSourceReviewFixture
} from "./helpers/advisor-brief-fixtures.mjs";
import {
  withGroupsFixture,
  withMultiWorkflowGroupsFixture
} from "./helpers/advisor-brief-groups.mjs";
import {
  EXPECTED_INITIALIZED_CONTRACT,
  EXPECTED_SOURCE_REVIEW_CONTRACT,
  TOP_LEVEL_KEYS
} from "./helpers/advisor-brief-snapshots.mjs";
import {
  contractView,
  sourceReviewView
} from "./helpers/advisor-brief-views.mjs";

test("brief schema initialized project returns stable top-level sections", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot, root }) => {
    const brief = await buildSkillBrief({ configPath, skillsRoot, root, workflow: "daily-workflow" });

    assert.equal(brief.ok, true);
    assert.equal(brief.schema_version, 1);
    assert.deepEqual(Object.keys(brief), TOP_LEVEL_KEYS);
    assert.equal(typeof brief.health.mode, "string");
    assert.equal(brief.workflow.selected, "daily-workflow");
    assert.equal(brief.workflow.unknown, false);
    assert.ok(Object.hasOwn(brief.skills, "automatic_allowed"));
    assert.ok(Object.hasOwn(brief.skills, "manual_allowed"));
    assert.ok(Object.hasOwn(brief.skills, "needs_review"));
    assert.ok(Object.hasOwn(brief.skills, "blocked"));
    assert.ok(Object.hasOwn(brief.skills, "not_in_workflow"));
    assert.ok(Object.hasOwn(brief.skills, "installed_only"));
    assert.ok(Array.isArray(brief.sources.units));
    assert.ok(Array.isArray(brief.review_queue));
    assert.equal(brief.cleanup.conservative.dryRun, true);
    assert.equal(brief.cleanup.full_reset.dryRun, true);
  });
});

test("brief schema golden snapshot locks nested initialized contract", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot, root }) => {
    const brief = await buildSkillBrief({ configPath, skillsRoot, root, workflow: "daily-workflow" });

    assert.deepEqual(contractView(brief), EXPECTED_INITIALIZED_CONTRACT);
  });
});

test("brief schema golden snapshot locks source and review queue shape", async () => {
  await withSourceReviewFixture(async ({ configPath, skillsRoot, root }) => {
    const brief = await buildSkillBrief({ configPath, skillsRoot, root, workflow: "daily-workflow" });

    assert.deepEqual(sourceReviewView(brief), EXPECTED_SOURCE_REVIEW_CONTRACT);
  });
});

test("review queue sorts unreviewed install units before unpinned warnings", async () => {
  await withReviewQueueOrderingFixture(async ({ configPath, skillsRoot, root }) => {
    const brief = await buildSkillBrief({ configPath, skillsRoot, root, workflow: "daily-workflow" });

    assert.deepEqual(brief.review_queue.map((entry) => entry.id), [
      "install_unit:matt.pack",
      "source_finding:acme.pack:warning:source-is-not-pinned-by-digest-or-signature",
      "source_finding:matt.pack:warning:source-is-not-pinned-by-digest-or-signature"
    ]);
  });
});

test("brief schema build is byte stable across repeated calls", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot, root }) => {
    const first = JSON.stringify(await buildSkillBrief({ configPath, skillsRoot, root, workflow: "daily-workflow" }));
    const second = JSON.stringify(await buildSkillBrief({ configPath, skillsRoot, root, workflow: "daily-workflow" }));

    assert.equal(second, first);
  });
});

test("brief schema build does not change config bytes or mtime", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot, root }) => {
    const beforeBytes = await readFile(configPath, "utf8");
    const beforeStats = await stat(configPath);

    await buildSkillBrief({ configPath, skillsRoot, root, workflow: "daily-workflow" });

    const afterStats = await stat(configPath);
    assert.equal(await readFile(configPath, "utf8"), beforeBytes);
    assert.equal(afterStats.mtimeMs, beforeStats.mtimeMs);
  });
});

test("brief schema missing config returns expected not-initialized error", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-missing-test-"));
  try {
    const brief = await buildSkillBrief({
      root,
      configPath: join(root, "skillboard.config.yaml"),
      skillsRoot: join(root, "skills")
    });

    assert.equal(brief.ok, false);
    assert.equal(brief.schema_version, 1);
    assert.equal(brief.error.code, "not-initialized");
    assert.match(brief.error.message, /skillboard\.config\.yaml/);
    assert.equal(brief.health.mode, "not-initialized");
    assert.deepEqual(brief.skills.installed_only, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief schema unknown workflow returns expected error payload", async () => {
  await withBriefFixture(async ({ configPath, skillsRoot, root }) => {
    const brief = await buildSkillBrief({ configPath, skillsRoot, root, workflow: "missing-workflow" });

    assert.equal(brief.ok, false);
    assert.equal(brief.error.code, "unknown-workflow");
    assert.equal(brief.workflow.selected, "missing-workflow");
    assert.equal(brief.workflow.unknown, true);
    assert.equal(brief.workflow.needs_selection, false);
    assert.deepEqual(brief.skills.automatic_allowed, []);
    assert.deepEqual(brief.skills.manual_allowed, []);
  });
});

test("brief groups selected workflow classifies human skill groups", async () => {
  await withGroupsFixture(async ({ configPath, skillsRoot, root }) => {
    const brief = await buildSkillBrief({ configPath, skillsRoot, root });
    const groups = groupIds(brief);

    assert.equal(brief.workflow.selected, "daily-workflow");
    assert.equal(brief.workflow.defaulted, true);
    assert.equal(brief.workflow.needs_selection, false);
    assert.deepEqual(Object.keys(brief.skills), [
      "automatic_allowed",
      "manual_allowed",
      "needs_review",
      "blocked",
      "not_in_workflow",
      "installed_only"
    ]);
    assert.deepEqual(groups.automatic_allowed, ["matt.tdd"]);
    assert.deepEqual(groups.manual_allowed, ["user.local-manual"]);
    assert.deepEqual(groups.needs_review, ["omo.runtime"]);
    assert.deepEqual(groups.blocked, ["user.blocked"]);
    assert.deepEqual(groups.not_in_workflow, ["omo.detached", "user.detached"]);
    assert.deepEqual(groups.installed_only, ["installed.only"]);
    assert.equal(allGroupIds(groups).filter((id) => id === "installed.only").length, 1);
    assert.match(brief.skills.needs_review[0].reason, /unreviewed/);
    assert.equal(brief.skills.not_in_workflow[0].advanced.owner_install_unit, "omo.pack");
  });
});

test("brief groups ambiguous workflow requires explicit selection", async () => {
  await withMultiWorkflowGroupsFixture(async ({ configPath, skillsRoot, root }) => {
    const brief = await buildSkillBrief({ configPath, skillsRoot, root });
    const groups = groupIds(brief);

    assert.equal(brief.workflow.selected, null);
    assert.equal(brief.workflow.needs_selection, true);
    assert.deepEqual(brief.workflow.candidates, ["daily-workflow", "research-workflow"]);
    assert.match(brief.workflow.blocked_reason, /Multiple workflows/);
    assert.deepEqual(groups.automatic_allowed, []);
    assert.deepEqual(groups.manual_allowed, []);
    assert.deepEqual(groups.needs_review, []);
    assert.deepEqual(groups.blocked, []);
    assert.deepEqual(groups.not_in_workflow, []);
    assert.deepEqual(groups.installed_only, ["installed.only"]);
    assertNoApplyCommands(brief);
  });
});

test("brief groups unknown workflow returns structured unknown state", async () => {
  await withGroupsFixture(async ({ configPath, skillsRoot, root }) => {
    const brief = await buildSkillBrief({ configPath, skillsRoot, root, workflow: "missing-workflow" });
    const groups = groupIds(brief);

    assert.equal(brief.ok, false);
    assert.equal(brief.error.code, "unknown-workflow");
    assert.equal(brief.workflow.selected, "missing-workflow");
    assert.equal(brief.workflow.unknown, true);
    assert.equal(brief.workflow.needs_selection, false);
    assert.deepEqual(groups.automatic_allowed, []);
    assert.deepEqual(groups.manual_allowed, []);
    assert.deepEqual(groups.needs_review, []);
    assert.deepEqual(groups.blocked, []);
    assert.deepEqual(groups.not_in_workflow, []);
    assert.deepEqual(groups.installed_only, ["installed.only"]);
    assertNoApplyCommands(brief);
  });
});

function groupIds(brief) {
  return Object.fromEntries(
    Object.entries(brief.skills).map(([key, entries]) => [key, entries.map((entry) => entry.id)])
  );
}

function allGroupIds(groups) {
  return Object.values(groups).flat();
}

function assertNoApplyCommands(value) {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Object.hasOwn(value, "apply")) {
    assert.equal(value.apply, null);
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const entry of child) {
        assertNoApplyCommands(entry);
      }
    } else {
      assertNoApplyCommands(child);
    }
  }
}
