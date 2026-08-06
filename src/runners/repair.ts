import { Ajv } from "ajv/dist/ajv.js";
import { extractFramed, stripAnsi } from "./parser.js";

/**
 * Deterministic validate-then-repair for AI output, adapted from
 * pi-tool-repair's finite repair set. Every rule is schema-guided: a
 * transformation is applied only when the declared output schema makes the
 * intended shape unambiguous. No LLM calls and no budget consumption — a
 * successful deterministic repair skips the paid repair retry entirely.
 */

export interface RepairOutcome {
  value: unknown;
  /** Rules that fired, in application order, each annotated with its path. */
  repairs: string[];
}

type Schema = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function deepClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepClone);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, deepClone(v)]));
}

/** JSON type name of a runtime value ("integer" also satisfies "number"). */
function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Declared JSON type(s) of a schema, tolerating `type: [...]` unions. */
function declaredTypes(schema: Schema | undefined): string[] {
  if (!schema) return [];
  const type = schema.type;
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === "string");
  if (schema.properties !== undefined || schema.required !== undefined) return ["object"];
  if (schema.items !== undefined) return ["array"];
  return [];
}

const allowsNull = (schema: Schema | undefined): boolean =>
  declaredTypes(schema).includes("null") || schema?.nullable === true;

/** Pick the most relevant subschema from anyOf/oneOf for the current value. */
function resolveSchema(schema: Schema | undefined, value: unknown): Schema | undefined {
  if (!schema) return undefined;
  for (const key of ["anyOf", "oneOf"] as const) {
    const options = schema[key];
    if (Array.isArray(options) && options.length > 0) {
      const type = jsonType(value);
      const match = options.find(
        (option) =>
          isPlainObject(option) &&
          (declaredTypes(option).includes(type) ||
            (type === "object" && declaredTypes(option).length === 0)),
      );
      return resolveSchema((match ?? options[0]) as Schema, value);
    }
  }
  return schema;
}

const NUMBER_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_-]/g, "");

interface WalkResult {
  value: unknown;
  changed: boolean;
}

/**
 * One repair pass over a value against its schema. Objects and arrays are
 * mutated in place; scalar replacements are written back by the parent.
 */
function walk(
  value: unknown,
  schema: Schema | undefined,
  path: string,
  repairs: string[],
): WalkResult {
  schema = resolveSchema(schema, value);
  if (Array.isArray(value)) {
    let changed = false;
    const itemSchemas = Array.isArray(schema?.items) ? (schema.items as Schema[]) : undefined;
    for (let index = 0; index < value.length; index++) {
      const itemSchema = itemSchemas ? itemSchemas[index] : (schema?.items as Schema | undefined);
      if (isPlainObject(value[index]) || Array.isArray(value[index])) {
        const sub = walk(value[index], itemSchema, `${path}[${index}]`, repairs);
        if (sub.changed) changed = true;
      }
    }
    return { value, changed };
  }
  if (!isPlainObject(value)) return { value, changed: false };

  const properties = isPlainObject(schema?.properties) ? (schema.properties as Schema) : {};
  const required = Array.isArray(schema?.required)
    ? (schema.required as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  const additionalFalse = schema?.additionalProperties === false;
  let changed = false;

  for (const originalKey of Object.keys(value)) {
    let key = originalKey;
    let childPath = path ? `${path}.${key}` : key;
    let propSchema = isPlainObject(properties[key]) ? (properties[key] as Schema) : undefined;

    // renameAliasedField: unknown key (additionalProperties: false) that
    // normalizes to exactly one missing declared property (snake_case,
    // camelCase, kebab-case, or case variants of each other).
    if (!(key in properties) && additionalFalse) {
      const candidates = Object.keys(properties).filter(
        (name) => !(name in value) && normalizeKey(name) === normalizeKey(key),
      );
      if (candidates.length === 1) {
        const canonical = candidates[0]!;
        value[canonical] = value[key];
        delete value[key];
        repairs.push(`renameAliasedField(${childPath}→${canonical})`);
        changed = true;
        key = canonical;
        childPath = path ? `${path}.${key}` : key;
        propSchema = isPlainObject(properties[key]) ? (properties[key] as Schema) : undefined;
      }
    }

    const current = value[key];
    propSchema = resolveSchema(propSchema, current);
    const types = declaredTypes(propSchema);

    // dropNullOptional: explicit null on a field the schema neither requires
    // nor permits to be null.
    if (current === null && propSchema && !required.includes(key) && !allowsNull(propSchema)) {
      delete value[key];
      repairs.push(`dropNullOptional(${childPath})`);
      changed = true;
      continue;
    }

    // dropEmptyObjectPlaceholder: `{}` where the schema expects a non-object.
    if (
      isPlainObject(current) &&
      Object.keys(current).length === 0 &&
      types.length > 0 &&
      !types.includes("object") &&
      !required.includes(key)
    ) {
      delete value[key];
      repairs.push(`dropEmptyObjectPlaceholder(${childPath})`);
      changed = true;
      continue;
    }

    // parseStringifiedValue: a JSON array/object sent as a string.
    if (
      typeof current === "string" &&
      (types.includes("array") || types.includes("object")) &&
      !types.includes("string")
    ) {
      const trimmed = current.trim();
      const opener = types.includes("array") ? "[" : "{";
      if (trimmed.startsWith(opener)) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          const matches = types.includes("array") ? Array.isArray(parsed) : isPlainObject(parsed);
          if (matches) {
            value[key] = parsed;
            repairs.push(`parseStringifiedValue(${childPath})`);
            changed = true;
          }
        } catch {
          // Not parseable; leave for the remaining rules or final validation.
        }
      }
    }

    // wrapBareValueAsArray: a scalar where the schema expects only an array.
    if (
      value[key] !== null &&
      value[key] !== undefined &&
      !Array.isArray(value[key]) &&
      types.includes("array") &&
      !types.includes(jsonType(value[key]))
    ) {
      value[key] = [value[key]];
      repairs.push(`wrapBareValueAsArray(${childPath})`);
      changed = true;
    }

    // coerceScalar: numeric/boolean text where the schema declares a scalar.
    if (typeof value[key] === "string") {
      const text = (value[key] as string).trim();
      if (
        (types.includes("number") || types.includes("integer")) &&
        !types.includes("string") &&
        NUMBER_TEXT.test(text)
      ) {
        value[key] = Number(text);
        repairs.push(`coerceScalar(${childPath})`);
        changed = true;
      } else if (
        types.includes("boolean") &&
        !types.includes("string") &&
        /^(true|false)$/i.test(text)
      ) {
        value[key] = text.toLowerCase() === "true";
        repairs.push(`coerceScalar(${childPath})`);
        changed = true;
      }
    }

    // stripAnchorBleed: regex anchors copied out of the schema's `pattern`
    // into the value itself (Kimi K2-style schema poisoning).
    if (typeof value[key] === "string" && propSchema && typeof propSchema.pattern === "string") {
      let text = value[key] as string;
      const before = text;
      while (text.startsWith("^")) text = text.slice(1);
      while (text.endsWith("$")) text = text.slice(0, -1);
      if (text !== before && text.length > 0) {
        value[key] = text;
        repairs.push(`stripAnchorBleed(${childPath})`);
        changed = true;
      }
    }

    if (isPlainObject(value[key]) || Array.isArray(value[key])) {
      const sub = walk(value[key], propSchema, childPath, repairs);
      if (sub.changed) changed = true;
    }
  }
  return { value, changed };
}

