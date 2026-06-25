import { sortById, sortedStrings, slug } from "./sort.mjs";

export function emptySources() {
  return {
    ok: false,
    errors: [],
    warnings: [],
    units: []
  };
}

export function sourcesFromDoctor(doctor) {
  return {
    ok: doctor.sources.ok,
    errors: sortedStrings(doctor.sources.errors),
    warnings: sortedStrings(doctor.sources.warnings),
    units: []
  };
}

export function summarizeSources(sourceAudit) {
  return {
    ok: sourceAudit.ok,
    errors: sortedStrings(sourceAudit.errors),
    warnings: sortedStrings(sourceAudit.warnings),
    units: sourceAudit.units.map((unit) => ({
      id: unit.id,
      kind: unit.kind,
      enabled: unit.enabled,
      risk: unit.permissionRisk,
      reviewed: ["trusted", "reviewed"].includes(unit.trustLevel),
      findings: unit.findings
        .map((finding) => ({
          severity: finding.severity,
          message: finding.message
        }))
        .sort(sortFinding),
      advanced: {
        source_class: unit.sourceClass,
        trust_level: unit.trustLevel,
        signed: unit.signed,
        pinned: unit.pinned,
        verified_at: unit.verifiedAt,
        automatic_skills: sortedStrings(unit.automaticSkills)
      }
    })).sort(sortById)
  };
}

export function buildReviewQueue(workspace, sourceAudit) {
  const entries = [];
  for (const unit of sourceAudit.units) {
    if (unit.enabled && unit.sourceClass !== "user" && unit.trustLevel === "unreviewed") {
      entries.push({
        kind: "install_unit",
        id: `install_unit:${unit.id}`,
        label: `Review ${unit.id}`,
        reason: "Source is enabled but not reviewed.",
        risk: normalizeRisk(unit.permissionRisk),
        action_ids: [],
        advanced: {
          install_unit: unit.id,
          source_class: unit.sourceClass,
          trust_level: unit.trustLevel
        }
      });
    }
    for (const finding of unit.findings) {
      entries.push({
        kind: "source_finding",
        id: sourceFindingId(unit.id, finding),
        label: `Review ${unit.id}`,
        reason: finding.message,
        risk: riskForFinding(finding),
        action_ids: [],
        advanced: {
          source_id: unit.id,
          severity: finding.severity
        }
      });
    }
  }
  for (const skill of workspace.skills) {
    if (skill.status === "quarantined") {
      entries.push({
        kind: "skill",
        id: `skill:${skill.id}`,
        label: `Review ${skill.id}`,
        reason: "Skill is quarantined.",
        risk: "high",
        action_ids: [],
        advanced: {
          skill_id: skill.id,
          status: skill.status,
          owner_install_unit: skill.ownerInstallUnit ?? null
        }
      });
    }
  }
  return entries.sort(sortReviewQueue);
}

function sourceFindingId(sourceId, finding) {
  return `source_finding:${sourceId}:${finding.severity}:${slug(finding.message)}`;
}

function riskForFinding(finding) {
  if (finding.severity === "error") {
    return "high";
  }
  const message = finding.message.toLowerCase();
  if (message.includes("runtime") || message.includes("high-risk")) {
    return "high";
  }
  if (message.includes("not pinned") || message.includes("provenance")) {
    return "medium";
  }
  return "low";
}

function normalizeRisk(value) {
  if (["low", "medium", "high"].includes(value)) {
    return value;
  }
  return "medium";
}

function sortReviewQueue(left, right) {
  return reviewQueueBucket(left) - reviewQueueBucket(right)
    || left.id.localeCompare(right.id);
}

function reviewQueueBucket(entry) {
  if (entry.kind === "source_finding" && entry.risk === "high") {
    return 0;
  }
  if (entry.kind === "install_unit") {
    return 1;
  }
  if (entry.kind === "skill") {
    return 2;
  }
  if (entry.kind === "source_finding" && isUnpinnedFinding(entry)) {
    return 3;
  }
  return 4;
}

function isUnpinnedFinding(entry) {
  const reason = entry.reason.toLowerCase();
  return reason.includes("not pinned") || reason.includes("provenance");
}

function sortFinding(left, right) {
  return left.severity.localeCompare(right.severity) || left.message.localeCompare(right.message);
}
