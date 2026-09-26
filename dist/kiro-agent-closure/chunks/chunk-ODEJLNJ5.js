import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);


// src/core/repair-error.ts
var FabricRepairError = class extends Error {
  failure;
  constructor(message, failure) {
    super(message);
    this.name = "FabricRepairError";
    this.failure = structuredClone(failure);
  }
};
var FabricCompilerTimeoutError = class extends FabricRepairError {
  constructor(timeoutMs) {
    super(`Fabric compiler timed out after ${timeoutMs}ms`, { code: "timeout", phase: "compile", dispatchState: "not_dispatched", effectOutcome: "none" });
    this.name = "FabricCompilerTimeoutError";
  }
};
var fabricFailureMetadata = (error) => error instanceof FabricRepairError ? structuredClone(error.failure) : void 0;
var repairSchema = (schema) => {
  let nodes = 0;
  let chars = 0;
  const walk = (value, depth, propertyMap = false) => {
    if (++nodes > 128 || depth > 8) return void 0;
    if (typeof value === "string") {
      chars += value.length;
      return value.length <= 256 && chars <= 4096 ? value : void 0;
    }
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
    if (Array.isArray(value)) return value.slice(0, 16).map((v) => walk(v, depth + 1)).filter((v) => v !== void 0);
    if (!value || typeof value !== "object") return void 0;
    const out = /* @__PURE__ */ Object.create(null);
    for (const [key, child] of Object.entries(value).slice(0, 64)) {
      if (key.length > 128 || !propertyMap && !["type", "properties", "required", "items", "additionalProperties", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"].includes(key)) continue;
      chars += key.length;
      if (chars > 4096) break;
      const projected = walk(child, depth + 1, !propertyMap && key === "properties");
      if (projected !== void 0) out[key] = projected;
    }
    return out;
  };
  return walk(schema, 0) ?? {};
};
var argumentRepairError = (ref, descriptorDigest, schema, invalid) => new FabricRepairError(`Invalid arguments for ${ref}: ${invalid}`, {
  code: "invalid_arguments",
  phase: "validation",
  dispatchState: "not_dispatched",
  effectOutcome: "none",
  ref,
  descriptorDigest,
  invalidPath: (invalid.startsWith("/") ? invalid.split(": ")[0] : "/").slice(0, 512),
  relevantSchema: repairSchema(schema)
});
var createCheckpointJournal = () => {
  const handles = [];
  let reservations = 0;
  return {
    reserve() {
      if (reservations >= 8) throw new FabricRepairError("Fabric checkpoint quota exceeded", { code: "quota_exceeded", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none" });
      reservations += 1;
      let recorded = false;
      return (handle) => {
        if (recorded) return;
        recorded = true;
        if (typeof handle.id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(handle.id)) return;
        if (handle.label !== void 0 && (typeof handle.label !== "string" || handle.label.length > 128)) return;
        handles.push({ id: handle.id, ...handle.label !== void 0 ? { label: handle.label } : {} });
      };
    },
    snapshot: () => structuredClone(handles)
  };
};

export {
  FabricRepairError,
  FabricCompilerTimeoutError,
  fabricFailureMetadata,
  repairSchema,
  argumentRepairError,
  createCheckpointJournal
};
