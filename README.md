# SkillBoard

Keep AI-agent skills broadly available, then route overlaps consistently.

If you use more than one coding agent, skill pack, plugin, MCP tool, or
marketplace, SkillBoard answers the practical questions before you install
anything or change workflow policy: which skills are usable now, which one
should win when skills overlap, which external skills need review, and how
Codex, Claude, OpenCode, and Hermes can follow the same policy.

Ask your AI normal work requests: "write tests before implementation",
"review this plan and point out weak assumptions", "help me refine this UX
flow", or explicit control requests like "use the Codex test-first skill in
OpenCode too." SkillBoard runs behind the scenes only when skill choices
overlap, workflow priority matters, or you explicitly ask for a skill/control
decision, so you get the benefit: broadly available skills, one routed skill
when similar skills overlap, and a short disclosure of what was used.

The burden stays low:

- No global install is required for a trial; use
  `npm exec --yes --package agent-skillboard@latest -- skillboard`.
- Most use is read-only: `brief`, `route`, `doctor`, and `guard use` answer
  what can run now and which route fits the request.
- Nothing changes until you approve a policy action.
- Project cleanup is previewable with `skillboard uninstall --dry-run`; default
  uninstall removes SkillBoard settings and generated project state while
  preserving local skills. Add `--keep-settings` only when you want to keep
  project policy and bridge guidance.

Status: public alpha. The current config schema is config schema v1; breaking
changes may still happen before `1.0.0` and are documented in release notes.

Under the hood, SkillBoard is workflow-scoped skill priority and overlap routing
for AI agents. Installed user skills are usable by default unless runtime, user,
or local instructions disable them; SkillBoard helps Codex, OpenCode, Claude,
and Hermes resolve overlapping skills and workflow priority instead of guessing
from raw skill files.

Start with normal requests:

- "What skills can you use in this project?"
- "Write tests before implementation."
- "Review this plan and point out weak assumptions."
- "Help me refine this UX flow."
- "Use the Codex test-first skill in OpenCode too."
- "Can you make `anthropic.docx` available for this workflow?"
- "Why is this skill blocked?"

Your AI runs SkillBoard behind the scenes, reads the current brief, checks the
guard automatically before invoking an allowed skill, and asks only before
policy-changing actions. For already-allowed skills, it should say which skill
it is about to use and which skill it used, not interrupt you for another
approval. That disclosure is an audit trace, not a permission prompt. You do
not need to memorize the SkillBoard command loop.

A normal allowed-skill turn can look like this:

- You: "Write tests before implementation."
- AI: "I will use matt.tdd for this request."
- AI: "I used matt.tdd for this request."

Names you may see in setup and logs:

- `SkillBoard`: the product and policy model.
- `agent-skillboard`: the npm package.
- `skillboard`: the CLI binary.

## Who This Is For

Use SkillBoard if you use more than one coding agent, skill pack, plugin, MCP
tool, or marketplace and want one answer to:

- Which skills can this agent use right now?
- Which skill should win when several match the same task?
- Which external or plugin skills are reviewed, blocked, or waiting for approval?
- How can Codex, Claude, OpenCode, and Hermes follow the same skill policy?

If you use one agent with a few hand-written local skills, you probably do not
need SkillBoard yet. SkillBoard is for setups that have grown beyond one trusted
skill folder and need workflow-scoped control without turning skill governance
into a manual checklist.

If you are changing routing, brief, bridge, policy, or workflow UX, read
[AI Skill Routing Goal](docs/ai-skill-routing-goal.md) first; it defines the
non-blocking `observe → route → work → explain briefly → ask after → remember
policy` loop that development should preserve.

<p align="center">
  <img src="https://raw.githubusercontent.com/NyXXiR/skillboard/main/skillboard.png" alt="SkillBoard architecture diagram: sources, inventory scanner, SkillBoard model, policy engine, and user and agent surfaces." width="100%">
</p>

## Why Not Just List `/skills`?

A raw skill list answers what is declared. SkillBoard answers what can run now
and how overlapping matches should route.

Same fixture, different answer:

| Raw skill list | SkillBoard brief |
| --- | --- |
| `matt.tdd active workflow-auto` | `AI can use now: 0` |
| no policy health | `Blocked for safety: 8`, `Policy errors: 2` |
| several review skills look relevant | `Overlap: Multiple allowed skills match... routes ...` |

That gap is the product. SkillBoard separates `installed` from `available`,
checks policy health, and gives agents a route they can use without guessing
from raw `SKILL.md` files. The same proof also routes "write tests before
implementation" to `matt.tdd`, returns `private.tdd-work-continuity` as the
fallback, and gives the AI exact start and finish disclosure text. Targeted
tests also cover `grill-me`-style review overlap across Codex and OpenCode
workflows.

