/**
 * Deterministic YAML serializer for JSON-safe values. YAML drops the
 * punctuation tax of JSON (quotes, braces, commas), which makes it a
 * cheaper encoding for AI-call contexts and structured results. Only the
 * JSON data model is supported: objects with string keys, arrays, strings,
 * finite numbers, booleans, and null. undefined object properties are
 * dropped (JSON.stringify semantics); cycles and unsupported types throw.
 */

const MAX_DEPTH = 32;

const PLAIN_UNSAFE_START = /^[-?:,\[\]{}#&*!|>'"%@`]/;
const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const YAML_KEYWORDS = /^(null|~|true|false|yes|no|on|off)$/i;

/** A string may be emitted as a plain (unquoted) YAML scalar. */
function isPlainSafe(text: string): boolean {
  if (text.length === 0) return false;
  if (/^\s|\s$/.test(text)) return false;
  if (/[\n\r\t\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return false;
  if (YAML_KEYWORDS.test(text) || NUMERIC_TEXT.test(text)) return false;
  if (PLAIN_UNSAFE_START.test(text)) return false;
  if (text.endsWith(":")) return false;
  if (/: |\s#/.test(text)) return false;
  return true;
}

const isBlockSafe = (text: string): boolean =>
  !text.includes("\r") && text.split("\n").every((line) => !/[ \t]$/.test(line));

function writeScalar(value: unknown, prefix: string, indent: number, lines: string[]): void {
  if (
    value === null ||
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    lines.push(`${prefix}null`);
    return;
  }
  if (typeof value === "boolean") {
    lines.push(`${prefix}${value}`);
    return;
  }
  if (typeof value === "number") {
    lines.push(`${prefix}${Number.isFinite(value) ? String(value) : "null"}`);
    return;
  }
  if (typeof value === "string") {
    if (value.includes("\n") && isBlockSafe(value)) {
      // indent already denotes the block content indent (parent indent + 2).
      const pad = " ".repeat(indent);
      lines.push(`${prefix}|-`);
      for (const line of value.split("\n")) lines.push(line.length > 0 ? pad + line : "");
      return;
    }
    lines.push(`${prefix}${isPlainSafe(value) ? value : JSON.stringify(value)}`);
    return;
  }
  throw new Error(`toYaml: unsupported value type ${typeof value}`);
}

const isScalar = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  ["string", "number", "boolean", "function", "symbol"].includes(typeof value);

function emit(
  value: unknown,
  indent: number,
  prefix: string,
  lines: string[],
  ancestors: Set<object>,
  depth: number,
): void {
  if (depth > MAX_DEPTH) throw new Error("toYaml: maximum nesting depth exceeded");
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error("toYaml: cyclic value");
    if (value.length === 0) {
      lines.push(`${prefix}[]`);
      return;
    }
    ancestors.add(value);
    for (const item of value) {
      if (isScalar(item)) writeScalar(item, `${pad}- `, indent + 2, lines);
      else {
        lines.push(`${pad}-`);
        emit(item, indent + 2, "", lines, ancestors, depth + 1);
      }
    }
    ancestors.delete(value);
    return;
  }
  if (typeof value === "object" && value !== null) {
    if (ancestors.has(value)) throw new Error("toYaml: cyclic value");
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined && typeof v !== "function" && typeof v !== "symbol",
    );
    if (entries.length === 0) {
      lines.push(`${prefix}{}`);
      return;
    }
    ancestors.add(value);
    for (const [key, v] of entries) {
      const safeKey = isPlainSafe(key) ? key : JSON.stringify(key);
      if (isScalar(v)) writeScalar(v, `${pad}${safeKey}: `, indent + 2, lines);
      else {
        lines.push(`${pad}${safeKey}:`);
        emit(v, indent + 2, "", lines, ancestors, depth + 1);
      }
    }
    ancestors.delete(value);
    return;
  }
  writeScalar(value, prefix, indent + 2, lines);
}

/** Serialize a JSON-safe value as YAML. Root scalars produce a single line. */
export function toYaml(value: unknown): string {
  const lines: string[] = [];
  emit(value, 0, "", lines, new Set<object>(), 0);
  return lines.join("\n");
}
