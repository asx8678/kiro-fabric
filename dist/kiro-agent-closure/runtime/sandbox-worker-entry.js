import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import {
  FABRIC_COMMIT_ACKNOWLEDGEMENT,
  LocalShellExitError,
  ProbeRunExitError,
  runQuickJsSandbox
} from "../chunks/chunk-COO732H5.js";
import {
  FabricRepairError
} from "../chunks/chunk-ITY6W7FO.js";
import "../chunks/chunk-G3LABT6U.js";
import "../chunks/chunk-XJTFSUKV.js";
import "../chunks/chunk-NWYPLJ5N.js";
import "../chunks/chunk-AE4E2KSU.js";

// src/runtime/sandbox-worker-entry.ts
import { parentPort } from "node:worker_threads";
var port = parentPort;
if (port) {
  let nextCallId = 0;
  let nextSpanToken = 0;
  let active;
  const rebuildHostError = (message) => {
    const text = message.error ?? "Provider failed";
    const error = message.shellKind === "shell" ? new LocalShellExitError(message.shellResult) : message.shellKind === "probe" ? new ProbeRunExitError(message.shellResult) : message.failure ? new FabricRepairError(text, message.failure) : new Error(text);
    if (message.committed) {
      Object.defineProperty(error, FABRIC_COMMIT_ACKNOWLEDGEMENT, {
        value: Object.freeze({ version: 1, operation: message.committed.operation }),
        enumerable: false,
        configurable: false,
        writable: false
      });
    }
    return error;
  };
  const start = async (request) => {
    const controller = new AbortController();
    const pending = /* @__PURE__ */ new Map();
    const state = { executionId: request.executionId, controller, pending };
    active = state;
    const post = (message) => {
      port.postMessage({ ...message, executionId: state.executionId });
    };
    const hostCall = (ref, args, signal, deadline) => new Promise((resolve, reject) => {
      state.deadline = deadline;
      const id = ++nextCallId;
      pending.set(id, { resolve, reject, deadline });
      signal.addEventListener("abort", () => {
        const reason = signal.reason instanceof Error ? signal.reason : new Error("Execution cancelled");
        if (pending.delete(id)) reject(reason);
        post({ type: "hostAbort", message: reason.message.slice(0, 4096) });
      }, { once: true });
      post({ type: "hostCall", id, ref, args });
    });
    const tracer = {
      enabled: request.options.tracerEnabled,
      file: void 0,
      newExecutionId: () => "",
      span: (cat, ev, execId, data, parentId) => {
        const token = ++nextSpanToken;
        post({ type: "spanStart", token, cat, ev, ...execId ? { execId } : {}, ...parentId ? { parentId } : {}, ...data ? { data } : {} });
        let ended = false;
        return {
          id: "",
          end: (endData) => {
            if (ended) return;
            ended = true;
            post({ type: "spanEnd", token, ...endData ? { data: endData } : {} });
          }
        };
      },
      event: (cat, ev, execId, data) => post({ type: "event", cat, ev, ...execId ? { execId } : {}, ...data ? { data } : {} }),
      flush: () => post({ type: "flush" }),
      close: () => void 0
    };
    const options = {
      ...request.options,
      signal: controller.signal,
      tracer,
      // Forward the exact-action report so the host can extend the deadline it
      // mirrors before this guest queues behind a saturated host-call slot.
      onPrepareHostCall: (ref, args, deadline) => {
        state.deadline = deadline;
        post({ type: "prepare", ref, args });
      }
    };
    try {
      post({ type: "result", result: await runQuickJsSandbox(request.code, hostCall, options) });
    } catch (error) {
      post({ type: "fatal", message: (error instanceof Error ? error.message : String(error)).slice(0, 4096) });
    } finally {
      if (active === state) active = void 0;
      pending.clear();
      tracer.flush();
    }
  };
  port.on("message", (message) => {
    if (message.type === "run") {
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
      state.deadline?.expireNow();
      return;
    }
    if (message.type === "extend") {
      const call2 = message.id === void 0 ? void 0 : state.pending.get(message.id);
      (call2?.deadline ?? state.deadline)?.extendTo(message.floorMs);
      return;
    }
    const call = state.pending.get(message.id);
    if (!call) return;
    state.pending.delete(message.id);
    if (message.ok) {
      call.resolve(message.value);
      return;
    }
    call.reject(rebuildHostError(message));
  });
}
