import { isProxy } from "node:util/types";

/** Matches the largest configured nested-result bound. */
export const MAX_FABRIC_JSON_CHARS = 8_000_000;
const DEFAULT_FABRIC_JSON_CHARS = 2_000_000;
const MAX_FABRIC_JSON_DEPTH = 64;
const MAX_FABRIC_JSON_NODES = 100_000;

const budgetError = (detail: string): Error =>
  new Error(`Fabric host JSON is outside the bounded JSON contract: ${detail}`);

const normalizedLimit = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw budgetError("invalid character limit");
  return Math.min(value, MAX_FABRIC_JSON_CHARS);
};

/**
 * Reject non-JSON values, accessors, cycles/shared object graphs, excessive
 * depth/node counts, and obvious character overflow before JSON.stringify can
 * allocate from an attacker-controlled graph. Exact escaped length is checked
 * after this bounded preflight.
 */
const preflight = (root: unknown, maxChars: number): void => {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number; nested: boolean }> = [
    { value: root, depth: 0, nested: false },
  ];
  let nodes = 0;
  let rawChars = 0;
  while (stack.length > 0) {
    const { value, depth, nested } = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_FABRIC_JSON_NODES) throw budgetError("node limit exceeded");
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") {
      rawChars += value.length;
      if (rawChars > maxChars) throw budgetError(`more than ${maxChars} raw characters`);
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw budgetError("non-finite number");
      continue;
    }
    if (value === undefined && !nested) continue;
    if (typeof value !== "object") throw budgetError(`unsupported ${typeof value} value`);
    if (isProxy(value)) throw budgetError("proxy object");
    if (depth >= MAX_FABRIC_JSON_DEPTH) throw budgetError("depth limit exceeded");
    if (seen.has(value)) throw budgetError("cyclic or shared object graph");
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length + nodes > MAX_FABRIC_JSON_NODES) throw budgetError("node limit exceeded");
      for (let index = value.length - 1; index >= 0; index--) {
        stack.push({ value: value[index], depth: depth + 1, nested: true });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw budgetError("non-plain object");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) throw budgetError("symbol property");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length + nodes > MAX_FABRIC_JSON_NODES) throw budgetError("node limit exceeded");
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!;
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor)) throw budgetError("accessor property");
      if (!descriptor.enumerable) continue;
      rawChars += key.length;
      if (rawChars > maxChars) throw budgetError(`more than ${maxChars} raw characters`);
      stack.push({ value: descriptor.value, depth: depth + 1, nested: true });
    }
  }
};

/** Largest Unicode-safe prefix whose JSON-string content fits the budget.
 * Quotes around the string are excluded. Linear scan, no repeated serialization
 * of multi-megabyte prefixes; matches JSON.stringify's escapes/lone surrogates. */
export const jsonStringPrefix = (value: string, contentChars: number): string => {
  if (!Number.isSafeInteger(contentChars) || contentChars < 0) throw budgetError("invalid string prefix budget");
  let end = 0, used = 0;
  while (end < value.length) {
    const unit = value.charCodeAt(end), next = value.charCodeAt(end + 1);
    const pair = unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
    const width = pair ? 2 : 1;
    const cost = unit === 0x22 || unit === 0x5c ? 2
      : unit < 0x20 ? ([8, 9, 10, 12, 13].includes(unit) ? 2 : 6)
      : !pair && unit >= 0xd800 && unit <= 0xdfff ? 6 : width;
    if (used + cost > contentChars) break;
    used += cost; end += width;
  }
  return value.slice(0, end);
};

export const fabricJsonText = (
  value: unknown,
  maxChars = DEFAULT_FABRIC_JSON_CHARS,
): string => {
  const limit = normalizedLimit(maxChars);
  preflight(value, limit);
  if (value === undefined) return "null";
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw budgetError("value is not serializable");
  if (serialized.length > limit) throw budgetError(`more than ${limit} serialized characters`);
  return serialized;
};

export const assertFabricJsonBudget = (
  value: unknown,
  maxChars = DEFAULT_FABRIC_JSON_CHARS,
): void => {
  void fabricJsonText(value, maxChars);
};
