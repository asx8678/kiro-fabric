import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContinuityExecution, observeContinuity } from "../src/continuity/execution.js";
import { ContinuityStore } from "../src/continuity/store.js";
import { parseTask, snapshot } from "../src/continuity/records.js";
import { renderContinuity } from "../src/continuity/render.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { StateProvider } from "../src/providers/state-provider.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { ContinuityProvider } from "../src/providers/continuity-provider.js";
import { createKiroRuntime, type KiroRuntime } from "../src/kiro/runtime.js";
import { normalizeFabricConfig } from "../src/config.js";
import type { FabricProvider } from "../src/protocol.js";
import type { ContinuityHandle } from "../src/continuity/store.js";

const roots: string[] = [], runtimes: KiroRuntime[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const runtime of runtimes.splice(0)) await runtime.close(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "continuity-p3-"))); roots.push(root); return root; };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const limits = { maxTasks: 32, maxTaskBytes: 131072, maxTotalBytes: 4194304 };
const shellResult = { ok: false, exitCode: 7, signal: null, stdout: "PRIVATE_STDOUT", stderr: "PRIVATE_STDERR" };
function completed(recorder: ContinuityExecution, ref = "local.shell") {
  const ticket = recorder.admit(ref);
  ticket.observer.resolve(ref, "execute"); ticket.observer.prepare({ command: "PRIVATE_COMMAND" });
  ticket.observer.dispatch(); ticket.observer.result(shellResult); ticket.observer.settle(true);
  return ticket;
}
function runtimeFixture() {
  const root = temporary(), workspace = path.join(root, "workspace"), continuityRoot = path.join(root, "continuity");
  fs.mkdirSync(workspace); fs.writeFileSync(path.join(workspace, "read.txt"), "fixture");
  const runtime = createKiroRuntime({ cwd: workspace, workspaceRoot: workspace, localLockRoot: path.join(root, "locks"), continuityRoot,
    configFile: path.join(root, "config.json"), mcpConfigPath: path.join(root, "mcp.json"), artifactsRoot: path.join(root, "artifacts"),
    config: normalizeFabricConfig({ continuity: { enabled: true }, mcp: { enabled: false }, tracing: { enabled: false } }),
  }); runtimes.push(runtime);
  const run = (code: string) => runtime.service.execute({ code, approver: { async approve() {}, prepareApproval: () => ({ decision: "allow" }) }, workspaceBound: true });
  const create = async () => { const result = await run('return await continuity.create({objective:"P3 qualification"});'); expect(result.success, result.error).toBe(true); return result.value as ContinuityHandle; };
  return { root, workspace, continuityRoot, runtime, run, create };
}

