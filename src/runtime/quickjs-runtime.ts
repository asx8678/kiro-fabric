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
import { FabricDeadline } from "./deadline.js";
import { DISABLED_TRACER, type FabricTracer } from "../trace/tracer.js";
import { assertFabricTranspiledWrapper, transpileFabricCodeWithSourceMap } from "./type-checker.js";

export type FabricSandboxTerminationReason = "completed" | "runtime_error" | "timed_out" | "aborted";

export interface FabricSandboxResult {
  value: unknown;
  logs: string[];
  terminationReason: FabricSandboxTerminationReason;
  effectiveTimeoutMs: number;
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
  cleanupGraceMs?: number;
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
let modulePromise: Promise<QuickJsModule> | undefined;
const quickJsModule = (): Promise<QuickJsModule> =>
  modulePromise ??= newQuickJSWASMModuleFromVariant(releaseSyncVariant);

const GUEST_SETUP = `
(() => {
  'use strict';
  const bridge = globalThis.__fabricHostCall;
  delete globalThis.__fabricHostCall;

  // Capture every validator/promise primordial before guest code can mutate it.
  const apply = Reflect.apply;
  const ownKeys = Reflect.ownKeys;
  const objectGetPrototypeOf = Object.getPrototypeOf;
  const objectPrototype = Object.prototype;
  const arrayPrototype = Array.prototype;
  const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  const objectHasOwn = Object.hasOwn;
  const objectKeys = Object.keys;
  const objectCreate = Object.create;
  const objectDefineProperty = Object.defineProperty;
  const objectFreeze = Object.freeze;
  const arrayIsArray = Array.isArray;
  const numberIsFinite = Number.isFinite;
  const stringCharCodeAt = String.prototype.charCodeAt;
  const jsonParse = JSON.parse;
  const jsonStringify = JSON.stringify;
  const weakHas = WeakSet.prototype.has;
  const weakAdd = WeakSet.prototype.add;
  const weakDelete = WeakSet.prototype.delete;
  const promiseThenMethod = Promise.prototype.then;
  const promiseResolveMethod = Promise.resolve;
  const promiseRaceMethod = Promise.race;
  const SafePromise = Promise;
  const SafeWeakSet = WeakSet;
  const SafeTypeError = TypeError;
  const SafeError = Error;
  const promiseThen = (promise, fulfilled, rejected) => apply(promiseThenMethod, promise, [fulfilled, rejected]);
  const promiseResolve = (value) => apply(promiseResolveMethod, SafePromise, [value]);
  const promiseRace = (values) => apply(promiseRaceMethod, SafePromise, [values]);

  const codeGenerationDenied = function () { throw new SafeTypeError('Dynamic code generation is disabled'); };
  const constructors = [
    Function,
    objectGetPrototypeOf(function* () {}).constructor,
    objectGetPrototypeOf(async function () {}).constructor,
    objectGetPrototypeOf(async function* () {}).constructor,
  ];
  for (const constructor of constructors) {
    objectDefineProperty(constructor.prototype, 'constructor', {
      value: codeGenerationDenied, writable: false, configurable: false,
    });
  }
  objectDefineProperty(globalThis, 'eval', { value: codeGenerationDenied, writable: false, configurable: false });
  objectDefineProperty(globalThis, 'Function', { value: codeGenerationDenied, writable: false, configurable: false });

  const arrayIndex = (key) => {
    if (key === '0') return true;
    if (!key || key[0] === '0') return false;
    for (let index = 0; index < key.length; index++) {
      const code = apply(stringCharCodeAt, key, [index]);
      if (code < 48 || code > 57) return false;
    }
    return true;
  };
  const strictJsonText = (root) => {
    const seen = new SafeWeakSet();
    let nodes = 0;
    const visit = (value, depth) => {
      if (++nodes > 100000 || depth > 64) throw new SafeTypeError('Result exceeds strict JSON structural limits');
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!numberIsFinite(value)) throw new SafeTypeError('Result contains a non-finite number');
        return value;
      }
      if (typeof value !== 'object') throw new SafeTypeError('Result contains a non-JSON value');
      if (apply(weakHas, seen, [value])) throw new SafeTypeError('Result contains a cycle');
      const prototype = objectGetPrototypeOf(value);
      if (prototype !== objectPrototype && prototype !== arrayPrototype && prototype !== null) {
        throw new SafeTypeError('Result contains an unsupported exotic object');
      }
      apply(weakAdd, seen, [value]);
      const descriptors = objectGetOwnPropertyDescriptors(value);
      for (const key of ownKeys(descriptors)) if (typeof key === 'symbol') throw new SafeTypeError('Result contains a symbol key');
      let copy;
      if (arrayIsArray(value)) {
        copy = [];
        for (const key of objectKeys(descriptors)) {
          if (key !== 'length' && !arrayIndex(key)) throw new SafeTypeError('Result array contains a non-index property');
        }
        for (let index = 0; index < value.length; index++) {
          const descriptor = descriptors[index];
          if (!descriptor || !objectHasOwn(descriptor, 'value')) throw new SafeTypeError('Result contains an accessor or sparse array');
          objectDefineProperty(copy, index, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
        }
      } else {
        copy = objectCreate(null);
        for (const key of objectKeys(descriptors)) {
          const descriptor = descriptors[key];
          if (!objectHasOwn(descriptor, 'value')) throw new SafeTypeError('Result contains an accessor');
          objectDefineProperty(copy, key, { value: visit(descriptor.value, depth + 1), enumerable: true });
        }
      }
      apply(weakDelete, seen, [value]);
      return copy;
    };
    const text = apply(jsonStringify, JSON, [visit(root, 0)]);
    if (typeof text !== 'string' || text.length > 8000000) throw new SafeTypeError('Result exceeds strict JSON byte limit');
    return text;
  };
  const parseStrict = (text) => apply(jsonParse, JSON, [text]);
  const call = (ref, args = {}) => promiseThen(bridge(ref, strictJsonText(args)), parseStrict);
  let rejectExecution;
  const executionGate = new SafePromise((_resolve, reject) => { rejectExecution = reject; });
  const cancel = (message) => rejectExecution(new SafeError(message));
  const run = (main) => promiseThen(promiseRace([promiseThen(promiseResolve(), main), executionGate]), strictJsonText);
  globalThis.tools = objectFreeze({
    providers: () => call("fabric.providers"),
    list: () => call("fabric.list"),
    search: (input) => call("fabric.search", typeof input === "string" ? { query: input } : input),
    describe: (input) => call("fabric.describe", typeof input === "string" ? { ref: input } : input),
    call: (input) => call("fabric.call", input),
  });
  globalThis.artifacts = objectFreeze({ read: (args) => call("artifacts.read", args) });
  globalThis.memory = objectFreeze({
    get: (args) => call("memory.get", args), set: (args) => call("memory.set", args),
    delete: (args) => call("memory.delete", args), search: (args) => call("memory.search", args),
    index: (args = {}) => call("memory.index", args),
  });
  globalThis.state = objectFreeze({
    get: (args) => call("state.get", args), set: (args) => call("state.set", args),
    list: (args = {}) => call("state.list", args), delete: (args) => call("state.delete", args),
  });
  globalThis.mcp = objectFreeze({ servers: (args = {}) => call("mcp.$servers", args), call: (args) => call("mcp.$call", args) });
  objectFreeze(globalThis.payloads);
  return objectFreeze({ run, cancel });
})()
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

export class QuickJsRuntime {
  async execute(code: string, hostCall: FabricHostCall, options: FabricSandboxOptions): Promise<FabricSandboxResult> {
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

    const tracer = options.tracer ?? DISABLED_TRACER;
    const execId = options.execId;
    const parentSpanId = options.parentSpanId;
    const moduleCached = modulePromise !== undefined;
    const moduleSpan = tracer.enabled ? tracer.span("init", "quickjs.module.acquire", execId, { cached: moduleCached }, parentSpanId) : undefined;
    const module = await quickJsModule();
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
    runtime.setInterruptHandler(() => {
      if (options.signal?.aborted) return true;
      if (!deadline.expired) return false;
      interrupted = true;
      return true;
    });

    const logs: string[] = [];
    const maxLogChars = Math.max(0, options.maxLogChars ?? 100_000);
    let logChars = 0;
    const hostController = new AbortController();
    const bridgeTasks = new Set<Promise<void>>();
    const pendingPromises = new Set<any>();
    let deadlineTimer: NodeJS.Timeout | undefined;
    let rejectDeadline: ((reason: Error) => void) | undefined;
    let abortListener: (() => void) | undefined;
    let activeHandle: any;
    let resolution: Promise<any> | undefined;
    let resolutionConsumed = false;
    let runExecution: any;
    let cancelExecution: any;

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
        const jobs = runtime.executePendingJobs();
        if (jobs.error) { jobs.error.dispose(); break; }
        if (jobs.value === 0) break;
      }
    };
    const abortHost = (reason: Error): void => {
      if (!hostController.signal.aborted) hostController.abort(reason);
      rejectGuestGraph(reason);
    };
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
      const floor = options.minimumTimeoutMsForHostCall?.(ref, args);
      if (typeof floor !== "number" || !Number.isFinite(floor)) return;
      const before = deadline.effectiveTimeoutMs;
      const next = deadline.extendTo(floor);
      if (next > before) schedule();
    };

    try {
      const hostFunction = context.newFunction("__fabricHostCall", (refHandle: any, argsHandle: any) => {
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
          promise.reject(handle);
          handle.dispose();
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
      setup.value.dispose();

      const bundle = options.transpiledCode === undefined
        ? transpileFabricCodeWithSourceMap(code)
        : { code: options.transpiledCode, sourceMap: options.transpiledSourceMap };
      assertFabricTranspiledWrapper(bundle.code);
      const transpiledError = fabricTranspiledLimitError(bundle.code);
      if (transpiledError) return { value: undefined, logs, terminationReason: "runtime_error", error: transpiledError, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
      const stackMap = createGuestStackMap(bundle.sourceMap);
      const guestLineCount = bundle.code.split("\n").length;
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
      resolution = context.resolvePromise(activeHandle);
      runtime.executePendingJobs();
      const deadlineRace = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; schedule(); });
      const cancellation = new Promise<never>((_resolve, reject) => {
        abortListener = () => { const error = new Error("Execution cancelled"); abortHost(error); reject(error); };
        if (options.signal?.aborted) abortListener();
        else options.signal?.addEventListener("abort", abortListener, { once: true });
      });
      const runSpan = tracer.enabled ? tracer.span("eval", "quickjs.run", execId, undefined, parentSpanId) : undefined;
      const settled = await Promise.race([resolution, deadlineRace, cancellation]);
      resolutionConsumed = true;
      activeHandle.dispose();
      activeHandle = undefined;
      runSpan?.end();
      if (settled.error) {
        const deadlineExceeded = timedOut || interrupted || deadline.expired;
        const error = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatValue(context.dump(settled.error)), stackMap, guestLineCount);
        settled.error.dispose();
        abortHost(new Error(error));
        return { value: undefined, logs, terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error", error, effectiveTimeoutMs: deadline.effectiveTimeoutMs };
      }
      const serialized = context.getString(settled.value);
      settled.value.dispose();
      const value: unknown = JSON.parse(serialized);
      assertFabricJsonBudget(value, options.maxNestedResultChars);
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
      abortHost(new Error("Execution request ended"));
      await settleWithin(bridgeTasks, Math.max(0, options.cleanupGraceMs ?? 100));
      for (let index = 0; index < 1_024; index++) {
        const jobs = runtime.executePendingJobs();
        if (jobs.error) { jobs.error.dispose(); break; }
        if (jobs.value === 0) break;
      }
      // Never let an attacker-controlled promise or non-cooperative provider
      // decide when cancellation returns. All continuations check `closing`
      // before touching QuickJS, so unresolved host work can be safely detached.
      void resolutionConsumed;
      if (activeHandle?.alive !== false) activeHandle?.dispose();
      for (const promise of pendingPromises) if (promise.alive !== false) promise.dispose();
      if (cancelExecution && cancelExecution.alive !== false) cancelExecution.dispose();
      if (runExecution && runExecution.alive !== false) runExecution.dispose();
      jsonParse.dispose();
      jsonObject.dispose();
      context.dispose();
      teardownSpan?.end();
    }
  }
}
