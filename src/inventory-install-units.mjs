const TRUST_RANK = new Map([["blocked", 0], ["unreviewed", 1], ["reviewed", 2], ["trusted", 3]]);
const RISK_RANK = new Map([["high", 0], ["medium", 1], ["unknown", 2], ["low", 3]]);

export function coalesceInventoryInstallUnits(records) {
  const groups = new Map();
  for (const record of records) {
    const group = groups.get(record.id) ?? [];
    group.push(record);
    groups.set(record.id, group);
  }
  return [...groups.values()].map(coalesceGroup).sort(byId);
}

function coalesceGroup(records) {
  const sorted = [...records].sort((left, right) => stableKey(left).localeCompare(stableKey(right)));
  const first = sorted[0];
  const runtime = sorted.map((record) => record.runtime_components ?? {});
  return compact({
    ...first,
    trust_observation: rankedValue(sorted.map((record) => record.trust_observation), TRUST_RANK),
    permission_risk: rankedValue(sorted.map((record) => record.permission_risk), RISK_RANK),
    signature_observed: sorted.some((record) => record.signature_observed === true),
    runtime_components: {
      commands: combined(runtime.map((value) => value.commands)),
      hooks: combined(runtime.map((value) => value.hooks)),
      mcp_servers: combined(runtime.map((value) => value.mcp_servers))
    },
    skills: combined(sorted.map((record) => record.skills)),
    alias_skills: combined(sorted.map((record) => record.alias_skills)),
    source_observations: observed(sorted, "source"),
    manifest_path_observations: observed(sorted, "manifest_path"),
    cache_path_observations: observed(sorted, "cache_path"),
    source_digest_observations: observed(sorted, "source_digest")
  });
}

function rankedValue(values, ranks) {
  return values
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((left, right) => (ranks.get(left) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(right) ?? Number.MAX_SAFE_INTEGER)
      || left.localeCompare(right))[0];
}

function observed(records, key) {
  const values = combined(records.map((record) => [record[key]]));
  return values.length > 1 ? values : undefined;
}

function combined(groups) {
  return [...new Set(groups.flat().filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function stableKey(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function byId(left, right) {
  return left.id.localeCompare(right.id);
}
