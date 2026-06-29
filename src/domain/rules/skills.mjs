import {
  LEGACY_STATUSES,
  TERMINAL_STATUSES,
  validateSkillState
} from "../skill-state-matrix.mjs";

const VARIANT_STATUS_VALUES = new Set(["draft", "approved"]);
const VARIANT_DIGEST_PATTERN = /^sha256:[0-9a-fA-F]{64}$/;
const VARIANT_SNAPSHOT_PREFIX = ".skillboard/variant-snapshots/";

export const skillRules = [
  {
    id: "SKILL-STATUS-001",
    check(ctx) {
      const diagnostics = [];
      for (const skill of ctx.skills) {
        diagnostics.push(...validateStatusInvocation(skill));
      }
      return diagnostics;
    }
  },
  {
    id: "SKILL-SCOPE-001",
    check(ctx) {
      const diagnostics = [];
      for (const skill of ctx.skills) {
        if (ctx.defaults.requireExplicitWorkflow && skill.invocation === "workflow-auto" && !ctx.workflowScopedSkillIds.has(skill.id)) {
          diagnostics.push(`Skill ${skill.id} uses workflow-auto but is not scoped to any workflow.`);
        }
      }
      return diagnostics;
    }
  },
  {
    id: "SKILL-GLOBAL-001",
    check(ctx) {
      const diagnostics = [];
      for (const skill of ctx.skills) {
        if (skill.invocation !== "global-auto") {
          continue;
        }
        diagnostics.push({
          severity: "warning",
          message: `Skill ${skill.id} is global-auto; prefer workflow-auto or router-only.`
        });
        if (skill.exposure !== "global-meta") {
          diagnostics.push(`Skill ${skill.id} uses global-auto but is not exposure: global-meta.`);
        }
      }
      return diagnostics;
    }
  },
  {
    id: "SKILL-REF-001",
    check(ctx) {
      const diagnostics = [];
      for (const skill of ctx.skills) {
        if (skill.replacedBy !== undefined && !ctx.skillsById.has(skill.replacedBy)) {
          diagnostics.push(`Skill ${skill.id} replaced_by points to undeclared skill: ${skill.replacedBy}`);
        }
        for (const capabilityName of skill.canonicalFor) {
          const capability = ctx.capabilitiesByName.get(capabilityName);
          if (capability === undefined) {
            diagnostics.push(`Skill ${skill.id} canonical_for references undeclared capability: ${capabilityName}`);
          } else if (capability.canonical !== skill.id) {
            diagnostics.push(`Skill ${skill.id} claims canonical_for ${capabilityName} but capability canonical is ${capability.canonical || "none"}.`);
          }
        }
        for (const skillId of skill.conflictsWith) {
          if (!ctx.skillsById.has(skillId)) {
            diagnostics.push(`Skill ${skill.id} conflicts_with undeclared skill: ${skillId}`);
          }
        }
      }
      return diagnostics;
    }
  },
  {
    id: "SKILL-VARIANT-001",
    check(ctx) {
      const diagnostics = [];
      for (const skill of ctx.skills) {
        if (skill.variant === null || skill.variant === undefined) {
          continue;
        }
        diagnostics.push(...validateVariantMetadata(ctx, skill));
      }
      return diagnostics;
    }
  },
  {
    id: "SKILL-OWNER-001",
    check(ctx) {
      const diagnostics = [];
      for (const skill of ctx.skills) {
        if (skill.ownerInstallUnit !== undefined && !ctx.installUnitsById.has(skill.ownerInstallUnit)) {
          diagnostics.push(`Skill ${skill.id} owner_install_unit points to undeclared install unit: ${skill.ownerInstallUnit}`);
        }
        if (skill.exposure === "unit-managed" && skill.ownerInstallUnit === undefined) {
          diagnostics.push(`Skill ${skill.id} is unit-managed but does not declare owner_install_unit.`);
        }
        const owner = skill.ownerInstallUnit === undefined ? undefined : ctx.installUnitsById.get(skill.ownerInstallUnit);
        if (owner !== undefined && !owner.components.skills.includes(skill.id)) {
          diagnostics.push(`Skill ${skill.id} declares owner_install_unit ${owner.id} but is not listed in its component skills.`);
        }
      }
      return diagnostics;
    }
  }
];

function validateStatusInvocation(skill) {
  const diagnostics = [];
  const result = validateSkillState(skill.status, skill.invocation, skill.id);
  if (result !== null) {
    diagnostics.push(result);
  }
  if (["active", "canonical"].includes(skill.status) && TERMINAL_STATUSES.has(skill.invocation)) {
    diagnostics.push(`Active skill ${skill.id} cannot use invocation: ${skill.invocation}.`);
  }
  return diagnostics;
}

function validateVariantMetadata(ctx, skill) {
  const diagnostics = [];
  const { variant } = skill;
  if (!ctx.skillsById.has(variant.of)) {
    diagnostics.push(`Skill ${skill.id} variant.of references undeclared skill: ${variant.of}`);
  }
  if (!ctx.capabilitiesByName.has(variant.capability)) {
    diagnostics.push(`Skill ${skill.id} variant.capability references undeclared capability: ${variant.capability}`);
  }
  if (!ctx.workflowsByName.has(variant.workflow)) {
    diagnostics.push(`Skill ${skill.id} variant.workflow references undeclared workflow: ${variant.workflow}`);
  }
  if (!VARIANT_STATUS_VALUES.has(variant.status)) {
    diagnostics.push(`Skill ${skill.id} variant.status must be one of: draft, approved; got ${variant.status}.`);
  }
  diagnostics.push(...validateVariantCheckpoint(skill, "base", variant.base));
  if (variant.approved !== undefined) {
    diagnostics.push(...validateVariantCheckpoint(skill, "approved", variant.approved));
  }
  return diagnostics;
}

function validateVariantCheckpoint(skill, key, checkpoint) {
  const diagnostics = [];
  if (!VARIANT_DIGEST_PATTERN.test(checkpoint.contentDigest)) {
    diagnostics.push(`Skill ${skill.id} variant.${key}.content_digest must match sha256:<64 hex chars>.`);
  }
  if (!isVariantSnapshotPath(checkpoint.snapshot)) {
    diagnostics.push(`Skill ${skill.id} variant.${key}.snapshot must be a relative path under ${VARIANT_SNAPSHOT_PREFIX}.`);
  }
  return diagnostics;
}

function isVariantSnapshotPath(value) {
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\\")) {
    return false;
  }
  if (!value.startsWith(VARIANT_SNAPSHOT_PREFIX) || value.length <= VARIANT_SNAPSHOT_PREFIX.length) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
