# Source Profiles

Source profiles teach inventory discovery where a skill pack stores skills and
how paths map to stable ids. They do not authorize availability.

## Profile YAML structure

Profiles describe `skill_paths`, `path_rules`, source class, and optional
install-unit observations. Import emits inventory/audit metadata and v2 policy
entries for valid discovered skills. New entries default to enabled and agent-local;
existing user policy is preserved.

```yaml
id: example-pack
skill_paths:
  - skills/*/SKILL.md
path_rules:
  strip_prefix: skills/
  strip_suffix: /SKILL.md
```

Source, provenance, trust observations, digests, and install-unit fields are
optional audit metadata and never determine availability. Runtime and action
authorization remain outside SkillBoard.

## How to add a built-in profile

1. Add the YAML under `profiles/`.
2. Add a fixture with representative paths.
3. Test deterministic ids and inventory output.
4. Test that discovery creates enabled, agent-local policy without overwriting
   an existing disabled or shared entry.

Use a detector instead when an installation has no stable filesystem pattern.
