import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FabricHostCall, FabricSandboxOptions, FabricSandboxResult, SandboxWorkerMessage, SandboxWorkerRequest } from "../src/runtime/quickjs-runtime.js";
import { FabricDeadline } from "../src/runtime/deadline.js";

const mock = vi.hoisted(() => ({ run: vi.fn(), port: undefined as unknown as EventEmitter & { postMessage: ReturnType<typeof vi.fn> } }));
vi.mock("node:worker_threads", async importOriginal => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  const { EventEmitter } = await import("node:events");
  mock.port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  return { ...actual, parentPort: mock.port };
});
vi.mock("../src/runtime/quickjs-runtime.js", async importOriginal => ({ ...await importOriginal<typeof import("../src/runtime/quickjs-runtime.js")>(), runQuickJsSandbox: mock.run }));
await import("../src/runtime/sandbox-worker-entry.js");

const result: FabricSandboxResult = { value: true, logs: [], terminationReason: "completed", effectiveTimeoutMs: 100 };
const executions: Array<{ host: FabricHostCall; options: FabricSandboxOptions; finish: (result: FabricSandboxResult) => void }> = [];
const send = (request: SandboxWorkerRequest) => mock.port.emit("message", request);
const start = (executionId: string) => send({ type: "run", executionId, code: "return true", options: { timeoutMs: 100, maxTimeoutMs: 4_000, memoryLimitBytes: 32 * 1024 * 1024, tracerEnabled: true } });
const messages = () => mock.port.postMessage.mock.calls.map(call => call[0] as SandboxWorkerMessage);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => {
  executions.length = 0;
  mock.port.postMessage.mockClear();
  mock.run.mockReset().mockImplementation((_code: string, host: FabricHostCall, options: FabricSandboxOptions) => new Promise<FabricSandboxResult>(finish => { executions.push({ host, options, finish }); }));
});

describe("pooled worker protocol identity", () => {
  it("ignores stale replies, aborts, expiry and floors even when a call ID matches the current run", async () => {
    start("A");
    const a = executions[0]!;
    const signalA = new AbortController();
    const deadlineA = new FabricDeadline(100, 4_000, () => 0);
    const pendingA = a.host("fabric.call", {}, signalA.signal, deadlineA);
    const idA = (messages().find(message => message.type === "hostCall") as Extract<SandboxWorkerMessage, { type: "hostCall" }>).id;
    send({ type: "hostResult", executionId: "A", id: idA, ok: true, value: "A" });
    await expect(pendingA).resolves.toBe("A");
    const spanA = a.options.tracer!.span("bridge", "late span");
    a.finish(result); await flush();

    start("B");
    const b = executions[1]!;
    const deadlineB = new FabricDeadline(100, 4_000, () => 0);
    const pendingB = b.host("fabric.call", {}, b.options.signal!, deadlineB);
    let settledB = false;
    void pendingB.then(() => { settledB = true; }, () => { settledB = true; });
    const callB = [...messages()].reverse().find(message => message.type === "hostCall") as Extract<SandboxWorkerMessage, { type: "hostCall" }>;
    expect(callB.executionId).toBe("B");
    for (const request of [
      { type: "hostResult", id: callB.id, ok: true, value: "stale" },
      { type: "hostResult", id: callB.id, ok: false, error: "stale rejection" },
      { type: "extend", id: callB.id, floorMs: 4_000 },
      { type: "extend", floorMs: 4_000 },
      { type: "expire" },
      { type: "abort", message: "stale cancellation" },
    ] as const) send({ ...request, executionId: "A" });
    await flush();
    expect(settledB).toBe(false);
    expect(b.options.signal!.aborted).toBe(false);
    expect(deadlineB.effectiveTimeoutMs).toBe(100);

    // Late callbacks must retain A's identity and deadline, not read `active` B.
    const before = messages().length;
    signalA.abort(new Error("late A"));
    a.options.onPrepareHostCall!("fabric.call", {}, deadlineA);
    spanA.end();
    expect(messages().slice(before).map(message => message.executionId)).toEqual(["A", "A", "A"]);
    send({ type: "extend", executionId: "B", floorMs: 500 });
    expect(deadlineB.effectiveTimeoutMs).toBe(500);
    expect(deadlineA.effectiveTimeoutMs).toBe(100);
    send({ type: "hostResult", executionId: "B", id: callB.id, ok: true, value: "B" });
    await expect(pendingB).resolves.toBe("B");
    b.finish(result); await flush();
    expect(messages().filter(message => message.type === "result").map(message => message.executionId)).toEqual(["A", "B"]);
  });

  it("does not replace an active run with a duplicate run message", async () => {
    start("A"); start("B");
    expect(executions).toHaveLength(1);
    send({ type: "abort", executionId: "B", message: "wrong run" });
    expect(executions[0]!.options.signal!.aborted).toBe(false);
    send({ type: "abort", executionId: "A", message: "current run" });
    expect(executions[0]!.options.signal!.aborted).toBe(true);
    executions[0]!.finish(result); await flush();
  });
});
