import { randomUUID } from "node:crypto";
import { FoveaObservationExecution, type FoveaObserver } from "./fovea/observations.js";
import { ContinuityExecution, observeContinuity } from "./continuity/execution.js";
import { CatalogSnapshotStore } from "./core/catalog-snapshot-store.js";
import type { CatalogBinding, CatalogReservation } from "./core/catalog-contract.js";
import { catalogMethodForBridge, catalogUnavailable, continueCatalog, publishCatalog, validateCatalogRequest } from "./core/catalog-execution.js";
import { parseRemoteRef } from "./core/remote-identity.js";
import { createCheckpointJournal, fabricFailureMetadata, FabricCompilerTimeoutError, FabricRepairError } from "./core/repair-error.js";
import type { FabricFailureMetadata, FabricCheckpointHandle } from "./protocol.js";
import type { FabricConfig } from "./config.js";
import { throwIfAbortedOrExpired } from "./async-settlement.js";
import { LocalShellExitError, type LocalShellResult } from "./providers/local-shell.js";
import { ProbeRunExitError } from "./providers/probe-provider.js";
import { ActionRegistry, type FabricCallAudit } from "./core/action-registry.js";
import type { FabricInvocationContext, ResolvedFabricAction } from "./protocol.js";
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

/** A host policy decision for one exact canonical request, never guest input. */
export type FabricApprovalPlan =
  | { decision: "allow" }
  | { decision: "deny"; reason: string }
  | { decision: "ask"; prompt(): Promise<void> };

export interface FabricExecutionApprover {
  /** Legacy entry point; without prepareApproval every call reserves prompt budget. */
  approve(action: ResolvedFabricAction, args: Record<string, unknown>, signal?: AbortSignal): Promise<void>;
  /** Evaluate policy once, without interaction. An ask plan must defer interaction
   * until prompt() and bind it to these exact arguments and signal. The service
   * invokes it once, only after reserving both approval quotas. */
  prepareApproval?(action: ResolvedFabricAction, args: Record<string, unknown>, signal?: AbortSignal): FabricApprovalPlan | Promise<FabricApprovalPlan>;
}

