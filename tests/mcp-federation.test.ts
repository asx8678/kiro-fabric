import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Runtime, ServerDefinition, ServerToolInfo } from "mcporter";
import { describe, expect, it } from "vitest";
import { normalizeFabricConfig, type FabricMcpConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
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
  definition?: ServerDefinition;
  listTools?: Runtime["listTools"];
  callTool?: Runtime["callTool"];
  close?: Runtime["close"];
  onConnect?: () => void;
} = {}): Runtime => {
  const server = options.definition ?? definition("configured", options.kind ?? "http");
  const listTools = options.listTools ?? (async () => [{
    name: "echo",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  }]);
  return {
    listServers: () => [server.name],
    getDefinitions: () => [server],
    getDefinition: () => server,
    registerDefinition() {},
    listTools,
    callTool: options.callTool ?? (async () => ({ content: [{ type: "text", text: "ok" }] })),
    async listResources() { return []; },
    async readResource() { return null; },
    async connect() {
      options.onConnect?.();
      return {
        client: {
          async listTools() { return { tools: await listTools(server.name, { includeSchema: true }) }; },
        },
        transport: { async close() {} },
        definition: server,
      } as unknown as Awaited<ReturnType<Runtime["connect"]>>;
    },
    close: options.close ?? (async () => {}),
  };
};

