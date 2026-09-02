import { Type, type TSchema } from "typebox";
import { MAX_EXECUTOR_SOURCE_BYTES } from "../runtime/source-limit.js";

export const FABRIC_EXEC_RESULT_FORMATS = ["auto", "json", "text"] as const;
export type FabricExecResultFormat = (typeof FABRIC_EXEC_RESULT_FORMATS)[number];

export interface FabricExecInput {
  code: string;
  payloads?: Record<string, string>;
  resultFormat?: FabricExecResultFormat;
  timeoutMs?: number;
}

export interface FabricExecNormalizationDiagnostic {
  field: "payloads";
  repair: "json-string-map" | "double-encoded-json-string-map";
}

export interface PreparedFabricExecArguments {
  value: unknown;
  diagnostics: FabricExecNormalizationDiagnostic[];
}

export const fabricExecInputSchema = Type.Object({
  code: Type.String({
    minLength: 1,
    maxLength: MAX_EXECUTOR_SOURCE_BYTES,
    description: "Checked TypeScript function body. Top-level await and return are supported.",
  }),
  payloads: Type.Optional(Type.Record(
    Type.String({ minLength: 1, maxLength: 1_024 }),
    Type.String({ maxLength: MAX_EXECUTOR_SOURCE_BYTES }),
    {
      maxProperties: 128,
      description: "Named immutable string payloads exposed to guest code as payloads.key.",
    },
  )),
  resultFormat: Type.Optional(Type.Union(FABRIC_EXEC_RESULT_FORMATS.map((value) => Type.Literal(value)))),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 900_000, description: "Requested guest deadline, capped by Power policy." })),
}, { additionalProperties: false }) satisfies TSchema;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringMap = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) return false;
  let entries = 0;
  let characters = 0;
  for (const key of Object.keys(value)) {
    const entry = value[key];
    entries += 1;
    if (
      entries > 128 || key.length < 1 || key.length > 1_024 ||
      typeof entry !== "string"
    ) return false;
    characters += key.length + entry.length;
    if (characters > MAX_EXECUTOR_SOURCE_BYTES) return false;
  }
  return true;
};

const MAX_ENCODED_PAYLOAD_CHARS = 8_000_000;
const FABRIC_EXEC_KEYS = new Set(["code", "payloads", "resultFormat", "timeoutMs"]);
const repairPayloads = (value: string): { value: Record<string, string>; repair: FabricExecNormalizationDiagnostic["repair"] } | undefined => {
  if (value.length > MAX_ENCODED_PAYLOAD_CHARS) return undefined;
  try {
    const once = JSON.parse(value) as unknown;
    if (stringMap(once)) return { value: once, repair: "json-string-map" };
    if (typeof once === "string") {
      const twice = JSON.parse(once) as unknown;
      if (stringMap(twice)) return { value: twice, repair: "double-encoded-json-string-map" };
    }
  } catch { /* invalid input remains invalid and schema validation reports it */ }
  return undefined;
};

/** Normalize only the Kiro-observed encoded-map failure before schema validation. */
export const prepareFabricExecArgumentsWithDiagnostics = (input: unknown): PreparedFabricExecArguments => {
  if (!isRecord(input)) return { value: input, diagnostics: [] };
  const keys = Object.keys(input);
  if (keys.length > FABRIC_EXEC_KEYS.size || keys.some((key) => !FABRIC_EXEC_KEYS.has(key))) {
    return { value: { invalidFabricExecEnvelope: true }, diagnostics: [] };
  }
  const value = { ...input };
  const diagnostics: FabricExecNormalizationDiagnostic[] = [];
  if (typeof value.payloads === "string") {
    const repaired = repairPayloads(value.payloads);
    if (repaired) {
      diagnostics.push({ field: "payloads", repair: repaired.repair });
      value.payloads = repaired.value;
    }
  }
  return { value, diagnostics };
};

export const prepareFabricExecArguments = (input: unknown): unknown =>
  prepareFabricExecArgumentsWithDiagnostics(input).value;

export const fabricExecInputSchemaJson = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(fabricExecInputSchema)) as Record<string, unknown>;
