import type { FabricConfig } from "./config.js";
import { ActionRegistry, type FabricCallAudit } from "./core/action-registry.js";
import type { ResolvedFabricAction } from "./protocol.js";
import { fabricGuestDeclarations } from "./runtime/guest-types.js";
import { assertFabricJsonBudget, fabricJsonText, MAX_FABRIC_JSON_CHARS } from "./runtime/json-budget.js";
import { QuickJsRuntime, type FabricSandboxTerminationReason } from "./runtime/quickjs-runtime.js";
import { fabricPayloadsLimitError, fabricSourceLimitError } from "./runtime/source-limit.js";
import { DISABLED_TRACER, traceFailureMetadata, type FabricTracer } from "./trace/tracer.js";
import { FabricCompilerPool, type FabricTypeError } from "./runtime/type-checker.js";

export const FABRIC_COMPILER_TIMEOUT_MS = 10_000;
export const FABRIC_APPROVAL_TIMEOUT_MS = 30_000;
export const FABRIC_PROVIDER_TIMEOUT_GRACE_MS = 2_000;
const MAX_MCP_APPROVAL_STAGES = 2;

export interface FabricExecutionApprover {
  approve(action: ResolvedFabricAction, args: Record<string, unknown>, signal?: AbortSignal): Promise<void>;
}

export interface FabricExecutionOptions {
  code: string;
  payloads?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  approver: FabricExecutionApprover;
  onEffectiveTimeoutChange?(timeoutMs: number): void;
  /** Optional tracer; when absent (or disabled) tracing adds one boolean
   * branch per hook and zero allocations. */
  tracer?: FabricTracer;
  execId?: string;
}

export interface FabricExecutionResult {
  status: "succeeded" | "failed" | "aborted" | "timed_out";
  success: boolean;
  value?: unknown;
  logs: string[];
  audits: FabricCallAudit[];
  elapsedMs: number;
  error?: string;
  typeErrors?: FabricTypeError[];
  effectiveTimeoutMs: number;
}

const statusFor = (reason: FabricSandboxTerminationReason): FabricExecutionResult["status"] =>
  reason === "completed" ? "succeeded" : reason === "aborted" ? "aborted" : reason === "timed_out" ? "timed_out" : "failed";

/** Serialized character size for trace attribution. Tracing-only: never
 * called on the disabled path, and never throws into an execution. */
const traceJsonChars = (value: unknown): number => {
  try { return fabricJsonText(value, MAX_FABRIC_JSON_CHARS).length; }
  catch { return -1; }
};

export const effectiveFabricTimeout = (
  configuredMaximum: number,
  executorDefault: number,
  exactActionFloor: number,
  invocationTimeout: number,
): number => Math.min(configuredMaximum, Math.max(executorDefault, exactActionFloor, invocationTimeout));

export const exactActionTimeoutFloor = (ref: string, mcpCallTimeoutMs: number): number =>
  ref === "mcp.$call" || ref === "mcp.$tools" || ref === "mcp.$describe"
    ? mcpCallTimeoutMs +
      FABRIC_APPROVAL_TIMEOUT_MS * MAX_MCP_APPROVAL_STAGES +
      FABRIC_PROVIDER_TIMEOUT_GRACE_MS
    : 0;

export const exactHostActionReference = (
  bridgeRef: string,
  args: Record<string, unknown>,
): string | undefined => bridgeRef === "fabric.call"
  ? typeof args.ref === "string" ? args.ref : undefined
  : bridgeRef;

