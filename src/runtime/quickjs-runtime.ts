import { fabricFailureMetadata } from "../core/repair-error.js";
import { FABRIC_COMMIT_ACKNOWLEDGEMENT, type FabricFailureMetadata } from "../protocol.js";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import releaseSyncVariant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import { runAbortable, settleWithin } from "../async-settlement.js";
import { LocalShellExitError } from "../providers/local-shell.js";
import { ProbeRunExitError } from "../providers/probe-provider.js";
import { createGuestStackMap, remapGuestErrorText } from "./guest-stack-map.js";
import {
  assertFabricJsonBudget,
  fabricJsonText,
  MAX_FABRIC_JSON_CHARS,
} from "./json-budget.js";
import {
  effectiveFabricSourceLimit,
  fabricPayloadsLimitError,
  fabricSourceLimitError,
  fabricTranspiledLimitError,
} from "./source-limit.js";
import { FabricDeadline } from "./deadline.js";
import { DISABLED_TRACER, type FabricTracer } from "../trace/tracer.js";
import { assertFabricTranspiledWrapper, transpileFabricCodeWithSourceMap } from "./type-checker.js";
import { GUEST_SETUP } from "./guest-bootstrap.js";
import type { QuickJSContext, QuickJSDeferredPromise, QuickJSHandle } from "quickjs-emscripten-core";

export type FabricSandboxTerminationReason = "completed" | "runtime_error" | "timed_out" | "aborted";

export interface FabricSandboxResult {
  value: unknown;
  logs: string[];
  terminationReason: FabricSandboxTerminationReason;
  effectiveTimeoutMs: number;
  error?: string;
  failure?: FabricFailureMetadata;
}

export interface FabricSandboxOptions {
  timeoutMs: number;
  maxTimeoutMs: number;
  memoryLimitBytes: number;
  maxSourceBytes?: number;
  maxInputBytes?: number;
  maxLogChars?: number;
  maxNestedResultChars?: number;
  /** Maximum guest-to-host calls admitted concurrently across this execution. */
  maxConcurrentHostCalls?: number;
  payloads?: Record<string, string>;
  signal?: AbortSignal;
  minimumTimeoutMsForHostCall?(ref: string, args: Record<string, unknown>): number | undefined;
  transpiledCode?: string;
  transpiledSourceMap?: string;
  cleanupGraceMs?: number;
  /** Reports an exact action to a host that mirrors this sandbox's deadline, so
   * it can extend in step before any host-call slot is available. The guest
   * invokes this at API entry, ahead of its own semaphore. */
  onPrepareHostCall?(ref: string, args: Record<string, unknown>, deadline: FabricDeadline): void;
  /** Optional tracer; when absent (or disabled) each hook is one boolean
   * branch with no allocation. */
  tracer?: FabricTracer;
  execId?: string;
  /** Parent span (the service-level `execute` span) for sandbox spans. */
  parentSpanId?: string;
}

export type FabricHostCall = (
  ref: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  deadline: FabricDeadline,
) => Promise<unknown>;

type QuickJsModule = Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>>;

const QUICKJS_WASM_PAGE_BYTES = 65_536;
/** Emscripten declares a 16 MiB INITIAL_MEMORY for this variant and refuses a
 * smaller import, so no ceiling can be lower than this floor. */
const QUICKJS_WASM_FLOOR_BYTES = 16 * 1024 * 1024;

/** Total VM ceiling for one execution, rounded up to whole WebAssembly pages.
 *
 * `runtime.setMemoryLimit` accounts only for VM objects tracked by the QuickJS
 * allocator. ArrayBuffer and typed-array backing stores are taken straight from
 * the WebAssembly linear memory and are not covered by that accounting, so the
 * linear memory maximum is what actually bounds them: without a fixed maximum,
 * a guest can grow host memory past its configured limit. The ceiling is the
 * configured guest limit raised to the emscripten floor, and growth beyond it
 * fails the allocation instead of growing the host process without limit. */
const quickJsHeapCeilingBytes = (memoryLimitBytes: number): number =>
  Math.max(
    QUICKJS_WASM_FLOOR_BYTES,
    Math.ceil(memoryLimitBytes / QUICKJS_WASM_PAGE_BYTES) * QUICKJS_WASM_PAGE_BYTES,
  );

/** A fresh module and linear memory per execution. Guests never share a heap,
 * so one runaway allocation cannot consume another execution's capacity, and a
 * VM left unrecoverable by exhaustion is discarded with its module. */
const createQuickJsModule = (heapCeilingBytes: number): Promise<QuickJsModule> =>
  newQuickJSWASMModuleFromVariant(newVariant(releaseSyncVariant, {
    wasmMemory: new WebAssembly.Memory({
      initial: QUICKJS_WASM_FLOOR_BYTES / QUICKJS_WASM_PAGE_BYTES,
      maximum: heapCeilingBytes / QUICKJS_WASM_PAGE_BYTES,
    }),
  }));



const formatValue = (value: unknown, maxChars = 100_000): string => {
  if (typeof value === "string") return value.slice(0, maxChars);
  try { return fabricJsonText(value, Math.max(1, maxChars)); }
  catch { return "[value outside bounded JSON]"; }
};

