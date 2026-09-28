import { Value } from "typebox/value";
import type { FabricTracer } from "../trace/tracer.js";
import type { KiroRuntime } from "./runtime.js";
import type { KiroWorkspaceSnapshot } from "./power/workspace-context.js";
import { kiroPowerWorkspaceRequestSchema, type KiroPowerWorkspaceBinding, type KiroPowerWorkspaceRequest, type KiroPowerWorkspaceMutation } from "./power/workspace-binding.js";
import { bounded, isRecord, toolError } from "./mcp-response.js";

export interface WorkspaceTransitionContext {
  binding: KiroPowerWorkspaceBinding;
  tracer: FabricTracer;
  syncWorkspace(): Promise<KiroWorkspaceSnapshot>;
  snapshot(): KiroWorkspaceSnapshot | undefined;
  unavailableWorkspace(): boolean;
  currentRuntime(): KiroRuntime | undefined;
  getRuntime(): Promise<KiroRuntime>;
  lifecycle<T>(operation: () => Promise<T>): Promise<T>;
  assertAvailable(): void;
  closeRuntime(reason: Error): Promise<void>;
}

export interface WorkspaceTransitionOutcome {
  action: KiroPowerWorkspaceMutation["action"];
  status: "committed" | "not-committed" | "failed" | "cancelled" | "uncertain";
  committed: boolean | null;
  nextExecutionRequired: true;
  workspaceStatus?: "bound" | "unbound";
  rootId?: string;
  error?: string;
}

export const WORKSPACE_TRANSITION_RESERVE_CHARS = 512;
export const workspaceTransitionText = (outcome: WorkspaceTransitionOutcome): string => {
  const encode = (): string => `\n\nWorkspace transition: ${JSON.stringify(outcome)}`;
  let text = encode();
  // Bound the escaped envelope, not raw UTF-16 text: lone surrogates expand 6x.
  while (text.length > WORKSPACE_TRANSITION_RESERVE_CHARS && outcome.error) {
    outcome.error = outcome.error.slice(0, -1);
    text = encode();
  }
  if (text.length > WORKSPACE_TRANSITION_RESERVE_CHARS) {
    delete outcome.rootId;
    delete outcome.error;
    text = encode(); // Required enum/boolean fields alone are well below the bound.
  }
  return text;
};

export const workspaceRequest = (value: unknown): KiroPowerWorkspaceRequest => {
  if (Value.Check(kiroPowerWorkspaceRequestSchema, value)) return value as KiroPowerWorkspaceRequest;
  const issues = [...Value.Errors(kiroPowerWorkspaceRequestSchema, value)].map((entry) => entry.message);
  throw Object.assign(new Error("Invalid fabric_workspace arguments"), { issues });
};

