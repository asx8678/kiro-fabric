export type FabricRisk = "read" | "write" | "execute" | "network";

export interface FabricActionEffect {
  kind: "none" | "read" | "write" | "emission";
  resources?: readonly string[];
}

export interface FabricActionDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  risk: FabricRisk;
  namespace?: string;
  effect?: FabricActionEffect;
}

export interface FabricInvocationContext {
  cwd: string;
  signal?: AbortSignal;
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
}

export interface FabricProviderStatus {
  name: string;
  description: string;
  available: boolean;
  reason?: string;
}
