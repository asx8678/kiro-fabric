import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  PI_CORE_COMPATIBILITY_ARGUMENT_TYPE_NAMES,
  PI_CORE_NUMERIC_FIELDS
} from "./chunk-3NMON5KG.js";
import {
  PI_CORE_TOOL_NAMES
} from "./chunk-D27TRCNO.js";
import "./chunk-GX475RD4.js";

// src/runtime/core-override-guest-types.ts
var LOOSE_ARGUMENT_TYPE = "Record<string, unknown>";
var MAX_SCHEMA_DEPTH = 8;
var MAX_SCHEMA_MEMBERS = 128;
var MAX_SCHEMA_SOURCE_CHARS = 32e3;
var MAX_SCHEMA_OUTPUT_CHARS = 8e3;
var MAX_DECLARATION_OUTPUT_CHARS = 32e3;
var MAX_UNION_MEMBERS = 16;
var IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
var compatibilityArgumentTypeFor = (name) => PI_CORE_COMPATIBILITY_ARGUMENT_TYPE_NAMES[name];
var returnTypeFor = (name) => `ReturnType<PiToolsApi["${name}"]>`;
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var propertyKey = (name) => IDENTIFIER.test(name) ? name : JSON.stringify(name);
var literalType = (value) => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  throw new Error("Schema literal is not a JSON primitive");
};
var unique = (values) => [...new Set(values)];
var unionType = (parts) => {
  const members = unique(parts);
  if (members.length === 0) throw new Error("Schema union has no members");
  return members.length === 1 ? members[0] : members.join(" | ");
};
var schemaTypes = (schema) => {
  const value = schema.type;
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string")) {
    return unique(value);
  }
  if (value === void 0) return [];
  throw new Error("Schema type is malformed");
};
var unsupportedSchemaKeys = /* @__PURE__ */ new Set([
  "$defs",
  "$ref",
  "definitions",
  "dependentRequired",
  "dependentSchemas",
  "dependencies",
  "if",
  "not",
  "patternProperties",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
  "unless",
  "when"
]);
var countMember = (state) => {
  state.members += 1;
  if (state.members > MAX_SCHEMA_MEMBERS) throw new Error("Schema member budget exceeded");
};
var recordSchema = (schema, state) => {
  for (const key of unsupportedSchemaKeys) {
    if (key in schema) throw new Error(`Unsupported schema keyword: ${key}`);
  }
  if (state.active.has(schema)) throw new Error("Recursive schema");
  state.active.add(schema);
};
var renderSchema = (value, state, depth) => {
  if (depth > MAX_SCHEMA_DEPTH) throw new Error("Schema depth budget exceeded");
  if (value === true) return "unknown";
  if (value === false) return "never";
  if (!isRecord(value)) throw new Error("Schema is malformed");
  recordSchema(value, state);
  try {
    if (Object.hasOwn(value, "const")) return literalType(value.const);
    if (Object.hasOwn(value, "enum")) {
      if (!Array.isArray(value.enum) || value.enum.length === 0) {
        throw new Error("Schema enum is malformed");
      }
      if (value.enum.length > MAX_UNION_MEMBERS) {
        throw new Error("Schema union budget exceeded");
      }
      return unionType(value.enum.map((entry) => {
        countMember(state);
        return literalType(entry);
      }));
    }
    const alternates = Array.isArray(value.anyOf) ? value.anyOf : Array.isArray(value.oneOf) ? value.oneOf : void 0;
    if (alternates) {
      if (alternates.length === 0 || alternates.length > MAX_UNION_MEMBERS) {
        throw new Error("Schema union is malformed or over budget");
      }
      return unionType(alternates.map((entry) => {
        countMember(state);
        return renderSchema(entry, state, depth + 1);
      }));
    }
    if (Object.hasOwn(value, "allOf")) {
      if (!Array.isArray(value.allOf) || value.allOf.length === 0 || value.allOf.length > MAX_UNION_MEMBERS) {
        throw new Error("Schema intersection is malformed or over budget");
      }
      return value.allOf.map((entry) => {
        countMember(state);
        const rendered2 = renderSchema(entry, state, depth + 1);
        return rendered2.includes(" | ") ? `(${rendered2})` : rendered2;
      }).join(" & ");
    }
    if (Object.hasOwn(value, "nullable") && typeof value.nullable !== "boolean") {
      throw new Error("Schema nullable flag is malformed");
    }
    const types = schemaTypes(value);
    let rendered;
    if (types.length > 1) {
      rendered = unionType(types.map((type) => renderSchema({ ...value, type }, state, depth + 1)));
    } else {
      const type = types[0];
      if (type === void 0) {
        rendered = isRecord(value.properties) || Object.hasOwn(value, "additionalProperties") ? renderObject(value, state, depth) : (() => {
          throw new Error("Schema has no supported type");
        })();
      } else if (type === "object") {
        rendered = renderObject(value, state, depth);
      } else if (type === "string") {
        rendered = "string";
      } else if (type === "number" || type === "integer") {
        rendered = "number";
      } else if (type === "boolean") {
        rendered = "boolean";
      } else if (type === "null") {
        rendered = "null";
      } else if (type === "array") {
        rendered = renderArray(value, state, depth);
      } else {
        throw new Error(`Unsupported schema type: ${type}`);
      }
    }
    return value.nullable === true && !rendered.split(" | ").includes("null") ? `${rendered} | null` : rendered;
  } finally {
    state.active.delete(value);
  }
};
var renderObject = (schema, state, depth) => {
  const rawProperties = schema.properties;
  if (rawProperties !== void 0 && !isRecord(rawProperties)) {
    throw new Error("Schema properties are malformed");
  }
  const properties = rawProperties;
  const rawRequired = schema.required;
  if (rawRequired !== void 0 && (!Array.isArray(rawRequired) || !rawRequired.every((entry) => typeof entry === "string") || new Set(rawRequired).size !== rawRequired.length)) {
    throw new Error("Schema required fields are malformed");
  }
  const required = new Set(rawRequired ?? []);
  if (properties && [...required].some((key) => !(key in properties))) {
    throw new Error("Schema required field is not a property");
  }
  const members = [];
  for (const key of Object.keys(properties ?? {}).sort()) {
    countMember(state);
    const rendered = renderSchema(properties[key], state, depth + 1);
    const type = depth === 0 && state.numericStringFields.has(key) && rendered === "number" ? "number | string" : rendered;
    members.push(`${propertyKey(key)}${required.has(key) ? "" : "?"}: ${type}`);
  }
  if (Object.hasOwn(schema, "additionalProperties")) {
    const additional = schema.additionalProperties;
    if (additional === false) {
      if (members.length === 0) return "Record<string, never>";
    } else if (additional === true) {
      members.push("[key: string]: unknown");
    } else if (isRecord(additional)) {
      members.push(`[key: string]: ${renderSchema(additional, state, depth + 1)}`);
    } else {
      throw new Error("Schema additionalProperties is malformed");
    }
  } else {
    members.push("[key: string]: unknown");
  }
  return `{ ${members.join("; ")} }`;
};
var renderArray = (schema, state, depth) => {
  const items = schema.items;
  if (Array.isArray(items)) {
    if (items.length > MAX_UNION_MEMBERS) throw new Error("Schema tuple budget exceeded");
    return `[${items.map((entry) => {
      countMember(state);
      return renderSchema(entry, state, depth + 1);
    }).join(", ")}]`;
  }
  if (items === void 0 || items === true) return "Array<unknown>";
  return `Array<${renderSchema(items, state, depth + 1)}>`;
};
var isObjectArgumentSchema = (value, active = /* @__PURE__ */ new Set()) => {
  if (!isRecord(value)) return false;
  if (active.has(value)) return false;
  active.add(value);
  try {
    const types = schemaTypes(value);
    if (types.length > 0) return types.length === 1 && types[0] === "object";
    const alternates = Array.isArray(value.anyOf) ? value.anyOf : Array.isArray(value.oneOf) ? value.oneOf : void 0;
    if (alternates) return alternates.length > 0 && alternates.every((entry) => isObjectArgumentSchema(entry, active));
    if (Array.isArray(value.allOf)) {
      return value.allOf.length > 0 && value.allOf.every((entry) => isObjectArgumentSchema(entry, active));
    }
    return isRecord(value.properties) || Object.hasOwn(value, "additionalProperties");
  } finally {
    active.delete(value);
  }
};
var renderArgumentType = (schema, numericStringFields) => {
  let serialized;
  try {
    serialized = JSON.stringify(schema);
  } catch {
    throw new Error("Schema cannot be serialized");
  }
  if (!serialized || serialized.length > MAX_SCHEMA_SOURCE_CHARS) {
    throw new Error("Schema source budget exceeded");
  }
  const state = {
    members: 0,
    active: /* @__PURE__ */ new Set(),
    numericStringFields
  };
  if (!isObjectArgumentSchema(schema)) {
    throw new Error("Core override arguments must be an object schema");
  }
  const type = renderSchema(schema, state, 0);
  if (type.length > MAX_SCHEMA_OUTPUT_CHARS) throw new Error("Schema output budget exceeded");
  const required = isRecord(schema) && Array.isArray(schema.required) && schema.required.length > 0;
  return { type, required };
};
var resolveValidCoreOverrideSource = (source) => {
  if (!PI_CORE_TOOL_NAMES.includes(source.name)) return void 0;
  return { name: source.name, inputSchema: source.inputSchema };
};
var buildCoreOverrideGuestDeclarations = (sources) => {
  const byName = /* @__PURE__ */ new Map();
  for (const source of sources) {
    const resolved = resolveValidCoreOverrideSource(source);
    if (resolved && !byName.has(resolved.name)) byName.set(resolved.name, source);
  }
  if (byName.size === 0) return void 0;
  const methods = [];
  let outputChars = 0;
  for (const name of PI_CORE_TOOL_NAMES) {
    const source = byName.get(name);
    if (!source) continue;
    let argumentType = LOOSE_ARGUMENT_TYPE;
    let required = false;
    try {
      const rendered = renderArgumentType(
        source.inputSchema,
        new Set(PI_CORE_NUMERIC_FIELDS[name])
      );
      argumentType = rendered.type;
      required = rendered.required;
    } catch {
    }
    let compatibility = `Partial<${argumentType}> & (${compatibilityArgumentTypeFor(name)})`;
    let method = `  ${name}(args${required ? "" : "?"}: ${argumentType} | (${compatibility})): ${returnTypeFor(name)};`;
    outputChars += method.length;
    if (outputChars > MAX_DECLARATION_OUTPUT_CHARS) {
      argumentType = LOOSE_ARGUMENT_TYPE;
      required = false;
      compatibility = `Partial<${argumentType}> & (${compatibilityArgumentTypeFor(name)})`;
      method = `  ${name}(args?: ${argumentType} | (${compatibility})): ${returnTypeFor(name)};`;
    }
    methods.push(method);
  }
  if (methods.length === 0) return void 0;
  return [
    "// Generated from the current captured exact-name core overrides for this execution.",
    "type FabricPiCoreOverrideApi = PiToolsApi & {",
    ...methods,
    "};",
    "declare const pi: FabricPiCoreOverrideApi;",
    ""
  ].join("\n");
};
export {
  buildCoreOverrideGuestDeclarations
};