export interface FabricExecutionOptions {
  /** Independent trusted host observer; no continuity or tracing dependency. */
  operationObserver?: FoveaObserver;
  code: string;
  payloads?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  approver: FabricExecutionApprover;
  bootstrap?: FabricInvocationContext["bootstrap"];
  /** Kiro explicitly pins availability; omitted retains library-provider behavior. */
  workspaceBound?: boolean;
  workspaceUnavailable?: boolean;
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
  failure?: FabricFailureMetadata;
  checkpoints?: FabricCheckpointHandle[];
  typeErrors?: FabricTypeError[];
  /** Last ordinary nonzero shell exit, separate from error text and telemetry. */
  lastShellFailure?: LocalShellResult;
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

export const exactActionTimeoutFloor = (ref: string, mcpCallTimeoutMs: number, args: Record<string, unknown> = {}): number => {
  let remote = false;
  try { remote = parseRemoteRef(ref) !== undefined; } catch { return 0; }
  const method = catalogMethodForBridge(ref);
  let initialMcpPage = false;
  if (method?.startsWith("mcp.") && !Object.hasOwn(args, "cursor")) {
    try { validateCatalogRequest(method, args); initialMcpPage = true; } catch { return 0; }
  }
  return remote || initialMcpPage || ref === "mcp.$call" || ref === "mcp.$tools" || ref === "mcp.$describe"
    ? mcpCallTimeoutMs + FABRIC_APPROVAL_TIMEOUT_MS * MAX_MCP_APPROVAL_STAGES + FABRIC_PROVIDER_TIMEOUT_GRACE_MS : 0;
};

export const exactHostActionReference = (
  bridgeRef: string,
  args: Record<string, unknown>,
): string | undefined => bridgeRef === "fabric.call"
  ? typeof args.ref === "string" ? args.ref : undefined
  : bridgeRef;

interface ExecutionApprovals {
  chargeApproval(prompt: () => Promise<void>): Promise<void>;
  approve(
    action: ResolvedFabricAction,
    args: Record<string, unknown>,
    signal: AbortSignal,
    deadline: import("./runtime/deadline.js").FabricDeadline,
    parentSpanId: string | undefined,
  ): Promise<void>;
}

/** One budget shared by registry/nested transport approvals and provider-owned prompts.
 * Keep reservation synchronous before interaction; this controller owns no dispatch
 * or settlement state and must not move approval earlier in registry invocation. */
const createExecutionApprovals = (
  config: FabricConfig,
  options: FabricExecutionOptions,
  tracer: FabricTracer,
): ExecutionApprovals => {
  const execId = options.execId;
  let approvalRequests = 0;
  let pendingApprovals = 0;
  // Reserve an interactive prompt against this execution's approval budget.
  // Provider-owned elicitations (manual workspace attachment) use this so a
  // zero-prompt policy is enforced for every dialog, not only registry ones.
  const chargeApproval = async (prompt: () => Promise<void>): Promise<void> => {
    if (approvalRequests >= config.executor.maxApprovalRequests) throw new FabricRepairError("Fabric approval request quota exceeded", { code: "quota_exceeded", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none" });
    if (pendingApprovals >= config.executor.maxPendingApprovals) throw new FabricRepairError("Fabric pending approval quota exceeded", { code: "quota_exceeded", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none" });
    approvalRequests += 1;
    pendingApprovals += 1;
    try { await prompt(); } finally { pendingApprovals -= 1; }
  };
  return {
    chargeApproval,
    approve: async (action, exactArgs, signal, deadline, parentSpanId) => {
      throwIfAbortedOrExpired(signal, deadline);
      // The registry and nested MCP transport stages share this callback.
      // Never infer permission from risk or re-evaluate a prepared policy.
      const plan = options.approver.prepareApproval
        ? await options.approver.prepareApproval(action, exactArgs, signal)
        : { decision: "ask" as const, prompt: () => options.approver.approve(action, exactArgs, signal) };
      throwIfAbortedOrExpired(signal, deadline);
      if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("Invalid Fabric approval plan");
      switch (plan.decision) {
        case "allow": return;
        case "deny":
          if (typeof plan.reason !== "string") throw new Error("Invalid Fabric approval plan");
          throw new FabricRepairError(plan.reason, { code: "approval_denied", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none", ref: action.ref });
        case "ask":
          if (typeof plan.prompt !== "function") throw new Error("Invalid Fabric approval plan");
          break;
        default: throw new Error("Invalid Fabric approval plan");
      }
      // Only actual approval waits (or conservative legacy calls) are
      // traced here. Trace ref/risk only, never arguments.
      const approvalSpan = tracer.enabled ? tracer.span("eval", "approval.wait", execId, { ref: action.ref, risk: action.risk }, parentSpanId) : undefined;
      try {
        // Reserve atomically before interaction. Rejected admission
        // consumes neither counter; admitted attempts retain total usage
        // on failure.
        await chargeApproval(plan.prompt);
        throwIfAbortedOrExpired(signal, deadline);
        approvalSpan?.end({ approved: true });
      } catch (error) {
        approvalSpan?.end({ approved: false, ...traceFailureMetadata("approval_failed") });
        throw error instanceof FabricRepairError ? error : new FabricRepairError(error instanceof Error ? error.message : String(error), { code: "approval_denied", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none", ref: action.ref });
      }
    },
  };
};

export class FabricExecutionService {
  readonly #runtime = new QuickJsRuntime();
  readonly #compiler: FabricCompilerPool;
  #active = 0;
  readonly #executions = new Set<Promise<FabricExecutionResult>>();
  readonly #closeController = new AbortController();
  #closing: Promise<void> | undefined;
  readonly #catalogNonce = randomUUID();
  #catalogBinding: string | undefined;
  #catalogStore: CatalogSnapshotStore | undefined;

  /** Host-only authorization binding. Shared runtimes cannot silently change owners. */
  bindCatalog(binding: Omit<CatalogBinding, "runtimeNonce">): void {
    const identity = JSON.stringify(binding);
    if (this.#catalogBinding === identity && this.#catalogStore) return;
    if (this.#catalogBinding !== undefined || this.#closeController.signal.aborted) {
      this.invalidateCatalogs();
      throw new Error("Catalog runtime already bound or revoked; create a new authorized runtime");
    }
    this.#catalogBinding = identity;
    this.#catalogStore = new CatalogSnapshotStore({ ...binding, runtimeNonce: this.#catalogNonce });
  }

  invalidateCatalogs(): void { this.#catalogStore?.invalidate(); this.#catalogStore = undefined; }
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
      const compileStatus = aborted ? "aborted" : error instanceof FabricCompilerTimeoutError ? "timed_out" : "failed";
      const failure = fabricFailureMetadata(error);
      if (tracer.enabled) tracer.event("eval", "exec.end", execId, { status: compileStatus, elapsedMs: performance.now() - started, audits: 0, logs: 0, typeErrors: 0, resultChars: 0, resultValueChars: null });
      return { status: compileStatus, success: false, logs: [], audits: [], elapsedMs: performance.now() - started, error: aborted ? "Execution cancelled" : error instanceof Error ? error.message : String(error), ...(failure ? { failure } : {}), effectiveTimeoutMs };
    }
    compileSpan?.end({ errors: checked.errors.length, ...(checked.compileCache === undefined ? {} : { cache: checked.compileCache }), ...(checked.compileWorker === undefined ? {} : { worker: checked.compileWorker }) });
    // Separate request-level counters keep compile cost measurable without
    // reading compiler internals or changing any guest-visible behavior.
    if (tracer.enabled && checked.compileCache !== undefined) tracer.event("eval", "compile.result", execId, {
      cache: checked.compileCache, ...(checked.compileWorker === undefined ? {} : { worker: checked.compileWorker }), typeErrors: checked.errors.length,
    });
    if (checked.errors.length) {
      if (tracer.enabled) tracer.event("eval", "exec.end", execId, { status: "failed", elapsedMs: performance.now() - started, audits: 0, logs: 0, typeErrors: checked.errors.length, resultChars: 0, resultValueChars: null });
      return { status: "failed", success: false, logs: [], audits: [], elapsedMs: performance.now() - started, error: "TypeScript validation failed", typeErrors: checked.errors, effectiveTimeoutMs };
    }

    const captureEnabled = this.config.continuity.enabled && options.workspaceBound !== false && options.workspaceUnavailable !== true &&
      this.registry.providers().some(provider => provider.name === "continuity" && provider.available);
    let continuity: ContinuityExecution | undefined;
    let captureFailed = false;
    if (captureEnabled) {
      try { continuity = new ContinuityExecution(undefined, undefined, this.config.continuity.captureFailureOutput); } catch { captureFailed = true; }
    }
    const observations = options.operationObserver ? new FoveaObservationExecution(options.operationObserver) : undefined;
    const checkpoints = createCheckpointJournal();
    let interruptedFailure: FabricFailureMetadata | undefined;
    const audits: FabricCallAudit[] = [];
    const auditBudget = { bytes: 0 };
    let providerCalls = 0;
    let activeProviderCalls = 0;
    let workspaceCalls = false;
    let switchRequested = false;
    const localSettlements = new Set<Promise<unknown>>();
    // Per-execution FIFO: preserve workspace locks across separate executions,
    // but never prepare a queued local mutation against a predecessor's old state.
    let localEffectTail: Promise<unknown> = Promise.resolve();
    let lastShellFailure: LocalShellResult | undefined;
    const approvals = createExecutionApprovals(this.config, options, tracer);
    const providerContext = (signal: AbortSignal, deadline: import("./runtime/deadline.js").FabricDeadline) => ({
      cwd: this.cwd,
      checkpoints,
      maxResultChars: this.config.executor.maxNestedResultChars,
      signal,
      deadline,
      chargeApproval: approvals.chargeApproval,
      ...(options.bootstrap ? { bootstrap: options.bootstrap } : {}),
    });
    const executeSpan = tracer.enabled ? tracer.span("eval", "execute", execId) : undefined;
    const executeSpanId = executeSpan?.id;
    const result = await this.#runtime.execute(options.code, async (ref, args, signal, deadline) => {
      providerCalls += 1;
      if (providerCalls > this.config.executor.maxProviderCalls) throw new FabricRepairError("Fabric provider call quota exceeded", { code: "quota_exceeded", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none" });
      activeProviderCalls += 1;
      if (activeProviderCalls > this.config.executor.maxConcurrentProviderCalls) {
        activeProviderCalls -= 1;
        throw new FabricRepairError("Fabric concurrent provider call quota exceeded", { code: "quota_exceeded", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none" });
      }
      // Admission order precedes asynchronous descriptor resolution, approvals and local FIFO waits.
      let operation: ReturnType<ContinuityExecution["admit"]> | undefined;
      if (continuity) {
        try { operation = continuity.admit(ref === "fabric.call" ? args.ref : ref); }
        catch { captureFailed = true; }
      }
      const observation = observations?.operation(typeof (ref === "fabric.call" ? args.ref : ref) === "string" ? (ref === "fabric.call" ? args.ref : ref) as string : "fabric.call");
      let operationFailed = false;
      let operationError: unknown;
      // One span per host-bridge call, parented to the execute span. Byte
      // sizes attribute cost to payload volume, not just provider latency.
      const bridgeSpan = tracer.enabled ? tracer.span("bridge", ref, execId, { argsChars: traceJsonChars(args) }, executeSpanId) : undefined;
      let bridgeEnd: Record<string, unknown> = {};
      let catalogReservation: CatalogReservation | undefined;
      try {
        const context = { ...providerContext(signal, deadline), ...(observation ? { foveaObservation: observation } : {}), ...(captureEnabled ? { continuityCapture: () => {
          if (captureFailed || !operation) throw new Error("continuity capture is incomplete: recorder failed; prior checkpoint retained");
          return operation.capture();
        } } : {}) };
        if (ref === "fabric.providers") { const value = this.registry.providers(); if (bridgeSpan) bridgeEnd = { ok: true, resultChars: traceJsonChars(value) }; return value; }
        const pageMethod = catalogMethodForBridge(ref);
        if (pageMethod) {
          validateCatalogRequest(pageMethod, args);
          if (switchRequested || options.workspaceUnavailable) throw catalogUnavailable();
          if (typeof args.cursor === "string") {
            if (!this.#catalogStore) throw catalogUnavailable();
            return continueCatalog(this.#catalogStore, pageMethod, args.cursor, args, this.config.executor.maxNestedResultChars);
          }
          if (!this.#catalogStore) throw catalogUnavailable();
        }
        if (["fabric.list", "fabric.search", "fabric.describe"].includes(ref) || pageMethod?.startsWith("tools.")) {
          if (switchRequested || options.workspaceUnavailable) throw catalogUnavailable();
          catalogReservation = this.#catalogStore?.reserve(this.registry.catalogDependencies());
          const method = pageMethod ?? (ref === "fabric.list" ? "tools.listPage" : ref === "fabric.search" ? "tools.searchPage" : "tools.describePage");
          let value: unknown;
          if (method === "tools.listPage") value = await this.registry.list(signal);
          else if (method === "tools.searchPage") {
            if (typeof args.query !== "string") throw new Error("fabric.search query must be a string");
            value = pageMethod ? await this.registry.searchAll(args.query, signal) : await this.registry.search(args.query, typeof args.limit === "number" ? args.limit : 30, signal);
          } else {
            if (typeof args.ref !== "string") throw new Error("fabric.describe ref must be a string");
            value = await this.registry.describe(args.ref, signal);
          }
          throwIfAbortedOrExpired(signal, deadline);
          return publishCatalog(this.#catalogStore, catalogReservation, method, value, this.config.executor.maxNestedResultChars, pageMethod ? args : undefined, typeof args.query === "string" ? args.query : undefined);
        }
        const actionRef = pageMethod === "mcp.toolsPage" ? "mcp.$tools" : pageMethod === "mcp.describePage" ? "mcp.$describe" : ref === "fabric.call" ? args.ref : ref;
        const actionArgs = pageMethod?.startsWith("mcp.") ? { server: args.server, ...(pageMethod === "mcp.describePage" ? { tool: args.tool } : {}) } : ref === "fabric.call" ? args.args ?? {} : args;
        if (typeof actionRef !== "string" || typeof actionArgs !== "object" || actionArgs === null || Array.isArray(actionArgs)) {
          throw new Error("Fabric provider call requires an exact ref and object args");
        }
        if (actionRef === "mcp.$tools" || actionRef === "mcp.$describe") {
          catalogReservation = this.#catalogStore?.reserve(this.registry.catalogDependencies("mcp", actionArgs as Record<string, unknown>));
        }
        const switching = actionRef === "fabric.workspace" && ["select", "attach", "detach"].includes(String((actionArgs as Record<string, unknown>).action));
        if (switching) {
          if (workspaceCalls || switchRequested) throw new Error("Workspace switch requires a separate bootstrap execution without workspace calls or another switch");
          switchRequested = true;
        } else if (!actionRef.startsWith("fabric.")) {
          if (switchRequested) throw new Error("Workspace calls cannot follow a pending workspace switch; use the next execution");
          const requiresWorkspace = this.registry.requirements(actionRef).verifiedWorkspace === true;
          if ((options.workspaceUnavailable === true || (options.workspaceBound === false && requiresWorkspace)) && actionRef !== "artifacts.read") throw new Error("Verified workspace binding is required; use fabric.workspace in a separate bootstrap execution");
          workspaceCalls = true;
        }
        const invoke = () => this.registry.invoke(actionRef, actionArgs as Record<string, unknown>, {
          ...context,
          ...(operation ? { operationObserver: operation.observer } : {}),
          audits,
          auditBudget,
          maxAuditEntries: this.config.executor.maxAuditEntries,
          maxAuditBytes: this.config.executor.maxAuditBytes,
          maxResultChars: this.config.executor.maxNestedResultChars,
          formatCatalogResult: (value, method) => {
            try {
              return publishCatalog(this.#catalogStore, catalogReservation, method, value, this.config.executor.maxNestedResultChars, pageMethod ? args : undefined);
            } catch (error) {
              const failure = fabricFailureMetadata(error);
              if (failure) throw new FabricRepairError(error instanceof Error ? error.message : "Catalog formatting failed", { ...failure, dispatchState: "dispatched", effectOutcome: "uncertain" });
              throw error;
            }
          },
          approve: (action, exactArgs) => approvals.approve(action, exactArgs, signal, deadline, bridgeSpan?.id),
        }, ref === "fabric.call" && (args.expectedDescriptorDigest !== undefined || args.projection !== undefined) ? {
          ...(args.expectedDescriptorDigest !== undefined ? { expectedDescriptorDigest: args.expectedDescriptorDigest as string } : {}),
          ...(args.projection !== undefined ? { projection: args.projection as "full" | "text" | "structured" } : {}),
        } : undefined);
        const localEffect = ["local.shell", "local.write", "local.edit", "probe.create", "probe.write", "probe.run", "review.begin", "review.update", "review.finding", "review.reconcile", "review.end"].includes(actionRef);
        const invocation = localEffect
          ? localEffectTail.then(invoke, () => { throw new Error("Local effect queue stopped after a failed predecessor; inspect state before a new execution"); })
          : invoke();
        if (localEffect) {
          // Failure poisons this execution's remaining local effects, even if the
          // guest catches it. Never run queued commands after uncertain cleanup.
          localEffectTail = invocation;
          void localEffectTail.catch(() => {});
        }
        if (this.registry.requirements(actionRef).settlement) localSettlements.add(invocation);
        let value: unknown;
        try { value = await invocation; }
        catch (error) {
          if ((actionRef === "local.shell" || actionRef === "probe.run") && (error instanceof LocalShellExitError || error instanceof ProbeRunExitError)) lastShellFailure = error.result;
          throw error;
        }
        finally { localSettlements.delete(invocation); }
        if (bridgeSpan) bridgeEnd = { ok: true, resultChars: traceJsonChars(value), ...(actionRef !== ref ? { actionRef } : {}) };
        return value;
      } catch (error) {
        operationFailed = true; operationError = error;
        if (error instanceof LocalShellExitError || error instanceof ProbeRunExitError) {
          observeContinuity(operation?.observer, observer => observer.result(error.result));
        }
        if (bridgeSpan) bridgeEnd = { ok: false, ...traceFailureMetadata("provider_failed") };
        const failure = fabricFailureMetadata(error);
        if (failure) {
          const handles = checkpoints.snapshot();
          const enriched = { ...failure, ...(handles.length ? { checkpoints: handles } : {}) };
          if (signal.aborted && (interruptedFailure?.effectOutcome !== "uncertain" || enriched.effectOutcome === "uncertain")) interruptedFailure = enriched;
          throw new FabricRepairError(error instanceof Error ? error.message : "Provider failed", enriched);
        }
        throw error;
      } finally {
        catalogReservation?.release();
        bridgeSpan?.end(bridgeEnd);
        activeProviderCalls -= 1;
        // Registry invocation and reservation cleanup have both settled here.
        if (operationFailed) observation?.observe({ phase: "failed" });
        observation?.observe({ phase: "settled" });
        observeContinuity(operation?.observer, observer => observer.settle(!operationFailed, operationError));
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
          ? exactActionTimeoutFloor(actionRef, this.config.mcp.callTimeoutMs, bridgeRef === "fabric.call" && typeof args.args === "object" && args.args !== null ? args.args as Record<string, unknown> : args)
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
    // QuickJS may detach bridge promises on cancellation. Local host effects
    // retain this execution lease until their bounded cleanup really settles.
    await Promise.allSettled([...localSettlements]);
    // Untracked custom providers may outlive an interrupted guest. Never deliver
    // a misleading complete prefix or late facts after this execution returns.
    if (activeProviderCalls > 0) observations?.gap();
    executeSpan?.end({ termination: result.terminationReason, effectiveTimeoutMs: result.effectiveTimeoutMs });
    // Cancellation can arrive while local effect settlement retains the lease,
    // after the VM has already returned. Never publish that late value as success.
    let status = result.terminationReason === "completed" && options.signal?.aborted ? "aborted" as const : statusFor(result.terminationReason);
    let outputError = status === "aborted" && result.terminationReason === "completed" ? "Execution cancelled" : result.error;
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
    const handles = checkpoints.snapshot();
    const failure: FabricFailureMetadata | undefined = result.failure
      ?? ((status === "timed_out" || status === "aborted") ? interruptedFailure : undefined)
      ?? (status !== "succeeded" && handles.length ? { code: status === "timed_out" ? "timeout" : "provider_error", phase: "execution", dispatchState: "dispatched", effectOutcome: "uncertain" } : undefined);
    return {
      status,
      success: status === "succeeded",
      ...(status === "succeeded" ? { value: result.value } : {}),
      logs: result.logs,
      audits,
      elapsedMs: performance.now() - started,
      ...(outputError ? { error: outputError } : {}),
      ...(handles.length ? { checkpoints: handles } : {}),
      ...(status !== "succeeded" && failure ? { failure: { ...failure, ...(status === "timed_out" ? { code: "timeout" as const } : {}), ...(handles.length ? { checkpoints: handles } : {}) } } : {}),
      ...(status === "failed" && lastShellFailure ? { lastShellFailure } : {}),
      effectiveTimeoutMs: result.effectiveTimeoutMs,
    };
  }

  close(): Promise<void> {
    this.invalidateCatalogs();
    return this.#closing ??= (async () => {
      this.#closeController.abort(new Error("Fabric execution service is closed"));
      try {
        await Promise.all([this.#compiler.close(), Promise.allSettled([...this.#executions])]);
      } finally {
        // The sandbox runtime documents that a caller which stops serving must
        // close it, or a pooled thread waits out its retirement window.
        try { await this.#runtime.close(); } finally { await this.registry.close(); }
      }
    })();
  }
}
