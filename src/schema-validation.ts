import { Value } from "typebox/value";

const MAX_VALIDATION_MESSAGE_CHARS = 2_000;
const REDACTED_PROPERTY_SEGMENT = "<property>";

const truncateString = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max)}…`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const delegatedSchemaKeywords = new Set([
  "allOf", "anyOf", "contains", "dependentSchemas", "else", "if", "not",
  "oneOf", "pattern", "patternProperties", "propertyNames", "then", "uniqueItems",
]);

const walkLocallyBoundedSchema = (schema: Record<string, unknown>): boolean => {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: schema, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  let stringChars = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    nodes += 1;
    if (nodes > 5_000 || depth > 32) return false;
    if (typeof value === "string") {
      stringChars += value.length;
      if (stringChars > 100_000) return false;
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) stack.push({ value: child, depth: depth + 1 });
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      // Complex combinators and untrusted regular expressions can multiply
      // work or block the host event loop. Such external schemas remain
      // advisory and are delegated to the remote MCP server.
      if (delegatedSchemaKeywords.has(key)) return false;
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  return true;
};

/** Schema descriptors are immutable and reference-stable for the process
 * lifetime, so the bounded-walk verdict (a walk of up to 5,000 nodes) is
 * cached per schema object instead of repeated on every bridged call. */
const locallyBoundedSchemaCache = new WeakMap<object, boolean>();
const locallyBoundedSchema = (schema: Record<string, unknown>): boolean => {
  const cached = locallyBoundedSchemaCache.get(schema);
  if (cached !== undefined) return cached;
  const result = walkLocallyBoundedSchema(schema);
  locallyBoundedSchemaCache.set(schema, result);
  return result;
};

const pointerPart = (value: string): string => value.replaceAll("~", "~0").replaceAll("/", "~1");
const decodePointerPart = (value: string): string => value.replaceAll("~1", "/").replaceAll("~0", "~");

const schemaForDynamicProperty = (
  schema: Record<string, unknown>,
  property: string,
): unknown => {
  const patterns = isRecord(schema.patternProperties) ? schema.patternProperties : undefined;
  if (patterns) {
    for (const [pattern, child] of Object.entries(patterns)) {
      try {
        if (new RegExp(pattern).test(property)) return child;
      } catch {
        // Invalid external patterns make this branch unavailable for path
        // rendering; validation itself will fail closed in the outer catch.
      }
    }
  }
  return isRecord(schema.additionalProperties) ? schema.additionalProperties : undefined;
};

/**
 * Render only schema-owned object property names. Instance paths can contain
 * arbitrary keys supplied by the caller (including credentials), so dynamic
 * property segments are replaced even when a pattern/additional-properties
 * schema lets validation continue below them.
 */
const traceSafePath = (schema: Record<string, unknown>, path: unknown): string => {
  const rawParts = typeof path === "string"
    ? (path === "" || path === "/" ? [] : path.split("/").slice(1).map(decodePointerPart))
    : Array.isArray(path)
      ? path.filter((part): part is string | number =>
          typeof part === "string" || typeof part === "number"
        ).map(String)
      : [];
  const safeParts: string[] = [];
  let current: unknown = schema;
  for (const part of rawParts) {
    if (!isRecord(current)) {
      safeParts.push(REDACTED_PROPERTY_SEGMENT);
      continue;
    }
    if (current.type === "array" && /^\d+$/.test(part)) {
      safeParts.push(part);
      current = Array.isArray(current.items)
        ? current.items[Number(part)]
        : current.items;
      continue;
    }
    const properties = isRecord(current.properties) ? current.properties : undefined;
    if (properties && Object.hasOwn(properties, part)) {
      safeParts.push(part);
      current = properties[part];
      continue;
    }
    safeParts.push(REDACTED_PROPERTY_SEGMENT);
    current = schemaForDynamicProperty(current, part);
  }
  return safeParts.map((part) => `/${pointerPart(part)}`).join("");
};

const prefixedPath = (
  schema: Record<string, unknown>,
  prefix: string,
  path: unknown,
): string => `${prefix}${traceSafePath(schema, path)}` || "/";

const traceSafeErrorMessage = (error: { keyword?: unknown; message?: unknown }): string => {
  // TypeBox includes rejected caller-owned keys in propertyNames messages.
  // additionalProperties currently uses a generic message, but pinning both
  // avoids a future formatter change turning its params into trace content.
  if (error.keyword === "additionalProperties") return "must not have additional properties";
  if (error.keyword === "propertyNames") return "property names are invalid";
  return typeof error.message === "string" ? error.message : "Schema validation failed";
};

export type SchemaValidationResult =
  | { status: "valid" }
  | { status: "invalid"; message: string }
  | { status: "unavailable" };

/**
 * Validate without exposing caller values or caller-owned property names in
 * diagnostics. A non-object or unsupported schema is reported as unavailable
 * so callers with advisory external schemas can preserve remote validation.
 */
export const validateSchemaValue = (
  schema: unknown,
  value: unknown,
  options: { pathPrefix?: string; includeInstancePath?: boolean } = {},
): SchemaValidationResult => {
  if (!isRecord(schema) || !locallyBoundedSchema(schema)) return { status: "unavailable" };
  const prefix = options.pathPrefix ?? "";
  try {
    const messages: string[] = [];
    for (const rawError of Value.Errors(schema, value)) {
      const error = rawError as {
        keyword?: unknown;
        message?: unknown;
        path?: unknown;
        instancePath?: unknown;
      };
      const path = error.path ??
        (options.includeInstancePath ? error.instancePath : undefined);
      const parentPath = prefixedPath(schema, prefix, path);
      const safePath = error.keyword === "additionalProperties" || error.keyword === "propertyNames"
        ? `${parentPath === "/" ? "" : parentPath}/${REDACTED_PROPERTY_SEGMENT}`
        : parentPath;
      messages.push(`${safePath}: ${traceSafeErrorMessage(error)}`);
      if (messages.length >= 5) break;
    }
    if (messages.length === 0) return { status: "valid" };
    return {
      status: "invalid",
      message: truncateString(
        messages.join("; ") || `${prefixedPath(schema, prefix, undefined)}: Schema validation failed`,
        MAX_VALIDATION_MESSAGE_CHARS,
      ),
    };
  } catch {
    return { status: "unavailable" };
  }
};

/** Fail-closed validation used for Fabric-owned action descriptors. */
export const schemaValidationMessage = (
  schema: Record<string, unknown>,
  value: Record<string, unknown>,
): string | undefined => {
  const result = validateSchemaValue(schema, value, { includeInstancePath: true });
  if (result.status === "valid") return undefined;
  if (result.status === "unavailable") return "Schema validator failed";
  // Preserve the historical root formatting while retaining safe nested paths.
  return result.message.replace(/^\/: /, "");
};
