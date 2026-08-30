import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { FabricMcpConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { McpDescriptorCacheStore } from "../src/providers/mcp-descriptor-cache.js";
import { McpProvider } from "../src/providers/mcp-provider.js";
import { loadCachedMcpDescriptors } from "../src/providers/mcp-advisory.js";
import type { FabricInvocationContext } from "../src/protocol.js";

const context: FabricInvocationContext = {
  cwd: process.cwd(),
  signal: undefined,
  parentToolCallId: "test",
  nestedToolCallId: "nested",
  extensionContext: {} as ExtensionContext,
  update() {},
};

const FAKE_SERVER = path.resolve("tests/fixtures/fake-mcp-server.mjs");
const FLAKY_SERVER = path.resolve("tests/fixtures/flaky-mcp-server.mjs");

const mcpConfig = (overrides: Partial<FabricMcpConfig> = {}): FabricMcpConfig => ({
  enabled: true,
  disableOAuth: true,
  allowDynamicServers: true,
  callTimeoutMs: 5_000,
  cache: { enabled: false, revalidate: "changed", revalidateBudgetMs: 10_000 },
  advisory: false,
  ...overrides,
});

const cacheConfig = (
  configPath: string,
  cacheOverrides: Partial<FabricMcpConfig["cache"]> = {},
): FabricMcpConfig =>
  mcpConfig({
    configPath,
    cache: { enabled: true, revalidate: "changed", revalidateBudgetMs: 10_000, ...cacheOverrides },
  });

const temporaryDirectories: string[] = [];

const temporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-mcp-"));
  temporaryDirectories.push(directory);
  return directory;
};

// Two stdio servers backed by the counting fixture. Returns the config path;
// count calls land in countFile with the per-server label.
const writeTwoServerConfig = (options: {
  directory: string;
  countFile: string;
  falExtraArgs?: string[];
  testEnv?: Record<string, string>;
  testName?: string;
  falName?: string;
}): string => {
  const configPath = path.join(options.directory, "mcporter.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      mcpServers: {
        [options.testName ?? "test"]: {
          command: process.execPath,
          args: [FAKE_SERVER],
          env: {
            KIRO_FABRIC_MCP_COUNT_FILE: options.countFile,
            KIRO_FABRIC_MCP_COUNT_LABEL: options.testName ?? "test",
            ...options.testEnv,
          },
        },
        [options.falName ?? "fal-ai"]: {
          command: process.execPath,
          args: [FAKE_SERVER, ...(options.falExtraArgs ?? [])],
          env: {
            KIRO_FABRIC_MCP_COUNT_FILE: options.countFile,
            KIRO_FABRIC_MCP_COUNT_LABEL: options.falName ?? "fal-ai",
          },
        },
      },
      imports: [],
    }),
  );
  return configPath;
};

const countLines = (countFile: string): string[] =>
  fs.existsSync(countFile)
    ? fs.readFileSync(countFile, "utf8").trim().split("\n").filter(Boolean)
    : [];

const registryContext = (approve: (action: unknown, args: Record<string, unknown>) => Promise<void>) => ({
  ...context,
  approve,
  audits: [],
  maxResultChars: 10_000,
});

