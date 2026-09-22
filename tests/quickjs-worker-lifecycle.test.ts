import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { QuickJsRuntime, type FabricHostCall, type SandboxWorkerMessage, type SandboxWorkerRequest } from "../src/runtime/quickjs-runtime.js";

const workers = vi.hoisted(() => [] as Array<{
  messages: SandboxWorkerRequest[];
  emit(event: string, value: unknown): boolean;
  terminate: ReturnType<typeof vi.fn>;
}>);
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { Worker: class extends EventEmitter {
    messages: SandboxWorkerRequest[] = [];
    terminate = vi.fn(async () => 0);
    constructor() { super(); workers.push(this); }
    unref() {}
    postMessage(message: SandboxWorkerRequest) { this.messages.push(message); }
  } };
});

const defaults = { timeoutMs: 100, maxTimeoutMs: 4_000, memoryLimitBytes: 32 * 1024 * 1024, cleanupGraceMs: 50 };
const completed = { value: "done", logs: [], terminationReason: "completed" as const, effectiveTimeoutMs: 100 };
const current = () => workers.at(-1)!;
const run = () => [...current().messages].reverse().find(message => message.type === "run")!;
// Deliberately use transport-shaped data: these tests also run against the old,
// uncorrelated protocol to demonstrate that stale messages were accepted.
const send = (type: string, fields: Record<string, unknown> = {}, execution = run()) => {
  current().emit("message", { type, executionId: (execution as unknown as { executionId: string }).executionId, ...fields } as SandboxWorkerMessage);
};

