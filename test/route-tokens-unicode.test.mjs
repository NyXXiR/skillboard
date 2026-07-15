import assert from "node:assert/strict";
import { test } from "node:test";
import { routeSkill } from "../src/route.mjs";
import { phraseKey, tokensFor } from "../src/route-tokens.mjs";
import { loadWorkspace } from "../src/workspace.mjs";
import { withKoreanRouteFixture } from "./helpers/korean-route-fixture.mjs";

test("tokensFor keeps CJK runs and emits character bigrams", () => {
  const tokens = tokensFor("유튜브 쇼츠 영상 제작");

  assert.deepEqual([...tokens], ["유튜브", "유튜", "튜브", "쇼츠", "영상", "제작"]);
  assert.equal(tokens.has(""), false);
});

test("CJK bigrams keep particle-bearing intent terms comparable", () => {
  const intentTokens = tokensFor("쇼츠를 만들어줘");
  const metadataTokens = tokensFor("쇼츠 제작");
  const overlap = [...intentTokens].filter((token) => metadataTokens.has(token));

  assert.deepEqual(overlap, ["쇼츠"]);
});

test("ASCII token and phrase-key behavior remains byte-identical", () => {
  const tokens = tokensFor("YouTube Shorts videos");

  assert.deepEqual([...tokens], ["youtube", "shorts", "short", "videos", "video"]);
  assert.equal(phraseKey("YouTube Shorts videos"), "youtube shorts short videos video");
});

test("single CJK characters survive while single ASCII letters remain filtered", () => {
  assert.deepEqual([...tokensFor("봇")], ["봇"]);
  assert.deepEqual([...tokensFor("x")], []);
});

test("Korean, English, and mixed intents route without unrelated Korean false positives", async () => {
  await withKoreanRouteFixture(async ({ configPath, skillsRoot }) => {
    const workspace = await loadWorkspace({ configPath, skillsRoot });
    for (const intent of [
      "유튜브 쇼츠 영상 제작",
      "create a youtube shorts video",
      "쇼츠 video 만들기"
    ]) {
      const result = routeSkill(workspace, {
        intent,
        workflow: "codex-local-manual",
        configPath,
        skillsRoot
      });
      assert.equal(result.recommended_skill, "openmontage-qwen-shorts", intent);
    }

    const unrelated = routeSkill(workspace, {
      intent: "회의록 요약",
      workflow: "codex-local-manual",
      configPath,
      skillsRoot
    });
    assert.equal(unrelated.recommended_skill, null);
  });
});
