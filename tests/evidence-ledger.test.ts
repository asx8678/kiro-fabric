import { describe, expect, it } from "vitest";
import { EvidenceLedger, EvidenceLedgerError } from "../src/core/evidence-ledger.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempLedger = () => EvidenceLedger.open(mkdtempSync(join(tmpdir(), "evidence-ledger-test-")));

describe("EvidenceLedger", () => {
  it("submits a claim and assigns a deterministic id keyed to statement+commit", () => {
    const ledger = tempLedger();
    const claim = ledger.submit({
      statement: "proposal_created warnings are production analytics loss",
      commit: "abc123",
      confidence: "high",
    });
    expect(claim.status).toBe("UNREVIEWED");
    expect(claim.claimId).toMatch(/^claim-[0-9a-f]{8}-abc123$/);

    // Same statement+commit => identical id, no duplicate.
    const again = ledger.submit({
      statement: "proposal_created warnings are production analytics loss",
      commit: "abc123",
    });
    expect(again.claimId).toBe(claim.claimId);
    expect(ledger.list()).toHaveLength(1);
  });

  it("walks the falsification lifecycle and requires SUPPORTED before CONFIRMED", () => {
    const ledger = tempLedger();
    const claim = ledger.submit({ statement: "X is a defect", commit: "c1" });
    ledger.hypothesize(claim.claimId, "agent-1");
    expect(() => ledger.transition(claim.claimId, "CONFIRMED")).toThrow(EvidenceLedgerError);
    ledger.support(claim.claimId, "agent-verifier", [{ ref: "test/x_test.exs", detail: "1-20" }]);
    expect(() => ledger.transition(claim.claimId, "CONFIRMED")).not.toThrow();
    expect(ledger.get(claim.claimId)?.status).toBe("CONFIRMED");
  });

  it("falsifies a claim with counter-evidence and surfaces it via findSimilar", () => {
    const ledger = tempLedger();
    const claim = ledger.submit({ statement: "ProductEvents warnings = analytics loss", commit: "abc123" });
    ledger.hypothesize(claim.claimId, "agent-1");
    ledger.falsify(
      claim.claimId,
      "agent-verifier-2",
      [{ ref: "test/product_events_test.exs", detail: "113-143" }],
      "intentional negative-test noise",
    );
    expect(ledger.get(claim.claimId)?.status).toBe("FALSIFIED");

    // A later agent about to re-open the investigation sees the prior falsification.
    const prior = ledger.findSimilar("productevents warnings are analytics loss");
    expect(prior).toHaveLength(1);
    expect(prior[0]!.status).toBe("FALSIFIED");
  });

  it("computes report tallies programmatically and stays internally consistent", () => {
    const ledger = tempLedger();
    const a = ledger.submit({ statement: "a", commit: "c1" });
    const b = ledger.submit({ statement: "b", commit: "c1" });
    const c = ledger.submit({ statement: "c", commit: "c1" });
    ledger.hypothesize(a.claimId); ledger.support(a.claimId, "v", [{ ref: "f" }]); ledger.transition(a.claimId, "CONFIRMED", { evidence: [{ ref: "f" }] });
    ledger.hypothesize(b.claimId); ledger.support(b.claimId, "v"); ledger.falsify(b.claimId, "v", [{ ref: "f" }]);
    // c stays UNREVIEWED.

    const summary = ledger.summarize();
    expect(summary.total).toBe(3);
    expect(summary.byStatus.CONFIRMED).toBe(1);
    expect(summary.byStatus.FALSIFIED).toBe(1);
    expect(summary.byStatus.UNREVIEWED).toBe(1);
    expect(summary.countsConsistent).toBe(true);
    expect(summary.confirmed.map((x) => x.statement)).toEqual(["a"]);
    expect(ledger.checkConsistency()).toEqual([]);
  });

  it("flags a CONFIRMED high-severity claim that carries no evidence", () => {
    const ledger = tempLedger();
    const claim = ledger.submit({
      statement: "critical defect",
      commit: "c1",
      severity: "high",
      evidenceLevel: "assertion",
    });
    ledger.hypothesize(claim.claimId);
    ledger.support(claim.claimId, "v", []);
    ledger.transition(claim.claimId, "CONFIRMED");
    // support() appended no evidence, so the claim is CONFIRMED without evidence.
    expect(ledger.get(claim.claimId)?.evidence).toEqual([]);
    const violations = ledger.checkConsistency();
    expect(violations.some((v) => v.includes(claim.claimId))).toBe(true);
  });

  it("persists and replays the journal", () => {
    const dir = mkdtempSync(join(tmpdir(), "evidence-ledger-persist-"));
    const first = EvidenceLedger.open(dir);
    const claim = first.submit({ statement: "persisted claim", commit: "p1" });
    first.hypothesize(claim.claimId);
    first.support(claim.claimId, "v", [{ ref: "rev" }]);
    first.transition(claim.claimId, "CONFIRMED");

    const second = EvidenceLedger.open(dir);
    expect(second.get(claim.claimId)?.status).toBe("CONFIRMED");
    expect(second.get(claim.claimId)?.evidence).toHaveLength(1);
  });
});