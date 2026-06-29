export const TOP_LEVEL_KEYS = [
  "ok",
  "schema_version",
  "health",
  "workflow",
  "skills",
  "sources",
  "review_queue",
  "cleanup"
];

export const EXPECTED_INITIALIZED_CONTRACT = {
  top_keys: TOP_LEVEL_KEYS,
  health_keys: [
    "mode",
    "review_required",
    "strict_ok",
    "initialized",
    "root",
    "config_path",
    "skills_root",
    "config",
    "policy"
  ],
  health_values: {
    mode: "passed",
    review_required: false,
    strict_ok: true,
    initialized: true,
    config: {
      exists: true,
      valid: true,
      version: 1,
      error: null
    },
    policy: {
      ok: true,
      errors: [],
      warnings: []
    }
  },
  workflow_keys: ["selected", "defaulted", "needs_selection", "candidates", "unknown", "blocked_reason"],
  workflow: {
    selected: "daily-workflow",
    defaulted: false,
    needs_selection: false,
    candidates: ["daily-workflow"],
    unknown: false,
    blocked_reason: null
  },
  skill_group_keys: [
    "automatic_allowed",
    "manual_allowed",
    "needs_review",
    "blocked",
    "not_in_workflow",
    "installed_only"
  ],
  manual_allowed: [
    {
      keys: ["id", "label", "path", "reason", "advanced"],
      id: "user.local-helper",
      label: "user.local-helper",
      path: "local-helper",
      reason: null,
      advanced_keys: [
        "status",
        "invocation",
        "exposure",
        "category",
        "variant",
        "source_class",
        "owner_install_unit",
        "workflow_roles",
        "capability_roles",
        "trust"
      ],
      advanced: {
        status: "active",
        invocation: "manual-only",
        exposure: "exported",
        category: "user",
        variant: null,
        source_class: "user",
        owner_install_unit: null,
        workflow_roles: ["active"],
        capability_roles: [],
        trust: {
          level: "trusted",
          reviewed: true,
          signed: false,
          pinned: false,
          ownerInstallUnit: null,
          reason: "declared directly in workspace policy"
        }
      }
    }
  ],
  empty_groups: {
    automatic_allowed: [],
    needs_review: [],
    blocked: [],
    not_in_workflow: [],
    installed_only: []
  },
  sources: {
    keys: ["ok", "errors", "warnings", "units"],
    ok: true,
    errors: [],
    warnings: [],
    units: []
  },
  review_queue: [],
  cleanup_keys: ["conservative", "full_reset"],
  cleanup_value_keys: {
    conservative: ["dryRun", "removed", "updated", "preserved"],
    full_reset: ["dryRun", "removed", "updated", "preserved"]
  }
};

const SOURCE_REVIEW_QUEUE = [
  ["source_finding", "source_finding:acme.pack:error:unreviewed-source-owns-model-selectable-skills-vendor-auto", "unreviewed source owns model-selectable skills: vendor.auto", "high", "error"],
  ["source_finding", "source_finding:acme.pack:warning:high-risk-source-is-not-reviewed-or-trusted", "high-risk source is not reviewed or trusted", "high", "warning"],
  ["source_finding", "source_finding:acme.pack:warning:runtime-extension-source-is-unreviewed", "runtime extension source is unreviewed", "high", "warning"],
  ["install_unit", "install_unit:acme.pack", "Source is enabled but not reviewed. Recommended trust level: blocked.", "high", null],
  ["source_finding", "source_finding:acme.pack:warning:source-is-not-pinned-by-digest-or-signature", "source is not pinned by digest or signature", "medium", "warning"]
];

export const EXPECTED_SOURCE_REVIEW_CONTRACT = {
  ok: false,
  needs_review_ids: ["vendor.auto"],
  sources: {
    keys: ["ok", "errors", "warnings", "units"],
    ok: false,
    errors: ["acme.pack: unreviewed source owns model-selectable skills: vendor.auto"],
    warnings: [
      "acme.pack: high-risk source is not reviewed or trusted",
      "acme.pack: runtime extension source is unreviewed",
      "acme.pack: source is not pinned by digest or signature"
    ],
    units: [
      {
        keys: ["id", "kind", "enabled", "risk", "reviewed", "findings", "advanced"],
        id: "acme.pack",
        kind: "plugin",
        enabled: true,
        risk: "high",
        reviewed: false,
        findings: [
          { severity: "error", message: "unreviewed source owns model-selectable skills: vendor.auto" },
          { severity: "warning", message: "high-risk source is not reviewed or trusted" },
          { severity: "warning", message: "runtime extension source is unreviewed" },
          { severity: "warning", message: "source is not pinned by digest or signature" }
        ],
        advanced_keys: ["source_class", "trust_level", "signed", "pinned", "verified_at", "automatic_skills"],
        advanced: {
          source_class: "external-package",
          trust_level: "unreviewed",
          signed: false,
          pinned: false,
          verified_at: null,
          automatic_skills: ["vendor.auto"]
        }
      }
    ]
  },
  review_queue: SOURCE_REVIEW_QUEUE.map(reviewQueueEntry)
};

function reviewQueueEntry([kind, id, reason, risk, severity]) {
  const advanced = severity === null
    ? { install_unit: "acme.pack", source_class: "external-package", trust_level: "unreviewed", recommended_trust_level: "blocked" }
    : { source_id: "acme.pack", severity };
  return {
    keys: ["kind", "id", "label", "reason", "risk", "action_ids", "advanced"],
    kind,
    id,
    label: "Review acme.pack",
    reason,
    risk,
    action_ids: [],
    advanced_keys: Object.keys(advanced),
    advanced
  };
}
