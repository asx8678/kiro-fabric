import type { FabricPowerConfig } from "./config.js";
import { ActionRegistry, type FabricCallAudit } from "./core/action-registry.js";
import type { ResolvedFabricAction } from "./protocol.js";
import { powerGuestDeclarations } from "./runtime/guest-types.js";
import { assertFabricJsonBudget } from "./runtime/json-budget.js";
import { QuickJsRuntime, type FabricSandboxTerminationReason } from "./runtime/quickjs-runtime.js";
import { fabricPayloadsLimitError, fabricSourceLimitError } from "./runtime/source-limit.js";
import { typeCheckFabricCodeInWorker, type FabricTypeError } from "./runtime/type-checker.js";

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

export const effectiveFabricTimeout = (
  configuredMaximum: number,
  executorDefault: number,
  exactActionFloor: number,
  invocationTimeout: number,
): number => Math.min(configuredMaximum, Math.max(executorDefault, exactActionFloor, invocationTimeout));

export const exactActionTimeoutFloor = (ref: string, mcpCallTimeoutMs: number): number =>
  ref === "mcp.$call"
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
  constructor(
    readonly registry: ActionRegistry,
    readonly config: FabricPowerConfig,
    readonly cwd: string,
  ) {}

  async execute(options: FabricExecutionOptions): Promise<FabricExecutionResult> {
    const started = performance.now();
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
    if (sourceError) return { status: "failed", success: false, logs: [], audits: [], elapsedMs: performance.now() - started, error: sourceError, effectiveTimeoutMs };

    let checked;
    try {
      checked = await typeCheckFabricCodeInWorker({
        code: options.code,
        declarations: powerGuestDeclarations,
      }, {
        ...(options.signal ? { signal: options.signal } : {}),
        timeoutMs: Math.min(FABRIC_COMPILER_TIMEOUT_MS, effectiveTimeoutMs),
      });
    } catch (error) {
      const aborted = options.signal?.aborted === true;
      return { status: aborted ? "aborted" : "failed", success: false, logs: [], audits: [], elapsedMs: performance.now() - started, error: aborted ? "Execution cancelled" : error instanceof Error ? error.message : String(error), effectiveTimeoutMs };
    }
    if (checked.errors.length) {
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
    const result = await this.#runtime.execute(options.code, async (ref, args, signal, deadline) => {
      providerCalls += 1;
      if (providerCalls > this.config.executor.maxProviderCalls) throw new Error("Fabric provider call quota exceeded");
      activeProviderCalls += 1;
      if (activeProviderCalls > this.config.executor.maxConcurrentProviderCalls) {
        activeProviderCalls -= 1;
        throw new Error("Fabric concurrent provider call quota exceeded");
      }
      try {
        const context = providerContext(signal, deadline);
        if (ref === "fabric.providers") return this.registry.providers();
        if (ref === "fabric.list") return this.registry.list();
        if (ref === "fabric.search") {
          if (typeof args.query !== "string") throw new Error("fabric.search query must be a string");
          return this.registry.search(args.query, typeof args.limit === "number" ? args.limit : 30);
        }
        if (ref === "fabric.describe") {
          if (typeof args.ref !== "string") throw new Error("fabric.describe ref must be a string");
          return this.registry.describe(args.ref);
        }
        const actionRef = ref === "fabric.call" ? args.ref : ref;
        const actionArgs = ref === "fabric.call" ? args.args ?? {} : args;
        if (typeof actionRef !== "string" || typeof actionArgs !== "object" || actionArgs === null || Array.isArray(actionArgs)) {
          throw new Error("Fabric provider call requires an exact ref and object args");
        }
        return await this.registry.invoke(actionRef, actionArgs as Record<string, unknown>, {
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
            try { await options.approver.approve(action, exactArgs, signal); }
            finally { pendingApprovals -= 1; }
          },
        });
      } finally {
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
      ...(options.payloads ? { payloads: options.payloads } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(checked.javascript ? { transpiledCode: checked.javascript } : {}),
      ...(checked.sourceMap ? { transpiledSourceMap: checked.sourceMap } : {}),
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

  async close(): Promise<void> { await this.registry.close(); }
}
