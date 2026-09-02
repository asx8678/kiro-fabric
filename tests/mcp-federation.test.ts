import type { Runtime, ServerDefinition } from "mcporter";
import { describe, expect, it, vi } from "vitest";
import type { FabricMcpConfig } from "../src/config.js";
import { KiroMcpProvider } from "../src/kiro/mcp-provider.js";
import type { FabricInvocationContext } from "../src/protocol.js";

const config: FabricMcpConfig = {
  enabled: true,
  disableOAuth: true,
  callTimeoutMs: 1_000,
};

const definition = (name: string, kind: "http" | "stdio"): ServerDefinition => ({
  name,
  command: kind === "http"
    ? { kind: "http", url: new URL("https://example.test/mcp") }
    : { kind: "stdio", command: "configured-server", args: [], cwd: "/workspace" },
});

const context = (
  signal?: AbortSignal,
  approve?: FabricInvocationContext["approve"],
): FabricInvocationContext => ({
  cwd: "/workspace",
  ...(signal ? { signal } : {}),
  ...(approve ? { approve } : {}),
});

const fakeRuntime = (options: {
  kind?: "http" | "stdio";
  listTools?: Runtime["listTools"];
  callTool?: Runtime["callTool"];
  close?: Runtime["close"];
} = {}): Runtime => {
  const server = definition("configured", options.kind ?? "http");
  return {
    listServers: () => [server.name],
    getDefinitions: () => [server],
    getDefinition: () => server,
    registerDefinition() {},
    listTools: options.listTools ?? (async () => [{
      name: "echo",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
    }]),
    callTool: options.callTool ?? (async () => ({ content: [{ type: "text", text: "ok" }] })),
    async listResources() { return []; },
    async readResource() { return null; },
    async connect() { throw new Error("not used"); },
    close: options.close ?? (async () => {}),
  };
};

describe("configured Power MCP federation", () => {
  it("keeps discovery static and contacts only an exact configured server", async () => {
    let creations = 0;
    const runtime = fakeRuntime();
    const provider = new KiroMcpProvider("/workspace", config, async () => {
      creations += 1;
      return runtime;
    });
    expect((await provider.list()).map((entry) => entry.name)).toEqual(["$servers", "$call"]);
    expect(creations).toBe(0);

    await expect(provider.invoke("$call", {
      server: "configured",
      tool: "echo",
      args: { value: "hello" },
    }, context())).resolves.toMatchObject({ text: "ok" });
    expect(creations).toBe(1);
    await expect(provider.invoke("$call", {
      server: "missing",
      tool: "echo",
      args: { value: "hello" },
    }, context())).rejects.toThrow("Unknown configured MCP server");
    await provider.close();
  });

  it("cancels callers waiting for runtime creation and still closes the resolved runtime", async () => {
    let resolveRuntime!: (runtime: Runtime) => void;
    let closed = false;
    const pending = new Promise<Runtime>((resolve) => { resolveRuntime = resolve; });
    const provider = new KiroMcpProvider("/workspace", config, async () => pending);
    const controller = new AbortController();
    const listing = provider.invoke("$servers", {}, context(controller.signal));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new Error("cancelled during creation"));
    await expect(listing).rejects.toThrow("cancelled during creation");
    resolveRuntime(fakeRuntime({ close: async () => { closed = true; } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await provider.close();
    expect(closed).toBe(true);
  });

  it("requires a separate execute approval before starting stdio", async () => {
    let calls = 0;
    const provider = new KiroMcpProvider(
      "/workspace",
      config,
      async () => fakeRuntime({ kind: "stdio", callTool: async () => { calls += 1; return true; } }),
    );
    await expect(provider.invoke("$call", {
      server: "configured",
      tool: "echo",
      args: { value: "hello" },
    }, context())).rejects.toThrow("execution approval is unavailable");
    expect(calls).toBe(0);

    let approvedRef = "";
    await expect(provider.invoke("$call", {
      server: "configured",
      tool: "echo",
      args: { value: "hello" },
    }, context(undefined, async (action) => { approvedRef = action.ref; }))).resolves.toBe(true);
    expect(approvedRef).toBe("mcp.$stdio");
    await provider.close();
  });

  it("shares one timeout budget across discovery and invocation", async () => {
    let now = 10_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    let called = false;
    const provider = new KiroMcpProvider(
      "/workspace",
      config,
      async () => fakeRuntime({
        async listTools() {
          now += config.callTimeoutMs + 1;
          return [{ name: "echo", inputSchema: { type: "object" } }];
        },
        async callTool() { called = true; return true; },
      }),
    );
    try {
      await expect(provider.invoke("$call", {
        server: "configured",
        tool: "echo",
        args: {},
      }, context())).rejects.toThrow("timed out after 1000ms");
      expect(called).toBe(false);
    } finally {
      clock.mockRestore();
      await provider.close();
    }
  });

  it("requires execute approval when HTTP OAuth is enabled", async () => {
    let calls = 0;
    const provider = new KiroMcpProvider(
      "/workspace",
      { ...config, disableOAuth: false },
      async () => fakeRuntime({ callTool: async () => { calls += 1; return true; } }),
    );
    await expect(provider.invoke("$call", {
      server: "configured",
      tool: "echo",
      args: { value: "hello" },
    }, context())).rejects.toThrow("mcp.$oauth execution approval is unavailable");
    expect(calls).toBe(0);
    await provider.close();
  });

  it("closes the contacted server before reporting cancellation", async () => {
    let closeServer: string | undefined;
    const controller = new AbortController();
    const provider = new KiroMcpProvider(
      "/workspace",
      config,
      async () => fakeRuntime({
        callTool: async () => new Promise<never>(() => {}),
        close: async (server) => { closeServer = server; },
      }),
    );
    const call = provider.invoke("$call", {
      server: "configured",
      tool: "echo",
      args: { value: "hello" },
    }, context(controller.signal));
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort(new Error("cancelled by test"));
    await expect(call).rejects.toThrow("cancelled by test");
    expect(closeServer).toBe("configured");
    await provider.close();
  });
});
