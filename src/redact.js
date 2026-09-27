// Redact before anything is persisted or sent to the model — callers read card
// and SSN digits aloud, and the transcript is the first place they land.
const PATTERNS = [
  // 13-19 digit card numbers, however the caller spaced or hyphenated them
  [/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED_CARD]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]'],
  // CVV spoken as "security code 123"
  [/\b(?:cvv|cvc|security code)\s*(?:is\s*)?\d{3,4}\b/gi, '[REDACTED_CVV]'],
];

export function redact(text) {
  if (!text) return text;
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, (match) =>
      // Don't redact ordinary numbers that happen to be long enough only
      // because of spacing — require at least 13 actual digits.
      (match.match(/\d/g) || []).length >= 13 ||
      replacement !== '[REDACTED_CARD]'
        ? replacement
        : match,
    );
  }
  return out;
}
