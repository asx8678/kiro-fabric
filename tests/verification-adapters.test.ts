import { describe, expect, it } from "vitest";
import {
  buildKiroClaimsReport,
  fail as failKiroClaim,
  pass as passKiroClaim,
  REQUIRED_KIRO_CLAIMS,
  skipped as skipKiroClaim,
  type KiroClaimId,
  type KiroClaimSurface,
} from "../src/kiro/claims.js";
import { composeKiroSemanticHandoff } from "../src/kiro/handoff.js";
import { validateVerificationResult } from "../src/verification/schemas.js";
import {
  fromBenchmarkReport,
  fromCertificationReport,
  fromHandoffReport,
  fromKiroClaimsReport,
  fromSchemaVerificationReport,
  fromStateVerificationReport,
} from "../src/verification/adapters.js";
// @ts-expect-error The real benchmark producer is dependency-free JavaScript used directly by Node.
import { summarizeBenchmark } from "../scripts/certification/rpc-lib.mjs";

const assertValid = (result: ReturnType<typeof fromStateVerificationReport>) => {
  expect(validateVerificationResult(result).valid).toBe(true);
  expect(result.fingerprints.result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
};

const claimSurface = (id: KiroClaimId): KiroClaimSurface =>
  id.slice(0, id.indexOf(".")) as KiroClaimSurface;

const passingKiroClaimsReport = () => buildKiroClaimsReport(
  REQUIRED_KIRO_CLAIMS.map((id) => passKiroClaim(
    id,
    claimSurface(id),
    id === "doctor.non-billable" ? { nonBillable: true, modelTurnsRequested: 0 } : {},
  )),
);

const realResumeBenchmarkReport = (maxUsd = 1) => summarizeBenchmark([
  { repeat: 1, variant: "baseline", oracle: { passed: false }, tokens: 10, costUsd: 0.1, toolCalls: 1, recallCalls: 0, wallMs: 10 },
  { repeat: 1, variant: "fabric", oracle: { passed: true }, tokens: 8, costUsd: 0.08, toolCalls: 2, recallCalls: 1, wallMs: 9 },
  { repeat: 1, variant: "pi-vcc", oracle: { passed: false }, tokens: 11, costUsd: 0.05, toolCalls: 1, recallCalls: 0, wallMs: 11 },
  { repeat: 2, variant: "pi-vcc", oracle: { passed: true }, tokens: 6, costUsd: 0.06, toolCalls: 1, recallCalls: 0, wallMs: 6 },
  { repeat: 2, variant: "fabric", oracle: { passed: true }, tokens: 7, costUsd: 0.07, toolCalls: 1, recallCalls: 0, wallMs: 7 },
  { repeat: 2, variant: "baseline", oracle: { passed: true }, tokens: 9, costUsd: 0.09, toolCalls: 1, recallCalls: 0, wallMs: 8 },
], [["baseline", "fabric", "pi-vcc"], ["pi-vcc", "fabric", "baseline"]], maxUsd);

describe("verification report adapters", () => {
  it("maps a fully certified state report to verified", () => {
    const result = fromStateVerificationReport({
      certified: true,
      violated: false,
      results: [{ claim: "state is valid", status: "confirmed" }],
      failures: [],
    });
    assertValid(result);
    expect(result.verdict).toBe("verified");
  });

  it("does not turn state execution errors into success", () => {
    const result = fromStateVerificationReport({
      certified: false,
      violated: false,
      results: [{ claim: "probe", status: "error" }],
      failures: [{ reason: "execution-error" }],
    });
    assertValid(result);
    expect(result.verdict).toBe("inconclusive");
  });

  it("maps schema evidence and certificates without exposing the token", () => {
    const result = fromSchemaVerificationReport({
      verified: true,
      results: [{ status: "confirmed", detail: "exists" }],
      certificate: "secret-token",
    });
    assertValid(result);
    expect(result.verdict).toBe("verified");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("keeps skipped Kiro claims inconclusive", () => {
    const report = buildKiroClaimsReport(REQUIRED_KIRO_CLAIMS.map((id) =>
      id === "mcp.initialize"
        ? skipKiroClaim(id, claimSurface(id))
        : passKiroClaim(
            id,
            claimSurface(id),
            id === "doctor.non-billable" ? { nonBillable: true, modelTurnsRequested: 0 } : {},
          )));
    const result = fromKiroClaimsReport(report);
    assertValid(result);
    expect(result.verdict).toBe("inconclusive");
  });

  it("maps failed certification and a measured threshold miss to not_verified", () => {
    const certification = fromCertificationReport({ ok: false, checks: [{ id: "pack", status: "fail" }] });
    const benchmark = fromBenchmarkReport(realResumeBenchmarkReport(), {
      variant: "baseline",
      minimumPassRate: 0.75,
    });
    assertValid(certification);
    assertValid(benchmark);
    expect(certification.verdict).toBe("not_verified");
    expect(benchmark.verdict).toBe("not_verified");
  });

  it("never certifies an empty state report", () => {
    const result = fromStateVerificationReport({ certified: true, violated: false, results: [], failures: [] });
    assertValid(result);
    expect(result.verdict).toBe("inconclusive");
  });

  it("ignores arbitrary self-reported benchmark flags", () => {
    for (const fabricated of [
      fromBenchmarkReport({ ok: true }, { variant: "fabric", minimumPassRate: 1 }),
      fromBenchmarkReport({ passed: true }, { variant: "fabric", minimumPassRate: 1 }),
      fromBenchmarkReport({ gate: "pass" }, { variant: "fabric", minimumPassRate: 1 }),
      fromBenchmarkReport({ gate: "fail" }, { variant: "fabric", minimumPassRate: 1 }),
    ]) {
      assertValid(fabricated);
      expect(fabricated.verdict).toBe("inconclusive");
    }
  });

  it("accepts the real resume benchmark producer and recomputes its threshold", () => {
    const measured = fromBenchmarkReport(realResumeBenchmarkReport(), {
      variant: "fabric",
      minimumPassRate: 1,
    });
    assertValid(measured);
    expect(measured.verdict).toBe("verified");
    expect(measured.checks.find((check) => check.id === "benchmark.variant-pass-rate")).toMatchObject({
      expected: 1,
      observed: 1,
    });

    // The producer checks the budget before starting each arm, so its final
    // in-flight arm may legitimately cross the configured stop boundary.
    expect(fromBenchmarkReport(realResumeBenchmarkReport(0.4), {
      variant: "fabric",
      minimumPassRate: 1,
    }).verdict).toBe("verified");
  });

  it("rejects malformed, non-finite, or internally inconsistent benchmark evidence", () => {
    const inconsistent = structuredClone(realResumeBenchmarkReport());
    inconsistent.variants.fabric.successes = 0;
    const nonFinite = structuredClone(realResumeBenchmarkReport());
    nonFinite.runs[0].costUsd = Number.NaN;
    const costlyRuns = structuredClone(realResumeBenchmarkReport().runs);
    costlyRuns[2].costUsd = 0.5;
    const interleaved = summarizeBenchmark(
      costlyRuns,
      [["baseline", "fabric", "pi-vcc"], ["pi-vcc", "fabric", "baseline"]],
      0.45,
    );
    // Preserve each repeat's filtered order while moving the expensive final
    // arm of repeat 1 to the global final slot. A producer cannot emit this:
    // it would have crossed the stop boundary before starting repeat 2.
    interleaved.runs = [
      costlyRuns[0],
      costlyRuns[1],
      costlyRuns[3],
      costlyRuns[4],
      costlyRuns[5],
      costlyRuns[2],
    ];
    const adversarial = [
      { gate: "pass", samples: [null], lowerBound: 2 },
      { gate: "pass", samples: [{ singleMs: Number.NaN, batchMs: 20 }] },
      inconsistent,
      nonFinite,
      interleaved,
      // This fabricated report claims later runs after the producer would have
      // stopped at its already-exhausted budget.
      realResumeBenchmarkReport(0.2),
    ];
    for (const report of adversarial) {
      const result = fromBenchmarkReport(report, { variant: "fabric", minimumPassRate: 1 });
      assertValid(result);
      expect(result.verdict).toBe("inconclusive");
    }
  });

  it("requires an explicit valid benchmark criterion", () => {
    const report = realResumeBenchmarkReport();
    expect(fromBenchmarkReport(report).verdict).toBe("inconclusive");
    expect(fromBenchmarkReport(report, { variant: "missing", minimumPassRate: 1 }).verdict).toBe("inconclusive");
    expect(fromBenchmarkReport(report, { variant: "fabric", minimumPassRate: Number.NaN }).verdict).toBe("inconclusive");
  });

  it("requires the complete canonical Kiro claims contract", () => {
    const cleanReport = passingKiroClaimsReport();
    const clean = fromKiroClaimsReport(cleanReport);
    assertValid(clean);
    expect(clean.verdict).toBe("verified");

    const invalidReports = [
      { ok: true, claims: cleanReport.claims },
      { ...cleanReport, kind: "fabricated" },
      { ...cleanReport, schemaVersion: 999 },
      { ...cleanReport, nonBillable: undefined },
      { ...cleanReport, nonBillable: false },
      { ...cleanReport, modelTurnsRequested: undefined },
      { ...cleanReport, modelTurnsRequested: 1 },
      buildKiroClaimsReport(cleanReport.claims.slice(1)),
      { ...cleanReport, claims: [...cleanReport.claims.slice(0, -1), null] },
      { ...cleanReport, claims: [...cleanReport.claims.slice(0, -1), cleanReport.claims[0]] },
    ];
    for (const report of invalidReports) {
      const result = fromKiroClaimsReport(report);
      assertValid(result);
      expect(result.verdict).toBe("inconclusive");
    }
  });

  it("maps a canonical failed Kiro claim to not_verified", () => {
    const report = buildKiroClaimsReport(REQUIRED_KIRO_CLAIMS.map((id) =>
      id === "mcp.initialize"
        ? failKiroClaim(id, claimSurface(id), "probe failed")
        : passKiroClaim(
            id,
            claimSurface(id),
            id === "doctor.non-billable" ? { nonBillable: true, modelTurnsRequested: 0 } : {},
          )));
    const result = fromKiroClaimsReport(report);
    assertValid(result);
    expect(result.verdict).toBe("not_verified");
  });

  it("only certifies a canonical semantic handoff digest", () => {
    const handoff = composeKiroSemanticHandoff({
      runnerSessionId: "verification-adapter-test",
      objective: "Preserve verified context",
      facts: ["canonical digest"],
    });
    const semantic = fromHandoffReport(handoff);
    assertValid(semantic);
    expect(semantic.verdict).toBe("verified");
    const fabricated = fromHandoffReport({ fidelity: "semantic", digest: "a".repeat(64) });
    expect(fabricated.verdict).toBe("inconclusive");
    const replacement = handoff.digest.endsWith("0") ? "1" : "0";
    const corrupted = fromHandoffReport({ ...handoff, digest: `${handoff.digest.slice(0, -1)}${replacement}` });
    expect(corrupted.verdict).toBe("inconclusive");
    const native = fromHandoffReport({ fidelity: "native" });
    expect(native.verdict).toBe("inconclusive");
    const bare = fromHandoffReport({ valid: true });
    expect(bare.verdict).toBe("inconclusive");
  });

  it("gives explicit handoff failure and tamper flags precedence", () => {
    const handoff = composeKiroSemanticHandoff({ objective: "Preserve verified context" });
    const tampered = fromHandoffReport({ ...handoff, tampered: true });
    const invalid = fromHandoffReport({ ...handoff, valid: false });
    assertValid(tampered);
    expect(tampered.verdict).toBe("not_verified");
    expect(invalid.verdict).toBe("not_verified");
  });
});
