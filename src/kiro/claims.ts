/**
 * Kiro executable-claims contract (V3). A stable, machine-readable report of
 * deterministic, non-billable claims over the built/packed kiro-fabric surface
 * (doctor, install/uninstall round trip, runtime-closure, MCP lifecycle,
 * package contents). These are EXECUTABLE claims: the harness drives real
 * binaries and protocols, never re-importing source handlers.
 *
 * A claim is one of:
 *   pass   — the probe completed and the criterion held
 *   fail   — the probe ran but the criterion did NOT hold (report must surface the error)
 *   skipped — prerequisite was unavailable (e.g. no runtime capability); MUST NOT be
 *             treated as pass, and the report-level `ok` is false if any required
 *             claim is skipped.
 *
 * Determinism: a pass/fail is decided by executable evidence only.
 */

export const KIRO_CLAIMS_SCHEMA_VERSION = 1 as const;
export const KIRO_CLAIMS_KIND = "kiro-fabric.kiro-claims" as const;

export type KiroClaimId =
  | "pack.contents"
  | "pack.entrypoints"
  | "doctor.supported-tuple"
  | "doctor.profile-validation"
  | "doctor.non-billable"
  | "install.managed-profile"
  | "install.runtime-closure"
  | "mcp.initialize"
  | "mcp.single-tool"
  | "mcp.golden-schema"
  | "mcp.fabric-exec"
  | "uninstall.hash-owned"
  | "uninstall.preserves-siblings"
  | "uninstall.idempotent";

export type KiroClaimSurface = "pack" | "doctor" | "install" | "mcp" | "uninstall";

export type KiroClaimResult =
  | {
      id: KiroClaimId;
      surface: KiroClaimSurface;
      status: "pass";
      evidence: Record<string, unknown>;
    }
  | {
      id: KiroClaimId;
      surface: KiroClaimSurface;
      status: "fail";
      error: { code: string; message: string };
      evidence?: Record<string, unknown>;
    }
  | {
      id: KiroClaimId;
      surface: KiroClaimSurface;
      status: "skipped";
      reason: "unavailable" | "dependency_failed";
      evidence?: Record<string, unknown>;
    };

