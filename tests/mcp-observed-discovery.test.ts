import type { Runtime, ServerDefinition } from "mcporter";
import { describe, expect, it, vi } from "vitest";
import { KiroMcpProvider } from "../src/kiro/mcp-provider.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import * as digests from "../src/core/semantic-digest.js";
import { remoteRef } from "../src/core/remote-identity.js";
import { catalogResultMethod } from "../src/core/catalog-contract.js";

const setup = () => {
  let contacts = 0;
  let creations = 0;
  let inventory = [{ name: "c", description: "original", inputSchema: { type: "object" } }];
  let listing: (() => Promise<unknown>) | undefined;
  const calls: string[][] = [];
  const definitions = new Map(["a.b", "a"].map(name => [name, { name, command: { kind: "http", url: new URL("https://example.test/mcp") } } as ServerDefinition]));
  const runtime = {
    listServers: () => [...definitions.keys()],
    getDefinition: (name: string) => definitions.get(name)!,
    connect: async () => { contacts++; return { client: { listTools: async () => listing ? listing() : { tools: inventory } } }; },
    callTool: async (server: string, tool: string) => { calls.push([server, tool]); return { content: [{ type: "text", text: "ok" }] }; },
    close: async () => {},
  } as unknown as Runtime;
  const provider = new KiroMcpProvider(process.cwd(), { enabled: true, disableOAuth: true, callTimeoutMs: 1000 }, async () => { creations++; return runtime; });
  const registry = new ActionRegistry();
  registry.register(provider);
  const context = () => ({ cwd: process.cwd(), audits: [], maxResultChars: 100_000, approve: async () => {} });
  return { provider, registry, context, calls, definitions, counts: () => [creations, contacts], setInventory: (value: typeof inventory) => { inventory = value; }, setListing: (value: typeof listing) => { listing = value; } };
};

