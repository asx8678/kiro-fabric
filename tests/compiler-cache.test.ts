import { afterEach, describe, expect, it, vi } from "vitest";
import { FabricCompilerPool, type FabricCompilerRequest, type FabricTypeCheckResult } from "../src/runtime/type-checker.js";

interface TestWorker {
  terminated: number;
  reply(result: FabricTypeCheckResult): void;
  fail(): void;
}
const { workers, dispatches } = vi.hoisted(() => ({
  workers: [] as TestWorker[],
  dispatches: [] as Array<{ worker: TestWorker; request: FabricCompilerRequest & { id: number } }>,
}));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { Worker: class extends EventEmitter {
    terminated = 0;
    request: (FabricCompilerRequest & { id: number }) | undefined;
    constructor() { super(); workers.push(this); }
    ref() {}
    unref() {}
    postMessage(request: FabricCompilerRequest & { id: number }) {
      this.request = structuredClone(request);
      dispatches.push({ worker: this, request: this.request });
    }
    reply(result: FabricTypeCheckResult) { this.emit("message", { id: this.request!.id, ok: true, result: structuredClone(result) }); }
    fail() { this.emit("error", new Error("fixture compiler failure")); }
    async terminate() { this.terminated += 1; this.emit("exit", 0); return 0; }
  } };
});
const owners: FabricCompilerPool[] = [];
afterEach(async () => {
  await Promise.all(owners.splice(0).map(owner => owner.close()));
  workers.length = 0; dispatches.length = 0; vi.useRealTimers();
});
const pool = () => { const owner = new FabricCompilerPool(); owners.push(owner); return owner; };
const request = { code: "return true", declarations: "type JsonValue = boolean;" };
const success: FabricTypeCheckResult = { errors: [], javascript: "async function __kiroFabricMain() { return true; }", sourceMap: "fixture source map" };
const compile = async (owner: FabricCompilerPool, input = request, result = success) => {
  const before = dispatches.length;
  const checking = owner.check(input);
  expect(dispatches).toHaveLength(before + 1);
  dispatches.at(-1)!.worker.reply(result);
  return checking;
};

