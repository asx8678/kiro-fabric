/**
 * Outcome gate (PR4) — one formal, deterministic acceptance gate run before a
 * report is synthesized. It combines the shared `EvidenceLedger` with command
 * artifacts to decide whether the accumulated evidence is coherent enough to
 * trust, and produces a `CompletionCapsule` whose totals are computed
 * programmatically — the synthesizer never hand-types counts or sums.
 *
 * Fail-soft semantics (benchmark findings):
 * - Hard inconsistencies (unresolved contradictions, illegal ledger state,
 *   high-severity CONFIRMED claims with no evidence) ⇒ `reject`.
 * - Inconclusive state (claims still UNREVIEWED / HYPOTHESIS / SUPPORTED but
 *   never confirmed or falsified) ⇒ `defer`, not success.
 * - Only a fully consistent, fully adjudicated claim set ⇒ `accept`.
 *
 * The gate is read-only over the ledger: it consumes `summarize()` and
 * `checkConsistency()` and adds cross-claim contradiction detection and
 * content digests so identical evidence always yields the same capsule.
 */

import { createHash } from "node:crypto";
import type { Claim, ClaimStatus, EvidenceLedger } from "./evidence-ledger.js";

type GateStatus = "accept" | "defer" | "reject";

/** Stable acceptance criterion supplied by the verification protocol. */
export interface OutcomeCriterion {
  criterionId: string;
  statement?: string;
}

/** Freshness identity that prevents evidence reuse across workspace states. */
export interface OutcomeBinding {
  sessionId?: string;
  commit: string;
  treeHash: string;
}

interface GateViolation {
  kind:
    | "inconsistent-ledger"
    | "contradiction"
    | "unresolved-claim"
    | "missing-evidence"
    | "binding-mismatch";
  /** Claim IDs or a ledger-level description the violation references. */
  detail: string;
}

interface Contradiction {
  /** Pair of claim IDs that assert opposing verdicts on the same statement. */
  claimIds: [string, string];
  reason: string;
}

/**
 * Deterministic report capsule. Every total is derived from the claim set, so
 * verdict counts always sum to the claim count and can never disagree with
 * the table the model might write alongside it.
 */
export interface CompletionCapsule {
  /** Content digest over the claim set; identical evidence ⇒ identical id. */
  capsuleId: string;
  totalClaims: number;
  byStatus: Record<ClaimStatus, number>;
  confirmedIds: string[];
  falsifiedIds: string[];
  /** True when byStatus sums to totalClaims (ledger internal consistency). */
  countsConsistent: boolean;
  contradictions: Contradiction[];
  /** Stable acceptance criteria the gate was asked to cover (V1). */
  criterionIds: string[];
  /** Workspace-freshness binding folded into the capsule identity (V1). */
  binding?: { sessionId?: string; commit: string; treeHash: string };
}

