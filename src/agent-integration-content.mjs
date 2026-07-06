export const AGENT_INTEGRATION_START = "<!-- BEGIN SKILLBOARD AGENT INTEGRATION -->";
export const AGENT_INTEGRATION_END = "<!-- END SKILLBOARD AGENT INTEGRATION -->";

export function agentIntegrationSkill() {
  return `---
name: skillboard
description: Use SkillBoard when several installed skills could apply, a skill choice is ambiguous, workflow priority matters, or the user explicitly asks which skill should be used, imported, preferred, avoided, reviewed, or prioritized.
---
${AGENT_INTEGRATION_START}
# SkillBoard Agent Integration

Use this skill to let SkillBoard guide skill selection above individual projects.

## Layering

- SkillBoard is the user-level control plane for skill priority, overlap resolution, and workflow-aware routing.
- Project management belongs to the agent or workspace layer. Do not initialize, attach, rewrite, or manage a project just because SkillBoard is installed.
- Package install and \`skillboard setup\` install user-agent guidance only.
- \`skillboard init\` is a separate project command. Use it only when the user wants project-local policy files such as \`skillboard.config.yaml\`, \`.skillboard/\`, \`AGENTS.md\`, or \`CLAUDE.md\`.

## Default Behavior

- Installed user skills are usable by default unless the runtime, user, or local instructions disable them.
- For ordinary user requests, work normally; invoke SkillBoard only when skill choice is ambiguous, skills overlap, workflow priority matters, or the user asks for a SkillBoard or skill decision.
- If the user explicitly asks for a specific installed skill, honor that request when the guard allows it instead of rerouting away solely because other skills also match.
- Do not ask for permission merely because you selected a skill.
- When you use a skill, disclose it briefly at the start and completion. If SkillBoard says remembered or configured policy selected this skill while other allowed skills were available, mention that at completion.

## Cross-Agent Skill Reuse

- When the user wants to use a skill from another agent, run \`skillboard import-skill --from <source-agent> --to <this-agent> --skill <skill> --json\`.
- If SkillBoard reports the skill is compatible, install it with \`--yes\` and use the copied target-agent skill.
- If SkillBoard reports \`needs-adaptation\`, explain the compatibility reasons and ask before changing the skill body for this agent.
- If the user approves, inspect the source skill, write an adapted \`SKILL.md\` for this agent, then install it with \`skillboard import-skill --from <source-agent> --to <this-agent> --skill <skill> --adapted-file <adapted-skill.md> --yes --json\`.
- This is still user-agent setup. Do not create or mutate project policy files for cross-agent skill reuse.

## Ambiguity Resolution

1. Start from the user's task, not from a pre-task inventory prompt.
2. Identify candidate skills only when multiple installed skills plausibly match, a manual skill-control request is present, or workflow priority could change the route.
3. Prefer the skill whose explicit request, description, workflow guidance, and local instructions most directly match the user's task.
4. If a project or agent has explicit SkillBoard policy, use \`skillboard brief --intent <request> --json\` or \`skillboard route <intent> --workflow <name> --json\` to break ties.
5. If the best choice is still ambiguous or the choice would change persistent policy, ask the user which priority to remember.
6. Continue with the selected skill; do not stop only because other candidate skills exist.

${AGENT_INTEGRATION_END}
`;
}
