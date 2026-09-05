import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  handlers: new Map<unknown, (...args: any[]) => any>(),
  events: [] as Array<{ ev: string; execId?: string; data?: Record<string, unknown> }>,
  configThrows: false,
  syncError: undefined as Error | undefined,
  executeResult: undefined as any,
  artifactError: undefined as Error | undefined,
  artifactWrites: [] as string[],
  prepareMutation: undefined as undefined | ((request: any, signal?: AbortSignal) => Promise<any>),
  commits: [] as any[],
  identity: "<unbound>",
  runtimeCreates: 0,
  prepareRuntime: undefined as undefined | (() => Promise<any>),
  runtimeCloses: 0,
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: class {
    setRequestHandler(schema: unknown, handler: (...args: any[]) => any) { harness.handlers.set(schema, handler); }
    setNotificationHandler() {}
    getClientCapabilities() { return {}; }
    async connect() {}
    async close() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));
vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return { ...actual, loadFabricConfig: () => {
    if (harness.configThrows) throw new Error("PRIVATE config content");
    return { executor: { maxTimeoutMs: 1_000, timeoutMs: 100, maxOutputChars: 100, resultFormat: "text" }, approvals: {}, tracing: { enabled: true } };
  } };
});
vi.mock("../src/trace/tracer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/trace/tracer.js")>();
  const tracer = {
    enabled: true, file: "/trace", newExecutionId: () => `exec-${harness.events.length + 1}`,
    span: () => ({ id: "span", end() {} }),
    event: (_cat: string, ev: string, execId?: string, data?: Record<string, unknown>) => harness.events.push({ ev, ...(execId === undefined ? {} : { execId }), ...(data === undefined ? {} : { data }) }),
    flush() {}, close() {},
  };
  return { ...actual, resolveTraceEnabled: () => true, createFabricTracer: () => tracer };
});
vi.mock("../src/kiro/canonical-path.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/kiro/canonical-path.js")>(),
  inspectCanonicalPath: (value: string) => ({ canonicalPath: value, lexicalPath: value, identity: { dev: 1n, ino: 1n, ctimeNs: 1n } }),
}));
vi.mock("../src/kiro/power/data-paths.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/kiro/power/data-paths.js")>(),
  prepareKiroPowerDataPaths: (root: string) => ({ root, configFile: `${root}/config.json`, mcpConfig: `${root}/mcp.json`, projects: `${root}/projects`, artifacts: `${root}/artifacts` }),
  prepareKiroPowerProjectPaths: () => ({ artifacts: "/artifacts", memory: "/memory", memoryNamespace: "ns", state: "/state" }),
}));
vi.mock("../src/kiro/power/workspace-binding.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/kiro/power/workspace-binding.js")>();
  return { ...actual, KiroPowerWorkspaceBinding: class {
    bindingIdentity() { return harness.identity; }
    bindingSource() { return undefined; }
    workspaceObservation() { return { status: "unbound" as const }; }
    updateClientRoots() {}
    status() { return { status: "unbound" as const, requiresSelection: false }; }
    list() { return { ...this.status(), roots: [] }; }
    prepareMutation(request: any, signal?: AbortSignal) { return harness.prepareMutation?.(request, signal) ?? Promise.resolve(request); }
    commitMutation(mutation: any) { harness.commits.push(mutation); harness.identity = JSON.stringify(mutation); return { status: "committed" }; }
  } };
});

