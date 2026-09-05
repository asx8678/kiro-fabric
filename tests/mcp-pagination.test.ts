import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import type { Runtime, ServerDefinition } from "mcporter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KiroMcpProvider } from "../src/kiro/mcp-provider.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); vi.restoreAllMocks(); });
const tool = (name: string) => ({ name, inputSchema: { type: "object" as const, properties: {} } });
const fixture = async (page: (cursor: string | undefined) => ListToolsResult | Promise<ListToolsResult>, allowedTools?: string[]) => {
  const server = new Server({ name: "pagination-fixture", version: "1" }, { capabilities: { tools: {} } });
  const client = new Client({ name: "pagination-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const cursors: Array<string | undefined> = [];
  server.setRequestHandler(ListToolsRequestSchema, async (request) => { cursors.push(request.params?.cursor); return page(request.params?.cursor); });
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({ content: [{ type: "text", text: request.params.name }] }));
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const definition: ServerDefinition = { name: "fixture", command: { kind: "http", url: new URL("https://example.test/never-contacted") }, ...(allowedTools ? { allowedTools } : {}) };
  // mcporter transport acquisition is substituted, but requests, schema parsing,
  // cursor envelopes and tool invocation pass through the actual MCP SDK pair.
  const runtime = {
    listServers: () => ["fixture"], getDefinition: () => definition,
    async connect() { return { client, transport: clientTransport, definition }; },
    async callTool(_server: string, name: string, options: { args: Record<string, unknown> }) { return client.callTool({ name, arguments: options.args }); },
    async close() { await Promise.all([client.close(), server.close()]); },
  } as unknown as Runtime;
  const provider = new KiroMcpProvider("/workspace", { enabled: true, disableOAuth: true, callTimeoutMs: 5_000 }, async () => runtime);
  closers.push(() => provider.close());
  return { provider, client, cursors, invoke: (action: string, args: Record<string, unknown> = {}) => provider.invoke(action, { server: "fixture", ...args }, { cwd: "/workspace" }) };
};

describe("MCP cursor envelopes through the SDK boundary", () => {
  it("discovers, describes and calls second-page tools, preserving an empty opaque cursor", async () => {
    const { invoke, cursors, client } = await fixture((cursor) => cursor === undefined
      ? { tools: [tool("first")], nextCursor: "" }
      : { tools: [tool("second")] });
    const list = vi.spyOn(client, "listTools");
    await expect(invoke("$tools")).resolves.toMatchObject([{ name: "first" }, { name: "second" }]);
    await expect(invoke("$describe", { tool: "second" })).resolves.toMatchObject({ name: "second" });
    await expect(invoke("$call", { tool: "second", args: {} })).resolves.toMatchObject({ text: "second" });
    expect(cursors).toEqual([undefined, "", undefined, "", undefined, ""]);
    for (let index = 0; index < list.mock.calls.length; index += 2) {
      expect(list.mock.calls[index + 1]![1]!.timeout).toBeLessThanOrEqual(list.mock.calls[index]![1]!.timeout!);
      expect(list.mock.calls[index + 1]![1]!.signal).toBeDefined();
    }
  });

  it("continues through a filtered-out first page", async () => {
    const { invoke } = await fixture((cursor) => cursor === undefined
      ? { tools: [tool("first")], nextCursor: "next" } : { tools: [tool("second")] }, ["second"]);
    await expect(invoke("$tools")).resolves.toMatchObject([{ name: "second" }]);
  });

  it("rejects a cursor cycle instead of publishing an incomplete catalog", async () => {
    const { invoke, cursors } = await fixture(() => ({ tools: [], nextCursor: "same" }));
    await expect(invoke("$tools")).rejects.toThrow("cursor cycle");
    expect(cursors).toHaveLength(2);
  });

  it("bounds empty-page enumeration", async () => {
    const { invoke, cursors } = await fixture((cursor) => ({ tools: [], nextCursor: String(Number(cursor ?? 0) + 1) }));
    await expect(invoke("$tools")).rejects.toThrow("page limit");
    expect(cursors).toHaveLength(100);
  });

  it("bounds the aggregate tool count before filtering", async () => {
    const { invoke } = await fixture((cursor) => cursor === undefined
      ? { tools: Array.from({ length: 500 }, (_, i) => tool(`first${i}`)), nextCursor: "next" }
      : { tools: Array.from({ length: 501 }, (_, i) => tool(`second${i}`)) }, ["first0"]);
    await expect(invoke("$tools")).rejects.toThrow("product bounds");
  });

  it("rejects duplicate names across pages", async () => {
    const { invoke } = await fixture((cursor) => ({ tools: [tool("duplicate")], ...(cursor === undefined ? { nextCursor: "next" } : {}) }));
    await expect(invoke("$tools")).rejects.toThrow("duplicate name");
  });

  it("uses one monotonic budget across pages rather than resetting it", async () => {
    const now = performance.now.bind(performance); let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now() + elapsed);
    const { invoke, cursors } = await fixture((cursor) => {
      elapsed += cursor === undefined ? 4_000 : 1_500;
      return { tools: [], ...(cursor === undefined ? { nextCursor: "next" } : {}) };
    });
    await expect(invoke("$tools")).rejects.toThrow("timed out");
    expect(cursors).toEqual([undefined, "next"]);
  });

  it("bounds cursor size", async () => {
    const { invoke } = await fixture(() => ({ tools: [], nextCursor: "c".repeat(4_097) }));
    await expect(invoke("$tools")).rejects.toThrow("cursor is malformed or exceeds");
  });

  it("bounds cumulative schema JSON across pages", async () => {
    const { invoke } = await fixture((cursor) => ({ tools: [{ ...tool(cursor === undefined ? "first" : "second"), description: "x".repeat(1_100_000) }], ...(cursor === undefined ? { nextCursor: "next" } : {}) }));
    await expect(invoke("$tools")).rejects.toThrow("bounded JSON contract");
  });

  it("does not request another page after cancellation", async () => {
    const controller = new AbortController();
    const { provider, cursors } = await fixture(() => { controller.abort(new Error("cancelled pagination fixture")); return { tools: [], nextCursor: "next" }; });
    await expect(provider.invoke("$tools", { server: "fixture" }, { cwd: "/workspace", signal: controller.signal })).rejects.toThrow("cancelled pagination fixture");
    expect(cursors).toHaveLength(1);
  });
});
