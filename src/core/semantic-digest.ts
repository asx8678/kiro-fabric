import { createHash } from "node:crypto";
import { fabricJsonText, MAX_FABRIC_JSON_CHARS } from "../runtime/json-budget.js";

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
};

/** A bounded, key-order-independent digest for public capability metadata. */
export const semanticDigest = (domain: string, value: unknown): string => {
  const bounded = fabricJsonText(value, MAX_FABRIC_JSON_CHARS);
  const canonical = fabricJsonText(sortJson(JSON.parse(bounded)), MAX_FABRIC_JSON_CHARS);
  return createHash("sha256").update(domain).update("\0").update(canonical).digest("hex");
};
