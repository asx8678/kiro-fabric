import type { FabricFailureMetadata, FabricCheckpointHandle } from "../protocol.js";

/** Only explicitly constructed host failures cross the sandbox boundary. */
export class FabricRepairError extends Error {
  readonly failure: FabricFailureMetadata;
  constructor(message: string, failure: FabricFailureMetadata) {
    super(message);
    this.name = "FabricRepairError";
    this.failure = structuredClone(failure);
  }
}
export class FabricCompilerTimeoutError extends FabricRepairError {
  constructor(timeoutMs: number) {
    super(`Fabric compiler timed out after ${timeoutMs}ms`, { code: "timeout", phase: "compile", dispatchState: "not_dispatched", effectOutcome: "none" });
    this.name = "FabricCompilerTimeoutError";
  }
}
export const fabricFailureMetadata = (error: unknown): FabricFailureMetadata | undefined =>
  error instanceof FabricRepairError ? structuredClone(error.failure) : undefined;

/** Structural schema hints only: no defaults, examples, descriptions or instance values. */
export const repairSchema = (schema: unknown): Record<string, unknown> => {
  let nodes = 0;
  let chars = 0;
  const walk = (value: unknown, depth: number, propertyMap = false): unknown => {
    if (++nodes > 128 || depth > 8) return undefined;
    if (typeof value === "string") { chars += value.length; return value.length <= 256 && chars <= 4096 ? value : undefined; }
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value)) return value.slice(0, 16).map(v => walk(v, depth + 1)).filter(v => v !== undefined);
    if (!value || typeof value !== "object") return undefined;
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(value).slice(0, 64)) {
      if (key.length > 128 || (!propertyMap && !["type", "properties", "required", "items", "additionalProperties", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"].includes(key))) continue;
      chars += key.length;
      if (chars > 4096) break;
      const projected = walk(child, depth + 1, !propertyMap && key === "properties");
      if (projected !== undefined) out[key] = projected;
    }
    return out;
  };
  return (walk(schema, 0) ?? {}) as Record<string, unknown>;
};
export const argumentRepairError = (ref: string, descriptorDigest: string, schema: unknown, invalid: string): FabricRepairError =>
  new FabricRepairError(`Invalid arguments for ${ref}: ${invalid}`, {
    code: "invalid_arguments", phase: "validation", dispatchState: "not_dispatched", effectOutcome: "none",
    ref, descriptorDigest,
    invalidPath: (invalid.startsWith("/") ? invalid.split(": ")[0]! : "/").slice(0, 512),
    relevantSchema: repairSchema(schema),
  });

/** Per-execution explicit checkpoint journal. Never accepts artifact payloads. */
export const createCheckpointJournal = (): { reserve(): (handle: FabricCheckpointHandle) => void; snapshot(): FabricCheckpointHandle[] } => {
  const handles: FabricCheckpointHandle[] = [];
  let reservations = 0;
  return {
    reserve() {
      if (reservations >= 8) throw new Error("Fabric checkpoint quota exceeded");
      reservations += 1;
      let recorded = false;
      return (handle) => {
        if (recorded) return;
        recorded = true;
        if (typeof handle.id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(handle.id)) return;
        if (handle.label !== undefined && (typeof handle.label !== "string" || handle.label.length > 128)) return;
        handles.push({ id: handle.id, ...(handle.label !== undefined ? { label: handle.label } : {}) });
      };
    },
    snapshot: () => structuredClone(handles),
  };
};
