import { createHash } from "node:crypto";

/** Pure, fixed-shape provenance. No filesystem, Git, environment or clock access. */
export const RUN_PROVENANCE_LIMITS = Object.freeze({ contentBytes: 1_048_576, entries: 32, totalBytes: 4_194_304, declarationJsonChars: 65_536 });
export type RunProvenanceBytes = string | Uint8Array;
export interface RunProvenanceContentInput { label?: unknown; content?: unknown }
export interface RunProvenanceRepositoryInput { commit?: unknown; dirty?: unknown; dirtyEvidence?: unknown }
export interface RunProvenanceConfiguredInput {
  guidanceMode?: unknown;
  profile?: unknown;
  requestedModel?: unknown;
  requestedEffort?: unknown;
  runtimeBundle?: unknown;
  prompt?: unknown;
  resources?: readonly RunProvenanceContentInput[];
  hooks?: readonly RunProvenanceContentInput[];
  repository?: RunProvenanceRepositoryInput;
}
/** Only the server/controller may supply this channel; never spread launch JSON here.
 * Outputs must be actual returned content, not tool arguments, reference copies or loaded flags.
 * Matching bytes establish delivery only, not invocation provenance or comprehension. */
export interface RunProvenanceObservedInput {
  runtimeBundle?: unknown;
  runtimeVersion?: unknown;
  prompt?: unknown;
  resources?: readonly RunProvenanceContentInput[];
  hooks?: readonly RunProvenanceContentInput[];
  repository?: RunProvenanceRepositoryInput;
  guidanceOutputs?: readonly { reference?: unknown; output?: unknown }[];
}
export interface RunProvenanceInput {
  configured?: RunProvenanceConfiguredInput;
  observed?: RunProvenanceObservedInput;
}
type Digest = { status: "known"; sha256: string; bytes: number } | { status: "unknown"; reason: "not-supplied" | "invalid" | "limit" };
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

/** Parse only explicitly supplied launch metadata. Observed claims/extra keys are discarded
 * by buildRunProvenance. Invalid/oversized JSON leaves declarations unknown. */
export function parseRunProvenanceDeclaration(json: unknown): RunProvenanceConfiguredInput | undefined {
  if (typeof json !== "string" || json.length > RUN_PROVENANCE_LIMITS.declarationJsonChars) return undefined;
  try {
    const value: unknown = JSON.parse(json);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const r = record(value);
    return { guidanceMode: r.guidanceMode, profile: r.profile, requestedModel: r.requestedModel,
      requestedEffort: r.requestedEffort, runtimeBundle: r.runtimeBundle, prompt: r.prompt,
      ...(Array.isArray(r.resources) ? { resources: r.resources } : {}),
      ...(Array.isArray(r.hooks) ? { hooks: r.hooks } : {}),
      ...(r.repository ? { repository: record(r.repository) } : {}) };
  } catch { return undefined; }
}

/** Content hashes are SHA-256 over exact UTF-8/string or byte input, never prefixes.
 * Opaque labels are hashed too: even syntactically safe labels may contain secrets.
 * A bundle field hashes supplied identity bytes; it does NOT verify a bundle tree. */
export function buildRunProvenance(input: RunProvenanceInput = {}) {
  let remaining = RUN_PROVENANCE_LIMITS.totalBytes;
  const digest = (value: unknown): Digest => {
    if (value === undefined || value === null) return { status: "unknown", reason: "not-supplied" };
    if (typeof value !== "string" && !(value instanceof Uint8Array)) return { status: "unknown", reason: "invalid" };
    if (value.length > RUN_PROVENANCE_LIMITS.contentBytes) return { status: "unknown", reason: "limit" };
    const bytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
    if (bytes > RUN_PROVENANCE_LIMITS.contentBytes || bytes > remaining) return { status: "unknown", reason: "limit" };
    remaining -= bytes;
    return { status: "known", sha256: hash(value), bytes };
  };
  const collection = (value: unknown) => {
    if (!Array.isArray(value)) return { status: "unknown" as const, count: null, sha256: null };
    if (value.length > RUN_PROVENANCE_LIMITS.entries) return { status: "limit" as const, count: value.length, sha256: null };
    const entries = Array.from(value, item => { const r = record(item); return { label: digest(r.label), content: digest(r.content) }; });
    // Order is intentional: resource/hook ordering can change effective guidance.
    const complete = entries.every(entry => entry.content.status === "known" &&
      (entry.label.status === "known" || entry.label.reason === "not-supplied"));
    return { status: complete ? "known" as const : "unknown" as const, count: value.length,
      sha256: complete ? hash(JSON.stringify(entries)) : null };
  };
  const repository = (value: unknown) => {
    const r = record(value);
    const commit = typeof r.commit === "string" && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u.test(r.commit) ? r.commit.toLowerCase() : null;
    return { commit, dirty: typeof r.dirty === "boolean" ? r.dirty : null, dirtyEvidence: digest(r.dirtyEvidence) };
  };
  const c = record(input.configured), o = record(input.observed);
  const configured = {
    evidence: "unverified-declaration" as const,
    guidanceMode: c.guidanceMode === "standard" || c.guidanceMode === "review" || c.guidanceMode === "minimal" ? c.guidanceMode : null,
    profile: digest(c.profile), requestedModel: digest(c.requestedModel), requestedEffort: digest(c.requestedEffort),
    runtimeBundle: digest(c.runtimeBundle), prompt: digest(c.prompt), resources: collection(c.resources), hooks: collection(c.hooks),
    repository: repository(c.repository),
  };
  const observed = {
    evidence: "server-observation" as const,
    runtimeBundle: digest(o.runtimeBundle), runtimeVersion: digest(o.runtimeVersion), prompt: digest(o.prompt),
    resources: collection(o.resources), hooks: collection(o.hooks), repository: repository(o.repository),
    guidanceDelivery: (() => {
      if (!Array.isArray(o.guidanceOutputs)) return { status: "unknown" as const, count: null, matchedCount: null, sha256: null };
      if (o.guidanceOutputs.length > RUN_PROVENANCE_LIMITS.entries) return { status: "unknown" as const, count: o.guidanceOutputs.length, matchedCount: null, sha256: null };
      const entries = Array.from(o.guidanceOutputs, item => {
        const r = record(item), reference = digest(r.reference), output = digest(r.output);
        return { status: reference.status === "known" && reference.bytes > 0 && output.status === "known" && reference.sha256 === output.sha256
          ? "observed-content-match" as const : "unknown" as const, reference, output };
      });
      return { status: entries.length > 0 && entries.every(entry => entry.status === "observed-content-match")
        ? "observed-content-match" as const : "unknown" as const, count: entries.length,
        matchedCount: entries.filter(entry => entry.status === "observed-content-match").length,
        sha256: entries.every(entry => entry.reference.status === "known" && entry.output.status === "known") ? hash(JSON.stringify(entries)) : null };
    })(),
    routing: { actualModel: null, actualEffort: null, status: "unknown" as const },
  };
  const manifest = { schemaVersion: 1 as const, configured, observed };
  return { ...manifest, manifestDigest: hash(JSON.stringify(manifest)) };
}
export type RunProvenanceManifest = ReturnType<typeof buildRunProvenance>;
