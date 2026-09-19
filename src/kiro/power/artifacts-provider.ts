import { largestFittingInteger } from "../../bounded-search.js";
import { throwIfAbortedOrExpired } from "../../async-settlement.js";
import type { FabricActionDescriptor, FabricInvocationContext, FabricProvider } from "../../protocol.js";
import { fabricJsonText } from "../../runtime/json-budget.js";
import { createKiroArtifactStore, type KiroArtifactReadResult, type KiroArtifactStore, type KiroArtifactStoreOptions } from "../artifacts.js";

const idSchema = { type: "string", minLength: 51, maxLength: 51 };
const KIRO_ARTIFACT_READ_OUTPUT_SCHEMA = {
  type: "object", properties: { id: { ...idSchema }, text: { type: "string" }, offset: { type: "integer", minimum: 0 }, nextOffset: { type: "integer", minimum: 0 }, totalChars: { type: "integer", minimum: 0 }, done: { type: "boolean" } },
  required: ["id", "text", "offset", "nextOffset", "totalChars", "done"], additionalProperties: false,
};
export interface KiroArtifactCheckpointResult {
  id: string;
  retrieval: { ref: "artifacts.read"; args: { id: string }; encoding: "json"; ephemeral: true };
}
/** Compatibility name for the shared host-only invocation context. */
export type KiroArtifactInvocationContext = FabricInvocationContext;
const descriptor: FabricActionDescriptor = {
  name: "read", description: "Read a bounded UTF-16-offset chunk of an opaque ephemeral artifact; advance using nextOffset",
  inputSchema: { type: "object", properties: { id: { ...idSchema }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 16000 } }, required: ["id"], additionalProperties: false },
  outputSchema: KIRO_ARTIFACT_READ_OUTPUT_SCHEMA,
  risk: "read", namespace: "workspace", effect: { kind: "read" },
};
const checkpointDescriptor: FabricActionDescriptor = {
  name: "checkpoint", description: "Explicitly emit chosen intermediate JSON evidence to a bounded ephemeral artifact, not durable memory. Requires write approval. Labels are optional and bounded.",
  inputSchema: { type: "object", properties: { value: {}, label: { type: "string", maxLength: 80 } }, required: ["value"], additionalProperties: false },
  outputSchema: { type: "object", properties: { id: { ...idSchema }, retrieval: { type: "object", properties: { ref: { const: "artifacts.read" }, args: { type: "object", properties: { id: { ...idSchema } }, required: ["id"], additionalProperties: false }, encoding: { const: "json" }, ephemeral: { const: true } }, required: ["ref", "args", "encoding", "ephemeral"], additionalProperties: false } }, required: ["id", "retrieval"], additionalProperties: false },
  risk: "write", namespace: "workspace", effect: { kind: "emission" },
};

/** Size the actual escaped JSON envelope, not the raw text. No empty non-final pages. */
const boundKiroArtifactRead = (page: KiroArtifactReadResult, maximum: number): KiroArtifactReadResult => {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("invalid artifact response budget");
  const candidate = (length: number): KiroArtifactReadResult => {
    if (length > 0 && length < page.text.length && /[\uD800-\uDBFF]/u.test(page.text.charAt(length - 1)) && /[\uDC00-\uDFFF]/u.test(page.text.charAt(length))) length--;
    const text = page.text.slice(0, length);
    const nextOffset = page.offset + text.length;
    return { ...page, text, nextOffset, done: nextOffset >= page.totalChars };
  };
  const low = largestFittingInteger(0, page.text.length, length => JSON.stringify(candidate(length)).length <= maximum);
  const result = candidate(low);
  if (JSON.stringify(result).length > maximum || (!result.done && !result.text.length)) throw new Error("artifact response budget cannot fit metadata and one Unicode character");
  return result;
};

export class KiroPowerArtifactsProvider implements FabricProvider {
  readonly name = "artifacts";
  readonly description = "Bounded private Fabric artifacts";
  readonly #checkpoints: KiroArtifactStore;
  constructor(readonly store: KiroArtifactStore, options: Omit<KiroArtifactStoreOptions, "root"> = {}) {
    this.#checkpoints = createKiroArtifactStore({ ...(options.now ? { now: options.now } : {}), maxArtifacts: Math.min(options.maxArtifacts ?? 16, 16), maxArtifactChars: Math.min(options.maxArtifactChars ?? 100_000, 100_000), maxTotalChars: Math.min(options.maxTotalChars ?? 400_000, 400_000), ttlMs: Math.min(options.ttlMs ?? 900_000, 900_000) });
  }
  discoveryRevision(): string { return "1"; }
  async list(): Promise<FabricActionDescriptor[]> { return structuredClone([descriptor, checkpointDescriptor]); }
  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> { return (await this.list()).find(action => action.name === actionName); }
  async invoke(actionName: string, args: Record<string, unknown>, context: KiroArtifactInvocationContext): Promise<KiroArtifactReadResult | KiroArtifactCheckpointResult> {
    throwIfAbortedOrExpired(context.signal, context.deadline);
    const maximum = context.maxResultChars ?? 2_000_000;
    if (actionName === "checkpoint") {
      if (!("value" in args) || (args.label !== undefined && (typeof args.label !== "string" || args.label.length > 80 || /[\u0000-\u001f\u007f]/u.test(args.label)))) throw new Error("invalid checkpoint arguments");
      const content = fabricJsonText({ ...(args.label === undefined ? {} : { label: args.label }), value: args.value }, 100_000);
      const response = (id: string): KiroArtifactCheckpointResult => ({ id, retrieval: { ref: "artifacts.read", args: { id }, encoding: "json", ephemeral: true } });
      // Fail before emission if even the handle acknowledgement cannot fit.
      fabricJsonText(response(`ka_${"0".repeat(48)}`), maximum);
      const record = context.checkpoints?.reserve();
      const id = this.#checkpoints.write(content);
      record?.({ id, ...(typeof args.label === "string" ? { label: args.label } : {}) });
      return response(id);
    }
    if (actionName !== "read") throw new Error(`Unknown artifacts action: ${actionName}`);
    let page: KiroArtifactReadResult;
    try { page = this.#checkpoints.read(args.id as string, args.offset as number | undefined, args.limit as number | undefined); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes("unavailable or expired")) throw error;
      page = this.store.read(args.id as string, args.offset as number | undefined, args.limit as number | undefined);
    }
    return boundKiroArtifactRead(page, maximum);
  }
  async close(): Promise<void> { this.#checkpoints.close(); }
}
