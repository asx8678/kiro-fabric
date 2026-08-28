import { describe, expect, it } from "vitest";
import {
  REQUIRED_KIRO_CLAIMS,
  buildKiroClaimsReport,
  fail,
  isKiroClaimsReport,
  pass,
  skipped,
} from "../src/kiro/claims.js";

describe("Kiro executable-claims contract (V3)", () => {
  it("marks ok only when every required claim passes", () => {
    const full = REQUIRED_KIRO_CLAIMS.map((id) => pass(
      id,
      id.split(".")[0] as never,
      id === "doctor.non-billable" ? { nonBillable: true, modelTurnsRequested: 0 } : {},
    ));
    const report = buildKiroClaimsReport(full);
    expect(report.ok).toBe(true);
    expect(report.summary.passed).toBe(REQUIRED_KIRO_CLAIMS.length);
    expect(report.nonBillable).toBe(true);
    expect(report.modelTurnsRequested).toBe(0);
  });

  it("is not ok when any required claim is skipped", () => {
    const claims = REQUIRED_KIRO_CLAIMS.map((id) =>
      id.endsWith(".non-billable") ? skipped(id, "doctor") : pass(id, surface(id)),
    );
    expect(buildKiroClaimsReport(claims).ok).toBe(false);
  });

  it("is not ok when any claim fails", () => {
    const claims = REQUIRED_KIRO_CLAIMS.map((id) =>
      id === "mcp.golden-schema" ? fail(id, "mcp", "schema mismatch") : pass(id, id.split(".")[0] as never),
    );
    const report = buildKiroClaimsReport(claims);
    expect(report.ok).toBe(false);
    expect(report.summary.failed).toBe(1);
  });

  it("presents report furniture deterministically", () => {
    const report = buildKiroClaimsReport([pass("pack.contents", "pack", { n: 1 })]);
    expect(report.kind).toBe("kiro-fabric.kiro-claims");
    expect(report.schemaVersion).toBe(1);
    expect(report.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(report.claims)).toBe(true);
  });

  it("fail wins over a prior weaker duplicate", () => {
    const report = buildKiroClaimsReport([
      pass("doctor.non-billable", "doctor"),
      fail("doctor.non-billable", "doctor", "mismatch"),
    ]);
    expect(report.summary.failed).toBe(1);
    expect(report.ok).toBe(false);
  });

  it("validates the complete derived report contract from untrusted input", () => {
    const report = buildKiroClaimsReport(
      REQUIRED_KIRO_CLAIMS.map((id) => pass(
        id,
        surface(id),
        id === "doctor.non-billable" ? { nonBillable: true, modelTurnsRequested: 0 } : {},
      )),
    );
    expect(isKiroClaimsReport(report)).toBe(true);
    expect(isKiroClaimsReport({ ...report, summary: { ...report.summary, passed: 0 } })).toBe(false);
    expect(isKiroClaimsReport({ ...report, claims: [...report.claims, report.claims[0]] })).toBe(false);
    expect(isKiroClaimsReport({
      ...report,
      claims: report.claims.map((claim) => claim.id === "doctor.non-billable"
        ? { ...claim, evidence: { nonBillable: true, modelTurnsRequested: 1 } }
        : claim),
    })).toBe(false);
  });
});

function surface(id: string): "pack" | "doctor" | "install" | "mcp" | "uninstall" {
  const p = id.split(".")[0] as "pack" | "doctor" | "install" | "mcp" | "uninstall";
  return p;
}