export const callWorkspace = async (context: WorkspaceTransitionContext, args: unknown, signal: AbortSignal) => {
  const { binding, tracer, syncWorkspace, snapshot, unavailableWorkspace, currentRuntime, getRuntime, lifecycle, assertAvailable, closeRuntime } = context;
  let action: KiroPowerWorkspaceMutation["action"] | undefined;
  let commitEntered = false;
  let outcome: WorkspaceTransitionOutcome | undefined;
  try {
    await syncWorkspace();
    const parsed = workspaceRequest(args);
    if (tracer.enabled) {
      tracer.event("eval", "tool.fabric_workspace", undefined, { action: parsed.action });
      tracer.flush();
    }
    if (parsed.action === "status") return { content: [{ type: "text" as const, text: JSON.stringify({
      ...binding.status(),
      context: snapshot()?.status ?? "temporarily-unavailable",
      verification: binding.workspaceObservation().status,
    }) }] };
    if (parsed.action === "list") return { content: [{ type: "text" as const, text: JSON.stringify({
      ...binding.list(parsed),
      context: snapshot()?.status ?? "temporarily-unavailable",
    }) }] };
    action = parsed.action;
    if (parsed.action === "select" && unavailableWorkspace()) throw new Error("workspace roots are temporarily unverifiable");
    // This direct tool path has no Fabric execution to charge, so it honors
    // the configured prompt budget itself: a zero budget must not open an
    // interactive attachment dialog. A host that injects no executor budget
    // keeps the previous behavior.
    const chargeApproval = async (prompt: () => Promise<void>): Promise<void> => {
      const budget = (currentRuntime() ?? await getRuntime()).service.config.executor.maxApprovalRequests;
      if (typeof budget === "number" && budget < 1) {
        throw new Error("Manual workspace attachment is blocked: executor.maxApprovalRequests is 0");
      }
      await prompt();
    };
    const mutation = await binding.prepareMutation(parsed, signal, chargeApproval);
    const result = await lifecycle(async () => {
      assertAvailable();
      signal.throwIfAborted();
      // Revoke and drain the old runtime BEFORE the replacement binding is
      // published, mirroring the deferred bootstrap transition. A select of
      // the already-bound root and a detach from an unbound state provably
      // keep the identity, so they need no revocation; every other path
      // revokes first, or guest authority could outlive a changed binding.
      const current = binding.status();
      const identityProvablyUnchanged = mutation.action === "select"
        ? current.status === "bound" && current.rootId === mutation.rootId
        : mutation.action === "detach" && current.status === "unbound";
      if (!identityProvablyUnchanged) {
        // A failed pre-commit cleanup throws here: the binding stays
        // uncommitted and the caller reports committed:false.
        await closeRuntime(new Error("workspace binding changed"));
        assertAvailable();
        signal.throwIfAborted();
      }
      commitEntered = true;
      const committed = binding.commitMutation(mutation);
      outcome = { action: mutation.action, status: "committed", committed: true, nextExecutionRequired: true,
        workspaceStatus: committed.status, ...(committed.status === "bound" ? { rootId: committed.rootId } : {}) };
      return committed;
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }],
      ...(outcome ? { structuredContent: { workspaceTransition: outcome, retryProgram: false } } : {}) };
  } catch (error) {
    const issues = isRecord(error) && Array.isArray(error.issues) ? error.issues : undefined;
    if (action) outcome = { ...(outcome ?? { action, status: commitEntered ? "uncertain" : signal.aborted ? "cancelled" : "failed", committed: commitEntered ? null : false, nextExecutionRequired: true }),
      error: bounded(error, "Workspace request failed", 60) };
    return { ...toolError("workspace_request_failed", error, issues),
      ...(outcome ? { structuredContent: { workspaceTransition: outcome, retryProgram: false } } : {}) };
  }
};

/** The guest lease must be settled before entering this transition. */
export const commitDeferredWorkspace = async (
  context: WorkspaceTransitionContext, mutation: KiroPowerWorkspaceMutation,
  pinnedIdentity: string, signal: AbortSignal,
): Promise<WorkspaceTransitionOutcome> => {
  const { binding, lifecycle, assertAvailable, closeRuntime } = context;
  let commitEntered = false;
  try {
    const transition = await lifecycle(async () => {
      assertAvailable();
      signal.throwIfAborted();
      if (binding.bindingIdentity() !== pinnedIdentity) throw new Error("Workspace changed before deferred transition; list roots again");
      await closeRuntime(new Error("workspace binding changed"));
      signal.throwIfAborted();
      commitEntered = true;
      return binding.commitMutation(mutation);
    });
    return { action: mutation.action, status: "committed", committed: true, nextExecutionRequired: true,
      workspaceStatus: transition.status, ...(transition.status === "bound" ? { rootId: transition.rootId } : {}) };
  } catch (error) {
    // A commit-call exception is not proof of rollback. Preserve the guest's
    // actual result separately; never invite replay of its earlier effects.
    return { action: mutation.action, status: commitEntered ? "uncertain" : signal.aborted ? "cancelled" : "failed",
      committed: commitEntered ? null : false, nextExecutionRequired: true, error: bounded(error, "Workspace transition failed", 120) };
  }
};
