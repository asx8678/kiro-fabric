import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);


// src/runtime/json-budget.ts
import { isProxy } from "node:util/types";
var MAX_FABRIC_JSON_CHARS = 8e6;
var DEFAULT_FABRIC_JSON_CHARS = 2e6;
var MAX_FABRIC_JSON_DEPTH = 64;
var MAX_FABRIC_JSON_NODES = 1e5;
var budgetError = (detail) => new Error(`Fabric host JSON is outside the bounded JSON contract: ${detail}`);
var normalizedLimit = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) throw budgetError("invalid character limit");
  return Math.min(value, MAX_FABRIC_JSON_CHARS);
};
var MAX_ARRAY_INDEX = 4294967294;
var isArrayIndex = (key) => {
  if (key === "0") return true;
  if (!/^[1-9][0-9]*$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index <= MAX_ARRAY_INDEX;
};
var preflight = (root, maxChars) => {
  const seen = /* @__PURE__ */ new WeakSet();
  const stack = [
    { value: root, depth: 0, nested: false }
  ];
  let nodes = 0;
  let rawChars = 0;
  while (stack.length > 0) {
    const { value, depth, nested } = stack.pop();
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
    if (value === void 0 && !nested) continue;
    if (typeof value !== "object") throw budgetError(`unsupported ${typeof value} value`);
    if (isProxy(value)) throw budgetError("proxy object");
    if (depth >= MAX_FABRIC_JSON_DEPTH) throw budgetError("depth limit exceeded");
    if (seen.has(value)) throw budgetError("cyclic or shared object graph");
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length + nodes > MAX_FABRIC_JSON_NODES) throw budgetError("node limit exceeded");
      const descriptors2 = Object.getOwnPropertyDescriptors(value);
      if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors2).some((key) => key !== "length" && !isArrayIndex(key))) throw budgetError("non-index array property");
      for (let index = value.length - 1; index >= 0; index--) {
        const descriptor = descriptors2[String(index)];
        if (!descriptor || !("value" in descriptor)) throw budgetError("accessor or sparse array");
        stack.push({ value: descriptor.value, depth: depth + 1, nested: true });
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
      const key = keys[index];
      const descriptor = descriptors[key];
      if (!("value" in descriptor)) throw budgetError("accessor property");
      if (!descriptor.enumerable) continue;
      rawChars += key.length;
      if (rawChars > maxChars) throw budgetError(`more than ${maxChars} raw characters`);
      stack.push({ value: descriptor.value, depth: depth + 1, nested: true });
    }
  }
};
var jsonStringPrefix = (value, contentChars) => {
  if (!Number.isSafeInteger(contentChars) || contentChars < 0) throw budgetError("invalid string prefix budget");
  let end = 0, used = 0;
  while (end < value.length) {
    const unit = value.charCodeAt(end), next = value.charCodeAt(end + 1);
    const pair = unit >= 55296 && unit <= 56319 && next >= 56320 && next <= 57343;
    const width = pair ? 2 : 1;
    const cost = unit === 34 || unit === 92 ? 2 : unit < 32 ? [8, 9, 10, 12, 13].includes(unit) ? 2 : 6 : !pair && unit >= 55296 && unit <= 57343 ? 6 : width;
    if (used + cost > contentChars) break;
    used += cost;
    end += width;
  }
  return value.slice(0, end);
};
var fabricJsonText = (value, maxChars = DEFAULT_FABRIC_JSON_CHARS) => {
  const limit = normalizedLimit(maxChars);
  preflight(value, limit);
  if (value === void 0) return "null";
  const serialized = JSON.stringify(value);
  if (serialized === void 0) throw budgetError("value is not serializable");
  if (serialized.length > limit) throw budgetError(`more than ${limit} serialized characters`);
  return serialized;
};
var assertFabricJsonBudget = (value, maxChars = DEFAULT_FABRIC_JSON_CHARS) => {
  void fabricJsonText(value, maxChars);
};

export {
  MAX_FABRIC_JSON_CHARS,
  jsonStringPrefix,
  fabricJsonText,
  assertFabricJsonBudget
};
