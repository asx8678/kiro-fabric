/**
 * Shared evidence ledger — a structured, commit-scoped source of truth for
 * agent findings.
 *
 * Motivation (benchmark findings): without a shared ledger, independent
 * agents rediscover the same supposed defect after it has been falsified
 * (the "ProductEvents warnings" failure mode), and final reports contain
 * contradictory claims and hand-computed tallies that do not sum. This module
 * stores every finding as a structured claim with an explicit falsification
 * lifecycle, scopes evidence to a Git commit, and derives all report totals
 * programmatically so the model never types its own sums.
 *
 * Storage is an append-only JSONL journal plus a derived in-memory index.
 * Appends are O(1); the index is rebuilt by replaying the journal. Claims are
 * keyed by `claim_id` and transitions are immutable events.
 */

import fs from "node:fs";
import path from "node:path";

/** Lifecycle states for a claim. Only CONFIRMED claims count as defects. */
export type ClaimStatus =
  | "UNREVIEWED"
  | "HYPOTHESIS"
  | "SUPPORTED"
  | "CONFIRMED"
  | "PARTIALLY_CONFIRMED"
  | "FALSIFIED";

/** How strongly a claim is backed. Ordered weakest → strongest. */
export type EvidenceLevel =
  | "assertion"
  | "code_read"
  | "grep_match"
  | "targeted_test"
  | "reproduction"
  | "command_output";

export interface EvidenceItem {
  /** File path, command, or artifact reference. */
  ref: string;
  /** Optional line range or detail, e.g. "113-143". */
  detail?: string;
}

export interface Claim {
  claimId: string;
  /** Git commit SHA the evidence was gathered against. */
  commit: string;
  /** The falsifiable statement, e.g. "proposal_created warnings are analytics loss". */
  statement: string;
  status: ClaimStatus;
  confidence: "low" | "medium" | "high";
  evidenceLevel: EvidenceLevel;
  evidence: EvidenceItem[];
  counterevidence: EvidenceItem[];
  /** Agent that most recently transitioned the claim. */
  verifiedBy?: string;
  /** Free-form severity for defect claims. */
  severity?: "critical" | "high" | "medium" | "low" | "info";
  /** Stable acceptance-criterion this claim helps satisfy (V1 verification). */
  criterionId?: string;
  /** Origin of the highest-authority evidence: oracle > verifier > worker > assertion. */
  evidenceSource?: "assertion" | "worker" | "verifier" | "oracle";
  /** Freshness identity binding this claim to a workspace/commit state. */
  binding?: { sessionId?: string; commit?: string; treeHash?: string };
  createdAt: number;
  updatedAt: number;
}

/** Journal event: create or transition a claim. */
interface LedgerEvent {
  type: "upsert" | "transition";
  claimId: string;
  at: number;
  commit?: string;
  claim?: Claim;
  to?: ClaimStatus;
  by?: string;
  note?: string;
  /** Evidence added by this transition (persisted so replay preserves it). */
  evidence?: EvidenceItem[];
  counterevidence?: EvidenceItem[];
}

const LEDGER_FORMAT = 1;
const VALID_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  UNREVIEWED: ["HYPOTHESIS", "FALSIFIED"],
  HYPOTHESIS: ["SUPPORTED", "FALSIFIED"],
  SUPPORTED: ["CONFIRMED", "PARTIALLY_CONFIRMED", "FALSIFIED"],
  PARTIALLY_CONFIRMED: ["CONFIRMED", "FALSIFIED"],
  CONFIRMED: ["FALSIFIED"], // new counter-evidence can reopen
  FALSIFIED: ["HYPOTHESIS"], // can be re-raised only as a fresh hypothesis
};

export class EvidenceLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceLedgerError";
  }
}

export class EvidenceLedger {
  readonly #journalPath: string;
  readonly #claims = new Map<string, Claim>();
  /** Append-only audit log of every event, in order. */
  readonly #events: LedgerEvent[] = [];

  private constructor(journalPath: string) {
    this.#journalPath = journalPath;
  }

  /** Open (or create) the ledger rooted at a directory. */
  static open(dir: string): EvidenceLedger {
    fs.mkdirSync(dir, { recursive: true });
    const journalPath = path.join(dir, "evidence-ledger.jsonl");
    const ledger = new EvidenceLedger(journalPath);
    if (fs.existsSync(journalPath)) ledger.#replay();
    return ledger;
  }

