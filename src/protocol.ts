import type { FabricDeadline } from "./runtime/deadline.js";

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

export interface FabricInvocationContext {
  cwd: string;
  signal?: AbortSignal;
  /** Host-only absolute monotonic deadline. Providers must check it at commit boundaries. */
  deadline?: FabricDeadline;
  approve?(action: ResolvedFabricAction, args: Record<string, unknown>): Promise<void>;
}

export interface FabricProvider {
  name: string;
  description: string;
  list(): Promise<FabricActionDescriptor[]>;
  describe(actionName: string): Promise<FabricActionDescriptor | undefined>;
  prepareArguments?(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  effectResources?(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): readonly string[];
  invoke(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown>;
  close?(): Promise<void>;
}

export interface ResolvedFabricAction extends FabricActionDescriptor {
  ref: string;
  provider: string;
  /** Stable digest of the provider/ref and complete public descriptor semantics. */
  descriptorDigest: string;
}

export interface FabricProviderStatus {
  name: string;
  description: string;
  available: boolean;
  reason?: string;
}
