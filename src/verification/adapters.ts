import type { GateOutcome } from "../core/outcome-gate.js";
import { isKiroClaimResult, isKiroClaimsReport } from "../kiro/claims.js";
import { isKiroSemanticHandoff } from "../kiro/handoff.js";
import {
  canonicalJsonBytes,
  fingerprintFor,
  fingerprintVerificationResult,
  sha256Digest,
} from "./fingerprint.js";
import type { VerificationArtifact, VerificationCheck, VerificationResult, VerificationVerdict } from "./types.js";

export interface VerificationAdapterOptions {
  statement?: string;
  criterionId?: string;
  startedAt?: string;
  finishedAt?: string;
  environment?: unknown;
}

export interface BenchmarkAdapterOptions extends VerificationAdapterOptions {
  /** Variant whose executable oracle pass rate is being asserted. */
  variant?: string;
  /** Inclusive pass-rate threshold in the range 0..1. */
  minimumPassRate?: number;
}

const digest = (value: unknown) => fingerprintFor(sha256Digest(canonicalJsonBytes(value)));

const artifact = (id: string, role: VerificationArtifact["role"], value: unknown, description: string): VerificationArtifact => ({
  id,
  role,
  digest: digest(value),
  retained: "digest_only",
  sensitive: true,
  description,
});

