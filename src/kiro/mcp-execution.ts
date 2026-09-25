import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolRequest, ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { Value } from "typebox/value";
import { loadFabricConfig } from "../config.js";
import { FABRIC_COMPILER_TIMEOUT_MS, effectiveFabricTimeout } from "../execution-service.js";
import { fabricExecInputSchema, prepareFabricExecArguments, type FabricExecInput } from "../kernel/fabric-exec-contract.js";
import { fabricPayloadsLimitError, fabricSourceLimitError, MAX_EXECUTOR_SOURCE_BYTES } from "../runtime/source-limit.js";
import { FabricDeadline } from "../runtime/deadline.js";
import { FOVEA_CALL_COLLECTION_MS, FOVEA_CALL_RESERVE_MS, FOVEA_CALL_WARM_MS } from "../fovea/call-context.js";
import type { FoveaBoundClient } from "../fovea/host.js";
import type { FabricArtifactAccess } from "../protocol.js";
import type { FabricTracer } from "../trace/tracer.js";
import { collectFoveaContext, type FoveaResponseDelivery } from "./fovea-context.js";
import { collectFoveaCallContext, FoveaCallObservation } from "./fovea-call-context.js";
import { kiroMcpOuterDeadlineMs } from "./deadlines.js";
import { KiroPowerFabricApprover, type KiroPowerApprover } from "./power/approver.js";
import type { KiroPowerWorkspaceBinding, KiroPowerWorkspaceMutation } from "./power/workspace-binding.js";
import type { KiroHostTurn } from "./host-session-adapter.js";
import type { KiroRuntime } from "./runtime.js";
import type { KiroMcpServerOptions } from "./mcp-server.js";
import type { createKiroArtifactOwner } from "./artifact-owner.js";
import type { createMcpSessionLifecycle, ActiveExecution } from "./mcp-session-lifecycle.js";
import { isRecord, toolError } from "./mcp-response.js";
import { commitDeferredWorkspace, workspaceRequest, workspaceTransitionText, WORKSPACE_TRANSITION_RESERVE_CHARS, type WorkspaceTransitionContext, type WorkspaceTransitionOutcome } from "./mcp-workspace.js";
import { projectFabricExecutionText } from "./projection.js";

export interface McpExecutionContext {
  options: Pick<KiroMcpServerOptions, "foveaCallContext" | "foveaPostToolContext" | "hostSessions">;
  data: { configFile: string };
  tracer: FabricTracer;
  binding: KiroPowerWorkspaceBinding;
  fabricApprover: KiroPowerApprover;
  artifacts: ReturnType<typeof createKiroArtifactOwner>;
  artifactAccess: FabricArtifactAccess;
  sessionLifecycle: ReturnType<typeof createMcpSessionLifecycle>;
  transitions: WorkspaceTransitionContext;
  foveaClients: WeakMap<KiroRuntime, FoveaBoundClient>;
  foveaDelivery: FoveaResponseDelivery;
  syncWorkspace(): Promise<unknown>;
  unavailableWorkspace(): boolean;
  acquireRuntime(controller: AbortController): Promise<{ current: KiroRuntime; execution: ActiveExecution }>;
  infoValue(current: KiroRuntime | undefined, blocked: boolean): Promise<unknown>;
  workspaceValue(action: "status" | "list"): unknown;
}

/** Execute and project one request. Session ownership and workspace commits
 * are supplied capabilities; this handler never owns transport shutdown. */
