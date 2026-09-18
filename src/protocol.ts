import type { FabricDeadline } from "./runtime/deadline.js";

/** Internal, non-serializable proof that a trusted provider observed publication. */
export const FABRIC_COMMIT_ACKNOWLEDGEMENT = Symbol("fabric.commitAcknowledgement");
export interface FabricCommitAcknowledgement {
  readonly version: 1;
  readonly operation: "set" | "delete" | "write" | "edit";
}
interface FabricCommittedError extends Error {
  readonly [FABRIC_COMMIT_ACKNOWLEDGEMENT]: FabricCommitAcknowledgement;
}
export const fabricCommitAcknowledgement = (error: unknown): FabricCommitAcknowledgement | undefined => {
  if (!(error instanceof Error)) return undefined;
  const marker = (error as Partial<FabricCommittedError>)[FABRIC_COMMIT_ACKNOWLEDGEMENT];
  return marker?.version === 1 && ["set", "delete", "write", "edit"].includes(marker.operation)
    ? marker
    : undefined;
};

export type FabricRisk = "read" | "write" | "execute" | "network";

export interface FabricActionEffect {
  kind: "none" | "read" | "write" | "emission";
  resources?: readonly string[];
}

/** Bounded standard MCP ToolAnnotations. Hints never grant Fabric approval. */
export interface FabricToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface FabricActionDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  risk: FabricRisk;
  namespace?: string;
  effect?: FabricActionEffect;
  annotations?: FabricToolAnnotations;
}

export interface FabricCheckpointHandle { id: string; label?: string }
export interface FabricFailureMetadata {
  code: "invalid_arguments" | "stale_descriptor" | "timeout" | "provider_error" | "catalog_requires_paging" | "catalog_cursor_unavailable" | "catalog_quota_exceeded" | "catalog_page_budget" | "quota_exceeded" | "approval_denied";
  catalogContinuation?: { method: import("./core/catalog-contract.js").CatalogMethod; cursor: string };
  phase: "compile" | "validation" | "discovery" | "dispatch" | "execution";
  dispatchState: "not_dispatched" | "dispatched";
  effectOutcome: "none" | "uncertain";
  ref?: string;
  descriptorDigest?: string;
  invalidPath?: string;
  relevantSchema?: Record<string, unknown>;
  replacementDescriptor?: Record<string, unknown>;
  checkpoints?: FabricCheckpointHandle[];
}

export interface FabricInvocationContext {
  cwd: string;
  maxResultChars?: number;
  checkpoints?: { reserve(): (handle: FabricCheckpointHandle) => void };
  /** Host-only closed admission prefix for this call; never supplied by guest arguments. */
  continuityCapture?: () => import("./continuity/execution.js").ContinuityCapture;
  signal?: AbortSignal;
  /** Host-only absolute monotonic deadline. Providers must check it at commit boundaries. */
  deadline?: FabricDeadline;
  approve?(action: ResolvedFabricAction, args: Record<string, unknown>): Promise<void>;
  /** Charge a provider-owned interactive prompt against this execution's
   * approval budget. The prompt content stays provider-owned. */
  chargeApproval?(prompt: () => Promise<void>): Promise<void>;
  /** Per-execution Kiro bootstrap capability; never serialized into the guest. */
  bootstrap?: {
    info(): Promise<unknown>;
    workspace(
      args: Record<string, unknown>,
      signal?: AbortSignal,
      chargeApproval?: (prompt: () => Promise<void>) => Promise<void>,
    ): Promise<unknown>;
  };
}

export interface FabricProvider {
  name: string;
  description: string;
  /** Synchronous, local and side-effect-free; undefined opts out of discovery caching. */
  discoveryRevision?(): string | undefined;
  /** Local authority tickets: selected-server reservations or observed inventory epochs. */
  catalogDependencies?(args?: Record<string, unknown>): readonly import("./core/catalog-contract.js").CatalogDependency[];
  /** Locally observed approved metadata; never an execution authority. */
  observedActions?(): readonly ObservedFabricAction[];
  /** Synchronous revocation after denied/failed approved discovery. */
  invalidateDiscovery?(server?: string): void;
  list(): Promise<FabricActionDescriptor[]>;
  describe(actionName: string): Promise<FabricActionDescriptor | undefined>;
  prepareArguments?(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Optional cross-process effect reservation, held through approval and cleanup. */
  reserveInvocation?(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<() => void | Promise<void>>;
  effectResources?(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): readonly string[];
  invoke(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown>;
  close?(): Promise<void>;
}

export interface ResolvedFabricAction extends FabricActionDescriptor {
  /** Present for approved remote observations, never freshness authority. */
  freshness?: "observed";
  ref: string;
  provider: string;
  /** Stable digest of the provider/ref and complete public descriptor semantics. */
  descriptorDigest: string;
}

export interface ObservedFabricAction {
  readonly ref: string;
  descriptor(): ResolvedFabricAction;
}

export interface McpToolDescriptor {
  server: string; name: string; ref: string; description: string;
  inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>;
  annotations?: FabricToolAnnotations;
  transport: { kind: "stdio" | "http"; digest: string; configDigest: string | null };
  descriptorDigest: string; freshness: "observed";
}

export interface FabricProviderStatus {
  name: string;
  description: string;
  available: boolean;
  reason?: string;
}