export class FabricExecutionService {
  readonly #runtime = new QuickJsRuntime();
  readonly #compiler: FabricCompilerPool;
  #active = 0;
  readonly #executions = new Set<Promise<FabricExecutionResult>>();
  readonly #closeController = new AbortController();
  #closing: Promise<void> | undefined;
  constructor(
    readonly registry: ActionRegistry,
    readonly config: FabricConfig,
    readonly cwd: string,
  ) { this.#compiler = new FabricCompilerPool(config.executor.maxConcurrentExecutions ?? 4); }

  async execute(options: FabricExecutionOptions): Promise<FabricExecutionResult> {
    if (this.#closeController.signal.aborted || this.#active >= this.#compiler.maxWorkers) {
      const result = {
        status: "failed" as const, success: false, logs: [], audits: [], elapsedMs: 0,
        error: this.#closeController.signal.aborted ? "Fabric execution service is closed" : "Fabric execution concurrency limit reached",
        effectiveTimeoutMs: effectiveFabricTimeout(this.config.executor.maxTimeoutMs, this.config.executor.timeoutMs, 0, options.timeoutMs ?? 0),
      };
      if (options.tracer?.enabled) {
        options.tracer.event("eval", "exec.end", options.execId, { status: "failed", elapsedMs: 0, audits: 0, logs: 0, typeErrors: 0, resultChars: 0, resultValueChars: null });
        options.tracer.flush();
      }
      return result;
    }
    this.#active += 1;
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.#closeController.signal])
      : this.#closeController.signal;
    // Register before any user callback runs, including timeout notifications.
    const execution = Promise.resolve().then(() => this.#execute({ ...options, signal }));
    this.#executions.add(execution);
    try { return await execution; }
    finally { this.#active -= 1; this.#executions.delete(execution); }
  }

  async #execute(options: FabricExecutionOptions): Promise<FabricExecutionResult> {
    const started = performance.now();
    const tracer = options.tracer ?? DISABLED_TRACER;
    const execId = options.execId;
    const configuredMaximum = this.config.executor.maxTimeoutMs;
    const invocationTimeout = options.timeoutMs ?? 0;
    const effectiveTimeoutMs = effectiveFabricTimeout(
      configuredMaximum,
      this.config.executor.timeoutMs,
      0,
      invocationTimeout,
    );
    let notifiedEffectiveTimeoutMs = effectiveTimeoutMs;
    options.onEffectiveTimeoutChange?.(effectiveTimeoutMs);
    const sourceError = fabricSourceLimitError(options.code, this.config.executor.maxSourceBytes)
      ?? fabricPayloadsLimitError(options.payloads, this.config.executor.maxInputBytes);
    if (sourceError) {
      const elapsedMs = performance.now() - started;
      if (tracer.enabled) {
        tracer.event("eval", "exec.end", execId, { status: "failed", elapsedMs, audits: 0, logs: 0, typeErrors: 0, resultChars: 0, resultValueChars: null });
        tracer.flush();
      }
      return { status: "failed", success: false, logs: [], audits: [], elapsedMs, error: sourceError, effectiveTimeoutMs };
    }

    if (tracer.enabled) {
      tracer.event("eval", "exec.start", execId, {
        sourceBytes: Buffer.byteLength(options.code, "utf8"),
        payloadKeys: options.payloads ? Object.keys(options.payloads).length : 0,
        effectiveTimeoutMs,
      });
    }
    const compileSpan = tracer.enabled ? tracer.span("eval", "compile", execId) : undefined;
    let checked;
    try {
      checked = await this.#compiler.check({
        code: options.code,
        declarations: fabricGuestDeclarations,
      }, {
        ...(options.signal ? { signal: options.signal } : {}),
        timeoutMs: Math.min(FABRIC_COMPILER_TIMEOUT_MS, effectiveTimeoutMs),
      });
    } catch (error) {
      compileSpan?.end({ failed: true });
      const aborted = options.signal?.aborted === true;
      if (tracer.enabled) tracer.event("eval", "exec.end", execId, { status: aborted ? "aborted" : "failed", elapsedMs: performance.now() - started, audits: 0, logs: 0, typeErrors: 0, resultChars: 0, resultValueChars: null });
      return { status: aborted ? "aborted" : "failed", success: false, logs: [], audits: [], elapsedMs: performance.now() - started, error: aborted ? "Execution cancelled" : error instanceof Error ? error.message : String(error), effectiveTimeoutMs };
    }
    compileSpan?.end({ errors: checked.errors.length });
    if (checked.errors.length) {
      if (tracer.enabled) tracer.event("eval", "exec.end", execId, { status: "failed", elapsedMs: performance.now() - started, audits: 0, logs: 0, typeErrors: checked.errors.length, resultChars: 0, resultValueChars: null });
      return { status: "failed", success: false, logs: [], audits: [], elapsedMs: performance.now() - started, error: "TypeScript validation failed", typeErrors: checked.errors, effectiveTimeoutMs };
    }

    const audits: FabricCallAudit[] = [];
    const auditBudget = { bytes: 0 };
    let providerCalls = 0;
    let activeProviderCalls = 0;
    let approvalRequests = 0;
    let pendingApprovals = 0;
    const providerContext = (signal: AbortSignal, deadline: import("./runtime/deadline.js").FabricDeadline) => ({
      cwd: this.cwd,
      signal,
      deadline,
    });
    const executeSpan = tracer.enabled ? tracer.span("eval", "execute", execId) : undefined;
    const executeSpanId = executeSpan?.id;
    const result = await this.#runtime.execute(options.code, async (ref, args, signal, deadline) => {
      providerCalls += 1;
      if (providerCalls > this.config.executor.maxProviderCalls) throw new Error("Fabric provider call quota exceeded");
      activeProviderCalls += 1;
      if (activeProviderCalls > this.config.executor.maxConcurrentProviderCalls) {
        activeProviderCalls -= 1;
        throw new Error("Fabric concurrent provider call quota exceeded");
      }
      // One span per host-bridge call, parented to the execute span. Byte
      // sizes attribute cost to payload volume, not just provider latency.
      const bridgeSpan = tracer.enabled ? tracer.span("bridge", ref, execId, { argsChars: traceJsonChars(args) }, executeSpanId) : undefined;
      let bridgeEnd: Record<string, unknown> = {};
      try {
        const context = providerContext(signal, deadline);
        if (ref === "fabric.providers") { const value = this.registry.providers(); if (bridgeSpan) bridgeEnd = { ok: true, resultChars: traceJsonChars(value) }; return value; }
        if (ref === "fabric.list") { const value = await this.registry.list(); if (bridgeSpan) bridgeEnd = { ok: true, resultChars: traceJsonChars(value) }; return value; }
        if (ref === "fabric.search") {
          if (typeof args.query !== "string") throw new Error("fabric.search query must be a string");
          const value = await this.registry.search(args.query, typeof args.limit === "number" ? args.limit : 30);
          if (bridgeSpan) bridgeEnd = { ok: true, resultChars: traceJsonChars(value) };
          return value;
        }
        if (ref === "fabric.describe") {
          if (typeof args.ref !== "string") throw new Error("fabric.describe ref must be a string");
          const value = await this.registry.describe(args.ref);
          if (bridgeSpan) bridgeEnd = { ok: true, resultChars: traceJsonChars(value) };
          return value;
        }
        const actionRef = ref === "fabric.call" ? args.ref : ref;
        const actionArgs = ref === "fabric.call" ? args.args ?? {} : args;
        if (typeof actionRef !== "string" || typeof actionArgs !== "object" || actionArgs === null || Array.isArray(actionArgs)) {
          throw new Error("Fabric provider call requires an exact ref and object args");
        }
        const value = await this.registry.invoke(actionRef, actionArgs as Record<string, unknown>, {
          ...context,
          audits,
          auditBudget,
          maxAuditEntries: this.config.executor.maxAuditEntries,
          maxAuditBytes: this.config.executor.maxAuditBytes,
          maxResultChars: this.config.executor.maxNestedResultChars,
          approve: async (action, exactArgs) => {
            approvalRequests += 1;
            if (approvalRequests > this.config.executor.maxApprovalRequests) throw new Error("Fabric approval request quota exceeded");
            pendingApprovals += 1;
            if (pendingApprovals > this.config.executor.maxPendingApprovals) {
              pendingApprovals -= 1;
              throw new Error("Fabric pending approval quota exceeded");
            }
            // Approval wait is frequently the dominant latency (user
            // elicitation). Trace ref/risk only, never arguments.
            const approvalSpan = tracer.enabled ? tracer.span("eval", "approval.wait", execId, { ref: action.ref, risk: action.risk }, bridgeSpan?.id) : undefined;
            try {
              await options.approver.approve(action, exactArgs, signal);
              approvalSpan?.end({ approved: true });
            } catch (error) {
              approvalSpan?.end({ approved: false, ...traceFailureMetadata("approval_failed") });
              throw error;
            } finally { pendingApprovals -= 1; }
          },
        });
        if (bridgeSpan) bridgeEnd = { ok: true, resultChars: traceJsonChars(value), ...(actionRef !== ref ? { actionRef } : {}) };
        return value;
      } catch (error) {
        if (bridgeSpan) bridgeEnd = { ok: false, ...traceFailureMetadata("provider_failed") };
        throw error;
      } finally {
        bridgeSpan?.end(bridgeEnd);
        activeProviderCalls -= 1;
      }
    }, {
      timeoutMs: effectiveTimeoutMs,
      maxTimeoutMs: configuredMaximum,
      memoryLimitBytes: this.config.executor.memoryLimitBytes,
      maxSourceBytes: this.config.executor.maxSourceBytes,
      maxInputBytes: this.config.executor.maxInputBytes,
      maxLogChars: this.config.executor.maxOutputChars,
      maxNestedResultChars: this.config.executor.maxNestedResultChars,
      maxConcurrentHostCalls: this.config.executor.maxConcurrentProviderCalls,
      ...(options.payloads ? { payloads: options.payloads } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(checked.javascript ? { transpiledCode: checked.javascript } : {}),
      ...(checked.sourceMap ? { transpiledSourceMap: checked.sourceMap } : {}),
      ...(execId !== undefined ? { tracer, execId, ...(executeSpanId ? { parentSpanId: executeSpanId } : {}) } : {}),
      minimumTimeoutMsForHostCall: (bridgeRef, args) => {
        // Resolve the exact action carried by tools.call without source
        // inspection, rewriting, or fuzzy matching.
        const actionRef = exactHostActionReference(bridgeRef, args);
        const actionFloor = actionRef
          ? exactActionTimeoutFloor(actionRef, this.config.mcp.callTimeoutMs)
          : 0;
        const candidate = effectiveFabricTimeout(
          configuredMaximum,
          this.config.executor.timeoutMs,
          actionFloor,
          invocationTimeout,
        );
        if (candidate > notifiedEffectiveTimeoutMs) {
          notifiedEffectiveTimeoutMs = candidate;
          options.onEffectiveTimeoutChange?.(candidate);
        }
        return candidate;
      },
    });
    executeSpan?.end({ termination: result.terminationReason, effectiveTimeoutMs: result.effectiveTimeoutMs });
    let status = statusFor(result.terminationReason);
    let outputError = result.error;
    if (status === "succeeded") {
      try {
        assertFabricJsonBudget(result.value, this.config.artifacts.maxArtifactChars);
      } catch (error) {
        status = "failed";
        outputError = error instanceof Error ? error.message : String(error);
      }
    }
    if (tracer.enabled) {
      const resultValueChars = status === "succeeded" ? traceJsonChars(result.value) : null;
      tracer.event("eval", "exec.end", execId, { status, elapsedMs: performance.now() - started, audits: audits.length, logs: result.logs.length, typeErrors: 0, resultChars: resultValueChars ?? 0, resultValueChars });
      // Flush at each execution boundary so post-hoc analysis never waits
      // on the interval timer for the tail of a finished run.
      tracer.flush();
    }
    return {
      status,
      success: status === "succeeded",
      ...(status === "succeeded" ? { value: result.value } : {}),
      logs: result.logs,
      audits,
      elapsedMs: performance.now() - started,
      ...(outputError ? { error: outputError } : {}),
      effectiveTimeoutMs: result.effectiveTimeoutMs,
    };
  }

  close(): Promise<void> {
    return this.#closing ??= (async () => {
      this.#closeController.abort(new Error("Fabric execution service is closed"));
      try {
        await Promise.all([this.#compiler.close(), Promise.allSettled([...this.#executions])]);
      } finally { await this.registry.close(); }
    })();
  }
}
