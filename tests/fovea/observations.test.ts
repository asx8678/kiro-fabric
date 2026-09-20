import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoveaObservationExecution, type FoveaObservation } from "../../src/fovea/observations.js";
import { ActionRegistry, type FabricRegistryInvocationContext } from "../../src/core/action-registry.js";
import { LocalCodingProvider } from "../../src/providers/local-provider.js";
import { FabricExecutionService } from "../../src/execution-service.js";
import { normalizeFabricConfig } from "../../src/config.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) await close(); });
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fovea-observation-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root);
  const registry = new ActionRegistry();
  registry.register(new LocalCodingProvider({ root, lockRoot: path.join(base, "locks") }));
  cleanup.push(async () => { await registry.close(); fs.rmSync(base, { recursive: true, force: true }); });
  const events: FoveaObservation[] = [], gap = vi.fn();
  const observer = { observe: (event: FoveaObservation) => { events.push(event); }, gap };
  const execution = new FoveaObservationExecution(observer);
  const call = (name: string, args: Record<string, unknown>, overrides: Partial<FabricRegistryInvocationContext> = {}) => registry.invoke(`local.${name}`, args, {
    cwd: root, audits: [], maxResultChars: 20000, approve: async () => {}, foveaObservation: execution.operation(`local.${name}`), ...overrides,
  });
  return { root, registry, events, gap, observer, call };
}

