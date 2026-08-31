import { runAbortable, throwIfAborted } from "../../async-settlement.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
} from "../../protocol.js";
import type { KiroArtifactStore } from "../artifacts.js";

const READ_DESCRIPTOR: FabricActionDescriptor = {
  name: "read",
  description: "Read a bounded chunk of an opaque overflow artifact returned by fabric_exec.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", pattern: "^ka_[a-f0-9]{48}$" },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 16_000 },
    },
    required: ["id"],
    additionalProperties: false,
  },
  risk: "read",
  namespace: "ephemeral",
};

/** Power-safe access to process-local overflow artifacts without repository I/O. */
export class KiroPowerArtifactsProvider implements FabricProvider {
  readonly name = "artifacts";
  readonly description = "Process-local Kiro Power overflow artifacts";
  readonly #store: KiroArtifactStore;

  constructor(store: KiroArtifactStore) {
    this.#store = store;
  }

  async list(request: FabricProviderListRequest): Promise<FabricActionDescriptor[]> {
    const query = request.query?.toLowerCase();
    return !query || `${READ_DESCRIPTOR.name} ${READ_DESCRIPTOR.description}`.toLowerCase().includes(query)
      ? [READ_DESCRIPTOR]
      : [];
  }

  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    return actionName === "read" ? READ_DESCRIPTOR : undefined;
  }

  async invoke(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    if (actionName !== "read") throw new Error(`Unknown Kiro Power artifact action: artifacts.${actionName}`);
    throwIfAborted(context.signal);
    return runAbortable(context.signal, () => this.#store.read(
      args.id as string,
      args.offset as number | undefined,
      args.limit as number | undefined,
    ));
  }
}
