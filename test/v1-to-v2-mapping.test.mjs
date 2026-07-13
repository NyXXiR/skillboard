import assert from "node:assert/strict";
import test from "node:test";

import { EXPOSURE_VALUES, INVOCATION_VALUES, STATUS_VALUES } from "../src/domain/constants.mjs";
import { SKILL_STATE_MATRIX, isValidSkillState } from "../src/domain/skill-state-matrix.mjs";
import { mapV1ConfigToV2 } from "../src/migration/v1-to-v2.mjs";

test("baseline: the v1 state matrix accepts exactly its declared status and invocation pairs", () => {
  // Given: every status and invocation exposed by the v1 schema.
  const actual = [];

  // When: the existing matrix classifies the Cartesian product.
  for (const status of STATUS_VALUES) {
    for (const invocation of INVOCATION_VALUES) {
      if (isValidSkillState(status, invocation)) actual.push(`${status}:${invocation}`);
    }
  }

  // Then: only the pairs explicitly declared by the existing domain matrix pass.
  const expected = Object.entries(SKILL_STATE_MATRIX)
    .flatMap(([status, invocations]) => invocations.map((invocation) => `${status}:${invocation}`));
  assert.deepEqual(actual.sort(), expected.sort());
  assert.equal(actual.length, 23);
  assert.equal(EXPOSURE_VALUES.size, 4);
});

const terminal = new Set(["blocked", "deprecated", "archived", "removed"]);

test("maps every legal status/invocation/exposure combination deterministically", () => {
  // Given: each legal v1 state paired with every exposure value.
  for (const [status, invocations] of Object.entries(SKILL_STATE_MATRIX)) {
    for (const invocation of invocations) {
      for (const exposure of EXPOSURE_VALUES) {
        const input = fixture({ status, invocation, exposure });

        // When: the same input is mapped twice.
        const first = mapV1ConfigToV2(input);
        const second = mapV1ConfigToV2(input);

        // Then: terminal status alone disables and exposure never changes availability.
        assert.deepEqual(first, second);
        assert.equal(first.policy.skills.demo.enabled, !terminal.has(status));
        assert.equal(first.policy.skills.demo.shared, false);
        assert.match(JSON.stringify({ observations: first.inventory, losses: first.losses }), new RegExp(exposure));
      }
    }
  }
});

test("rejects every invalid v1 status and invocation pair", () => {
  // Given: the complete invalid portion of the v1 Cartesian product.
  for (const status of STATUS_VALUES) {
    for (const invocation of INVOCATION_VALUES) {
      if (isValidSkillState(status, invocation)) continue;

      // When/Then: mapping fails at the v1 boundary with the skill identity.
      assert.throws(
        () => mapV1ConfigToV2(fixture({ status, invocation })),
        /demo.*status.*invocation|demo.*must use/s
      );
    }
  }
});

test("workflow blocks remain migration observations and do not become sharing policy", () => {
  // Given: one skill blocked in one of three current workflows.
  const input = fixture({
    workflows: {
      zebra: workflow(),
      alpha: workflow({ active_skills: ["demo"] }),
      middle: workflow({ blocked_skills: ["demo"] })
    }
  });

  // When: the config is mapped.
  const result = mapV1ConfigToV2(input);

  // Then: workflow-local decisions do not fabricate cross-agent sharing policy.
  assert.deepEqual(result.policy.skills.demo, { enabled: true, shared: false });
  assert.match(JSON.stringify(result.losses), /blocked_skills/);

  const allBlocked = fixture({
    workflows: { alpha: workflow({ blocked_skills: ["demo"] }) }
  });
  assert.deepEqual(mapV1ConfigToV2(allBlocked).policy.skills.demo, { enabled: true, shared: false });
});

