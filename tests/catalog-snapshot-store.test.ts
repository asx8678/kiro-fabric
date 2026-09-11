import { describe, expect, it } from "vitest";
import { CatalogSnapshotStore } from "../src/core/catalog-snapshot-store.js";
import { FabricRepairError } from "../src/core/repair-error.js";
import type { CatalogBinding, CatalogMethod } from "../src/core/catalog-contract.js";
import { fabricJsonText } from "../src/runtime/json-budget.js";
const binding: CatalogBinding = { clientSession: "s", runtimeNonce: "n", workspace: "/fake", device: "1", inode: "2", authorizationEpoch: "a" };
const publish = (s: CatalogSnapshotStore, values: readonly unknown[], method: CatalogMethod = "tools.listPage") => s.reserve().publish(method, values);
const code = (fn: () => unknown, expected: string) => { try { fn(); throw new Error("Expected repair error"); } catch (e) { expect(e).toBeInstanceOf(FabricRepairError); expect((e as FabricRepairError).failure.code).toBe(expected); } };
const reconstruct = (s: CatalogSnapshotStore, cursor: string, budget = 1000) => {
  let text = "", count = 0;
  for (;;) {
    const page = s.describePage(cursor, { maxBytes: budget }, budget);
    const json = fabricJsonText(page, budget);
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(budget);
    expect(page.text.length).toBeGreaterThan(0);
    text += page.text; count++;
    expect(count).toBeLessThan(10000);
    if (page.complete) { expect(text.length).toBe(page.totalChars); return JSON.parse(text); }
    expect(page.nextCursor!.length).toBeLessThan(400);
    cursor = page.nextCursor!;
  }
};
describe("CatalogSnapshotStore", () => {
  it("enumerates defaults, explicit limits, empty inventories and stable replay", () => {
    const s = new CatalogSnapshotStore(binding), values = Array.from({ length: 105 }, (_, i) => ({ i }));
    const cursor = publish(s, values);
    expect(s.catalogPage(cursor).returned).toBe(30);
    const first = s.catalogPage(cursor, { limit: 100 });
    expect(first.returned).toBe(100); expect(first.complete).toBe(false);
    expect(s.catalogPage(cursor, { limit: 100 })).toEqual(first);
    expect(s.catalogPage(first.nextCursor!).items).toEqual(values.slice(100).map(descriptor => ({ descriptor })));
    expect(s.catalogPage(publish(s, []))).toEqual({ items: [], total: 0, returned: 0, complete: true });
  });
  it.each(["tools.listPage", "tools.searchPage", "mcp.toolsPage"] as const)("defers and reconstructs unicode/escaping and huge long refs for %s", method => {
    const s = new CatalogSnapshotStore(binding);
    const descriptor = { ref: "remote/" + "é".repeat(4620), inputSchema: { text: '\u0000\\\"🛰\n'.repeat(10000) }, descriptorDigest: "a".repeat(64) };
    const cursor = publish(s, [descriptor], method), page = s.catalogPage(cursor, { maxBytes: 1000 }, 1000);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1000);
    expect(page.complete).toBe(true); expect(page.returned).toBe(1);
    const item = page.items[0]!; expect("descriptorCursor" in item).toBe(true);
    if (!("descriptorCursor" in item)) throw new Error("not deferred");
    expect(item.descriptorDigest).toBe(descriptor.descriptorDigest);
    expect(s.method(item.descriptorCursor)).toBe(method.startsWith("mcp.") ? "mcp.describePage" : "tools.describePage");
    expect(reconstruct(s, item.descriptorCursor)).toEqual(descriptor);
    expect(reconstruct(s, item.descriptorCursor, 65536)).toEqual(descriptor);
  });
  it.each(["tools.describePage", "mcp.describePage"] as const)("publishes initial %s cursor without paging", method => {
    const s = new CatalogSnapshotStore(binding), value = { x: [null, false, 2, { a: "b" }] };
    const c = publish(s, [value], method);
    expect(s.method(c)).toBe(method); expect(reconstruct(s, c)).toEqual(value);
    code(() => s.catalogPage(c), "catalog_cursor_unavailable");
    code(() => publish(s, [], method), "catalog_quota_exceeded");
  });
  it("authenticates method, position, binding, query and store lifetime", () => {
    const s = new CatalogSnapshotStore(binding), c = s.reserve().publish("tools.searchPage", [{ a: 1 }], "query");
    expect(s.method(c)).toBe("tools.searchPage");
    code(() => s.describePage(c), "catalog_cursor_unavailable");
    const [body, sig] = c.split("."); const data = JSON.parse(Buffer.from(body!, "base64url").toString());
    for (const index of [0, 1, 2, 3, 4, 5]) {
      const changed = [...data]; changed[index] = index === 1 ? "other" : 77;
      code(() => s.method(Buffer.from(JSON.stringify(changed)).toString("base64url") + "." + sig), "catalog_cursor_unavailable");
    }
    for (const bad of ["", c + "a", "x".repeat(500), c.slice(0, -1) + (c.endsWith("a") ? "b" : "a")]) code(() => s.method(bad), "catalog_cursor_unavailable");
    code(() => new CatalogSnapshotStore(binding).method(c), "catalog_cursor_unavailable");
    code(() => new CatalogSnapshotStore({ ...binding, authorizationEpoch: "b" }).method(c), "catalog_cursor_unavailable");
    s.invalidate(); code(() => s.method(c), "catalog_cursor_unavailable");
  });
  it("renews soft-expired retained authority but enforces idle and absolute expiry", () => {
    let now = 0; const s = new CatalogSnapshotStore(binding, { now: () => now, softExpiryMs: 10, idleMs: 30, absoluteMs: 100 });
    const c = publish(s, [1, 2]); now = 11;
    const next = s.catalogPage(c, { limit: 1 }).nextCursor!;
    expect(s.catalogPage(next).items).toEqual([{ descriptor: 2 }]);
    for (now = 20; now < 100; now += 20) expect(s.method(c)).toBe("tools.listPage");
    code(() => s.method(c), "catalog_cursor_unavailable");
    const idle = publish(s, []); now += 30; code(() => s.method(idle), "catalog_cursor_unavailable");
  });
  it("reserves honestly before dispatch, releases idempotently and invalidates outstanding reservations", () => {
    const s = new CatalogSnapshotStore(binding, { maxSnapshots: 1 }); const r = s.reserve();
    code(() => s.reserve(), "catalog_quota_exceeded"); r.release(); r.release();
    code(() => r.publish("tools.listPage", []), "catalog_cursor_unavailable");
    const next = s.reserve(); s.invalidate(); code(() => next.publish("tools.listPage", []), "catalog_cursor_unavailable");
    code(() => publish(s, []), "catalog_cursor_unavailable");
  });
  it("evicts least recently used snapshots and not pending reservations", () => {
    let now = 0; const s = new CatalogSnapshotStore(binding, { maxSnapshots: 2, now: () => now });
    const a = publish(s, []); now++; const b = publish(s, []); now++; s.method(a); now++;
    publish(s, []); expect(s.method(a)).toBe("tools.listPage"); code(() => s.method(b), "catalog_cursor_unavailable");
  });
  it("enforces byte and node reservations atomically", () => {
    const s = new CatalogSnapshotStore(binding, { reservationBytes: 2000, reservationNodes: 20 });
    code(() => publish(s, [{ text: "x".repeat(1000) }]), "catalog_quota_exceeded");
    code(() => publish(s, Array(21).fill(0)), "catalog_quota_exceeded");
    expect(s.catalogPage(publish(s, [1])).items).toEqual([{ descriptor: 1 }]);
    const bytes = new CatalogSnapshotStore(binding, { maxBytes: 2000, reservationBytes: 1500 }); bytes.reserve(); code(() => bytes.reserve(), "catalog_quota_exceeded");
    const nodes = new CatalogSnapshotStore(binding, { maxNodes: 30, reservationNodes: 20 }); nodes.reserve(); code(() => nodes.reserve(), "catalog_quota_exceeded");
  });
  it("rejects invalid raw graphs without invoking proxies or accessors", () => {
    const s = new CatalogSnapshotStore(binding); let touched = 0;
    const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { touched++; return 1; } });
    const array = Object.defineProperty([1], "0", { get() { touched++; return 1; } });
    const proxy = new Proxy({}, { ownKeys() { touched++; return []; } });
    const cyclic: Record<string, unknown> = {}; cyclic.x = cyclic; const shared = {};
    let deep: unknown = {}; for (let i = 0; i < 64; i++) deep = { deep };
    for (const bad of [accessor, array, proxy, cyclic, { a: shared, b: shared }, deep, NaN, undefined, 1n, new Date(), Array(2)]) code(() => publish(s, [bad]), "catalog_quota_exceeded");
    expect(touched).toBe(0);
  });
  it("chunks valid depth-boundary descriptors when the inline wrapper exceeds JSON depth", () => {
    let descriptor: unknown = { value: "yes" }; for (let i = 0; i < 63; i++) descriptor = { child: descriptor };
    const s = new CatalogSnapshotStore(binding), page = s.catalogPage(publish(s, [descriptor]));
    const item = page.items[0]!; expect("descriptorCursor" in item).toBe(true);
    if ("descriptorCursor" in item) expect(reconstruct(s, item.descriptorCursor)).toEqual(descriptor);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 101])("rejects invalid limit %s", limit => {
    const s = new CatalogSnapshotStore(binding); code(() => s.catalogPage(publish(s, [1]), { limit }), "catalog_page_budget");
  });
  it.each([0, 999, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid envelope budget %s", maxBytes => {
    const s = new CatalogSnapshotStore(binding); const c = publish(s, [1]);
    code(() => s.catalogPage(c, { maxBytes }), "catalog_page_budget");
    code(() => s.catalogPage(c, {}, maxBytes), "catalog_page_budget");
    code(() => s.describePage(publish(s, [1], "tools.describePage"), { maxBytes }), "catalog_page_budget");
  });
  it("freezes snapshot semantics and falls back to semantic digests", () => {
    const s = new CatalogSnapshotStore(binding), value = { a: "before", descriptorDigest: "invalid" }; const c = publish(s, [value], "tools.describePage"); value.a = "after";
    expect(reconstruct(s, c)).toEqual({ a: "before", descriptorDigest: "invalid" });
    expect(s.describePage(c).descriptorDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
