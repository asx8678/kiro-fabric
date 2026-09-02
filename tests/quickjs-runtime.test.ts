import { describe, expect, it } from "vitest";
import { QuickJsRuntime } from "../src/runtime/quickjs-runtime.js";

const defaults = { timeoutMs: 500, maxTimeoutMs: 1_000, memoryLimitBytes: 32 * 1024 * 1024, maxSourceBytes: 64 * 1024, maxLogChars: 1_000 };

describe("QuickJS-only guest runtime", () => {
  it("exposes payloads and no host process or module loader", async () => {
    const result = await new QuickJsRuntime().execute(
      "return { value: payloads.value, processType: typeof (globalThis as any).process, requireType: typeof (globalThis as any).require }",
      async () => { throw new Error("unexpected host call"); },
      { ...defaults, payloads: { value: "ok" } },
    );
    expect(result.terminationReason).toBe("completed");
    expect(result.value).toEqual({ value: "ok", processType: "undefined", requireType: "undefined" });
  });

  it("returns a controlled timeout", async () => {
    const result = await new QuickJsRuntime().execute("while (true) {}", async () => null, { ...defaults, timeoutMs: 20, maxTimeoutMs: 20 });
    expect(result.terminationReason).toBe("timed_out");
    expect(result.error).toContain("timed out");
  });

  it("times out a guest-owned promise that can never settle", async () => {
    const result = await new QuickJsRuntime().execute(
      "return await new Promise(() => undefined)",
      async () => { throw new Error("unexpected host call"); },
      { ...defaults, timeoutMs: 20 },
    );
    expect(result.terminationReason).toBe("timed_out");
    expect(result.error).toContain("timed out");
  });

  it("aborts outstanding host calls and does not wait for their natural completion", async () => {
    let hostAborted = false;
    const controller = new AbortController();
    const execution = new QuickJsRuntime().execute(
      "return await tools.call({ ref: 'test.wait', args: {} })",
      async (_ref, _args, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { hostAborted = true; reject(signal.reason); }, { once: true });
      }),
      { ...defaults, signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error("cancelled")), 20);
    const result = await execution;
    expect(result.terminationReason).toBe("aborted");
    expect(hostAborted).toBe(true);
  });

  it("turns invalid or oversized host results into controlled guest errors", async () => {
    const oversized = await new QuickJsRuntime().execute(
      "return await tools.call({ ref: 'test.large', args: {} })",
      async () => ({ value: "x".repeat(100) }),
      { ...defaults, maxNestedResultChars: 20 },
    );
    expect(oversized.terminationReason).toBe("runtime_error");
    expect(oversized.error).toContain("bounded JSON contract");

    const nonFinite = await new QuickJsRuntime().execute(
      "return await tools.call({ ref: 'test.nan', args: {} })",
      async () => Number.NaN,
      defaults,
    );
    expect(nonFinite.terminationReason).toBe("runtime_error");
    expect(nonFinite.error).toContain("non-finite number");
  });

  it("keeps source and payload limits independent", async () => {
    const result = await new QuickJsRuntime().execute(
      "return payloads.value.length",
      async () => null,
      { ...defaults, maxSourceBytes: 1_024, maxInputBytes: 4_096, payloads: { value: "x".repeat(2_000) } },
    );
    expect(result.terminationReason).toBe("completed");
    expect(result.value).toBe(2_000);
  });

  it("bounds source, payload, and log output", async () => {
    const source = await new QuickJsRuntime().execute("x".repeat(2_000), async () => null, { ...defaults, maxSourceBytes: 1_024 });
    expect(source.terminationReason).toBe("runtime_error");
    const payload = await new QuickJsRuntime().execute("return 1", async () => null, { ...defaults, maxSourceBytes: 1_024, payloads: { value: "x".repeat(2_000) } });
    expect(payload.terminationReason).toBe("runtime_error");
    const logs = await new QuickJsRuntime().execute("print('x'.repeat(100)); return true", async () => null, { ...defaults, maxLogChars: 10 });
    expect(logs.logs.join("").length).toBeLessThanOrEqual(10);
  });
});
