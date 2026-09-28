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

/** ECMAScript array indices stop at 2^32-2. A larger all-digit own property is an
 * ordinary property that JSON.stringify drops from the array's element list, so
 * accepting it here would let the validated host view and the serialized view
 * disagree about the same value. */
const MAX_ARRAY_INDEX = 4_294_967_294;
const isArrayIndex = (key: string): boolean => {
  if (key === "0") return true;
  if (!/^[1-9][0-9]*$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index <= MAX_ARRAY_INDEX;
};

/**
 * Reject non-JSON values, accessors, cycles/shared object graphs, excessive
 * depth/node counts, and obvious character overflow before JSON.stringify can
 * allocate from an attacker-controlled graph. Exact escaped length is checked
 * after this bounded preflight.
 */
const preflight = (root: unknown, maxChars: number): unknown => {
  const seen = new WeakSet<object>();
  const snapshot: Record<string, unknown> = Object.create(null);
  const stack: Array<{ value: unknown; depth: number; nested: boolean; parent: Record<string, unknown>; key: string }> = [
    { value: root, depth: 0, nested: false, parent: snapshot, key: "value" },
  ];
  let nodes = 1;
  let rawChars = 0;
  while (stack.length > 0) {
    const { value, depth, nested, parent, key } = stack.pop()!;
    if (value === null || typeof value === "boolean") { parent[key] = value; continue; }
    if (typeof value === "string") {
      rawChars += value.length;
      if (rawChars > maxChars) throw budgetError(`more than ${maxChars} raw characters`);
      parent[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw budgetError("non-finite number");
      parent[key] = value;
      continue;
    }
    if (value === undefined && !nested) continue;
    if (typeof value !== "object") throw budgetError(`unsupported ${typeof value} value`);
    if (isProxy(value)) throw budgetError("proxy object");
    if (depth >= MAX_FABRIC_JSON_DEPTH) throw budgetError("depth limit exceeded");
    if (seen.has(value)) throw budgetError("cyclic or shared object graph");
    seen.add(value);

    if (Array.isArray(value)) {
      nodes += value.length;
      if (nodes > MAX_FABRIC_JSON_NODES) throw budgetError("node limit exceeded");
      const copy: Record<string, unknown> = Object.setPrototypeOf([], null);
      parent[key] = copy;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).some(key => key !== "length" && !isArrayIndex(key))) throw budgetError("non-index array property");
      for (let index = value.length - 1; index >= 0; index--) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) throw budgetError("accessor or sparse array");
        stack.push({ value: descriptor.value, depth: depth + 1, nested: true, parent: copy, key: String(index) });
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
    const copy: Record<string, unknown> = Object.create(null);
    parent[key] = copy;
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!;
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor)) throw budgetError("accessor property");
      if (!descriptor.enumerable) continue;
      nodes += 1;
      rawChars += key.length;
      if (rawChars > maxChars) throw budgetError(`more than ${maxChars} raw characters`);
      stack.push({ value: descriptor.value, depth: depth + 1, nested: true, parent: copy, key });
    }
  }
  return snapshot.value;
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
  const snapshot = preflight(value, limit);
  if (value === undefined) return "null";
  const serialized = JSON.stringify(snapshot);
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