export const callMcpExecution = async (
  context: McpExecutionContext, request: CallToolRequest,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>, turn?: KiroHostTurn,
) => {
  const { options, data, tracer, binding, fabricApprover, artifacts, artifactAccess,
    sessionLifecycle, transitions, foveaClients, foveaDelivery, syncWorkspace,
    unavailableWorkspace, acquireRuntime, infoValue, workspaceValue } = context;
  const { assertAvailable, releaseExecution } = sessionLifecycle;
  const execId = tracer.enabled ? tracer.newExecutionId() : undefined;
  if (tracer.enabled) tracer.event("eval", "tool.fabric_exec", execId);
  const tracedError = (code: string, error: unknown, issues?: readonly unknown[]) => {
    const response = toolError(code, error, issues);
    if (tracer.enabled) {
      const text = response.content[0]!.text;
      tracer.event("eval", "exec.projection", execId, {
        visibleChars: text.length,
        visibleBytes: Buffer.byteLength(text, "utf8"),
        isError: true,
        overflowed: false,
        artifactRetained: false,
      });
      tracer.flush();
    }
    return response;
  };
  try {
    await syncWorkspace();
  } catch (error) {
    return tracedError("adapter_error", error);
  }
  const normalized = prepareFabricExecArguments(request.params.arguments ?? {});
  const normalizedRecord = isRecord(normalized) ? normalized : undefined;
  const absoluteInputError = typeof normalizedRecord?.code === "string"
    ? fabricSourceLimitError(normalizedRecord.code, MAX_EXECUTOR_SOURCE_BYTES)
    : undefined;
  const absolutePayloadError = isRecord(normalizedRecord?.payloads)
    ? fabricPayloadsLimitError(
        normalizedRecord.payloads as Record<string, string>,
        MAX_EXECUTOR_SOURCE_BYTES,
      )
    : undefined;
  if (absoluteInputError || absolutePayloadError) {
    return tracedError("invalid_exec_arguments", absoluteInputError ?? absolutePayloadError!);
  }
  if (!Value.Check(fabricExecInputSchema, normalized)) {
    const errors = [...Value.Errors(fabricExecInputSchema, normalized)].map((entry) => entry.message);
    return tracedError("invalid_exec_arguments", "Invalid fabric_exec arguments", errors);
  }
  const input = normalized as FabricExecInput;
  const controller = new AbortController();
  const cancel = (): void => controller.abort(extra.signal.reason ?? new Error("MCP request cancelled"));
  if (extra.signal.aborted) cancel(); else extra.signal.addEventListener("abort", cancel, { once: true });
  let execution: ActiveExecution | undefined;
  let timer: NodeJS.Timeout | undefined;
  const outerStarted = performance.now();
  let outerDeadline = 0;
  const scheduleOuterDeadline = (guestTimeoutMs: number): void => {
    outerDeadline = kiroMcpOuterDeadlineMs(guestTimeoutMs, FABRIC_COMPILER_TIMEOUT_MS);
    if (timer) clearTimeout(timer);
    const remaining = Math.max(0, outerStarted + outerDeadline - performance.now());
    timer = setTimeout(() => controller.abort(new Error(`MCP request exceeded ${outerDeadline}ms`)), remaining);
  };
  try {
    // Configuration I/O is part of the request lifetime: malformed/private
    // config must use the same bounded response, telemetry, and cleanup path.
    const initialConfig = loadFabricConfig(data.configFile);
    scheduleOuterDeadline(effectiveFabricTimeout(
      initialConfig.executor.maxTimeoutMs,
      initialConfig.executor.timeoutMs,
      0,
      input.timeoutMs ?? 0,
    ));
    const acquired = await acquireRuntime(controller);
    execution = acquired.execution;
    const current = acquired.current;
    scheduleOuterDeadline(effectiveFabricTimeout(
      current.service.config.executor.maxTimeoutMs,
      current.service.config.executor.timeoutMs,
      0,
      input.timeoutMs ?? 0,
    ));
    const approver = new KiroPowerFabricApprover(
      current.service.config.approvals,
      fabricApprover,
      current.service.cwd,
    );
    const pinnedIdentity = binding.bindingIdentity();
    const workspaceVerified = !unavailableWorkspace() && binding.workspaceObservation().status === "verified";
    let pendingMutation: KiroPowerWorkspaceMutation | undefined;
    const bootstrap = {
      info: () => infoValue(current, unavailableWorkspace() || binding.workspaceObservation().status === "temporarily-unavailable"),
      workspace: async (
        args: Record<string, unknown>,
        signal?: AbortSignal,
        chargeApproval?: (prompt: () => Promise<void>) => Promise<void>,
      ) => {
        const parsed = workspaceRequest(args);
        if (tracer.enabled) { tracer.event("eval", "tool.fabric_workspace", execId, { action: parsed.action }); tracer.flush(); }
        if (parsed.action === "status" || parsed.action === "list") return workspaceValue(parsed.action);
        if (pendingMutation) throw new Error("Only one workspace transition is permitted per execution");
        if (parsed.action === "select" && unavailableWorkspace()) throw new Error("workspace roots are temporarily unverifiable");
        pendingMutation = await binding.prepareMutation(parsed, signal, chargeApproval);
        signal?.throwIfAborted();
        if (binding.bindingIdentity() !== pinnedIdentity) throw new Error("Workspace changed during bootstrap preparation");
        return { status: "pending", action: parsed.action, committed: false, nextExecutionRequired: true };
      },
    };
    const contextClient = foveaClients.get(current);
    const callObservations = options.foveaCallContext === true && contextClient && workspaceVerified
      ? new FoveaCallObservation(current.service.cwd, contextClient.observer) : undefined;
    const result = await current.service.execute({
      code: input.code,
      ...(input.payloads ? { payloads: input.payloads } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      signal: controller.signal,
      approver,
      ...(callObservations ? { operationObserver: callObservations } : contextClient ? { operationObserver: contextClient.observer } : {}),
      bootstrap,
      artifactAccess,
      workspaceBound: workspaceVerified,
      workspaceUnavailable: unavailableWorkspace() || binding.workspaceObservation().status === "temporarily-unavailable",
      onEffectiveTimeoutChange: scheduleOuterDeadline,
      ...(execId !== undefined ? { tracer, execId } : {}),
    });
    let workspaceTransition: WorkspaceTransitionOutcome | undefined;
    if (pendingMutation) {
      const mutation = pendingMutation;
      workspaceTransition = { action: mutation.action, status: "not-committed", committed: false, nextExecutionRequired: true };
      if (result.success) {
        // The guest is settled. Release OUR lease before draining the old
        // runtime, but keep artifact authority until the owner retires.
        releaseExecution(execution);
        execution = undefined;
        workspaceTransition = await commitDeferredWorkspace(transitions, mutation, pinnedIdentity, controller.signal);
      }
    }
    // Retention starts after transition settlement. A delivery failure cannot
    // roll back an already committed switch or replay an executed program.
    const publicationHandles: string[] = [];
    let projection = projectFabricExecutionText({
      result,
      resultFormat: input.resultFormat ?? current.service.config.executor.resultFormat,
      maxOutputChars: current.service.config.executor.maxOutputChars - (pendingMutation ? WORKSPACE_TRANSITION_RESERVE_CHARS : 0),
      writeArtifact: (content) => {
        assertAvailable();
        // A full-output write must not evict the receipt just issued by this
        // same projection. If both cannot fit, report unavailable delivery.
        const id = artifacts.write(content, publicationHandles);
        publicationHandles.push(id);
        return id;
      },
    });
    // Optional analysis must not turn an approved write or one-time read
    // into an unapproved repository-wide read. Skip ask/deny without prompting.
    if (contextClient && workspaceVerified && !pendingMutation && current.service.config.approvals.read === "allow" &&
        (options.foveaCallContext === true || (options.foveaPostToolContext?.authorizedAnalysis === true && options.foveaPostToolContext.qualifiedVisibleDelivery === true))) {
      // No extension of the original outer deadline. Analysis has its own
      // bounded cleanup scope and never holds a source-effect reservation.
      const remaining = Math.min(options.foveaCallContext === true ? FOVEA_CALL_COLLECTION_MS : 2_000, Math.max(0, outerStarted + outerDeadline - performance.now()));
      if (remaining >= (options.foveaCallContext === true ? FOVEA_CALL_WARM_MS + FOVEA_CALL_RESERVE_MS : 1) && !controller.signal.aborted) {
        const automatic = new AbortController();
        const timer = setTimeout(() => automatic.abort(new Error("Navigator context budget elapsed")), remaining);
        try {
          const invocation = { cwd: current.service.cwd, signal: AbortSignal.any([controller.signal, automatic.signal]), deadline: new FabricDeadline(remaining, remaining) };
          const context = options.foveaCallContext === true && callObservations
            ? await collectFoveaCallContext(contextClient, callObservations, projection, invocation, current.service.config.executor.maxOutputChars)
            : await collectFoveaContext(contextClient, projection, invocation, current.service.config.executor.maxOutputChars);
          let delivery = context.delivery;
          if (delivery && turn && options.hostSessions && options.foveaCallContext !== true) {
            delivery = options.hostSessions.bindDelivery(turn, delivery, async noticeId => {
              const deadline = new FabricDeadline(2_000, 2_000);
              await contextClient.acknowledgeDelivery(noticeId, { cwd: current.service.cwd, signal: turn.signal, deadline });
            });
          }
          if (!context.delivery || delivery && foveaDelivery.track(extra.requestId, delivery, extra.signal, projection.text)) projection = context.projection;
        } finally { clearTimeout(timer); }
      }
    }
    // Optional analysis can await, and one projection may evict an earlier
    // receipt at a very small quota. Never advertise an already-invalid host
    // handle. Arbitrary guest-returned strings are not artifact authority.
    const handles = [projection.artifactId, projection.receiptId, ...(projection.checkpointIds ?? [])].filter((id): id is string => id !== undefined);
    if (handles.length && (sessionLifecycle.unavailable() || handles.some(id => !artifacts.has(id)))) {
      projection.text = `Ephemeral output evidence became unavailable before delivery; execution: ${result.status}; delivery: unavailable; retryProgram: false. Effects may already be applied; inspect state.`;
      projection.isError = true;
      projection.deliveryStatus = "unavailable";
      projection.artifactRetained = false;
      projection.retention = "unavailable";
      delete projection.artifactId;
      delete projection.receiptId;
      projection.checkpointIds = [];
    }
    if (workspaceTransition) {
      projection.text += workspaceTransitionText(workspaceTransition);
      if (workspaceTransition.status !== "committed") projection.isError = true;
    }
    projection.visibleChars = projection.text.length;
    projection.visibleBytes = Buffer.byteLength(projection.text, "utf8");
    if (tracer.enabled) {
      tracer.event("eval", "exec.projection", execId, {
        visibleChars: projection.visibleChars,
        visibleBytes: projection.visibleBytes,
        isError: projection.isError,
        overflowed: projection.overflowed,
        artifactRetained: projection.artifactRetained,
      });
      tracer.flush();
    }
    return {
      content: [{ type: "text" as const, text: projection.text }],
      // Additive host metadata; never wrap or rewrite the program's returned value.
      structuredContent: {
        executionStatus: projection.executionStatus,
        deliveryStatus: projection.deliveryStatus,
        retryProgram: projection.retryProgram,
        ...(workspaceTransition ? { workspaceTransition } : {}),
        ...(projection.checkpointIds?.length ? { checkpointIds: projection.checkpointIds } : {}),
        ...(projection.receiptId === undefined ? {} : { receiptId: projection.receiptId }),
        ...(projection.artifactId === undefined ? {} : { artifactId: projection.artifactId }),
      },
      ...(projection.isError ? { isError: true } : {}),
    };
  } catch (error) { return tracedError("adapter_error", error); }
  finally {
    if (timer) clearTimeout(timer);
    if (execution) { releaseExecution(execution); }
    extra.signal.removeEventListener("abort", cancel);
  }
};
