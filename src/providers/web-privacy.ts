// Defense in depth, not semantic DLP: confidential prose, unknown secret
// formats and deliberately encoded data cannot all be recognized. Never log
// rejected input or silently redact it into a different authorized request.
const SECRET_PATTERN = /-----BEGIN[ A-Z]*PRIVATE KEY-----|\b(?:gh[pousr]_[a-z0-9_]{12,}|github_pat_[a-z0-9_]{12,}|sk-[a-z0-9_-]{12,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|\b(?:Bearer|Basic)\s+[a-z0-9+/_=.-]{8,}/iu;
const SECRET_ASSIGNMENT = /(?:^|[\s?&#;,/"'])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|client[_-]?secret|authorization|cookie|credential|signature|x-amz-signature)\s*["']?\s*[:=]\s*["']?\S+/iu;
const PERSONAL_EMAIL = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/iu;
const SENSITIVE_URL_KEY = /^(?:api[_-]?key|.*token|password|passwd|secret|client[_-]?secret|auth|authorization|cookie|credential|sig|signature|x-amz-(?:signature|credential|security-token))$/iu;

export function assertPublicWebInput(input: string): void {
  let value = input.normalize("NFKC");
  for (let pass = 0; pass < 4; pass += 1) {
    let sensitiveUrl = false;
    try {
      const url = new URL(value);
      sensitiveUrl = [...url.searchParams.keys()].some(key => SENSITIVE_URL_KEY.test(key));
    } catch { /* Search text is not necessarily a URL. */ }
    if (sensitiveUrl || SECRET_PATTERN.test(value) || SECRET_ASSIGNMENT.test(value) || PERSONAL_EMAIL.test(value)) {
      throw new Error("Web input rejected: possible sensitive information. Use a public, non-sensitive query or URL; rejected values are not echoed.");
    }
    // Bounded decoding detects common percent-encoding disguises, including
    // mixed valid/invalid escapes. It does not claim to decode every encoding.
    const next = value.replace(/%([0-9a-f]{2})/giu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (next === value) break;
    value = next;
  }
}
