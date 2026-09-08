import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { normalizeFabricConfig } from "../src/config.js";
import { FabricExecutionService, type FabricExecutionApprover } from "../src/execution-service.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const allow: FabricExecutionApprover = { prepareApproval: () => ({ decision: "allow" }), async approve() {} };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
function fixture(timeoutMs = 5000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "local-queue-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root, { mode: 0o700 });
  const provider = new LocalCodingProvider({ root, lockRoot: path.join(base, "locks"), maxResultChars: 20000 });
  const registry = new ActionRegistry(); registry.register(provider);
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs } }), root);
  cleanups.push(async () => { await service.close(); fs.rmSync(base, { recursive: true, force: true }); });
  const run = (code: string, approver = allow, signal?: AbortSignal) => service.execute({ code, approver, ...(signal ? { signal } : {}) });
  return { root, provider, service, run };
}

describe("Code Mode local effect FIFO", () => {
  it("runs Promise.all shell calls in arrival order without overlapping reservations", async () => {
    const f = fixture();
    const result = await f.run('return await Promise.all([local.shell({command:"printf first"}),local.shell({command:"printf second"}),local.shell({command:"printf third"})]);');
    expect(result.success, result.error).toBe(true);
    expect(result.value).toMatchObject([{ stdout: "first" }, { stdout: "second" }, { stdout: "third" }]);
    expect(result.audits.map(a => a.success)).toEqual([true, true, true]);
  });
  it("handles more queued effects than the guest concurrency cap", async () => {
    const f = fixture();
    const result = await f.run('return await Promise.all(Array.from({length:12},(_,i)=>local.shell({command:"printf " + i})));');
    expect(result.success, result.error).toBe(true);
    expect(result.audits).toHaveLength(12);
    expect(result.value).toMatchObject(Array.from({ length: 12 }, (_, i) => ({ stdout: String(i) })));
  });
  it("discards queued effects when the outer deadline expires", async () => {
    const f = fixture(1000); const prepared = vi.spyOn(f.provider, "prepareArguments");
    const result = await f.run('return await Promise.all([local.shell({command:"touch forbidden"}),local.write({path:"queued",content:"bad"})]);', { async approve(_action, _args, signal) {
      await new Promise<void>(resolve => { if (signal?.aborted) resolve(); else signal?.addEventListener("abort", () => resolve(), { once: true }); });
      throw new Error("approval cancelled");
    } });
    expect(result.status).toBe("timed_out");
    expect(prepared).toHaveBeenCalledTimes(1); expect(fs.readdirSync(f.root)).toEqual([]);
  });
  it("prepares queued edits only after predecessors commit, including tools.call", async () => {
    const f = fixture();
    const result = await f.run('return await Promise.all([local.write({path:"x",content:"before"}),tools.call({ref:"local.edit",args:{path:"x",oldText:"before",newText:"after"}}),local.shell({command:"cat x"})]);');
    expect(result.success, result.error).toBe(true);
    expect(result.value).toMatchObject([{}, {}, { stdout: "after" }]);
    expect(fs.readFileSync(path.join(f.root, "x"), "utf8")).toBe("after");
  });
  it("keeps read-only calls concurrent", async () => {
    const f = fixture(); const both = deferred(); let entered = 0;
    const invoke = f.provider.invoke.bind(f.provider);
    vi.spyOn(f.provider, "invoke").mockImplementation(async (name, args, context) => {
      if (name === "list") { if (++entered === 2) both.resolve(); await both.promise; }
      return invoke(name, args, context);
    });
    const result = await f.run('return await Promise.all([local.list(),local.list()]);');
    expect(result.success, result.error).toBe(true); expect(entered).toBe(2);
  });
  it("stops queued and caught successor effects after failure, but not a new execution", async () => {
    const f = fixture();
    const result = await f.run('const first=local.shell({command:"exit 7"}); const second=local.write({path:"must-not-exist",content:"bad"}); await Promise.all([first.catch(()=>null),second.catch(()=>null)]); try { await local.shell({command:"touch also-forbidden"}); } catch {} return true;');
    expect(result.success, result.error).toBe(true);
    expect(result.audits).toHaveLength(1); expect(result.audits[0]?.success).toBe(false);
    expect(fs.existsSync(path.join(f.root, "must-not-exist"))).toBe(false);
    expect(fs.existsSync(path.join(f.root, "also-forbidden"))).toBe(false);
    expect((await f.run('return await local.shell({command:"printf recovered"});')).success).toBe(true);
  });
  it("continues after an explicitly settled ordinary nonzero exit", async () => {
    const f = fixture();
    const result = await f.run('return await Promise.all([local.shell({command:"exit 7",settle:true}),local.shell({command:"printf next"})]);');
    expect(result.success, result.error).toBe(true);
    expect(result.value).toMatchObject([{ ok: false, exitCode: 7 }, { stdout: "next" }]);
  });
  it("does not prepare or approve successors after denial", async () => {
    const f = fixture(); const prepared = vi.spyOn(f.provider, "prepareArguments");
    const result = await f.run('return await Promise.all([local.shell({command:"printf denied"}),local.write({path:"x",content:"bad"})]);', { async approve() { throw new Error("denied fixture"); } });
    expect(result.success).toBe(false); expect(prepared).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(f.root, "x"))).toBe(false);
  });
  it.each(["cancel", "close"] as const)("drains active cleanup and discards queued effects on %s", async mode => {
    const f = fixture(); const entered = deferred(); const aborted = deferred(); const cleanup = deferred();
    const controller = new AbortController(); const prepared = vi.spyOn(f.provider, "prepareArguments");
    const approver: FabricExecutionApprover = { async approve(_action, _args, signal) {
      entered.resolve();
      await new Promise<void>(resolve => { if (signal?.aborted) resolve(); else signal?.addEventListener("abort", () => resolve(), { once: true }); });
      aborted.resolve(); await cleanup.promise; throw new Error("cancelled after cleanup");
    } };
    const active = f.run('return await Promise.all([local.shell({command:"touch forbidden"}),local.write({path:"queued",content:"bad"})]);', approver, controller.signal);
    let finished = false; void active.then(() => { finished = true; });
    try {
      await Promise.race([entered.promise, active.then(r => { throw new Error(r.error ?? "ended early"); })]);
      const closing = mode === "close" ? f.service.close() : undefined;
      if (mode === "cancel") controller.abort();
      await aborted.promise; expect(finished).toBe(false);
      cleanup.resolve(); expect((await active).success).toBe(false); await closing;
      expect(prepared).toHaveBeenCalledTimes(1);
      expect(fs.readdirSync(f.root)).toEqual([]);
    } finally { controller.abort(); cleanup.resolve(); await active; }
  });
  it("retains fail-fast conflicts between separate executions", async () => {
    const f = fixture(); const entered = deferred(); const release = deferred();
    const first = f.run('return await local.shell({command:"printf first"});', { async approve() { entered.resolve(); await release.promise; } });
    try {
      await Promise.race([entered.promise, first.then(r => { throw new Error(r.error ?? "ended early"); })]);
      const second = await f.run('return await local.shell({command:"printf second"});');
      expect(second.success).toBe(false); expect(second.error).toContain("Overlapping write rejected");
      release.resolve(); expect((await first).success).toBe(true);
    } finally { release.resolve(); await first; }
  });
});
