import { describe, expect, it, vi } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { QuickJsRuntime } from "../src/runtime/quickjs-runtime.js";

// No subprocess effects or filesystem fixtures: only owned compiler/VM threads.
describe("CPU cancellation through service admission", () => {
  it.each(["finite", "infinite", "close"])("drains %s CPU work before returning capacity", { timeout: 40_000 }, async mode => {
    const registry = new ActionRegistry();
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    registry.register({
      name: "fixture", description: "CPU start gate",
      async list() { return [{ name: "ready", description: "ready", inputSchema: { type: "object" }, risk: "read", effect: { kind: "read" } }]; },
      async describe() { return (await this.list())[0]; },
      async invoke() { ready(); return null; },
    });
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 8_000, maxTimeoutMs: 8_000, maxConcurrentExecutions: 1 } }), "/workspace");
    const controller = new AbortController();
    const approver = { async approve() {} };
    try {
      const execution = service.execute({
        code: `await tools.call({ ref: 'fixture.ready', args: {} }); ${mode === "finite" ? "const end = Date.now() + 2000; while (Date.now() < end) {} return 'late';" : "while (true) {}"}`,
        signal: controller.signal, approver,
      });
      await Promise.race([started, execution.then(result => { throw new Error(`Guest did not start: ${JSON.stringify(result)}`); })]);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect((await service.execute({ code: "return 1", approver })).error).toContain("concurrency limit");
      const cancelledAt = performance.now();
      if (mode === "close") await service.close(); else controller.abort();
      const result = await execution;
      expect(result).toMatchObject({ status: "aborted", success: false, effectiveTimeoutMs: 8_000 });
      expect(result).not.toHaveProperty("value");
      expect(performance.now() - cancelledAt).toBeLessThan(1_500);
      if (mode !== "close") expect(await service.execute({ code: "return 42", approver })).toMatchObject({ status: "succeeded", value: 42 });
    } finally { controller.abort(); await service.close(); }
  });

  it("does not map a completed VM reply to success after cancellation", { timeout: 20_000 }, async () => {
    const controller = new AbortController();
    const execute = vi.spyOn(QuickJsRuntime.prototype, "execute").mockImplementation(async () => {
      controller.abort();
      return { value: "late value", logs: [], terminationReason: "completed", effectiveTimeoutMs: 8_000 };
    });
    const service = new FabricExecutionService(new ActionRegistry(), normalizeFabricConfig({ executor: { timeoutMs: 8_000 } }), "/workspace");
    try {
      const result = await service.execute({ code: "return 1", signal: controller.signal, approver: { async approve() {} } });
      expect(execute).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ status: "aborted", success: false, error: "Execution cancelled" });
      expect(result).not.toHaveProperty("value");
    } finally { execute.mockRestore(); await service.close(); }
  });
});