describe("bounded host receipt journal", () => {
  it("freezes the admission prefix, counts exclusions/unsupported calls, and does not retain unknown refs", () => {
    const recorder = new ContinuityExecution();
    const first = recorder.admit("local.read"), unsupported = recorder.admit("remote.PRIVATE_REF"), excluded = recorder.admit("continuity.read");
    const checkpoint = recorder.admit("continuity.checkpoint");
    unsupported.observer.settle(false); excluded.observer.settle(true);
    expect(() => checkpoint.capture()).toThrow("settled operation prefix");
    first.observer.resolve("local.read", "read"); first.observer.dispatch(); first.observer.result({ path: "read.txt", sha256: "a".repeat(64), text: "PRIVATE_BODY" }); first.observer.settle(true);
    const later = recorder.admit("local.write"); // Later work need not settle; it is outside this frozen cut.
    expect(later).toBeDefined();
    const prefix = checkpoint.capture();
    expect(prefix).toMatchObject({ throughOperation: 3, admittedOperations: 3, capturedOperations: 1, unsupportedOperations: 1, excludedOperations: 1 });
    expect(prefix.receipts[0]).toMatchObject({ ref: "local.read", operationSequence: 1, outcome: "succeeded", dispatchState: "dispatched", effectOutcome: "none", path: "read.txt" });
    expect(JSON.stringify(prefix)).not.toContain("PRIVATE");
    prefix.receipts[0]!.path = "tampered";
    expect(checkpoint.capture().receipts[0]!.path).toBe("read.txt");
  });
  it("keeps tool outcome separate from typed command outcome for shell and probe", () => {
    for (const ref of ["local.shell", "probe.run"]) {
      const recorder = new ContinuityExecution(); completed(recorder, ref);
      const receipt = recorder.admit("continuity.checkpoint").capture().receipts[0]!;
      expect(receipt).toMatchObject({ ref, outcome: "succeeded", effectOutcome: "uncertain", command: { ok: false, exitCode: 7, signal: null } });
      expect(receipt.identityHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(receipt)).not.toContain("PRIVATE");
    }
  });
  it("rejects capture on recorder quotas or faults without throwing into ordinary observation", () => {
    for (const recorder of [new ContinuityExecution(1), new ContinuityExecution(256, 1)]) {
      expect(() => completed(recorder)).not.toThrow();
      expect(() => recorder.admit("continuity.checkpoint").capture()).toThrow("recorder failed or exceeded bounds");
    }
    const recorder = new ContinuityExecution(), ticket = recorder.admit("local.read");
    vi.spyOn(ticket.observer, "result").mockImplementation(() => { throw new Error("PRIVATE_OBSERVER_FAILURE"); });
    expect(() => observeContinuity(ticket.observer, observer => observer.result({ text: "private" }))).not.toThrow();
    expect(() => recorder.admit("continuity.checkpoint").capture()).toThrow("incomplete");
  });
  it("observes denied calls as not dispatched and never copies rejection text", async () => {
    const recorder = new ContinuityExecution(), ticket = recorder.admit("state.set"), registry = new ActionRegistry();
    const invoke = vi.fn(async () => ({ revision: 1 }));
    registry.register({ name: "state", description: "fixture", list: async () => [], describe: async () => ({ name: "set", description: "fixture", inputSchema: { type: "object" }, risk: "write" }), invoke });
    const error = await registry.invoke("state.set", { key: "PRIVATE_KEY", value: "PRIVATE_VALUE" }, { cwd: "/", audits: [], maxResultChars: 1000,
      operationObserver: ticket.observer, async approve() { throw new Error("PRIVATE_DENIAL"); } }).catch((error: unknown) => error);
    ticket.observer.settle(false, error);
    expect(invoke).not.toHaveBeenCalled();
    const receipt = recorder.admit("continuity.checkpoint").capture().receipts[0]!;
    expect(receipt).toMatchObject({ outcome: "failed", dispatchState: "not_dispatched", effectOutcome: "none" });
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE"); await registry.close();
  });
  it("does not close a receipt before reservation cleanup settles", async () => {
    const recorder = new ContinuityExecution(), ticket = recorder.admit("state.set"), registry = new ActionRegistry(), entered = deferred(), release = deferred();
    const provider: FabricProvider = { name: "state", description: "fixture", list: async () => [],
      describe: async () => ({ name: "set", description: "fixture", inputSchema: { type: "object" }, risk: "write" }),
      invoke: async () => ({ revision: 1 }), reserveInvocation: async () => async () => { entered.resolve(); await release.promise; } };
    registry.register(provider);
    const call = registry.invoke("state.set", {}, { cwd: "/", audits: [], maxResultChars: 1000, operationObserver: ticket.observer, async approve() {} })
      .then(value => { ticket.observer.settle(true); return value; }, error => { ticket.observer.settle(false, error); throw error; });
    await entered.promise;
    const checkpoint = recorder.admit("continuity.checkpoint");
    expect(() => checkpoint.capture()).toThrow("settled operation prefix");
    release.resolve(); await call;
    expect(checkpoint.capture().receipts[0]).toMatchObject({ outcome: "succeeded", effectOutcome: "committed" }); await registry.close();
  });
  it("preserves committed-but-unacknowledged mutations after actual state publication", async () => {
    const root = temporary(), registry = new ActionRegistry(), recorder = new ContinuityExecution(), ticket = recorder.admit("state.set"), controller = new AbortController();
    registry.register(new StateProvider(root));
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { rename(from, to); if (String(to) === path.join(root, "state.json")) controller.abort(); });
    const error = await registry.invoke("state.set", { key: "PRIVATE_KEY", value: "PRIVATE_VALUE" }, { cwd: root, audits: [], maxResultChars: 1000,
      operationObserver: ticket.observer, signal: controller.signal, async approve() {} }).catch((error: unknown) => error);
    ticket.observer.settle(false, error);
    expect(fs.existsSync(path.join(root, "state.json"))).toBe(true);
    const receipt = recorder.admit("continuity.checkpoint").capture().receipts[0]!;
    expect(receipt).toMatchObject({ outcome: "failed", dispatchState: "dispatched", effectOutcome: "committed", commitAcknowledgement: { version: 1, operation: "set" } });
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE"); await registry.close();
  });
});

