import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  handlers: [] as Array<(request: unknown, extra: { signal: AbortSignal }) => Promise<unknown>>,
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: class {
    setRequestHandler(_schema: unknown, handler: (request: unknown, extra: { signal: AbortSignal }) => Promise<unknown>) {
      harness.handlers.push(handler);
    }
    setNotificationHandler() {}
    getClientCapabilities() { return {}; }
    async connect() {}
    async close() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));

import { createKiroMcpServer } from "../src/kiro/mcp-server.js";
import type { KiroRuntime } from "../src/kiro/runtime.js";

const roots: string[] = [];
afterEach(() => {
  harness.handlers.length = 0;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const temp = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-mcp-power-test-"));
  roots.push(root);
  return root;
};

describe("Kiro Power MCP reporting", () => {
  it("projects fabric_info runtime failures as bounded public tool errors", async () => {
    const root = temp();
    const pluginRoot = path.join(root, "plugin");
    const pluginData = path.join(root, "data");
    fs.mkdirSync(pluginRoot);
    fs.mkdirSync(pluginData);
    fs.writeFileSync(path.join(pluginRoot, "package.json"), JSON.stringify({ version: "1.0.0" }));
    const runtime = {
      service: { config: { executor: { runtime: "quickjs" } } },
      registry: { providers: () => { throw new Error("registry failed\nwith control text"); } },
      close: vi.fn(async () => {}),
    } as unknown as KiroRuntime;
    const server = await createKiroMcpServer({
      integration: "power",
      pluginRoot,
      pluginData,
      runtime,
      workspaceContext: {
        current: async () => ({ revision: 1, status: "explicitly-empty", roots: [], observedAt: 1 }),
        invalidate() {},
        subscribe: () => ({ dispose() {} }),
      },
    });
    try {
      const callHandler = harness.handlers.at(-1)!;
      const result = await callHandler({ params: { name: "fabric_info", arguments: {} } }, {
        signal: new AbortController().signal,
      }) as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]!.text)).toEqual({
        error: { code: "info_request_failed", message: "registry failed with control text" },
      });
    } finally {
      await server.close();
    }
  });
});