describe("McpProvider", () => {
  it("fails closed when multiple tools share one sanitized alias", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    const configPath = writeTwoServerConfig({
      directory,
      countFile,
      testEnv: { KIRO_FABRIC_MCP_COLLISIONS: "1" },
    });
    const provider = new McpProvider(directory, mcpConfig({ configPath }));
    try {
      await expect(provider.describe("test.echo_value", context)).resolves.toBeUndefined();
      await expect(
        provider.invoke("test.echo_value", { value: "x" }, context),
      ).rejects.toThrow("Unknown MCP tool");
      const listed = await provider.list({ namespace: "test" }, context);
      expect(listed.map((descriptor) => descriptor.name)).not.toEqual(
        expect.arrayContaining(["test.echo-value", "test.echo_value"]),
      );
      await expect(provider.invoke("$call", {
        server: "test",
        tool: "echo_value",
        args: { value: "x" },
      }, context)).resolves.toMatchObject({ text: "called:echo_value" });
    } finally {
      await provider.close();
    }
  });

  it.each([false, true])(
    "fails closed when multiple servers share one sanitized alias (cache=%s)",
    async (cacheEnabled) => {
      const directory = temporaryDirectory();
      const countFile = path.join(directory, "tools-list.log");
      const configPath = writeTwoServerConfig({
        directory,
        countFile,
        testName: "test-one",
        falName: "test_one",
      });
      const config = cacheEnabled ? cacheConfig(configPath) : mcpConfig({ configPath });
      const cachePath = path.join(directory, ".pi", "fabric", "mcp-cache.json");
      const provider = new McpProvider(
        directory,
        config,
        cacheEnabled ? { cache: new McpDescriptorCacheStore(cachePath) } : {},
      );
      try {
        await expect(provider.describe("test_one.echo_value", context)).resolves.toBeUndefined();
        await expect(
          provider.invoke("test_one.echo_value", { value: "x" }, context),
        ).rejects.toThrow("Unknown MCP server");
        await expect(provider.list({ namespace: "test_one" }, context)).resolves.toEqual([]);
        await expect(provider.invoke("$call", {
          server: "test_one",
          tool: "echo-value",
          args: { value: "safe raw" },
        }, context)).resolves.toMatchObject({ text: "echo:safe raw" });
        await expect(provider.invoke("$call", {
          server: "test-one",
          tool: "echo-value",
          args: { value: "punctuated raw" },
        }, context)).resolves.toMatchObject({ text: "echo:punctuated raw" });
        if (cacheEnabled) {
          await provider.settle();
          expect(provider.sliceDescriptors()).toEqual([]);
          await expect(loadCachedMcpDescriptors({
            cwd: directory,
            projectRoot: directory,
            config,
          })).resolves.toEqual([]);
        }
      } finally {
        await provider.close();
      }
    },
    30_000,
  );

  it("approves before contact and validates explicit call args on cold and warm metadata", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    const eventFile = path.join(directory, "events.log");
    const configPath = writeTwoServerConfig({
      directory,
      countFile,
      testEnv: { KIRO_FABRIC_MCP_EVENT_FILE: eventFile },
    });
    const provider = new McpProvider(directory, mcpConfig({ configPath }));
    const registry = new ActionRegistry();
    registry.register(provider);
    try {
      const deny = vi.fn(async () => {
        throw new Error("network denied");
      });
      await expect(registry.invoke(
        "mcp.test.echo_value",
        { value: "denied direct" },
        registryContext(deny),
      )).rejects.toThrow("Unknown Fabric action: mcp.test.echo_value");
      // Cold dynamic resolution is cache-only and fails before approval rather
      // than starting a server to discover the requested descriptor.
      expect(deny).not.toHaveBeenCalled();
      expect(countLines(eventFile)).toEqual([]);

      await expect(registry.invoke(
        "mcp.$call",
        { server: "test", tool: "echo-value", args: { value: "denied" } },
        registryContext(deny),
      )).rejects.toThrow("network denied");
      expect(deny).toHaveBeenCalledOnce();
      expect(countLines(eventFile)).toEqual([]);

      const approve = vi.fn(async () => {});
      const secret = "nested-argument-secret";
      await expect(registry.invoke(
        "mcp.$call",
        { server: "test", tool: "echo-value", args: { value: { secret } } },
        registryContext(approve),
      )).rejects.toThrow(/Invalid arguments for mcp\.call: \/args\/value:/);
      expect(approve).toHaveBeenCalledOnce();
      const coldEvents = countLines(eventFile);
      expect(coldEvents).toEqual(["test:initialize", "test:tools/list"]);
      expect(coldEvents.some((event) => event.includes("tools/call"))).toBe(false);

      let warmError = "";
      try {
        await registry.invoke(
          "mcp.$call",
          { server: "test", tool: "echo-value", args: { value: { secret } } },
          registryContext(approve),
        );
      } catch (error) {
        warmError = error instanceof Error ? error.message : String(error);
      }
      expect(warmError).toMatch(/\/args\/value:/);
      expect(warmError).not.toContain(secret);
      expect(countLines(eventFile)).toEqual(coldEvents);

      await expect(registry.invoke(
        "mcp.$call",
        { server: "test", tool: "echo-value", args: { value: "valid" } },
        registryContext(approve),
      )).resolves.toMatchObject({ text: "echo:valid" });
      expect(countLines(eventFile).filter((event) => event.includes("tools/list"))).toHaveLength(1);
      expect(countLines(eventFile).filter((event) => event.includes("tools/call"))).toEqual([
        "test:tools/call:echo-value",
      ]);
    } finally {
      await registry.close();
    }
  });

  it("discovers and calls a stdio server through mcporter", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    const configPath = writeTwoServerConfig({ directory, countFile });
    const provider = new McpProvider(directory, mcpConfig({ configPath }));
    try {
      const listed = await provider.list({ namespace: "test" }, context);
      expect(listed).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "test.echo-value", risk: "network" })]),
      );
      const described = await provider.describe("test.echo_value", context);
      expect(described?.inputSchema).toMatchObject({ required: ["value"] });
      await expect(provider.invoke("test.echo_value", { value: "hello" }, context)).resolves.toMatchObject({
        text: "echo:hello",
      });
      await expect(provider.invoke("test.echo_value", { value: "again" }, context)).resolves.toMatchObject({
        text: "echo:again",
      });
      await provider.list({ namespace: "fal-ai" }, context);
      const modelSchema = await provider.describe("fal_ai.get_model_schema", context);
      expect(modelSchema?.name).toBe("fal-ai.get-model-schema");
      await expect(
        provider.invoke(
          "fal_ai.get_model_schema",
          { endpoint_id: "openai/gpt-image-2" },
          context,
        ),
      ).resolves.toMatchObject({ text: "schema:openai/gpt-image-2" });
      const controller = new AbortController();
      const cancelled = provider.invoke(
        "test.echo_value",
        { value: "__delay__" },
        { ...context, signal: controller.signal },
      );
      setTimeout(() => controller.abort(), 20);
      await expect(cancelled).rejects.toThrow("MCP call cancelled");

      await expect(
        provider.invoke(
          "$register",
          {
            name: "dynamic-server",
            command: process.execPath,
            args: [path.resolve("tests/fixtures/fake-mcp-server.mjs")],
            env: {
              KIRO_FABRIC_MCP_COUNT_FILE: countFile,
              KIRO_FABRIC_MCP_COUNT_LABEL: "dynamic-server",
            },
          },
          context,
        ),
      ).resolves.toEqual({ registered: "dynamic-server" });
      await expect(provider.invoke("$call", {
        server: "dynamic-server",
        tool: "echo-value",
        args: { value: "dynamic" },
      }, context)).resolves.toMatchObject({ text: "echo:dynamic" });
      expect(countLines(countFile).sort()).toEqual([
        "dynamic-server",
        "fal-ai",
        "test",
      ]);
    } finally {
      await provider.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("McpProvider descriptor cache", () => {
  it("fails closed on a cold direct ref and preserves approval-before-contact for the facade", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    const eventFile = path.join(directory, "events.log");
    const configPath = writeTwoServerConfig({
      directory,
      countFile,
      testEnv: { KIRO_FABRIC_MCP_EVENT_FILE: eventFile },
    });
    const provider = new McpProvider(
      directory,
      cacheConfig(configPath, { revalidate: "off" }),
      { cache: new McpDescriptorCacheStore(path.join(directory, "mcp-cache.json")) },
    );
    const registry = new ActionRegistry();
    registry.register(provider);
    const deny = vi.fn(async () => {
      throw new Error("network denied");
    });
    try {
      await expect(registry.invoke(
        "mcp.test.echo_value",
        { value: "cold direct" },
        registryContext(deny),
      )).rejects.toThrow("Unknown Fabric action: mcp.test.echo_value");
      expect(deny).not.toHaveBeenCalled();
      expect(countLines(eventFile)).toEqual([]);
      expect(countLines(countFile)).toEqual([]);

      await expect(registry.invoke(
        "mcp.$call",
        { server: "test", tool: "echo-value", args: { value: "denied facade" } },
        registryContext(deny),
      )).rejects.toThrow("network denied");
      expect(deny).toHaveBeenCalledOnce();
      expect(countLines(eventFile)).toEqual([]);
      expect(countLines(countFile)).toEqual([]);
    } finally {
      await registry.close();
    }
  });

  it("rejects invalid explicit args from a warm disk cache without contacting the server", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    const eventFile = path.join(directory, "events.log");
    const configPath = writeTwoServerConfig({
      directory,
      countFile,
      testEnv: { KIRO_FABRIC_MCP_EVENT_FILE: eventFile },
    });
    const cachePath = path.join(directory, "mcp-cache.json");
    const config = cacheConfig(configPath, { revalidate: "off" });

    const cold = new McpProvider(directory, config, {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      await expect(cold.invoke("$call", {
        server: "test",
        tool: "echo-value",
        args: { value: 42 },
      }, context)).rejects.toThrow(/Invalid arguments for mcp\.call: \/args\/value:/);
    } finally {
      await cold.close();
    }
    expect(countLines(eventFile)).toEqual(["test:initialize", "test:tools/list"]);

    const warm = new McpProvider(directory, config, {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      await expect(warm.invoke("$call", {
        server: "test",
        tool: "echo-value",
        args: { value: 42 },
      }, context)).rejects.toThrow(/\/args\/value:/);
      // Resolving the configured definition and cached schema is local: no
      // process starts and no tools/call reaches the server in session two.
      expect(countLines(eventFile)).toEqual(["test:initialize", "test:tools/list"]);
    } finally {
      await warm.close();
    }

    // Older or partial cache entries may have no schema. That metadata is
    // advisory, so defer to the remote server, which must still reject the
    // invalid arguments.
    const snapshot = JSON.parse(fs.readFileSync(cachePath, "utf8")) as {
      servers: Record<string, { tools: Array<{ name: string; inputSchema?: unknown }> }>;
    };
    const cachedEcho = snapshot.servers.test?.tools.find((tool) => tool.name === "echo-value");
    expect(cachedEcho).toBeDefined();
    delete cachedEcho!.inputSchema;
    fs.writeFileSync(cachePath, JSON.stringify(snapshot));

    const schemaUnavailable = new McpProvider(directory, config, {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      await expect(schemaUnavailable.invoke("$call", {
        server: "test",
        tool: "echo-value",
        args: { value: 42 },
      }, context)).rejects.toThrow("Invalid tool arguments");
      expect(countLines(eventFile).filter((event) => event.includes("tools/call"))).toEqual([
        "test:tools/call:echo-value",
      ]);
    } finally {
      await schemaUnavailable.close();
    }
  });

  it("populates once, then serves warm sessions without spawning servers", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    const configPath = writeTwoServerConfig({ directory, countFile });
    const cachePath = path.join(directory, ".pi", "fabric", "mcp-cache.json");

    const first = new McpProvider(directory, cacheConfig(configPath), {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      // Cold cache: the list kicks off background revalidation; nothing is
      // known yet until it drains.
      await first.list({}, context);
      await first.settle();
      const listed = await first.list({}, context);
      expect(listed.map((descriptor) => descriptor.name)).toEqual(
        expect.arrayContaining(["$servers", "test.echo-value", "fal-ai.echo-value"]),
      );
      expect(countLines(countFile).sort()).toEqual(["fal-ai", "test"]);
    } finally {
      await first.close();
    }
    expect(fs.existsSync(cachePath)).toBe(true);

    const second = new McpProvider(directory, cacheConfig(configPath), {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      // Warm session: hydrated wholly from disk — descriptors and schemas are
      // visible before any server process exists.
      const listed = await second.list({}, context);
      expect(listed.map((descriptor) => descriptor.name)).toEqual(
        expect.arrayContaining([
          "test.echo-value",
          "test.get-model-schema",
          "fal-ai.echo-value",
        ]),
      );
      const described = await second.describe("test.echo_value", context);
      expect(described?.inputSchema).toMatchObject({ required: ["value"] });
      const servers = (await second.invoke("$servers", {}, context)) as Array<{
        name: string;
        tools: number;
        stale: boolean;
      }>;
      expect(servers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "test", tools: 2, stale: false }),
          expect.objectContaining({ name: "fal-ai", tools: 2, stale: false }),
        ]),
      );
      await second.settle();
      // Still only the cold run's two listings — session two spawned nothing.
      expect(countLines(countFile).sort()).toEqual(["fal-ai", "test"]);
    } finally {
      await second.close();
    }
  }, 30_000);

  it("ignores whitespace-only config rewrites (definition-hash stability)", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    const configPath = writeTwoServerConfig({ directory, countFile });
    const cachePath = path.join(directory, "mcp-cache.json");

    const first = new McpProvider(directory, cacheConfig(configPath), {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      await first.list({}, context);
      await first.settle();
    } finally {
      await first.close();
    }
    expect(countLines(countFile).sort()).toEqual(["fal-ai", "test"]);

    // Layer stat changes (mtime/size), but every resolved definition hashes
    // identically: nothing is revalidated.
    fs.appendFileSync(configPath, "\n");

    const second = new McpProvider(directory, cacheConfig(configPath), {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      const listed = await second.list({}, context);
      expect(listed.map((descriptor) => descriptor.name)).toEqual(
        expect.arrayContaining(["test.echo-value", "fal-ai.echo-value"]),
      );
      await second.settle();
      expect(countLines(countFile).sort()).toEqual(["fal-ai", "test"]);
    } finally {
      await second.close();
    }
  }, 30_000);

  it("revalidates only the server whose definition changed", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    writeTwoServerConfig({ directory, countFile });
    const cachePath = path.join(directory, "mcp-cache.json");
    const configPath = path.join(directory, "mcporter.json");

    const first = new McpProvider(directory, cacheConfig(configPath), {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      await first.list({}, context);
      await first.settle();
    } finally {
      await first.close();
    }

    // Only fal-ai's definition changes; test's stays byte-identical.
    writeTwoServerConfig({ directory, countFile, falExtraArgs: ["--v2"] });

    const second = new McpProvider(directory, cacheConfig(configPath), {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      // test is served from cache while fal-ai re-lists in the background.
      const listed = await second.list({}, context);
      expect(listed.map((descriptor) => descriptor.name)).toContain("test.echo-value");
      await second.settle();
      expect(countLines(countFile).sort()).toEqual(["fal-ai", "fal-ai", "test"]);
      const after = await second.list({}, context);
      expect(after.map((descriptor) => descriptor.name)).toEqual(
        expect.arrayContaining(["fal-ai.echo-value", "fal-ai.get-model-schema"]),
      );
    } finally {
      await second.close();
    }
  }, 30_000);

  it("revalidate: off never spawns in the background; explicit probes fetch exactly one server", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    writeTwoServerConfig({ directory, countFile });
    const cachePath = path.join(directory, "mcp-cache.json");
    const configPath = path.join(directory, "mcporter.json");

    const first = new McpProvider(directory, cacheConfig(configPath), {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      await first.list({}, context);
      await first.settle();
    } finally {
      await first.close();
    }

    writeTwoServerConfig({ directory, countFile, falExtraArgs: ["--v2"] });

    const second = new McpProvider(
      directory,
      cacheConfig(configPath, { revalidate: "off" }),
      { cache: new McpDescriptorCacheStore(cachePath) },
    );
    try {
      const listed = await second.list({}, context);
      await second.settle();
      expect(countLines(countFile).sort()).toEqual(["fal-ai", "test"]);
      const names = listed.map((descriptor) => descriptor.name);
      expect(names).toContain("test.echo-value");
      // fal-ai's definition changed, so its cached tools are not served.
      expect(names.some((name) => name.startsWith("fal-ai."))).toBe(false);

      // An explicit namespaced probe is a bounded live fetch of that server.
      const falTools = await second.list({ namespace: "fal_ai" }, context);
      expect(falTools.map((descriptor) => descriptor.name)).toEqual(
        expect.arrayContaining(["fal-ai.echo-value", "fal-ai.get-model-schema"]),
      );
      expect(countLines(countFile).sort()).toEqual(["fal-ai", "fal-ai", "test"]);
      const refreshed = await second.list({}, context);
      expect(refreshed.map((descriptor) => descriptor.name)).toContain("fal-ai.echo-value");
    } finally {
      await second.close();
    }
  }, 30_000);

  it("keeps last-known tools marked stale when revalidation fails", async () => {
    const directory = temporaryDirectory();
    const stateFile = path.join(directory, "flaky-state");
    const configPath = path.join(directory, "mcporter.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          flaky: {
            command: process.execPath,
            args: [FLAKY_SERVER],
            env: { KIRO_FABRIC_MCP_FLAKY_STATE: stateFile },
          },
        },
        imports: [],
      }),
    );
    const cachePath = path.join(directory, "mcp-cache.json");

    const first = new McpProvider(
      directory,
      cacheConfig(configPath, { revalidate: "all" }),
      { cache: new McpDescriptorCacheStore(cachePath) },
    );
    try {
      await first.list({}, context);
      await first.settle();
      expect(
        (await first.list({}, context)).map((descriptor) => descriptor.name),
      ).toContain("flaky.flaky-ping");
    } finally {
      await first.close();
    }

    // The fixture now dies at startup: a policy-all revalidation fails, but
    // the cached slice survives and is marked stale.
    const second = new McpProvider(
      directory,
      cacheConfig(configPath, { revalidate: "all" }),
      { cache: new McpDescriptorCacheStore(cachePath) },
    );
    try {
      await second.list({}, context);
      await second.settle();
      const listed = await second.list({}, context);
      expect(listed.map((descriptor) => descriptor.name)).toContain("flaky.flaky-ping");
      const servers = (await second.invoke("$servers", {}, context)) as Array<{
        name: string;
        tools: number;
        stale: boolean;
      }>;
      expect(servers).toEqual([
        expect.objectContaining({ name: "flaky", tools: 1, stale: true }),
      ]);
    } finally {
      await second.close();
    }
  }, 30_000);

  it("lists ephemeral $register servers without persisting them", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    const configPath = writeTwoServerConfig({ directory, countFile });
    const cachePath = path.join(directory, "mcp-cache.json");

    const provider = new McpProvider(directory, cacheConfig(configPath), {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      await provider.list({}, context);
      await provider.settle();
      await provider.invoke(
        "$register",
        {
          name: "dynamic-server",
          command: process.execPath,
          args: [FAKE_SERVER],
          env: {
            KIRO_FABRIC_MCP_COUNT_FILE: countFile,
            KIRO_FABRIC_MCP_COUNT_LABEL: "dynamic-server",
          },
        },
        context,
      );
      await provider.settle();
      const names = (await provider.list({}, context)).map((descriptor) => descriptor.name);
      expect(names).toContain("dynamic-server.echo-value");
    } finally {
      await provider.close();
    }
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8")) as {
      servers: Record<string, unknown>;
    };
    expect(Object.keys(cached.servers).sort()).toEqual(["fal-ai", "test"]);
  }, 30_000);

  it("invokes through the cache, reports organic use, and relists on first contact", async () => {
    const directory = temporaryDirectory();
    const countFile = path.join(directory, "tools-list.log");
    const configPath = writeTwoServerConfig({ directory, countFile });
    const cachePath = path.join(directory, "mcp-cache.json");

    const first = new McpProvider(directory, cacheConfig(configPath), {
      cache: new McpDescriptorCacheStore(cachePath),
    });
    try {
      await first.list({}, context);
      await first.settle();
    } finally {
      await first.close();
    }

    const used: string[] = [];
    const second = new McpProvider(directory, cacheConfig(configPath), {
      cache: new McpDescriptorCacheStore(cachePath),
      hooks: { onToolUse: (server) => used.push(server) },
    });
    try {
      await second.list({}, context);
      await second.settle();
      expect(countLines(countFile).sort()).toEqual(["fal-ai", "test"]);

      const result = (await second.invoke("test.echo_value", { value: "warm" }, context)) as {
        text: string;
      };
      expect(result.text).toBe("echo:warm");
      expect(used).toEqual(["test"]);
      await second.settle();
      // First contact rode the pooled connection into one background relist.
      expect(countLines(countFile).sort()).toEqual(["fal-ai", "test", "test"]);

      // The explicit facade may force one approved live relist before an
      // unknown-tool error; direct cache misses stay inert.
      await expect(second.invoke("$call", {
        server: "test",
        tool: "nope",
        args: {},
      }, context)).rejects.toThrow("Unknown MCP tool");
      expect(countLines(countFile).sort()).toEqual(["fal-ai", "test", "test", "test"]);
    } finally {
      await second.close();
    }
  }, 30_000);
});
