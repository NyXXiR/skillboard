import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { initProject } from "../src/index.mjs";
import { bridgeBlock } from "../src/lifecycle-content.mjs";

const execFileAsync = promisify(execFile);
const HOOK_ACTION_CARD_DOCS = [
  "README.md",
  "docs/install.md",
  "docs/user-flow.md",
  "src/lifecycle-content.mjs"
];

test("markdown docs are checked out with LF endings on Windows", async () => {
  const attributes = await readFile(".gitattributes", "utf8");

  assert.match(attributes, /^\*\.md\s+text\s+eol=lf$/m);

  for (const file of ["AGENTS.md", "CLAUDE.md"]) {
    assert.match(attributes, new RegExp(`^${escapeRegExp(file)}\\s+text\\s+eol=lf$`, "m"));
  }
});

test("brief docs bridge orders brief before guard and confirmation before apply", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-docs-bridge-"));
  try {
    await initProject({ root, scanInstalled: false });
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    const bridge = bridgeBlock();
    const currentAgents = await readFile("AGENTS.md", "utf8");
    const currentClaude = await readFile("CLAUDE.md", "utf8");

    for (const [name, text] of [
      ["generated AGENTS.md", agents],
      ["generated CLAUDE.md", claude],
      ["root AGENTS.md", currentAgents],
      ["root CLAUDE.md", currentClaude]
    ]) {
      assert.equal(text, `${bridge}\n`, `${name} must match bridgeBlock()`);
    }

    for (const text of [agents, claude, bridge, currentAgents, currentClaude]) {
      assertGeneratedBridgeIntentDriven(text);
      assertApprovalLoop(text);
      assert.match(text, /action card/i);
      assert.match(text, /raw action-card shell text/i);
      for (const heading of ["What your AI can use now", "Needs your decision", "Blocked for safety"]) {
        assert.match(text, new RegExp(escapeRegExp(heading)));
      }
      assert.match(text, /one-time decision queue/i);
      assert.doesNotMatch(text, /What needs review|What is blocked for safety/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief docs keep raw hook commands out of the action-card primary flow", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-docs-hook-preview-"));
  try {
    await initProject({ root, scanInstalled: false });
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    const bridge = bridgeBlock();
    const docsByFile = await readDocsByFile(HOOK_ACTION_CARD_DOCS);

    for (const text of [agents, claude, bridge, ...docsByFile.values()]) {
      assert.match(text, /apply-action <action-id>[\s\S]*--yes[\s\S]*--json/i);
      assert.match(text, /hook install[\s\S]*--dry-run --json/i);
      assert.match(text, /underlying|manual/i);
      assert.doesNotMatch(text, /For hook action cards specifically[\s\S]*same command without/i);
      assert.doesNotMatch(text, /For hook action cards specifically,\s*run\s+`?skillboard hook install/i);
    }

    for (const [file, text] of docsByFile) {
      assertNoStaleRawHookPrimaryFlow(file, text);
      assertHookDryRunApplySequencesAreFramed(file, text);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief docs mention AI-mediated flow and lifecycle safety terms", async () => {
  const files = [
    "README.md",
    "docs/install.md",
    "docs/user-flow.md",
    "docs/policy-model.md",
    "src/lifecycle-content.mjs"
  ];
  const text = await combinedText(files);

  for (const term of ["brief --json", "What your AI can use", "Needs your decision", "confirmation", "action card", "remove-hooks"]) {
    assert.match(text, new RegExp(escapeRegExp(term), "i"));
  }
  assertApprovalLoop(text);
  assert.match(text, /apply-action <action-id>[\s\S]*--yes[\s\S]*--json/i);
  assert.match(text, /post-apply brief/i);
  assert.match(text, /stale action|re-resol/i);
  assert.doesNotMatch(text, /auto-trust|auto trust|deletes.*SKILL\.md|delete.*SKILL\.md/i);
});

test("brief docs help teaches the disclosure-first control loop", async () => {
  const result = await execFileAsync(process.execPath, ["bin/skillboard.mjs", "help"]);

  assert.match(result.stdout, /brief \[--workflow <name>\]/);
  assert.match(result.stdout, /apply-action <action-id>/);
  assert.match(result.stdout, /AI\/automation control loop:/);
  assert.doesNotMatch(result.stdout, /AI\/automation approval loop:/);
  assert.match(result.stdout, /For an already-allowed skill, disclose the selected skill at start and completion/i);
  assert.match(result.stdout, /do not ask for another approval/i);
  assert.match(result.stdout, /Translate a user's skill request into the current brief/i);
  assert.match(result.stdout, /current action id/i);
  assert.match(result.stdout, /docs\/ai-skill-routing-goal\.md/);
  assert.match(result.stdout, /non-blocking AI skill routing control plane/i);
  assert.match(result.stdout, /observe → route → work → explain briefly → ask after → remember policy/i);
  assert.match(result.stdout, /one confirmation/i);
  assertApprovalLoop(result.stdout);
});

test("generated bridge tells agents to use routed skill first and ask after completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-docs-ask-after-"));
  try {
    await initProject({ root, scanInstalled: false });
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    const bridge = bridgeBlock();
    const routingDocs = await readFile("docs/routing.md", "utf8");

    for (const text of [agents, claude, bridge]) {
      assert.match(text, /work first with the allowed routed skill/i);
      assert.match(text, /ask after completion whether to remember the suggested policy/i);
      assert.match(text, /For an already-allowed skill, do not ask for another approval/i);
      assert.match(text, /Run `skillboard guard use <skill-id>[\s\S]*automatically/i);
    }
    assert.match(routingDocs, /multiple\s+allowed workflow-bound skills match/i);
    assert.match(routingDocs, /keep the task moving with the allowed routed\s+skill/i);
    assert.match(routingDocs, /suggested policy command is informational until the user\s+confirms it/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bridge text does not ask before guard-allowed routed skill use", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillboard-brief-docs-no-preprompt-"));
  try {
    await initProject({ root, scanInstalled: false });
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    const claude = await readFile(join(root, "CLAUDE.md"), "utf8");
    const bridge = bridgeBlock();
    const docs = await combinedText(["docs/routing.md", "docs/user-flow.md", "docs/install.md"]);

    for (const text of [agents, claude, bridge, docs]) {
      assert.doesNotMatch(text, /infer availability from raw `?SKILL\.md`? bodies/i);
      assert.doesNotMatch(text, /ask (?:the user )?for approval when the guard allows/i);
      assert.doesNotMatch(text, /ask before ordinary allowed skill use/i);
    }
    assert.match(`${agents}\n${claude}\n${bridge}\n${docs}`, /do not ask for another approval/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function combinedText(files) {
  const parts = [];
  for (const file of files) {
    parts.push(await readFile(file, "utf8"));
  }
  return parts.join("\n");
}

async function readDocsByFile(files) {
  const docsByFile = new Map();
  for (const file of files) {
    docsByFile.set(file, await readFile(file, "utf8"));
  }
  return docsByFile;
}

function assertNoStaleRawHookPrimaryFlow(file, text) {
  const stalePatterns = [
    /Preview hook installs with `--dry-run --json`[\s\S]{0,220}same command without/i,
    /Inspect the JSON `planned\.preview\.shell`[\s\S]{0,160}applying the second command/i,
    /For hook action cards specifically,\s*run\s+`?skillboard hook install/i
  ];

  for (const pattern of stalePatterns) {
    assert.doesNotMatch(text, pattern, `${file} teaches stale raw hook primary flow`);
  }
}

function assertHookDryRunApplySequencesAreFramed(file, text) {
  const commands = hookInstallCommands(text);

  for (let index = 0; index < commands.length; index += 1) {
    const dryRunCommand = commands[index];
    if (!dryRunCommand.isDryRun) {
      continue;
    }

    const applyCommand = commands
      .slice(index + 1)
      .find((candidate) => !candidate.isDryRun && candidate.startLine - dryRunCommand.endLine <= 6);
    if (!applyCommand) {
      continue;
    }

    const windowText = localLineWindow(text, dryRunCommand.startLine, applyCommand.endLine);
    const location = `${file}:${dryRunCommand.startLine + 1}`;
    assert.match(
      windowText,
      /apply-action <action-id>[\s\S]{0,260}--yes[\s\S]{0,120}--json/i,
      `${location} raw hook apply sequence needs nearby apply-action framing`
    );
    assert.match(
      windowText,
      /underlying|manual|operator/i,
      `${location} raw hook apply sequence must be framed as manual or underlying detail`
    );
    assert.doesNotMatch(
      windowText,
      /applying the (?:same|second) command|same command without/i,
      `${location} raw hook apply sequence must not be presented as the primary apply step`
    );
  }
}

function hookInstallCommands(text) {
  const lines = text.split(/\r?\n/);
  const commands = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bhook install\b/.test(lines[index])) {
      continue;
    }

    let endLine = index;
    const commandLines = [lines[index]];
    while (commandLines.at(-1).trimEnd().endsWith("\\") && endLine + 1 < lines.length) {
      endLine += 1;
      commandLines.push(lines[endLine]);
    }

    const commandText = commandLines.join("\n");
    commands.push({
      endLine: endLine + 1,
      isDryRun: /--dry-run(?:\s|$)/.test(commandText),
      startLine: index
    });
    index = endLine;
  }

  return commands;
}

function localLineWindow(text, startLine, endLine) {
  const lines = text.split(/\r?\n/);
  const firstLine = Math.max(0, startLine - 8);
  const lastLine = Math.min(lines.length, endLine + 8);
  return lines.slice(firstLine, lastLine).join("\n");
}

function assertApprovalLoop(text) {
  let cursor = 0;
  cursor = assertMatchAfter(text, /skillboard brief --json/i, cursor);
  cursor = assertMatchAfter(text, /action id/i, cursor);
  cursor = assertMatchAfter(text, /confirmation/i, cursor);
  cursor = assertMatchAfter(text, /skillboard apply-action <action-id>[\s\S]{0,260}--yes[\s\S]{0,120}--json/i, cursor);
  cursor = assertMatchAfter(text, /post-apply brief/i, cursor);
  assertMatchAfter(text, /skillboard guard use/i, cursor);
}

function assertGeneratedBridgeIntentDriven(text) {
  assert.match(text, /BEGIN SKILLBOARD/);
  assert.match(text, /answer skill availability questions from SkillBoard/i);
  assert.match(text, /translate user intent into current action ids/i);
  assert.match(text, /brief --intent <request>/i);
  assert.match(text, /assistant_guidance\.route/);
  assert.match(text, /recommended_skill/);
  assert.match(text, /fallback_skills/);
  assert.match(text, /route_candidates/);
  assert.match(text, /post_use_policy_suggestion/);
  assert.match(text, /guard_command/);
  assert.match(text, /ask after completion whether to\s+remember the suggested\s+policy/i);
  assert.match(text, /I will use <skill-id> for this request\./);
  assert.match(text, /I used <skill-id> for this request\./);
  assert.match(text, /ask a clarifying question/i);
  assert.match(text, /ask for one confirmation/i);
  assert.match(text, /apply one current action/i);
  assert.match(text, /reread the post-apply brief/i);
  assert.match(text, /run the guard automatically before invocation/i);
  assert.match(text, /audit trace,\s+not a permission prompt/i);
  assert.match(text, /current brief/i);
  assert.match(text, /do not apply cached or stale action ids/i);
  assert.match(text, /do not infer availability from `SKILL\.md` bodies/i);
}

function assertMatchAfter(text, pattern, startIndex) {
  const match = pattern.exec(text.slice(startIndex));
  assert.notEqual(match, null, `missing ${pattern} after offset ${startIndex}`);
  return startIndex + match.index + match[0].length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
