import type { Runtime, ServerDefinition } from "mcporter";
import type { FabricRegistryInvocationContext } from "../src/core/action-registry.js";
const context = (approve: FabricRegistryInvocationContext["approve"] = async () => {}): FabricRegistryInvocationContext => ({ cwd: process.cwd(), audits: [], maxResultChars: 100000, approve });
import { describe, expect, it } from "vitest";
import { KiroMcpProvider } from "../src/kiro/mcp-provider.js";
import { CatalogSnapshotStore } from "../src/core/catalog-snapshot-store.js";
import { catalogResultDependencies, catalogResultMethod } from "../src/core/catalog-contract.js";
const setup = () => {
  let contacts = 0;
  let listing = async () => ({ tools: [{ name: "tool", description: "x".repeat(4000), inputSchema: { type: "object" } }] });
  const definitions = new Map(["a", "b"].map(name => [name, { name, command: { kind: "http", url: new URL("https://example.test/mcp") } } as ServerDefinition]));
  const runtime = { listServers: () => [...definitions.keys()], getDefinition: (name: string) => definitions.get(name), connect: async () => { contacts++; return { client: { listTools: () => listing() } }; }, close: async () => {} } as unknown as Runtime;
  const provider = new KiroMcpProvider(process.cwd(), { enabled: true, disableOAuth: false, callTimeoutMs: 1000 }, async () => runtime);
  const store = new CatalogSnapshotStore({ clientSession: "s", runtimeNonce: "n", workspace: "/fake", device: "1", inode: "1", authorizationEpoch: "a" });
  const invoke = (server = "a", action = "$tools") => provider.invoke(action, { server, tool: "tool" }, context());
  const open = async (server = "a", action = "$tools") => {
    const reservation = store.reserve(provider.catalogDependencies({ server }));
    const value = await invoke(server, action);
    reservation.depend(catalogResultDependencies(value));
    return reservation.publish(catalogResultMethod(value)!, Array.isArray(value) ? value : [value]);
  };
  return { provider, store, invoke, open, definitions, contacts: () => contacts, setListing: (fn: typeof listing) => { listing = fn; } };
};
const unavailable = (fn: () => unknown) => expect(fn).toThrow(expect.objectContaining({ failure: expect.objectContaining({ code: "catalog_cursor_unavailable" }) }));
describe("real provider catalog revocation dependencies", () => {
  it("revokes MCP/global and descriptor cursors locally, preserves unrelated MCP and permits fresh reopen", async () => {
    const f = setup();
    const a = await f.open(), b = await f.open("b");
    const global = f.store.reserve(f.provider.catalogDependencies()).publish("tools.listPage", [{ description: "x".repeat(4000) }]);
    const descriptor = (cursor: string) => {
      const item = f.store.catalogPage(cursor, { maxBytes: 1000 }).items[0]!;
      if (!("descriptorCursor" in item)) throw new Error("expected deferred descriptor");
      return item.descriptorCursor;
    };
    const ad = descriptor(a), gd = descriptor(global), before = f.contacts();
    f.provider.invalidateDiscovery("a");
    for (const cursor of [a, global]) unavailable(() => f.store.catalogPage(cursor));
    for (const cursor of [ad, gd]) unavailable(() => f.store.describePage(cursor));
    expect(f.store.catalogPage(b).total).toBe(1);
    expect(f.contacts()).toBe(before);
    expect(f.store.catalogPage(await f.open()).total).toBe(1);
    await f.provider.close();
    unavailable(() => f.store.catalogPage(b));
  });
  it("keeps own initial reservation but revokes old publication on identical replacement including describe", async () => {
    const f = setup();
    const a = await f.open(), global = f.store.reserve(f.provider.catalogDependencies()).publish("tools.listPage", []);
    const d = await f.open("a", "$describe");
    unavailable(() => f.store.catalogPage(a)); unavailable(() => f.store.catalogPage(global));
    expect(f.store.describePage(d).text.length).toBeGreaterThan(0);
    await f.open(); unavailable(() => f.store.describePage(d));
    await f.provider.close();
  });
  it("protects pre-contact reservations and zero-observation global loads", async () => {
    const f = setup();
    const pending = f.store.reserve(f.provider.catalogDependencies({ server: "a" }));
    const global = f.store.reserve(f.provider.catalogDependencies());
    f.provider.invalidateDiscovery("a");
    unavailable(() => pending.publish("mcp.toolsPage", []));
    unavailable(() => global.publish("tools.listPage", []));
    expect(f.contacts()).toBe(0);
    const emptyGlobal = f.store.reserve(f.provider.catalogDependencies());
    await f.open(); unavailable(() => emptyGlobal.publish("tools.listPage", []));
    expect(() => f.provider.catalogDependencies(null as never)).not.toThrow();
    await f.provider.close();
  });
  it("denies pending and queued late discovery publication with no observations", async () => {
    const f = setup();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.setListing(async () => { entered(); await gate; return { tools: [] }; });
    const first = f.invoke().catch(error => error);
    await started;
    const queued = f.invoke().catch(error => error);
    f.provider.invalidateDiscovery("a"); release();
    expect(await first).toBeInstanceOf(Error); expect(await queued).toBeInstanceOf(Error);
    expect(f.provider.observedActions()).toEqual([]); expect(f.contacts()).toBe(1);
    await f.provider.close();
  });
  it("revokes on failed refresh, removed server and transport drift", async () => {
    for (const mode of ["failed", "removed", "drift"]) {
      const f = setup(), cursor = await f.open();
      if (mode === "failed") f.setListing(async () => { throw new Error("failed"); });
      if (mode === "removed") f.definitions.delete("a");
      if (mode === "drift") f.definitions.set("a", { ...f.definitions.get("a")!, command: { kind: "http", url: new URL("https://changed.test/mcp") } as ServerDefinition["command"] });
      await f.invoke().catch(() => {});
      unavailable(() => f.store.catalogPage(cursor));
      await f.provider.close();
    }
  });
  it("revokes saved and pending authority on approval denial without another contact", async () => {
    const f = setup(), cursor = await f.open();
    const pending = f.store.reserve(f.provider.catalogDependencies({ server: "a" }));
    const before = f.contacts();
    await expect(f.provider.invoke("$tools", { server: "a" }, context(async () => { throw new Error("denied"); }))).rejects.toThrow("denied");
    unavailable(() => f.store.catalogPage(cursor));
    unavailable(() => pending.publish("mcp.toolsPage", []));
    expect(f.contacts()).toBe(before); await f.provider.close();
  });
  it("bounds server authorities and never resurrects evicted tickets", async () => {
    const f = setup(), old = f.provider.catalogDependencies({ server: "unused" });
    for (let i = 0; i < 129; i++) f.provider.catalogDependencies({ server: String(i) });
    expect(old.every(ticket => ticket.isCurrent())).toBe(false);
    expect(f.provider.catalogDependencies({ server: "unused" }).every(ticket => ticket.isCurrent())).toBe(true);
    expect(f.contacts()).toBe(0); await f.provider.close();
  });
});
