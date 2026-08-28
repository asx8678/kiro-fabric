import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Certification helpers are dependency-free JavaScript used directly by Node.
import { evaluateCertification } from "../scripts/certification/context-lib.mjs";
// @ts-expect-error Readiness report constants are dependency-free JavaScript used directly by Node.
import { REQUIRED_KIRO_CLAIM_IDS } from "../scripts/certification/readiness-reports.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = path.join(root, "scripts", "refresh-kiro-readiness.mjs");
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version as string;
const temporaryDirectories: string[] = [];

const temporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-readiness-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const run = (args: string[] = []): { status: number; report: any; stdout: string; stderr: string } => {
  const directory = temporaryDirectory();
  const out = path.join(directory, "readiness.json");
  const result = spawnSync(process.execPath, [script, "--output", out, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  const report = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    report,
  };
};

const writeReport = (report: unknown): string => {
  const file = path.join(temporaryDirectory(), "certificate.json");
  fs.writeFileSync(file, `${JSON.stringify(report)}\n`, "utf8");
  return file;
};

const currentBinding = () => run().report.identity.git;

const contextEvidence = () => ({
  context: {
    cycles: 100,
    eligibleCycleCount: 100,
    prepareUndefinedCount: 0,
    builtContextMismatchCount: 0,
    priorSummaryObservedCount: 99,
    priorSummaryFedAsInput: false,
    summaryBytes: Array.from({ length: 100 }, () => 8_000),
    maxSummaryBytes: 8_000,
    maximalMultibyte: { summaryBytes: 24_671, validUtf8: true },
    closureFixtureCounts: { normal: 1 },
    goalRetained: true,
    constraintsRetained: true,
    rareFactRetained: true,
    cumulativeAddressesValid: true,
    callResultSplitCount: 0,
    invalidFirstKeptCount: 0,
    poisonLeakCount: 0,
    poisonStoredCount: 100,
    byteMismatchCount: 0,
  },
  memory: {
    eligibleSessions: 1_001,
    coverageComplete: true,
    rareRecallExact: true,
    structuralRecallExact: true,
    structuralNegativeControl: true,
    rareSessionTier: "cold",
    addressExpansionRate: 1,
    integrityBoundExpansion: true,
  },
  continuation: {
    passRate: 1,
    addressesResolved: true,
    results: [],
  },
});

const contextReport = (identity: unknown, passed = true) => {
  const evidence = contextEvidence();
  if (!passed) evidence.context.goalRetained = false;
  return {
    kind: "kiro-fabric.context-certification",
    schemaVersion: 2,
    identity,
    deterministic: true,
    piApi: {
      version: "0.84.2",
      prepareCompactionPubliclyExported: false,
      prepareCompactionAccess: "resolved-installed-internal-module",
      buildContextEntriesPubliclyExported: false,
      buildSessionContextPubliclyExported: false,
      shouldCompactPubliclyExported: false,
    },
    ...evidence,
    evaluation: evaluateCertification(evidence),
    finishedAt: new Date().toISOString(),
  };
};

const claimsReport = (identity: unknown, passed = true) => {
  const claims = REQUIRED_KIRO_CLAIM_IDS.map((id: string, index: number) => {
    const surface = id.split(".")[0];
    return !passed && index === 0
      ? { id, surface, status: "fail", error: { code: "fixture-failure", message: "failed" } }
      : {
          id,
          surface,
          status: "pass",
          evidence: id === "doctor.non-billable" ? { nonBillable: true, modelTurnsRequested: 0 } : {},
        };
  });
  return {
    kind: "kiro-fabric.kiro-claims",
    schemaVersion: 1,
    identity,
    ok: passed,
    nonBillable: true,
    modelTurnsRequested: 0,
    claims,
    summary: { passed: passed ? claims.length : claims.length - 1, failed: passed ? 0 : 1, skipped: 0 },
    finishedAt: new Date().toISOString(),
  };
};

const releaseReport = (identity: unknown, passed = true) => ({
  kind: "kiro-fabric.release-a-certification",
  schemaVersion: 1,
  identity,
  ok: passed,
  package: `kiro-fabric@${packageVersion}`,
  ...(passed ? { tarball: `/tmp/kiro-fabric-${packageVersion}.tgz` } : {
    error: { code: "release-a-certification-failed", message: "failed" },
  }),
  checks: passed ? ["pack", "install", "doctor", "mcp", "uninstall"] : ["pack"],
  finishedAt: new Date().toISOString(),
});

const reportEntry = (report: any, id: string) => report.currentEvidence.reports.find(
  (entry: { id: string }) => entry.id === id,
);

describe("Kiro readiness generator", () => {
  it("emits a content-bound Git identity while preserving the v1 externalEvidence field", () => {
    const { report } = run();
    expect(report).toMatchObject({
      kind: "kiro-fabric.readiness",
      schemaVersion: 1,
      identity: {
        package: "kiro-fabric",
        git: {
          kind: "kiro-fabric.git-binding",
          schemaVersion: 1,
          dirty: expect.any(Boolean),
        },
      },
      externalEvidence: { status: "historical" },
      policy: { billableGatesExecuted: false, modelTurnsRequested: 0 },
    });
    expect(report.identity.head).toMatch(/^[a-f0-9]{40,64}$/);
    expect(report.identity.treeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.historical).toBeUndefined();
  });

  it("keeps omitted deterministic reports inconclusive and does not fail --check", () => {
    const { report, status } = run(["--check"]);
    expect(status).toBe(0);
    expect(report.currentEvidence.reports.every(
      (entry: { verdict: string; present: boolean; requested: boolean }) => entry.verdict === "not_run"
        && entry.present === false && entry.requested === false,
    )).toBe(true);
    expect(report.currentEvidence.status).toBe("inconclusive");
  });

  it("accepts producer-shaped reports only when every kind, schema, and Git binding matches", () => {
    const identity = currentBinding();
    const context = writeReport(contextReport(identity));
    const claims = writeReport(claimsReport(identity));
    const release = writeReport(releaseReport(identity));
    const { report, status } = run([
      "--check",
      "--context-report", context,
      "--claims-report", claims,
      "--release-report", release,
    ]);
    expect(status).toBe(0);
    expect(report.currentEvidence.reports.map((entry: { verdict: string }) => entry.verdict)).toEqual([
      "verified",
      "verified",
      "verified",
    ]);
  });

  it.each([
    ["wrong kind", (identity: unknown) => ({ ...contextReport(identity), kind: "kiro-fabric.release-a-certification" })],
    ["unbound", () => ({ ...contextReport(undefined), identity: undefined })],
    ["fabricated summary", (identity: unknown) => ({ ok: true, identity })],
  ])("rejects a %s context payload", (_name, makeReport) => {
    const file = writeReport(makeReport(currentBinding()));
    const { report, status } = run(["--check", "--context-report", file]);
    expect(status).not.toBe(0);
    expect(reportEntry(report, "cert.context")).toMatchObject({
      verdict: "inconclusive",
      reason: "invalid_report",
    });
  });

  it("marks a valid report with a different checkout binding stale", () => {
    const identity = currentBinding();
    identity.treeHash = `${identity.treeHash[0] === "a" ? "b" : "a"}${identity.treeHash.slice(1)}`;
    const file = writeReport(contextReport(identity));
    const { report, status } = run(["--check", "--context-report", file]);
    expect(status).not.toBe(0);
    expect(reportEntry(report, "cert.context")).toMatchObject({
      stale: true,
      verdict: "not_verified",
      reason: "stale_report",
    });
  });

  it.each([
    ["missing", () => path.join(temporaryDirectory(), "missing.json"), "missing_report"],
    ["unparseable", () => {
      const file = path.join(temporaryDirectory(), "bad.json");
      fs.writeFileSync(file, "{ not json", "utf8");
      return file;
    }, "unparseable_report"],
  ])("makes --check fail for an explicitly %s report", (_name, reportPath, reason) => {
    const { report, status } = run(["--check", "--context-report", reportPath()]);
    expect(status).not.toBe(0);
    expect(reportEntry(report, "cert.context")).toMatchObject({ verdict: "inconclusive", reason });
  });

  it.each([
    ["context", "--context-report", "cert.context", contextReport],
    ["claims", "--claims-report", "cert.kiro-claims", claimsReport],
    ["release", "--release-report", "cert.release-a", releaseReport],
  ])("maps an explicit failed %s certificate to not_verified", (_name, flag, id, makeReport) => {
    const file = writeReport(makeReport(currentBinding(), false));
    const { report, status } = run(["--check", flag, file]);
    expect(status).toBe(1);
    expect(reportEntry(report, id)).toMatchObject({
      verdict: "not_verified",
      reason: "certification_failed",
    });
  });

  it("rejects incomplete CLI arguments", () => {
    const result = spawnSync(process.execPath, [script, "--context-report"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--context-report requires a path");
  });

  it("rejects evidence paths inside the checkout before writing output", () => {
    const output = path.join(root, ".kiro-readiness-self-invalidating.json");
    const result = spawnSync(process.execPath, [script, "--output", output], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("must be outside the checkout");
    expect(fs.existsSync(output)).toBe(false);
  });
});
