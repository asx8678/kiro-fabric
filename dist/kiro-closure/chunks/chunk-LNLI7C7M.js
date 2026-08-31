import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);


// src/kiro/v3-session.ts
var KIRO_V3_AGENT_MODE = "kiro-fabric";
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var buildKiroV3SessionParams = (profile, cwd) => {
  if (profile.name !== KIRO_V3_AGENT_MODE) {
    throw new Error(`Kiro v3 profile must be named ${KIRO_V3_AGENT_MODE}`);
  }
  if (!profile.prompt.trim()) throw new Error("Kiro v3 custom agent prompt is empty");
  const servers = Object.entries(profile.mcpServers).sort(([left], [right]) => left.localeCompare(right)).map(([name, server]) => ({
    name,
    command: server.command,
    args: [...server.args],
    env: Object.entries(server.env).sort(([left], [right]) => left.localeCompare(right)).map(([envName, value]) => ({ name: envName, value })),
    ...server.requestTimeout !== void 0 ? { requestTimeout: server.requestTimeout } : {}
  }));
  if (servers.length !== 1 || servers[0]?.name !== "fabric") {
    throw new Error("Kiro v3 session must inject exactly the Fabric MCP server");
  }
  const customAgent = {
    id: KIRO_V3_AGENT_MODE,
    description: profile.description,
    prompt: profile.prompt,
    tools: [...profile.tools],
    allowedTools: [...profile.allowedTools],
    includeMcpJson: profile.includeMcpJson,
    includePowers: profile.includePowers,
    resources: [...profile.resources],
    permissions: structuredClone(profile.permissions)
  };
  return {
    cwd,
    mcpServers: servers,
    _meta: { kiro: { customAgents: [customAgent] } }
  };
};
var assertKiroV3AgentModeAvailable = (sessionResult) => {
  const result = isRecord(sessionResult) ? sessionResult : void 0;
  const modes = result && isRecord(result.modes) ? result.modes : void 0;
  const available = modes?.availableModes;
  if (!Array.isArray(available)) {
    throw new Error("Kiro v3 session did not advertise available agent modes");
  }
  const ids = available.flatMap(
    (entry) => isRecord(entry) && typeof entry.id === "string" ? [entry.id] : []
  );
  if (!ids.includes(KIRO_V3_AGENT_MODE)) {
    throw new Error(
      `Kiro v3 did not register the injected ${KIRO_V3_AGENT_MODE} agent; refusing its broader default mode`
    );
  }
};

// src/kiro/json-rpc-frame.ts
import { Buffer } from "node:buffer";
var isJsonRpcObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var formatJsonRpcError = (method, value) => {
  const error = isJsonRpcObject(value) ? value : {};
  const code = typeof error.code === "number" && Number.isSafeInteger(error.code) ? ` code ${error.code}` : "";
  const rawMessage = typeof error.message === "string" ? error.message : "";
  const message = rawMessage.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 512);
  let encoded = "unserializable";
  try {
    encoded = JSON.stringify(value) ?? "null";
  } catch {
  }
  const suffix = rawMessage.length > 512 ? "\u2026" : "";
  return `${method} JSON-RPC error${code}${message ? `: ${message}${suffix}` : ""} (${Buffer.byteLength(encoded, "utf8")} bytes; structured details redacted)`;
};
var isSafeJsonRpcId = (value) => {
  if (typeof value === "string") return value.length > 0 && value.length <= 128;
  return typeof value === "number" && Number.isSafeInteger(value);
};
var parseJsonRpcFrame = (line) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return {
      ok: false,
      message: `malformed JSON frame (${Buffer.byteLength(line, "utf8")} bytes; content redacted)`
    };
  }
  if (!isJsonRpcObject(frame) || frame.jsonrpc !== "2.0") {
    return {
      ok: false,
      message: `invalid JSON-RPC frame (${Buffer.byteLength(line, "utf8")} bytes; content redacted)`
    };
  }
  if (typeof frame.method === "string") {
    if (frame.id !== void 0 && frame.id !== null && !isSafeJsonRpcId(frame.id)) {
      return { ok: false, message: "ACP request id must be a safe integer or bounded string" };
    }
    return {
      ok: true,
      kind: frame.id === void 0 || frame.id === null ? "notification" : "request",
      frame
    };
  }
  if (typeof frame.id !== "number" || !Number.isSafeInteger(frame.id)) {
    return { ok: false, message: "ACP response id must be a safe integer" };
  }
  const hasResult = Object.prototype.hasOwnProperty.call(frame, "result");
  const hasError = Object.prototype.hasOwnProperty.call(frame, "error");
  if (hasResult === hasError) {
    return {
      ok: false,
      message: hasResult ? "ACP response cannot include both result and error" : "ACP response must include exactly one of result or error"
    };
  }
  if (hasError && (!isJsonRpcObject(frame.error) || !Number.isSafeInteger(frame.error.code) || typeof frame.error.message !== "string")) {
    return { ok: false, message: "ACP response error must contain an integer code and string message" };
  }
  return { ok: true, kind: "response", frame };
};

export {
  formatJsonRpcError,
  parseJsonRpcFrame,
  KIRO_V3_AGENT_MODE,
  buildKiroV3SessionParams,
  assertKiroV3AgentModeAvailable
};