  #replay(): void {
    const text = fs.readFileSync(this.#journalPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: LedgerEvent;
      try {
        event = JSON.parse(trimmed) as LedgerEvent;
      } catch {
        continue; // tolerate a torn final line
      }
      this.#apply(event);
    }
  }

  #apply(event: LedgerEvent): void {
    this.#events.push(event);
    if (event.type === "upsert" && event.claim) {
      this.#claims.set(event.claimId, event.claim);
    } else if (event.type === "transition" && event.to) {
      const existing = this.#claims.get(event.claimId);
      if (existing) {
        const next: Claim = {
          ...existing,
          status: event.to,
          updatedAt: event.at,
          evidence: [...existing.evidence, ...(event.evidence ?? [])],
          counterevidence: [...existing.counterevidence, ...(event.counterevidence ?? [])],
        };
        if (event.by) next.verifiedBy = event.by;
        this.#claims.set(event.claimId, next);
      }
    }
  }

  #append(event: LedgerEvent): void {
    fs.appendFileSync(this.#journalPath, JSON.stringify(event) + "\n");
    this.#apply(event);
  }

  /**
   * Register a new claim. If a claim with the same deterministic ID already
   * exists, returns the existing record instead of duplicating it — this is
   * the mechanism that prevents the same falsified finding from being
   * re-raised as new.
   */
  submit(input: {
    statement: string;
    commit: string;
    evidence?: EvidenceItem[];
    evidenceLevel?: EvidenceLevel;
    confidence?: Claim["confidence"];
    severity?: Claim["severity"];
    by?: string;
    /** Optional stable acceptance-criterion identity (V1). */
    criterionId?: string;
    /** Optional evidence-source authority (V1). */
    evidenceSource?: Claim["evidenceSource"];
    /** Optional workspace-freshness binding (V1). */
    binding?: Claim["binding"];
  }): Claim {
    const claimId = claimIdFor(input.statement, input.commit);
    const existing = this.#claims.get(claimId);
    if (existing) return existing;
    const now = Date.now();
    const claim: Claim = {
      claimId,
      commit: input.commit,
      statement: input.statement,
      status: "UNREVIEWED",
      confidence: input.confidence ?? "low",
      evidenceLevel: input.evidenceLevel ?? "assertion",
      evidence: input.evidence ?? [],
      counterevidence: [],
      createdAt: now,
      updatedAt: now,
    };
    if (input.severity) claim.severity = input.severity;
    if (input.by) claim.verifiedBy = input.by;
    if (input.criterionId) claim.criterionId = input.criterionId;
    if (input.evidenceSource) claim.evidenceSource = input.evidenceSource;
    if (input.binding) claim.binding = input.binding;
    this.#append({ type: "upsert", claimId, at: now, commit: input.commit, claim });
    return claim;
  }

  /**
   * Advance a claim through the lifecycle, enforcing legal transitions. A
   * falsification stage is mandatory before CONFIRMED: a claim must pass
   * through SUPPORTED (i.e. survive an adversarial review) first.
   */
  transition(
    claimId: string,
    to: ClaimStatus,
    options: { by?: string; note?: string; evidence?: EvidenceItem[]; counterevidence?: EvidenceItem[] } = {},
  ): Claim {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new EvidenceLedgerError(`Unknown claim ${claimId}`);
    const allowed = VALID_TRANSITIONS[claim.status];
    if (!allowed.includes(to)) {
      throw new EvidenceLedgerError(
        `Illegal claim transition ${claim.status} -> ${to} for ${claimId} (allowed: ${allowed.join(", ")})`,
      );
    }
    if (to === "CONFIRMED" && claim.status !== "SUPPORTED" && claim.status !== "PARTIALLY_CONFIRMED") {
      throw new EvidenceLedgerError(
        `Claim ${claimId} cannot be CONFIRMED without passing adversarial SUPPORTED review (currently ${claim.status})`,
      );
    }
    const event: LedgerEvent = { type: "transition", claimId, at: Date.now(), to };
    if (options.by) event.by = options.by;
    if (options.note) event.note = options.note;
    if (options.evidence?.length) event.evidence = options.evidence;
    if (options.counterevidence?.length) event.counterevidence = options.counterevidence;
    this.#append(event);
    return this.#claims.get(claimId)!;
  }

  /** Convenience: raise a submitted claim to a falsifiable hypothesis. */
  hypothesize(claimId: string, by?: string): Claim {
    return this.transition(claimId, "HYPOTHESIS", by ? { by } : {});
  }

  /** Record that a claim survived adversarial review. */
  support(claimId: string, by: string, evidence?: EvidenceItem[]): Claim {
    return evidence?.length ? this.transition(claimId, "SUPPORTED", { by, evidence }) : this.transition(claimId, "SUPPORTED", { by });
  }

  /** Falsify a claim with counter-evidence. */
  falsify(claimId: string, by: string, counterevidence: EvidenceItem[] = [], note?: string): Claim {
    const options: { by: string; counterevidence: EvidenceItem[]; note?: string } = { by, counterevidence };
    if (note) options.note = note;
    return this.transition(claimId, "FALSIFIED", options);
  }

  get(claimId: string): Claim | undefined {
    return this.#claims.get(claimId);
  }

  /** All claims, optionally filtered to those still relevant at a commit. */
  list(filter: { status?: ClaimStatus; commit?: string } = {}): Claim[] {
    let out = [...this.#claims.values()];
    if (filter.status) out = out.filter((c) => c.status === filter.status);
    if (filter.commit) out = out.filter((c) => c.commit === filter.commit);
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Find prior claims matching a statement, regardless of commit. Used so an
   * agent about to investigate can see that the same finding was already
   * falsified at an earlier commit. Evidence is commit-scoped: a claim
   * falsified at abc123 is NOT assumed false at def456, but it IS surfaced.
   *
   * Matching is fuzzy (shared significant-word overlap) so a re-worded
   * rediscovery of the same finding is caught instead of silently re-raised.
   */
  findSimilar(statement: string): Claim[] {
    const queryTokens = significantTokens(statement);
    if (queryTokens.size === 0) return [];
    const matches: Claim[] = [];
    const seen = new Set<string>();
    for (const claim of this.#claims.values()) {
      if (seen.has(claim.claimId)) continue;
      const claimTokens = significantTokens(claim.statement);
      if (claimTokens.size === 0) continue;
      let overlap = 0;
      for (const token of claimTokens) if (queryTokens.has(token)) overlap++;
      const coverage = overlap / claimTokens.size;
      if (coverage >= 0.5) {
        seen.add(claim.claimId);
        matches.push(claim);
      }
    }
    return matches.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Deterministic, programmatically-computed report summary. The model never
   * types these totals — they are derived from the claim set so score sums and
   * verdict counts cannot disagree with the table.
   */
  summarize(): {
    total: number;
    byStatus: Record<ClaimStatus, number>;
    confirmed: Claim[];
    falsified: Claim[];
    countsConsistent: boolean;
  } {
    const all = this.list();
    const byStatus = Object.fromEntries(
      (["UNREVIEWED", "HYPOTHESIS", "SUPPORTED", "CONFIRMED", "PARTIALLY_CONFIRMED", "FALSIFIED"] as const).map(
        (s) => [s, all.filter((c) => c.status === s).length],
      ),
    ) as Record<ClaimStatus, number>;
    const confirmed = all.filter((c) => c.status === "CONFIRMED");
    const falsified = all.filter((c) => c.status === "FALSIFIED");
    const statusSum = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return { total: all.length, byStatus, confirmed, falsified, countsConsistent: statusSum === all.length };
  }

  /**
   * Pre-flight consistency checks run before synthesis. Returns a list of
   * violations; an empty list means the report is internally consistent.
   */
  checkConsistency(): string[] {
    const violations: string[] = [];
    const all = this.list();
    for (const claim of all) {
      const terminal = claim.status === "CONFIRMED" || claim.status === "PARTIALLY_CONFIRMED" || claim.status === "FALSIFIED";
      if (terminal && (claim.status === "CONFIRMED" || claim.status === "PARTIALLY_CONFIRMED") && claim.evidence.length === 0) {
        violations.push(`${claim.severity === "critical" || claim.severity === "high" ? "High/Critical" : "Claim"} ${claim.claimId} is ${claim.status} with no supporting evidence`);
      }
      if (claim.status === "FALSIFIED" && claim.counterevidence.length === 0 && claim.evidence.length === 0) {
        violations.push(`Claim ${claim.claimId} is FALSIFIED with no counter-evidence`);
      }
      if ((claim.status === "CONFIRMED" || claim.status === "PARTIALLY_CONFIRMED") && claim.counterevidence.length > 0) {
        violations.push(`Claim ${claim.claimId} is ${claim.status} but has unresolved counter-evidence`);
      }
    }
    const summary = this.summarize();
    if (!summary.countsConsistent) violations.push("Status counts do not sum to total claims");
    return violations;
  }
}

/** Significant, non-trivial lowercase tokens of a statement (for fuzzy match). */
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "of", "in", "to", "for", "on", "with",
  "and", "or", "as", "at", "by", "it", "this", "that", "from", "not", "but", "be",
]);

const significantTokens = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[\s=]+/)) {
    const token = raw.replace(/[^a-z0-9\-]/g, "");
    if (token.length > 2 && !STOPWORDS.has(token)) out.add(token);
  }
  return out;
};

/** Deterministic claim ID from the normalized statement. */
function claimIdFor(statement: string, commit?: string): string {
  const normalized = statement.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const statementHash = (h >>> 0).toString(16).padStart(8, "0");
  return commit ? `claim-${statementHash}-${commit.slice(0, 8)}` : `claim-${statementHash}`;
}