See [Tested Value Proof](#tested-value-proof) for the executable proof.

## 5-Minute Quick Start

Try it without a global install. These read-only commands download the latest
package for one run and do not create project files:

```bash
npm exec --yes --package agent-skillboard@latest -- skillboard --version
npm exec --yes --package agent-skillboard@latest -- skillboard help brief
```

Install the CLI when you want SkillBoard connected to your agent layer. On a
normal global install, SkillBoard auto-connects the agent layer for detected
Codex, Claude, OpenCode, and Hermes user skill roots:

AI/automation/operator details:

```bash
npm install -g agent-skillboard
```

If your system npm requires elevated permissions, `sudo npm install -g
agent-skillboard` is also supported. In that flow, install-time setup resolves
`SUDO_USER` and writes the user-level guidance skill under the invoking user's
agent homes. Managed guidance files written under the user's home are restored
to the invoking user's ownership, while the `skillboard` binary still lands in
the global prefix used by that npm command.

The install-time setup writes a user-level `skillboard` guidance skill under
detected agent homes. For Codex, detection includes `CODEX_HOME/skills`,
`AGENTS_HOME/skills`, `~/.agents/skills`, and `~/.codex/skills`.
If `~/.agents` already exists, setup creates `~/.agents/skills` because that is
the shared Codex-visible skill tree in LazyCodex-style environments.
It does not create `skillboard.config.yaml`,
`.skillboard/`, `AGENTS.md`, or `CLAUDE.md` in projects.
No separate setup command is required after a normal global install or update:
npm lifecycle scripts run agent-layer setup automatically, rerun the agent-home
scan, refresh managed SkillBoard guidance files, and add newly detected
supported agent roots. This setup does not run `skillboard init`; use `init`
only inside a workspace where you want project-local policy files.

Run `skillboard setup --agent codex,claude,opencode,hermes --yes` later only
after adding another supported agent, enabling a new agent home, or installing
with lifecycle scripts disabled. Restart or refresh agents that cache user
skills, then ask normal questions:

- "Write tests before implementation."
- "Review this plan and point out weak assumptions."
- "What skills can you use here?"
- "Use the Codex test-first skill in OpenCode too."
- "When two skills overlap, which one should take priority?"

When a target agent needs a skill from another agent, it can use
`skillboard import-skill --from codex --to opencode --skill <skill> --json`
behind the scenes. Compatible skills are copied into the target agent's user
skill root. If the source contains agent-specific instructions, the agent asks
before creating an adapted target-agent `SKILL.md` and installs that file with
provenance.

If you intentionally maintain local workspace policy files, use the explicit
operator commands for that layer. `skillboard init` is needed only for a
workspace where you want project-local policy, bridge guidance, and reports:

```bash
npx --yes --package agent-skillboard skillboard init
npx --yes --package agent-skillboard skillboard doctor --summary
npx --yes --package agent-skillboard skillboard brief --workflow <workflow-from-init>
```

Remove SkillBoard from a project when you are done:

```bash
npx --yes --package agent-skillboard skillboard uninstall --dir /path/to/your/project --dry-run
npx --yes --package agent-skillboard skillboard uninstall --dir /path/to/your/project
```

Default project uninstall removes SkillBoard config, bridge guidance, and
`.skillboard/` project state while preserving local `skills/*/SKILL.md` files.
It reports what it removed or preserved.

```bash
npx --yes --package agent-skillboard skillboard uninstall --dir /path/to/your/project --keep-settings --dry-run
npx --yes --package agent-skillboard skillboard uninstall --dir /path/to/your/project --keep-settings
```

Use `--keep-settings` only when you want to keep project SkillBoard policy and
bridge guidance in place, for example while cleaning generated helper files.
`--purge` remains accepted as an explicit spelling for the default clean
project removal.

Remove SkillBoard's managed agent-layer guidance before package removal when
you want agent homes back to their pre-SkillBoard guidance state:

```bash
npx --yes --package agent-skillboard skillboard uninstall --agent-layer --dry-run
npx --yes --package agent-skillboard skillboard uninstall --agent-layer
npm uninstall -g agent-skillboard
```

Agent-layer uninstall removes only managed `skillboard/SKILL.md` guidance files
that contain SkillBoard's integration marker. It preserves other agent skills
and user-authored `skillboard` skills.

See [docs/install.md](docs/install.md) for global installs, `--dir`, GitHub
builds, clone-based development, Hermes bridge setup, refresh, and uninstall.

## What SkillBoard Gives You

- Inventory that separates installed skills from callable skills.
- Broad default availability with workflow-scoped overlap routing.
- `brief`, `route`, `can-use`, and `guard use` surfaces for AI-mediated selection and availability.
- `import-skill` for agent-layer skill reuse across Codex, Claude, OpenCode, and Hermes.
- Workflow conflict checks and overlap summaries so similar skills stay
  available without quietly degrading an answer.
- Action cards that apply one approved policy change, then re-resolve state.
- Source and install-unit review for plugins, hooks, MCP servers, harnesses,
  commands, LSPs, and package-manager dependencies.
- Impact, reconcile, rollout, and dashboard output before cleanup or migration.
- Manual skill variant lifecycle for relationships such as `a -> claude.a`,
  with draft, approval, drift, and reset checkpoints.

SkillBoard is priority-first at the agent layer: installed user skills are
usable unless runtime, user, or local instructions disable them. Local workspace
policy files can still model stricter workflow, source, and invocation
decisions when a team needs that control.
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
- Agent-layer skill import with compatible copy or user-approved AI-mediated adaptation.
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
