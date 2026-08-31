import type {
  FabricExecutionHost,
  FabricHostApprover,
  FabricUsage,
} from "./kiro/host.js";
import {
  FabricExecutionTraceRecorder,
  FabricTraceSafeError,
  executionOutcomeFromError,
  type FabricExecutionFailureStageV1,
  type FabricExecutionTraceOperationHandle,
  type FabricExecutionTraceV1,
} from "./audit/trace.js";
import { FabricActivityStore } from "./activity/store.js";
import type { CapturedToolCatalog } from "./capture/catalog.js";
import type {
  FabricActivityEventInput,
  FabricActivityItemInput,
  FabricPhaseInput,
  FabricRunDisplay,
} from "./activity/types.js";
import {
  MAX_AGENT_TIMEOUT_MS,
  MIN_AGENT_TIMEOUT_MS,
  type FabricConfig,
} from "./config.js";
import {
  ActionRegistry,
  type FabricCallAudit,
  type FabricRegistryActivityEvent,
  type ResolvedFabricAction,
} from "./core/action-registry.js";
import {
  bindFabricApprovalLease,
  fabricApprovalScope,
  FabricSessionApprovals,
  type FabricApprovalLease,
  type FabricAutoApprovalAudit,
} from "./core/session-approvals.js";
import type { FabricAutoApprovalClassifier } from "./core/auto-approval-classifier.js";
import {
  codeUsesOrchestration,
  isBlockingOrchestrationRef,
} from "./runtime/orchestration.js";
import type { FabricCommittedCapabilityView } from "./protocol.js";
import { fabricExecTitleHintCached } from "./ui/fabric-title-hint.js";
import type {
  QuickJsRuntime,
  FabricSandboxResult,
  FabricSandboxTerminationReason,
} from "./runtime/quickjs-runtime.js";
import type { NodeProcessRuntime } from "./runtime/node-process-runtime.js";
import type { FabricTypeError } from "./runtime/type-checker.js";
import { fabricSourceLimitError } from "./runtime/source-limit.js";

let runtimeDependencies:
  | Promise<{
      QuickJsRuntime: typeof import("./runtime/quickjs-runtime.js").QuickJsRuntime;
      NodeProcessRuntime: typeof import("./runtime/node-process-runtime.js").NodeProcessRuntime;
      typeCheckFabricCodeInWorker: typeof import("./runtime/type-checker.js").typeCheckFabricCodeInWorker;
      guestTypeDeclarations: typeof import("./runtime/guest-types.js").guestTypeDeclarations;
      buildDynamicGuestDeclarations: typeof import("./runtime/dynamic-guest-types.js").buildDynamicGuestDeclarations;
      buildCoreOverrideGuestDeclarations: typeof import("./runtime/core-override-guest-types.js").buildCoreOverrideGuestDeclarations;
    }>
  | undefined;

const loadRuntimeDependencies = () =>
  runtimeDependencies ??= Promise.all([
    import("./runtime/quickjs-runtime.js"),
    import("./runtime/node-process-runtime.js"),
    import("./runtime/type-checker.js"),
    import("./runtime/guest-types.js"),
    import("./runtime/dynamic-guest-types.js"),
    import("./runtime/core-override-guest-types.js"),
  ]).then(([quickjs, nodeProcess, checker, guest, dynamicGuest, coreOverrides]) => ({
    QuickJsRuntime: quickjs.QuickJsRuntime,
    NodeProcessRuntime: nodeProcess.NodeProcessRuntime,
    typeCheckFabricCodeInWorker: checker.typeCheckFabricCodeInWorker,
    guestTypeDeclarations: guest.guestTypeDeclarations,
    buildDynamicGuestDeclarations: dynamicGuest.buildDynamicGuestDeclarations,
    buildCoreOverrideGuestDeclarations: coreOverrides.buildCoreOverrideGuestDeclarations,
  }));

