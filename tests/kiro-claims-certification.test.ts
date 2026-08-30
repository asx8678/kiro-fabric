import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error The executable certification harness is dependency-free JavaScript.
import { claimsFromDoctorReport, lifecycleClaims, main } from "../scripts/certify-kiro-claims.mjs";
import { buildNativeKiroFixture } from "./helpers/native-kiro-fixture.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const passingDoctor = () => ({
  kind: "kiro-fabric.kiro-doctor",
  schemaVersion: 1,
  ok: true,
  nonBillable: true,
  modelTurnsRequested: 0,
  checks: [
    "tuple",
    "profile.shape",
    "profile.validate",
    "profile.negative-control",
    "mcp.initialize",
    "mcp.tools-list",
    "mcp.fabric-exec",
    "acp.initialize",
    "acp.session-new",
    "acp.no-prompt",
    "acp.shutdown",
  ].map((id) => ({ id, status: "pass", durationMs: 0, message: "ok" })),
  summary: { passed: 11, failed: 0, skipped: 0 },
});

const byId = (claims: Array<{ id: string; status: string }>, id: string) =>
  claims.find((claim) => claim.id === id);

describe("Kiro claims certification aggregation", () => {
  it("maps explicit passing doctor checks to all doctor and MCP claims", () => {
    const claims = claimsFromDoctorReport(passingDoctor());
    expect(claims).toHaveLength(7);
    expect(claims.every((claim: { status: string }) => claim.status === "pass")).toBe(true);
    expect(byId(claims, "doctor.non-billable")).toMatchObject({
      evidence: { nonBillable: true, modelTurnsRequested: 0 },
    });
  });

  it("does not infer tuple or profile success from non-billable metadata", () => {
    const report = passingDoctor();
    report.checks = report.checks.filter((check) => check.id !== "tuple");
    report.checks.find((check) => check.id === "profile.validate")!.status = "fail";
    report.ok = false;
    report.summary = { passed: 9, failed: 1, skipped: 0 };
    const claims = claimsFromDoctorReport(report);
    expect(byId(claims, "doctor.supported-tuple")?.status).toBe("fail");
    expect(byId(claims, "doctor.profile-validation")?.status).toBe("fail");
  });

  it("rejects contradictory and malformed doctor reports", () => {
    const contradictory = passingDoctor();
    contradictory.ok = false;
    expect(byId(claimsFromDoctorReport(contradictory), "doctor.non-billable")?.status).toBe("fail");
    expect(claimsFromDoctorReport({ ok: true }).every(
      (claim: { status: string }) => claim.status === "fail",
    )).toBe(true);
  });

  it("rejects an output artifact inside the checkout before running probes", () => {
    expect(() => main(["--json", ".claims-self-invalidating.json"])).toThrow(
      /must point outside the checkout/,
    );
  });

  it("executes managed install, closure, ownership, sibling, and idempotency probes", () => {
    const directory = mkdtempSync(join(tmpdir(), "kiro-claims-harness-test-"));
    const wrapper = buildNativeKiroFixture(directory);
    try {
      const claims = lifecycleClaims(wrapper);
      expect(claims.map((claim: { id: string }) => claim.id)).toEqual([
        "install.managed-profile",
        "install.runtime-closure",
        "uninstall.hash-owned",
        "uninstall.preserves-siblings",
        "uninstall.idempotent",
      ]);
      expect(claims.every((claim: { status: string }) => claim.status === "pass")).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