describe("configured Fabric MCP federation", () => {
  it("keeps discovery static and contacts only an exact configured server", async () => {
    let creations = 0;
    const runtime = fakeRuntime();
    const provider = new KiroMcpProvider("/workspace", config, async () => {
      creations += 1;
      return runtime;
    });
    expect((await provider.list()).map((entry) => entry.name)).toEqual(["$servers", "$tools", "$describe", "$call"]);
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

  it("discovers digest-bound remote schemas only through approval-gated actions", async () => {
    let calls = 0;
    let destructiveHint = false;
    const registry = new ActionRegistry();
    registry.register(new KiroMcpProvider("/workspace", config, async () => fakeRuntime({
      listTools: async () => [{
        name: "echo",
        description: "Echo one value",
        inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
        outputSchema: { type: "object", properties: { echoed: { type: "string" } } },
        annotations: { readOnlyHint: true, destructiveHint },
      }] as Array<ServerToolInfo & { annotations: { readOnlyHint: boolean; destructiveHint: boolean } }>,
      callTool: async () => { calls += 1; return true; },
    })));
    const approvals: string[] = [];
    const invocation = () => ({
      cwd: "/workspace",
      audits: [],
      maxResultChars: 100_000,
      approve: async (action: { ref: string }) => { approvals.push(action.ref); },
    });
    try {
      const listed = await registry.invoke("mcp.$tools", { server: "configured" }, invocation()) as Array<Record<string, unknown>>;
      expect(approvals).toEqual(["mcp.$tools"]);
      expect(calls).toBe(0);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        server: "configured",
        name: "echo",
        ref: "configured.echo",
        description: "Echo one value",
        stale: false,
        annotations: { readOnlyHint: true, destructiveHint: false },
        transport: { kind: "http", configDigest: null },
      });
      expect(listed[0]?.descriptorDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect((listed[0]?.transport as Record<string, unknown>).digest).toMatch(/^[a-f0-9]{64}$/u);

      const described = await registry.invoke("mcp.$describe", { server: "configured", tool: "echo" }, invocation()) as Record<string, unknown>;
      expect(approvals).toEqual(["mcp.$tools", "mcp.$describe"]);
      expect(described.descriptorDigest).toBe(listed[0]?.descriptorDigest);
      expect(described).toMatchObject({ outputSchema: { type: "object" } });
      expect(calls).toBe(0);

      await expect(registry.invoke("mcp.$call", {
        server: "configured",
        tool: "echo",
        args: { value: "safe" },
        expectedDescriptorDigest: described.descriptorDigest,
      }, invocation())).resolves.toBe(true);
      expect(calls).toBe(1);

      destructiveHint = true;
      await expect(registry.invoke("mcp.$call", {
        server: "configured",
        tool: "echo",
        args: { value: "stale" },
        expectedDescriptorDigest: described.descriptorDigest,
      }, invocation())).rejects.toThrow("descriptor changed before invocation");
      expect(calls).toBe(1);
    } finally {
      await registry.close();
    }
  });

  it("rejects malformed call metadata before runtime creation or approval", async () => {
    let creations = 0;
    const approvals: string[] = [];
    const registry = new ActionRegistry();
    registry.register(new KiroMcpProvider("/workspace", config, async () => {
      creations += 1;
      return fakeRuntime();
    }));
    const invocation = {
      cwd: "/workspace",
      audits: [],
      maxResultChars: 100_000,
      approve: async (action: { ref: string }) => { approvals.push(action.ref); },
    };
    try {
      await expect(registry.invoke("mcp.$call", {
        server: "configured",
        tool: "echo",
        args: "not-an-object",
      }, invocation)).rejects.toThrow("args must be an object");
      await expect(registry.invoke("mcp.$call", {
        server: "configured",
        tool: "echo",
        args: {},
        expectedDescriptorDigest: "z".repeat(64),
      }, invocation)).rejects.toThrow("lowercase SHA-256 digest");
      expect(creations).toBe(0);
      expect(approvals).toEqual([]);
    } finally {
      await registry.close();
    }
  });

  it("rejects ambiguous remote tool descriptors", async () => {
    const provider = new KiroMcpProvider("/workspace", config, async () => fakeRuntime({
      listTools: async () => [
        { name: "same", inputSchema: { type: "object" } },
        { name: "same", inputSchema: { type: "object" } },
      ],
    }));
    try {
      await expect(provider.invoke("$tools", { server: "configured" }, context()))
        .rejects.toThrow("duplicate name");
    } finally {
      await provider.close();
    }
  });

  it("rejects malformed remote tool annotations", async () => {
    const provider = new KiroMcpProvider("/workspace", config, async () => fakeRuntime({
      listTools: async () => [{
        name: "unsafe",
        inputSchema: { type: "object" },
        annotations: { destructiveHint: "sometimes" },
      }] as unknown as ServerToolInfo[],
    }));
    try {
      await expect(provider.invoke("$tools", { server: "configured" }, context()))
        .rejects.toThrow("annotations");
    } finally {
      await provider.close();
    }
  });

  it("rejects a remote tool that omits its required input schema", async () => {
    const provider = new KiroMcpProvider("/workspace", config, async () => fakeRuntime({
      listTools: async () => [{ name: "unsafe" }],
    }));
    try {
      await expect(provider.invoke("$tools", { server: "configured" }, context()))
        .rejects.toThrow("tool at index 0 is malformed");
    } finally {
      await provider.close();
    }
  });

  it("exposes typed friendly discovery inside checked QuickJS", async () => {
    const registry = new ActionRegistry();
    registry.register(new KiroMcpProvider("/workspace", config, async () => fakeRuntime()));
    const service = new FabricExecutionService(registry, normalizeFabricConfig({}), "/workspace");
    const approved: string[] = [];
    try {
      const result = await service.execute({
        code: `
          const descriptor = await mcp.describe({ server: "configured", tool: "echo" });
          return {
            ref: descriptor.ref,
            digestLength: descriptor.descriptorDigest.length,
            transportKind: descriptor.transport.kind,
            stale: descriptor.stale,
          };
        `,
        approver: { async approve(action) { approved.push(action.ref); } },
      });
      expect(result).toMatchObject({
        status: "succeeded",
        value: { ref: "configured.echo", digestLength: 64, transportKind: "http", stale: false },
      });
      expect(approved).toEqual(["mcp.$describe"]);
      expect(result.audits).toMatchObject([{ ref: "mcp.$describe", success: true }]);
    } finally {
      await service.close();
    }
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
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "echo", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false }, annotations: { title: "Real echo", readOnlyHint: true, idempotentHint: true } }] }));
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
      const discoveryArgs = await provider.prepareArguments("$tools", { server: "configured" }, context());
      await expect(provider.invoke("$tools", discoveryArgs, context(undefined, async () => {})))
        .resolves.toMatchObject([{
          name: "echo",
          annotations: { title: "Real echo", readOnlyHint: true, idempotentHint: true },
        }]);
      const args = { server: "configured", tool: "echo", args: { value: "real" } };
      const prepared = await provider.prepareArguments("$call", args, context());
      const approvals: string[] = [];
      await expect(provider.invoke("$call", prepared, context(undefined, async (action) => { approvals.push(action.ref); })))
        .resolves.toMatchObject({ text: "echo:real" });
      expect(approvals).toEqual(["mcp.$stdio"]);
      expect(fs.readdirSync(temporary).sort()).toEqual(["mcp.json", "server.mjs"]);
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  it("rejects an aliased explicit MCP configuration before loading", async () => {
    if (process.platform === "win32") return;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcporter-config-link-"));
    const target = path.join(temporary, "target.json");
    const configFile = path.join(temporary, "mcp.json");
    fs.writeFileSync(target, `${JSON.stringify({ imports: [], mcpServers: {} })}\n`, { mode: 0o600 });
    fs.symlinkSync(target, configFile);
    const provider = new KiroMcpProvider(temporary, { ...config, configPath: configFile });
    try {
      await expect(provider.invoke("$servers", {}, context())).rejects.toThrow("unaliased regular file");
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

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
      schemaVersion: 2,
      server: "configured",
      kind: "stdio",
      executable: fs.realpathSync(process.execPath),
      cwd: fs.realpathSync(process.cwd()),
      arguments: [],
      argumentFiles: [],
      configuredEnvironmentDigest: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    });
    expect(approvedDetails?.digest).toMatch(/^[a-f0-9]{64}$/u);
    await provider.close();
  });

  it("rejects a stdio command symlink retargeted after approval", async () => {
    if (process.platform === "win32") return;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcp-command-link-"));
    const first = path.join(temporary, "first");
    const second = path.join(temporary, "second");
    const command = path.join(temporary, "command");
    fs.writeFileSync(first, "first", { mode: 0o700 });
    fs.writeFileSync(second, "other", { mode: 0o700 });
    fs.symlinkSync(first, command);
    let calls = 0;
    const server: ServerDefinition = {
      name: "configured",
      command: { kind: "stdio", command, args: [], cwd: temporary },
    };
    const provider = new KiroMcpProvider("/workspace", config, async () => fakeRuntime({
      definition: server,
      callTool: async () => { calls += 1; return true; },
    }));
    try {
      const prepared = await provider.prepareArguments("$call", {
        server: "configured",
        tool: "echo",
        args: { value: "hello" },
      }, context());
      fs.unlinkSync(command);
      fs.symlinkSync(second, command);
      await expect(provider.invoke("$call", prepared, context(undefined, async () => {})))
        .rejects.toThrow("transport changed after approval");
      expect(calls).toBe(0);
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("invalidates the executable digest cache after same-size mutation with restored mtime", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcp-command-content-"));
    const command = path.join(temporary, "command");
    const fixedTime = new Date("2020-01-01T00:00:00.000Z");
    fs.writeFileSync(command, "first", { mode: 0o700 });
    fs.utimesSync(command, fixedTime, fixedTime);
    let calls = 0;
    const server: ServerDefinition = {
      name: "configured",
      command: { kind: "stdio", command, args: [], cwd: temporary },
    };
    const provider = new KiroMcpProvider("/workspace", config, async () => fakeRuntime({
      definition: server,
      callTool: async () => { calls += 1; return true; },
    }));
    try {
      const prepared = await provider.prepareArguments("$call", {
        server: "configured",
        tool: "echo",
        args: { value: "hello" },
      }, context());
      const before = fs.statSync(command, { bigint: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
      fs.writeFileSync(command, "other");
      fs.utimesSync(command, fixedTime, fixedTime);
      const after = fs.statSync(command, { bigint: true });
      expect(after.ino).toBe(before.ino);
      expect(after.size).toBe(before.size);
      expect(after.mtimeNs).toBe(before.mtimeNs);
      expect(after.ctimeNs).not.toBe(before.ctimeNs);
      await expect(provider.invoke("$call", prepared, context(undefined, async () => {})))
        .rejects.toThrow("transport changed after approval");
      expect(calls).toBe(0);
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("binds existing stdio argument files and rejects script mutation after approval", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcp-script-content-"));
    const script = path.join(temporary, "server.mjs");
    const fixedTime = new Date("2020-01-01T00:00:00.000Z");
    fs.writeFileSync(script, "export default 'first';\n", { mode: 0o600 });
    fs.utimesSync(script, fixedTime, fixedTime);
    let calls = 0;
    const server: ServerDefinition = {
      name: "configured",
      command: { kind: "stdio", command: process.execPath, args: ["server.mjs", "--mode", "test"], cwd: temporary },
    };
    const provider = new KiroMcpProvider("/workspace", config, async () => fakeRuntime({
      definition: server,
      callTool: async () => { calls += 1; return true; },
    }));
    try {
      const prepared = await provider.prepareArguments("$call", {
        server: "configured",
        tool: "echo",
        args: { value: "hello" },
      }, context());
      expect(prepared.transportSnapshot).toMatchObject({
        schemaVersion: 2,
        arguments: ["server.mjs", "--mode", "test"],
        argumentFiles: [{
          argumentIndex: 0,
          argument: "server.mjs",
          resolvedPath: fs.realpathSync(script),
        }],
      });

      const before = fs.statSync(script, { bigint: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
      fs.writeFileSync(script, "export default 'other';\n");
      fs.utimesSync(script, fixedTime, fixedTime);
      const after = fs.statSync(script, { bigint: true });
      expect(after.ino).toBe(before.ino);
      expect(after.size).toBe(before.size);
      expect(after.mtimeNs).toBe(before.mtimeNs);
      expect(after.ctimeNs).not.toBe(before.ctimeNs);
      await expect(provider.invoke("$call", prepared, context(undefined, async () => {})))
        .rejects.toThrow("transport changed after approval");
      expect(calls).toBe(0);
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("keeps the approved transport stable when the server creates an argument-named file", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcp-script-appear-"));
    const script = path.join(temporary, "server.mjs");
    const pidFile = path.join(temporary, "downstream.pid");
    fs.writeFileSync(script, "export default 'server';\n", { mode: 0o600 });
    let calls = 0;
    const server: ServerDefinition = {
      name: "configured",
      command: { kind: "stdio", command: process.execPath, args: [script, pidFile], cwd: temporary },
    };
    const provider = new KiroMcpProvider("/workspace", config, async () => fakeRuntime({
      definition: server,
      callTool: async () => { calls += 1; return true; },
      onConnect: () => { fs.writeFileSync(pidFile, String(process.pid), { mode: 0o600 }); },
    }));
    try {
      const prepared = await provider.prepareArguments("$call", {
        server: "configured",
        tool: "echo",
        args: { value: "hello" },
      }, context());
      // The pid file does not exist before the server starts, so only the
      // script is bound at approval time.
      expect(prepared.transportSnapshot).toMatchObject({
        argumentFiles: [{ argumentIndex: 0, argument: script, resolvedPath: fs.realpathSync(script) }],
      });
      await expect(provider.invoke("$call", prepared, context(undefined, async () => {})))
        .resolves.toBe(true);
      expect(calls).toBe(1);
      expect(fs.existsSync(pidFile)).toBe(true);
      // Later calls keep the frozen binding: the file the approved server
      // itself created never joins the approved transport digest.
      const again = await provider.prepareArguments("$call", {
        server: "configured",
        tool: "echo",
        args: { value: "hello" },
      }, context());
      expect(again.transportSnapshot).toEqual(prepared.transportSnapshot);
      await expect(provider.invoke("$call", again, context(undefined, async () => {})))
        .resolves.toBe(true);
      expect(calls).toBe(2);
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("rejects oversized stdio argument files before approval", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcp-script-size-"));
    const script = path.join(temporary, "oversized.mjs");
    fs.writeFileSync(script, "", { mode: 0o600 });
    fs.truncateSync(script, 16 * 1024 * 1024 + 1);
    const server: ServerDefinition = {
      name: "configured",
      command: { kind: "stdio", command: process.execPath, args: [script], cwd: temporary },
    };
    const provider = new KiroMcpProvider("/workspace", config, async () => fakeRuntime({ definition: server }));
    try {
      await expect(provider.prepareArguments("$call", {
        server: "configured",
        tool: "echo",
        args: {},
      }, context())).rejects.toThrow("exceeds 16777216 bytes");
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("rejects aggregate stdio argument-file exhaustion before hashing", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcp-script-total-"));
    const scripts = Array.from({ length: 5 }, (_, index) => path.join(temporary, `input-${index}.bin`));
    for (const script of scripts) {
      fs.writeFileSync(script, "", { mode: 0o600 });
      fs.truncateSync(script, 16 * 1024 * 1024);
    }
    const server: ServerDefinition = {
      name: "configured",
      command: { kind: "stdio", command: process.execPath, args: scripts, cwd: temporary },
    };
    const provider = new KiroMcpProvider("/workspace", config, async () => fakeRuntime({ definition: server }));
    try {
      await expect(provider.prepareArguments("$call", {
        server: "configured",
        tool: "echo",
        args: {},
      }, context())).rejects.toThrow("exceed 67108864 bytes total");
    } finally {
      await provider.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
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
