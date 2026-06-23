import { buildPolicyContext } from "./domain/indexes.mjs";
import { capabilityRules } from "./domain/rules/capabilities.mjs";
import { harnessRules } from "./domain/rules/harnesses.mjs";
import { installUnitRules } from "./domain/rules/install-units.mjs";
import { skillRules } from "./domain/rules/skills.mjs";
import { workflowRules } from "./domain/rules/workflows.mjs";

const RULES = [
  ...workflowRules,
  ...skillRules,
  ...capabilityRules,
  ...harnessRules,
  ...installUnitRules
];

export function checkPolicy(workspace) {
  const ctx = buildPolicyContext(workspace);
  const errors = [];
  const warnings = [];

  for (const rule of RULES) {
    for (const diagnostic of rule.check(ctx)) {
      const normalized = normalizeDiagnostic(rule, diagnostic);
      if (normalized.severity === "warning") {
        warnings.push(normalized.message);
      } else {
        errors.push(normalized.message);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function normalizeDiagnostic(rule, diagnostic) {
  const severity = typeof diagnostic === "string" ? rule.severity ?? "error" : diagnostic.severity ?? rule.severity ?? "error";
  const message = typeof diagnostic === "string" ? diagnostic : diagnostic.message;
  return {
    severity,
    message: `[${rule.id}] ${message}`
  };
}
