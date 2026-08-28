import { Buffer } from "node:buffer";

export type ParsedJsonRpcFrame =
  | { ok: true; kind: "request" | "notification" | "response"; frame: Record<string, unknown> }
  | { ok: false; message: string };

const isJsonRpcObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const formatJsonRpcError = (method: string, value: unknown): string => {
  const error = isJsonRpcObject(value) ? value : {};
  const code = typeof error.code === "number" && Number.isSafeInteger(error.code)
    ? ` code ${error.code}`
    : "";
  const rawMessage = typeof error.message === "string" ? error.message : "";
  const message = rawMessage.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 512);
  let encoded = "unserializable";
  try {
    encoded = JSON.stringify(value) ?? "null";
  } catch {
    // Keep the bounded structural marker.
  }
  const suffix = rawMessage.length > 512 ? "…" : "";
  return `${method} JSON-RPC error${code}${message ? `: ${message}${suffix}` : ""} (${Buffer.byteLength(encoded, "utf8")} bytes; structured details redacted)`;
};

const isSafeJsonRpcId = (value: unknown): value is number | string => {
  if (typeof value === "string") return value.length > 0 && value.length <= 128;
  return typeof value === "number" && Number.isSafeInteger(value);
};

export const parseJsonRpcFrame = (line: string): ParsedJsonRpcFrame => {
  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch {
    return {
      ok: false,
      message: `malformed JSON frame (${Buffer.byteLength(line, "utf8")} bytes; content redacted)`,
    };
  }
  if (!isJsonRpcObject(frame) || frame.jsonrpc !== "2.0") {
    return {
      ok: false,
      message: `invalid JSON-RPC frame (${Buffer.byteLength(line, "utf8")} bytes; content redacted)`,
    };
  }
  if (typeof frame.method === "string") {
    if (frame.id !== undefined && frame.id !== null && !isSafeJsonRpcId(frame.id)) {
      return { ok: false, message: "ACP request id must be a safe integer or bounded string" };
    }
    return {
      ok: true,
      kind: frame.id === undefined || frame.id === null ? "notification" : "request",
      frame,
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
      message: hasResult
        ? "ACP response cannot include both result and error"
        : "ACP response must include exactly one of result or error",
    };
  }
  if (hasError && (
    !isJsonRpcObject(frame.error) ||
    !Number.isSafeInteger(frame.error.code) ||
    typeof frame.error.message !== "string"
  )) {
    return { ok: false, message: "ACP response error must contain an integer code and string message" };
  }
  return { ok: true, kind: "response", frame };
};