import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createKiroMcpServer } from "../src/kiro/mcp-server.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};
const baseResult = (value: unknown) => ({ success: true, status: "succeeded", value, logs: [], audits: [], effectiveTimeoutMs: 100 });
const runtime = () => ({
  service: { cwd: "/workspace", config: { executor: { maxTimeoutMs: 1_000, timeoutMs: 100, maxOutputChars: 100, resultFormat: "text" }, approvals: {} }, execute: vi.fn(async () => harness.executeResult) },
  artifacts: { write: (content: string) => { harness.artifactWrites.push(content); if (harness.artifactError) throw harness.artifactError; return "artifact-safe"; } },
  providers: () => [], registry: { list: async () => [] },
  close: async () => { harness.runtimeCloses++; },
});
const create = async (injected = true) => {
  const instance = runtime();
  const server = await createKiroMcpServer({
    runtimeRoot: "/runtime", dataRoot: "/data", version: "test",
    ...(injected ? { runtime: instance as any } : {}),
    prepareRuntime: async () => { harness.runtimeCreates++; return harness.prepareRuntime ? harness.prepareRuntime() : instance as any; },
    workspaceContext: { current: async () => { if (harness.syncError) throw harness.syncError; return { status: "explicitly-empty" as const, roots: [], revision: 1, observedAt: Date.now() }; }, invalidate() {}, subscribe: () => ({ dispose() {} }) },
  });
  const handler = harness.handlers.get(CallToolRequestSchema)!;
  return { server, handler, instance };
};
const call = (handler: (...args: any[]) => any, name: string, args: unknown, signal = new AbortController().signal) =>
  handler({ params: { name, arguments: args } }, { signal });
const projections = () => harness.events.filter((event) => event.ev === "exec.projection");