const fingerprintableArtifact = (
  id: string,
  role: VerificationArtifact["role"],
  value: unknown,
  description: string,
): VerificationArtifact | undefined => {
  try {
    return artifact(id, role, value, description);
  } catch {
    // Invalid adapter input may contain non-JSON values (NaN, bigint, cycles).
    // Such input is never allowed to verify and cannot truthfully be represented
    // by a canonical JSON digest, so omit the artifact instead of throwing.
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const finish = (
  statement: string,
  verdict: VerificationVerdict,
  summary: string,
  checks: VerificationCheck[],
  artifacts: VerificationArtifact[],
  source: NonNullable<VerificationResult["adapter"]>["source"],
  options: VerificationAdapterOptions = {},
): VerificationResult => {
  const evidence = digest({ verdict, checks, artifacts });
  const base: VerificationResult = {
    protocolVersion: 2,
    verdict,
    claim: {
      ...(options.criterionId ? { id: options.criterionId } : {}),
      statement,
    },
    summary,
    checks,
    artifacts,
    fingerprints: {
      ...(options.environment === undefined ? {} : { environment: digest(options.environment) }),
      evidence,
      result: fingerprintFor("0".repeat(64)),
    },
    ...(options.startedAt ? { startedAt: options.startedAt } : {}),
    finishedAt: options.finishedAt ?? new Date(0).toISOString(),
    adapter: { source, sourceVersion: "2" },
  };
  return { ...base, fingerprints: { ...base.fingerprints, result: fingerprintVerificationResult(base) } };
};

/** Maps an OutcomeGate decision into the host-neutral V2 result contract. */
export const fromGateOutcome = (
  claimStatement: string,
  gate: GateOutcome,
  evidence: { commit?: string; treeHash?: string; sessionId?: string },
  opts: { summary?: string; startedAt?: string } = {},
): VerificationResult => {
  const verdict: VerificationVerdict = gate.status === "accept" ? "verified" : gate.status === "reject" ? "not_verified" : "inconclusive";
  const checks: VerificationCheck[] = [
    { id: "outcome-gate.status", verdict, description: `Outcome gate ${gate.status}`, expected: "accept", observed: gate.status, artifactIds: [] },
    { id: "outcome-gate.criteria-covered", verdict: gate.missingCriterionIds.length === 0 ? "verified" : "inconclusive", observed: gate.missingCriterionIds, artifactIds: [] },
  ];
  return finish(claimStatement, verdict, opts.summary ?? `Outcome gate ${gate.status} over ${gate.capsule.totalClaims} claims`, checks, [], "gate.outcome", {
    ...(opts.startedAt ? { startedAt: opts.startedAt } : {}),
    environment: evidence,
  });
};

export interface StateVerificationReportLike {
  results?: readonly Record<string, unknown>[];
  certified?: boolean;
  violated?: boolean;
  failures?: readonly Record<string, unknown>[];
  reportingError?: string;
  evidenceDigest?: string;
  resultDigest?: string;
  certificate?: unknown;
}

export const fromStateVerificationReport = (report: StateVerificationReportLike, options: VerificationAdapterOptions = {}): VerificationResult => {
  const results = Array.isArray(report.results) ? report.results : [];
  const checks = results.map((item, index) => {
    const status = item.status === "confirmed" ? "verified" : item.status === "violated" ? "not_verified" : "inconclusive";
    return { id: `state.${index + 1}`, verdict: status as VerificationVerdict, description: String(item.claim ?? `state evidence ${index + 1}`), observed: item.status, artifactIds: [] };
  });
  const failures = Array.isArray(report.failures) ? report.failures : [];
  const verdict = report.violated || checks.some((c) => c.verdict === "not_verified")
    ? "not_verified"
    : report.certified && checks.length > 0 && failures.length === 0 && !report.reportingError && checks.every((c) => c.verdict === "verified")
      ? "verified"
      : "inconclusive";
  const artifacts = report.certificate === undefined ? [] : [artifact("state.certificate", "certificate", report.certificate, "State certificate digest")];
  return finish(options.statement ?? "Configured state evidence verifies the selected state transitions", verdict, `State verification ${verdict}`, checks, artifacts, "state.verify", { ...options, environment: { evidenceDigest: report.evidenceDigest, resultDigest: report.resultDigest } });
};

export interface SchemaVerificationReportLike {
  verified?: boolean;
  results?: readonly Record<string, unknown>[];
  certificate?: unknown;
  reason?: string;
}

export const fromSchemaVerificationReport = (report: SchemaVerificationReportLike, options: VerificationAdapterOptions = {}): VerificationResult => {
  const results = Array.isArray(report.results) ? report.results : [];
  const checks = results.map((item, index) => ({
    id: `schema.${index + 1}`,
    verdict: (item.status === "confirmed" ? "verified" : item.status === "nonconfirmed" ? "not_verified" : "inconclusive") as VerificationVerdict,
    description: String(item.detail ?? `schema evidence ${index + 1}`), observed: item.status, artifactIds: [],
  }));
  const verdict = !results.length || checks.some((c) => c.verdict === "not_verified") ? "not_verified" : report.verified && checks.every((c) => c.verdict === "verified") ? "verified" : "inconclusive";
  const artifacts = report.certificate === undefined ? [] : [artifact("schema.certificate", "certificate", report.certificate, "Schema certificate digest")];
  return finish(options.statement ?? "Schema evidence verifies the proposed mutation", verdict, report.reason ?? `Schema verification ${verdict}`, checks, artifacts, "schema.verify", options);
};

export const fromCertificationReport = (report: unknown, options: VerificationAdapterOptions = {}): VerificationResult => {
  const value = report && typeof report === "object" ? report as Record<string, unknown> : {};
  const raw = Array.isArray(value.checks) ? value.checks : Array.isArray(value.evaluations) ? value.evaluations : [];
  const checks = raw.map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const ok = row.ok === true || row.status === "pass" || row.passed === true;
    const failed = row.status === "fail" || row.ok === false || row.passed === false;
    return { id: String(row.id ?? `certification.${index + 1}`), verdict: failed ? "not_verified" : ok ? "verified" : "inconclusive", description: String(row.description ?? row.message ?? "certification check"), observed: row.status ?? row.ok, artifactIds: [] } as VerificationCheck;
  });
  const available = raw.length > 0;
  const verdict = value.ok === true && available && checks.every((c) => c.verdict === "verified") ? "verified" : checks.some((c) => c.verdict === "not_verified") || value.ok === false ? "not_verified" : "inconclusive";
  return finish(options.statement ?? "The certification checks pass", verdict, `Certification ${verdict}`, checks, [artifact("certification.report", "test_report", report, "Certification report digest")], "certification", options);
};

