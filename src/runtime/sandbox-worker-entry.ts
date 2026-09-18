import { parentPort } from "node:worker_threads";
import {
  runQuickJsSandbox,
  type FabricHostCall,
  type FabricSandboxOptions,
  type SandboxWorkerMessage,
  type SandboxWorkerRequest,
} from "./quickjs-runtime.js";
import { FabricRepairError } from "../core/repair-error.js";
import { LocalShellExitError } from "../providers/local-shell.js";
import { ProbeRunExitError } from "../providers/probe-provider.js";
import type { LocalShellResult } from "../providers/local-contract.js";
import type { ProbeRunResult } from "../providers/probe-contract.js";
import { FabricDeadline } from "./deadline.js";
import type { FabricTracer } from "../trace/tracer.js";
import { FABRIC_COMMIT_ACKNOWLEDGEMENT, type FabricFailureMetadata } from "../protocol.js";

// Build-artifact verification imports every entry point in the main thread, so
// the protocol handler is installed only when this entry really is a worker.
//
// This worker owns the VM and nothing else: approvals, audit ordering, effect
// settlement and the trace file all stay on the host. It is reused for one
// execution at a time and is discarded by the host after a fault.
const port = parentPort;

if (port) {
  type PendingCall = {
    resolve(value: unknown): void;
    reject(error: Error): void;
    deadline: FabricDeadline;
  };

  // Ids are monotonic for the worker's lifetime, never per run: a reply that
  // arrives after its execution ended can then never resolve a later call.
  let nextCallId = 0;
  let nextSpanToken = 0;
  type Execution = { executionId: string; controller: AbortController; pending: Map<number, PendingCall>; deadline?: FabricDeadline };
  let active: Execution | undefined;
  type MessagePayload<T = SandboxWorkerMessage> = T extends unknown ? Omit<T, "executionId"> : never;

  /** Class identity cannot cross the thread boundary, so a host failure is
   * rebuilt from its transferred shape. The guest therefore sees exactly the
   * diagnostics it would see in-process: shell/probe results, `failure`
   * metadata, or a plain message. */
  const rebuildHostError = (message: Extract<SandboxWorkerRequest, { type: "hostResult" }>): Error => {
    const text = message.error ?? "Provider failed";
    const error = message.shellKind === "shell"
      ? new LocalShellExitError(message.shellResult as LocalShellResult)
      : message.shellKind === "probe"
        ? new ProbeRunExitError(message.shellResult as ProbeRunResult)
        : message.failure
          ? new FabricRepairError(text, message.failure as FabricFailureMetadata)
          : new Error(text);
    // Restore the post-commit marker so the guest and the service still see a
    // committed mutation rather than an ordinary failure.
    if (message.committed) {
      Object.defineProperty(error, FABRIC_COMMIT_ACKNOWLEDGEMENT, {
        value: Object.freeze({ version: 1 as const, operation: message.committed.operation }),
        enumerable: false, configurable: false, writable: false,
      });
    }
    return error;
  };

  const start = async (request: Extract<SandboxWorkerRequest, { type: "run" }>): Promise<void> => {
    const controller = new AbortController();
    const pending = new Map<number, PendingCall>();
    const state: Execution = { executionId: request.executionId, controller, pending };
    active = state;
    // Capture identity in every asynchronous callback, never read a later run's
    // identity from `active` when forwarding a late abort/span/result.
    const post = (message: MessagePayload): void => { port.postMessage({ ...message, executionId: state.executionId } satisfies SandboxWorkerMessage); };

    const hostCall: FabricHostCall = (ref, args, signal, deadline) => new Promise<unknown>((resolve, reject) => {
      state.deadline = deadline;
      const id = ++nextCallId;
      pending.set(id, { resolve, reject, deadline });
      signal.addEventListener("abort", () => {
        const reason = signal.reason instanceof Error ? signal.reason : new Error("Execution cancelled");
        if (pending.delete(id)) reject(reason);
        // The host owns provider dispatch, so it must cancel its own side too.
        post({ type: "hostAbort", message: reason.message.slice(0, 4_096) });
      }, { once: true });
      post({ type: "hostCall", id, ref, args });
    });

    // Span identity and the trace file belong to the host, so the proxy only
    // reports boundaries and the host keeps ordering, parenting and duration.
    const tracer: FabricTracer = {
      enabled: request.options.tracerEnabled,
      file: undefined,
      newExecutionId: () => "",
      span: (cat, ev, execId, data, parentId) => {
        const token = ++nextSpanToken;
        post({ type: "spanStart", token, cat, ev, ...(execId ? { execId } : {}), ...(parentId ? { parentId } : {}), ...(data ? { data } : {}) });
        let ended = false;
        return {
          id: "",
          end: (endData) => {
            if (ended) return;
            ended = true;
            post({ type: "spanEnd", token, ...(endData ? { data: endData } : {}) });
          },
        };
      },
      event: (cat, ev, execId, data) => post({ type: "event", cat, ev, ...(execId ? { execId } : {}), ...(data ? { data } : {}) }),
      flush: () => post({ type: "flush" }),
      close: () => undefined,
    };

    const options: FabricSandboxOptions = {
      ...request.options,
      signal: controller.signal,
      tracer,
      // Forward the exact-action report so the host can extend the deadline it
      // mirrors before this guest queues behind a saturated host-call slot.
      onPrepareHostCall: (ref, args, deadline) => {
        state.deadline = deadline;
        post({ type: "prepare", ref, args });
      },
    };
    try {
      post({ type: "result", result: await runQuickJsSandbox(request.code, hostCall, options) });
    } catch (error) {
      post({ type: "fatal", message: (error instanceof Error ? error.message : String(error)).slice(0, 4_096) });
    } finally {
      if (active === state) active = undefined;
      pending.clear();
      tracer.flush();
    }
  };

  port.on("message", (message: SandboxWorkerRequest) => {
    if (message.type === "run") {
      // A pooled slot is strictly single-flight; a duplicate run cannot replace
      // the controller and pending calls of an execution still being torn down.
      if (!active) void start(message);
      return;
    }
    const state = active;
    if (!state || message.executionId !== state.executionId) return;
    if (message.type === "abort") {
      state.controller.abort(new Error(message.message));
      return;
    }
    if (message.type === "expire") {
      // The host reported its deadline as passed; align the VM's own deadline so
      // the guest terminates as a timeout rather than an ordinary failure.
      state.deadline?.expireNow();
      return;
    }
    if (message.type === "extend") {
      // A floor arrives while the guest is suspended on its bridge or slot
      // promise, so applying it here is still ahead of any resume.
      const call = message.id === undefined ? undefined : state.pending.get(message.id);
      (call?.deadline ?? state.deadline)?.extendTo(message.floorMs);
      return;
    }
    const call = state.pending.get(message.id);
    if (!call) return;
    state.pending.delete(message.id);
    if (message.ok) { call.resolve(message.value); return; }
    call.reject(rebuildHostError(message));
  });
}