beforeEach(() => {
  harness.handlers.clear(); harness.events.length = 0; harness.configThrows = false; harness.syncError = undefined;
  harness.executeResult = baseResult("ok"); harness.artifactError = undefined; harness.artifactWrites.length = 0;
  harness.prepareMutation = undefined; harness.commits.length = 0; harness.identity = "<unbound>";
  harness.runtimeCreates = 0; harness.prepareRuntime = undefined; harness.runtimeCloses = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("actual MCP CallTool handler projection behavior", () => {
  it("returns Unicode exactly and emits one correlated allowlisted projection", async () => {
    const { server, handler } = await create();
    harness.executeResult = baseResult("héllo 🌍");
    const response = await call(handler, "fabric_exec", { code: "PRIVATE source", resultFormat: "text" });
    expect(response.content[0].text).toBe("héllo 🌍");
    const [event] = projections();
    expect(projections()).toHaveLength(1);
    expect(event!.data).toEqual({ visibleChars: 8, visibleBytes: 11, isError: false, overflowed: false, artifactRetained: false });
    expect(event!.execId).toBe(harness.events.find((item) => item.ev === "tool.fabric_exec")!.execId);
    expect(JSON.stringify(harness.events)).not.toContain("PRIVATE source");
    await server.close();
  });

  it("projects runtime failures without tracing secret result or error content", async () => {
    const { server, handler } = await create();
    harness.executeResult = { ...baseResult(undefined), success: false, status: "failed", error: "PRIVATE runtime failure" };
    const response = await call(handler, "fabric_exec", { code: "return 1" });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("PRIVATE runtime failure");
    expect(projections()).toHaveLength(1);
    expect(projections()[0]!.data).toMatchObject({ isError: true, overflowed: false, artifactRetained: false });
    expect(JSON.stringify(harness.events)).not.toContain("PRIVATE runtime failure");
    await server.close();
  });

  it.each([
    ["invalid arguments", { code: 7 }, undefined],
    ["workspace sync failure", { code: "return 1" }, new Error("PRIVATE workspace failure")],
  ])("traces one safe projection for %s", async (_case, args, syncError) => {
    const { server, handler } = await create(); harness.syncError = syncError;
    const response = await call(handler, "fabric_exec", args);
    expect(response.isError).toBe(true); expect(projections()).toHaveLength(1);
    expect(projections()[0]!.data).toEqual(expect.objectContaining({ isError: true, overflowed: false, artifactRetained: false }));
    const trace = JSON.stringify(harness.events);
    expect(trace).not.toMatch(/PRIVATE|return 1/);
    await server.close();
  });

  it("cleans the request abort listener when config loading throws after startup", async () => {
    const { server, handler } = await create(); harness.configThrows = true;
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const response = await call(handler, "fabric_exec", { code: "PRIVATE config request" }, controller.signal);
    expect(response.isError).toBe(true); expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    expect(projections()).toHaveLength(1); expect(JSON.stringify(harness.events)).not.toMatch(/PRIVATE|config content/);
    harness.configThrows = false; await server.close();
  });

  it.each([[false, true], [true, false]])("reports overflow retention failure=%s", async (retentionFails, retained) => {
    const { server, handler } = await create();
    harness.executeResult = baseResult("秘密🌍".repeat(100));
    if (retentionFails) harness.artifactError = new Error("PRIVATE retention failure");
    const response = await call(handler, "fabric_exec", { code: "return secret", resultFormat: "text" });
    expect(response.content[0].text.length).toBeLessThanOrEqual(100);
    expect(response.content[0].text.length).toBeGreaterThan(0);
    expect(response.isError === true).toBe(retentionFails);
    expect(projections()).toHaveLength(1);
    expect(projections()[0]!.data).toEqual({ visibleChars: response.content[0].text.length, visibleBytes: Buffer.byteLength(response.content[0].text), isError: retentionFails, overflowed: true, artifactRetained: retained });
    expect(JSON.stringify(harness.events)).not.toMatch(/秘密|PRIVATE|return secret/);
    await server.close();
  });
});

describe("actual MCP queued workspace mutation cancellation", () => {
  it.each(["select", "attach", "detach"])("does not commit a cancelled queued %s", async (action) => {
    const prepared = deferred<any>(); const blockedRuntime = deferred<any>(); const mutationEntered = deferred<void>();
    harness.prepareMutation = () => { mutationEntered.resolve(); return prepared.promise; };
    harness.prepareRuntime = () => blockedRuntime.promise;
    const { server, handler, instance } = await create(false);
    const controller = new AbortController();
    const mutationCall = call(handler, "fabric_workspace", action === "select" ? { action, rootId: "root" } : action === "attach" ? { action, path: "/workspace" } : { action }, controller.signal);
    await mutationEntered.promise;
    const infoCall = call(handler, "fabric_info", {});
    prepared.resolve({ action });
    await Promise.resolve();
    controller.abort();
    blockedRuntime.resolve(instance as any);
    await infoCall; const response = await mutationCall;
    expect(response.isError).toBe(true); expect(harness.commits).toEqual([]); expect(harness.runtimeCreates).toBe(1);
    await server.close();
  });

  it("commits when the same queued mutation is not cancelled", async () => {
    const prepared = deferred<any>(); const blockedRuntime = deferred<any>();
    harness.prepareMutation = () => prepared.promise; harness.prepareRuntime = () => blockedRuntime.promise;
    const { server, handler, instance } = await create(false);
    const mutationCall = call(handler, "fabric_workspace", { action: "detach" }); await Promise.resolve();
    const infoCall = call(handler, "fabric_info", {}); await Promise.resolve(); prepared.resolve({ action: "detach" }); await Promise.resolve();
    blockedRuntime.resolve(instance as any); await infoCall;
    expect((await mutationCall).isError).toBeUndefined(); expect(harness.commits).toEqual([{ action: "detach" }]);
    await server.close();
  });

  it("lets queued shutdown win over a mutation commit", async () => {
    const prepared = deferred<any>(); const blockedRuntime = deferred<any>(); const runtimeEntered = deferred<void>();
    harness.prepareMutation = () => prepared.promise;
    harness.prepareRuntime = () => { runtimeEntered.resolve(); return blockedRuntime.promise; };
    const { server, handler, instance } = await create(false);
    const mutationCall = call(handler, "fabric_workspace", { action: "detach" }); await Promise.resolve();
    const infoCall = call(handler, "fabric_info", {}); await runtimeEntered.promise;
    const closing = server.close(); prepared.resolve({ action: "detach" }); await Promise.resolve(); blockedRuntime.resolve(instance as any);
    await infoCall; await closing; const response = await mutationCall;
    expect(response.isError).toBe(true); expect(harness.commits).toEqual([]); expect(harness.runtimeCloses).toBe(1);
  });
});
