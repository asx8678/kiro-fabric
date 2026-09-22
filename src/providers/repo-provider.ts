import type { FabricProvider, FabricInvocationContext, FabricActionDescriptor } from "../protocol.js";
import { schemaValidationMessage } from "../schema-validation.js";
import type { FoveaBoundClient } from "../fovea/host.js";
import { REPO_ACTION_DESCRIPTORS, validImpactBase } from "./repo-contract.js";
/** This provider borrows a host binding. Closing it cannot close the persistent
 * analysis engine. Approval/validation/audit stay in the existing registry. */
export class FoveaProvider implements FabricProvider {
  readonly name = "repo";
  readonly description = "Native Fovea repository navigation (advisory, not source/read or correctness evidence)";
  readonly requirements = { verifiedWorkspace: true, settlement: true };
  #closed = false;
  constructor(readonly client: Pick<FoveaBoundClient, "rootId" | "observer" | "invoke" | "close">) {}
  discoveryRevision(): string { return "repo-v1"; }
  async list(): Promise<FabricActionDescriptor[]> { return structuredClone(REPO_ACTION_DESCRIPTORS); }
  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> { return structuredClone(REPO_ACTION_DESCRIPTORS.find(d => d.name === actionName)); }
  async invoke(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    if (this.#closed) throw new Error("Fovea binding released");
    const descriptor = REPO_ACTION_DESCRIPTORS.find(d => d.name === actionName);
    if (!descriptor) throw new Error("Unknown repo action");
    const invalid = schemaValidationMessage(descriptor.inputSchema, args);
    if (invalid) throw new Error(`Invalid repo arguments: ${invalid}`);
    if (actionName === "impact" && args.base !== undefined && !validImpactBase(args.base)) throw new Error("Invalid repo arguments: unsafe impact base revision");
    return this.client.invoke(actionName, args, context);
  }
  async close(): Promise<void> { if (this.#closed) return; this.#closed = true; await this.client.close(); }
}
