import { describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import type { FabricActionDescriptor, FabricProvider } from "../src/protocol.js";
import * as digest from "../src/core/semantic-digest.js";

const fixture = () => {
  let revision: string | undefined = "1";
  const actions: FabricActionDescriptor[] = Array.from({ length: 120 }, (_, i) => ({ name: `read${i}`, description: "retrieve document", risk: "read", inputSchema: { type: "object" } }));
  const list = vi.fn(async () => actions);
  const provider: FabricProvider = { name: "catalog", description: "documents", list, discoveryRevision: () => revision, async describe(name) { return actions.find(a => a.name === name); }, async invoke() { return true; } };
  const registry = new ActionRegistry(); registry.register(provider);
  return { registry, provider, list, actions, revision: (value: string | undefined) => { revision = value; } };
};

describe("immutable discovery indexes", () => {
  it("admits moderate 500-action catalogs using actual retained field/token weights", async () => {
    const f = fixture();
    f.actions.splice(0, f.actions.length, ...Array.from({ length: 500 }, (_, i) => ({ name: `read${i}`, description: "retrieve document", risk: "read" as const, inputSchema: { type: "object" } })));
    expect(await f.registry.list()).toHaveLength(500);
    expect(await f.registry.searchAll("document")).toHaveLength(500);
    expect(f.registry.discoveryUsage().peakBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
  it("holds one huge exact-describe record through every coalesced output clone", async () => {
    const f = fixture(); const text = 'schema"🦋'.repeat(140_000);
    f.actions[0]!.inputSchema = { description: text };
    const describe = vi.spyOn(f.provider, "describe");
    const nativeClone = globalThis.structuredClone;
    const usages: number[] = [];
    const clone = vi.spyOn(globalThis, "structuredClone").mockImplementation(value => {
      usages.push(f.registry.discoveryUsage().bytes);
      return nativeClone(value);
    });
    try {
      const results = await Promise.all(Array.from({ length: 3 }, () => f.registry.describe("catalog.read0")));
      expect(describe).toHaveBeenCalledTimes(1);
      expect(results.every(result => result.inputSchema.description === text)).toBe(true);
      expect(results[0]).not.toBe(results[1]);
      // The retained record and the output copy are both charged at each clone.
      expect(usages).toHaveLength(4);
      expect(usages.every(bytes => bytes > text.length * 4)).toBe(true);
      expect(f.registry.discoveryUsage()).toMatchObject({ bytes: 0, nodes: 0 });
      expect(f.registry.discoveryUsage().peakBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    } finally { clone.mockRestore(); describe.mockRestore(); }
  });
  it("bounds 32x500 token-heavy dynamic catalogs while another provider is held", async () => {
    const registry = new ActionRegistry();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const held = vi.fn(async () => { await barrier; return []; });
    registry.register({ name: "held", description: "held", list: held, async describe() { return undefined; }, async invoke() {} });
    const lists = Array.from({ length: 32 }, (_, i) => {
      const list = vi.fn(async () => Array.from({ length: 500 }, (_, j) => ({ name: `a${j}`, description: Array.from({ length: 64 }, (_, k) => `token${k}`).join(" "), risk: "read" as const, inputSchema: { type: "object" } })));
      registry.register({ name: `p${i}`, description: "dynamic", list, async describe() { return undefined; }, async invoke() {} });
      return list;
    });
    const results = await Promise.allSettled([registry.list(), registry.search("token1"), registry.searchAll("token2")]);
    for (const result of results) { expect(result.status).toBe("rejected"); if (result.status === "rejected") expect(String(result.reason)).toContain("catalog_quota_exceeded"); }
    expect(lists.every(list => list.mock.calls.length <= 1)).toBe(true);
    expect(lists.reduce((n, list) => n + list.mock.calls.length, 0)).toBeLessThan(32);
    expect(held).toHaveBeenCalledTimes(1);
    const usage = registry.discoveryUsage();
    expect(usage.peakBytes).toBeLessThanOrEqual(usage.maxBytes);
    expect(usage.peakNodes).toBeLessThanOrEqual(usage.maxNodes);
    expect(usage.bytes).toBe(1024 + usage.rawReservationBytes); expect(usage.inflight).toBe(1);
    expect(usage).toMatchObject({ rawQueued: 0, subscribers: 0 });
    expect(usage.peakRawActive).toBeLessThanOrEqual(2);
    release(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(registry.discoveryUsage()).toMatchObject({ bytes: 0, nodes: 0, inflight: 0, records: 0 });
  });
  it("pins completed dynamic indexes across concurrent callers and cleans up after the held load", async () => {
    const f = fixture(); f.revision(undefined);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const list = vi.fn(async () => { await barrier; return []; });
    f.registry.register({ name: "held", description: "held", list, async describe() { await barrier; return undefined; }, async invoke() {} });
    const first = f.registry.list(); const second = f.registry.search("document");
    const described = f.registry.describe("held.absent").catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.registry.discoveryUsage().bytes).toBeGreaterThan(2048);
    expect(f.list).toHaveBeenCalledTimes(1); expect(list).toHaveBeenCalledTimes(1);
    release(); expect(await first).toHaveLength(120); expect(await second).toHaveLength(30);
    expect(String(await described)).toContain("Unknown Fabric action");
    expect(f.registry.discoveryUsage()).toMatchObject({ bytes: 0, nodes: 0, inflight: 0, records: 0 });
  });
  it("cancels coalesced discovery consumers without dropping a live lease or retaining abandoned indexes", async () => {
    const f = fixture(); f.revision(undefined);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(done => { enter = done; });
    const gate = new Promise<void>(done => { release = done; });
    const held = vi.fn(async () => { enter(); await gate; return []; });
    f.registry.register({ name: "held", description: "held", list: held, async describe() { return undefined; }, async invoke() {} });
    const a = new AbortController(), b = new AbortController();
    const first = f.registry.list(a.signal).catch(error => error);
    const second = f.registry.searchAll("document", b.signal).catch(error => error);
    await entered;
    a.abort(new Error("first canceled"));
    expect(String(await first)).toContain("first canceled");
    expect(f.registry.discoveryUsage().bytes).toBeGreaterThan(2048);
    b.abort(new Error("second canceled"));
    expect(String(await second)).toContain("second canceled");
    expect(f.registry.discoveryUsage()).toMatchObject({ bytes: 1024 + f.registry.discoveryUsage().rawReservationBytes, inflight: 1, subscribers: 0 });
    // A fresh consumer coalesces the still-held provider; no polling or sleeps.
    const fresh = f.registry.list(); release();
    expect(await fresh).toHaveLength(120);
    expect(held).toHaveBeenCalledTimes(1);
    expect(f.registry.discoveryUsage()).toMatchObject({ bytes: 0, nodes: 0, inflight: 0, records: 0 });
  });
  it("keeps abandoned pending describe records charged and coalesces a fresh consumer", async () => {
    const f = fixture(); let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const describe = vi.spyOn(f.provider, "describe").mockImplementation(async () => { await gate; return f.actions[0]; });
    const controller = new AbortController();
    const first = f.registry.describe("catalog.read0", controller.signal).catch(error => error);
    controller.abort(new Error("describe canceled"));
    expect(String(await first)).toContain("describe canceled");
    expect(f.registry.discoveryUsage().bytes).toBeGreaterThanOrEqual(1024);
    const fresh = f.registry.describe("catalog.read0"); release();
    expect(await fresh).toMatchObject({ ref: "catalog.read0" });
    expect(describe).toHaveBeenCalledTimes(1);
    expect(f.registry.discoveryUsage()).toMatchObject({ bytes: 0, nodes: 0 });
  });
  it("retains at most32 idle revision caches without omitting active providers", async () => {
    const registry = new ActionRegistry();
    for (let i = 0; i < 40; i++) registry.register({ name: `small${i}`, description: "small", discoveryRevision: () => "1", list: async () => [{ name: "read", description: "small", risk: "read", inputSchema: {} }], async describe() { return undefined; }, async invoke() {} });
    expect(await registry.list()).toHaveLength(40);
    expect(registry.discoveryUsage().records).toBe(32);
    expect(await registry.searchAll("small")).toHaveLength(40);
    expect(registry.discoveryUsage().records).toBe(32);
  });
  it("forwards frozen dependency contracts without provider semantics", () => {
    const f = fixture(); const dependency = { isCurrent: () => true }; const args = { server: "fake" };
    f.provider.catalogDependencies = vi.fn(() => [dependency]);
    expect(f.registry.catalogDependencies("catalog", args)).toEqual([dependency]);
    expect(f.provider.catalogDependencies).toHaveBeenCalledWith(args);
    expect(f.registry.catalogDependencies()).toEqual([dependency]);
    expect(f.registry.catalogDependencies("missing")).toEqual([]);
  });
  it("rejects token-heavy indexes whose retained Set/string footprint exceeds the partition", async () => {
    const f = fixture(); const description = Array.from({ length: 64 }, (_, i) => `token${i}`).join(" ");
    f.actions.splice(0, f.actions.length, ...Array.from({ length: 3000 }, (_, i) => ({ name: `action${i}`, description, risk: "read" as const, inputSchema: { type: "object" } })));
    await expect(f.registry.search("token1")).rejects.toThrow("catalog_quota_exceeded");
    f.actions.splice(100); f.revision("2");
    await expect(f.registry.search("token1")).resolves.toHaveLength(30);
  });
  it("seven warm searches do no list, digest, or token construction work", async () => {
    const f = fixture(); const hash = vi.spyOn(digest, "semanticDigest");
    await f.registry.search("document");
    const hashes = hash.mock.calls.length;
    const split = vi.spyOn(String.prototype, "split");
    for (let i = 0; i < 7; i++) expect(await f.registry.search("document")).toHaveLength(30);
    expect(f.list).toHaveBeenCalledTimes(1); expect(hash).toHaveBeenCalledTimes(hashes);
    // One query tokenization per search, zero descriptor token builds.
    expect(split).toHaveBeenCalledTimes(7);
    split.mockRestore(); hash.mockRestore();
  });
  it("matches full-search prefixes for mixed scores, ties, providers and limit edge cases", async () => {
    const registry = new ActionRegistry();
    for (const name of ["zeta", "alpha"]) {
      const actions: FabricActionDescriptor[] = Array.from({ length: 120 }, (_, i) => ({
        name: `read${(i * 37) % 120}`, description: i % 3 ? "retrieve document" : "write document", risk: "read",
        namespace: i % 2 ? "files" : "documents", inputSchema: { type: "object", properties: { [i % 5 ? "path" : "documentId"]: { type: "string" } } },
      }));
      registry.register({ name, description: "document operations", discoveryRevision: () => "1", async list() { return actions; }, async describe(action) { return actions.find(entry => entry.name === action); }, async invoke() {} });
    }
    try {
      for (const query of ["document", "alpha.read7", "read7", "retrieve document", "documentId", "ＦＩＬＥＳ", "missing"]) {
        const all = await registry.searchAll(query);
        for (const limit of [1, 2, 7, 30, 99, 100, 500, 0, -4, 1.9, NaN, Infinity, -Infinity]) {
          const capped = Math.max(1, Math.min(100, Math.floor(limit)));
          expect(await registry.search(query, limit)).toEqual(all.slice(0, capped));
        }
      }
    } finally { await registry.close(); }
  });
  it("sorts only the retained top k, not all 500 matching actions", async () => {
    const f = fixture();
    f.actions.splice(0, f.actions.length, ...Array.from({ length: 500 }, (_, i) => ({ name: `read${(i * 37) % 500}`, description: "retrieve document", risk: "read" as const, inputSchema: { type: "object" } })));
    const all = await f.registry.searchAll("document"), sizes: number[] = [];
    const nativeSort = Array.prototype.sort;
    const sort = vi.spyOn(Array.prototype, "sort").mockImplementation(function(this: unknown[], compare) {
      const first = this[0];
      if (first && typeof first === "object" && "action" in first && "score" in first) sizes.push(this.length);
      return nativeSort.call(this, compare);
    });
    try {
      for (const limit of [1, 7, 30]) expect(await f.registry.search("document", limit)).toEqual(all.slice(0, limit));
    } finally { sort.mockRestore(); await f.registry.close(); }
    expect(sizes).toEqual([1, 7, 30]);
  });
  it("keeps discovery validation and failures even for a NaN result limit", async () => {
    const f = fixture(); f.list.mockRejectedValueOnce(new Error("offline"));
    await expect(f.registry.search("document", NaN)).rejects.toThrow("offline");
    expect(await f.registry.search("document", NaN)).toEqual([]);
    expect(f.list).toHaveBeenCalledTimes(2);
    await f.registry.close();
  });
  it("clones outputs, ignores mutations until revision changes, and exposes all matches", async () => {
    const f = fixture(); const listed = await f.registry.list(); listed[0]!.description = "corrupted";
    f.actions[0]!.description = "changed";
    expect((await f.registry.describe("catalog.read0")).description).toBe("changed");
    expect((await f.registry.list())[0]!.description).toBe("retrieve document");
    expect(await f.registry.search("document", 1000)).toHaveLength(100);
    expect(await f.registry.searchAll("document")).toHaveLength(120);
    f.revision("2"); expect((await f.registry.list())[0]!.description).toBe("changed");
  });
  it("coalesces refresh and evicts rejected promises", async () => {
    const f = fixture(); f.list.mockRejectedValueOnce(new Error("offline"));
    await expect(Promise.all([f.registry.list(), f.registry.search("document")])).rejects.toThrow("offline");
    expect(f.list).toHaveBeenCalledTimes(1);
    await Promise.all([f.registry.list(), f.registry.search("document"), f.registry.list()]);
    expect(f.list).toHaveBeenCalledTimes(2);
  });
  it("retries revision change once and explicitly fails continual churn", async () => {
    const f = fixture(); let count = 0;
    f.list.mockImplementation(async () => { f.revision(String(++count + 1)); return f.actions; });
    await expect(f.registry.list()).rejects.toThrow("revision churn"); expect(f.list).toHaveBeenCalledTimes(2);
    f.list.mockImplementation(async () => f.actions); await expect(f.registry.list()).resolves.toHaveLength(120);
  });
  it("coalesces a revision change during refresh and publishes only a stable retry", async () => {
    const f = fixture(); let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    f.list.mockImplementationOnce(async () => { await barrier; return f.actions; });
    const first = f.registry.list(); f.revision("2");
    const second = f.registry.list(); release();
    expect(await first).toEqual(await second); expect(f.list).toHaveBeenCalledTimes(2);
    await f.registry.list(); expect(f.list).toHaveBeenCalledTimes(2);
  });
  it("rejects duplicate refs rather than making aliases ambiguous", async () => {
    const f = fixture(); f.actions.push({ ...f.actions[0]!, inputSchema: {} });
    await expect(f.registry.list()).rejects.toThrow("Ambiguous Fabric action");
  });
  it("undefined revisions remain dynamic and ranking matches cached discovery", async () => {
    const cached = fixture(); const dynamic = fixture(); dynamic.revision(undefined);
    for (const query of ["document", "catalog.read2", "retrieve document", "object", "missing", "ＣＡＴＡＬＯＧ", "read2"]) {
      expect(await cached.registry.search(query)).toEqual(await dynamic.registry.search(query));
    }
    expect(cached.list).toHaveBeenCalledTimes(1); expect(dynamic.list).toHaveBeenCalledTimes(7);
  });
  it("rejects proxy, accessor and shared graph descriptors before cloning", async () => {
    for (const kind of ["proxy", "accessor", "shared"]) {
      const f = fixture(); const descriptor = f.actions[0]!;
      if (kind === "proxy") f.actions[0] = new Proxy(descriptor, {});
      if (kind === "accessor") Object.defineProperty(descriptor, "description", { get() { throw new Error("getter executed"); }, enumerable: true });
      if (kind === "shared") descriptor.outputSchema = descriptor.inputSchema;
      await expect(f.registry.list()).rejects.toThrow(/proxy object|accessor property|shared object graph/u);
    }
  });
});