export interface KiroClaimsReport {
  kind: typeof KIRO_CLAIMS_KIND;
  schemaVersion: typeof KIRO_CLAIMS_SCHEMA_VERSION;
  ok: boolean;
  nonBillable: boolean;
  modelTurnsRequested: number;
  claims: KiroClaimResult[];
  summary: { passed: number; failed: number; skipped: number };
  finishedAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const surfaceOf = (id: KiroClaimId): KiroClaimSurface =>
  id.slice(0, id.indexOf(".")) as KiroClaimSurface;

export const isKiroClaimResult = (value: unknown): value is KiroClaimResult => {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  if (!(REQUIRED_KIRO_CLAIMS as readonly string[]).includes(value.id)) return false;
  const id = value.id as KiroClaimId;
  if (value.surface !== surfaceOf(id)) return false;
  if (value.evidence !== undefined && !isRecord(value.evidence)) return false;
  if (value.status === "pass") return isRecord(value.evidence);
  if (value.status === "fail") {
    return isRecord(value.error)
      && typeof value.error.code === "string"
      && typeof value.error.message === "string";
  }
  return value.status === "skipped"
    && (value.reason === "unavailable" || value.reason === "dependency_failed");
};

/** The full set of claims V3 must satisfy before a release gate may pass. */
export const REQUIRED_KIRO_CLAIMS: readonly KiroClaimId[] = Object.freeze([
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

/**
 * Validate an untrusted V3 claims report, including its complete required claim
 * set and all derived summary fields. Extra envelope fields (for example a Git
 * binding added by a certification script) are allowed.
 */
export const isKiroClaimsReport = (value: unknown): value is KiroClaimsReport => {
  if (
    !isRecord(value)
    || value.kind !== KIRO_CLAIMS_KIND
    || value.schemaVersion !== KIRO_CLAIMS_SCHEMA_VERSION
    || typeof value.ok !== "boolean"
    || value.nonBillable !== true
    || value.modelTurnsRequested !== 0
    || typeof value.finishedAt !== "string"
    || !Number.isFinite(Date.parse(value.finishedAt))
    || !Array.isArray(value.claims)
    || !value.claims.every(isKiroClaimResult)
    || !isRecord(value.summary)
  ) {
    return false;
  }

  const ids = value.claims.map((claim) => claim.id);
  if (
    ids.length !== REQUIRED_KIRO_CLAIMS.length
    || new Set(ids).size !== ids.length
    || !REQUIRED_KIRO_CLAIMS.every((id) => ids.includes(id))
  ) {
    return false;
  }

  const nonBillableClaim = value.claims.find((claim) => claim.id === "doctor.non-billable");
  if (
    nonBillableClaim?.status === "pass"
    && (nonBillableClaim.evidence.nonBillable !== true
      || nonBillableClaim.evidence.modelTurnsRequested !== 0)
  ) {
    return false;
  }

  const passed = value.claims.filter((claim) => claim.status === "pass").length;
  const failed = value.claims.filter((claim) => claim.status === "fail").length;
  const skipped = value.claims.filter((claim) => claim.status === "skipped").length;
  return value.ok === (passed === REQUIRED_KIRO_CLAIMS.length)
    && value.summary.passed === passed
    && value.summary.failed === failed
    && value.summary.skipped === skipped;
};

/**
 * Build a report from a list of claim results, enforcing the invariants:
 *  - `ok` is true IFF every REQUIRED claim is `pass` (skip/fail ⇒ false);
 *  - a canonical result shape for each claim;
 *  - a non-billable report must request zero model turns.
 */
export const buildKiroClaimsReport = (claims: KiroClaimResult[]): KiroClaimsReport => {
  const byId = new Map<string, KiroClaimResult>();
  for (const claim of claims) {
    const existing = byId.get(claim.id);
    // earlier duplicates are considered weaker; a `fail` always wins
    if (!existing || (existing.status !== "fail" && claim.status === "fail")) byId.set(claim.id, claim);
  }

  const reordered: KiroClaimResult[] = [];
  for (const id of REQUIRED_KIRO_CLAIMS) {
    const c = byId.get(id);
    if (c) reordered.push(c);
  }
  for (const [id, c] of byId) {
    if (!reordered.some((r) => r.id === id)) reordered.push(c);
  }

  const passed = reordered.filter((c) => c.status === "pass").length;
  const failed = reordered.filter((c) => c.status === "fail").length;
  const skipped = reordered.filter((c) => c.status === "skipped").length;

  const allPresent = REQUIRED_KIRO_CLAIMS.every((id) => byId.has(id) && byId.get(id)?.status === "pass");
  const ok = allPresent && failed === 0;

  return {
    kind: KIRO_CLAIMS_KIND,
    schemaVersion: KIRO_CLAIMS_SCHEMA_VERSION,
    ok,
    nonBillable: true,
    modelTurnsRequested: 0,
    claims: reordered,
    summary: { passed, failed, skipped },
    finishedAt: new Date().toISOString(),
  };
};

export const pass = (id: KiroClaimId, surface: KiroClaimSurface, evidence: Record<string, unknown> = {}): KiroClaimResult => ({
  id,
  surface,
  status: "pass",
  evidence,
});

export const fail = (id: KiroClaimId, surface: KiroClaimSurface, error: string, code = "claim-not-met", evidence: Record<string, unknown> = {}): KiroClaimResult => ({
  id,
  surface,
  status: "fail",
  error: { code, message: error },
  evidence,
});

export const skipped = (id: KiroClaimId, surface: KiroClaimSurface, reason: "unavailable" | "dependency_failed" = "unavailable", evidence: Record<string, unknown> = {}): KiroClaimResult => ({
  id,
  surface,
  status: "skipped",
  reason,
  evidence,
});
