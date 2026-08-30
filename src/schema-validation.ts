import { Value } from "typebox/value";

const MAX_VALIDATION_MESSAGE_CHARS = 2_000;

const truncateString = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max)}…`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unexpectedKeys = (
  schema: Record<string, unknown>,
  value: unknown,
): string[] => {
  if (schema.type !== "object" || schema.additionalProperties !== false || !isRecord(value)) {
    return [];
  }
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  if (!properties) return [];
  return Object.keys(value).filter((key) => !(key in properties));
};

const pointerPart = (value: string): string => value.replaceAll("~", "~0").replaceAll("/", "~1");

const prefixedPath = (prefix: string, path: unknown): string => {
  const suffix = typeof path === "string"
    ? (path !== "" && path !== "/" ? path : "")
    : Array.isArray(path)
      ? path
          .filter((part): part is string | number =>
            typeof part === "string" || typeof part === "number",
          )
          .map((part) => `/${pointerPart(String(part))}`)
          .join("")
      : "";
  return `${prefix}${suffix}` || "/";
};

export type SchemaValidationResult =
  | { status: "valid" }
  | { status: "invalid"; message: string }
  | { status: "unavailable" };

/**
 * Validate without exposing values in diagnostics. A non-object or unsupported
 * schema is reported as unavailable so callers with advisory external schemas
 * can preserve their remote-validation fallback.
 */
export const validateSchemaValue = (
  schema: unknown,
  value: unknown,
  options: { pathPrefix?: string; includeInstancePath?: boolean } = {},
): SchemaValidationResult => {
  if (!isRecord(schema)) return { status: "unavailable" };
  const prefix = options.pathPrefix ?? "";
  try {
    const messages: string[] = [];
    for (const error of Value.Errors(schema, value)) {
      const location = error as { path?: unknown; instancePath?: unknown };
      const path = location.path ??
        (options.includeInstancePath ? location.instancePath : undefined);
      messages.push(`${prefixedPath(prefix, path)}: ${error.message}`);
      if (messages.length >= 5) break;
    }
    if (messages.length === 0) return { status: "valid" };
    for (const key of unexpectedKeys(schema, value).slice(0, 5)) {
      messages.push(
        `${prefixedPath(prefix, `/${pointerPart(key)}`)}: must not have additional properties`,
      );
    }
    return {
      status: "invalid",
      message: truncateString(
        messages.join("; ") || `${prefixedPath(prefix, undefined)}: Schema validation failed`,
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
  const result = validateSchemaValue(schema, value);
  if (result.status === "valid") return undefined;
  if (result.status === "unavailable") return "Schema validator failed";
  // Preserve the historical root formatting while retaining nested paths.
  return result.message.replace(/^\/: /, "");
};