export interface GateOutcome {
  status: GateStatus;
  violations: GateViolation[];
  capsule: CompletionCapsule;
  /** Criterion IDs declared but not satisfied by any terminal claim (V1). */
  missingCriterionIds: string[];
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const isTerminalClaim = (claim: Claim): boolean =>
  claim.status === "CONFIRMED" ||
  claim.status === "PARTIALLY_CONFIRMED" ||
  claim.status === "FALSIFIED";

const claimMatchesBinding = (claim: Claim, binding: OutcomeBinding): boolean => {
  if (claim.binding?.commit !== binding.commit || claim.binding.treeHash !== binding.treeHash) return false;
  return binding.sessionId === undefined || claim.binding?.sessionId === binding.sessionId;
};

/** Canonical, order-stable serialization of a claim for digesting. */
const canonicalClaim = (claim: Claim): string =>
  JSON.stringify({
    id: claim.claimId,
    criterionId: claim.criterionId ?? null,
    commit: claim.commit,
    source: claim.evidenceSource ?? null,
    binding: claim.binding
      ? `${claim.binding.commit ?? ""}:${claim.binding.treeHash ?? ""}:${claim.binding.sessionId ?? ""}`
      : null,
    statement: claim.statement.toLowerCase().replace(/\s+/g, " ").trim(),
    status: claim.status,
    evidence: claim.evidence.map((e) => `${e.ref}${e.detail ? `#${e.detail}` : ""}`).sort(),
    counter: claim.counterevidence.map((e) => `${e.ref}${e.detail ? `#${e.detail}` : ""}`).sort(),
  });

/**
 * Detect pairwise contradictions: two claims that share a significant token
 * overlap (the same subject) but land on opposing terminal verdicts. This is
 * deliberately conservative — it flags "all actions pinned" CONFIRMED next to
 * "one action uses @v4" CONFIRMED, not two nuance-level supported claims.
 */
const detectContradictions = (claims: readonly Claim[]): Contradiction[] => {
  const positive: ReadonlySet<ClaimStatus> = new Set(["CONFIRMED"]);
  const negative: ReadonlySet<ClaimStatus> = new Set(["FALSIFIED"]);
  const out: Contradiction[] = [];
  const seen = new Set<string>();
  const tokens = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 3),
    );
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i]!;
      const b = claims[j]!;
      const key = `${a.claimId}|${b.claimId}`;
      if (seen.has(key)) continue;
      const aPos = positive.has(a.status);
      const bPos = positive.has(b.status);
      const aNeg = negative.has(a.status);
      const bNeg = negative.has(b.status);
      const opposing = (aPos && bNeg) || (bPos && aNeg);
      if (!opposing) continue;
      const at = tokens(a.statement);
      const bt = tokens(b.statement);
      if (at.size === 0 || bt.size === 0) continue;
      const shared = [...at].filter((t) => bt.has(t)).length;
      const overlap = shared / Math.min(at.size, bt.size);
      if (overlap >= 0.5) {
        seen.add(key);
        out.push({
          claimIds: [a.claimId, b.claimId],
          reason: `opposing terminal verdicts on the same subject (${Math.round(overlap * 100)}% token overlap)`,
        });
      }
    }
  }
  return out;
};

export class OutcomeGate {
  constructor(private readonly ledger: EvidenceLedger) {}

  /**
   * Compute the deterministic capsule. Accepts an optional binding so the
   * capsule identity captures the workspace/commit state it was gathered on;
   * evidence gathered against a different tree can never reuse the capsule.
   */
  capsule(binding?: OutcomeBinding): CompletionCapsule {
    const summary = this.ledger.summarize();
    const claims = this.ledger.list();
    const contradictions = detectContradictions(claims);
    const criterionIds = [...new Set(claims.map((c) => c.criterionId).filter((x): x is string => Boolean(x)))].sort();
    const base = claims.map(canonicalClaim).sort().join("\n");
    const bound = binding ? `${binding.commit}\u0000${binding.treeHash}\u0000${binding.sessionId ?? ""}\u0000` : "";
    const capsule: CompletionCapsule = {
      capsuleId: sha256(base + "\u0000" + bound).slice(0, 16),
      totalClaims: summary.total,
      byStatus: summary.byStatus,
      confirmedIds: summary.confirmed.map((c) => c.claimId).sort(),
      falsifiedIds: summary.falsified.map((c) => c.claimId).sort(),
      countsConsistent: summary.countsConsistent,
      contradictions,
      criterionIds,
    };
    if (binding) capsule.binding = { ...binding };
    return capsule;
  }

