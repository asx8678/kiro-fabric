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

  it("disables direct, indirect, computed, and constructor-chain code generation", async () => {
    const probes = [
      "return eval(payloads.program)",
      "const indirect = eval; return indirect(payloads.program)",
      `return (globalThis as any)["ev" + "al"](payloads.program)`,
      "return Function(payloads.program)()",
      "return ((() => {}) as any).constructor(payloads.program)()",
      "return (Object.getPrototypeOf(() => {}) as any).constructor(payloads.program)()",
      "return (Object.getPrototypeOf(function* () {}) as any).constructor(payloads.program)().next().value",
      "return await (Object.getPrototypeOf(async function () {}) as any).constructor(payloads.program)()",
      "return await (Object.getPrototypeOf(async function* () {}) as any).constructor(payloads.program)().next()",
      `return ((() => {}) as any)["con" + "structor"](payloads.program)()`,
    ];
    let calls = 0;
    for (const code of probes) {
      const result = await new QuickJsRuntime().execute(code, async () => { calls += 1; return null; }, {
        ...defaults,
        payloads: { program: "return 42" },
      });
      expect(result.terminationReason, code).toBe("runtime_error");
      expect(result.error, code).toContain("Dynamic code generation is disabled");
    }
    expect(calls).toBe(0);
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

  it("reports timeout after synchronous host work starves the deadline timer", async () => {
    const result = await new QuickJsRuntime().execute(
      "return await tools.call({ ref: 'test.blocking', args: {} })",
      async () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); return "committed"; },
      { ...defaults, timeoutMs: 10, maxTimeoutMs: 10 },
    );
    expect(result.terminationReason).toBe("timed_out");
    expect(result.value).toBeUndefined();
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

  it("returns cancellation without waiting for a non-cooperative raw provider", async () => {
    const controller = new AbortController();
    let mutationAt = 0;
    const startedAt = Date.now();
    const execution = new QuickJsRuntime().execute(
      "return await tools.call({ ref: 'test.noncooperative', args: {} })",
      async () => new Promise((resolve) => setTimeout(() => { mutationAt = Date.now(); resolve(true); }, 200)),
      { ...defaults, signal: controller.signal, cleanupGraceMs: 10 },
    );
    setTimeout(() => controller.abort(new Error("cancelled")), 5);
    const result = await execution;
    expect(result.terminationReason).toBe("aborted");
    expect(Date.now() - startedAt).toBeLessThan(150);
    expect(mutationAt).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(mutationAt).toBeGreaterThan(0);
  });

  it("survives 1000 repeated cancellation and timeout settlements", { timeout: 60_000 }, async () => {
    const runtime = new QuickJsRuntime();
    const before = process.memoryUsage().heapUsed;
    for (let index = 0; index < 1_000; index++) {
      const result = index % 2 === 0
        ? await runtime.execute("return await new Promise(() => undefined)", async () => null, { ...defaults, timeoutMs: 1, maxTimeoutMs: 1 })
        : await (() => { const controller = new AbortController(); controller.abort(new Error("cancelled")); return runtime.execute("return true", async () => null, { ...defaults, signal: controller.signal }); })();
      expect(["timed_out", "aborted"]).toContain(result.terminationReason);
    }
    (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
    const growth = process.memoryUsage().heapUsed - before;
    expect(growth).toBeLessThan(128 * 1024 * 1024);
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

  it("keeps run handles and strict JSON primordials private from guest tampering", async () => {
    const result = await new QuickJsRuntime().execute(
      `
      (globalThis as any).__fabricRun = () => 'forged';
      (globalThis as any).__fabricCancelExecution = () => undefined;
      JSON.stringify = (() => '\"forged\"') as any;
      Number.isFinite = (() => true) as any;
      Object.getOwnPropertyDescriptors = (() => ({})) as any;
      return { safe: true };
      `,
      async () => null,
      defaults,
    );
    expect(result).toMatchObject({ terminationReason: "completed", value: { safe: true } });
  });

  it("rejects unsupported guest results before host dumping without coercion", async () => {
    const probes = [
      "return (() => undefined) as any",
      "return Symbol('x') as any",
      "return 1n as any",
      "const value: any = {}; value.self = value; return value",
      "return new Map([['a', 1]]) as any",
      "return new Set([1]) as any",
      "return Number.NaN as any",
      "const value: any = {}; Object.defineProperty(value, 'x', { get() { return 1 } }); return value",
      "const value: any[] = []; value[1] = 1; return value as any",
    ];
    for (const code of probes) {
      const result = await new QuickJsRuntime().execute(code, async () => null, defaults);
      expect(result.terminationReason, code).toBe("runtime_error");
      expect(result.error, code).toMatch(/Result contains|strict JSON/u);
    }
    const valid = await new QuickJsRuntime().execute(
      "return { nested: [null, true, 2.5, 'ok'], empty: {} }",
      async () => null,
      defaults,
    );
    expect(valid).toMatchObject({ terminationReason: "completed", value: { nested: [null, true, 2.5, "ok"], empty: {} } });
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

  it("provides ordered fan-out bounded by the configured host-call concurrency", async () => {
    let active = 0;
    let maximum = 0;
    const result = await new QuickJsRuntime().execute(
      `return await parallel([0, 1], async (group) =>
        await parallel([3, 1, 2], async (value, index) =>
          await tools.call({ ref: 'test.wait', args: { value, index: group * 3 + index } }),
          { concurrency: 99 }),
        { concurrency: 99 })`,
      async (_ref, args) => {
        const nested = args.args as Record<string, unknown>;
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, Number(nested.value) + 5));
        active -= 1;
        return nested.index;
      },
      { ...defaults, maxConcurrentHostCalls: 2 },
    );
    expect(result).toMatchObject({ terminationReason: "completed", value: [[0, 1, 2], [3, 4, 5]] });
    expect(maximum).toBe(2);
  });

  it("queues direct Promise.all bridge fan-out behind the execution-wide host-call cap", async () => {
    let active = 0;
    let maximum = 0;
    const result = await new QuickJsRuntime().execute(
      "return await Promise.all([0, 1, 2, 3].map((index) => tools.call({ ref: 'test.wait', args: { index } })))",
      async (_ref, args) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return (args.args as Record<string, unknown>).index;
      },
      { ...defaults, maxConcurrentHostCalls: 2 },
    );
    expect(result).toMatchObject({ terminationReason: "completed", value: [0, 1, 2, 3] });
    expect(maximum).toBe(2);
  });

  it("snapshots exact call arguments before a saturated host-call queue", async () => {
    const result = await new QuickJsRuntime().execute(
      `
      const first = tools.call({ ref: "test.wait", args: { index: 0 } });
      const mutable = { index: 1 };
      const second = tools.call({ ref: "test.wait", args: mutable });
      mutable.index = 99;
      return await Promise.all([first, second]);
      `,
      async (_ref, args) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return (args.args as Record<string, unknown>).index;
      },
      { ...defaults, maxConcurrentHostCalls: 1 },
    );
    expect(result).toMatchObject({ terminationReason: "completed", value: [0, 1] });
  });

  it("extends an exact queued action deadline before waiting for a host-call slot", async () => {
    const result = await new QuickJsRuntime().execute(
      `return await Promise.all([
        tools.providers(),
        tools.call({ ref: "mcp.$call", args: {} }),
      ])`,
      async (ref) => {
        if (ref === "fabric.providers") await new Promise((resolve) => setTimeout(resolve, 40));
        return ref;
      },
      {
        ...defaults,
        timeoutMs: 20,
        maxTimeoutMs: 300,
        maxConcurrentHostCalls: 1,
        minimumTimeoutMsForHostCall: (ref, args) =>
          ref === "fabric.call" && args.ref === "mcp.$call" ? 200 : undefined,
      },
    );
    expect(result).toMatchObject({
      terminationReason: "completed",
      effectiveTimeoutMs: 200,
      value: ["fabric.providers", "fabric.call"],
    });
  });

  it("fails closed on malformed bounded parallel requests", async () => {
    const result = await new QuickJsRuntime().execute(
      "return await parallel([async () => 1], { concurrency: 0 })",
      async () => null,
      { ...defaults, maxConcurrentHostCalls: 2 },
    );
    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("positive finite number");
  });

  it("keeps bounded parallel scheduling independent of guest-mutated primordials", async () => {
    const result = await new QuickJsRuntime().execute(
      `
      Promise.all = (() => { throw new Error("forged Promise.all"); }) as any;
      Math.min = (() => 99) as any;
      Reflect.apply = (() => { throw new Error("forged Reflect.apply"); }) as any;
      (globalThis as any).Array = function () { throw new Error("forged Array"); };
      return await parallel([1, 2, 3], async (value) => value * 2, 99);
      `,
      async () => null,
      { ...defaults, maxConcurrentHostCalls: 2 },
    );
    expect(result).toMatchObject({ terminationReason: "completed", value: [2, 4, 6] });
  });

  it("stops dequeuing bounded parallel work after the first failure", async () => {
    const started: number[] = [];
    const result = await new QuickJsRuntime().execute(
      "return await parallel([0, 1, 2, 3], async (index) => tools.call({ ref: 'test.step', args: { index } }), 2)",
      async (_ref, args) => {
        const index = Number((args.args as Record<string, unknown>).index);
        started.push(index);
        if (index === 0) throw new Error("first failed");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return index;
      },
      { ...defaults, maxConcurrentHostCalls: 2 },
    );
    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("first failed");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(started.sort()).toEqual([0, 1]);
  });
});