describe("independent trusted Fovea observation", () => {
  it("delivers a bounded event prefix across concurrent operations and gaps only once", () => {
    const events: FoveaObservation[] = [], gap = vi.fn();
    const execution = new FoveaObservationExecution({ observe: event => { events.push(event); }, gap }, 2);
    const first = execution.operation("local.read"), second = execution.operation("local.list");
    second.observe({ phase: "access" }); first.observe({ phase: "access" });
    first.observe({ phase: "settled" }); second.observe({ phase: "settled" });
    expect(events.map(event => event.sequence)).toEqual([1, 2]);
    expect(events[0]!.operationId).not.toBe(events[1]!.operationId);
    expect(gap).toHaveBeenCalledTimes(1);
  });
  it.each(["readMany", "readEvidence"])("%s observes actual successful partial files only", async name => {
    const f = fixture(); fs.writeFileSync(path.join(f.root, "ok"), "PRIVATE_SOURCE\n");
    await f.call(name, { windows: [{ path: "missing" }, { path: "ok" }], partial: true });
    expect(f.events.filter(event => event.phase === "access")).toEqual([expect.objectContaining({
      paths: [path.join(f.root, "ok")], sources: [{ path: path.join(f.root, "ok"), sha256: hash("PRIVATE_SOURCE\n") }],
    })]);
    expect(JSON.stringify(f.events)).not.toMatch(/PRIVATE_SOURCE|missing/);
  });
  it("does not observe files read speculatively but omitted by the batch budget", async () => {
    const f = fixture();
    for (const name of ["one", "two", "three"]) fs.writeFileSync(path.join(f.root, name), "x".repeat(400) + "\n");
    const result = await f.call("readMany", { windows: ["one", "two", "three"].map(path => ({ path })), maxChars: 1000 }) as { files: { path: string }[]; remaining: unknown[] };
    expect(result.remaining.length).toBeGreaterThan(0);
    expect(f.events.find(event => event.phase === "access")?.paths).toEqual(result.files.map(file => path.join(f.root, file.path)));
  });
  it("does not enroll denied, failed, or forged path arguments", async () => {
    const f = fixture();
    await expect(f.call("read", { path: "missing" })).rejects.toThrow();
    await expect(f.call("write", { path: "denied", content: "PRIVATE" }, { approve: async () => { throw new Error("PRIVATE_DENIAL"); } })).rejects.toThrow();
    await expect(f.call("read", { path: "../escape" })).rejects.toThrow();
    expect(f.events.filter(event => event.phase === "access" || event.phase === "committed")).toEqual([]);
    expect(JSON.stringify(f.events)).not.toContain("PRIVATE");
  });
  it("uses exact prepared hashes at publication and preserves them when acknowledgement throws", async () => {
    const f = fixture(), file = path.join(f.root, "file"); fs.writeFileSync(file, "before");
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      rename(from, to);
      // Interfere after publication: verification must fail, but the commit fact survives.
      if (String(to) === file) fs.writeFileSync(file, "external");
    });
    await expect(f.call("edit", { path: "file", expectedSha256: hash("before"), oldText: "before", newText: "after" })).rejects.toThrow("committed");
    const transition = { path: file, beforeSha256: hash("before"), afterSha256: hash("after") };
    expect(f.events.find(event => event.phase === "prepared")?.transitions).toEqual([transition]);
    expect(f.events.find(event => event.phase === "committed")?.transitions).toEqual([transition]);
    expect(f.events).toContainEqual(expect.objectContaining({ phase: "failed", uncertain: true }));
    expect(fs.readFileSync(file, "utf8")).toBe("external");
  });
  it("observer and gap throws cannot change a committed local result", async () => {
    const f = fixture(), gap = vi.fn(() => { throw new Error("gap failed"); });
    const execution = new FoveaObservationExecution({ observe: event => { if (event.phase === "committed") throw new Error("observer failed"); }, gap });
    await expect(f.call("write", { path: "new", content: "PRIVATE" }, { foveaObservation: execution.operation("local.write") })).resolves.toMatchObject({ changed: true });
    expect(fs.readFileSync(path.join(f.root, "new"), "utf8")).toBe("PRIVATE");
    expect(gap).toHaveBeenCalledTimes(1);
  });
  it("execution observation works without continuity or tracing and survives outer guest failure", async () => {
    const f = fixture();
    const service = new FabricExecutionService(f.registry, normalizeFabricConfig({ continuity: { enabled: false } }), f.root);
    try {
      const result = await service.execute({ operationObserver: f.observer, approver: { approve: async () => {} }, code: 'await local.write({path:"new",content:"PRIVATE"}); throw new Error("outer failure");' });
      expect(result.success).toBe(false);
      expect(f.events.map(event => event.phase)).toEqual(["prepared", "approved", "committed", "settled"]);
      expect(f.events.map(event => event.sequence)).toEqual([1, 2, 3, 4]);
      expect(new Set(f.events.map(event => event.operationId)).size).toBe(1);
      expect(JSON.stringify(f.events)).not.toContain("PRIVATE");
    } finally { await service.close(); }
  });
  it("waits for explicitly registered settlement in a new namespace after cancellation", async () => {
    let entered!: () => void, release!: () => void, aborted!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    const cancelled = new Promise<void>(resolve => { aborted = resolve; });
    const registry = new ActionRegistry();
    registry.register({ name: "repo", description: "fixture", requirements: { verifiedWorkspace: true, settlement: true }, list: async () => [], describe: async name => ({ name, description: "fixture", risk: "read", inputSchema: { type: "object" } }),
      invoke: async (_name, _args, context) => {
        context.signal!.addEventListener("abort", aborted, { once: true }); entered();
        await cancelled; await cleanup; throw new Error("cancelled");
      },
    });
    const service = new FabricExecutionService(registry, normalizeFabricConfig({}), "/workspace");
    const controller = new AbortController(), events: FoveaObservation[] = [];
    let finished = false;
    const active = service.execute({ signal: controller.signal, operationObserver: { observe: event => { events.push(event); }, gap: vi.fn() }, approver: { approve: async () => {} }, code: 'return await tools.call({ref:"repo.focus",args:{}});' }).then(result => { finished = true; return result; });
    try {
      await started; controller.abort(); await cancelled;
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(finished).toBe(false);
      expect(events.some(event => event.phase === "settled")).toBe(false);
      release(); expect((await active).status).toBe("aborted");
      expect(events.map(event => event.phase)).toEqual(["prepared", "approved", "failed", "settled"]);
    } finally { release(); controller.abort(); await active; await service.close(); }
  });
  it("enforces provider-owned requirements for a new namespace, not descriptor claims", async () => {
    const registry = new ActionRegistry(), invoke = vi.fn(async () => true);
    registry.register({ name: "repo", description: "fixture", requirements: { verifiedWorkspace: true, settlement: true }, list: async () => [], describe: async name => ({ name, description: "fixture", risk: "read", inputSchema: { type: "object" } }), invoke });
    expect(registry.requirements("repo.focus")).toEqual({ verifiedWorkspace: true, settlement: true });
    expect(registry.requirements("unknown.focus")).toEqual({});
    const service = new FabricExecutionService(registry, normalizeFabricConfig({}), "/workspace");
    try {
      const result = await service.execute({ workspaceBound: false, approver: { approve: async () => {} }, code: 'return await tools.call({ref:"repo.focus",args:{}});' });
      expect(result.success).toBe(false); expect(result.error).toContain("Verified workspace"); expect(invoke).not.toHaveBeenCalled();
    } finally { await service.close(); }
  });
});
