export function pathTailRegex(...segments) {
  return new RegExp(pathTailPattern(...segments));
}

export function pathTailPattern(...segments) {
  return segments.map(escapeRegex).join("[\\\\/]");
}

function escapeRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
