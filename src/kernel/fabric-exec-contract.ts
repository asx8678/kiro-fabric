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

export type FabricExecNormalizationDiagnostic = never;

export interface PreparedFabricExecArguments {
  value: unknown;
  diagnostics: readonly never[];
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
const FABRIC_EXEC_KEYS = new Set(["code", "payloads", "resultFormat", "timeoutMs"]);

/** Copy the canonical envelope without repairing or interpreting any field. */
export const prepareFabricExecArgumentsWithDiagnostics = (input: unknown): PreparedFabricExecArguments => {
  if (!isRecord(input)) return { value: input, diagnostics: [] };
  const keys = Object.keys(input);
  if (keys.length > FABRIC_EXEC_KEYS.size || keys.some((key) => !FABRIC_EXEC_KEYS.has(key))) {
    return { value: { invalidFabricExecEnvelope: true }, diagnostics: [] };
  }
  return { value: { ...input }, diagnostics: [] };
};

export const prepareFabricExecArguments = (input: unknown): unknown =>
  prepareFabricExecArgumentsWithDiagnostics(input).value;

export const fabricExecInputSchemaJson = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(fabricExecInputSchema)) as Record<string, unknown>;