describe("provider-local observed MCP inventories", () => {
  it("keeps local reads passive and routes colliding dotted identities through canonical generic calls", async () => {
    const f = setup();
    expect(f.provider.discoveryRevision()).toBe("0");
    expect(f.provider.observedActions()).toEqual([]);
    expect((await f.provider.list()).map(x => x.name)).toEqual(["$servers", "$tools", "$describe", "$call"]);
    expect(f.counts()).toEqual([0, 0]);
    await f.registry.invoke("mcp.$tools", { server: "a.b" }, f.context());
    f.setInventory([{ name: "b.c", description: "second", inputSchema: { type: "object" } }]);
    await f.registry.invoke("mcp.$describe", { server: "a", tool: "b.c" }, f.context());
    const observations = f.provider.observedActions();
    expect(observations.map(x => x.ref)).toEqual([remoteRef("a.b", "c"), remoteRef("a", "b.c")]);
    const before = f.counts();
    const descriptor = observations[0]!.descriptor();
    expect(observations[0]!.descriptor()).toBe(descriptor);
    expect(Object.isFrozen(descriptor.inputSchema)).toBe(true);
    expect(descriptor).toMatchObject({ freshness: "observed", description: "original", risk: "network" });
    expect(f.counts()).toEqual(before);
    await f.registry.invoke(remoteRef("a", "b.c"), {}, f.context());
    expect(f.calls).toEqual([["a", "b.c"]]);
    expect(f.counts()).toEqual([1, 3]);
    await f.provider.close();
    expect(f.provider.observedActions()).toEqual([]);
  });

  it("retains six explicit versus four cached canonical paginated list requests", async () => {
    for (const cached of [false, true]) {
      const f = setup();
      let requests = 0;
      f.setListing(async () => {
        requests++;
        return requests % 2 ? { tools: [{ name: "c", inputSchema: { type: "object" } }], nextCursor: "next" } : { tools: [] };
      });
      await f.registry.invoke("mcp.$tools", { server: "a" }, f.context());
      if (cached) {
        await f.registry.describe(remoteRef("a", "c"));
        await f.registry.invoke(remoteRef("a", "c"), {}, f.context());
      } else {
        await f.registry.invoke("mcp.$describe", { server: "a", tool: "c" }, f.context());
        await f.registry.invoke("mcp.$call", { server: "a", tool: "c" }, f.context());
      }
      expect(requests).toBe(cached ? 4 : 6);
      expect(f.calls).toEqual([["a", "c"]]);
      await f.provider.close();
    }
  });

  it("hashes only selected remote descriptors and caches lazy projections", async () => {
    const f = setup();
    f.setInventory(Array.from({ length: 100 }, (_, i) => ({ name: `tool${i}`, description: "bounded", inputSchema: { type: "object" } })));
    const spy = vi.spyOn(digests, "semanticDigest");
    try {
      await f.provider.invoke("$describe", { server: "a", tool: "tool50" }, f.context());
      const remoteHashes = () => spy.mock.calls.filter(([domain]) => domain === "kiro-fabric-remote-mcp-descriptor-v1").length;
      expect(remoteHashes()).toBe(1);
      const observed = f.provider.observedActions();
      expect(observed).toHaveLength(100);
      expect(remoteHashes()).toBe(1);
      observed[50]!.descriptor();
      observed[50]!.descriptor();
      expect(remoteHashes()).toBe(1);
      observed[0]!.descriptor();
      expect(remoteHashes()).toBe(2);
      await f.provider.invoke("$call", { server: "a", tool: "tool50" }, f.context());
      expect(remoteHashes()).toBe(3);
      expect(f.calls).toEqual([["a", "tool50"]]);
    } finally { spy.mockRestore(); await f.provider.close(); }
  });

  it("marks explicit catalog results only and replaces old inventory with successful empty discovery", async () => {
    const f = setup();
    const tools = await f.provider.invoke("$tools", { server: "a" }, f.context());
    expect(catalogResultMethod(tools)).toBe("mcp.toolsPage");
    const descriptor = await f.provider.invoke("$describe", { server: "a", tool: "c" }, f.context());
    expect(catalogResultMethod(descriptor)).toBe("mcp.describePage");
    const result = await f.provider.invoke("$call", { server: "a", tool: "c" }, f.context());
    expect(catalogResultMethod(result)).toBeUndefined();
    const revision = f.provider.discoveryRevision();
    f.setInventory([]);
    await f.provider.invoke("$tools", { server: "a" }, f.context());
    expect(f.provider.observedActions()).toEqual([]);
    expect(f.provider.discoveryRevision()).not.toBe(revision);
    await f.provider.close();
  });

  it("denies without contact or publication and preserves exact whitespace names", async () => {
    const f = setup();
    await expect(f.registry.invoke("mcp.$tools", { server: "a" }, { ...f.context(), approve: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    expect(f.counts()).toEqual([1, 0]);
    expect(f.provider.observedActions()).toEqual([]);
    f.setInventory([{ name: " c ", description: "exact", inputSchema: { type: "object" } }]);
    await f.registry.invoke("mcp.$describe", { server: "a", tool: " c " }, f.context());
    expect(f.provider.observedActions()[0]!.ref).toBe(remoteRef("a", " c "));
    await expect(f.provider.prepareArguments("$tools", { server: "\ud800" }, f.context())).rejects.toThrow("Unicode");
    await f.provider.close();
  });

  it("rejects A-to-B-to-A publication after the reserved observation epoch was invalidated", async () => {
    const f = setup();
    await f.provider.invoke("$tools", { server: "a" }, f.context());
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.setListing(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    const pending = f.provider.invoke("$tools", { server: "a" }, f.context());
    const rejected = expect(pending).rejects.toThrow("epoch invalidated");
    await started;
    const original = f.definitions.get("a")!;
    f.definitions.set("a", { name: "a", command: { kind: "http", url: new URL("https://changed.test/mcp") } });
    await f.provider.prepareArguments("$tools", { server: "a" }, f.context());
    f.definitions.set("a", original);
    await f.provider.prepareArguments("$tools", { server: "a" }, f.context());
    release({ tools: [{ name: "late", inputSchema: {} }] });
    await rejected;
    expect(f.provider.observedActions()).toEqual([]);
    await f.provider.close();
  });

  it("preserves long canonical repair refs and validates the exact 256-unit name boundary", async () => {
    const f = setup();
    const tool = "界".repeat(256);
    f.setInventory([{ name: tool, description: "long", inputSchema: { type: "object" } }]);
    const descriptor = await f.provider.invoke("$describe", { server: "a", tool }, f.context()) as { ref: string; descriptorDigest: string };
    expect(descriptor.ref).toBe(remoteRef("a", tool));
    expect(descriptor.ref.length).toBeGreaterThan(512);
    f.setInventory([{ name: tool, description: "changed", inputSchema: { type: "object" } }]);
    await expect(f.provider.invoke("$call", { server: "a", tool, expectedDescriptorDigest: descriptor.descriptorDigest }, f.context())).rejects.toMatchObject({
      failure: { code: "stale_descriptor", dispatchState: "not_dispatched", ref: descriptor.ref, replacementDescriptor: { ref: descriptor.ref } },
    });
    expect(f.calls).toEqual([]);
    await expect(f.provider.prepareArguments("$describe", { server: "a", tool: tool + "x" }, f.context())).rejects.toThrow("256");
    await f.provider.close();
  });

  it("evicts on churn and failed inventory, and cannot republish after close", async () => {
    const f = setup();
    await f.provider.invoke("$tools", { server: "a" }, f.context());
    const prepared = await f.provider.prepareArguments("$tools", { server: "a" }, f.context());
    f.definitions.set("a", { name: "a", command: { kind: "http", url: new URL("https://changed.test/mcp") } });
    await expect(f.provider.invoke("$tools", prepared, f.context())).rejects.toThrow("transport changed");
    expect(f.provider.observedActions()).toEqual([]);
    await f.provider.invoke("$tools", { server: "a" }, f.context());
    f.setListing(async () => ({ tools: [{ name: "\ud800", inputSchema: {} }] }));
    await expect(f.provider.invoke("$tools", { server: "a" }, f.context())).rejects.toThrow("Unicode");
    expect(f.provider.observedActions()).toEqual([]);
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.setListing(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    const pending = f.provider.invoke("$tools", { server: "a" }, f.context());
    const rejected = expect(pending).rejects.toThrow("closed");
    await started;
    const closing = f.provider.close();
    expect(f.provider.observedActions()).toEqual([]);
    release({ tools: [{ name: "late", inputSchema: {} }] });
    await rejected;
    await closing;
    expect(f.provider.observedActions()).toEqual([]);
  });
});
