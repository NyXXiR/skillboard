# SkillBoard

Use the right AI-agent skills without managing another checklist.

Ask your AI normal questions: "what skills can you use?", "which skill should
write tests first?", or "can you make this reviewed skill available here?"
SkillBoard runs behind the scenes so you get the benefit: the right allowed
skill, a short disclosure of what was used, and fewer setup interruptions.

The burden stays low:

- No global install is required; use `npx --yes --package agent-skillboard`.
- Most use is read-only: `brief`, `route`, `doctor`, and `guard use` answer
  what is safe now.
- Nothing changes until you approve a policy action.
- Project cleanup is conservative and previewable with `skillboard uninstall --dry-run`.

Under the hood, SkillBoard is workflow-scoped skill policy and routing for AI
agents. It separates `installed` from `allowed`, checks workflow policy and
guard state before use, and leaves a clear record of which skill influenced the
answer.

Start with normal requests:

- "What skills can you use in this project?"
- "Which skill should you use to write tests first?"
- "Can you make `anthropic.docx` available for this workflow?"
- "Why is this skill blocked?"

Your AI runs SkillBoard behind the scenes, reads the current brief, checks the
guard automatically before invoking an allowed skill, and asks only before
policy-changing actions. For already-allowed skills, it should say which skill
it is about to use and which skill it used, not interrupt you for another
approval. That disclosure is an audit trace, not a permission prompt. You do
not need to memorize the SkillBoard command loop.

A normal allowed-skill turn can look like this:

- You: "Which skill should you use to write tests first?"
- AI: "I will use matt.tdd for this request."
- AI: "I used matt.tdd for this request."

Names you may see in setup and logs:

- `SkillBoard`: the product and policy model.
- `agent-skillboard`: the npm package.
- `skillboard`: the CLI binary.

Use SkillBoard when your agent setup has grown beyond one trusted skill folder
and you want workflow-scoped control without turning skill governance into a
manual checklist. If you are changing routing, brief, bridge, policy, or
workflow UX, read [AI Skill Routing Goal](docs/ai-skill-routing-goal.md) first;
it defines the non-blocking `observe → route → work → explain briefly → ask
after → remember policy` loop that development should preserve.

<p align="center">
  <img src="https://raw.githubusercontent.com/NyXXiR/skillboard/main/skillboard.png" alt="SkillBoard architecture diagram: sources, inventory scanner, SkillBoard model, policy engine, and user and agent surfaces." width="100%">
</p>

## Why Not Just List `/skills`?

A raw skill list answers what is declared. SkillBoard answers what can safely
run now.

Same fixture, different answer:

| Raw skill list | SkillBoard brief |
| --- | --- |
| `matt.tdd active workflow-auto` | `AI can use now: 0` |
| no policy health | `Blocked for safety: 8`, `Policy errors: 2` |

That gap is the product. SkillBoard separates `installed` from `allowed`,
checks policy health, and gives agents a brief they can use without guessing
from raw `SKILL.md` files. The same proof also routes "write tests before
implementation" to `matt.tdd`, returns `private.tdd-work-continuity` as the
fallback, and gives the AI exact start and finish disclosure text.

