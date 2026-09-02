import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Runtime, ServerDefinition } from "mcporter";
import { describe, expect, it } from "vitest";
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
    : { kind: "stdio", command: process.execPath, args: [], cwd: process.cwd() },
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

  it("uses only the explicit imports-disabled config through the real mcporter stdio runtime", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcporter-"));
    const serverFile = path.join(temporary, "server.mjs");
    const configFile = path.join(temporary, "mcp.json");
    fs.writeFileSync(serverFile, `
import { Server } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js"))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/types.js"))};
const server = new Server({ name: "fixture", version: "1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "echo", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({ content: [{ type: "text", text: "echo:" + String(request.params.arguments?.value) }] }));
await server.connect(new StdioServerTransport());
`, { mode: 0o600 });
    fs.writeFileSync(configFile, `${JSON.stringify({
      imports: [],
      mcpServers: { configured: { command: process.execPath, args: [serverFile], cwd: temporary } },
    })}\n`, { mode: 0o600 });
    const provider = new KiroMcpProvider(temporary, { ...config, configPath: configFile, callTimeoutMs: 5_000 });
    try {
      await expect(provider.invoke("$servers", {}, context())).resolves.toEqual([{
        name: "configured", description: null, transport: "stdio",
      }]);
      const args = { server: "configured", tool: "echo", args: { value: "real" } };
      const prepared = await provider.prepareArguments("$call", args, context());
      const approvals: string[] = [];
      await expect(provider.invoke("$call", prepared, context(undefined, async (action) => { approvals.push(action.ref); })))
        .resolves.toMatchObject({ text: "echo:real" });
      expect(approvals).toEqual(["mcp.$stdio"]);
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  it("rejects config that could enable ambient mcporter imports", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcporter-config-"));
    const configFile = path.join(temporary, "mcp.json");
    fs.writeFileSync(configFile, `${JSON.stringify({ mcpServers: {} })}\n`, { mode: 0o600 });
    const provider = new KiroMcpProvider(temporary, { ...config, configPath: configFile });
    try {
      await expect(provider.invoke("$servers", {}, context())).rejects.toThrow("imports: []");
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("fails closed when explicit config changes after runtime loading", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcporter-drift-"));
    const configFile = path.join(temporary, "mcp.json");
    fs.writeFileSync(configFile, `${JSON.stringify({ imports: [], mcpServers: {} })}\n`, { mode: 0o600 });
    const provider = new KiroMcpProvider(temporary, { ...config, configPath: configFile });
    try {
      await expect(provider.invoke("$servers", {}, context())).resolves.toEqual([]);
      fs.writeFileSync(configFile, `${JSON.stringify({ imports: [], mcpServers: { changed: { url: "https://example.test/mcp" } } })}\n`, { mode: 0o600 });
      await expect(provider.invoke("$servers", {}, context())).rejects.toThrow("changed after runtime loading");
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("rejects ambient mcporter behavior switches", async () => {
    const previous = process.env.MCPORTER_REPLAY;
    process.env.MCPORTER_REPLAY = "/tmp/untrusted-replay.jsonl";
    const provider = new KiroMcpProvider("/workspace", config);
    try {
      await expect(provider.invoke("$servers", {}, context())).rejects.toThrow("MCPORTER_REPLAY");
    } finally {
      if (previous === undefined) delete process.env.MCPORTER_REPLAY;
      else process.env.MCPORTER_REPLAY = previous;
      await provider.close();
    }
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
    let approvedDetails: Record<string, unknown> | undefined;
    await expect(provider.invoke("$call", {
      server: "configured",
      tool: "echo",
      args: { value: "hello" },
    }, context(undefined, async (action, details) => { approvedRef = action.ref; approvedDetails = details; }))).resolves.toBe(true);
    expect(approvedRef).toBe("mcp.$stdio");
    expect(approvedDetails).toMatchObject({
      schemaVersion: 1,
      server: "configured",
      kind: "stdio",
      executable: fs.realpathSync(process.execPath),
      cwd: fs.realpathSync(process.cwd()),
      arguments: [],
      configuredEnvironmentDigest: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    });
    expect(approvedDetails?.digest).toMatch(/^[a-f0-9]{64}$/u);
    await provider.close();
  });

  it("shares one monotonic timeout budget across discovery and invocation", async () => {
    let called = false;
    const provider = new KiroMcpProvider(
      "/workspace",
      { ...config, callTimeoutMs: 20 },
      async () => fakeRuntime({
        async listTools() {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return [{ name: "echo", inputSchema: { type: "object" } }];
        },
        async callTool() { called = true; return true; },
      }),
    );
    await expect(provider.invoke("$call", {
      server: "configured",
      tool: "echo",
      args: {},
    }, context())).rejects.toThrow("timed out after 20ms");
    expect(called).toBe(false);
    await provider.close();
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

  it("quarantines a same-server lease until cancelled work is provably quiescent", async () => {
    let calls = 0;
    let settleFirst!: (value: unknown) => void;
    const controller = new AbortController();
    const provider = new KiroMcpProvider(
      "/workspace",
      config,
      async () => fakeRuntime({
        callTool: async () => {
          calls += 1;
          if (calls === 1) return new Promise((resolve) => { settleFirst = resolve; });
          return { content: [{ type: "text", text: "second completed" }] };
        },
      }),
    );
    const first = provider.invoke("$call", { server: "configured", tool: "echo", args: { value: "first" } }, context(controller.signal));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = provider.invoke("$call", { server: "configured", tool: "echo", args: { value: "second" } }, context());
    controller.abort(new Error("cancel first only"));
    await expect(first).rejects.toThrow("cancel first only");
    expect(calls).toBe(1);
    settleFirst({ content: [] });
    await expect(second).resolves.toMatchObject({ text: "second completed" });
    expect(calls).toBe(2);
    await provider.close();
  });

  it("closes and quiesces the contacted server before releasing its lease", async () => {
    let closeServer: string | undefined;
    let settleOperation!: (value: unknown) => void;
    const controller = new AbortController();
    const provider = new KiroMcpProvider(
      "/workspace",
      config,
      async () => fakeRuntime({
        callTool: async () => new Promise((resolve) => { settleOperation = resolve; }),
        close: async (server) => { closeServer = server; settleOperation({ content: [] }); },
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
