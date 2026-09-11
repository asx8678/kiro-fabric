import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { FabricCompilerPool } from "../src/runtime/type-checker.js";

const fixture = (timeoutMs = 5_000) => {
  const registry = new ActionRegistry();
  const descriptor = {
    name: "read", description: "cache integration fixture", risk: "read" as const, effect: { kind: "read" as const },
    inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
  };
  const invoke = vi.fn(async (_name: string, args: Record<string, unknown>) => args.value);
  registry.register({ name: "fixture", description: "cache integration", async list() { return [descriptor]; }, async describe() { return descriptor; }, invoke });
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs, maxConcurrentExecutions: 1, maxSourceBytes: 1_024, maxInputBytes: 1_024 } }), "/workspace");
  const approver = { async approve() { throw new Error("unexpected prompt"); }, prepareApproval: vi.fn(() => ({ decision: "allow" as const })) };
  const dispatch = vi.spyOn(Worker.prototype, "postMessage");
  return { service, invoke, approver, dispatch };
};
const code = `const globals = globalThis as unknown as JsonObject;
globals.invocations = Number(globals.invocations ?? 0) + 1;
return { invocations: globals.invocations, value: await tools.call({ ref: "fixture.read", args: { value: payloads.value } }) };`;

describe("cached compilation with real code-mode executions", () => {
  it("reuses compilation but runs fresh payloads, policy, provider calls and guest contexts", async () => {
    const { service, invoke, approver, dispatch } = fixture();
    try {
      for (const value of ["first", "second", "third"]) {
        const result = await service.execute({ code, payloads: { value }, approver });
        expect(result.success, result.error).toBe(true);
        expect(result.value).toEqual({ invocations: 1, value });
        expect(result.audits).toHaveLength(1);
        expect(result.audits[0]).toMatchObject({ ref: "fixture.read", success: true });
      }
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledTimes(3);
      expect(approver.prepareApproval).toHaveBeenCalledTimes(3);
      const denied = await service.execute({ code, payloads: { value: "denied" }, approver: { async approve() { throw new Error("new policy denial"); } } });
      expect(denied.success).toBe(false); expect(denied.error).toContain("new policy denial");
      expect(invoke).toHaveBeenCalledTimes(3); expect(dispatch).toHaveBeenCalledTimes(1);
    } finally { await service.close(); }
  });

  it("still checks payload/source limits and cancellation before cached work", async () => {
    const { service, invoke, approver, dispatch } = fixture();
    try {
      expect((await service.execute({ code, payloads: { value: "warm" }, approver })).success).toBe(true);
      const oversized = await service.execute({ code, payloads: { value: "x".repeat(1_025) }, approver });
      expect(oversized.error).toContain("payloads exceed");
      const largeSource = await service.execute({ code: code + "\n//" + "x".repeat(1_025), approver });
      expect(largeSource.error).toContain("source exceeds");
      const controller = new AbortController(); controller.abort();
      const cancelled = await service.execute({ code, payloads: { value: "cancelled" }, approver, signal: controller.signal });
      expect(cancelled.status).toBe("aborted");
      expect(dispatch).toHaveBeenCalledTimes(1); expect(invoke).toHaveBeenCalledTimes(1);
    } finally { await service.close(); }
  });

  it("does not let cache hits bypass execution admission", async () => {
    const { service, invoke, approver, dispatch } = fixture();
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    try {
      expect((await service.execute({ code, payloads: { value: "warm" }, approver })).success).toBe(true);
      invoke.mockImplementationOnce(async (_name, args) => { entered(); await gate; return args.value; });
      const active = service.execute({ code, payloads: { value: "active" }, approver });
      await Promise.race([waiting, active.then(result => { throw new Error(`execution ended early: ${result.error}`); })]);
      const excess = await service.execute({ code, payloads: { value: "excess" }, approver });
      expect(excess.error).toContain("concurrency limit");
      release(); expect((await active).success).toBe(true);
      expect(dispatch).toHaveBeenCalledTimes(1); expect(invoke).toHaveBeenCalledTimes(2);
    } finally { release(); await service.close(); }
  });

  it("enforces guest deadlines even when no compilation work is needed", async () => {
    const { service, approver, dispatch } = fixture(100);
    const source = 'if (payloads.spin === "yes") { while (true) {} } return "ok";';
    try {
      expect((await service.execute({ code: source, timeoutMs: 5_000, approver })).value).toBe("ok");
      const timeout = await service.execute({ code: source, payloads: { spin: "yes" }, timeoutMs: 100, approver });
      expect(timeout.status).toBe("timed_out");
      expect((await service.execute({ code: source, approver })).value).toBe("ok");
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally { await service.close(); }
  });

  it("validates changed declarations and source with the real compiler", async () => {
    const owner = new FabricCompilerPool();
    const dispatch = vi.spyOn(Worker.prototype, "postMessage");
    const input = { code: "return token;", declarations: "type JsonValue = string; declare const token: string;" };
    try {
      const first = await owner.check(input);
      expect(first.errors).toEqual([]); expect(first.javascript).toBeDefined();
      expect(await owner.check(input)).toEqual(first);
      const changedType = await owner.check({ ...input, declarations: "type JsonValue = string; declare const token: number;" });
      expect(changedType.errors.length).toBeGreaterThan(0); expect(changedType.javascript).toBeUndefined();
      const changedSource = await owner.check({ ...input, code: "return missingName;" });
      expect(changedSource.errors.length).toBeGreaterThan(0); expect(changedSource.javascript).toBeUndefined();
      expect(dispatch).toHaveBeenCalledTimes(3);
    } finally { await owner.close(); }
  });
});