describe("versioned capture publication and recovery", () => {
  it("preserves v1 until publication, upgrades explicitly, and retries saved capture without observing a new execution", async () => {
    const root = temporary(), store = new ContinuityStore(root, limits), context = { cwd: root }, initial = await store.create("Original declaration", undefined, context);
    const original = await store.read(initial.taskId, initial.revision, context); expect(original.task.schemaVersion).toBe(1);
    const recorder = new ContinuityExecution(); completed(recorder); const ticket = recorder.admit("continuity.checkpoint");
    const saved = await store.checkpoint(initial.taskId, initial.revision, "capture", [], { ...context, continuityCapture: ticket.capture }, true);
    expect(saved.capture).toMatchObject({ executionId: recorder.executionId, capturedOperations: 1 });
    const next = new ContinuityStore(root, limits), source = await next.expandSource(saved.taskId, saved.revision, saved.hash, context);
    expect(source.task.schemaVersion).toBe(2); expect(source.task.records[0]).toEqual(original.task.records[0]);
    const noRecapture = vi.fn((): never => { throw new Error("must not recapture a retry"); });
    const before = fs.readFileSync(path.join(root, "state.json"), "utf8");
    const replay = await next.checkpoint(initial.taskId, initial.revision, "capture", [], { ...context, continuityCapture: noRecapture }, true);
    expect(replay).toMatchObject({ alreadyPublished: true, hash: saved.hash, capture: saved.capture }); expect(noRecapture).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root, "state.json"), "utf8")).toBe(before);
    await expect(next.checkpoint(initial.taskId, initial.revision, "capture", [{ kind: "decision", text: "changed" }], context)).rejects.toThrow("request ID conflict");
    const output = renderContinuity(source, 1400, 2400);
    expect(Buffer.byteLength(output.summary)).toBeLessThanOrEqual(1400); expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(2400);
    expect(output.coverage).toMatchObject({ operations: "selected-prefixes", observedOperations: 1, latestCapture: saved.capture });
    expect(renderContinuity(snapshot(parseTask(source.task), source.revision), 1400, 2400)).toEqual(output);
    const malformed = structuredClone(source.task); (malformed.records[1] as unknown as Record<string, unknown>).command = { ok: true, exitCode: 7, signal: null };
    expect(() => parseTask(malformed)).toThrow();
  });
  it("leaves the prior task intact on rejected capture and requires host context", async () => {
    const root = temporary(), store = new ContinuityStore(root, limits), context = { cwd: root }, initial = await store.create("Goal", undefined, context);
    const before = fs.readFileSync(path.join(root, "state.json"), "utf8");
    await expect(store.checkpoint(initial.taskId, initial.revision, "no-host", [], context, true)).rejects.toThrow("host execution context");
    const recorder = new ContinuityExecution(); recorder.admit("local.shell");
    await expect(store.checkpoint(initial.taskId, initial.revision, "pending", [], { ...context, continuityCapture: recorder.admit("continuity.checkpoint").capture }, true)).rejects.toThrow("settled operation prefix");
    expect(fs.readFileSync(path.join(root, "state.json"), "utf8")).toBe(before);
  });
});