describe("bounded successful compiler cache", () => {
  it("reuses a successful check without another worker dispatch", async () => {
    const owner = pool();
    expect(await compile(owner)).toEqual({ ...success, compileCache: "miss", compileWorker: "cold" });
    expect(await owner.check({ ...request }, { timeoutMs: 100 })).toEqual({ ...success, compileCache: "hit" });
    expect(dispatches).toHaveLength(1);
  });

  it("reports cold, cache hit, warm, then cold after retirement without inheriting a hit's worker", async () => {
    vi.useFakeTimers();
    const owner = pool();
    expect(await compile(owner)).toMatchObject({ compileCache: 'miss', compileWorker: 'cold' });
    const hit = await owner.check(request);
    expect(hit.compileCache).toBe('hit'); expect(hit).not.toHaveProperty('compileWorker');
    expect(await compile(owner, { ...request, code: 'return false' })).toMatchObject({ compileCache: 'miss', compileWorker: 'warm' });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(await compile(owner, { ...request, code: 'return null' })).toMatchObject({ compileCache: 'miss', compileWorker: 'cold' });
    expect(workers).toHaveLength(2);
  });

  it("keys exact source and declarations without framing or Unicode aliases", async () => {
    const owner = pool();
    const inputs = [request, { ...request, code: "return false" }, { ...request, declarations: "type JsonValue = string;" },
      { code: "bc", declarations: "a" }, { code: "c", declarations: "ab" },
      { code: "return '\ud800'", declarations: "" }, { code: "return '\ud801'", declarations: "" }];
    for (const input of inputs) await compile(owner, input);
    for (const input of inputs) expect(await owner.check(input)).toEqual({ ...success, compileCache: "hit" });
    expect(dispatches).toHaveLength(inputs.length);
  });

  it("snapshots the request before the caller can mutate it", async () => {
    const owner = pool(); const input = { ...request };
    const checking = owner.check(input);
    input.code = "return false"; input.declarations = "changed declarations";
    dispatches.at(-1)!.worker.reply(success); await checking;
    expect(dispatches[0]!.request).toMatchObject(request);
    expect(await owner.check(request)).toEqual({ ...success, compileCache: "hit" });
    await compile(owner, input);
    expect(dispatches).toHaveLength(2);
  });

  it("does not let returned objects poison subsequent hits", async () => {
    const owner = pool(); const cold = await compile(owner);
    cold.javascript = "forged"; cold.sourceMap = "forged";
    cold.errors.push({ line: 1, column: 1, message: "forged" });
    const warm = await owner.check(request);
    expect(warm).toEqual({ ...success, compileCache: "hit" });
    warm.javascript = "also forged"; warm.errors.push({ line: 0, column: 0, message: "forged" });
    expect(await owner.check(request)).toEqual({ ...success, compileCache: "hit" });
    expect(dispatches).toHaveLength(1);
  });

  it.each([
    { errors: [{ line: 1, column: 1, message: "fixture diagnostic" }] },
    { errors: [] },
  ])("does not cache diagnostics or missing emitted code: %j", async (result) => {
    const owner = pool();
    expect(await compile(owner, request, result)).toEqual({ ...result, compileCache: "miss", compileWorker: "cold" });
    expect(await compile(owner)).toEqual({ ...success, compileCache: "miss", compileWorker: "warm" });
    expect(dispatches).toHaveLength(2);
  });

  it("retries worker failures instead of remembering them", async () => {
    const owner = pool();
    const rejection = expect(owner.check(request)).rejects.toThrow("fixture compiler failure");
    dispatches.at(-1)!.worker.fail(); await rejection;
    await compile(owner);
    expect(workers).toHaveLength(2);
  });

  it("evicts the least recently used entry after 32 programs", async () => {
    const owner = pool();
    const input = (index: number) => ({ ...request, code: `return ${index}` });
    for (let index = 0; index < 32; index++) await compile(owner, input(index));
    await owner.check(input(0));
    await compile(owner, input(32));
    await owner.check(input(0)); await owner.check(input(2));
    expect(dispatches).toHaveLength(33);
    await compile(owner, input(1));
    expect(dispatches).toHaveLength(34);
  });

  it("accounts concurrent completions of the same program only once", async () => {
    const owner = pool();
    const large = { ...success, sourceMap: "x".repeat(1_100_000) };
    const first = owner.check(request); const second = owner.check({ ...request });
    workers[0]!.reply(large); workers[1]!.reply(large);
    await Promise.all([first, second]);
    expect(await owner.check(request)).toEqual({ ...large, compileCache: "hit" });
    expect(dispatches).toHaveLength(2);
  });

  it("bounds total retained source and emitted text, not just entry count", async () => {
    const owner = pool();
    const large = { ...success, sourceMap: "x".repeat(1_100_000) };
    const second = { ...request, code: "return false" };
    await compile(owner, request, large); await compile(owner, second, large);
    expect(await owner.check(second)).toEqual({ ...large, compileCache: "hit" });
    await compile(owner, request);
    expect(dispatches).toHaveLength(3);
  });

  it.each(["source", "declarations", "javascript", "sourceMap"] as const)("does not retain an oversized %s entry", async (field) => {
    const owner = pool(); const huge = "x".repeat(2 * 1024 * 1024 + 1);
    const input = { ...request, ...(field === "source" ? { code: huge } : field === "declarations" ? { declarations: huge } : {}) };
    const result = { ...success, ...(field === "javascript" || field === "sourceMap" ? { [field]: huge } : {}) };
    expect(await compile(owner, input, result)).toEqual({ ...result, compileCache: field === "source" || field === "declarations" ? "bypass" : "miss", compileWorker: "cold" });
    await compile(owner, input, result);
    expect(dispatches).toHaveLength(2);
  });

  it("keeps cached output after idle worker retirement, but never shares across owners", async () => {
    vi.useFakeTimers();
    const owner = pool(); await compile(owner);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(workers[0]!.terminated).toBe(1);
    expect(await owner.check(request)).toEqual({ ...success, compileCache: "hit" });
    expect(workers).toHaveLength(1);
    await compile(pool()); expect(workers).toHaveLength(2);
  });

  it("checks cancellation and closure before serving a cache hit", async () => {
    const owner = pool(); await compile(owner);
    const controller = new AbortController(); controller.abort(new Error("cancel cached check"));
    await expect(owner.check(request, { signal: controller.signal })).rejects.toThrow("cancel cached check");
    await owner.close();
    await expect(owner.check(request)).rejects.toThrow("pool is closed");
    expect(dispatches).toHaveLength(1);
  });

  it("bypasses cache lookup and insertion for custom worker URLs", async () => {
    const owner = pool(); await compile(owner);
    const workerUrl = new URL("file:///fixture-compiler.js");
    const custom = { ...success, javascript: "custom worker result" };
    const checkCustom = async (input: FabricCompilerRequest) => {
      const before = dispatches.length;
      const checking = owner.check(input, { workerUrl });
      expect(dispatches).toHaveLength(before + 1);
      dispatches.at(-1)!.worker.reply(custom);
      expect(await checking).toEqual({ ...custom, compileCache: "bypass", compileWorker: "custom" });
    };
    await checkCustom(request);
    expect(await owner.check(request)).toEqual({ ...success, compileCache: "hit" });
    const other = { ...request, code: "return false" };
    await checkCustom(other); await compile(owner, other);
    expect(dispatches).toHaveLength(4);
  });
});