test("positive workflow bindings preserve preferences without enabling sharing", () => {
  // Given: positive bindings through every supported workflow role.
  const input = fixture({
    workflows: {
      zeta: workflow({ required_capabilities: { intent: { preferred: "demo", fallback: [], policy: "workflow-auto" } } }),
      beta: workflow({ required_capabilities: { intent: { preferred: "other", fallback: ["demo"], policy: "workflow-auto" } } }),
      alpha: workflow({ active_skills: ["demo"] }),
      unused: workflow()
    }
  });

  const policy = mapV1ConfigToV2(input).policy.skills.demo;
  assert.equal(policy.shared, false);
  assert.deepEqual(policy.preference, { intents: ["intent"], priority: 100 });
});

test("global-auto does not opt a skill into cross-agent sharing", () => {
  // Given: an enabled global-auto skill with a workflow binding.
  const input = fixture({ invocation: "global-auto", workflows: { alpha: workflow({ active_skills: ["demo"] }) } });

  // When/Then: legacy invocation is not reinterpreted as file propagation.
  assert.equal(mapV1ConfigToV2(input).policy.skills.demo.shared, false);
});

test("capability roles become intent preferences and the maximum priority wins", () => {
  // Given: the skill occupies canonical, preferred, alternative, and indexed fallback roles.
  const input = fixture({
    capabilities: {
      "canonical-intent": { canonical: "demo", alternatives: [], default_policy: "router-only" },
      "alternative-intent": { canonical: "other", alternatives: ["demo"], default_policy: "router-only" },
      "fallback-intent": { canonical: "other", alternatives: [], default_policy: "router-only" }
    },
    workflows: {
      beta: workflow({ required_capabilities: { "fallback-intent": { preferred: "other", fallback: ["x", "demo"], policy: "router-only" } } }),
      alpha: workflow({ required_capabilities: { "preferred-intent": { preferred: "demo", fallback: [], policy: "router-only" } } })
    }
  });

  // When/Then: capability names become sorted intents and max(canonical/preferred)=100.
  assert.deepEqual(mapV1ConfigToV2(input).policy.skills.demo.preference, {
    intents: ["alternative-intent", "canonical-intent", "fallback-intent", "preferred-intent"],
    priority: 100
  });
});

test("fallback priority is 90 minus its zero-based index and alternative priority is 50", () => {
  // Given: one fallback-only skill and one alternative-only migration.
  const fallback = fixture({
    workflows: { alpha: workflow({ required_capabilities: { build: { preferred: "other", fallback: ["x", "y", "demo"], policy: "router-only" } } }) }
  });
  const alternative = fixture({ capabilities: { build: { canonical: "other", alternatives: ["demo"], default_policy: "router-only" } } });

  // When/Then: their exact role priorities are retained.
  assert.equal(mapV1ConfigToV2(fallback).policy.skills.demo.preference.priority, 88);
  assert.equal(mapV1ConfigToV2(alternative).policy.skills.demo.preference.priority, 50);
});