/**
 * Validate a parsed value against the output schema; when invalid, apply the
 * deterministic repair ladder (fixpoint, at most four passes) and validate
 * again. Returns undefined when the value cannot be repaired to validity.
 */
export function tryRepairOutput(value: unknown, schema: Schema): RepairOutcome | undefined {
  const ajv = new Ajv({ allErrors: true, strict: false });
  if (ajv.validate(schema, value)) return { value, repairs: [] };
  const clone = deepClone(value) as Record<string, unknown> | unknown[];
  if (!isPlainObject(clone) && !Array.isArray(clone)) return undefined;
  const repairs: string[] = [];
  let changed = true;
  let passes = 0;
  while (changed && passes < 4) {
    passes++;
    changed = walk(clone, schema, "", repairs).changed;
  }
  const check = new Ajv({ allErrors: true, strict: false });
  if (!check.validate(schema, clone)) return undefined;
  return { value: clone, repairs };
}

/** Salvage the outermost JSON object/array from prose or leaked grammar. */
export function salvageJson(text: string): unknown | undefined {
  const unfenced = text.replace(/```(?:json|JSON)?/g, "");
  const open = unfenced.search(/[{[]/);
  if (open < 0) return undefined;
  const closer = unfenced[open] === "{" ? "}" : "]";
  const close = unfenced.lastIndexOf(closer);
  if (close <= open) return undefined;
  try {
    return JSON.parse(unfenced.slice(open, close + 1));
  } catch {
    return undefined;
  }
}

/**
 * Recover a valid result from output parseFramed rejected: salvage JSON from
 * unframed or fenced output, then apply the schema-guided repair ladder.
 * Returns undefined when no deterministic recovery is possible.
 */
export function repairFramedOutput(
  stdout: string,
  schema: Schema | undefined,
  maxChars: number,
): RepairOutcome | undefined {
  const repairs: string[] = [];
  let candidate: unknown;
  const framed = extractFramed(stdout);
  if (framed !== undefined && framed.length <= maxChars) {
    try {
      candidate = JSON.parse(framed);
    } catch {
      const salvaged = salvageJson(framed);
      if (salvaged !== undefined) {
        candidate = salvaged;
        repairs.push("salvageJson");
      }
    }
  }
  if (candidate === undefined) {
    const clean = stripAnsi(stdout);
    const bounded = clean.length > maxChars ? clean.slice(-maxChars) : clean;
    const salvaged = salvageJson(bounded);
    if (salvaged === undefined) return undefined;
    candidate = salvaged;
    repairs.push("salvageJson");
  }
  if (!schema) return repairs.length > 0 ? { value: candidate, repairs } : undefined;
  const fixed = tryRepairOutput(candidate, schema);
  if (!fixed) return undefined;
  return { value: fixed.value, repairs: [...repairs, ...fixed.repairs] };
}
