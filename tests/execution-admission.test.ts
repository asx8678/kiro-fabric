import { describe, expect, it } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import type { FabricTracer } from "../src/trace/tracer.js";

describe("execution admission across the real compiler and guest", () => {
  it("traces explicit result value characters while preserving legacy resultChars", async () => {
    const events: Array<{ ev: string; data?: Record<string, unknown> }> = [];
    const tracer: FabricTracer = {
      enabled: true, file: undefined, newExecutionId: () => "exec_test",
      span: () => ({ id: "span", end() {} }),
      event(_cat, ev, _execId, data) { events.push({ ev, ...(data ? { data } : {}) }); },
      flush() {}, close() {},
    };
    const service = new FabricExecutionService(new ActionRegistry(), normalizeFabricConfig({ executor: { timeoutMs: 5_000, maxConcurrentExecutions: 1, maxSourceBytes: 100 } }), "/workspace");
    const approve = { async approve() {} };
    try {
      await service.execute({ code: "return '漢😀'", approver: approve, tracer, execId: "success" });
      await service.execute({ code: "return null", approver: approve, tracer, execId: "null" });
      await service.execute({ code: "x".repeat(101), approver: approve, tracer, execId: "source" });
      const ends = events.filter(({ ev }) => ev === "exec.end").map(({ data }) => data!);
      expect(ends[0]).toMatchObject({ status: "succeeded", resultChars: 5, resultValueChars: 5 });
      expect(ends[1]).toMatchObject({ status: "succeeded", resultChars: 4, resultValueChars: 4 });
      expect(ends[2]).toMatchObject({ status: "failed", resultChars: 0, resultValueChars: null });

      const busy = service.execute({ code: "while (true) {}", timeoutMs: 100, approver: approve });
      const rejected = await service.execute({ code: "return 2", approver: approve, tracer, execId: "admission" });
      expect(rejected.success).toBe(false);
      expect(events.filter(({ ev }) => ev === "exec.end").at(-1)?.data).toMatchObject({ resultChars: 0, resultValueChars: null });
      await busy;
    } finally { await service.close(); }
  });
  it.each(["provider", "approval"] as const)("cancels and drains an active %s before registry teardown", async (phase) => {
    let entered!: () => void; const waiting = new Promise<void>((resolve) => { entered = resolve; });
    let settled = false; let providerClosed = false;
    const hold = (signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      entered();
      const abort = () => { settled = true; reject(new Error("cancelled close fixture")); };
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    });
    const registry = new ActionRegistry();
    registry.register({
      name: "fixture", description: "close fixture",
      async list() { return [{ name: "wait", description: "wait", inputSchema: { type: "object" }, risk: "read", effect: { kind: "read" } }]; },
      async describe() { return (await this.list())[0]; },
      async invoke(_action, _args, context) { return hold(context.signal); },
      async close() { expect(settled).toBe(true); providerClosed = true; },
    });
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 5_000, maxConcurrentExecutions: 1 } }), "/workspace");
    const active = service.execute({ code: "return await tools.call({ ref: 'fixture.wait', args: {} })", approver: { async approve(_action, _args, signal) { if (phase === "approval") await hold(signal); } } });
    try {
      await Promise.race([waiting, active.then((result) => { throw new Error(`Execution ended before fixture entry: ${JSON.stringify(result)}`); })]);
      const closing = service.close(); expect(service.close()).toBe(closing);
      await closing; expect(providerClosed).toBe(true);
      expect((await active).status).toBe("aborted");
      expect((await service.execute({ code: "return true", approver: { async approve() {} } })).error).toContain("service is closed");
    } finally { await service.close(); }
  });

  it.each(["cancel", "timeout", "provider-error", "approval-error"] as const)("releases guest admission after %s", async (mode) => {
    let entered!: () => void; const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const registry = new ActionRegistry();
    registry.register({
      name: "fixture", description: "termination fixture",
      async list() { return [{ name: "wait", description: "wait", inputSchema: { type: "object" }, risk: "read", effect: { kind: "read" } }]; },
      async describe() { return (await this.list())[0]; },
      async invoke(_action, _args, context) {
        entered();
        if (mode === "provider-error") throw new Error("benign provider failure");
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new Error("fixture cancelled"));
          if (context.signal?.aborted) abort(); else context.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    });
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 500, maxConcurrentExecutions: 1 } }), "/workspace");
    const controller = new AbortController();
    const approve = async () => { if (mode === "approval-error") { entered(); throw new Error("benign approval failure"); } };
    // Warm compilation outside the short guest deadline case.
    await service.execute({ code: "return true", timeoutMs: 5_000, approver: { async approve() {} } });
    const active = service.execute({ code: "return await tools.call({ ref: 'fixture.wait', args: {} })", signal: controller.signal, approver: { approve } });
    try {
      await Promise.race([waiting, active.then((result) => { if (result.success) throw new Error("fixture unexpectedly succeeded"); })]);
      if (mode === "cancel") controller.abort();
      const result = await active;
      expect(result.status).toBe(mode === "cancel" ? "aborted" : mode === "timeout" ? "timed_out" : "failed");
      expect((await service.execute({ code: "return 42", timeoutMs: 5_000, approver: { async approve() {} } })).value).toBe(42);
    } finally { controller.abort(); await active; await service.close(); }
  });

  it("holds capacity until a provider call settles, then admits another execution", async () => {
    let release!: () => void; let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const registry = new ActionRegistry();
    registry.register({
      name: "fixture", description: "local gate",
      async list() { return [{ name: "wait", description: "wait", inputSchema: { type: "object" }, risk: "read", effect: { kind: "read" } }]; },
      async describe() { return (await this.list())[0]; },
      async invoke() { entered(); await gate; return true; },
    });
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 5_000, maxConcurrentExecutions: 1 } }), "/workspace");
    const approver = { async approve() {} };
    const active = service.execute({ code: "return await tools.call({ ref: 'fixture.wait', args: {} })", approver });
    try {
      await Promise.race([waiting, active.then((result) => { throw new Error(`Execution ended before fixture entry: ${JSON.stringify(result)}`); })]);
      const excess = await service.execute({ code: "return 2", approver });
      expect(excess.error).toContain("concurrency limit");
      release(); expect((await active).value).toBe(true);
      expect((await service.execute({ code: "return 42", approver })).value).toBe(42);
    } finally { release(); await active; await service.close(); }
  });
});
