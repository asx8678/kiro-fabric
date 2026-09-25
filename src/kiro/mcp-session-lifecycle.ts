import { settleWithin } from "../async-settlement.js";
import { KIRO_MCP_DRAIN_TIMEOUT_MS } from "./deadlines.js";
import type { KiroRuntime } from "./runtime.js";

export interface ActiveExecution {
  controller: AbortController;
  runtime: KiroRuntime;
  settled: Promise<void>;
  settle(): void;
}

// Invoke now: revocation must remain synchronous even when another cleanup fails.
export const attemptCleanup = async (failures: unknown[], operation: () => unknown): Promise<void> => {
  try { await operation(); } catch (error) { failures.push(error); }
};

interface SessionLifecycleOptions {
  retiring(): boolean;
  currentRuntime(): KiroRuntime | undefined;
  runtimeClosed(current: KiroRuntime): void;
  closeClient(current: KiroRuntime): unknown;
  retireConversation(): unknown;
  revokeArtifacts(): void;
  closeArtifacts(): unknown;
}

/** Owns serialization, execution leases and sticky cleanup failures for one
 * session. Workspace bindings and request projection do not own disposal. */
export const createMcpSessionLifecycle = (options: SessionLifecycleOptions) => {
  let closing = false;
  let lifecycleTail = Promise.resolve();
  let closeTask: Promise<void> | undefined;
  const active = new Set<ActiveExecution>();
  const runtimeClosures = new WeakMap<KiroRuntime, Promise<void>>();
  const failedCleanups = new Map<object, unknown>();
  const retiring = (): boolean => closing || options.retiring();
  const unavailable = (): boolean => retiring() || failedCleanups.size > 0;
  const assertAvailable = (): void => {
    if (retiring()) throw new Error("Agent MCP session is shutting down");
    if (failedCleanups.size) throw new AggregateError([...failedCleanups.values()], "Agent MCP session cleanup failed; restart required");
  };
  const lifecycle = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = lifecycleTail.then(operation, operation);
    lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const disposeRuntime = (current: KiroRuntime, reason: Error, primary: readonly unknown[] = []): Promise<void> => {
    const pending = runtimeClosures.get(current);
    if (pending) return pending;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const task = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    runtimeClosures.set(current, task);
    void (async () => {
      const failures: unknown[] = [];
      const revoked = attemptCleanup(failures, () => current.service.invalidateCatalogs());
      const clientClosed = attemptCleanup(failures, () => options.closeClient(current));
      const leases = [...active].filter(item => item.runtime === current);
      const drained = attemptCleanup(failures, async () => {
        try {
          for (const item of leases) item.controller.abort(reason);
          await settleWithin(leases.map(item => item.settled), KIRO_MCP_DRAIN_TIMEOUT_MS);
        } finally {
          // An expired bounded wait is not proof of quiescence. Join the real
          // handler settlements before releasing the runtime's ownership.
          await Promise.allSettled(leases.map(item => item.settled));
        }
      });
      await Promise.all([revoked, clientClosed, drained]);
      await attemptCleanup(failures, () => current.close());
      if (failures.length) throw new AggregateError([...primary, ...failures], "MCP runtime cleanup failed");
      options.runtimeClosed(current);
    })().then(resolve, error => { failedCleanups.set(current, error); reject(error); });
    return task;
  };
  const closeRuntime = (reason: Error): Promise<void> => {
    const current = options.currentRuntime();
    return current ? disposeRuntime(current, reason) : Promise.resolve();
  };
  const track = (current: KiroRuntime, controller: AbortController): ActiveExecution => {
    let resolveSettled!: () => void;
    let didSettle = false;
    const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
    const settle = () => { if (!didSettle) { didSettle = true; resolveSettled(); } };
    const execution = { controller, runtime: current, settled, settle };
    active.add(execution);
    return execution;
  };
  const releaseExecution = (execution: ActiveExecution): void => {
    active.delete(execution);
    execution.settle();
  };
  const close = (): Promise<void> => {
    if (closeTask) return closeTask;
    closing = true;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    closeTask = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const failures: unknown[] = [];
    options.revokeArtifacts();
    const reason = new Error("Agent MCP session shutting down");
    const revoked = attemptCleanup(failures, () => options.currentRuntime()?.service.invalidateCatalogs());
    // Publish ownership before callbacks, but revoke and abort before queued work.
    const retirement = attemptCleanup(failures, options.retireConversation);
    for (const item of active) {
      try { item.controller.abort(reason); } catch (error) { failures.push(error); }
    }
    const cleanup = attemptCleanup(failures, () => lifecycle(() => closeRuntime(reason)));
    void Promise.all([revoked, retirement, cleanup]).then(async () => {
      await attemptCleanup(failures, options.closeArtifacts);
      // Serialization has also joined unpublished factories and their failures.
      for (const error of failedCleanups.values()) if (!failures.includes(error)) failures.push(error);
      if (failures.length) reject(new AggregateError(failures, "MCP session shutdown failed"));
      else resolve();
    });
    return closeTask;
  };
  return {
    assertAvailable, lifecycle, retiring, unavailable, disposeRuntime, closeRuntime, track, releaseExecution, close,
    isRetired: (runtime: KiroRuntime): boolean => runtimeClosures.has(runtime),
    recordCleanupFailure: (owner: object, error: unknown): void => { failedCleanups.set(owner, error); },
  };
};