const executionOutcomeFromTermination = (
  reason: FabricSandboxTerminationReason,
): "succeeded" | "failed" | "aborted" | "timed_out" => {
  switch (reason) {
    case "completed":
      return "succeeded";
    case "aborted":
      return "aborted";
    case "timed_out":
      return "timed_out";
    case "runtime_error":
      return "failed";
  }
};

const aggregateUsage = (usages: FabricUsage[]): FabricUsage => ({
  input: usages.reduce((total, usage) => total + usage.input, 0),
  output: usages.reduce((total, usage) => total + usage.output, 0),
  cacheRead: usages.reduce((total, usage) => total + usage.cacheRead, 0),
  cacheWrite: usages.reduce((total, usage) => total + usage.cacheWrite, 0),
  ...(usages.some((usage) => usage.cacheWrite1h !== undefined)
    ? { cacheWrite1h: usages.reduce((total, usage) => total + (usage.cacheWrite1h ?? 0), 0) }
    : {}),
  ...(usages.some((usage) => usage.reasoning !== undefined)
    ? { reasoning: usages.reduce((total, usage) => total + (usage.reasoning ?? 0), 0) }
    : {}),
  totalTokens: usages.reduce((total, usage) => total + usage.totalTokens, 0),
  cost: {
    input: usages.reduce((total, usage) => total + usage.cost.input, 0),
    output: usages.reduce((total, usage) => total + usage.cost.output, 0),
    cacheRead: usages.reduce((total, usage) => total + usage.cost.cacheRead, 0),
    cacheWrite: usages.reduce((total, usage) => total + usage.cost.cacheWrite, 0),
    total: usages.reduce((total, usage) => total + usage.cost.total, 0),
  },
});

export interface FabricExecutionResult {
  success: boolean;
  value: unknown;
  logs: string[];
  audits: FabricCallAudit[];
  phases: string[];
  trace: FabricExecutionTraceV1;
  elapsedMs: number;
  typeErrors?: FabricTypeError[];
  error?: string;
  handoffRequest?: Record<string, unknown>;
  usage?: FabricUsage;
}

interface FabricExecutionPartial {
  audits: FabricCallAudit[];
  phases: string[];
  progress?: string | undefined;
}

export interface FabricExecutionAuthorizer {
  authorize(ref: string, parentToolCallId: string): Promise<void>;
}

export interface FabricExecutionOptions {
  code: string;
  strings?: Record<string, string>;
  signal: AbortSignal | undefined;
  parentToolCallId: string;
  /**
   * Host seam. Pi supplies the real ExtensionContext-backed host; the Kiro
   * MCP adapter supplies a fail-closed host (no model registry, deny-on-ask).
   */
  host: FabricExecutionHost;
  tokenBudget?: number;
  maxAgentCalls?: number;
  display?: FabricRunDisplay;
  onPartial(snapshot: FabricExecutionPartial): void;
}

/**
 * Pi host factory lives in the Pi adapter (`fabric-exec-tool.ts`) so this
 * host-neutral engine module never statically imports the Pi approval UI
 * (ApprovalController pulls in pi-tui).
 */

export class FabricExecutionService {
  #runtime: QuickJsRuntime | NodeProcessRuntime | undefined;
  #runtimeKind: FabricConfig["executor"]["runtime"] | undefined;
  #capabilityView: FabricCommittedCapabilityView | undefined;
  constructor(
    readonly registry: ActionRegistry,
    readonly config: FabricConfig,
    readonly activity?: FabricActivityStore,
    readonly authorizer?: FabricExecutionAuthorizer,
    readonly autoApprovalClassifier?: FabricAutoApprovalClassifier,
    readonly sessionApprovals = new FabricSessionApprovals(),
    readonly capturedTools?: CapturedToolCatalog,
  ) {}

  setCapabilityView(view: FabricCommittedCapabilityView | undefined): void {
    this.#capabilityView = view;
  }

