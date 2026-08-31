import { validateGitBinding } from "./git-binding.mjs";

export const CONTEXT_CERTIFICATION_KIND = "kiro-fabric.context-certification";
export const CONTEXT_CERTIFICATION_SCHEMA_VERSION = 2;
export const KIRO_CLAIMS_KIND = "kiro-fabric.kiro-claims";
export const KIRO_CLAIMS_SCHEMA_VERSION = 1;
export const RELEASE_A_CERTIFICATION_KIND = "kiro-fabric.release-a-certification";
export const RELEASE_A_CERTIFICATION_SCHEMA_VERSION = 1;
export const POWER_CERTIFICATION_KIND = "kiro-fabric.power-certification";
export const POWER_CERTIFICATION_SCHEMA_VERSION = 1;
export const POWER_REAL_QUALIFICATION_KIND = "kiro-fabric.power-real-qualification";
export const POWER_REAL_QUALIFICATION_SCHEMA_VERSION = 1;

const CONTEXT_CHECK_IDS = Object.freeze([
  "context.cycles",
  "context.eligibility",
  "context.builtContext",
  "context.priorSummaryInput",
  "context.goal",
  "context.constraints",
  "context.rareFact",
  "context.addresses",
  "context.callResultClosure",
  "context.firstKept",
  "context.poison",
  "context.determinism",
  "context.size",
  "context.maximalUtf8",
  "context.closureFixtures",
  "context.steadyRange",
  "context.steadySlope",
  "memory.sessions",
  "memory.coverage",
  "memory.rareRecall",
  "memory.structuralRecall",
  "memory.structuralNegative",
  "memory.cold",
  "memory.addressExpansion",
  "memory.integrityBound",
  "continuation.address",
  "continuation.oracle",
]);

export const REQUIRED_KIRO_CLAIM_IDS = Object.freeze([
  "pack.contents",
  "pack.entrypoints",
  "doctor.supported-tuple",
  "doctor.profile-validation",
  "doctor.non-billable",
  "install.managed-profile",
  "install.runtime-closure",
  "mcp.initialize",
  "mcp.single-tool",
  "mcp.golden-schema",
  "mcp.fabric-exec",
  "uninstall.hash-owned",
  "uninstall.preserves-siblings",
  "uninstall.idempotent",
]);

const RELEASE_A_CHECKS = Object.freeze(["pack", "install", "doctor", "mcp", "uninstall"]);
const POWER_CHECKS = Object.freeze([
  "manifest",
  "initialize",
  "tools",
  "workspace-rebind",
  "elicitation",
  "execution",
  "artifact-recovery",
  "shutdown",
  "immutability",
]);
export const POWER_REAL_CHECKS = Object.freeze([
  "import.folder",
  "import.github",
  "activation.keywords",
  "environment.plugin-paths",
  "tools.exact-surface",
  "execution.checked",
  "elicitation.approve",
  "elicitation.decline",
  "elicitation.dismiss",
  "elicitation.timeout",
  "workspace.single-root",
  "workspace.multi-root",
  "workspace.root-replacement",
  "lifecycle.deactivate-active-call",
  "lifecycle.reactivate-persistence",
  "lifecycle.update",
  "lifecycle.uninstall",
]);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasExactIds = (values, required) => values.length === required.length
  && new Set(values).size === required.length
  && required.every((id) => values.includes(id));
const validFinishedAt = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const invalid = (error) => ({ valid: false, error });
const valid = (passed) => ({ valid: true, passed });

const validateEnvelope = (report, kind, schemaVersion) => {
  if (!isRecord(report)) return "report must be a JSON object";
  if (report.kind !== kind) return `expected kind ${kind}`;
  if (report.schemaVersion !== schemaVersion) return `expected schemaVersion ${schemaVersion}`;
  if (!validateGitBinding(report.identity)) return "report is missing a valid Git binding";
  return undefined;
};

