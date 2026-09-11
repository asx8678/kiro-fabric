import type { FabricInvocationContext } from "../protocol.js";

export type ReviewCoverage = "unknown" | "retrieved" | "traced" | "verified" | "blocked";
export type ReviewEvidenceKind = "source" | "static-proof" | "test" | "probe";
export type ReviewFindingStatus = "candidate" | "confirmed" | "conditional" | "disproved";
export type ReviewRole = "entry" | "model-validation" | "service" | "dependency" | "persistence" | "consumer";
export interface ReviewEvidenceInput {
  path: string;
  /** Inclusive, 1-based source range. */
  startLine: number;
  endLine: number;
  kind: ReviewEvidenceKind;
  /** Caller-authored explanation, not a host semantic verdict or execution receipt. */
  rationale: string;
  /** Optional expectation only; the host always reads and computes its own hash. */
  expectedSha256?: string;
}
export interface ReviewEvidence extends ReviewEvidenceInput {
  sha256: string;
  rangeSha256: string;
}
export interface ReviewBlocker { reason: string; nextAction: string }
/** paths are execution-path IDs (e.g. "submit-order"), NOT source filenames. */
export interface ReviewBeginArguments { objective: string; paths: string[]; scenarios?: string[] }
export interface ReviewUpdateArguments {
  taskId: string;
  obligationId: string;
  status: ReviewCoverage;
  evidence?: ReviewEvidenceInput[];
  note?: string;
  contract?: string;
  blocker?: ReviewBlocker;
}
export interface ReviewCounterexample {
  verdict: "not-checked" | "survived" | "disproved" | "conditional";
  method: "static-proof" | "test" | "probe";
  description: string;
  evidence: ReviewEvidenceInput[];
}
export interface ReviewFindingArguments {
  taskId: string;
  findingId?: string;
  title: string;
  requestedStatus: ReviewFindingStatus;
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: "high" | "medium" | "low";
  caller: string;
  trigger: string;
  expectedContract: string;
  actualAction: string;
  consequence: string;
  evidence: ReviewEvidenceInput[];
  counterexample: ReviewCounterexample;
  unresolvedAssumptions: string[];
}
export interface ReviewTaskArguments { taskId: string }
export interface ReviewPageArguments extends ReviewTaskArguments { offset?: number; limit?: number }
export interface ReviewObligation {
  type: "obligation";
  id: string;
  kind: "path" | "scenario" | "role" | "edge" | "partial-failure";
  pathId: string;
  failureCheck?: string;
  scenario?: string;
  role?: ReviewRole;
  from?: ReviewRole;
  to?: ReviewRole;
  status: ReviewCoverage;
  note: string | null;
  contract: string | null;
  blocker: ReviewBlocker | null;
  evidence: ReviewEvidence[];
  stale: boolean;
}
export interface ReviewFinding extends Omit<ReviewFindingArguments, "taskId" | "findingId" | "evidence" | "counterexample"> {
  type: "finding";
  id: string;
  status: ReviewFindingStatus;
  evidence: ReviewEvidence[];
  counterexample: Omit<ReviewCounterexample, "evidence"> & { evidence: ReviewEvidence[] };
  admissionReasons: string[];
  needsDowngrade: boolean;
}
export interface ReviewBeginResult { taskId: string; revision: number; obligationCount: number; expiresInMs: number }
export interface ReviewMutationResult { taskId: string; revision: number; id: string; status: ReviewCoverage | ReviewFindingStatus; admissionReasons?: string[] }
export interface ReviewSummary {
  taskId: string;
  revision: number;
  /** Ready is always advisory and only meaningful for this declared scope. */
  ready: boolean;
  advisory: true;
  semanticValidation: false;
  /** status does not read source; reconcile explicitly refreshes this snapshot. */
  freshness: "unreconciled" | "last-reconciled";
  unresolvedCount: number;
  findingsNeedingDowngradeCount: number;
  coverage: Record<ReviewCoverage, number>;
  expiresInMs: number;
}
export interface ReviewStatusResult extends ReviewSummary {
  objective: string;
  entries: (ReviewObligation | ReviewFinding)[];
  total: number;
  nextOffset: number | null;
}
export interface ReviewReconcileResult extends ReviewSummary {
  /** Page over unresolved obligation IDs followed by finding IDs needing downgrade. */
  unresolvedObligations: string[];
  findingsNeedingDowngrade: string[];
  total: number;
  nextOffset: number | null;
}
export interface ReviewEndResult { taskId: string; ended: true }
export interface ReviewProviderOptions {
  /** Canonical workspace root; default reads use LocalPaths safety checks. */
  root: string;
  /** Host budget 1000..8000000, default 16000; internally capped at 32000. */
  maxResultChars?: number;
  maxTasks?: number;
  maxTaskChars?: number;
  maxSessionChars?: number;
  taskTtlMs?: number;
  sessionTtlMs?: number;
  /** Trusted host-only, synchronous bounded UTF-8 snapshot reader. Never guest code.
   * Receives a normalized workspace-relative path. A custom reader owns filesystem
   * safety/identity checks; the provider still enforces lexical scope and hashes. */
  sourceSnapshot?: (path: string, context: FabricInvocationContext) => string;
  /** Monotonic milliseconds, for deterministic host tests. */
  now?: () => number;
}