test("trust, source, owner enablement, digest, aliases, and unknown skill metadata are observational only", () => {
  // Given: availability-equivalent configs spanning every trust observation.
  for (const trust_level of ["trusted", "reviewed", "unreviewed", "blocked"]) {
    const input = fixture({
      skill: {
        source_aliases: [{ owner_install_unit: "alias.unit", path: "alias/demo" }],
        custom_future_metadata: { preserved: true }
      },
      install_units: {
        "demo.unit": {
          kind: "plugin", source: "https://example.invalid/demo", enabled: false,
          trust_level, source_digest: "sha256:deadbeef", permission_risk: "high"
        }
      }
    });

    // When: metadata and trust vary.
    const result = mapV1ConfigToV2(input);

    // Then: policy stays enabled and local while raw observations and losses retain them.
    assert.deepEqual(result.policy.skills.demo, { enabled: true, shared: false });
    assert.deepEqual(result.inventory.skills[0].aliases, [{ owner_install_unit: "alias.unit", path: "alias/demo" }]);
    assert.deepEqual(result.inventory.skills[0].observations.custom_future_metadata, { preserved: true });
    const audit = JSON.stringify({ inventory: result.inventory, losses: result.losses });
    assert.doesNotMatch(audit, /raw_metadata/);
    for (const value of [trust_level, "https://example.invalid/demo", "sha256:deadbeef", "demo.unit", "false"]) {
      assert.match(audit, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
});

test("groups review-only quarantine provenance uncertainty into one migration decision", () => {
  // Given: two discovery-style quarantine states and one explicit terminal denial.
  const input = fixture({ status: "quarantined", invocation: "blocked" });
  input.skills.alpha = {
    ...input.skills.demo,
    path: "alpha"
  };
  input.skills.denied = {
    ...input.skills.demo,
    path: "denied",
    status: "blocked"
  };

  // When: v1 policy is projected into v2.
  const result = mapV1ConfigToV2(input);

  // Then: review-only uncertainty stays enabled but is surfaced once at the grouped apply boundary.
  assert.deepEqual(result.ambiguities, [{
    kind: "review_only_quarantine",
    skill_ids: ["alpha", "demo"],
    mapped_enabled: true,
    requires_grouped_confirmation: true
  }]);
  assert.equal(result.policy.skills.alpha.enabled, true);
  assert.equal(result.policy.skills.demo.enabled, true);
  assert.equal(result.policy.skills.denied.enabled, false);
});

test("inventory observations preserve aliases and extensions without raw policy duplication", () => {
  // Given: a skill with core location, aliases, and future extension metadata.
  const input = fixture({
    skill: {
      source_aliases: [{ owner_install_unit: "alias.unit", path: "alias/demo" }],
      x_extension: { retained: true }
    }
  });

  // When: the mapper builds audit observations.
  const result = mapV1ConfigToV2(input);

  // Then: policy fields are absent from inventory while audit data remains explicit.
  assert.deepEqual(result.inventory.skills[0], {
    id: "demo",
    path: "demo",
    owner_install_unit: "demo.unit",
    aliases: [{ owner_install_unit: "alias.unit", path: "alias/demo" }],
    installed_on: [],
    observations: {
      category: "test",
      x_extension: { retained: true }
    }
  });
  assert.doesNotMatch(JSON.stringify(result.inventory), /raw_metadata|"status"|"invocation"|"exposure"/);
});

test("does not mutate input and rejects malformed input", () => {
  // Given: a frozen-shape snapshot and malformed boundary values.
  const input = fixture({ skill: { unknown: ["retain-me"] } });
  const before = structuredClone(input);

  // When: mapping succeeds.
  mapV1ConfigToV2(input);

  // Then: caller-owned input is byte-for-byte equivalent and malformed roots fail.
  assert.deepEqual(input, before);
  assert.throws(() => mapV1ConfigToV2(null), /v1 config.*object/i);
  assert.throws(() => mapV1ConfigToV2({ version: 2, skills: {}, workflows: {} }), /version 1/i);
  assert.throws(() => mapV1ConfigToV2({ version: 1, skills: [] }), /skills.*mapping/i);
});

function fixture(options = {}) {
  const skill = {
    path: "demo",
    status: options.status ?? "active",
    invocation: options.invocation ?? "manual-only",
    exposure: options.exposure ?? "exported",
    category: "test",
    owner_install_unit: "demo.unit",
    ...(options.skill ?? {})
  };
  return {
    version: 1,
    defaults: { invocation_policy: "deny-by-default", allow_model_invocation: false },
    skills: { demo: skill },
    capabilities: options.capabilities ?? {},
    harnesses: {},
    install_units: options.install_units ?? {},
    workflows: options.workflows ?? {}
  };
}

function workflow(overrides = {}) {
  return {
    harness: "codex",
    active_skills: [],
    blocked_skills: [],
    required_capabilities: {},
    ...overrides
  };
}
