import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({ servers: [] as Array<{ handlers: Map<unknown, (...args: any[]) => Promise<any>> }> }));
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({ Server: class {
  handlers = new Map<unknown, (...args: any[]) => Promise<any>>();
  constructor() { wire.servers.push(this); }
  setRequestHandler(schema: unknown, handler: (...args: any[]) => Promise<any>) { this.handlers.set(schema, handler); }
  setNotificationHandler(schema: unknown, handler: (...args: any[]) => Promise<any>) { this.handlers.set(schema, handler); }
  getClientCapabilities() { return {}; }
  async connect() {}
  async close() {}
} }));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));

import { CallToolRequestSchema, RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { normalizeFabricConfig } from "../src/config.js";
import { createKiroMcpServer } from "../src/kiro/mcp-server.js";
import { createKiroArtifactStore } from "../src/kiro/artifacts.js";
import type { KiroRuntime } from "../src/kiro/runtime.js";
import type { KiroWorkspaceSnapshot } from "../src/kiro/power/workspace-context.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Lifecycle fixture deadline exceeded")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); wire.servers.length = 0; });

async function fixture() {
  const base = fs.mkdtempSync(path.join(process.cwd(), ".catalog-lifecycle-"));
  const projects = ["a", "b"].map(name => path.join(base, name));
  const runtimeRoot = path.join(base, "runtime"), dataRoot = path.join(base, "data");
  for (const dir of [...projects, runtimeRoot, dataRoot]) fs.mkdirSync(dir);
  const entered = deferred(), aborted = deferred(), release = deferred();
  let cleaned = false, closed = false;
  const registry = new ActionRegistry();
  const descriptors = Array.from({ length: 4 }, (_, i) => ({ name: i ? `item${i}` : "hold", description: "Lifecycle fixture", inputSchema: { type: "object" }, risk: "read" as const }));
  registry.register({ name: "local", description: "Deferred local fixture", list: async () => descriptors,
    describe: async name => descriptors.find(d => d.name === name)!,
    invoke: async (_name, _args, context) => {
      context.signal!.addEventListener("abort", aborted.resolve, { once: true });
      entered.resolve();
      await release.promise;
      cleaned = true;
      return "released";
    },
  });
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 20_000, maxOutputChars: 20_000 }, approvals: { read: "allow" }, mcp: { enabled: false } }), projects[0]!);
  const artifacts = createKiroArtifactStore();
  const runtime: KiroRuntime = { service, registry, artifacts, providers: () => [], close: async () => { closed = true; await service.close(); artifacts.close(); } };
  const hosts: Array<{ close(): Promise<void> }> = [];
  cleanups.push(async () => { release.resolve(); await bounded(Promise.all(hosts.map(h => h.close()))); await service.close(); removeFixtureSync(base, { recursive: true, force: true }); });
  async function host(injected = false) {
    let snapshot: KiroWorkspaceSnapshot = { status: injected ? "explicitly-empty" : "verified", roots: injected ? [] : [{ uri: pathToFileURL(projects[0]!).href }], revision: 1, observedAt: Date.now() };
    const server = await createKiroMcpServer({ runtimeRoot, dataRoot, version: "fixture", ...(injected ? { runtime } : {}), prepareRuntime: async () => runtime,
      workspaceContext: { current: async () => snapshot, invalidate() {}, subscribe: () => ({ dispose() {} }) },
    });
    hosts.push(server);
    const handlers = wire.servers.at(-1)!.handlers;
    const call = (code: string, cursor?: string) => bounded(handlers.get(CallToolRequestSchema)!({ params: { name: "fabric_exec", arguments: { code, resultFormat: "json", ...(cursor ? { payloads: { cursor } } : {}) } } }, { signal: new AbortController().signal }));
    return { server, call, change: (unavailable: boolean) => {
      snapshot = { status: unavailable ? "temporarily-unavailable" : "verified", roots: unavailable ? [] : [{ uri: pathToFileURL(projects[1]!).href }], revision: 2, observedAt: Date.now() };
      return handlers.get(RootsListChangedNotificationSchema)!({});
    } };
  }
  return { host, service, entered, aborted, release, cleaned: () => cleaned, closed: () => closed };
}
const open = 'return await tools.listPage({limit:1});';
const resume = 'return await tools.listPage({cursor:payloads.cursor,limit:1});';
function cursorOf(response: any): string {
  expect(response.isError, response.content[0].text).not.toBe(true);
  const page = JSON.parse(response.content[0].text);
  expect(page.complete).toBe(false);
  expect(page.nextCursor).toEqual(expect.any(String));
  return page.nextCursor;
}

describe("real catalog authority across outer MCP host lifecycle", () => {
  it.each(["workspace-switch", "workspace-unavailable", "close"])("rejects an issued cursor before blocked cleanup completes on %s", async cause => {
    const f = await fixture(), h = await f.host();
    const cursor = cursorOf(await h.call(open));
    cursorOf(await h.call(resume, cursor)); // Prove this is a usable continuation, not an arbitrary token.
    let executionDone = false, transitionDone = false;
    const execution = h.call('return await tools.call({ref:"local.hold",args:{}});').then(r => { executionDone = true; return r; });
    await bounded(f.entered.promise);
    const transition = (cause === "close" ? h.server.close() : h.change(cause === "workspace-unavailable")).then(() => { transitionDone = true; });
    try {
      // The real host aborts only after revocation. This event is a deterministic
      // barrier; the provider still owns its settlement until release below.
      await bounded(f.aborted.promise);
      const rejected = await bounded(f.service.execute({ code: resume, payloads: { cursor }, approver: { async approve() {} } }));
      expect(rejected).toMatchObject({ success: false, failure: { code: "catalog_cursor_unavailable" } });
      expect(f.cleaned()).toBe(false);
      expect(f.closed()).toBe(false);
      expect(executionDone).toBe(false);
      expect(transitionDone).toBe(false);
    } finally { f.release.resolve(); await bounded(execution); await bounded(transition); }
    expect(f.cleaned()).toBe(true);
    expect(f.closed()).toBe(true);
  }, 30_000);

  it("refuses shared injected runtime reauthorization and rejects a previous client's cursor in a fresh runtime", async () => {
    const a = await fixture(), old = await a.host(true);
    const cursor = cursorOf(await old.call(open));
    const replacement = await a.host(true);
    const shared = await replacement.call(resume, cursor);
    expect(shared.isError).toBe(true);
    expect(shared.content[0].text).toMatch(/bound or revoked/);
    // A conflicting owner fails closed for BOTH clients, never silently rebinds.
    // The rejected replacement revokes the shared runtime, so the original owner
    // now observes the terminal closed-service contract rather than a cursor error.
    const oldOwner = await old.call(resume, cursor);
    expect(oldOwner.isError).toBe(true);
    expect(oldOwner.content[0].text).toMatch(/Fabric execution service is closed/);
    expect(oldOwner.content[0].text).not.toMatch(/catalog_cursor_unavailable/);
    const b = await fixture(), fresh = await b.host(true);
    const crossClient = await fresh.call(resume, cursor);
    expect(crossClient.isError).toBe(true);
    expect(crossClient.content[0].text).toMatch(/catalog_cursor_unavailable|Catalog cursor unavailable/);
    cursorOf(await fresh.call(open));
    await old.server.close();
    const revoked = await replacement.call(resume, cursor);
    expect(revoked.isError).toBe(true);
    // The replacement's fallback factory still returns its retired instance;
    // the runtime-ownership guard refuses it before catalog authorization.
    expect(revoked.content[0].text).toMatch(/Runtime factory returned an already retired MCP runtime/);
  }, 30_000);
});
