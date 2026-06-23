import YAML from "yaml";

const DEFAULT_SEMANTIC_LIMIT = 50;

export function textChangePlan(before, after) {
  const beforeLines = before.split(/\r?\n/u);
  const afterLines = after.split(/\r?\n/u);
  const semantic = semanticChangePlan(before, after, { limit: DEFAULT_SEMANTIC_LIMIT });
  return {
    changed: before !== after,
    beforeBytes: Buffer.byteLength(before),
    afterBytes: Buffer.byteLength(after),
    beforeLines: beforeLines.length,
    afterLines: afterLines.length,
    changedLineCount: countChangedLinePositions(beforeLines, afterLines),
    semanticAvailable: semantic.available,
    semanticError: semantic.error,
    semanticChangeCount: semantic.changeCount,
    semanticTruncated: semantic.truncated,
    semanticChanges: semantic.changes
  };
}

function countChangedLinePositions(beforeLines, afterLines) {
  const length = Math.max(beforeLines.length, afterLines.length);
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      count += 1;
    }
  }
  return count;
}

function semanticChangePlan(before, after, options) {
  try {
    const beforeValue = YAML.parse(before) ?? null;
    const afterValue = YAML.parse(after) ?? null;
    const state = { changes: [], total: 0, truncated: false, limit: options.limit };
    collectSemanticChanges(beforeValue, afterValue, [], state);
    return {
      available: true,
      error: null,
      changeCount: state.total,
      truncated: state.truncated,
      changes: state.changes
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      changeCount: 0,
      truncated: false,
      changes: []
    };
  }
}

function collectSemanticChanges(beforeValue, afterValue, path, state) {
  if (jsonEqual(beforeValue, afterValue)) {
    return;
  }
  if (beforeValue === undefined) {
    addSemanticChange(state, "added", path, "absent", valueSummary(afterValue));
    return;
  }
  if (afterValue === undefined) {
    addSemanticChange(state, "removed", path, valueSummary(beforeValue), "absent");
    return;
  }
  if (isRecord(beforeValue) && isRecord(afterValue)) {
    const keys = [...new Set([...Object.keys(beforeValue), ...Object.keys(afterValue)])].sort((left, right) => left.localeCompare(right));
    for (const key of keys) {
      collectSemanticChanges(beforeValue[key], afterValue[key], [...path, key], state);
    }
    return;
  }
  if (Array.isArray(beforeValue) && Array.isArray(afterValue)) {
    collectArrayChanges(beforeValue, afterValue, path, state);
    return;
  }
  addSemanticChange(state, "changed", path, valueSummary(beforeValue), valueSummary(afterValue));
}

function collectArrayChanges(beforeValue, afterValue, path, state) {
  if (beforeValue.every(isScalar) && afterValue.every(isScalar)) {
    const beforeCounts = countedScalars(beforeValue);
    const afterCounts = countedScalars(afterValue);
    const keys = [...new Set([...beforeCounts.keys(), ...afterCounts.keys()])].sort((left, right) => left.localeCompare(right));
    let emitted = false;
    for (const key of keys) {
      const beforeCount = beforeCounts.get(key) ?? 0;
      const afterCount = afterCounts.get(key) ?? 0;
      const scalar = JSON.parse(key);
      if (afterCount > beforeCount) {
        addSemanticChange(state, "added", [...path, scalar], "absent", `scalar x${afterCount - beforeCount}`);
        emitted = true;
      } else if (beforeCount > afterCount) {
        addSemanticChange(state, "removed", [...path, scalar], `scalar x${beforeCount - afterCount}`, "absent");
        emitted = true;
      }
    }
    if (emitted) {
      return;
    }
  }
  addSemanticChange(state, "changed", path, valueSummary(beforeValue), valueSummary(afterValue));
}

function addSemanticChange(state, type, path, before, after) {
  state.total += 1;
  if (state.changes.length >= state.limit) {
    state.truncated = true;
    return;
  }
  state.changes.push({
    type,
    path: jsonPointer(path),
    before,
    after
  });
}

function countedScalars(values) {
  const counts = new Map();
  for (const value of values) {
    const key = JSON.stringify(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function valueSummary(value) {
  if (value === undefined) {
    return "absent";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `sequence(${value.length})`;
  }
  if (isRecord(value)) {
    return `mapping(${Object.keys(value).length})`;
  }
  if (typeof value === "string") {
    return value.length > 80 ? `string(${value.length})` : JSON.stringify(value);
  }
  return String(value);
}

function jsonPointer(path) {
  if (path.length === 0) {
    return "/";
  }
  return `/${path.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}