const formatGuestFailure = (value: unknown): string => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { result: _diagnostic, ...message } = value as Record<string, unknown>;
    return formatValue(message);
  }
  return formatValue(value);
};
const jsonHandle = (
  context: QuickJSContext,
  jsonObject: QuickJSHandle,
  jsonParse: QuickJSHandle,
  value: unknown,
  maxChars?: number,
): QuickJSHandle => {
  if (value === undefined || value === null) return context.null;
  if (typeof value === "string") { assertFabricJsonBudget(value, maxChars); return context.newString(value); }
  if (typeof value === "boolean") return value ? context.true : context.false;
  if (typeof value === "number") {
    assertFabricJsonBudget(value, maxChars);
    return context.newNumber(value);
  }
  const serialized = context.newString(fabricJsonText(value, maxChars));
  try { return context.unwrapResult(context.callFunction(jsonParse, jsonObject, serialized)); }
  finally { serialized.dispose(); }
};

const QUICKJS_MAX_STACK_SIZE_BYTES = 256 * 1024;

/** VM-side execution body. It runs inside a dedicated worker thread so a
 * CPU-bound guest cannot block the host event loop, and it reaches the host
 * only through the bridge, tracer and options it is injected with. */
export const runQuickJsSandbox = async (code: string, hostCall: FabricHostCall, options: FabricSandboxOptions): Promise<FabricSandboxResult> => {
    const maximum = Math.max(1, Math.floor(options.maxTimeoutMs));
    const requestedTimeoutMs = Math.min(maximum, Math.max(1, Math.floor(options.timeoutMs)));
    if (options.signal?.aborted) return { value: undefined, logs: [], terminationReason: "aborted", error: "Execution cancelled", effectiveTimeoutMs: requestedTimeoutMs };
    const sourceLimit = effectiveFabricSourceLimit(options.maxSourceBytes);
    const inputLimit = effectiveFabricSourceLimit(options.maxInputBytes ?? options.maxSourceBytes);
    const inputError = fabricSourceLimitError(code, sourceLimit) ?? fabricPayloadsLimitError(options.payloads, inputLimit);
    if (inputError) return { value: undefined, logs: [], terminationReason: "runtime_error", error: inputError, effectiveTimeoutMs: requestedTimeoutMs };
    if (!Number.isSafeInteger(options.memoryLimitBytes) || options.memoryLimitBytes < 1 || options.memoryLimitBytes > 0xffff_ffff) {
      return { value: undefined, logs: [], terminationReason: "runtime_error", error: "QuickJS memory limit is outside the WASM32 range", effectiveTimeoutMs: requestedTimeoutMs };
    }

    // Host-side preparation happens before the deadline exists. Transpilation is
    // synchronous CPU work, and on a cold worker it can exceed a short guest
    // timeout on its own; charging it to the guest would expire the deadline
    // before a single guest instruction ran.
    const bundle = options.transpiledCode === undefined
      ? transpileFabricCodeWithSourceMap(code)
      : { code: options.transpiledCode, sourceMap: options.transpiledSourceMap };
    assertFabricTranspiledWrapper(bundle.code);
    const transpiledError = fabricTranspiledLimitError(bundle.code);
    if (transpiledError) {
      return { value: undefined, logs: [], terminationReason: "runtime_error", error: transpiledError, effectiveTimeoutMs: requestedTimeoutMs };
    }
    const stackMap = createGuestStackMap(bundle.sourceMap);
    const guestLineCount = bundle.code.split("\n").length;

    const tracer = options.tracer ?? DISABLED_TRACER;
    const execId = options.execId;
    const parentSpanId = options.parentSpanId;
    const heapCeilingBytes = quickJsHeapCeilingBytes(options.memoryLimitBytes);
    const moduleSpan = tracer.enabled ? tracer.span("init", "quickjs.module.acquire", execId, { shared: false, heapCeilingBytes }, parentSpanId) : undefined;
    const module = await createQuickJsModule(heapCeilingBytes);
    moduleSpan?.end();
    if (options.signal?.aborted) {
      return { value: undefined, logs: [], terminationReason: "aborted", error: "Execution cancelled", effectiveTimeoutMs: requestedTimeoutMs };
    }
    const contextSpan = tracer.enabled ? tracer.span("init", "quickjs.context.create", execId, undefined, parentSpanId) : undefined;
    const context = module.newContext();
    const runtime = context.runtime;
    contextSpan?.end({ memoryLimitBytes: options.memoryLimitBytes, stackSizeBytes: QUICKJS_MAX_STACK_SIZE_BYTES });
    const jsonObject = context.getProp(context.global, "JSON");
    const jsonParse = context.getProp(jsonObject, "parse");
    runtime.setMemoryLimit(options.memoryLimitBytes);
    runtime.setMaxStackSize(QUICKJS_MAX_STACK_SIZE_BYTES);

    const deadline = new FabricDeadline(requestedTimeoutMs, maximum);
    let interrupted = false;
    let timedOut = false;
    let closing = false;
    // Set during teardown so synchronous guest cleanup (including runaway
    // microtask loops) stops at the cleanup grace budget instead of running
    // until the execution deadline expires.
    let teardownCutoff: number | undefined;
    runtime.setInterruptHandler(() => {
      if (options.signal?.aborted) return true;
      if (teardownCutoff !== undefined && performance.now() >= teardownCutoff) return true;
      if (!deadline.expired) return false;
      interrupted = true;
      return true;
    });

    const logs: string[] = [];
    const maxLogChars = Math.max(0, options.maxLogChars ?? 100_000);
    let logChars = 0;
    const hostController = new AbortController();
    const bridgeTasks = new Set<Promise<void>>();
    const pendingPromises = new Set<QuickJSDeferredPromise>();
    let deadlineTimer: NodeJS.Timeout | undefined;
    let rejectDeadline: ((reason: Error) => void) | undefined;
    let abortListener: (() => void) | undefined;
    let activeHandle: QuickJSHandle | undefined;
    let runExecution: QuickJSHandle | undefined;
    let cancelExecution: QuickJSHandle | undefined;
    let logFormatter: QuickJSHandle | undefined;

    const rejectGuestGraph = (reason: Error): void => {
      if (cancelExecution && cancelExecution.alive !== false) {
        const message = context.newString(reason.message.slice(0, 4_096));
        const called = context.callFunction(cancelExecution, context.global, message);
        message.dispose();
        if (called.error) called.error.dispose(); else called.value.dispose();
      }
      for (const promise of pendingPromises) {
        if (promise.alive === false) continue;
        const handle = context.newError(reason.message.slice(0, 4_096));
        promise.reject(handle);
        handle.dispose();
      }
      for (let index = 0; index < 1_024; index++) {
        if (teardownCutoff !== undefined && performance.now() >= teardownCutoff) break;
        const jobs = runtime.executePendingJobs();
        if (jobs.error) { jobs.error.dispose(); break; }
        if (jobs.value === 0) break;
      }
    };
    const abortHost = (reason: Error): void => {
      if (!hostController.signal.aborted) hostController.abort(reason);
      rejectGuestGraph(reason);
    };
    const issuedFailures = new Map<string, FabricFailureMetadata>();
    const timeoutMessage = (): string => `Execution timed out after ${deadline.effectiveTimeoutMs}ms`;
    const expire = (): void => {
      if (closing || timedOut) return;
      if (!deadline.expired) { schedule(); return; }
      timedOut = true;
      const error = new Error(timeoutMessage());
      abortHost(error);
      rejectDeadline?.(error);
    };
    const schedule = (): void => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(expire, Math.max(0, deadline.remainingMs()));
    };
    const extendForExactAction = (ref: string, args: Record<string, unknown>): void => {
      options.onPrepareHostCall?.(ref, args, deadline);
      const floor = options.minimumTimeoutMsForHostCall?.(ref, args);
      if (typeof floor !== "number" || !Number.isFinite(floor)) return;
      const before = deadline.effectiveTimeoutMs;
      const next = deadline.extendTo(floor);
      if (next > before) schedule();
    };

    try {
      const hostFunction = context.newFunction("__fabricHostCall", (refHandle: QuickJSHandle, argsHandle: QuickJSHandle) => {
        const ref = context.getString(refHandle);
        const argsText = context.getString(argsHandle);
        const parsed: unknown = JSON.parse(argsText);
        const args = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
        assertFabricJsonBudget(args);
        extendForExactAction(ref, args);
        const promise = context.newPromise();
        pendingPromises.add(promise);
        void promise.settled.then(
          () => pendingPromises.delete(promise),
          () => pendingPromises.delete(promise),
        );
        const rejectGuestPromise = (error: unknown): void => {
          if (closing || promise.alive === false) return;
          const raw = error instanceof Error ? error.message : String(error);
          const handle = context.newError(raw.slice(0, 4_096));
          try {
            // Explicit trusted shell diagnostics only; never serialize arbitrary
            // error properties, approval data, causes, or cancellation reasons.
            if (error instanceof LocalShellExitError || error instanceof ProbeRunExitError) {
              const diagnostic = jsonHandle(context, jsonObject, jsonParse, error.result, options.maxNestedResultChars);
              try { context.setProp(handle, "result", diagnostic); } finally { diagnostic.dispose(); }
            }
            const failure = fabricFailureMetadata(error);
            if (failure) {
              const text = JSON.stringify(failure);
              if (issuedFailures.size >= 128) issuedFailures.delete(issuedFailures.keys().next().value!);
              issuedFailures.set(text, failure);
              const diagnostic = jsonHandle(context, jsonObject, jsonParse, failure, 32_000);
              try { context.setProp(handle, "failure", diagnostic); } finally { diagnostic.dispose(); }
            }
            promise.reject(handle);
          } finally { handle.dispose(); }
        };
        const raw = Promise.resolve().then(() => {
          deadline.throwIfExpired();
          return hostCall(ref, args, hostController.signal, deadline);
        });
        // Observe detached raw failures without allowing a non-cooperative host
        // operation to control sandbox cleanup or access a disposed context.
        void raw.catch(() => undefined);
        const task = runAbortable(hostController.signal, () => raw)
          .then((value) => {
            if (closing || promise.alive === false) return;
            try {
              deadline.throwIfExpired();
              const handle = context.newString(fabricJsonText(value, options.maxNestedResultChars));
              promise.resolve(handle);
              handle.dispose();
            } catch (error) {
              rejectGuestPromise(error);
            }
          }, rejectGuestPromise)
          .then(() => {
            if (!closing) runtime.executePendingJobs();
          }, () => {
            // All provider and bridge failures must settle in the guest rather
            // than becoming process-level unhandled rejections.
          });
        bridgeTasks.add(task);
        void task.then(
          () => bridgeTasks.delete(task),
          () => bridgeTasks.delete(task),
        );
        return promise.handle;
      });
      context.setProp(context.global, "__fabricHostCall", hostFunction);
      hostFunction.dispose();
      const prepareHostFunction = context.newFunction("__fabricPrepareHostCall", (refHandle: QuickJSHandle, argsHandle: QuickJSHandle) => {
        const ref = context.getString(refHandle);
        const parsed: unknown = JSON.parse(context.getString(argsHandle));
        const args = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
        assertFabricJsonBudget(args);
        extendForExactAction(ref, args);
      });
      context.setProp(context.global, "__fabricPrepareHostCall", prepareHostFunction);
      prepareHostFunction.dispose();

      const renderLogValue = (handle: QuickJSHandle, maxChars: number): string => {
        const limit = Math.max(0, Math.floor(maxChars));
        if (limit === 0) return "";
        // Format inside the VM so an over-cap string is sliced before it is
        // copied across the bridge. The host fallback still clamps the result,
        // so the configured character budget always holds.
        if (logFormatter && logFormatter.alive !== false) {
          const budget = context.newNumber(limit);
          try {
            const formatted = context.callFunction(logFormatter, context.undefined, handle, budget);
            if (!formatted.error) {
              try {
                const text = context.getString(formatted.value);
                return text.length > limit ? text.slice(0, limit) : text;
              } finally { formatted.value.dispose(); }
            }
            formatted.error.dispose();
          } catch { /* fall through to the host-side formatter */ }
          finally { budget.dispose(); }
        }
        return formatValue(context.dump(handle), limit).slice(0, limit);
      };
      const printFunction = context.newFunction("print", (...handles: QuickJSHandle[]) => {
        let remaining = maxLogChars - logChars;
        if (remaining <= 0) return;
        const parts: string[] = [];
        for (const handle of handles) {
          const separator = parts.length > 0 ? " " : "";
          if (remaining <= separator.length) break;
          const rendered = renderLogValue(handle, remaining - separator.length);
          parts.push(`${separator}${rendered}`);
          remaining -= separator.length + rendered.length;
        }
        const line = parts.join("");
        if (line) logs.push(line);
        logChars += line.length;
      });
      context.setProp(context.global, "print", printFunction);
      printFunction.dispose();
      const payloadHandle = jsonHandle(
        context,
        jsonObject,
        jsonParse,
        options.payloads ?? {},
        MAX_FABRIC_JSON_CHARS,
      );
      context.setProp(context.global, "payloads", payloadHandle);
      payloadHandle.dispose();
      const parallelLimitHandle = context.newNumber(Math.max(1, Math.min(64, Math.floor(options.maxConcurrentHostCalls ?? 1))));
      context.setProp(context.global, "__fabricMaxParallelConcurrency", parallelLimitHandle);
      parallelLimitHandle.dispose();

      const setupSpan = tracer.enabled ? tracer.span("eval", "quickjs.eval.setup", execId, { sourceBytes: GUEST_SETUP.length }, parentSpanId) : undefined;
      const setup = context.evalCode(GUEST_SETUP, "kiro-fabric-setup.js");
      setupSpan?.end();
      if (setup.error) {
        const error = formatValue(context.dump(setup.error));
        setup.error.dispose();
        return { value: undefined, logs, terminationReason: "runtime_error", error, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
      }
      runExecution = context.getProp(setup.value, "run");
      cancelExecution = context.getProp(setup.value, "cancel");
      logFormatter = context.getProp(setup.value, "boundLog");
      setup.value.dispose();

      const guestEvalSpan = tracer.enabled ? tracer.span("eval", "quickjs.eval.guest", execId, { sourceBytes: Buffer.byteLength(bundle.code, "utf8") }, parentSpanId) : undefined;
      const evaluation = context.evalCode(bundle.code, "kiro-fabric-guest.js");
      runtime.executePendingJobs();
      guestEvalSpan?.end();
      if (evaluation.error) {
        const deadlineExceeded = interrupted || deadline.expired;
        const error = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatValue(context.dump(evaluation.error)), stackMap, guestLineCount);
        evaluation.error.dispose();
        abortHost(new Error(error));
        return { value: undefined, logs, terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error", error, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
      }
      evaluation.value.dispose();
      const main = context.getProp(context.global, "__kiroFabricMain");
      context.setProp(context.global, "__kiroFabricMain", context.undefined);
      const invoked = context.callFunction(runExecution, context.undefined, main);
      main.dispose();
      if (invoked.error) {
        const error = remapGuestErrorText(formatValue(context.dump(invoked.error)), stackMap, guestLineCount);
        invoked.error.dispose();
        return { value: undefined, logs, terminationReason: deadline.expired ? "timed_out" : "runtime_error", error: deadline.expired ? timeoutMessage() : error, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
      }
      activeHandle = invoked.value;
      const resolution = context.resolvePromise(activeHandle);
      runtime.executePendingJobs();
      const deadlineRace = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; schedule(); });
      const cancellation = new Promise<never>((_resolve, reject) => {
        abortListener = () => { const error = new Error("Execution cancelled"); abortHost(error); reject(error); };
        if (options.signal?.aborted) abortListener();
        else options.signal?.addEventListener("abort", abortListener, { once: true });
      });
      const runSpan = tracer.enabled ? tracer.span("eval", "quickjs.run", execId, undefined, parentSpanId) : undefined;
      const settled = await Promise.race([resolution, deadlineRace, cancellation]);
      activeHandle.dispose();
      activeHandle = undefined;
      runSpan?.end();
      if (settled.error) {
        const deadlineExceeded = timedOut || interrupted || deadline.expired;
        const error = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatGuestFailure(context.dump(settled.error)), stackMap, guestLineCount);
        const failureHandle = context.getProp(settled.error, "failure");
        let failure: FabricFailureMetadata | undefined;
        try { failure = issuedFailures.get(JSON.stringify(context.dump(failureHandle))); }
        finally { failureHandle.dispose(); }
        settled.error.dispose();
        abortHost(new Error(error));
        return { value: undefined, logs, terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded || failure?.code === "timeout" ? "timed_out" : "runtime_error", error, ...(failure ? { failure } : {}), effectiveTimeoutMs: deadline.effectiveTimeoutMs };
      }
      const serialized = context.getString(settled.value);
      settled.value.dispose();
      const value: unknown = JSON.parse(serialized);
      // Nested ceilings apply to individual host calls, not the composed final result.
      // The execution service separately enforces the configured artifact/output ceiling.
      assertFabricJsonBudget(value, MAX_FABRIC_JSON_CHARS);
      deadline.throwIfExpired();
      return { value, logs, terminationReason: "completed", effectiveTimeoutMs: deadline.effectiveTimeoutMs };
    } catch (error) {
      const deadlineExceeded = timedOut || interrupted || deadline.expired;
      const message = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : error instanceof Error ? error.message : String(error);
      abortHost(new Error(message));
      return { value: undefined, logs, terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error", error: message, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
    } finally {
      if (tracer.enabled) {
        // Snapshot VM heap state while the runtime is still alive. Numeric
        // counters come from JS_ComputeMemoryUsage so traces can be trended
        // programmatically; failure must not affect cleanup.
        try {
          const usageHandle = runtime.computeMemoryUsage();
          try {
            const raw = context.dump(usageHandle) as Record<string, unknown>;
            const usage: Record<string, number> = {};
            for (const [key, entry] of Object.entries(raw)) if (typeof entry === "number" && Number.isFinite(entry)) usage[key] = entry;
            tracer.event("eval", "quickjs.memory", execId, { usage, hostRssBytes: process.memoryUsage().rss });
          } finally { usageHandle.dispose(); }
        } catch { /* runtime may be unrecoverable after hard interruption */ }
      }
      const teardownSpan = tracer.enabled ? tracer.span("teardown", "quickjs.teardown", execId, undefined, parentSpanId) : undefined;
      closing = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (abortListener) options.signal?.removeEventListener("abort", abortListener);
      // Teardown is bounded by the cleanup grace budget, not the execution
      // deadline. A guest that leaves an unbounded microtask loop behind must
      // not extend cancellation to the full configured timeout.
      teardownCutoff = performance.now() + Math.max(0, options.cleanupGraceMs ?? 100);
      abortHost(new Error("Execution request ended"));
      await settleWithin(bridgeTasks, Math.max(0, options.cleanupGraceMs ?? 100));
      for (let index = 0; index < 1_024; index++) {
        if (performance.now() >= teardownCutoff) break;
        const jobs = runtime.executePendingJobs();
        if (jobs.error) { jobs.error.dispose(); break; }
        if (jobs.value === 0) break;
      }
      // Never let an attacker-controlled promise or non-cooperative provider
      // decide when cancellation returns. All continuations check `closing`
      // before touching QuickJS, so unresolved host work can be safely detached.
      if (activeHandle?.alive !== false) activeHandle?.dispose();
      for (const promise of pendingPromises) if (promise.alive !== false) promise.dispose();
      if (cancelExecution && cancelExecution.alive !== false) cancelExecution.dispose();
      if (runExecution && runExecution.alive !== false) runExecution.dispose();
      if (logFormatter && logFormatter.alive !== false) logFormatter.dispose();
      jsonParse.dispose();
      jsonObject.dispose();
      context.dispose();
      teardownSpan?.end();
    }
};

