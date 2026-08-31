#!/usr/bin/env node
/** Generate current, honest Kiro readiness metadata without running billable gates.
 *
 * Optional deterministic certification reports are accepted only when their
 * report-specific schema is valid and their Git binding exactly matches this
 * checkout. Omitted reports remain `not_run`; supplied invalid evidence is
 * never promoted to a pass.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathIsInside } from "./certification/artifact-path.mjs";
import {
  GIT_BINDING_KIND,
  GIT_BINDING_SCHEMA_VERSION,
  gitBindingsMatch,
  tryCaptureGitBinding,
} from "./certification/git-binding.mjs";
import {
  validateContextCertification,
  validateKiroClaimsCertification,
  validatePowerCertification,
  validatePowerRealQualification,
  validateReleaseACertification,
} from "./certification/readiness-reports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const parseArgs = (argv) => {
  const options = { check: false };
  const valueFlags = new Map([
    ["--output", "output"],
    ["--context-report", "contextReport"],
    ["--claims-report", "claimsReport"],
    ["--release-report", "releaseReport"],
    ["--power-report", "powerReport"],
    ["--power-real-report", "powerRealReport"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      if (options.check) throw new Error("--check may be specified only once");
      options.check = true;
      continue;
    }
    const key = valueFlags.get(arg);
    if (!key) throw new Error(`unknown argument: ${arg}`);
    if (options[key] !== undefined) throw new Error(`${arg} may be specified only once`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a path`);
    options[key] = path.resolve(value);
    index += 1;
  }
  return options;
};

let options;
try {
  options = parseArgs(process.argv.slice(2));
  const artifactPaths = [
    options.output,
    options.contextReport,
    options.claimsReport,
    options.releaseReport,
    options.powerReport,
    options.powerRealReport,
  ].filter(Boolean);
  if (artifactPaths.some((candidate) => pathIsInside(root, candidate))) {
    throw new Error("readiness report inputs and --output must be outside the checkout so they cannot alter its Git binding");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write("Usage: node scripts/refresh-kiro-readiness.mjs [--check] [--output <path>] [--context-report <path>] [--claims-report <path>] [--release-report <path>] [--power-report <path>] [--power-real-report <path>]\n");
  process.exit(2);
}

const gitIdentity = tryCaptureGitBinding(root);
const exists = (relative) => fs.existsSync(path.join(root, relative));
const staticChecks = [
  { id: "source.kiro-cli", status: exists("src/kiro/cli.ts") ? "pass" : "fail", path: "src/kiro/cli.ts" },
  { id: "source.kiro-mcp", status: exists("src/kiro/mcp-server.ts") ? "pass" : "fail", path: "src/kiro/mcp-server.ts" },
  { id: "source.claims", status: exists("src/kiro/claims.ts") ? "pass" : "fail", path: "src/kiro/claims.ts" },
  { id: "built.cli", status: exists("dist/kiro/cli-entry.js") ? "pass" : "unavailable", path: "dist/kiro/cli-entry.js" },
  { id: "built.mcp", status: exists("dist/kiro/mcp-entry.js") ? "pass" : "unavailable", path: "dist/kiro/mcp-entry.js" },
];

const loadReport = ({ descriptor, filePath, validate }) => {
  const base = {
    source: descriptor,
    requested: filePath !== undefined,
    present: false,
    stale: false,
    verdict: "not_run",
  };
  if (!filePath) return base;
  if (!fs.existsSync(filePath)) {
    return { ...base, verdict: "inconclusive", reason: "missing_report", error: `missing report: ${filePath}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      ...base,
      present: true,
      verdict: "inconclusive",
      reason: "unparseable_report",
      error: `unable to parse report JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const result = validate(parsed);
  if (!result.valid) {
    return {
      ...base,
      present: true,
      verdict: "inconclusive",
      reason: "invalid_report",
      error: result.error,
    };
  }
  if (!gitIdentity) {
    return {
      ...base,
      present: true,
      verdict: "inconclusive",
      reason: "identity_unavailable",
      error: "current Git identity is unavailable",
    };
  }
  if (!gitBindingsMatch(parsed.identity, gitIdentity)) {
    return {
      ...base,
      present: true,
      stale: true,
      verdict: "not_verified",
      reason: "stale_report",
      error: `report Git binding does not match current checkout ${gitIdentity.head}:${gitIdentity.treeHash}`,
    };
  }
  return result.passed
    ? { ...base, present: true, verdict: "verified" }
    : {
        ...base,
        present: true,
        verdict: "not_verified",
        reason: "certification_failed",
        error: "certification explicitly reported failure",
      };
};

const expectedPackage = `${pkg.name}@${pkg.version}`;
const reportInputs = [
  {
    id: "cert.context",
    descriptor: "context",
    filePath: options.contextReport,
    validate: validateContextCertification,
    evidence: "Offline context / memory certificate",
  },
  {
    id: "cert.kiro-claims",
    descriptor: "claims",
    filePath: options.claimsReport,
    validate: validateKiroClaimsCertification,
    evidence: "Kiro executable claims (non-billable)",
  },
  {
    id: "cert.release-a",
    descriptor: "release",
    filePath: options.releaseReport,
    validate: (report) => validateReleaseACertification(report, expectedPackage),
    evidence: "Packed Release-A install/doctor/MCP/uninstall",
  },
  {
    id: "cert.power",
    descriptor: "power",
    filePath: options.powerReport,
    validate: (report) => validatePowerCertification(report, expectedPackage),
    evidence: "Kiro Power manifest/MCP/workspace/elicitation/execution/lifecycle",
  },
  {
    id: "cert.power-real",
    descriptor: "power-real",
    filePath: options.powerRealReport,
    validate: (report) => validatePowerRealQualification(report, expectedPackage),
    evidence: "Clean-machine real Kiro Power qualification on Linux/macOS/Windows",
  },
];
const runReports = reportInputs.map(({ id, evidence, ...input }) => ({
  id,
  evidence,
  ...loadReport(input),
}));

const anyFail = staticChecks.some((check) => check.status === "fail")
  || runReports.some((report) => report.verdict === "not_verified");
const anyUnavailable = staticChecks.some((check) => check.status === "unavailable")
  || runReports.some((report) => report.verdict !== "verified");

const readiness = {
  kind: "kiro-fabric.readiness",
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  identity: {
    package: pkg.name,
    version: pkg.version,
    head: gitIdentity?.head ?? "unknown",
    treeHash: gitIdentity?.treeHash ?? "unknown",
    dirty: gitIdentity?.dirty ?? null,
    git: gitIdentity ?? {
      kind: GIT_BINDING_KIND,
      schemaVersion: GIT_BINDING_SCHEMA_VERSION,
      head: "unknown",
      treeHash: "unknown",
      dirty: null,
    },
    node: pkg.engines?.node ?? "unknown",
    packageManager: pkg.packageManager ?? "unknown",
  },
  currentEvidence: {
    status: anyFail ? "not_verified" : anyUnavailable ? "inconclusive" : "verified",
    checks: staticChecks,
    reports: runReports,
  },
  externalEvidence: {
    status: "historical",
    note: "Historical real-Kiro observations (docs/kiro/baseline.md, docs/kiro/status.md) are not reclassified as current evidence by this generator.",
  },
  unavailable: [
    ...(runReports.find((report) => report.id === "cert.power-real")?.verdict === "verified"
      ? []
      : ["real Kiro Power qualification on Linux/macOS/Windows"]),
    "billable Release B model turns",
  ],
  policy: { billableGatesExecuted: false, modelTurnsRequested: 0, realKiroClaimsRequireExplicitRun: true },
};

const json = `${JSON.stringify(readiness, null, 2)}\n`;
if (options.output) fs.writeFileSync(options.output, json, { mode: 0o600 });
else process.stdout.write(json);

if (options.check) {
  const invalidRequestedReport = runReports.some((report) => report.requested
    && !["verified", "certification_failed"].includes(report.reason ?? report.verdict));
  const failedCertification = runReports.some((report) => report.reason === "certification_failed");
  if (!gitIdentity || invalidRequestedReport) process.exitCode = 2;
  else if (staticChecks.some((check) => check.status === "fail") || failedCertification) process.exitCode = 1;
}
