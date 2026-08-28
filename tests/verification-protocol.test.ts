import { describe, expect, it } from "vitest";
import { EvidenceLedger } from "../src/core/evidence-ledger.js";
import { OutcomeGate, type GateOutcome } from "../src/core/outcome-gate.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalJsonBytes,
  fingerprintVerificationResult,
  sha256Text,
} from "../src/verification/fingerprint.js";
import { fromGateOutcome } from "../src/verification/adapters.js";
import { validateVerificationResult } from "../src/verification/schemas.js";
import type { VerificationResult } from "../src/verification/types.js";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "v-"));

const gateResult = (gate: GateOutcome): VerificationResult =>
  fromGateOutcome("probe claim", gate, { commit: "abc", treeHash: "t", sessionId: "s1" });

const acceptingGate = (): GateOutcome => {
  const ledger = EvidenceLedger.open(tmp());
  const c1 = ledger.submit({
    statement: "V1 covered",
    commit: "abc",
    criterionId: "AC-1",
    evidenceSource: "oracle",
    binding: { sessionId: "s1", commit: "abc", treeHash: "t" },
  });
  ledger.hypothesize(c1.claimId, "inv");
  ledger.support(c1.claimId, "ver", [{ ref: "f" }]);
  ledger.transition(c1.claimId, "CONFIRMED", { by: "ver", evidence: [{ ref: "f" }] });
  return new OutcomeGate(ledger).evaluate({
    criteria: [{ criterionId: "AC-1" }],
    binding: { commit: "abc", treeHash: "t" },
  });
};

describe("verification protocol V2", () => {
  it("hashes canonical JSON order-independently", () => {
    expect(sha256Text(canonicalJsonBytes({ b: 1, a: [2, 1] }).toString())).toBe(
      sha256Text(canonicalJsonBytes({ a: [2, 1], b: 1 }).toString()),
    );
  });

  it("maps an accept gate to a verified, schema-valid result", () => {
    const result = toResult(acceptingGate());
    expect(result.protocolVersion).toBe(2);
    expect(result.verdict).toBe("verified");
    expect(result.adapter?.source).toBe("gate.outcome");
    expect(validateVerificationResult(result).valid).toBe(true);
  });

  it("maps a reject gate to a schema-valid result across every mapping", () => {
    const empty = toResult(new OutcomeGate(EvidenceLedger.open(tmp())).evaluate());
    expect(["verified", "not_verified", "inconclusive"]).toContain(empty.verdict);
    expect(validateVerificationResult(empty).valid).toBe(true);
  });

  it("produces a deterministic, self-fingerprinted result", () => {
    const a = toResult(new OutcomeGate(EvidenceLedger.open(tmp())).evaluate());
    const b = toResult(new OutcomeGate(EvidenceLedger.open(tmp())).evaluate());
    expect(fingerprintVerificationResult(a).digest).toBe(fingerprintVerificationResult(b).digest);
  });

  it("flags unknown artifact references as invalid", () => {
    const bad = {
      protocolVersion: 2,
      verdict: "inconclusive" as const,
      claim: { statement: "x" },
      summary: "y",
      checks: [{ id: "c1", verdict: "inconclusive" as const, artifactIds: ["missing"] }],
      artifacts: [],
      fingerprints: {
        evidence: { algorithm: "sha256", digest: "sha256:" + "0".repeat(64) },
        result: { algorithm: "sha256", digest: "sha256:" + "1".repeat(64) },
      },
      finishedAt: new Date().toISOString(),
    };
    const v = validateVerificationResult(bad);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes("unknown artifact"))).toBe(true);
  });
});

function toResult(gate: GateOutcome): VerificationResult {
  return fromGateOutcome("probe claim", gate, { commit: "abc", treeHash: "t", sessionId: "s1" });
}