/** Standalone checked-guest declarations. No Node types, callbacks or execution tools. */
export const REVIEW_GUEST_DECLARATIONS = `
type ReviewCoverage = "unknown" | "retrieved" | "traced" | "verified" | "blocked";
type ReviewEvidenceKind = "source" | "static-proof" | "test" | "probe";
type ReviewFindingStatus = "candidate" | "confirmed" | "conditional" | "disproved";
type ReviewRole = "entry" | "model-validation" | "service" | "dependency" | "persistence" | "consumer";
type ReviewEvidenceInput = { path: string; startLine: number; endLine: number; kind: ReviewEvidenceKind; rationale: string; expectedSha256?: string };
type ReviewEvidence = ReviewEvidenceInput & { sha256: string; rangeSha256: string };
type ReviewBlocker = { reason: string; nextAction: string };
type ReviewBeginArguments = { objective: string; paths: string[]; scenarios?: string[] };
type ReviewUpdateArguments = { taskId: string; obligationId: string; status: ReviewCoverage; evidence?: ReviewEvidenceInput[]; note?: string; contract?: string; blocker?: ReviewBlocker };
type ReviewCounterexample = { verdict: "not-checked" | "survived" | "disproved" | "conditional"; method: "static-proof" | "test" | "probe"; description: string; evidence: ReviewEvidenceInput[] };
type ReviewFindingArguments = { taskId: string; findingId?: string; title: string; requestedStatus: ReviewFindingStatus; severity: "critical" | "high" | "medium" | "low" | "info"; confidence: "high" | "medium" | "low"; caller: string; trigger: string; expectedContract: string; actualAction: string; consequence: string; evidence: ReviewEvidenceInput[]; counterexample: ReviewCounterexample; unresolvedAssumptions: string[] };
type ReviewTaskArguments = { taskId: string };
type ReviewPageArguments = ReviewTaskArguments & { offset?: number; limit?: number };
type ReviewObligation = { type: "obligation"; id: string; kind: "path" | "scenario" | "role" | "edge" | "partial-failure"; pathId: string; failureCheck?: string; scenario?: string; role?: ReviewRole; from?: ReviewRole; to?: ReviewRole; status: ReviewCoverage; note: string | null; contract: string | null; blocker: ReviewBlocker | null; evidence: ReviewEvidence[]; stale: boolean };
type ReviewFinding = Omit<ReviewFindingArguments, "taskId" | "findingId" | "evidence" | "counterexample"> & { type: "finding"; id: string; status: ReviewFindingStatus; evidence: ReviewEvidence[]; counterexample: Omit<ReviewCounterexample, "evidence"> & { evidence: ReviewEvidence[] }; admissionReasons: string[]; needsDowngrade: boolean };
type ReviewBeginResult = { taskId: string; revision: number; obligationCount: number; expiresInMs: number };
type ReviewMutationResult = { taskId: string; revision: number; id: string; status: ReviewCoverage | ReviewFindingStatus; admissionReasons?: string[] };
type ReviewSummary = { taskId: string; revision: number; ready: boolean; advisory: true; semanticValidation: false; freshness: "unreconciled" | "last-reconciled"; unresolvedCount: number; findingsNeedingDowngradeCount: number; coverage: Record<ReviewCoverage, number>; expiresInMs: number };
type ReviewStatusResult = ReviewSummary & { objective: string; entries: (ReviewObligation | ReviewFinding)[]; total: number; nextOffset: number | null };
type ReviewReconcileResult = ReviewSummary & { unresolvedObligations: string[]; findingsNeedingDowngrade: string[]; total: number; nextOffset: number | null };
type ReviewEndResult = { taskId: string; ended: true };
/** Optional, instance/session-local ledger. Mutations require ordinary write approval.
 * Evidence is read and hash-checked, never executed. Admission is structural only;
 * static proof is allowed, but no semantic correctness or test execution is certified.
 * paths are execution-path IDs, independent of evidence filenames. Each gets
 * normal/repeated/malformed/partial-failure scenarios, causal roles/edges, and
 * before/after-effect, retry, compensation, acknowledgement and visibility checks.
 * All obligations start unknown. Traced needs note+evidence; verified also needs
 * contract+non-source proof. Blocked needs reason+nextAction. No automatic steering.
 * status is last-known data only. reconcile rereads evidence and invalidates stale
 * coverage/findings; ready is advisory, scope-limited, and cannot force an answer.
 * status/reconcile pages use offset/limit (default 20, max 50); continue nextOffset.
 * Fixed task/session TTLs survive exec/compaction only while this instance lives.
 * end discards a task; no implicit persistence or cross-chat restoration.
 */
declare const review: {
  begin(args: ReviewBeginArguments): Promise<ReviewBeginResult>;
  update(args: ReviewUpdateArguments): Promise<ReviewMutationResult>;
  finding(args: ReviewFindingArguments): Promise<ReviewMutationResult>;
  status(args: ReviewPageArguments): Promise<ReviewStatusResult>;
  reconcile(args: ReviewPageArguments): Promise<ReviewReconcileResult>;
  end(args: ReviewTaskArguments): Promise<ReviewEndResult>;
};
`;
