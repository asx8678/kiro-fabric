import releaseSyncVariant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import { performance } from "node:perf_hooks";
import { runAbortable, settleWithin } from "../async-settlement.js";
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
import { transpileFabricCodeWithSourceMap } from "./type-checker.js";

export type FabricSandboxTerminationReason = "completed" | "runtime_error" | "timed_out" | "aborted";

export interface FabricSandboxResult {
  value: unknown;
  logs: string[];
  terminationReason: FabricSandboxTerminationReason;
  error?: string;
}

export interface FabricSandboxOptions {
  timeoutMs: number;
  maxTimeoutMs: number;
  memoryLimitBytes: number;
  maxSourceBytes?: number;
  maxInputBytes?: number;
  maxLogChars?: number;
  maxNestedResultChars?: number;
  payloads?: Record<string, string>;
  signal?: AbortSignal;
  minimumTimeoutMsForHostCall?(ref: string, args: Record<string, unknown>): number | undefined;
  transpiledCode?: string;
  transpiledSourceMap?: string;
}

export type FabricHostCall = (
  ref: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;

type QuickJsModule = Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>>;
let modulePromise: Promise<QuickJsModule> | undefined;
const quickJsModule = (): Promise<QuickJsModule> =>
  modulePromise ??= newQuickJSWASMModuleFromVariant(releaseSyncVariant);

const GUEST_SETUP = `
(() => {
  const bridge = globalThis.__fabricHostCall;
  delete globalThis.__fabricHostCall;
  const call = (ref, args = {}) => bridge(ref, args);
  globalThis.tools = Object.freeze({
    providers: () => call("fabric.providers"),
    list: () => call("fabric.list"),
    search: (input) => call("fabric.search", typeof input === "string" ? { query: input } : input),
    describe: (input) => call("fabric.describe", typeof input === "string" ? { ref: input } : input),
    call: (input) => call("fabric.call", input),
  });
  globalThis.artifacts = Object.freeze({ read: (args) => call("artifacts.read", args) });
  globalThis.memory = Object.freeze({
    get: (args) => call("memory.get", args),
    set: (args) => call("memory.set", args),
    search: (args) => call("memory.search", args),
    index: (args = {}) => call("memory.index", args),
  });
  globalThis.state = Object.freeze({
    get: (args) => call("state.get", args),
    set: (args) => call("state.set", args),
    list: (args = {}) => call("state.list", args),
    delete: (args) => call("state.delete", args),
  });
  globalThis.mcp = Object.freeze({
    servers: (args = {}) => call("mcp.$servers", args),
    call: (args) => call("mcp.$call", args),
  });
  Object.freeze(globalThis.payloads);
})();
`;

const formatValue = (value: unknown, maxChars = 100_000): string => {
  if (typeof value === "string") return value.slice(0, maxChars);
  try { return fabricJsonText(value, Math.max(1, maxChars)); }
  catch { return "[value outside bounded JSON]"; }
};

const jsonHandle = (
  context: any,
  jsonObject: any,
  jsonParse: any,
  value: unknown,
  maxChars?: number,
): any => {
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
const HOST_SETTLE_GRACE_MS = 1_500;
const GC_ASSERTION = "list_empty(&rt->gc_obj_list)";
const disposeContext = (context: any): void => {
  try { context.dispose(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(GC_ASSERTION)) throw error;
  }
};

export class QuickJsRuntime {
  async execute(code: string, hostCall: FabricHostCall, options: FabricSandboxOptions): Promise<FabricSandboxResult> {
    if (options.signal?.aborted) return { value: undefined, logs: [], terminationReason: "aborted", error: "Execution cancelled" };
    const sourceLimit = effectiveFabricSourceLimit(options.maxSourceBytes);
    const inputLimit = effectiveFabricSourceLimit(options.maxInputBytes ?? options.maxSourceBytes);
    const inputError = fabricSourceLimitError(code, sourceLimit) ?? fabricPayloadsLimitError(options.payloads, inputLimit);
    if (inputError) return { value: undefined, logs: [], terminationReason: "runtime_error", error: inputError };
    if (!Number.isSafeInteger(options.memoryLimitBytes) || options.memoryLimitBytes < 1 || options.memoryLimitBytes > 0xffff_ffff) {
      return { value: undefined, logs: [], terminationReason: "runtime_error", error: "QuickJS memory limit is outside the WASM32 range" };
    }

    const module = await quickJsModule();
    if (options.signal?.aborted) {
      return { value: undefined, logs: [], terminationReason: "aborted", error: "Execution cancelled" };
    }
    const context = module.newContext();
    const runtime = context.runtime;
    const jsonObject = context.getProp(context.global, "JSON");
    const jsonParse = context.getProp(jsonObject, "parse");
    runtime.setMemoryLimit(options.memoryLimitBytes);
    runtime.setMaxStackSize(QUICKJS_MAX_STACK_SIZE_BYTES);

    const started = performance.now();
    const maximum = Math.max(1, Math.floor(options.maxTimeoutMs));
    let effectiveTimeoutMs = Math.min(maximum, Math.max(1, Math.floor(options.timeoutMs)));
    let deadlineAt = started + effectiveTimeoutMs;
    let interrupted = false;
    let timedOut = false;
    let closing = false;
    runtime.setInterruptHandler(() => {
      if (options.signal?.aborted) return true;
      if (performance.now() <= deadlineAt) return false;
      interrupted = true;
      return true;
    });

    const logs: string[] = [];
    const maxLogChars = Math.max(0, options.maxLogChars ?? 100_000);
    let logChars = 0;
    const hostController = new AbortController();
    const hostTasks = new Set<Promise<void>>();
    const pendingPromises = new Set<any>();
    let deadlineTimer: NodeJS.Timeout | undefined;
    let rejectDeadline: ((reason: Error) => void) | undefined;
    let abortListener: (() => void) | undefined;
    let activeHandle: any;

    const abortHost = (reason: Error): void => {
      if (!hostController.signal.aborted) hostController.abort(reason);
    };
    const timeoutMessage = (): string => `Execution timed out after ${effectiveTimeoutMs}ms`;
    const expire = (): void => {
      if (closing || timedOut) return;
      timedOut = true;
      const error = new Error(timeoutMessage());
      abortHost(error);
      rejectDeadline?.(error);
    };
    const schedule = (): void => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(expire, Math.max(0, deadlineAt - performance.now()));
      deadlineTimer.unref?.();
    };
    const extendForExactAction = (ref: string, args: Record<string, unknown>): void => {
      const floor = options.minimumTimeoutMsForHostCall?.(ref, args);
      if (typeof floor !== "number" || !Number.isFinite(floor)) return;
      const next = Math.min(maximum, Math.max(effectiveTimeoutMs, Math.max(1, Math.floor(floor))));
      if (next <= effectiveTimeoutMs) return;
      effectiveTimeoutMs = next;
      deadlineAt = started + next;
      schedule();
    };

    try {
      const hostFunction = context.newFunction("__fabricHostCall", (refHandle: any, argsHandle: any) => {
        const ref = context.getString(refHandle);
        const dumped = context.dump(argsHandle);
        const args = typeof dumped === "object" && dumped !== null && !Array.isArray(dumped)
          ? dumped as Record<string, unknown>
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
          promise.reject(handle);
          handle.dispose();
        };
        const task = runAbortable(hostController.signal, () => hostCall(ref, args, hostController.signal))
          .then((value) => {
            if (closing || promise.alive === false) return;
            try {
              const handle = jsonHandle(
                context,
                jsonObject,
                jsonParse,
                value,
                options.maxNestedResultChars,
              );
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
        hostTasks.add(task);
        void task.then(
          () => hostTasks.delete(task),
          () => hostTasks.delete(task),
        );
        return promise.handle;
      });
      context.setProp(context.global, "__fabricHostCall", hostFunction);
      hostFunction.dispose();

      const printFunction = context.newFunction("print", (...handles: any[]) => {
        let remaining = maxLogChars - logChars;
        if (remaining <= 0) return;
        const parts: string[] = [];
        for (const handle of handles) {
          const separator = parts.length > 0 ? " " : "";
          if (remaining <= separator.length) break;
          const rendered = formatValue(context.dump(handle), remaining - separator.length);
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

      const setup = context.evalCode(GUEST_SETUP, "kiro-fabric-setup.js");
      if (setup.error) {
        const error = formatValue(context.dump(setup.error));
        setup.error.dispose();
        return { value: undefined, logs, terminationReason: "runtime_error", error };
      }
      setup.value.dispose();

      const bundle = options.transpiledCode === undefined
        ? transpileFabricCodeWithSourceMap(code)
        : { code: options.transpiledCode, sourceMap: options.transpiledSourceMap };
      const transpiledError = fabricTranspiledLimitError(bundle.code);
      if (transpiledError) return { value: undefined, logs, terminationReason: "runtime_error", error: transpiledError };
      const stackMap = createGuestStackMap(bundle.sourceMap);
      const guestLineCount = bundle.code.split("\n").length;
      const evaluation = context.evalCode(`${bundle.code}\n__kiroFabricMain()`, "kiro-fabric-guest.js");
      runtime.executePendingJobs();
      if (evaluation.error) {
        const deadlineExceeded = interrupted || performance.now() > deadlineAt;
        const error = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatValue(context.dump(evaluation.error)), stackMap, guestLineCount);
        evaluation.error.dispose();
        abortHost(new Error(error));
        return { value: undefined, logs, terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error", error };
      }
      activeHandle = evaluation.value;
      const resolution = context.resolvePromise(activeHandle);
      runtime.executePendingJobs();
      const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; schedule(); });
      const cancellation = new Promise<never>((_resolve, reject) => {
        abortListener = () => { const error = new Error("Execution cancelled"); abortHost(error); reject(error); };
        if (options.signal?.aborted) abortListener();
        else options.signal?.addEventListener("abort", abortListener, { once: true });
      });
      const settled = await Promise.race([resolution, deadline, cancellation]);
      activeHandle.dispose();
      activeHandle = undefined;
      if (settled.error) {
        const deadlineExceeded = timedOut || interrupted || performance.now() > deadlineAt;
        const error = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatValue(context.dump(settled.error)), stackMap, guestLineCount);
        settled.error.dispose();
        abortHost(new Error(error));
        return { value: undefined, logs, terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error", error };
      }
      const value = context.dump(settled.value);
      settled.value.dispose();
      return { value, logs, terminationReason: "completed" };
    } catch (error) {
      const message = options.signal?.aborted ? "Execution cancelled" : timedOut || interrupted ? timeoutMessage() : error instanceof Error ? error.message : String(error);
      abortHost(new Error(message));
      return { value: undefined, logs, terminationReason: options.signal?.aborted ? "aborted" : timedOut || interrupted ? "timed_out" : "runtime_error", error: message };
    } finally {
      closing = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (abortListener) options.signal?.removeEventListener("abort", abortListener);
      abortHost(new Error("Execution request ended"));
      await settleWithin(hostTasks, HOST_SETTLE_GRACE_MS);
      if (activeHandle?.alive !== false) activeHandle?.dispose();
      for (const promise of pendingPromises) if (promise.alive !== false) promise.dispose();
      jsonParse.dispose();
      jsonObject.dispose();
      disposeContext(context);
    }
  }
}