// ── Worker transport ────────────────────────────────────────────────────────
//
// The VM runs in its own thread because guest JavaScript executes
// synchronously: an in-process guest holds the host event loop for the whole
// synchronous run, delaying unrelated requests and even the delivery of its own
// cancellation. Only the VM crosses the boundary. Approvals, audit ordering,
// effect settlement, tracing and the canonical host bridge stay on the host.

interface SandboxWorkerOptions {
  timeoutMs: number;
  maxTimeoutMs: number;
  memoryLimitBytes: number;
  maxSourceBytes?: number;
  maxInputBytes?: number;
  maxLogChars?: number;
  maxNestedResultChars?: number;
  maxConcurrentHostCalls?: number;
  payloads?: Record<string, string>;
  transpiledCode?: string;
  transpiledSourceMap?: string;
  cleanupGraceMs?: number;
  tracerEnabled: boolean;
  execId?: string;
  parentSpanId?: string;
}

export type SandboxWorkerRequest =
  | { type: "run"; code: string; options: SandboxWorkerOptions }
  | {
      type: "hostResult";
      id: number;
      ok: boolean;
      value?: unknown;
      error?: string;
      failure?: FabricFailureMetadata;
      shellKind?: "shell" | "probe";
      shellResult?: unknown;
      /** Post-commit acknowledgement. It is a symbol-keyed marker on the host
       * error, so it cannot survive structured cloning and must be carried
       * explicitly or a committed mutation would read as an ordinary failure. */
      committed?: { version: 1; operation: string };
    }
  | { type: "extend"; floorMs: number; id?: number }
  | { type: "expire" }
  | { type: "abort"; message: string };