beforeEach(() => {
  workers.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(performance, "now").mockImplementation(() => Date.now());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("sandbox worker lifecycle containment", () => {
  it("reschedules an extended watchdog from the fixed deadline, even before a host slot", async () => {
    const runtime = new QuickJsRuntime();
    const host = vi.fn(async () => true);
    const execution = runtime.execute("return 1", host, { ...defaults, minimumTimeoutMsForHostCall: () => 4_000 });
    send("prepare", { ref: "fabric.call", args: {} });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(current().terminate).not.toHaveBeenCalled();
    expect(host).not.toHaveBeenCalled();
    send("result", { result: { ...completed, effectiveTimeoutMs: 4_000 } });
    await expect(execution).resolves.toMatchObject({ terminationReason: "completed", effectiveTimeoutMs: 4_000 });
    await runtime.close();
  });

  it("caps repeated floors at the hard maximum without sliding the watchdog", async () => {
    const runtime = new QuickJsRuntime();
    const execution = runtime.execute("return 1", async () => true, { ...defaults, minimumTimeoutMsForHostCall: () => Number.MAX_SAFE_INTEGER });
    send("prepare", { ref: "fabric.call", args: {} });
    await vi.advanceTimersByTimeAsync(1_000);
    send("prepare", { ref: "fabric.call", args: {} });
    await vi.advanceTimersByTimeAsync(4_050);
    await expect(execution).resolves.toMatchObject({ terminationReason: "timed_out", effectiveTimeoutMs: 4_000 });
    expect(current().terminate).toHaveBeenCalled();
    await runtime.close();
  });

  it("classifies an unresponsive worker without bridge contact as timed out", async () => {
    const runtime = new QuickJsRuntime();
    const execution = runtime.execute("while (true) {}", async () => true, defaults);
    await vi.advanceTimersByTimeAsync(1_150);
    await expect(execution).resolves.toMatchObject({ terminationReason: "timed_out" });
    await runtime.close();
  });

  it("does not revive an expired deadline with a late floor", async () => {
    const runtime = new QuickJsRuntime();
    const execution = runtime.execute("return 1", async () => true, { ...defaults, minimumTimeoutMsForHostCall: (_ref, args) => args.late ? 4_000 : undefined });
    send("prepare", { ref: "fabric.call", args: {} });
    await vi.advanceTimersByTimeAsync(101);
    send("prepare", { ref: "fabric.call", args: { late: true } });
    await vi.advanceTimersByTimeAsync(1_049);
    await expect(execution).resolves.toMatchObject({ terminationReason: "timed_out", effectiveTimeoutMs: 100 });
    expect(current().messages.filter(message => message.type === "extend")).toMatchObject([{ floorMs: 100 }]);
    await runtime.close();
  });

  it("preserves cancellation classification at the no-contact backstop", async () => {
    const runtime = new QuickJsRuntime();
    const controller = new AbortController();
    const execution = runtime.execute("return 1", async () => true, { ...defaults, signal: controller.signal });
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_150);
    await expect(execution).resolves.toMatchObject({ terminationReason: "aborted" });
    expect(current().messages.filter(message => message.type === "abort")).toMatchObject([{ executionId: run().executionId }]);
    await runtime.close();
  });

  it("cancels independently of a long deadline and awaits owned termination, including close", async () => {
    const runtime = new QuickJsRuntime();
    const controller = new AbortController();
    let returned = false;
    const execution = runtime.execute("while (true) {}", async () => true, { ...defaults, timeoutMs: 60_000, maxTimeoutMs: 60_000, signal: controller.signal }).then(result => { returned = true; return result; });
    const owned = current();
    let terminated!: (code: number) => void;
    owned.terminate.mockImplementation(() => new Promise<number>(resolve => { terminated = resolve; }));
    controller.abort();
    expect(Atomics.load(new Int32Array(run().cancellationBuffer), 0)).toBe(1);
    await vi.advanceTimersByTimeAsync(1_049);
    expect(owned.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(owned.terminate).toHaveBeenCalledTimes(1);
    expect(returned).toBe(false);
    let closed = false;
    const closing = runtime.close().then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBe(false);
    terminated(1);
    await closing;
    await expect(execution).resolves.toMatchObject({ terminationReason: "aborted", effectiveTimeoutMs: 60_000, value: undefined });
    expect(owned.terminate).toHaveBeenCalledTimes(1);
  });

  it("fails closed if owned worker termination rejects", async () => {
    const runtime = new QuickJsRuntime();
    const controller = new AbortController();
    const execution = runtime.execute("return 1", async () => true, { ...defaults, signal: controller.signal });
    current().terminate.mockRejectedValue(new Error("termination failed"));
    controller.abort();
    send("result", { result: completed });
    await expect(execution).resolves.toMatchObject({ terminationReason: "runtime_error", error: "Virtual machine fault: termination failed", value: undefined });
    await expect(runtime.execute("return 2", async () => true, defaults)).resolves.toMatchObject({ terminationReason: "runtime_error", error: "Sandbox runtime is closed" });
    await expect(runtime.close()).rejects.toThrow("termination failed");
    expect(workers).toHaveLength(1);
    expect(current().terminate).toHaveBeenCalledTimes(1);
  });
  it("rejects late successful replies after abort and gives the next execution fresh cancellation state", async () => {
    const runtime = new QuickJsRuntime();
    const controller = new AbortController();
    const execution = runtime.execute("return 1", async () => true, { ...defaults, signal: controller.signal });
    const first = current();
    controller.abort();
    send("result", { result: completed });
    await expect(execution).resolves.toMatchObject({ terminationReason: "aborted", value: undefined });
    expect(first.terminate).toHaveBeenCalledTimes(1);
    const next = runtime.execute("return 2", async () => true, defaults);
    expect(current()).not.toBe(first);
    expect(Atomics.load(new Int32Array(run().cancellationBuffer), 0)).toBe(0);
    send("result", { result: { ...completed, value: 2 } });
    await expect(next).resolves.toMatchObject({ terminationReason: "completed", value: 2 });
    await runtime.close();
  });

  it("does not publish success if cancellation arrives while host cleanup drains", async () => {
    const runtime = new QuickJsRuntime();
    const controller = new AbortController();
    const execution = runtime.execute("return 1", async () => new Promise(() => {}), { ...defaults, signal: controller.signal });
    send("hostCall", { id: 1, ref: "fabric.call", args: {} });
    await vi.advanceTimersByTimeAsync(0);
    send("result", { result: completed });
    controller.abort();
    await vi.advanceTimersByTimeAsync(50);
    await expect(execution).resolves.toMatchObject({ terminationReason: "aborted", value: undefined });
    expect(current().terminate).toHaveBeenCalledTimes(1);
    await runtime.close();
  });
  it("does not dispatch a host call queued in a microtask after a worker fault", async () => {
    const runtime = new QuickJsRuntime();
    const host = vi.fn(async () => true);
    const execution = runtime.execute("return 1", host, defaults);
    send("hostCall", { id: 1, ref: "fabric.call", args: {} });
    current().emit("error", new Error("injected fault"));
    await vi.advanceTimersByTimeAsync(0);
    await expect(execution).resolves.toMatchObject({ terminationReason: "runtime_error" });
    expect(host).not.toHaveBeenCalled();
    expect(current().messages.some(message => message.type === "hostResult")).toBe(false);
    await runtime.close();
  });

  it.each(["error", "exit", "fatal", "backstop", "close"])("aborts and drains cooperative provider cleanup on %s", async (fault) => {
    const runtime = new QuickJsRuntime();
    let signal!: AbortSignal;
    let cleaned = false;
    let returned = false;
    const execution = runtime.execute("return 1", async (_ref, _args, hostSignal) => {
      signal = hostSignal;
      return new Promise(resolve => signal.addEventListener("abort", () => {
        setTimeout(() => { cleaned = true; resolve(true); }, 20);
      }, { once: true }));
    }, defaults).then(result => { returned = true; return result; });
    send("hostCall", { id: 1, ref: "fabric.call", args: {} });
    await vi.advanceTimersByTimeAsync(0);
    if (fault === "backstop") await vi.advanceTimersByTimeAsync(1_150);
    else if (fault === "fatal") send("fatal", { message: "injected fault" });
    else if (fault === "close") { await runtime.close(); current().emit("exit", 1); }
    else current().emit(fault, fault === "exit" ? 1 : new Error("injected fault"));
    expect(signal.aborted).toBe(true);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    await execution;
    expect(cleaned).toBe(true);
    expect(returned).toBe(true);
    await runtime.close();
  });

  it("bounds draining a non-cooperative provider after a hard fault", async () => {
    const runtime = new QuickJsRuntime();
    let signal!: AbortSignal;
    let returned = false;
    const execution = runtime.execute("return 1", async (_ref, _args, hostSignal) => {
      signal = hostSignal;
      return new Promise(() => {});
    }, defaults).then(result => { returned = true; return result; });
    send("hostCall", { id: 1, ref: "fabric.call", args: {} });
    await vi.advanceTimersByTimeAsync(0);
    current().emit("error", new Error("injected fault"));
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(49);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(execution).resolves.toMatchObject({ terminationReason: "runtime_error", error: "Virtual machine fault: injected fault" });
    await runtime.close();
  });

  it.each(["resolve", "reject"])("ignores stale messages and a late provider %s across pooled executions", async (outcome) => {
    const runtime = new QuickJsRuntime();
    let resolveA!: (value: unknown) => void;
    let rejectA!: (error: Error) => void;
    const a = runtime.execute("return 1", async () => new Promise((resolve, reject) => { resolveA = resolve; rejectA = reject; }), defaults);
    const runA = run();
    send("hostCall", { id: 1, ref: "fabric.call", args: {} });
    await vi.advanceTimersByTimeAsync(0);
    send("result", { result: completed });
    await vi.advanceTimersByTimeAsync(50);
    await a;
    const hostB = vi.fn<FabricHostCall>(async () => "B");
    const floorB = vi.fn(() => undefined);
    const b = runtime.execute("return 2", hostB, { ...defaults, minimumTimeoutMsForHostCall: floorB });
    let bReturned = false;
    void b.then(() => { bReturned = true; });
    expect(workers).toHaveLength(1);
    const runB = run();
    expect((runB as unknown as { executionId: string }).executionId).toBeTypeOf("string");
    expect((runB as unknown as { executionId: string }).executionId).not.toBe((runA as unknown as { executionId: string }).executionId);
    const before = current().messages.length;
    for (const [type, fields] of [
      ["prepare", { ref: "fabric.call", args: {} }],
      ["hostCall", { id: 1, ref: "fabric.call", args: {} }],
      ["hostAbort", { message: "late abort" }],
      ["result", { result: completed }],
      ["fatal", { message: "late fault" }],
      ["spanStart", { token: 1, cat: "bridge", ev: "late span" }],
      ["spanEnd", { token: 1 }],
      ["event", { cat: "bridge", ev: "late event" }],
      ["flush", {}],
    ] as const) send(type, fields, runA);
    if (outcome === "resolve") resolveA("late A"); else rejectA(new Error("late A"));
    await vi.advanceTimersByTimeAsync(0);
    expect(bReturned).toBe(false);
    expect(current().messages).toHaveLength(before);
    expect(hostB).not.toHaveBeenCalled();
    expect(floorB).not.toHaveBeenCalled();
    send("hostCall", { id: 1, ref: "fabric.call", args: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(hostB.mock.calls[0]?.[2]?.aborted).toBe(false);
    send("result", { result: { ...completed, value: "B" } });
    await expect(b).resolves.toMatchObject({ value: "B", terminationReason: "completed" });
    await runtime.close();
  });
});
