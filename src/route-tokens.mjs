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

const ASCII_ROUTE_TOKEN = /^[a-z0-9]+$/u;
const CJK_ROUTE_TOKEN = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function tokensFor(value) {
  return new Set(String(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap(tokenForms)
    .filter(isRouteToken));
}

function tokenForms(token) {
  if (CJK_ROUTE_TOKEN.test(token)) {
    return cjkTokenForms(token);
  }
  const singular = singularRouteToken(token);
  return singular === token ? [token] : [token, singular];
}

function cjkTokenForms(token) {
  const characters = [...token];
  const forms = [token];
  for (let index = 0; index < characters.length - 1; index += 1) {
    forms.push(characters.slice(index, index + 2).join(""));
  }
  return forms;
}

export function canonicalRouteToken(token) {
  return singularRouteToken(token);
}

function singularRouteToken(token) {
  if (!ASCII_ROUTE_TOKEN.test(token)) {
    return token;
  }
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("s") && !/(?:ss|us|is)$/u.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

function isRouteToken(token) {
  return (token.length > 1 || CJK_ROUTE_TOKEN.test(token)) && !ROUTE_STOP_WORDS.has(token);
}

export function phraseKey(value) {
  return [...tokensFor(value)].join(" ");
}