export type SandboxWorkerMessage =
  | { type: "hostCall"; id: number; ref: string; args: Record<string, unknown> }
  | { type: "prepare"; ref: string; args: Record<string, unknown> }
  | { type: "spanStart"; token: number; cat: string; ev: string; execId?: string; parentId?: string; data?: Record<string, unknown> }
  | { type: "spanEnd"; token: number; data?: Record<string, unknown> }
  | { type: "event"; cat: string; ev: string; execId?: string; data?: Record<string, unknown> }
  | { type: "hostAbort"; message: string }
  | { type: "flush" }
  | { type: "result"; result: FabricSandboxResult }
  | { type: "fatal"; message: string };

/** Idle window before a spare worker is retired. */
const SANDBOX_WORKER_IDLE_MS = 10_000;
/** Extra margin past a deadline and its cleanup grace before the host declares
 * a worker unresponsive and terminates it. */
const SANDBOX_WORKER_BACKSTOP_MS = 1_000;
/** JS heap bound for the worker thread. The VM heap is bounded separately by
 * the linear-memory ceiling; this only bounds the transport's own JSON work. */
const SANDBOX_WORKER_MEMORY_MB = 256;

/** Source and built layouts differ, exactly as for the compiler worker. */
const sandboxWorkerUrl = (): URL => import.meta.url.endsWith(".ts")
  ? new URL("../../dist/runtime/sandbox-worker-entry.js", import.meta.url)
  : new URL("../runtime/sandbox-worker-entry.js", import.meta.url);

