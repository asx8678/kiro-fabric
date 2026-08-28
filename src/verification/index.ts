/**
 * Uniform verification protocol (V2) — a host-neutral three-state claim/result
 * contract (verified | not_verified | inconclusive) shared across providers,
 * certification scripts, and the outcome gate. Deterministic oracles outrank
 * model judgment; model add-ons can never flip a failed deterministic verdict.
 */
export * from "./types.js";

export {
  canonicalJsonBytes,
  fingerprintFor,
  fingerprintVerificationResult,
  sha256Bytes,
  sha256Digest,
  sha256File,
  sha256Text,
} from "./fingerprint.js";

export {
  verificationResultSchema,
  verificationResultEnvelopeSchema,
  validateVerificationResult,
} from "./schemas.js";

export {
  fromBenchmarkReport,
  fromCertificationReport,
  fromGateOutcome,
  fromHandoffReport,
  fromKiroClaimsReport,
  fromSchemaVerificationReport,
  fromStateVerificationReport,
} from "./adapters.js";

export type {
  BenchmarkAdapterOptions,
  SchemaVerificationReportLike,
  StateVerificationReportLike,
  VerificationAdapterOptions,
} from "./adapters.js";
