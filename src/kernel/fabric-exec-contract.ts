// Host-neutral `fabric_exec` public contract. This module is the single owner
// of the model-facing input schema and argument normalization shared by every
// host adapter (Pi tool registration today, Kiro MCP next). It must never
// import a host package (`@earendil-works/pi-*`); the lazy-graph assertion and
// the kernel import test enforce that mechanically.
//
// Compatibility rules (see docs/architecture.md "Tool-call robustness"):
// - Root and `display` objects are closed: misspelled flags fail before execution.
// - Only `code` is required; budgets are integers with a lower bound of 1 and
//   no declared maximum.
// - `resultFormat` is `anyOf` literals, not `enum`, because the emitted JSON
//   Schema shape is observable by hosts that serialize the schema verbatim.
// - Descriptions are model-facing contract data; changing them is a breaking
//   change for downstream prompt/caching behavior.

import { Type, type TSchema } from "typebox";
import type { FabricRunDisplay } from "../activity/types.js";
import { normalizeRunDisplay, type FabricRunDisplayLike } from "../run-display.js";

export const FABRIC_EXEC_RESULT_FORMATS = ["auto", "yaml", "json", "text"] as const;
export type FabricExecResultFormat = (typeof FABRIC_EXEC_RESULT_FORMATS)[number];

export interface FabricExecDisplay {
  name?: string;
  description?: string;
}

export interface FabricExecInput {
  code: string;
  strings?: Record<string, string>;
  resultFormat?: FabricExecResultFormat;
  tokenBudget?: number;
  agentBudget?: number;
  /** Object form or schema-supported objective shorthand. */
  display?: FabricExecDisplay | string;
}

const fabricExecDisplayObject = Type.Object({
  name: Type.Optional(
    Type.String({
      description:
        "Concise execution milestone used by the Fabric activity UI and deterministic compaction continuity",
    }),
  ),
  description: Type.Optional(
    Type.String({
      description:
        "Compact declared objective or acceptance criterion shown in the dashboard and richer compaction activity",
    }),
  ),
}, { additionalProperties: false });

const fabricExecDisplayString = Type.String({
  description:
    "Objective shorthand normalized to { name } (a JSON-object string is parsed). Prefer the object form when available.",
});

/**
 * The exact model-facing schema. Do not restructure: property order,
 * `anyOf`/`const` representation, descriptions, and closed-object policy are
 * all observable contract.
 */
export const fabricExecInputSchema = Type.Object({
  code: Type.String({
    description:
      "TypeScript function body. Top-level await and return are supported. Globals are capability-sensitive: managed Kiro provides `k`, `tools`, `print`, and `π`, plus `mcp`, `memory`, or `agents` only when enabled. Unavailable namespaces are omitted and fail closed; other host adapters may expose additional globals. See the host's `fabric-exec` skill for exact signatures.",
  }),
  strings: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description:
        "Named strings exposed as π.key, useful for content that is awkward to quote",
    }),
  ),
  resultFormat: Type.Optional(
    Type.Union(FABRIC_EXEC_RESULT_FORMATS.map((value) => Type.Literal(value))),
  ),
  tokenBudget: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Optional token budget for hosts that expose usage-accounted workflow agents; unmetered Kiro ACP children do not consume it",
    }),
  ),
  agentBudget: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Optional agent-call cap, bounded by host capabilities and Fabric configuration",
    }),
  ),
  display: Type.Optional(Type.Union([fabricExecDisplayObject, fabricExecDisplayString])),
}, { additionalProperties: false }) satisfies TSchema;

export const OPTIONAL_FABRIC_EXEC_KEYS = [
  "strings",
  "resultFormat",
  "tokenBudget",
  "agentBudget",
  "display",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Compatibility normalization applied by every host before schema validation:
 * root string → { code }, all-string code arrays joined, null/undefined
 * optional fields removed, display shorthand canonicalized. Required `code`
 * is preserved even when null/invalid so host validation reports the real
 * error instead of a transformed one.
 */
export const prepareFabricExecArguments = (input: unknown): unknown => {
  if (typeof input === "string") return { code: input };
  if (!isRecord(input)) return input;

  let prepared = input;
  const writable = (): Record<string, unknown> => {
    if (prepared === input) prepared = { ...input };
    return prepared;
  };

  if (Array.isArray(prepared.code) && prepared.code.every((line) => typeof line === "string")) {
    writable().code = prepared.code.join("\n");
  }

  for (const key of OPTIONAL_FABRIC_EXEC_KEYS) {
    if (!Object.hasOwn(prepared, key)) continue;
    if (prepared[key] === null || prepared[key] === undefined) delete writable()[key];
  }

  const display = prepared.display;
  if (typeof display === "string" || isRecord(display)) {
    const normalized: FabricRunDisplay | undefined = normalizeRunDisplay(
      display as FabricRunDisplayLike,
    );
    if (normalized) writable().display = normalized;
    else delete writable().display;
  }

  return prepared;
};

/** JSON-serializable view of the schema for host adapters and golden tests. */
export const fabricExecInputSchemaJson = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(fabricExecInputSchema)) as Record<string, unknown>;
