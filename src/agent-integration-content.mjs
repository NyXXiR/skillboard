export const AGENT_INTEGRATION_START = "<!-- BEGIN SKILLBOARD AGENT INTEGRATION -->";
export const AGENT_INTEGRATION_END = "<!-- END SKILLBOARD AGENT INTEGRATION -->";

export function agentIntegrationSkill(agent = "<current-agent>") {
  return `---
name: skillboard
description: Use SkillBoard when several installed skills could apply, a skill choice is ambiguous, or the user explicitly asks which skill should be used, shared, imported, preferred, avoided, or prioritized.
---
${AGENT_INTEGRATION_START}
# SkillBoard Agent Integration

Use this skill to let SkillBoard guide skill selection above individual projects.

## Layering

- SkillBoard is the user-level control plane for skill priority, overlap resolution, and opt-in cross-agent sharing.
- Project management belongs to the agent or workspace layer. Do not initialize, attach, rewrite, or manage a project just because SkillBoard is installed.
- Package install and \`skillboard setup\` refresh user-agent guidance plus the home policy and inventory.
- \`skillboard init\` is deprecated project-local policy bootstrap. It is not needed for normal use; use it only when maintaining an existing workspace that intentionally keeps local policy files such as \`skillboard.config.yaml\`, \`.skillboard/\`, \`AGENTS.md\`, or \`CLAUDE.md\`.

## Default Behavior

- Installed skills stay agent-local by default. Only a skill the user explicitly shares is promoted across supported agents.
- This integration is running for agent \`${agent}\`; pass \`--agent ${agent}\` to brief, route, can-use, and guard.
- For ordinary user requests, work normally; invoke SkillBoard only when skill choice is ambiguous, skills overlap, or the user asks for a SkillBoard or skill decision.
- If the user explicitly asks for a specific installed skill, honor that request when the guard allows it instead of rerouting away solely because other skills also match.
- Do not ask for permission merely because you selected a skill.
- When you use a skill, disclose it briefly at the start and completion. If a saved preference influenced the model's choice, mention that briefly at completion.

## Cross-Agent Skill Reuse

- When the user wants one installed skill available to all supported agents, confirm that persistent policy change once and run \`skillboard skill share <skill> --json\`.
- To stop SkillBoard-managed propagation, confirm once and run \`skillboard skill unshare <skill> --json\`. This preserves agent-owned originals and removes only SkillBoard-managed copies.
- When the user wants to use a skill from another agent, run \`skillboard import-skill --from <source-agent> --to <this-agent> --skill <skill> --json\`.
- If SkillBoard reports the skill is compatible, install it with \`--yes\` and use the copied target-agent skill.
- If SkillBoard reports \`needs-adaptation\`, explain the compatibility reasons and ask before changing the skill body for this agent.
- If the user approves, inspect the source skill, write an adapted \`SKILL.md\` for this agent, then install it with \`skillboard import-skill --from <source-agent> --to <this-agent> --skill <skill> --adapted-file <adapted-skill.md> --yes --json\`.
- This is still user-agent setup. Do not create or mutate project policy files for cross-agent skill reuse.

## Ambiguity Resolution

1. Start from the user's task, not from a pre-task inventory prompt.
2. Identify candidate skills only when multiple installed skills plausibly match or a manual skill-control request is present.
3. Use \`skillboard brief --agent ${agent} --intent <request> --json\` or \`skillboard route <intent> --agent ${agent} --json\` to read eligible skill descriptions and raw saved preferences. SkillBoard does not interpret v2 request text.
4. Make the semantic choice yourself from the full request, explicit user direction, descriptions, local instructions, and any saved preferences; use no skill when none fits.
5. Run \`skillboard guard use <skill-id> --agent ${agent} --json\` immediately before invoking the model-selected skill.
6. Continue with the selected skill; do not stop only because other candidate skills exist.
7. If the choice remained ambiguous and remembering it would help, finish the work first, then ask whether to save that intent preference.

## Removal

- If an owning installer removed a skill and inventory refresh reports stale policy, confirm once before running \`skillboard skill forget <skill-id>\`. Forget never deletes skill files and refuses installed or shared skills.
- When the user wants to remove SkillBoard itself, run \`skillboard uninstall --user --dry-run\`, show the managed cleanup plan, confirm once, then run \`skillboard uninstall --user --yes\`. Package removal comes afterward.
- User cleanup preserves agent-owned and unmanaged skills while removing marker-owned shared copies, managed guidance, and SkillBoard home state.

${AGENT_INTEGRATION_END}
`;
}
