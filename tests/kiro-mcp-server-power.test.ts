import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  handlers: [] as Array<(request: unknown, extra: { signal: AbortSignal }) => Promise<unknown>>,
  notifications: [] as Array<() => Promise<void>>,
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: class {
    setRequestHandler(_schema: unknown, handler: (request: unknown, extra: { signal: AbortSignal }) => Promise<unknown>) {
      harness.handlers.push(handler);
    }
    setNotificationHandler(_schema: unknown, handler: () => Promise<void>) { harness.notifications.push(handler); }
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
  harness.notifications.length = 0;
  vi.useRealTimers();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const temp = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-mcp-power-test-"));
  roots.push(root);
  return root;
};

describe("Kiro Power MCP reporting", () => {
  it("keeps the current runtime across a transient bound-workspace observation", async () => {
    const root = temp();
    const pluginRoot = path.join(root, "plugin");
    const pluginData = path.join(root, "data");
    const workspace = path.join(root, "workspace");
    for (const directory of [pluginRoot, pluginData, workspace]) fs.mkdirSync(directory);
    fs.writeFileSync(path.join(pluginRoot, "package.json"), JSON.stringify({ version: "1.0.0" }));
    const runtime = {
      service: { config: { executor: {
        runtime: "quickjs",
        timeoutMs: 120_000,
        memoryLimitBytes: 64 * 1024 * 1024,
        maxSourceBytes: 256 * 1024,
        maxOutputChars: 50_000,
        maxNestedResultChars: 2_000_000,
      } } },
      registry: { providers: () => [] },
      close: vi.fn(async () => {}),
    } as unknown as KiroRuntime;
    const prepareRuntime = vi.fn(async () => runtime);
    const snapshot = { revision: 1, status: "verified" as const, roots: [{ uri: new URL(`file://${workspace}`).href }], observedAt: 1 };
    const server = await createKiroMcpServer({
      integration: "power",
      pluginRoot,
      pluginData,
      prepareRuntime,
      workspaceContext: {
        current: async () => snapshot,
        invalidate() {},
        subscribe: () => ({ dispose() {} }),
      },
    });
    const callHandler = harness.handlers.at(-1)!;
    const signal = new AbortController().signal;
    const info = await callHandler({ params: { name: "fabric_info", arguments: {} } }, { signal }) as {
      content: Array<{ text: string }>;
    };
    expect(JSON.parse(info.content[0]!.text).runtime.limits).toEqual({
      timeoutMs: 120_000,
      memoryLimitBytes: 64 * 1024 * 1024,
      maxSourceBytes: 256 * 1024,
      maxOutputChars: 50_000,
      maxNestedResultChars: 2_000_000,
    });
    expect(prepareRuntime).toHaveBeenCalledOnce();

    fs.renameSync(workspace, `${workspace}.away`);
    const unavailable = await callHandler({ params: { name: "fabric_info", arguments: {} } }, { signal }) as { isError?: boolean };
    expect(unavailable.isError).toBe(true);
    expect(runtime.close).not.toHaveBeenCalled();

    fs.renameSync(`${workspace}.away`, workspace);
    const recovered = await callHandler({ params: { name: "fabric_info", arguments: {} } }, { signal }) as { isError?: boolean };
    expect(recovered.isError).toBeUndefined();
    expect(prepareRuntime).toHaveBeenCalledOnce();
    await server.close();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("defers closing a retired runtime until its stale execution settles", async () => {
    vi.useFakeTimers();
    const root = temp();
    const pluginRoot = path.join(root, "plugin");
    const pluginData = path.join(root, "data");
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    for (const directory of [pluginRoot, pluginData, a, b]) fs.mkdirSync(directory);
    fs.writeFileSync(path.join(pluginRoot, "package.json"), JSON.stringify({ version: "1.0.0" }));
    let rejectExecution!: (error: Error) => void;
    const execute = vi.fn(() => new Promise((_resolve, reject) => { rejectExecution = reject; }));
    const runtime = {
      service: { config: { executor: { runtime: "quickjs", resultFormat: "text", maxOutputChars: 1_000 } }, execute },
      registry: { providers: () => [] },
      artifacts: { write: vi.fn() },
      host: {},
      close: vi.fn(async () => {}),
    } as unknown as KiroRuntime;
    let rootsSnapshot = [{ uri: new URL(`file://${a}`).href }];
    const workspaceContext = {
      current: async () => ({ revision: 1, status: "verified" as const, roots: rootsSnapshot, observedAt: 1 }),
      invalidate() {},
      subscribe: () => ({ dispose() {} }),
    };
    const server = await createKiroMcpServer({
      integration: "power", pluginRoot, pluginData, prepareRuntime: async () => runtime, workspaceContext,
    });
    const callHandler = harness.handlers.at(-1)!;
    const execution = callHandler({ params: { name: "fabric_exec", arguments: { code: "return 1" } } }, {
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    rootsSnapshot = [{ uri: new URL(`file://${b}`).href }];
    const refresh = harness.notifications[0]!();
    await vi.advanceTimersByTimeAsync(5_001);
    await refresh;
    expect(runtime.close).not.toHaveBeenCalled();

    rejectExecution(new Error("stale execution settled"));
    await execution;
    await vi.waitFor(() => expect(runtime.close).toHaveBeenCalledOnce());
    await server.close();
  });

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
