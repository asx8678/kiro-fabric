import { describe, expect, it, vi } from "vitest";
import { ActionRegistry, type FabricRegistryInvocationContext } from "../src/core/action-registry.js";
import { ContinuityExecution, type ContinuityOperationObserver } from "../src/continuity/execution.js";
import { FABRIC_COMMIT_ACKNOWLEDGEMENT, type FabricProvider } from "../src/protocol.js";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const context = (observer: ContinuityOperationObserver): FabricRegistryInvocationContext => ({ cwd: "/workspace", audits: [], maxResultChars: 10000, approve: async () => {}, operationObserver: observer });
const provider = (invoke: FabricProvider["invoke"], reserveInvocation?: FabricProvider["reserveInvocation"]): FabricProvider => ({
  name: "state", description: "trusted fixture", list: async () => [],
  describe: async name => ({ name, description: "fixture", inputSchema: { type: "object" }, risk: "write", effect: { kind: "write" } }),
  invoke, ...(reserveInvocation ? { reserveInvocation } : {}),
});
async function invoke(registry: ActionRegistry, observer: ContinuityOperationObserver, overrides: Partial<FabricRegistryInvocationContext> = {}) {
  let failed = false, error: unknown;
  try { return await registry.invoke("state.set", { key: "PRIVATE_KEY", value: "PRIVATE_VALUE" }, { ...context(observer), ...overrides }); }
  catch (cause) { failed = true; error = cause; throw cause; }
  finally { observer.settle(!failed, error); }
}

