import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  sanitizeMcpRefPart
} from "./chunk-NVONZONP.js";
import "./chunk-GX475RD4.js";

// src/runtime/dynamic-guest-types.ts
var MAX_DEPTH = 6;
var MAX_UNION_MEMBERS = 12;
var MAX_SCHEMA_SOURCE_CHARS = 4096;
var MAX_MEMBER_TYPE_CHARS = 2500;
var MAX_SECTION_CHARS = 6e4;
var MAX_MCP_SERVERS = 64;
var MAX_TOOLS_PER_SERVER = 128;
var MAX_EXTENSION_TOOLS = 256;
var IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var propertyKey = (name) => IDENTIFIER.test(name) ? name : JSON.stringify(name);
var literalType = (value) => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "unknown";
};
var unionType = (parts) => {
  const unique = [...new Set(parts)];
  if (unique.length === 0) return "unknown";
  return unique.length === 1 ? unique[0] : unique.join(" | ");
};
var typeList = (value) => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string");
  }
  return [];
};
var objectType = (schema, depth) => {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((entry) => typeof entry === "string") : []
  );
  const members = [];
  for (const key of Object.keys(properties).sort()) {
    members.push(
      `${propertyKey(key)}${required.has(key) ? "" : "?"}: ${schemaType(properties[key], depth + 1)}`
    );
  }
  const additional = schema.additionalProperties;
  if (additional !== false) {
    members.push(
      isRecord(additional) ? `[key: string]: ${schemaType(additional, depth + 1)}` : "[key: string]: unknown"
    );
  }
  return `{ ${members.join("; ")} }`;
};
var schemaType = (schema, depth) => {
  if (depth > MAX_DEPTH) return "unknown";
  if (schema === true || schema === void 0) return "unknown";
  if (schema === false) return "never";
  if (!isRecord(schema)) return "unknown";
  if ("const" in schema) return literalType(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return unionType(schema.enum.slice(0, MAX_UNION_MEMBERS).map(literalType));
  }
  const alternates = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : void 0;
  if (alternates) {
    if (alternates.length === 0) return "unknown";
    return unionType(
      alternates.slice(0, MAX_UNION_MEMBERS).map((entry) => schemaType(entry, depth + 1))
    );
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.slice(0, MAX_UNION_MEMBERS).map((entry) => {
      const rendered = schemaType(entry, depth + 1);
      return rendered.includes(" | ") ? `(${rendered})` : rendered;
    }).join(" & ");
  }
  const types = typeList(schema.type);
  if (types.length > 1) {
    return unionType(types.map((type2) => schemaType({ ...schema, type: type2 }, depth + 1)));
  }
  const type = types[0];
  if (type === "object" || !type && isRecord(schema.properties)) {
    return objectType(schema, depth);
  }
  if (type === "string") return "string";
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  if (type === "null") return "null";
  if (type === "array") {
    const items = schema.items;
    if (Array.isArray(items)) {
      return `[${items.slice(0, MAX_UNION_MEMBERS).map((entry) => schemaType(entry, depth + 1)).join(", ")}]`;
    }
    return isRecord(items) || items === true ? `Array<${schemaType(items, depth + 1)}>` : "unknown[]";
  }
  return "unknown";
};
var spend = (budget, text) => {
  if (budget.chars < text.length) return false;
  budget.chars -= text.length;
  return true;
};
var hasRequiredArgs = (source) => Array.isArray(source.inputSchema.required) && source.inputSchema.required.length > 0 && isRecord(source.inputSchema.properties);
var renderMember = (name, source, resultType) => {
  const loose = `${propertyKey(name)}(args?: Record<string, unknown>): ${resultType};`;
  const schemaJson = JSON.stringify(source.inputSchema);
  if (!schemaJson || schemaJson.length > MAX_SCHEMA_SOURCE_CHARS) return loose;
  const rendered = schemaType(source.inputSchema, 0);
  if (rendered.length > MAX_MEMBER_TYPE_CHARS) return loose;
  return `${propertyKey(name)}(args${hasRequiredArgs(source) ? "" : "?"}: ${rendered}): ${resultType};`;
};
var renderMemberBlock = (sources, resultType, limit, budget) => {
  const bySanitized = /* @__PURE__ */ new Map();
  for (const source of sources.slice(0, limit)) {
    const key = sanitizeMcpRefPart(source.name);
    const group = bySanitized.get(key);
    if (group) group.push(source);
    else bySanitized.set(key, [source]);
  }
  const lines = [];
  let dropped = Math.max(0, sources.length - limit);
  const sortedGroups = [...bySanitized.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [sanitized, group] of sortedGroups) {
    if (group.length > 1) {
      dropped += group.length;
      continue;
    }
    const source = group[0];
    const text = source.name === sanitized ? `  ${renderMember(sanitized, source, resultType)}` : `  ${renderMember(sanitized, source, resultType)}
  ${renderMember(source.name, source, resultType)}`;
    if (!spend(budget, text)) {
      dropped += 1;
      continue;
    }
    lines.push(text);
  }
  return { lines, dropped };
};
var renderMcpDeclaration = (sources) => {
  const bySanitized = /* @__PURE__ */ new Map();
  const rawNames = /* @__PURE__ */ new Set();
  for (const source of sources.slice(0, MAX_MCP_SERVERS)) {
    if (rawNames.has(source.server)) continue;
    rawNames.add(source.server);
    const key = sanitizeMcpRefPart(source.server);
    const group = bySanitized.get(key);
    if (group) group.push(source);
    else bySanitized.set(key, [source]);
  }
  const budget = { chars: MAX_SECTION_CHARS };
  const interfaces = [];
  const mapEntries = [];
  let droppedServers = Math.max(0, sources.length - rawNames.size);
  let droppedTools = 0;
  const sortedGroups = [...bySanitized.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [sanitized, group] of sortedGroups) {
    if (group.length > 1) {
      droppedServers += group.length;
      droppedTools += group.reduce((total, entry) => total + entry.tools.length, 0);
      continue;
    }
    const source = group[0];
    const interfaceName = `FabricMcpServer_${sanitized}`;
    const memberBlock = renderMemberBlock(
      source.tools,
      "Promise<FabricMcpResult | unknown>",
      MAX_TOOLS_PER_SERVER,
      budget
    );
    droppedTools += memberBlock.dropped;
    const header = `interface ${interfaceName} {
${memberBlock.lines.join("\n")}
}`;
    if (!spend(budget, header)) {
      droppedServers += 1;
      droppedTools += source.tools.length;
      break;
    }
    interfaces.push(header);
    mapEntries.push(`  ${sanitized}: ${interfaceName};`);
    if (source.server !== sanitized) {
      mapEntries.push(`  ${propertyKey(source.server)}: ${interfaceName};`);
    }
  }
  const notes = [];
  if (droppedServers > 0) notes.push(`${droppedServers} server(s) untyped`);
  if (droppedTools > 0) notes.push(`${droppedTools} tool(s) untyped`);
  const note = notes.length > 0 ? `// Omitted from this surface (${notes.join(", ")}); those calls compile
// as the loose fallback would and still validate at dispatch.
` : "";
  return "// Generated from the live MCP descriptor cache for this execution. Known\n// servers and tools carry their schemas so argument-shape mistakes fail\n// type-check before the sandbox runs, like pi.* calls do; anything absent\n// (cold cache, ambiguous sanitized names) compiles as it would with the\n// loose declarations and is validated by the registry at dispatch.\n" + note + interfaces.join("\n") + (interfaces.length > 0 ? "\n" : "") + `declare const mcp: {
${mapEntries.join("\n")}
} & FabricMcpManagement;
`;
};
var renderExtensionsDeclaration = (sources) => {
  const budget = { chars: MAX_SECTION_CHARS };
  const memberBlock = renderMemberBlock(
    sources,
    "Promise<FabricCapturedToolResult>",
    MAX_EXTENSION_TOOLS,
    budget
  );
  const note = memberBlock.dropped > 0 ? `// Omitted ${memberBlock.dropped} tool(s) from this surface; those calls
// compile as the loose fallback would and still validate at dispatch.
` : "";
  return "// Generated from the captured extension tool catalog for this execution,\n// with the same advisory semantics as the generated mcp surface above.\n" + note + `interface FabricExtensionsApiDynamic {
${memberBlock.lines.join("\n")}
}
declare const extensions: FabricExtensionsApiDynamic;
`;
};
var buildDynamicGuestDeclarations = (sources) => {
  const dynamic = {};
  if (sources.mcpServers && sources.mcpServers.length > 0) {
    dynamic.mcp = renderMcpDeclaration(sources.mcpServers);
  }
  if (sources.extensionTools && sources.extensionTools.length > 0) {
    dynamic.extensions = renderExtensionsDeclaration(sources.extensionTools);
  }
  return dynamic;
};
export {
  buildDynamicGuestDeclarations
};