export const fromKiroClaimsReport = (report: unknown, options: VerificationAdapterOptions = {}): VerificationResult => {
  const value = isRecord(report) ? report : {};
  const claims: readonly unknown[] = Array.isArray(value.claims) ? value.claims : [];
  const checks = claims.map((item, index) => {
    const row = isRecord(item) ? item : {};
    const wellFormed = isKiroClaimResult(item);
    const verdict: VerificationVerdict = !wellFormed
      ? "inconclusive"
      : row.status === "pass"
        ? "verified"
        : row.status === "fail"
          ? "not_verified"
          : "inconclusive";
    return {
      id: `kiro.claim.${index + 1}`,
      verdict,
      description: wellFormed ? `Kiro claim ${String(row.id)}` : "Malformed Kiro claim row",
      observed: typeof row.status === "string" ? row.status : "malformed",
      artifactIds: [],
    } satisfies VerificationCheck;
  });
  const contractValid = isKiroClaimsReport(report);
  const contractCheck: VerificationCheck = {
    id: "kiro.claims.contract",
    verdict: contractValid ? "verified" : "inconclusive",
    description: "Canonical Kiro claims kind, schema, non-billable policy, and required claim set",
    observed: contractValid ? "valid" : "invalid",
    artifactIds: [],
  };
  const verdict = !contractValid
    ? "inconclusive"
    : checks.some((check) => check.verdict === "not_verified")
      ? "not_verified"
      : checks.every((check) => check.verdict === "verified")
        ? "verified"
        : "inconclusive";
  const reportArtifact = fingerprintableArtifact("kiro.claims.report", "test_report", report, "Kiro claims report digest");
  return finish(
    options.statement ?? "The Kiro executable claims pass",
    verdict,
    `Kiro claims ${verdict}`,
    [contractCheck, ...checks],
    reportArtifact ? [reportArtifact] : [],
    "kiro.claims",
    options,
  );
};

interface RealResumeBenchmarkRun {
  repeat: number;
  variant: string;
  oracle: { passed: boolean };
  tokens: number;
  costUsd: number;
  toolCalls: number;
  recallCalls: number;
  wallMs: number;
}

interface RealResumeBenchmarkReport {
  runs: RealResumeBenchmarkRun[];
}

const realResumeVariants = ["baseline", "fabric", "pi-vcc"] as const;

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  isFiniteNonNegative(value) && Number.isInteger(value);

const nearlyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Number.EPSILON * 16 * Math.max(1, Math.abs(left), Math.abs(right));