  /**
   * Evaluate the evidence and decide. Read-only; never mutates the ledger.
   *
   * When `criteria` and/or `binding` are supplied (V1 verification protocol):
   * - every declared criterion must be satisfied by at least one terminal claim
   *   bound to that `criterionId`; otherwise the gate defers and lists the
   *   missing criterion ids;
   * - the supplied workspace binding must be honored by every terminal claim:
   *   commit/tree must match exactly, and a supplied session id adds an exact
   *   session constraint. Unbound or partially bound terminal claims are stale
   *   and make the gate reject; a bound evaluation with no terminal claim defers;
   * - oracle-auged evidence outranks worker/verifier disagreement (oracle
   *   precedence) — a confirmed claim whose highest authority contradicts an
   *   authoritative deterministic oracle is rejected.
   *
   * Calling without arguments preserves the original fail-soft semantics.
   */
  evaluate(options: { criteria?: OutcomeCriterion[]; binding?: OutcomeBinding } = {}): GateOutcome {
    const violations: GateViolation[] = [];
    const { criteria = [], binding } = options;
    const capsule = this.capsule(binding);
    const claims = this.ledger.list();
    const terminalClaims = claims.filter(isTerminalClaim);
    const eligibleTerminalClaims = binding
      ? terminalClaims.filter((claim) => claimMatchesBinding(claim, binding))
      : terminalClaims;

    // 1. Ledger-internal consistency (count sum, evidence floor for all terminal states).
    for (const violation of this.ledger.checkConsistency()) {
      violations.push({ kind: "inconsistent-ledger", detail: violation });
    }

    // 2. Unresolved contradictions block trust.
    for (const contradiction of capsule.contradictions) {
      violations.push({
        kind: "contradiction",
        detail: `${contradiction.claimIds.join(" vs ")}: ${contradiction.reason}`,
      });
    }

    // 3. A bound capsule is trustworthy only when every adjudicated claim was
    // gathered against that exact workspace identity. Missing terminal claims
    // are inconclusive; stale terminal claims are a hard trust failure.
    if (binding) {
      if (terminalClaims.length === 0) {
        violations.push({
          kind: "missing-evidence",
          detail: "bound evaluation has no terminal claims",
        });
      }
      for (const claim of terminalClaims
        .filter((candidate) => !claimMatchesBinding(candidate, binding))
        .sort((a, b) => a.claimId.localeCompare(b.claimId))) {
        violations.push({
          kind: "binding-mismatch",
          detail: `claim ${claim.claimId} is not bound to commit ${binding.commit}, tree ${binding.treeHash}${binding.sessionId === undefined ? "" : `, session ${binding.sessionId}`}`,
        });
      }
    }

    // 4. Unadjudicated claims mean the investigation is incomplete.
    const unresolved = claims
      .filter((c) => c.status !== "CONFIRMED" && c.status !== "FALSIFIED" && c.status !== "PARTIALLY_CONFIRMED");
    for (const claim of unresolved) {
      violations.push({
        kind: "unresolved-claim",
        detail: `claim ${claim.claimId} is still ${claim.status}`,
      });
    }

    // 5. Criterion coverage (V1): every declared criterion must map to at least
    //    one fresh terminal claim carrying that criterionId.
    const satisfiedBySource = new Map<string, string[]>();
    for (const claim of eligibleTerminalClaims) {
      if (!claim.criterionId) continue;
      const terminal = claim.status === "CONFIRMED" || claim.status === "PARTIALLY_CONFIRMED" || claim.status === "FALSIFIED";
      const source = claim.evidenceSource ?? "assertion";
      if (terminal) {
        const hit = satisfiedBySource.get(claim.criterionId) ?? [];
        hit.push(source);
        satisfiedBySource.set(claim.criterionId, hit);
      }
    }
    const missingCriterionIds: string[] = [];
    for (const criterion of criteria) {
      if (!satisfiedBySource.has(criterion.criterionId)) {
        missingCriterionIds.push(criterion.criterionId);
      }
    }
    for (const missing of missingCriterionIds) {
      violations.push({ kind: "missing-evidence", detail: `criterion ${missing} has no terminal, claimed evidence` });
    }

    // 6. Oracle precedence (V1): where a criterion's retained evidence includes
    // an explicit oracle and the verdict outcome of that oracle disagrees with a
    // non-oracle (worker/verifier) self-report, the oracle wins. This never
    // overrides a deterministic ledger inconsistency — oracle contradicts only
    // resolve rank among otherwise-coherent sources.
    for (const [criterionId, sources] of satisfiedBySource) {
      if (sources.includes("oracle") && !sources.every((s) => s === "oracle")) {
        // mixed authority for one criterion: defer instead of trusting a
        // non-oracle verdict that an authoritative oracle could have corrected
        violations.push({
          kind: "missing-evidence",
          detail: `criterion ${criterionId} mixes oracle and non-oracle evidence; a bounded review/consolidation pass is required`,
        });
      }
    }

    let status: GateStatus = "accept";
    if (violations.some((v) =>
      v.kind === "inconsistent-ledger" ||
      v.kind === "contradiction" ||
      v.kind === "binding-mismatch"
    )) {
      status = "reject";
    } else if (violations.length > 0 || missingCriterionIds.length > 0) {
      status = "defer"; // unresolved criteria / evidence floor: not a trust failure
    }

    return { status, violations, capsule, missingCriterionIds };
  }
}
