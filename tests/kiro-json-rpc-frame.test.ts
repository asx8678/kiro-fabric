import { describe, expect, it } from "vitest";
import { parseJsonRpcFrame } from "../src/kiro/json-rpc-frame.js";

describe("parseJsonRpcFrame", () => {
  it.each([
    ["not json", "malformed JSON frame"],
    ["null", "invalid JSON-RPC frame"],
    ["[]", "invalid JSON-RPC frame"],
    [JSON.stringify({ id: 1, result: {} }), "invalid JSON-RPC frame"],
    [JSON.stringify({ jsonrpc: "1.0", id: 1, result: {} }), "invalid JSON-RPC frame"],
    [JSON.stringify({ jsonrpc: "2.0", id: "response", result: {} }), "ACP response id must be a safe integer"],
    [JSON.stringify({ jsonrpc: "2.0", id: 1, result: {}, error: {} }), "ACP response cannot include both result and error"],
    [JSON.stringify({ jsonrpc: "2.0", id: 1 }), "ACP response must include exactly one"],
    [JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1 } }), "ACP response error must contain"],
    [JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: "-1", message: "bad" } }), "ACP response error must contain"],
    [JSON.stringify({ jsonrpc: "2.0", id: "", method: "x" }), "ACP request id must be a safe integer or bounded string"],
  ])("rejects invalid frame %s", (line, message) => {
    expect(parseJsonRpcFrame(line)).toMatchObject({ ok: false, message: expect.stringContaining(message) });
  });

  it.each([
    [{ jsonrpc: "2.0", id: 1, method: "x", params: {} }, "request"],
    [{ jsonrpc: "2.0", method: "x", params: {} }, "notification"],
    [{ jsonrpc: "2.0", id: 1, result: {} }, "response"],
    [{ jsonrpc: "2.0", id: 1, error: { code: -1, message: "failed" } }, "response"],
  ] as const)("classifies valid frames", (frame, kind) => {
    expect(parseJsonRpcFrame(JSON.stringify(frame))).toEqual({ ok: true, kind, frame });
  });
});
