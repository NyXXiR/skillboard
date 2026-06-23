import { INVOCATION_VALUES } from "../constants.mjs";

export const capabilityRules = [
  {
    id: "CAP-REF-001",
    check(ctx) {
      const diagnostics = [];
      for (const capability of ctx.capabilities) {
        if (capability.canonical !== "" && !ctx.skillsById.has(capability.canonical)) {
          diagnostics.push(`Capability requirement ${capability.name} references undeclared canonical skill: ${capability.canonical}`);
        }
        for (const skillId of capability.alternatives) {
          if (!ctx.skillsById.has(skillId)) {
            diagnostics.push(`Capability requirement ${capability.name} references undeclared alternative skill: ${skillId}`);
          }
        }
      }
      return diagnostics;
    }
  },
  {
    id: "CAP-POLICY-001",
    check(ctx) {
      const diagnostics = [];
      for (const capability of ctx.capabilities) {
        if (!INVOCATION_VALUES.has(capability.defaultPolicy)) {
          diagnostics.push(`Capability ${capability.name} has unsupported default_policy: ${capability.defaultPolicy}`);
        }
      }
      return diagnostics;
    }
  }
];
