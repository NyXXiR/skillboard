import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "skillboard-test-"));
  try {
    const configPath = join(root, "skillboard.config.yaml");
    const skillsRoot = join(root, "skills");
    await mkdir(join(skillsRoot, "tdd"), { recursive: true });
    await mkdir(join(skillsRoot, "grill-with-docs"), { recursive: true });
    await writeFile(
      join(skillsRoot, "tdd", "SKILL.md"),
      "---\nname: tdd\ndescription: Test-first implementation discipline.\n---\n# TDD\n",
      "utf8"
    );
    await writeFile(
      join(skillsRoot, "grill-with-docs", "SKILL.md"),
      "---\nname: matt.grill-with-docs\ndescription: Requirement clarification with durable docs updates.\n---\n# Grill With Docs\n",
      "utf8"
    );
    await writeFile(configPath, CONFIG, "utf8");
    return await run({ configPath, root, skillsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const CONFIG = `
version: 1
defaults:
  invocation_policy: deny-by-default
  allow_model_invocation: false
  require_explicit_workflow: true
skills:
  meerkat.requirement-intake:
    path: requirement-intake
    status: active
    invocation: router-only
    exposure: exported
    category: requirements
    canonical_for:
      - requirement-clarification
  matt.tdd:
    path: tdd
    status: active
    invocation: workflow-auto
    exposure: exported
    category: engineering
  matt.grill-me:
    path: grill-me
    status: vendor
    invocation: manual-only
    exposure: exported
    category: requirements
    replaced_by: meerkat.requirement-intake
capabilities:
  requirement-clarification:
    canonical: meerkat.requirement-intake
    alternatives:
      - matt.grill-me
      - matt.grill-with-docs
    default_policy: router-only
  test-first-implementation:
    canonical: matt.tdd
    alternatives:
      - meerkat.test-first-implementation
    default_policy: workflow-auto
harnesses:
  codex:
    status: primary
    workflows:
      - codex-night-workflow
  lazycodex:
    status: primary
    workflows:
      - large-refactor-workflow
    commands:
      - $ulw-plan
      - $start-work
workflows:
  codex-night-workflow:
    harness: codex
    active_skills:
      - meerkat.requirement-intake
      - matt.tdd
    blocked_skills:
      - matt.grill-me
    required_outputs:
      - test_result_or_reason
    required_capabilities:
      test-first-implementation:
        preferred: matt.tdd
        fallback:
          - meerkat.test-first-implementation
        policy: workflow-auto
`;
