export function sortById(left, right) {
  return left.id.localeCompare(right.id);
}

export function sortedStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "finding";
}
