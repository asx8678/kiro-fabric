import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { normalizeFabricConfig } from "../src/config.js";
import type { FabricActionDescriptor } from "../src/protocol.js";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const collect = async () => { for (let i = 0; i < 4; i++) { await turn(); gc(); } await turn(); };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const heavy = (count: number): FabricActionDescriptor[] => Array.from({ length: count }, (_, i) => ({ name: `tool${i}`, description: Array.from({ length: 64 }, (_, k) => `token${k}`).join(" "), risk: "read", inputSchema: { type: "object" } }));

describe("discovery producer admission and detached subscriber reachability", () => {
  it("reserves raw capacity before launching32 large returned inventories", async () => {
    const registry = new ActionRegistry(); let started = 0;
    const samples: ReturnType<ActionRegistry["discoveryUsage"]>[] = [];
    for (let i = 0; i < 32; i++) registry.register({ name: `raw${i}`, description: "raw", list: async () => {
      started++; samples.push(registry.discoveryUsage());
      return Array.from({ length: 500 }, (_, j) => ({ name: `tool${j}`, description: Buffer.from(`${i}:${j}:` + "large_token ".repeat(1100)).toString("utf8"), risk: "read", inputSchema: { type: "object" } }));
    }, async describe() { return undefined; }, async invoke() {} });
    try {
      const first = registry.list(), second = registry.searchAll("large_token");
      expect(started).toBe(2); // Before any await: previously all32 were retained.
      const results = await Promise.allSettled([first, second]);
      for (const result of results) expect(result).toMatchObject({ status: "rejected", reason: { failure: { code: "catalog_quota_exceeded" } } });
      expect(started).toBeLessThan(32);
      expect(samples.every(sample => sample.bytes >= sample.rawReservationBytes && sample.rawActive <= 2)).toBe(true);
      await turn();
      expect(registry.discoveryUsage()).toMatchObject({ bytes: 0, nodes: 0, rawActive: 0, rawQueued: 0, subscribers: 0 });
      expect(registry.discoveryUsage().peakBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    } finally { await registry.close(); }
  });
  it("collects failed partial indexes before an unrelated held provider settles", async () => {
    const registry = new ActionRegistry(), gate = deferred();
    const refs: WeakRef<object>[] = [], native = globalThis.structuredClone;
    globalThis.structuredClone = value => {
      const result = native(value);
      if (result && typeof result === "object" && "inputSchema" in result) refs.push(new WeakRef(result.inputSchema as object));
      return result;
    };
    registry.register({ name: "held", description: "held", list: async () => { await gate.promise; return []; }, async describe() { return undefined; }, async invoke() {} });
    registry.register({ name: "heavy", description: "heavy", list: async () => heavy(2000), async describe() { return undefined; }, async invoke() {} });
    try {
      for (let i = 0; i < 16; i++) await registry.list().then(() => { throw new Error("expected rejection"); }, () => {});
      expect(refs.length).toBeGreaterThan(0); // Exercise partial constructed graphs, not raw-only rejection.
      await collect();
      expect(refs.filter(ref => ref.deref())).toHaveLength(0);
      expect(registry.discoveryUsage()).toMatchObject({ bytes: registry.discoveryUsage().rawReservationBytes + 1024, subscribers: 0, rawQueued: 0, inflight: 1 });
    } finally { globalThis.structuredClone = native; gate.resolve(); await collect(); await registry.close(); }
    expect(registry.discoveryUsage()).toMatchObject({ bytes: 0, nodes: 0, inflight: 0 });
  });
  it("detaches25000 canceled subscriptions instead of accumulating producer promise reactions", async () => {
    const registry = new ActionRegistry(), gate = deferred(); let calls = 0;
    registry.register({ name: "held", description: "held", list: async () => { calls++; await gate.promise; return []; }, async describe() { return undefined; }, async invoke() {} });
    await collect(); const baseline = process.memoryUsage().heapUsed;
    try {
      for (let i = 0; i < 25_000; i++) {
        const controller = new AbortController(), pending = registry.list(controller.signal).catch(() => {});
        controller.abort("cancelled"); await pending;
      }
      await collect();
      expect(calls).toBe(1);
      expect(registry.discoveryUsage()).toMatchObject({ bytes: registry.discoveryUsage().rawReservationBytes + 1024, subscribers: 0, rawQueued: 0, inflight: 1 });
      // Supplement deterministic subscriber accounting with the original V8
      // counterexample: formerly >70MiB remained behind this single producer.
      expect(process.memoryUsage().heapUsed - baseline).toBeLessThan(16 * 1024 * 1024);
    } finally { gate.resolve(); await collect(); await registry.close(); }
    expect(registry.discoveryUsage()).toMatchObject({ bytes: 0, inflight: 0 });
  }, 30_000);
  it("collects128 discarded revision indexes before their queued retries settle", async () => {
    const registry = new ActionRegistry(), held = deferred(), initialDone = deferred(), retryEntered = deferred();
    const refs: WeakRef<object>[] = [], native = globalThis.structuredClone;
    let initialCalls = 0, retryCalls = 0;
    globalThis.structuredClone = value => {
      const result = native(value);
      if (result && typeof result === "object" && "inputSchema" in result) refs.push(new WeakRef(result.inputSchema as object));
      return result;
    };
    for (let i = 0; i < 128; i++) {
      let revision = 0, calls = 0;
      registry.register({ name: `revision${i}`, description: "revision", discoveryRevision: () => String(revision), list: async () => {
        if (++calls > 1) { if (++retryCalls === 2) retryEntered.resolve(); await held.promise; return []; }
        revision++; if (++initialCalls === 128) initialDone.resolve();
        return heavy(280).map(action => ({ ...action, description: Array.from({ length: 64 }, (_, k) => `t${k}`).join(" ") }));
      }, async describe() { return undefined; }, async invoke() {} });
    }
    let failure: unknown;
    const controller = new AbortController(), pending = registry.list(controller.signal).catch(error => { failure = error; });
    try {
      await Promise.race([Promise.all([initialDone.promise, retryEntered.promise]), pending.then(() => { throw failure ?? new Error("Revision probe ended before its barriers"); })]);
      await collect();
      expect(refs).toHaveLength(128 * 280);
      expect(refs.filter(ref => ref.deref())).toHaveLength(0);
      expect(registry.discoveryUsage()).toMatchObject({ rawActive: 2, rawQueued: 126 });
      expect(registry.discoveryUsage().peakBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
      controller.abort("finished probe"); await pending; await collect();
      expect(registry.discoveryUsage()).toMatchObject({ rawQueued: 0, subscribers: 0 });
      expect(refs.filter(ref => ref.deref())).toHaveLength(0);
    } finally { globalThis.structuredClone = native; controller.abort("cleanup"); held.resolve(); await pending; await collect(); await registry.close(); }
    expect(registry.discoveryUsage()).toMatchObject({ bytes: 0, nodes: 0 });
  }, 30_000);
  it("surfaces trusted quota metadata through actual checked QuickJS", async () => {
    const registry = new ActionRegistry();
    registry.register({ name: "heavy", description: "heavy", list: async () => heavy(3000), async describe() { return undefined; }, async invoke() {} });
    const service = new FabricExecutionService(registry, normalizeFabricConfig({}), process.cwd());
    service.bindCatalog({ clientSession: "quota", workspace: process.cwd(), device: "1", inode: "1", authorizationEpoch: "1" });
    let approvals = 0;
    try {
      expect(await service.execute({ code: "return await tools.listPage({limit:1});", approver: { async approve() { approvals++; } } }))
        .toMatchObject({ success: false, failure: { code: "catalog_quota_exceeded", phase: "discovery", dispatchState: "not_dispatched", effectOutcome: "none" } });
      expect(approvals).toBe(0);
    } finally { await service.close(); }
  });
});
