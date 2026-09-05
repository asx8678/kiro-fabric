import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { normalizeFabricConfig } from "../src/config.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { FabricCompilerPool } from "../src/runtime/type-checker.js";

const workers = vi.hoisted(() => [] as Array<{
  terminated: number;
  terminationGate?: Promise<void>;
  reply(): void;
  fail(): void;
}>);
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { Worker: class extends EventEmitter {
    terminated = 0;
    terminationGate?: Promise<void>;
    request: { id: number } | undefined;
    constructor() { super(); workers.push(this); }
    unref() {}
    postMessage(request: { id: number }) { this.request = request; }
    reply() { this.emit("message", { id: this.request!.id, ok: true, result: { errors: [{ line: 1, column: 1, message: "fixture diagnostic" }] } }); }
    fail() { this.emit("error", new Error("fixture worker error")); }
    async terminate() { this.terminated += 1; await this.terminationGate; this.emit("exit", 0); return 0; }
  } };
});
const owners: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(owners.splice(0).map((owner) => owner.close())); workers.length = 0; vi.useRealTimers(); });
const request = { code: "return true", declarations: "" };
const options = { code: "return true", approver: { async approve() {} } };
const service = (limit = 4) => {
  const owner = new FabricExecutionService(new ActionRegistry(), normalizeFabricConfig({ executor: { maxConcurrentExecutions: limit } }), "/workspace");
  owners.push(owner); return owner;
};
const pool = (limit = 4) => { const owner = new FabricCompilerPool(limit); owners.push(owner); return owner; };

describe("compiler ownership and bounded admission", () => {
  it("does not interrupt B's reused active compiler when A closes", async () => {
    const a = service(); const b = service();
    const warm = b.execute(options); await Promise.resolve(); workers[0]!.reply(); await warm;
    const active = b.execute(options);
    expect(workers).toHaveLength(1);
    await a.close();
    expect(workers[0]!.terminated).toBe(0);
    workers[0]!.reply();
    expect((await active).typeErrors?.[0]?.message).toBe("fixture diagnostic");
    await b.close();
    expect(workers[0]!.terminated).toBe(1);
    expect((await b.execute(options)).error).toContain("service is closed");
  });

  it("tracks concurrent completions and drains idle plus active workers once", async () => {
    const owner = pool();
    const first = owner.check(request); const second = owner.check(request);
    workers[0]!.reply(); workers[1]!.reply();
    await Promise.all([first, second]);
    expect(workers.map((worker) => worker.terminated)).toEqual([0, 1]);
    const active = owner.check(request);
    const rejection = expect(active).rejects.toThrow("pool is closed");
    const close = owner.close();
    expect(owner.close()).toBe(close);
    await Promise.all([close, rejection]);
    expect(workers.map((worker) => worker.terminated)).toEqual([1, 1]);
    await expect(owner.check(request)).rejects.toThrow("pool is closed");
  });

  it("waits for actual termination settlement before close resolves", async () => {
    const owner = pool(); const active = owner.check(request);
    let release!: () => void;
    workers[0]!.terminationGate = new Promise<void>((resolve) => { release = resolve; });
    const rejection = expect(active).rejects.toThrow("pool is closed");
    let closed = false; const closing = owner.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    release(); await Promise.all([closing, rejection]); expect(closed).toBe(true);
  });

  it("retires failed workers and workers reaching their use ceiling", async () => {
    const owner = pool(1);
    const failed = expect(owner.check(request)).rejects.toThrow("fixture worker error");
    workers[0]!.fail(); await failed;
    expect(workers[0]!.terminated).toBe(1);
    for (let use = 0; use < 250; use += 1) {
      const checked = owner.check(request); workers[1]!.reply(); await checked;
    }
    expect(workers).toHaveLength(2);
    expect(workers[1]!.terminated).toBe(1);
  });

  it("rejects excess compiler requests without spawning or queueing", async () => {
    const owner = pool(1);
    const active = owner.check(request);
    await expect(owner.check(request)).rejects.toThrow("concurrency limit");
    expect(workers).toHaveLength(1);
    workers[0]!.reply(); await active;
  });

  it("releases execution admission after compiler abort", async () => {
    const owner = service(1); const controller = new AbortController();
    const active = owner.execute({ ...options, signal: controller.signal });
    expect((await owner.execute(options)).error).toContain("concurrency limit");
    expect(workers).toHaveLength(1);
    controller.abort(new Error("cancelled fixture"));
    expect((await active).status).toBe("aborted");
    expect(workers[0]!.terminated).toBe(1);
    const next = owner.execute(options); await Promise.resolve(); workers[1]!.reply();
    expect((await next).typeErrors).toHaveLength(1);
  });

  it("terminates timed out workers before rejecting and recovers capacity", async () => {
    vi.useFakeTimers();
    const owner = pool(1);
    const failed = expect(owner.check(request, { timeoutMs: 10 })).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(11); await failed;
    expect(workers[0]!.terminated).toBe(1);
    const next = owner.check(request); workers[1]!.reply(); await next;
    await vi.advanceTimersByTimeAsync(30_001);
    expect(workers[1]!.terminated).toBe(1);
  });
});