describe("P3 checked execution integration", () => {
  it("rejects a checkpoint racing an earlier read without waiting for or replaying that read", async () => {
    const f = runtimeFixture(), task = await f.create(), release = deferred(), checkpointDone = deferred();
    const localInvoke = LocalCodingProvider.prototype.invoke, continuityInvoke = ContinuityProvider.prototype.invoke;
    vi.spyOn(LocalCodingProvider.prototype, "invoke").mockImplementation(async function (this: LocalCodingProvider, name, args, context) { if (name === "read") await release.promise; return localInvoke.call(this, name, args, context); });
    vi.spyOn(ContinuityProvider.prototype, "invoke").mockImplementation(async function (this: ContinuityProvider, name, args, context) { try { return await continuityInvoke.call(this, name, args, context); } finally { if (name === "checkpoint") checkpointDone.resolve(); } });
    const before = fs.readFileSync(path.join(f.continuityRoot, "state.json"), "utf8");
    const run = f.run(`const read=local.read({path:"read.txt"}); let error=""; try { await continuity.checkpoint({taskId:${JSON.stringify(task.taskId)},expectedRevision:${task.revision},requestId:"race",captureCurrentExecution:true}); } catch(e) { error=String(e); } await read; return error;`);
    try { await checkpointDone.promise; } finally { release.resolve(); }
    const result = await run; expect(result.success, result.error).toBe(true); expect(result.value).toContain("settled operation prefix");
    expect(fs.readFileSync(path.join(f.continuityRoot, "state.json"), "utf8")).toBe(before);
  });
  it("excludes later effects and keeps different execution identities distinct", async () => {
    const f = runtimeFixture(); let task = await f.create();
    for (const suffix of ["one", "two"]) {
      const result = await f.run(`await local.read({path:"read.txt"}); const saved=await continuity.checkpoint({taskId:${JSON.stringify(task.taskId)},expectedRevision:${task.revision},requestId:${JSON.stringify(suffix)},captureCurrentExecution:true}); await local.write({path:${JSON.stringify(suffix)},content:"later effect"}); return saved;`);
      expect(result.success, result.error).toBe(true); task = result.value as ContinuityHandle;
    }
    const source = await new ContinuityStore(f.continuityRoot, limits).read(task.taskId, task.revision, { cwd: f.workspace });
    const receipts = source.task.records.filter(record => record.kind === "operation");
    expect(receipts).toHaveLength(2); expect(receipts.map(receipt => receipt.ref)).toEqual(["local.read", "local.read"]);
    expect(new Set(receipts.map(receipt => receipt.executionId)).size).toBe(2); expect(receipts[0]!.identityHash).toBe(receipts[1]!.identityHash);
    expect(fs.readFileSync(path.join(f.workspace, "two"), "utf8")).toBe("later effect");
  });
  it("does not alter an ordinary effect when recorder admission fails, but refuses capture", async () => {
    const f = runtimeFixture(), task = await f.create(), before = fs.readFileSync(path.join(f.continuityRoot, "state.json"), "utf8");
    vi.spyOn(ContinuityExecution.prototype, "admit").mockImplementationOnce(() => { throw new Error("PRIVATE_RECORDER_FAILURE"); });
    const result = await f.run(`const effect=await local.write({path:"effect",content:"completed"}); let error=""; try { await continuity.checkpoint({taskId:${JSON.stringify(task.taskId)},expectedRevision:${task.revision},requestId:"fault",captureCurrentExecution:true}); } catch(e) { error=String(e); } return {effect,error};`);
    expect(result.success, result.error).toBe(true); expect(result.value).toMatchObject({ effect: { changed: true } });
    expect((result.value as { error: string }).error).toContain("capture is incomplete");
    expect(JSON.stringify(result.value)).not.toContain("PRIVATE_RECORDER_FAILURE");
    expect(fs.readFileSync(path.join(f.workspace, "effect"), "utf8")).toBe("completed");
    expect(fs.readFileSync(path.join(f.continuityRoot, "state.json"), "utf8")).toBe(before);
  });
  it("captures a caught nonzero command as a failed invocation, not a rollback or verified declaration", async () => {
    const f = runtimeFixture(), task = await f.create();
    const result = await f.run(`try { await local.shell({command:"printf partial > partial.txt; exit 9"}); } catch {} return await continuity.checkpoint({taskId:${JSON.stringify(task.taskId)},expectedRevision:${task.revision},requestId:"failure",captureCurrentExecution:true});`);
    expect(result.success, result.error).toBe(true); const saved = result.value as ContinuityHandle;
    const source = await new ContinuityStore(f.continuityRoot, limits).read(saved.taskId, saved.revision, { cwd: f.workspace });
    expect(source.task.records.find(record => record.kind === "operation")).toMatchObject({ provenance: "host-observed", outcome: "failed", dispatchState: "dispatched", effectOutcome: "uncertain", command: { ok: false, exitCode: 9 } });
    expect(fs.readFileSync(path.join(f.workspace, "partial.txt"), "utf8")).toBe("partial");
  });
});