See [Tested Value Proof](#tested-value-proof) for the executable proof.

## 5-Minute Quick Start

Ask your AI to set up SkillBoard in the project you want to manage. The AI runs
SkillBoard behind the scenes, then answers from the generated brief instead of
from memory or raw skill files.

Use without a global install:

AI/automation/operator details:

```bash
npx --yes --package agent-skillboard skillboard init
npx --yes --package agent-skillboard skillboard doctor --summary
npx --yes --package agent-skillboard skillboard brief --workflow <workflow-from-init>
```

`init` creates the local control-plane files, scans known local skill roots,
and writes agent bridge instructions. It prints the workflows it found and a
copyable workflow-scoped `brief` command. If `init` does not print a workflow,
run the unscoped `brief` command it prints instead. Trusted user-local skills
start as manual-only. Runtime, plugin, and external skills stay quarantined or
blocked until reviewed. The explicit package/binary spelling avoids an extra npx
install prompt and keeps the `skillboard` executable name clear.

Remove the project bridge when you are done:

```bash
npx --yes --package agent-skillboard skillboard uninstall --dir /path/to/your/project --dry-run
npx --yes --package agent-skillboard skillboard uninstall --dir /path/to/your/project
```

Uninstall preserves local skills and policy files by default, and reports what
it removed or preserved.

See [docs/install.md](docs/install.md) for global installs, `--dir`, GitHub
builds, clone-based development, Hermes bridge setup, refresh, and uninstall.

## What SkillBoard Gives You

- Inventory that separates installed skills from callable skills.
- Workflow-scoped policy instead of global "everything is active" behavior.
- `brief`, `route`, `can-use`, and `guard use` surfaces for AI-mediated selection and availability.
- Workflow conflict checks so overlapping skills cannot quietly degrade an answer.
- Action cards that apply one approved policy change, then re-resolve state.
- Source and install-unit review for plugins, hooks, MCP servers, harnesses,
  commands, LSPs, and package-manager dependencies.
- Impact, reconcile, rollout, and dashboard output before cleanup or migration.
- Manual skill variant lifecycle for relationships such as `a -> claude.a`,
  with draft, approval, drift, and reset checkpoints.

SkillBoard is deny-by-default. Installing a skill does not make it automatically
callable. A workflow, source, and invocation decision must make that explicit.
For action cards, use `skillboard apply-action <action-id> --yes --json`; raw
`skillboard hook install ... --dry-run --json` previews are underlying manual
operator detail, not the primary action-card flow.

## What Works Today

SkillBoard currently supports:

- YAML policy config parsing and semantic checks.
- Recursive `SKILL.md` discovery.
- Source-profile import for cloned or installed skill repositories.
- Agent runtime install-unit inventory when manifest metadata is available.
- Markdown dashboard and machine-readable brief generation.
- Disable-impact analysis and reconcile plans.
- Workflow-scoped activation, blocking, preference, and guard checks.
- Action-card approval and post-apply brief refresh.
- Manual variant registration, fork, status, approval, and reset.

For the full command catalog and config shape, use
[docs/reference.md](docs/reference.md).

## Tested Value Proof

A raw list says `matt.tdd` is active. SkillBoard says the same workflow has 0
usable skills because policy health fails.

| Question | Raw list | SkillBoard brief |
| --- | --- | --- |
| Does `matt.tdd` look enabled? | `active`, `workflow-auto` | blocked by policy health |
| Can the agent safely use anything now? | not answered | 0 usable skills, 8 blocked skills |
| Why? | not answered | `Policy errors: 2`, `Policy warnings: 1` |

The action-card flow is tested too. Applying
`activate-skill:anthropic.docx` in a temporary project changes the next brief
from 2 usable skills to 3 and moves `anthropic.docx` into the manual-allowed
set. SkillBoard applies one approved change, then re-resolves the next state.

Run the proof with:

```bash
node --test test/readme-value-proof.test.mjs
```

See the [full reproducible proof](docs/value-proof.md) for exact commands,
fixtures, and assertions.

## Where To Go Next

- [AI skill routing goal](docs/ai-skill-routing-goal.md)
- [Install and bootstrap](docs/install.md)
- [First-time control flow](docs/user-flow.md)
- [Capability routing](docs/routing.md)
- [Command and config reference](docs/reference.md)
- [Policy model](docs/policy-model.md)
- [Capabilities](docs/capabilities.md)
- [Skill variant lifecycle](docs/variant-lifecycle.md)
- [Value proof](docs/value-proof.md)
- [Source-profile adapters](docs/adapters.md)
- [Rollout runbook](docs/rollout-runbook.md)
- [Versioning and release rules](docs/versioning.md)
- [Contributing](CONTRIBUTING.md)
