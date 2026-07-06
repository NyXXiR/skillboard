const ROUTE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "being",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "these",
  "this",
  "those",
  "to",
  "was",
  "were",
  "with",
  "without",
  "you",
  "your"
]);

export function tokensFor(value) {
  return new Set(String(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .flatMap(tokenForms)
    .filter(isRouteToken));
}

function tokenForms(token) {
  const singular = singularRouteToken(token);
  return singular === token ? [token] : [token, singular];
}

export function canonicalRouteToken(token) {
  return singularRouteToken(token);
}

function singularRouteToken(token) {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("s") && !/(?:ss|us|is)$/u.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

function isRouteToken(token) {
  return token.length > 1 && !ROUTE_STOP_WORDS.has(token);
}

export function phraseKey(value) {
  return [...tokensFor(value)].join(" ");
}
