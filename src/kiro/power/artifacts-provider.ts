import { throwIfAborted } from "../../async-settlement.js";
import type { FabricActionDescriptor, FabricInvocationContext, FabricProvider } from "../../protocol.js";
import type { KiroArtifactStore } from "../artifacts.js";

const descriptor: FabricActionDescriptor = {
  name: "read",
  description: "Read a bounded chunk of an opaque overflow artifact",
  inputSchema: { type: "object", properties: { id: { type: "string", minLength: 51, maxLength: 51 }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 16000 } }, required: ["id"], additionalProperties: false },
  risk: "read",
  namespace: "workspace",
  effect: { kind: "read" },
};

export class KiroPowerArtifactsProvider implements FabricProvider {
  readonly name = "artifacts";
  readonly description = "Bounded private Power artifacts";
  constructor(readonly store: KiroArtifactStore) {}
  async list(): Promise<FabricActionDescriptor[]> { return [descriptor]; }
  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> { return actionName === "read" ? descriptor : undefined; }
  async invoke(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    if (actionName !== "read") throw new Error(`Unknown artifacts action: ${actionName}`);
    throwIfAborted(context.signal);
    return this.store.read(args.id as string, args.offset as number | undefined, args.limit as number | undefined);
  }
}