export const validateContextCertification = (report) => {
  const envelopeError = validateEnvelope(report, CONTEXT_CERTIFICATION_KIND, CONTEXT_CERTIFICATION_SCHEMA_VERSION);
  if (envelopeError) return invalid(envelopeError);
  if (report.deterministic !== true || !isRecord(report.piApi)
    || typeof report.piApi.version !== "string"
    || typeof report.piApi.prepareCompactionAccess !== "string") {
    return invalid("context certification metadata is invalid");
  }
  if (!isRecord(report.context) || !Array.isArray(report.context.summaryBytes)
    || !isRecord(report.memory) || typeof report.memory.eligibleSessions !== "number"
    || !isRecord(report.continuation) || !Array.isArray(report.continuation.results)
    || typeof report.continuation.passRate !== "number") {
    return invalid("context certification evidence is incomplete");
  }
  if (!isRecord(report.evaluation) || typeof report.evaluation.passed !== "boolean"
    || !Array.isArray(report.evaluation.checks) || !isRecord(report.evaluation.derived)) {
    return invalid("context certification evaluation is invalid");
  }
  const checks = report.evaluation.checks;
  if (!hasExactIds(checks.map((check) => isRecord(check) ? check.id : undefined), CONTEXT_CHECK_IDS)
    || checks.some((check) => !isRecord(check) || typeof check.passed !== "boolean" || typeof check.evidence !== "string")) {
    return invalid("context certification check set is invalid");
  }
  const passed = checks.every((check) => check.passed === true);
  if (report.evaluation.passed !== passed) return invalid("context certification result contradicts its checks");
  if (!validFinishedAt(report.finishedAt)) return invalid("context certification finishedAt is invalid");
  return valid(passed);
};

const expectedSurface = (id) => id.split(".")[0];

export const validateKiroClaimsCertification = (report) => {
  const envelopeError = validateEnvelope(report, KIRO_CLAIMS_KIND, KIRO_CLAIMS_SCHEMA_VERSION);
  if (envelopeError) return invalid(envelopeError);
  if (typeof report.ok !== "boolean" || report.nonBillable !== true || report.modelTurnsRequested !== 0
    || !Array.isArray(report.claims) || !isRecord(report.summary) || !validFinishedAt(report.finishedAt)) {
    return invalid("Kiro claims report metadata is invalid");
  }
  const ids = report.claims.map((claim) => isRecord(claim) ? claim.id : undefined);
  if (!hasExactIds(ids, REQUIRED_KIRO_CLAIM_IDS)) return invalid("Kiro claims report has an invalid claim set");
  for (const claim of report.claims) {
    if (!isRecord(claim) || claim.surface !== expectedSurface(claim.id)
      || !["pass", "fail", "skipped"].includes(claim.status)) {
      return invalid("Kiro claims report contains an invalid claim");
    }
    if (claim.status === "pass" && !isRecord(claim.evidence)) return invalid(`claim ${claim.id} has invalid pass evidence`);
    if (claim.id === "doctor.non-billable" && claim.status === "pass"
      && (claim.evidence.nonBillable !== true || claim.evidence.modelTurnsRequested !== 0)) {
      return invalid("doctor.non-billable pass evidence is contradictory");
    }
    if (claim.status === "fail" && (!isRecord(claim.error)
      || typeof claim.error.code !== "string" || typeof claim.error.message !== "string")) {
      return invalid(`claim ${claim.id} has an invalid failure`);
    }
    if (claim.status === "skipped" && !["unavailable", "dependency_failed"].includes(claim.reason)) {
      return invalid(`claim ${claim.id} has an invalid skip reason`);
    }
  }
  const counts = {
    passed: report.claims.filter((claim) => claim.status === "pass").length,
    failed: report.claims.filter((claim) => claim.status === "fail").length,
    skipped: report.claims.filter((claim) => claim.status === "skipped").length,
  };
  if (report.summary.passed !== counts.passed || report.summary.failed !== counts.failed
    || report.summary.skipped !== counts.skipped) {
    return invalid("Kiro claims summary contradicts its claims");
  }
  const passed = report.claims.every((claim) => claim.status === "pass");
  if (report.ok !== passed) return invalid("Kiro claims result contradicts its claims");
  return valid(passed);
};