const wilsonInterval = (successes: number, total: number): { low: number; high: number } => {
  if (total === 0) return { low: 0, high: 1 };
  const z = 1.959963984540054;
  const rate = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (rate + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((rate * (1 - rate) + z2 / (4 * total)) / total) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
};

const isRealResumeBenchmarkRun = (value: unknown): value is RealResumeBenchmarkRun =>
  isRecord(value)
  && Number.isInteger(value.repeat)
  && (value.repeat as number) > 0
  && typeof value.variant === "string"
  && value.variant.length > 0
  && isRecord(value.oracle)
  && typeof value.oracle.passed === "boolean"
  && isNonNegativeInteger(value.tokens)
  && isFiniteNonNegative(value.costUsd)
  && isNonNegativeInteger(value.toolCalls)
  && isNonNegativeInteger(value.recallCalls)
  && isNonNegativeInteger(value.wallMs);

const validVariantSummary = (
  summary: unknown,
  runs: readonly RealResumeBenchmarkRun[],
): boolean => {
  if (!isRecord(summary) || runs.length === 0) return false;
  const successes = runs.filter((run) => run.oracle.passed).length;
  const passRate = successes / runs.length;
  const interval = wilsonInterval(successes, runs.length);
  const sum = (field: "tokens" | "costUsd" | "toolCalls" | "recallCalls" | "wallMs") =>
    runs.reduce((total, run) => total + run[field], 0);
  return summary.runs === runs.length
    && summary.successes === successes
    && typeof summary.passRate === "number"
    && nearlyEqual(summary.passRate, passRate)
    && isRecord(summary.passRate95)
    && typeof summary.passRate95.low === "number"
    && typeof summary.passRate95.high === "number"
    && nearlyEqual(summary.passRate95.low, interval.low)
    && nearlyEqual(summary.passRate95.high, interval.high)
    && summary.tokens === sum("tokens")
    && typeof summary.costUsd === "number"
    && nearlyEqual(summary.costUsd, sum("costUsd"))
    && summary.toolCalls === sum("toolCalls")
    && summary.recallCalls === sum("recallCalls")
    && summary.wallMs === sum("wallMs");
};

const validPairedRate = (value: unknown): value is { leftWins: number; rightWins: number; ties: number } =>
  isRecord(value)
  && isNonNegativeInteger(value.leftWins)
  && isNonNegativeInteger(value.rightWins)
  && isNonNegativeInteger(value.ties);

const parseRealResumeBenchmarkReport = (value: unknown): RealResumeBenchmarkReport | undefined => {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.generatedAt !== "string"
    || !Number.isFinite(Date.parse(value.generatedAt))
    || !Array.isArray(value.runs)
    || value.runs.length === 0
    || !value.runs.every(isRealResumeBenchmarkRun)
    || !Array.isArray(value.randomizedOrders)
    || !isRecord(value.budget)
    || !isFiniteNonNegative(value.budget.maxUsd)
    || value.budget.maxUsd <= 0
    || !isFiniteNonNegative(value.budget.observedUsd)
    || !isRecord(value.variants)
    || !isRecord(value.pairedRates)
  ) {
    return undefined;
  }

  const runs = value.runs as RealResumeBenchmarkRun[];
  const variants = value.variants;
  const variantNames = [...new Set(runs.map((run) => run.variant))];
  const costBeforeFinalRun = runs.slice(0, -1).reduce((total, run) => total + run.costUsd, 0);
  if (
    variantNames.length !== realResumeVariants.length
    || !realResumeVariants.every((variant) => variantNames.includes(variant))
    || Object.keys(variants).length !== variantNames.length
    || !variantNames.every((variant) => validVariantSummary(variants[variant], runs.filter((run) => run.variant === variant)))
    || !nearlyEqual(value.budget.observedUsd, runs.reduce((total, run) => total + run.costUsd, 0))
    || costBeforeFinalRun >= value.budget.maxUsd
  ) {
    return undefined;
  }

  const orders = value.randomizedOrders as unknown[];
  if (orders.length === 0) return undefined;
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    if (
      !Array.isArray(order)
      || order.length !== variantNames.length
      || !order.every((variant): variant is string => typeof variant === "string")
      || new Set(order).size !== order.length
      || !variantNames.every((variant) => order.includes(variant))
    ) {
      return undefined;
    }
  }
  const expectedRunOrder = orders.flatMap((order, index) =>
    (order as string[]).map((variant) => ({ repeat: index + 1, variant })));
  if (
    runs.length !== expectedRunOrder.length
    || runs.some((run, index) => {
      const expected = expectedRunOrder[index];
      return run.repeat !== expected?.repeat || run.variant !== expected.variant;
    })
  ) {
    return undefined;
  }

  const expectedPairs = new Map<string, { leftWins: number; rightWins: number; ties: number }>();
  for (let leftIndex = 0; leftIndex < variantNames.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < variantNames.length; rightIndex += 1) {
      const left = variantNames[leftIndex]!;
      const right = variantNames[rightIndex]!;
      const counts = { leftWins: 0, rightWins: 0, ties: 0 };
      for (let repeat = 1; repeat <= orders.length; repeat += 1) {
        const leftRun = runs.find((run) => run.repeat === repeat && run.variant === left)!;
        const rightRun = runs.find((run) => run.repeat === repeat && run.variant === right)!;
        if (leftRun.oracle.passed === rightRun.oracle.passed) counts.ties += 1;
        else if (leftRun.oracle.passed) counts.leftWins += 1;
        else counts.rightWins += 1;
      }
      expectedPairs.set(`${left}_vs_${right}`, counts);
    }
  }
  if (Object.keys(value.pairedRates).length !== expectedPairs.size) return undefined;
  for (const [key, expected] of expectedPairs) {
    const actual = value.pairedRates[key];
    if (
      !validPairedRate(actual)
      || actual.leftWins !== expected.leftWins
      || actual.rightWins !== expected.rightWins
      || actual.ties !== expected.ties
    ) {
      return undefined;
    }
  }
  return { runs };
};

