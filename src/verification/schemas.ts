import { Type, type TSchema } from "typebox";
import type { VerificationVerdict } from "./types.js";

const verdict = Type.Union([
  Type.Literal("verified"),
  Type.Literal("not_verified"),
  Type.Literal("inconclusive"),
]);

const fingerprintSchema = Type.Object({
  algorithm: Type.Literal("sha256"),
  digest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
});

const artifactSchema = Type.Object({
  id: Type.String(),
  role: Type.Union([
    Type.Literal("claim"),
    Type.Literal("baseline"),
    Type.Literal("treatment"),
    Type.Literal("comparison"),
    Type.Literal("command_output"),
    Type.Literal("test_report"),
    Type.Literal("certificate"),
    Type.Literal("diagnostic"),
  ]),
  uri: Type.Optional(Type.String()),
  mediaType: Type.Optional(Type.String()),
  sizeBytes: Type.Optional(Type.Number()),
  digest: fingerprintSchema,
  retained: Type.Union([
    Type.Literal("full"),
    Type.Literal("truncated"),
    Type.Literal("digest_only"),
  ]),
  omittedBytes: Type.Optional(Type.Number()),
  sensitive: Type.Optional(Type.Boolean()),
  description: Type.Optional(Type.String()),
});

const checkSchema = Type.Object({
  id: Type.String(),
  verdict,
  description: Type.Optional(Type.String()),
  expected: Type.Optional(Type.Unknown()),
  observed: Type.Optional(Type.Unknown()),
  artifactIds: Type.Array(Type.String()),
});

const claimSchema = Type.Object({
  id: Type.Optional(Type.String()),
  statement: Type.String(),
  condition: Type.Optional(Type.String()),
  metric: Type.Optional(Type.String()),
  threshold: Type.Optional(Type.Union([Type.String(), Type.Number()])),
});

export const verificationResultSchema: TSchema = Type.Object({
  protocolVersion: Type.Literal(2),
  verdict,
  claim: claimSchema,
  summary: Type.String(),
  checks: Type.Array(checkSchema),
  artifacts: Type.Array(artifactSchema),
  fingerprints: Type.Object({
    inputs: Type.Optional(fingerprintSchema),
    environment: Type.Optional(fingerprintSchema),
    evidence: fingerprintSchema,
    result: fingerprintSchema,
  }),
  startedAt: Type.Optional(Type.String()),
  finishedAt: Type.String(),
  adapter: Type.Optional(
    Type.Object({
      source: Type.Union([
        Type.Literal("state.verify"),
        Type.Literal("schema.verify"),
        Type.Literal("gate.outcome"),
        Type.Literal("certification"),
        Type.Literal("kiro.claims"),
        Type.Literal("benchmark"),
        Type.Literal("orchestrate-handoff"),
      ]),
      sourceVersion: Type.Optional(Type.String()),
    }),
  ),
});

export const verificationResultEnvelopeSchema: TSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("kiro-fabric.verification-result"),
  result: verificationResultSchema,
});

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const requireString = (v: unknown, path: string, errors: string[]): boolean => {
  if (typeof v !== "string") {
    errors.push(`${path} must be a string`);
    return false;
  }
  return true;
};

const isVerdict = (v: unknown): v is VerificationVerdict =>
  v === "verified" || v === "not_verified" || v === "inconclusive";

/**
 * Structural + cross-field validation of a VerificationResult. TypeBox is used
 * for authored JSON Schema; this cheap hand-rolled pass adds the invariant
 * checks (artifact id uniqueness, artifact reference resolution, truncated
 * retention requiring omittedBytes) without a heavy runtime.
 */
export const validateVerificationResult = (value: unknown): ValidationResult => {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["verification result must be an object"] };
  if (value.protocolVersion !== 2) errors.push("protocolVersion must be 2");
  if (!isVerdict(value.verdict)) errors.push("verdict must be verified|not_verified|inconclusive");
  if (!isRecord(value.claim)) errors.push("claim must be an object");
  else if (!requireString((value.claim as Record<string, unknown>).statement, "claim.statement", errors)) {
    /* already pushed */
  }
  if (typeof value.summary !== "string") errors.push("summary must be a string");
  if (typeof value.finishedAt !== "string") errors.push("finishedAt must be a string");

  const artifactIds = new Set<string>();
  const artifacts = Array.isArray(value.artifacts) ? (value.artifacts as unknown[]) : [];
  for (const [i, a] of artifacts.entries()) {
    if (!isRecord(a)) {
      errors.push(`artifacts[${i}] must be an object`);
      continue;
    }
    if (typeof a.id === "string") {
      if (artifactIds.has(a.id)) errors.push(`duplicate artifact id ${a.id}`);
      artifactIds.add(a.id);
    } else {
      errors.push(`artifacts[${i}].id must be a string`);
    }
    if (!isRecord(a.digest)) errors.push(`artifacts[${i}].digest must be an object`);
    if (a.retained === "truncated" && typeof a.omittedBytes !== "number") {
      errors.push(`artifacts[${i}] is truncated but omits omittedBytes`);
    }
    if (a.retained !== "truncated" && a.omittedBytes !== undefined && a.omittedBytes !== 0) {
      errors.push(`artifacts[${i}] declares omittedBytes but retained !== truncated`);
    }
  }

  const checks = Array.isArray(value.checks) ? (value.checks as unknown[]) : [];
  for (const [i, c] of checks.entries()) {
    if (!isRecord(c)) {
      errors.push(`checks[${i}] must be an object`);
      continue;
    }
    if (!isVerdict(c.verdict)) errors.push(`checks[${i}].verdict invalid`);
    const refs = Array.isArray(c.artifactIds) ? (c.artifactIds as unknown[]) : [];
    for (const ref of refs) {
      if (typeof ref !== "string" || !artifactIds.has(ref)) {
        errors.push(`checks[${i}].artifactIds references unknown artifact ${String(ref)}`);
      }
    }
  }

  const fp = isRecord(value.fingerprints) ? value.fingerprints : {};
  if (!isRecord(fp.evidence)) errors.push("fingerprints.evidence must be an object");
  if (!isRecord(fp.result)) errors.push("fingerprints.result must be an object");

  return { valid: errors.length === 0, errors };
};