export const validatePowerCertification = (report, expectedPackage) => {
  const envelopeError = validateEnvelope(report, POWER_CERTIFICATION_KIND, POWER_CERTIFICATION_SCHEMA_VERSION);
  if (envelopeError) return invalid(envelopeError);
  if (report.ok !== true || report.package !== expectedPackage
    || !Array.isArray(report.checks) || !hasExactIds(report.checks, POWER_CHECKS)
    || !Array.isArray(report.tools) || !validFinishedAt(report.finishedAt)) {
    return invalid("Power certification metadata is invalid or incomplete");
  }
  if (!hasExactIds(report.tools, ["fabric_info", "fabric_workspace", "fabric_exec"])
    || report.roots !== "select-rebind" || report.elicitation !== "approve-once"
    || report.execution !== "checked" || report.artifactRecovery !== "lossless"
    || report.acpAgents !== false) {
    return invalid("Power certification evidence contradicts the required surface");
  }
  return valid(true);
};

export const validatePowerRealQualification = (report, expectedPackage) => {
  const envelopeError = validateEnvelope(
    report,
    POWER_REAL_QUALIFICATION_KIND,
    POWER_REAL_QUALIFICATION_SCHEMA_VERSION,
  );
  if (envelopeError) return invalid(envelopeError);
  if (report.ok !== true || report.package !== expectedPackage
    || !Array.isArray(report.platforms) || !validFinishedAt(report.finishedAt)) {
    return invalid("real Power qualification metadata is invalid");
  }
  const requiredPlatforms = ["linux", "darwin", "win32"];
  if (!hasExactIds(report.platforms.map((entry) => isRecord(entry) ? entry.os : undefined), requiredPlatforms)) {
    return invalid("real Power qualification must contain Linux, macOS, and Windows evidence");
  }
  for (const platform of report.platforms) {
    if (!isRecord(platform) || typeof platform.arch !== "string"
      || typeof platform.nodeVersion !== "string" || typeof platform.kiroVersion !== "string"
      || !Array.isArray(platform.checks)
      || !hasExactIds(platform.checks.map((check) => isRecord(check) ? check.id : undefined), POWER_REAL_CHECKS)) {
      return invalid(`real Power qualification for ${String(platform?.os)} is incomplete`);
    }
    if (platform.checks.some((check) => !isRecord(check) || check.status !== "pass"
      || typeof check.evidence !== "string" || check.evidence.length === 0)) {
      return invalid(`real Power qualification for ${platform.os} contains a non-pass check`);
    }
  }
  return valid(true);
};

export const validateReleaseACertification = (report, expectedPackage) => {
  const envelopeError = validateEnvelope(report, RELEASE_A_CERTIFICATION_KIND, RELEASE_A_CERTIFICATION_SCHEMA_VERSION);
  if (envelopeError) return invalid(envelopeError);
  if (typeof report.ok !== "boolean" || report.package !== expectedPackage
    || !Array.isArray(report.checks) || !validFinishedAt(report.finishedAt)) {
    return invalid("Release-A certification metadata is invalid");
  }
  const checksArePrefix = report.checks.every((check, index) => check === RELEASE_A_CHECKS[index]);
  if (!checksArePrefix || new Set(report.checks).size !== report.checks.length) {
    return invalid("Release-A certification check sequence is invalid");
  }
  if (report.ok) {
    if (!hasExactIds(report.checks, RELEASE_A_CHECKS) || typeof report.tarball !== "string" || report.tarball.length === 0) {
      return invalid("successful Release-A certification is incomplete");
    }
  } else if (!isRecord(report.error) || typeof report.error.code !== "string" || typeof report.error.message !== "string") {
    return invalid("failed Release-A certification is missing its error");
  }
  return valid(report.ok);
};
