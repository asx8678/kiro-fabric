import { describe, expect, it } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";

describe("execution admission across the real compiler and guest", () => {
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
