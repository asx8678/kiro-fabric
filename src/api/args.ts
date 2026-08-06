import { FabricError } from "../errors.js";

export type ArgumentRecord = Record<string, unknown>;

export function invalidArguments(ref: string, expected: string): never {
  throw new FabricError("RUNTIME_FAILED", `Invalid arguments for ${ref}: ${expected}`);
}

export function isArgumentRecord(value: unknown): value is ArgumentRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function argumentRecord(ref: string, value: unknown): ArgumentRecord {
  if (!isArgumentRecord(value)) invalidArguments(ref, "expected an options object");
  return value;
}

export function aliasedArguments(
  value: ArgumentRecord,
  aliases: Record<string, string>,
): ArgumentRecord {
  const result = { ...value };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias in result) {
      if (!(canonical in result)) result[canonical] = result[alias];
      delete result[alias];
    }
  }
  return result;
}

export function requiredString(ref: string, value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    invalidArguments(ref, `${name} must be a non-empty string`);
  return value;
}

export function optionalNumber(ref: string, value: unknown, name: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value)))
    invalidArguments(ref, `${name} must be a finite number`);
}

export function positionalArguments(
  ref: string,
  args: readonly unknown[],
  fields: readonly string[],
): ArgumentRecord {
  if (args.length === 1 && typeof args[0] === "string") return { [fields[0]!]: args[0] };
  if (args.length === 1) return argumentRecord(ref, args[0]);
  if (args.length === 0 || args.length > fields.length)
    invalidArguments(ref, `expected an options object or ${fields.length} positional arguments`);
  const result: ArgumentRecord = {};
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value !== undefined) result[fields[index]!] = value;
  }
  return result;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Format context with optional relevanceHint annotations for better model
 * attention. Array items may also carry stability: "stable" | "volatile":
 * volatile items are moved after stable/unmarked ones (relative order within
 * each partition preserved) so the serialized context keeps a stable prefix
 * across calls — the cache-friendly section ordering that maximizes
 * provider-side prompt caching.
 */
export function formatContext(ctx: unknown): string {
  if (ctx === null || ctx === undefined) return "null";
  if (!Array.isArray(ctx)) return JSON.stringify(ctx);
  const items = ctx as Array<unknown>;
  const hasHints = items.some((item) => isRecord(item) && "relevanceHint" in item);
  const hasStability = items.some((item) => isRecord(item) && "stability" in item);
  if (!hasHints && !hasStability) return JSON.stringify(ctx);
  const ordered = hasStability
    ? [
        ...items.filter((item) => !(isRecord(item) && item.stability === "volatile")),
        ...items.filter((item) => isRecord(item) && item.stability === "volatile"),
      ]
    : items;
  return JSON.stringify(
    ordered.map((item) => {
      if (!isRecord(item) || (!("relevanceHint" in item) && !("stability" in item))) return item;
      const { relevanceHint, stability, ...rest } = item;
      return {
        ...(relevanceHint !== undefined ? { _relevance: relevanceHint } : {}),
        ...(stability !== undefined ? { _stability: stability } : {}),
        ...rest,
      };
    }),
  );
}