  async execute(options: FabricExecutionOptions): Promise<FabricExecutionResult> {
    const startedAt = performance.now();
    // Managed Kiro registers the same core provider under `k`; every other
    // host keeps the canonical `pi`. Inferring from the registry makes the
    // namespace and dispatch target impossible to configure inconsistently.
    const coreToolNamespace =
      this.registry.has("k") && !this.registry.has("pi") ? "k" : "pi";
    const traceRecorder = new FabricExecutionTraceRecorder(coreToolNamespace);
    const sourceError = fabricSourceLimitError(options.code, this.config.executor.maxSourceBytes);
    if (sourceError) {
      return {
        success: false,
        value: undefined,
        logs: [],
        audits: [],
        phases: [],
        trace: traceRecorder.seal("failed", [], sourceError),
        elapsedMs: performance.now() - startedAt,
        error: sourceError,
      };
    }
    this.activity?.start(
      options.parentToolCallId,
      options.display,
      options.display?.name?.trim() ? undefined : fabricExecTitleHintCached(options.code),
    );
    const dependencies = await loadRuntimeDependencies();
    const effectiveFullCodeMode =
      this.config.fullCodeMode || this.config.schema.mode === "enforce";
    const unavailable = new Map(
      this.registry.unavailableProviders().map((entry) => [entry.name, entry.reason]),
    );
    // Snapshot live mcp/extension tool schemas so the type gate below rejects
    // argument-shape mistakes on those surfaces pre-execution, the way pi.*
    // calls already fail. Snapshotting is side-effect-free (cache-warm read);
    // unavailable or cold providers yield empty sources and the loose
    // declarations stand.
    const guestTypeSources = await this.registry.guestTypeSources({
      cwd: options.host.cwd,
      signal: options.signal,
      parentToolCallId: options.parentToolCallId,
      nestedToolCallId: `${options.parentToolCallId}_typedecls`,
      extensionContext: options.host.payload as import("@earendil-works/pi-coding-agent").ExtensionContext,
      update() {},
      ...(this.#capabilityView ? { capabilityView: this.#capabilityView } : {}),
    });
    const coreOverrideDeclarations =
      effectiveFullCodeMode
        ? dependencies.buildCoreOverrideGuestDeclarations(
            this.capturedTools?.list().map((entry) => ({
              name: entry.name,
              inputSchema: entry.definition.parameters,
            })) ?? [],
          )
        : undefined;
    // Fabric actions are runtime-schema validated, so execution deliberately
    // uses schema-relaxed checking rather than claiming full TypeScript
    // strictness. The public compiler API also exposes honest strict mode.
    const compilerMode = "schema-relaxed" as const;
    let checked;
    try {
      checked = await dependencies.typeCheckFabricCodeInWorker({
        code: options.code,
        declarations: dependencies.guestTypeDeclarations(effectiveFullCodeMode, {
          excludeGlobals: [...unavailable.keys()],
          dynamic: dependencies.buildDynamicGuestDeclarations(guestTypeSources),
          ...(coreOverrideDeclarations ? { coreOverrides: coreOverrideDeclarations } : {}),
          coreToolNamespace,
          agentBackedOrchestration:
            options.host.agentBackedOrchestration !== false,
        }),
        mode: compilerMode,
      }, {
        ...(options.signal ? { signal: options.signal } : {}),
        timeoutMs: 10_000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = options.signal?.aborted
        ? "aborted"
        : message.includes("timed out") ? "timed_out" : "failed";
      const compilerTrace = traceRecorder.issueCall("fabric.compiler.check", { mode: compilerMode });
      compilerTrace.fail("invoke", undefined, outcome);
      this.activity?.finish(options.parentToolCallId, false, message);
      return {
        success: false,
        value: undefined,
        logs: [],
        audits: [],
        phases: [],
        trace: traceRecorder.seal(outcome, [], message),
        elapsedMs: performance.now() - startedAt,
        error: message,
      };
    }
    if (checked.errors.length > 0) {
      for (const error of checked.errors) {
        const missing = /^Cannot find name '([^']+)'/.exec(error.message);
        const reason = missing?.[1] ? unavailable.get(missing[1]) : undefined;
        if (missing && reason) {
          error.message = `${error.message} Fabric provider "${missing[1]}" is unavailable: ${reason}`;
        }
      }
      this.activity?.finish(options.parentToolCallId, false, "Type checking failed");
      return {
        success: false,
        value: undefined,
        logs: [],
        audits: [],
        phases: [],
        trace: traceRecorder.seal(
          "failed",
          [],
          `Type checking failed (${checked.errors.length} ${checked.errors.length === 1 ? "error" : "errors"})`,
        ),
        elapsedMs: performance.now() - startedAt,
        typeErrors: checked.errors,
      };
    }

    const classifierUsages: FabricUsage[] = [];
    const recordAutoDecision = (
      audit: FabricAutoApprovalAudit,
      decision?: { usage: FabricUsage },
    ): void => {
      const operation = traceRecorder.issueCall("fabric.approval.auto", {
        action: audit.action,
        risk: audit.risk,
      });
      operation.succeed(audit);
      if (decision) classifierUsages.push(decision.usage);
    };
    const approval = options.host.createApprover(recordAutoDecision, (usage) => {
      classifierUsages.push(usage);
    });
    // Bind every per-call lease to this exact checked program and project. Only
    // these digests cross the approval/audit boundary; source and cwd do not.
    const approvalScope = fabricApprovalScope({
      plan: options.code,
      project: options.host.cwd,
    });
    const requestApprovalLease = async (
      action: ResolvedFabricAction,
      args: Record<string, unknown>,
      scope = approvalScope,
    ): Promise<FabricApprovalLease> =>
      (await approval.approve(action, args, scope, options.signal)) ??
      this.sessionApprovals.issueLease(action, args, scope, "explicit-broad");
    const audits: FabricCallAudit[] = [];
    const phases: string[] = [];
    const workflowSpans = new Map<
      string,
      { kind: "parallel" | "pipeline"; operation: FabricExecutionTraceOperationHandle }
    >();
    let agentCalls = 0;
    let handoffRequest: Record<string, unknown> | undefined;
    const maxAgentCalls = Math.max(
      1,
      Math.min(
        options.maxAgentCalls ?? this.config.agents.maxPerExecution,
        this.config.agents.maxPerExecution,
      ),
    );
    const guardAgentCall = (ref: string): void => {
      if (
        ref !== "agents.run" &&
        ref !== "agents.handoff" &&
        ref !== "agents.spawn" &&
        ref !== "agents.create"
      ) return;
      agentCalls++;
      if (agentCalls > maxAgentCalls) {
        throw new FabricTraceSafeError(`Fabric agent budget exhausted (${maxAgentCalls} per execution)`);
      }
    };
    const fullCodeProvider = (value: string): string | undefined => {
      const separator = value.indexOf(".");
      const provider = separator > 0 ? value.slice(0, separator) : value;
      return provider === coreToolNamespace || provider === "extensions" ? provider : undefined;
    };
    const guardFullCodeRef = (ref: string): void => {
      if (effectiveFullCodeMode) return;
      const provider = fullCodeProvider(ref);
      if (!provider) return;
      throw new FabricTraceSafeError(
        `Fabric full code mode is disabled; call ${provider === coreToolNamespace ? (coreToolNamespace === "pi" ? "Pi core" : "Kiro core") : "registered extension"} tools directly outside fabric_exec`,
      );
    };
    let currentProgress: string | undefined;
    let emitPending = false;
    let emitTimer: NodeJS.Timeout | undefined;
    const emitNow = (): void => {
      emitPending = false;
      options.onPartial({
        audits: audits.slice(),
        phases: phases.slice(),
        progress: currentProgress,
      });
    };
    const flushEmit = (): void => {
      if (emitTimer) clearTimeout(emitTimer);
      emitTimer = undefined;
      if (emitPending) emitNow();
    };
    // One execution-wide timer coalesces updates from every parallel nested
    // call. Keeping this global to the Fabric program prevents each call from
    // independently churning rows while preserving a trailing final snapshot.
    const emit = (): void => {
      emitPending = true;
      const debounceMs = this.config.ui.updateDebounceMs;
      if (debounceMs <= 0) {
        flushEmit();
        return;
      }
      // Throttle to one render per window without resetting the timer. A
      // trailing debounce starves continuously streaming tools because every
      // delta postpones the render until the tool finishes.
      if (emitTimer) return;
      emitTimer = setTimeout(() => {
        emitTimer = undefined;
        if (emitPending) emitNow();
      }, debounceMs);
      emitTimer.unref?.();
    };
    const update = (message: string): void => {
      currentProgress = message;
      emit();
    };
    const observeInvocation = (event: FabricRegistryActivityEvent): void => {
      if (this.activity) {
        if (event.type === "call_start") {
          this.activity.beginCall(options.parentToolCallId, event);
        } else if (event.type === "call_update") {
          this.activity.updateCall(options.parentToolCallId, event.callId, event.update);
        } else if (event.type === "call_args") {
          this.activity.updateCallArgs(options.parentToolCallId, event.callId, event.args);
        } else {
          this.activity.finishCall(options.parentToolCallId, event.callId, event);
        }
      }
      if (event.type === "call_end") emit();
    };
    const baseContext = {
      cwd: options.host.cwd,
      signal: options.signal,
      parentToolCallId: options.parentToolCallId,
      nestedToolCallId: `${options.parentToolCallId}_metadata`,
      extensionContext: options.host.payload as import("@earendil-works/pi-coding-agent").ExtensionContext,
      update,
      ...(this.#capabilityView ? { capabilityView: this.#capabilityView } : {}),
      approvalScope,
    };
    // Start known orchestration programs with the longer deadline. Calls
    // reached through generic or computed refs are classified again at the
    // host bridge and can extend the active sandbox deadline before they run.
    const orchestrationTimeoutMs = Math.max(
      this.config.executor.timeoutMs,
      this.config.agents.timeoutMs,
    );
    const effectiveTimeoutMs = codeUsesOrchestration(options.code)
      ? orchestrationTimeoutMs
      : this.config.executor.timeoutMs;
    const minimumTimeoutMsForHostCall = (
      ref: string,
      args: Record<string, unknown>,
    ): number | undefined => {
      const targetRef =
        ref === "fabric.$call" && typeof args.ref === "string" ? args.ref : ref;
      const targetArgs =
        ref === "fabric.$call" &&
        typeof args.args === "object" &&
        args.args !== null &&
        !Array.isArray(args.args)
          ? (args.args as Record<string, unknown>)
          : args;
      if (targetRef === `${coreToolNamespace}.bash`) {
        const seconds = targetArgs.timeout;
        const milliseconds = targetArgs.timeoutMs;
        const requested =
          typeof seconds === "number" && Number.isFinite(seconds)
            ? seconds * 1_000
            : typeof milliseconds === "number" && Number.isFinite(milliseconds)
              ? milliseconds
              : 0;
        if (requested > 0) {
          return Math.max(
            this.config.executor.timeoutMs,
            Math.min(Math.floor(requested) + 5_000, MAX_AGENT_TIMEOUT_MS),
          );
        }
      }
      if (!isBlockingOrchestrationRef(targetRef)) return undefined;
      const requestedTimeoutMs =
        targetRef === "agents.run" &&
        typeof targetArgs.timeoutMs === "number" &&
        Number.isFinite(targetArgs.timeoutMs)
          ? Math.max(
              MIN_AGENT_TIMEOUT_MS,
              Math.min(Math.floor(targetArgs.timeoutMs), MAX_AGENT_TIMEOUT_MS),
            )
          : 0;
      return Math.max(orchestrationTimeoutMs, requestedTimeoutMs);
    };
    const traceAttempt = async <T>(
      ref: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
      run: (setStage: (stage: FabricExecutionFailureStageV1) => void) => T | Promise<T>,
    ): Promise<T> => {
      const operation = traceRecorder.issueCall(ref, args);
      let stage: FabricExecutionFailureStageV1 = "invoke";
      try {
        const value = await run((nextStage) => {
          stage = nextStage;
        });
        operation.succeed(undefined);
        return value;
      } catch (error) {
        operation.fail(stage, error, executionOutcomeFromError(error, signal));
        throw error;
      }
    };
    const invokeAction = async (
      ref: string,
      args: Record<string, unknown>,
      callContext: typeof baseContext & { signal: AbortSignal },
    ): Promise<unknown> => {
      const traceOperation = traceRecorder.issueCall(ref, args);
      try {
        guardFullCodeRef(ref);
        guardAgentCall(ref);
      } catch (error) {
        traceOperation.fail(
          "guard",
          error,
          executionOutcomeFromError(error, callContext.signal),
        );
        throw error;
      }
      return this.registry.invoke(ref, args, {
        ...callContext,
        ...(ref === "agents.handoff"
          ? {
              deferHandoff(request: Record<string, unknown>) {
                if (handoffRequest) {
                  throw new Error(
                    "Only one agents.handoff request is allowed per fabric_exec invocation",
                  );
                }
                handoffRequest = structuredClone(request);
                return {
                  scheduled: true,
                  status: "deferred",
                  boundary: "fabric_exec_end",
                };
              },
            }
          : {}),
        ...(this.authorizer
          ? {
              authorize: (action) =>
                this.authorizer!.authorize(action.ref, options.parentToolCallId),
            }
          : {}),
        approve: async (action, preparedArgs, scope) => {
          if (action.ref === "schema.commit") {
            const writeAction = { ...action, risk: "write" as const };
            const executeAction = { ...action, risk: "execute" as const };
            const consumedScope = scope ?? approvalScope;
            const writeLease = await requestApprovalLease(
              writeAction,
              preparedArgs,
              consumedScope,
            );
            const executeLease = await requestApprovalLease(
              executeAction,
              preparedArgs,
              consumedScope,
            );
            return [
              bindFabricApprovalLease(writeLease, writeAction),
              bindFabricApprovalLease(executeLease, executeAction),
            ];
          }
          return requestApprovalLease(action, preparedArgs, scope ?? approvalScope);
        },
        audits,
        maxResultChars: this.config.executor.maxNestedResultChars,
        traceOperation,
        observeInvocation,
      });
    };
    let sandboxResult: FabricSandboxResult;
    try {
      const runtimeKind = this.config.executor.runtime;
      if (!this.#runtime || this.#runtimeKind !== runtimeKind) {
        this.#runtime = runtimeKind === "node-process"
          ? new dependencies.NodeProcessRuntime()
          : new dependencies.QuickJsRuntime();
        this.#runtimeKind = runtimeKind;
      }
      sandboxResult = await this.#runtime.execute(
        options.code,
        async (ref, args, runtimeSignal) => {
          const callContext = { ...baseContext, signal: runtimeSignal };
          switch (ref) {
            case "fabric.$providers":
              return traceAttempt(
                "fabric.discovery.providers",
                args,
                runtimeSignal,
                () =>
                  this.registry
                    .providers()
                    .filter((provider) =>
                      !callContext.capabilityView ||
                      Object.values(callContext.capabilityView.bindings)
                        .some((binding) => binding.provider === provider.name),
                    )
                    .filter(
                      (provider) => effectiveFullCodeMode || !fullCodeProvider(provider.name),
                    ),
              );
            case "fabric.$catalog":
              return traceAttempt(
                "fabric.discovery.catalog",
                args,
                runtimeSignal,
                async (setStage) => {
                  const provider = typeof args.provider === "string" ? args.provider : undefined;
                  setStage("guard");
                  if (provider) guardFullCodeRef(`${provider}.*`);
                  setStage(provider && !this.registry.has(provider) ? "resolve" : "invoke");
                  return this.registry.catalog(callContext, {
                    ...(provider ? { provider } : {}),
                    ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
                    includeProvider: (name) => effectiveFullCodeMode || !fullCodeProvider(name),
                  });
                },
              );
            case "fabric.$models": {
              const operation = traceRecorder.issueCall("fabric.discovery.models", args);
              try {
                const models = options.host.listModels?.() ?? [];
                operation.succeed(undefined);
                return models;
              } catch (error) {
                operation.fail(
                  "invoke",
                  error,
                  executionOutcomeFromError(error, runtimeSignal),
                );
                return [];
              }
            }
            case "fabric.$list":
              return traceAttempt(
                "fabric.discovery.list",
                args,
                runtimeSignal,
                async (setStage) => {
                  setStage("guard");
                  if (typeof args.provider === "string") {
                    guardFullCodeRef(`${args.provider}.*`);
                  }
                  setStage(
                    typeof args.provider === "string" && !this.registry.has(args.provider)
                      ? "resolve"
                      : "invoke",
                  );
                  const actions = await this.registry.list(
                    {
                      ...(typeof args.provider === "string" ? { provider: args.provider } : {}),
                      ...(typeof args.namespace === "string" ? { namespace: args.namespace } : {}),
                      ...(typeof args.query === "string" ? { query: args.query } : {}),
                      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
                    },
                    callContext,
                  );
                  return actions.filter(
                    (action) => effectiveFullCodeMode || !fullCodeProvider(action.provider),
                  );
                },
              );
            case "fabric.$search":
              return traceAttempt(
                "fabric.discovery.search",
                args,
                runtimeSignal,
                async () => {
                  const actions = await this.registry.search(
                    String(args.query ?? ""),
                    callContext,
                    typeof args.limit === "number" ? args.limit : undefined,
                  );
                  return actions.filter(
                    (action) => effectiveFullCodeMode || !fullCodeProvider(action.provider),
                  );
                },
              );
            case "fabric.$describe":
              return traceAttempt(
                "fabric.discovery.describe",
                args,
                runtimeSignal,
                async (setStage) => {
                  const targetRef = String(args.ref ?? "");
                  setStage("guard");
                  guardFullCodeRef(targetRef);
                  setStage("resolve");
                  return this.registry.describe(targetRef, callContext);
                },
              );
            case "fabric.$call": {
              const callArgs =
                typeof args.args === "object" && args.args !== null && !Array.isArray(args.args)
                  ? (args.args as Record<string, unknown>)
                  : {};
              const targetRef = String(args.ref ?? "");
              return invokeAction(targetRef, callArgs, callContext);
            }
            case "fabric.$progress":
              return traceAttempt(
                "fabric.workflow.progress",
                args,
                runtimeSignal,
                () => update(String(args.message ?? "Working")),
              );
            case "fabric.$configure":
              return traceAttempt(
                "fabric.workflow.configure",
                args,
                runtimeSignal,
                () => {
                  const display: FabricRunDisplay = {
                    ...(typeof args.name === "string" ? { name: args.name } : {}),
                    ...(typeof args.description === "string" ? { description: args.description } : {}),
                  };
                  return this.activity?.configure(options.parentToolCallId, display) ?? display;
                },
              );
            case "fabric.$phase":
              return traceAttempt(
                "fabric.workflow.phase",
                args,
                runtimeSignal,
                (setStage) => {
                  setStage("validate");
                  const name =
                    typeof args.name === "string" ? args.name.trim() : "";
                  if (!name) throw new Error("Workflow phase name must be a non-empty string");
                  phases.push(name);
                  const phaseIndex = phases.length - 1;
                  const phaseInput: FabricPhaseInput = {
                    name,
                    ...(typeof args.id === "string" ? { id: args.id } : {}),
                    ...(typeof args.description === "string" ? { description: args.description } : {}),
                    ...(typeof args.total === "number" ? { total: args.total } : {}),
                  };
                  setStage("invoke");
                  const activityPhase = this.activity?.phase(options.parentToolCallId, phaseInput);
                  update(`Phase: ${name}`);
                  return {
                    name,
                    index: phaseIndex,
                    ...(activityPhase ? { id: activityPhase.id } : {}),
                  };
                },
              );
            case "fabric.$item":
              return traceAttempt(
                "fabric.workflow.item",
                args,
                runtimeSignal,
                () => {
                  const item = args as unknown as FabricActivityItemInput;
                  return this.activity?.upsertItem(options.parentToolCallId, item) ?? item;
                },
              );
            case "fabric.$event":
              return traceAttempt(
                "fabric.workflow.event",
                args,
                runtimeSignal,
                () => {
                  const event = args as unknown as FabricActivityEventInput;
                  this.activity?.event(options.parentToolCallId, event);
                },
              );
            case "fabric.$spanStart": {
              const id = typeof args.id === "string" ? args.id : "";
              const kind = args.kind;
              if (!id || (kind !== "parallel" && kind !== "pipeline")) {
                throw new Error("Invalid internal workflow span start");
              }
              if (workflowSpans.has(id)) throw new Error("Duplicate internal workflow span");
              const operation = traceRecorder.issueCall(`fabric.workflow.${kind}`, args);
              workflowSpans.set(id, { kind, operation });
              return undefined;
            }
            case "fabric.$spanEnd": {
              const id = typeof args.id === "string" ? args.id : "";
              const span = workflowSpans.get(id);
              if (!span) throw new Error("Unknown internal workflow span");
              workflowSpans.delete(id);
              if (args.outcome === "succeeded") span.operation.succeed(undefined);
              else {
                span.operation.fail(
                  "invoke",
                  undefined,
                  executionOutcomeFromError(new Error("Workflow span failed"), runtimeSignal),
                );
              }
              return undefined;
            }
            default:
              return invokeAction(ref, args, callContext);
          }
        },
        {
          timeoutMs: effectiveTimeoutMs,
          memoryLimitBytes: this.config.executor.memoryLimitBytes,
          maxSourceBytes: this.config.executor.maxSourceBytes,
          maxLogChars: this.config.executor.maxOutputChars,
          minimumTimeoutMsForHostCall,
          coreToolNamespace,
          agentBackedOrchestration:
            options.host.agentBackedOrchestration !== false,
          ...(options.host.defaultAgentRunner
            ? { defaultAgentRunner: options.host.defaultAgentRunner }
            : {}),
          ...(options.host.unaccountedAgentRunners
            ? { unaccountedAgentRunners: options.host.unaccountedAgentRunners }
            : {}),
          ...(checked.javascript ? { transpiledCode: checked.javascript } : {}),
          ...(checked.sourceMap ? { transpiledSourceMap: checked.sourceMap } : {}),
          ...(options.strings ? { strings: options.strings } : {}),
          ...(options.tokenBudget !== undefined ? { tokenBudget: options.tokenBudget } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.activity?.finish(options.parentToolCallId, false, message);
      throw error;
    } finally {
      await this.registry.endInvocation(options.parentToolCallId);
      flushEmit();
    }

    const runOutcome = executionOutcomeFromTermination(sandboxResult.terminationReason);
    const succeeded = runOutcome === "succeeded";
    this.activity?.finish(options.parentToolCallId, succeeded, sandboxResult.error);
    return {
      success: succeeded,
      value: sandboxResult.value,
      logs: sandboxResult.logs,
      audits,
      phases,
      // Guest and provider error text may embed tool output or source
      // literals, so the durable trace records only safe causes.
      trace: traceRecorder.seal(runOutcome, phases),
      elapsedMs: performance.now() - startedAt,
      ...(sandboxResult.error ? { error: sandboxResult.error } : {}),
      ...(handoffRequest ? { handoffRequest } : {}),
      ...(classifierUsages.length > 0
        ? { usage: aggregateUsage(classifierUsages) }
        : {}),
    };
  }
}
