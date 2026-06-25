import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionByKindAndTarget,
  actionsByKind,
  assertCommandObject,
  assertNoBareCommandStrings,
  parsedBrief,
  pathExists,
  withActionsFixture,
  withMissingProvenanceFixture
} from "./helpers/advisor-brief-actions.mjs";

test("brief actions reviewed mattpocock skill can be activated with command objects", async () => {
  await withActionsFixture(async (paths) => {
    const brief = await parsedBrief(paths, { workflow: "agent" });
    const action = actionByKindAndTarget(brief, "activate-skill", "matt.tdd");

    assert.ok(action);
    assert.ok(["medium", "high"].includes(action.risk));
    assert.equal(action.requires_user_confirmation, true);
    assertCommandObject(action.dry_run);
    assertCommandObject(action.apply);
    assert.ok(action.dry_run.argv.includes("--dry-run"));
    assertNoBareCommandStrings(brief.actions);
  });
});

test("brief actions unreviewed OMO source gets review action before activation", async () => {
  await withActionsFixture(async (paths) => {
    const brief = await parsedBrief(paths, { workflow: "agent" });
    const reviewAction = actionByKindAndTarget(brief, "review-install-unit", "omo.pack");
    const omoActivate = actionByKindAndTarget(brief, "activate-skill", "omo.runtime");

    assert.ok(brief.review_queue.some((entry) => entry.id === "install_unit:omo.pack"));
    assert.ok(reviewAction);
    assert.equal(reviewAction.requires_user_confirmation, true);
    assertCommandObject(reviewAction.dry_run);
    assertCommandObject(reviewAction.apply);
    assert.equal(omoActivate?.apply ?? null, null);
  });
});

test("brief actions ambiguous workflow removes every apply boundary", async () => {
  await withActionsFixture(async (paths) => {
    const brief = await parsedBrief(paths);

    assert.equal(brief.workflow.selected, null);
    assert.equal(brief.workflow.needs_selection, true);
    assert.ok(brief.actions.length > 0);
    for (const action of brief.actions) {
      assert.equal(action.apply, null);
    }
  });
});

test("brief actions missing provenance blocks trust and activation apply commands", async () => {
  await withMissingProvenanceFixture(async (paths) => {
    const brief = await parsedBrief(paths, { workflow: "agent" });
    const action = actionByKindAndTarget(brief, "activate-skill", "broken.auto");

    assert.ok(action);
    assert.equal(action.apply, null);
    assert.equal(action.dry_run, null);
    assert.match(action.blocked_reason, /owner_install_unit|provenance/i);
    assert.equal(actionsByKind(brief, "review-install-unit").length, 0);
  });
});

test("brief actions hook install is a dry-run-backed command suggestion only", async () => {
  await withActionsFixture(async (paths) => {
    const brief = await parsedBrief(paths, { workflow: "agent" });
    const [action] = actionsByKind(brief, "hook-install");

    assert.ok(action);
    assertCommandObject(action.dry_run);
    assertCommandObject(action.apply);
    assert.ok(action.dry_run.argv.includes("hook"));
    assert.ok(action.dry_run.argv.includes("install"));
    assert.ok(action.dry_run.argv.includes("--dry-run"));
    assert.ok(action.apply.argv.includes("hook"));
    assert.ok(action.apply.argv.includes("install"));
    assert.equal(await pathExists(`${paths.root}/.skillboard/hooks/skillboard-guard-agent.sh`), false);
  });
});

test("brief actions force remove and reset cleanup require high-risk confirmation", async () => {
  await withActionsFixture(async (paths) => {
    const brief = await parsedBrief(paths, { workflow: "agent" });
    const removeAction = actionByKindAndTarget(brief, "remove-skill-force", "user.blocked");
    const [resetAction] = actionsByKind(brief, "reset-cleanup");

    for (const action of [removeAction, resetAction]) {
      assert.ok(action);
      assert.equal(action.requires_user_confirmation, true);
      assert.ok(["high", "destructive"].includes(action.risk));
      assertCommandObject(action.dry_run);
    }
  });
});

test("brief actions have deterministic ids and ordering", async () => {
  await withActionsFixture(async (paths) => {
    const first = await parsedBrief(paths, { workflow: "agent" });
    const second = await parsedBrief(paths, { workflow: "agent" });

    assert.deepEqual(second.actions.map((action) => action.id), first.actions.map((action) => action.id));
    assert.equal(JSON.stringify(second.actions), JSON.stringify(first.actions));
  });
});
