const patterns: Array<{ className: string; regex: RegExp; replace: (match: string, placeholder: string, groups: string[]) => string }> = [
  { className: "private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, replace: (_m, p) => p },
  { className: "authorization", regex: /(authorization\s*:\s*(?:bearer|basic)\s+)([^\s,"']{12,})/gi, replace: (_m, p, g) => `${g[0]}${p}` },
  { className: "credential", regex: /((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\s*[=:]\s*["']?)([^\s,"';}]{8,})/gi, replace: (_m, p, g) => `${g[0]}${p}` },
  { className: "aws-access-key", regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: (_m, p) => p },
  { className: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replace: (_m, p) => p },
  { className: "large-media", regex: /data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]{256,}/gi, replace: (_m, p) => p }
];

/** Per-request deterministic redaction. Placeholder ordinals depend only on encounter order, never secret values. */
export class RequestRedactor {
  private readonly counts = new Map<string, number>();
  redact(text: string): string {
    let output = text;
    for (const pattern of patterns) output = output.replace(pattern.regex, (...args: unknown[]) => {
      const groups = args.slice(1, -2).map(String);
      const ordinal = (this.counts.get(pattern.className) ?? 0) + 1;
      this.counts.set(pattern.className, ordinal);
      return pattern.replace(String(args[0]), `[REDACTED:${pattern.className}:${ordinal}]`, groups);
    });
    return output;
  }
  value<T>(value: T): T {
    if (typeof value === "string") return this.redact(value) as T;
    if (Array.isArray(value)) return value.map(item => this.value(item)) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.value(item)])) as T;
    return value;
  }
}

export function redactSensitive(text: string): string { return new RequestRedactor().redact(text); }