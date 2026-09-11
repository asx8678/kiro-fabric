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
