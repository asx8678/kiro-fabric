/**
 * Verification protocol V2 — a host-neutral, machine-readable contract for
 * expressing a falsifiable claim, the evidence gathered against it, and exactly
 * one verdict. This fills the "general agent behavior / live
 * user-path" gap without replacing `pnpm run check`, schema certificates,
 * release certification, or the offline context benchmark.
 *
 * Deterministic-oracle precedence:
 *   protocol/security invariant > executable oracle > structured analysis >
 *   runtime observation > model review > self-report.
 *
 * A model judge may add evidence but may NEVER override a failed deterministic,
 * protocol, filesystem, test, or certificate oracle.
 */

export type VerificationVerdict = "verified" | "not_verified" | "inconclusive";

export type VerificationAdapterSource =
  | "state.verify"
  | "schema.verify"
  | "gate.outcome"
  | "certification"
  | "kiro.claims"
  | "benchmark"
  | "orchestrate-handoff";

export interface VerificationFingerprint {
  algorithm: "sha256";
  /**
   * Hex digest prefixed with `sha256:`. `result` covers the fully resolved
   * result document EXCLUDING the `fingerprints.result` field itself (so the
   * digest is not self-referential).
   */
  digest: string;
}

export interface VerificationArtifact {
  id: string;
  role:
    | "claim"
    | "baseline"
    | "treatment"
    | "comparison"
    | "command_output"
    | "test_report"
    | "certificate"
    | "diagnostic";
  /** Optional explicit reference (`file:`, MCP/artifact URI). Never required. */
  uri?: string;
  mediaType?: string;
  sizeBytes?: number;
  /** Digest of the COMPLETE raw artifact, never just the retained prefix. */
  digest: VerificationFingerprint;
  retained: "full" | "truncated" | "digest_only";
  /** Present iff retained === "truncated". */
  omittedBytes?: number;
  /** True when the artifact is secret-bearing and must not be surfaced. */
  sensitive?: boolean;
  description?: string;
}

export interface VerificationCheck {
  id: string;
  verdict: VerificationVerdict;
  description?: string;
  expected?: unknown;
  observed?: unknown;
  artifactIds: string[];
}

export interface VerificationClaim {
  id?: string;
  /** The falsifiable statement under test. */
  statement: string;
  /** Concise condition / acceptance criterion ("when X then Y"). */
  condition?: string;
  metric?: string;
  threshold?: string | number;
}

export interface VerificationResult {
  protocolVersion: 2;
  verdict: VerificationVerdict;
  claim: VerificationClaim;
  summary: string;
  checks: VerificationCheck[];
  artifacts: VerificationArtifact[];
  fingerprints: {
    inputs?: VerificationFingerprint;
    environment?: VerificationFingerprint;
    evidence: VerificationFingerprint;
    result: VerificationFingerprint;
  };
  startedAt?: string;
  finishedAt: string;
  adapter?: { source: VerificationAdapterSource; sourceVersion?: string };
}

export interface VerificationResultEnvelope {
  schemaVersion: 1;
  kind: "kiro-fabric.verification-result";
  result: VerificationResult;
}