interface SandboxWorkerSlot {
  worker: Worker;
  busy: boolean;
  idleTimer: NodeJS.Timeout | undefined;
  handler: ((message: SandboxWorkerMessage) => void) | undefined;
  fault: ((message: string) => void) | undefined;
}

/** Host-side failure transfer. Class identity cannot cross the boundary, so the
 * shape is rebuilt in the worker instead of being stringified away. */
const transferredHostFailure = (error: unknown): Pick<Extract<SandboxWorkerRequest, { type: "hostResult" }>, "error" | "failure" | "shellKind" | "shellResult"> => {
  const failure = fabricFailureMetadata(error);
  const shellKind = error instanceof LocalShellExitError ? "shell" as const : error instanceof ProbeRunExitError ? "probe" as const : undefined;
  const acknowledgement = (error as { [FABRIC_COMMIT_ACKNOWLEDGEMENT]?: unknown } | null | undefined)?.[FABRIC_COMMIT_ACKNOWLEDGEMENT];
  const committed = acknowledgement && typeof acknowledgement === "object" &&
    (acknowledgement as { version?: unknown }).version === 1 && typeof (acknowledgement as { operation?: unknown }).operation === "string"
    ? { version: 1 as const, operation: (acknowledgement as { operation: string }).operation }
    : undefined;
  return {
    error: (error instanceof Error ? error.message : String(error)).slice(0, 4_096),
    ...(failure ? { failure } : {}),
    ...(shellKind ? { shellKind } : {}),
    ...(shellKind ? { shellResult: (error as LocalShellExitError | ProbeRunExitError).result } : {}),
    ...(committed ? { committed } : {}),
  };
};