export const fromBenchmarkReport = (report: unknown, options: BenchmarkAdapterOptions = {}): VerificationResult => {
  const parsed = parseRealResumeBenchmarkReport(report);
  const criterionValid = typeof options.variant === "string"
    && options.variant.length > 0
    && typeof options.minimumPassRate === "number"
    && Number.isFinite(options.minimumPassRate)
    && options.minimumPassRate >= 0
    && options.minimumPassRate <= 1;
  const selected = parsed && criterionValid
    ? parsed.runs.filter((run) => run.variant === options.variant)
    : [];
  const observedPassRate = selected.length === 0
    ? undefined
    : selected.filter((run) => run.oracle.passed).length / selected.length;
  const verdict: VerificationVerdict = parsed && criterionValid && observedPassRate !== undefined
    ? observedPassRate >= options.minimumPassRate!
      ? "verified"
      : "not_verified"
    : "inconclusive";
  const reportArtifact = fingerprintableArtifact("benchmark.report", "comparison", report, "Real resume benchmark report digest");
  const artifactIds = reportArtifact ? [reportArtifact.id] : [];
  const checks: VerificationCheck[] = [
    {
      id: "benchmark.report-schema",
      verdict: parsed ? "verified" : "inconclusive",
      description: "Real resume benchmark V1 structure and recomputed aggregates",
      observed: parsed ? "valid" : "invalid",
      artifactIds,
    },
    {
      id: "benchmark.variant-pass-rate",
      verdict,
      description: "Selected variant executable-oracle pass rate",
      ...(criterionValid ? { expected: options.minimumPassRate } : {}),
      ...(observedPassRate === undefined ? {} : { observed: observedPassRate }),
      artifactIds,
    },
  ];
  return finish(
    options.statement ?? "The selected benchmark variant meets the required executable-oracle pass rate",
    verdict,
    `Benchmark ${verdict}`,
    checks,
    reportArtifact ? [reportArtifact] : [],
    "benchmark",
    options,
  );
};

export const fromHandoffReport = (report: unknown, options: VerificationAdapterOptions = {}): VerificationResult => {
  const value = isRecord(report) ? report : {};
  const failed = value.valid === false || value.tampered === true;
  const semantic = !failed && isKiroSemanticHandoff(report);
  const verdict: VerificationVerdict = failed ? "not_verified" : semantic ? "verified" : "inconclusive";
  const reportArtifact = fingerprintableArtifact("handoff.report", "diagnostic", report, "Handoff report digest");
  const artifactIds = reportArtifact ? [reportArtifact.id] : [];
  return finish(
    options.statement ?? "The handoff preserves the required verification context",
    verdict,
    `Handoff ${verdict}`,
    [{
      id: "handoff.integrity",
      verdict,
      observed: failed ? "explicit failure" : semantic ? "semantic digest verified" : "unverified",
      artifactIds,
    }],
    reportArtifact ? [reportArtifact] : [],
    "orchestrate-handoff",
    options,
  );
};