describe("host operation observation and closed prefixes", () => {
  it("uses admission order, excludes its own/later operations and reports unsupported/excluded calls without names", () => {
    const execution = new ContinuityExecution();
    const first = execution.admit("local.read"), unsupported = execution.admit("remote.PRIVATE_NAME"), excluded = execution.admit("continuity.read");
    const checkpoint = execution.admit("continuity.checkpoint"), later = execution.admit("local.shell");
    first.observer.resolve("local.read", "read"); first.observer.prepare({ path: "file.txt" }); first.observer.dispatch();
    first.observer.result({ path: "file.txt", sha256: "a".repeat(64), text: "PRIVATE_BODY" });
    unsupported.observer.settle(true); excluded.observer.settle(true); later.observer.dispatch();
    expect(() => checkpoint.capture()).toThrow("settled operation prefix");
    first.observer.settle(true);
    const captured = checkpoint.capture();
    expect(captured).toMatchObject({ throughOperation: 3, admittedOperations: 3, capturedOperations: 1, unsupportedOperations: 1, excludedOperations: 1 });
    expect(captured.receipts).toHaveLength(1);
    expect(captured.receipts[0]).toMatchObject({ operationSequence: 1, ref: "local.read", outcome: "succeeded", effectOutcome: "none", path: "file.txt", sha256: "a".repeat(64) });
    expect(JSON.stringify(captured)).not.toMatch(/PRIVATE|local.shell|continuity.checkpoint/);
    // Snapshots cannot mutate recorder authority.
    captured.receipts[0]!.ref = "forged";
    expect(checkpoint.capture().receipts[0]!.ref).toBe("local.read");
  });
  it("keeps completion order separate from stable operation order and independent execution identity", () => {
    const execution = new ContinuityExecution(), first = execution.admit("local.read"), second = execution.admit("local.list");
    second.observer.resolve("local.list", "read"); second.observer.dispatch(); second.observer.settle(true);
    const checkpoint = execution.admit("continuity.checkpoint");
    expect(() => checkpoint.capture()).toThrow("settled");
    first.observer.resolve("local.read", "read"); first.observer.dispatch(); first.observer.settle(true);
    expect(checkpoint.capture().receipts.map(record => record.operationSequence)).toEqual([1, 2]);
    expect(execution.executionId).toMatch(/^ce_[a-f0-9]{32}$/);
    expect(new ContinuityExecution().executionId).not.toBe(execution.executionId);
  });
  it("keeps settled nonzero command results distinct from a successful provider invocation", () => {
    const execution = new ContinuityExecution(), operation = execution.admit("local.shell");
    operation.observer.resolve("local.shell", "execute"); operation.observer.prepare({ command: "PRIVATE_COMMAND", settle: true }); operation.observer.dispatch();
    operation.observer.result({ ok: false, exitCode: 7, signal: null, stdout: "PRIVATE_OUTPUT", stderr: "PRIVATE_ERROR" }); operation.observer.settle(true);
    const receipt = execution.admit("continuity.checkpoint").capture().receipts[0]!;
    expect(receipt).toMatchObject({ outcome: "succeeded", dispatchState: "dispatched", effectOutcome: "uncertain", command: { ok: false, exitCode: 7, signal: null } });
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE");
  });
  it("hashes exact canonical arguments without retaining them, and never infers semantic resolution", () => {
    const execution = new ContinuityExecution();
    for (const args of [{ command: "secret", settle: true }, { settle: true, command: "secret" }, { command: "different", settle: true }]) {
      const operation = execution.admit("local.shell"); operation.observer.prepare(args); operation.observer.settle(false);
    }
    const receipts = execution.admit("continuity.checkpoint").capture().receipts;
    expect(receipts[0]!.identityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipts[0]!.identityHash).toBe(receipts[1]!.identityHash);
    expect(receipts[0]!.identityHash).not.toBe(receipts[2]!.identityHash);
    expect(JSON.stringify(receipts)).not.toMatch(/secret|different|resolved/);
  });
  it.each([new ContinuityExecution(1), new ContinuityExecution(20, 1)])("fails closed for capture quotas without throwing from ordinary observation", execution => {
    const operation = execution.admit("state.set");
    expect(() => { operation.observer.resolve("state.set", "write"); operation.observer.prepare({ key: "a", value: "body" }); operation.observer.dispatch(); operation.observer.result({ revision: 1 }); operation.observer.settle(true); }).not.toThrow();
    expect(() => execution.admit("continuity.checkpoint").capture()).toThrow("incomplete");
  });
  it("contains thrown recorder hooks without changing a completed provider result", async () => {
    const execution = new ContinuityExecution(), operation = execution.admit("state.set"), registry = new ActionRegistry();
    let effected = false;
    registry.register(provider(async () => { effected = true; return { revision: 1 }; }));
    const broken = { ...operation.observer, result: () => { throw new Error("recorder failure"); } };
    await expect(invoke(registry, broken)).resolves.toEqual({ revision: 1 });
    expect(effected).toBe(true);
    expect(() => execution.admit("continuity.checkpoint").capture()).toThrow("incomplete");
    await registry.close();
  });
  it("records denial as not dispatched without persisting arbitrary error messages", async () => {
    const execution = new ContinuityExecution(), operation = execution.admit("state.set"), registry = new ActionRegistry();
    const effect = vi.fn(async () => ({ revision: 1 })); registry.register(provider(effect));
    await expect(invoke(registry, operation.observer, { approve: async () => { throw new Error("PRIVATE_DENIAL_REASON"); } })).rejects.toThrow("PRIVATE_DENIAL_REASON");
    expect(effect).not.toHaveBeenCalled();
    const receipt = execution.admit("continuity.checkpoint").capture().receipts[0]!;
    expect(receipt).toMatchObject({ outcome: "failed", dispatchState: "not_dispatched", effectOutcome: "none" });
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE");
    await registry.close();
  });
  it("waits for cancellation cleanup and does not call a failed effect rolled back", async () => {
    const execution = new ContinuityExecution(), operation = execution.admit("state.set"), registry = new ActionRegistry();
    const entered = deferred(), aborted = deferred(), cleanup = deferred(), controller = new AbortController();
    registry.register(provider(async (_name, _args, invocation) => {
      entered.resolve();
      await new Promise<void>(done => invocation.signal!.addEventListener("abort", () => { aborted.resolve(); done(); }, { once: true }));
      await cleanup.promise;
      throw new Error("PRIVATE_CANCEL_REASON");
    }));
    const pending = invoke(registry, operation.observer, { signal: controller.signal }).catch(error => error);
    await entered.promise; controller.abort(); await aborted.promise;
    const checkpoint = execution.admit("continuity.checkpoint");
    expect(() => checkpoint.capture()).toThrow("settled");
    cleanup.resolve(); expect(await pending).toBeInstanceOf(Error);
    expect(checkpoint.capture().receipts[0]).toMatchObject({ outcome: "failed", dispatchState: "dispatched", effectOutcome: "uncertain" });
    await registry.close();
  });
  it("retains observed commit acknowledgement even if later reservation cleanup masks the original error", async () => {
    const execution = new ContinuityExecution(), operation = execution.admit("state.set"), registry = new ActionRegistry();
    // The acknowledgement class is internal; a real Error carrying the trusted
    // in-process symbol marker must be observed before cleanup masks it.
    const marked = Object.assign(new Error("PRIVATE_ACK"), {
      [FABRIC_COMMIT_ACKNOWLEDGEMENT]: { version: 1 as const, operation: "set" as const },
    });
    registry.register(provider(async () => { throw marked; },
      async () => () => { throw new Error("PRIVATE_CLEANUP"); }));
    await expect(invoke(registry, operation.observer)).rejects.toThrow("PRIVATE_CLEANUP");
    const receipt = execution.admit("continuity.checkpoint").capture().receipts[0]!;
    expect(receipt).toMatchObject({ outcome: "failed", dispatchState: "dispatched", effectOutcome: "committed", commitAcknowledgement: { version: 1, operation: "set" } });
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE");
    await registry.close();
  });

  it("does not trust unmarked or JSON-forged commit acknowledgements", async () => {
    const execution = new ContinuityExecution(), operation = execution.admit("state.set"), registry = new ActionRegistry();
    registry.register(provider(async () => { throw new Error("PRIVATE_UNMARKED"); }));
    await expect(invoke(registry, operation.observer)).rejects.toThrow("PRIVATE_UNMARKED");
    const receipt = execution.admit("continuity.checkpoint").capture().receipts[0];
    expect(receipt).toMatchObject({
      outcome: "failed", dispatchState: "dispatched", effectOutcome: "uncertain",
    });
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE");
    await registry.close();

    const forgedExecution = new ContinuityExecution(), forgedOperation = forgedExecution.admit("state.set"), forgedRegistry = new ActionRegistry();
    // A guest/serialized claim (committed:true in JSON) is not a trusted marker.
    const forged = Object.assign(new Error("PRIVATE_FORGED"), { committed: true, operation: "set",
      serialized: JSON.stringify({ committed: true, operation: "set" }) });
    forgedRegistry.register(provider(async () => { throw forged; }));
    await expect(invoke(forgedRegistry, forgedOperation.observer)).rejects.toThrow("PRIVATE_FORGED");
    expect(forgedExecution.admit("continuity.checkpoint").capture().receipts[0]).toMatchObject({ outcome: "failed", effectOutcome: "uncertain" });
    await forgedRegistry.close();
  });
  it("observes returned metadata before generic result truncation", async () => {
    const execution = new ContinuityExecution(), operation = execution.admit("state.set"), registry = new ActionRegistry();
    registry.register(provider(async () => ({ revision: 3, ignoredBody: "x".repeat(3000) })));
    await expect(invoke(registry, operation.observer, { maxResultChars: 200 })).resolves.toMatchObject({ fabricTruncated: true });
    expect(execution.admit("continuity.checkpoint").capture().receipts[0]).toMatchObject({ effectOutcome: "committed", commitAcknowledgement: { operation: "set" } });
    await registry.close();
  });
});