const sandboxCancelledResult = (effectiveTimeoutMs: number): FabricSandboxResult => ({
  value: undefined, logs: [], terminationReason: "aborted", error: "Execution cancelled", effectiveTimeoutMs,
});

/** One pooled worker thread per concurrent execution. A worker serves one
 * execution at a time and is discarded, never reused, after a fault, a deadline
 * overrun or an abort that outlived its grace. */
export class QuickJsRuntime {
  readonly #slots = new Set<SandboxWorkerSlot>();
  #idle: SandboxWorkerSlot | undefined;
  #closed = false;

  #spawn(): SandboxWorkerSlot {
    const worker = new Worker(sandboxWorkerUrl(), {
      resourceLimits: { maxOldGenerationSizeMb: SANDBOX_WORKER_MEMORY_MB, stackSizeMb: 4 },
    });
    const slot: SandboxWorkerSlot = { worker, busy: false, idleTimer: undefined, handler: undefined, fault: undefined };
    // Never let a pooled sandbox thread keep the host process alive.
    worker.unref();
    worker.on("message", (message: SandboxWorkerMessage) => slot.handler?.(message));
    worker.on("error", (error: unknown) => {
      this.#drop(slot);
      slot.fault?.(error instanceof Error ? error.message : String(error));
    });
    worker.on("exit", (code: number) => {
      this.#drop(slot);
      slot.fault?.(`Sandbox worker exited before replying (${code})`);
    });
    this.#slots.add(slot);
    return slot;
  }

  #drop(slot: SandboxWorkerSlot): void {
    if (slot.idleTimer) { clearTimeout(slot.idleTimer); slot.idleTimer = undefined; }
    if (this.#idle === slot) this.#idle = undefined;
    this.#slots.delete(slot);
  }

  #terminate(slot: SandboxWorkerSlot): Promise<void> {
    this.#drop(slot);
    return slot.worker.terminate().catch(() => undefined).then(() => undefined);
  }

  #acquire(): SandboxWorkerSlot {
    const idle = this.#idle;
    if (idle && !idle.busy) {
      this.#idle = undefined;
      if (idle.idleTimer) { clearTimeout(idle.idleTimer); idle.idleTimer = undefined; }
      return idle;
    }
    return this.#spawn();
  }

  /** Retain at most one warm worker: concurrent completions must not accumulate
   * idle threads, and a retired worker must not linger. */
  #release(slot: SandboxWorkerSlot): void {
    slot.busy = false;
    slot.handler = undefined;
    slot.fault = undefined;
    if (this.#closed || this.#idle !== undefined) { void this.#terminate(slot); return; }
    this.#idle = slot;
    slot.idleTimer = setTimeout(() => { void this.#terminate(slot); }, SANDBOX_WORKER_IDLE_MS);
    slot.idleTimer.unref();
  }

  /** Containment boundary. A worker fault, a WebAssembly-level abort, or an
   * unresponsive thread must surface as a controlled result rather than
   * rejecting the caller's execution or escaping into the host service. */
  async execute(code: string, hostCall: FabricHostCall, options: FabricSandboxOptions): Promise<FabricSandboxResult> {
    const maximum = Math.max(1, Math.floor(options.maxTimeoutMs));
    const requestedTimeoutMs = Math.min(maximum, Math.max(1, Math.floor(options.timeoutMs)));
    // Reject impossible input before paying for a thread. The sandbox repeats
    // every one of these checks inside the worker.
    if (options.signal?.aborted) return sandboxCancelledResult(requestedTimeoutMs);
    const sourceLimit = effectiveFabricSourceLimit(options.maxSourceBytes);
    const inputLimit = effectiveFabricSourceLimit(options.maxInputBytes ?? options.maxSourceBytes);
    const inputError = fabricSourceLimitError(code, sourceLimit) ?? fabricPayloadsLimitError(options.payloads, inputLimit);
    if (inputError) return { value: undefined, logs: [], terminationReason: "runtime_error", error: inputError, effectiveTimeoutMs: requestedTimeoutMs };
    if (!Number.isSafeInteger(options.memoryLimitBytes) || options.memoryLimitBytes < 1 || options.memoryLimitBytes > 0xffff_ffff) {
      return { value: undefined, logs: [], terminationReason: "runtime_error", error: "QuickJS memory limit is outside the WASM32 range", effectiveTimeoutMs: requestedTimeoutMs };
    }
    if (this.#closed) return { value: undefined, logs: [], terminationReason: "runtime_error", error: "Sandbox runtime is closed", effectiveTimeoutMs: requestedTimeoutMs };
    try {
      return await this.#runInWorker(code, hostCall, options, requestedTimeoutMs, maximum);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const tracer = options.tracer ?? DISABLED_TRACER;
      if (tracer.enabled) tracer.event("teardown", "quickjs.fault", options.execId, { contained: true });
      return {
        value: undefined,
        logs: [],
        terminationReason: "runtime_error",
        error: `Virtual machine fault: ${detail}`.slice(0, 4_096),
        effectiveTimeoutMs: requestedTimeoutMs,
      };
    }
  }

  async #runInWorker(
    code: string,
    hostCall: FabricHostCall,
    options: FabricSandboxOptions,
    requestedTimeoutMs: number,
    maximum: number,
  ): Promise<FabricSandboxResult> {
    const slot = this.#acquire();
    slot.busy = true;
    const tracer = options.tracer ?? DISABLED_TRACER;
    const controller = new AbortController();
    // The mirrored host deadline is created on first bridge contact, after the
    // worker has actually started. Worker startup and VM initialization must
    // not consume the guest's execution allowance. The worker stays the
    // authority on the deadline; this mirror only feeds provider checks and the
    // exact-action floors, so it must never expire ahead of the worker's own.
    let mirror: FabricDeadline | undefined;
    const hostDeadline = (): FabricDeadline => mirror ??= new FabricDeadline(requestedTimeoutMs, maximum);
    const cleanupGraceMs = Math.max(0, options.cleanupGraceMs ?? 100);
    const spans = new Map<number, ReturnType<FabricTracer["span"]>>();
    let deadlineCeilingMs = requestedTimeoutMs;
    let settled = false;
    let backstop: NodeJS.Timeout | undefined;

    const onAbort = (): void => {
      const reason = options.signal?.reason instanceof Error ? options.signal.reason : new Error("Execution cancelled");
      if (!controller.signal.aborted) controller.abort(reason);
      slot.worker.postMessage({ type: "abort", message: reason.message.slice(0, 4_096) } satisfies SandboxWorkerRequest);
    };

    try {
      return await new Promise<FabricSandboxResult>((resolve, reject) => {
        const detach = (): void => {
          if (backstop) clearTimeout(backstop);
          options.signal?.removeEventListener("abort", onAbort);
        };
        const settle = (result: FabricSandboxResult): void => {
          if (settled) return;
          settled = true;
          detach();
          this.#release(slot);
          resolve(result);
        };
        const fault = (message: string): void => {
          if (settled) return;
          settled = true;
          detach();
          void this.#terminate(slot);
          reject(new Error(message));
        };
        slot.fault = fault;
        slot.handler = (message) => {
          if (message.type === "prepare" || message.type === "hostCall") {
            // Exactly the sequence the in-process bridge used: the host decides
            // the floor from the canonical ref and args and extends in step.
            const deadline = hostDeadline();
            const floor = options.minimumTimeoutMsForHostCall?.(message.ref, message.args);
            if (typeof floor === "number" && Number.isFinite(floor)) {
              deadline.extendTo(floor);
              deadlineCeilingMs = Math.max(deadlineCeilingMs, floor);
              slot.worker.postMessage({ type: "extend", floorMs: floor, ...(message.type === "hostCall" ? { id: message.id } : {}) } satisfies SandboxWorkerRequest);
            }
            if (message.type === "prepare") return;
          }
          if (message.type === "hostCall") {
            const call = Promise.resolve().then(() => {
              const deadline = hostDeadline();
              try {
                deadline.throwIfExpired();
              } catch (error) {
                // The host clock is authoritative for the guest window, but the
                // VM thread cannot see it. Tell the VM to expire too, or the
                // guest would report an ordinary failure instead of a timeout.
                slot.worker.postMessage({ type: "expire" } satisfies SandboxWorkerRequest);
                throw error;
              }
              return hostCall(message.ref, message.args, controller.signal, deadline);
            });
            // A detached failure must not become an unhandled rejection; the
            // guest learns about it through this structured reply.
            void call.catch(() => undefined);
            void call.then(
              (value) => slot.worker.postMessage({ type: "hostResult", id: message.id, ok: true, value } satisfies SandboxWorkerRequest),
              (error: unknown) => {
                // A provider can observe the host window closing after it already
                // published (post-commit acknowledgement). The VM must classify
                // that rejection as the timeout the host saw, not as a plain
                // provider failure, or the committed effect would be misreported.
                if (hostDeadline().expired) slot.worker.postMessage({ type: "expire" } satisfies SandboxWorkerRequest);
                slot.worker.postMessage({ type: "hostResult", id: message.id, ok: false, ...transferredHostFailure(error) } satisfies SandboxWorkerRequest);
              },
            );
            return;
          }
          if (message.type === "spanStart") {
            spans.set(message.token, tracer.span(message.cat as Parameters<FabricTracer["span"]>[0], message.ev, message.execId, message.data, message.parentId));
            return;
          }
          if (message.type === "spanEnd") {
            const span = spans.get(message.token);
            spans.delete(message.token);
            span?.end(message.data);
            return;
          }
          if (message.type === "event") {
            tracer.event(message.cat as Parameters<FabricTracer["event"]>[0], message.ev, message.execId, message.data);
            return;
          }
          if (message.type === "hostAbort") {
            // The VM's own deadline or cancellation ended the guest's wait. In
            // the in-process design the sandbox and the providers shared one
            // signal, so in-flight provider work must still be aborted here or
            // it would outlive the execution that asked for it.
            if (!controller.signal.aborted) controller.abort(new Error(message.message));
            return;
          }
          if (message.type === "flush") { tracer.flush(); return; }
          if (message.type === "result") { settle(message.result); return; }
          fault(message.message);
        };
        backstop = setTimeout(() => {
          if (settled) return;
          settled = true;
          const timedOut = mirror?.expired === true;
          void this.#terminate(slot);
          options.signal?.removeEventListener("abort", onAbort);
          resolve(timedOut
            ? { value: undefined, logs: [], terminationReason: "timed_out", error: `Execution timed out after ${mirror?.effectiveTimeoutMs ?? requestedTimeoutMs}ms`, effectiveTimeoutMs: mirror?.effectiveTimeoutMs ?? requestedTimeoutMs }
            : sandboxCancelledResult(mirror?.effectiveTimeoutMs ?? requestedTimeoutMs));
        }, deadlineCeilingMs + cleanupGraceMs + SANDBOX_WORKER_BACKSTOP_MS);
        backstop.unref();
        options.signal?.addEventListener("abort", onAbort, { once: true });
        if (options.signal?.aborted) onAbort();
        slot.worker.postMessage({
          type: "run",
          code,
          options: {
            timeoutMs: options.timeoutMs,
            maxTimeoutMs: options.maxTimeoutMs,
            memoryLimitBytes: options.memoryLimitBytes,
            ...(options.maxSourceBytes === undefined ? {} : { maxSourceBytes: options.maxSourceBytes }),
            ...(options.maxInputBytes === undefined ? {} : { maxInputBytes: options.maxInputBytes }),
            ...(options.maxLogChars === undefined ? {} : { maxLogChars: options.maxLogChars }),
            ...(options.maxNestedResultChars === undefined ? {} : { maxNestedResultChars: options.maxNestedResultChars }),
            ...(options.maxConcurrentHostCalls === undefined ? {} : { maxConcurrentHostCalls: options.maxConcurrentHostCalls }),
            ...(options.payloads === undefined ? {} : { payloads: options.payloads }),
            ...(options.transpiledCode === undefined ? {} : { transpiledCode: options.transpiledCode }),
            ...(options.transpiledSourceMap === undefined ? {} : { transpiledSourceMap: options.transpiledSourceMap }),
            ...(options.cleanupGraceMs === undefined ? {} : { cleanupGraceMs: options.cleanupGraceMs }),
            tracerEnabled: tracer.enabled,
            ...(options.execId === undefined ? {} : { execId: options.execId }),
            ...(options.parentSpanId === undefined ? {} : { parentSpanId: options.parentSpanId }),
          },
        } satisfies SandboxWorkerRequest);
      });
    } catch (error) {
      void this.#terminate(slot);
      throw error;
    }
  }

  /** Terminates every pooled thread. Callers that stop serving must close, or
   * idle workers wait out their window before retiring. */
  close(): Promise<void> {
    this.#closed = true;
    const slots = [...this.#slots];
    this.#idle = undefined;
    return Promise.all(slots.map((slot) => this.#terminate(slot))).then(() => undefined);
  }
}
