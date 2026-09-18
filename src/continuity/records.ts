import { createHash } from "node:crypto";
import { CAPTURE_OPERATION_LIMIT, OBSERVED_REFS, validObservedPath, type ContinuityCapture, type ContinuityOperationReceipt } from "./execution.js";

export const FACT_KINDS = ["objective", "constraint", "decision", "open-check", "next-step"] as const;
export type ContinuityFactKind = typeof FACT_KINDS[number];
export type ContinuityFact = { kind: ContinuityFactKind; text: string };
type ContinuityDeclarationRecord = ContinuityFact & { sequence: number; provenance: "declared" };
type ContinuityOperationRecord = ContinuityOperationReceipt & { sequence: number; provenance: "host-observed"; kind: "operation"; text?: never };
export type ContinuityCaptureMetadata = Omit<ContinuityCapture, "receipts">;
export type ContinuityCaptureRecord = ContinuityCaptureMetadata & { sequence: number; provenance: "host-observed"; kind: "capture"; text?: never };
export const CHECK_STATUSES = ["open", "passed", "failed", "blocked"] as const;
export type ContinuityCheck = {
  id: string; text: string; status: typeof CHECK_STATUSES[number]; evidence: number[] | "captured"; note?: string;
  /** Caller-selected review claims, not host certification. The original ledger may expire. */
  review?: { taskId: string; revision: number; findingId: string; status: "candidate" | "confirmed" | "conditional" | "disproved"; scope: string };
};
export type ContinuityCheckRecord = Omit<ContinuityCheck, "evidence"> & { evidence: number[]; sequence: number; provenance: "declared"; kind: "check" };
export type ContinuityRecord = ContinuityDeclarationRecord | ContinuityOperationRecord | ContinuityCaptureRecord | ContinuityCheckRecord;
type Publication = { requestId: string; requestHash: string; throughSequence: number; captureSequence?: number };
export interface ContinuityTask {
  schemaVersion: 1 | 2 | 3;
  captureVersion?: 1;
  taskId: string;
  records: ContinuityRecord[];
  publications: Publication[];
}
export type ContinuitySnapshot = { task: ContinuityTask; revision: number; hash: string };
export const MAX_RECORDS = 512;
export const MAX_PUBLICATIONS = 128;
export const MAX_TEXT_BYTES = 2048;
const invalid = (): never => { throw new Error("continuity record or task is malformed or exceeds bounds"); };
function exactObject(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const object = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(object, key)) || Object.keys(object).some(key => !keys.includes(key) && !optional.includes(key))) return invalid();
  return object;
}
export function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return invalid();
  return value as number;
}
const count = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > CAPTURE_OPERATION_LIMIT) return invalid();
  return value as number;
};
const executionId = (value: unknown): string => {
  if (typeof value !== "string" || !/^ce_[a-f0-9]{32}$/.test(value)) return invalid();
  return value;
};
export function taskId(value: unknown): string {
  if (typeof value !== "string" || !/^ct_[a-f0-9]{32}$/.test(value)) return invalid();
  return value;
}
export function requestId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) return invalid();
  return value;
}
export function sourceHash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return invalid();
  return value;
}
export function declarationText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES || Buffer.from(value, "utf8").toString("utf8") !== value) return invalid();
  return value;
}
export function parseFact(value: unknown): ContinuityFact {
  const fact = exactObject(value, ["kind", "text"]);
  if (!FACT_KINDS.includes(fact.kind as ContinuityFactKind)) return invalid();
  return { kind: fact.kind as ContinuityFactKind, text: declarationText(fact.text) };
}
export function parseFacts(value: unknown, allowEmpty = false): ContinuityFact[] {
  if (!Array.isArray(value) || value.length < (allowEmpty ? 0 : 1) || value.length > 64) return invalid();
  return value.map(parseFact);
}
export function captureMetadata(value: unknown): ContinuityCaptureMetadata {
  const raw = exactObject(value, ["executionId", "throughOperation", "admittedOperations", "capturedOperations", "unsupportedOperations", "excludedOperations"]);
  const result = { executionId: executionId(raw.executionId), throughOperation: count(raw.throughOperation), admittedOperations: count(raw.admittedOperations),
    capturedOperations: count(raw.capturedOperations), unsupportedOperations: count(raw.unsupportedOperations), excludedOperations: count(raw.excludedOperations) };
  if (result.admittedOperations !== result.throughOperation || result.capturedOperations + result.unsupportedOperations + result.excludedOperations !== result.admittedOperations) return invalid();
  return result;
}
function parseCheck(value: unknown): ContinuityCheck {
  const raw = exactObject(value, ["id", "text", "status"], ["evidence", "note", "review"]);
  if (!CHECK_STATUSES.includes(raw.status as ContinuityCheck["status"])) return invalid();
  const evidence = raw.evidence ?? [];
  if (evidence !== "captured" && (!Array.isArray(evidence) || evidence.length > 32 || new Set(evidence).size !== evidence.length ||
      evidence.some(item => !Number.isSafeInteger(item) || item < 1 || item > MAX_RECORDS))) return invalid();
  const result: ContinuityCheck = { id: requestId(raw.id), text: declarationText(raw.text), status: raw.status as ContinuityCheck["status"], evidence: evidence as number[] | "captured" };
  if (raw.note !== undefined) result.note = declarationText(raw.note);
  if (raw.review !== undefined) {
    const review = exactObject(raw.review, ["taskId", "revision", "findingId", "status", "scope"]);
    if (!["candidate", "confirmed", "conditional", "disproved"].includes(review.status as string)) return invalid();
    result.review = { taskId: requestId(review.taskId), revision: positiveInteger(review.revision), findingId: requestId(review.findingId),
      status: review.status as NonNullable<ContinuityCheck["review"]>["status"], scope: declarationText(review.scope) };
  }
  return result;
}
export function parseChecks(value: unknown): ContinuityCheck[] {
  if (!Array.isArray(value) || value.length > 16) return invalid();
  const checks = value.map(parseCheck);
  if (new Set(checks.map(check => check.id)).size !== checks.length) return invalid();
  return checks;
}
function parseReceipt(value: unknown): ContinuityOperationReceipt {
  const raw = exactObject(value, ["executionId", "operationSequence", "ref", "outcome", "dispatchState", "effectOutcome"], ["identityHash", "path", "sha256", "command", "commitAcknowledgement", "diagnostic", "sources", "sourceCoverage", "settledBeforeDispatch"]);
  if (!OBSERVED_REFS.includes(raw.ref as typeof OBSERVED_REFS[number]) || !["succeeded", "failed"].includes(raw.outcome as string) ||
      !["not_dispatched", "dispatched"].includes(raw.dispatchState as string) || !["none", "uncertain", "committed"].includes(raw.effectOutcome as string)) return invalid();
  const result: ContinuityOperationReceipt = {
    executionId: executionId(raw.executionId), operationSequence: positiveInteger(count(raw.operationSequence)), ref: raw.ref as string,
    outcome: raw.outcome as ContinuityOperationReceipt["outcome"], dispatchState: raw.dispatchState as ContinuityOperationReceipt["dispatchState"],
    effectOutcome: raw.effectOutcome as ContinuityOperationReceipt["effectOutcome"],
  };
  if (raw.identityHash !== undefined) result.identityHash = sourceHash(raw.identityHash);
  if (raw.path !== undefined) { if (!validObservedPath(raw.path)) return invalid(); result.path = raw.path; }
  if (raw.sha256 !== undefined) result.sha256 = sourceHash(raw.sha256);
  if (raw.sources !== undefined || raw.sourceCoverage !== undefined) {
    if (!["local.readMany", "local.readEvidence"].includes(result.ref) || !Array.isArray(raw.sources) || raw.sources.length > 32 ||
        !["complete", "partial"].includes(raw.sourceCoverage as string)) return invalid();
    result.sources = raw.sources.map(value => {
      const source = exactObject(value, ["path", "sha256"]);
      if (!validObservedPath(source.path)) return invalid();
      return { path: source.path, sha256: sourceHash(source.sha256) };
    });
    if (new Set(result.sources.map(source => source.path)).size !== result.sources.length) return invalid();
    result.sourceCoverage = raw.sourceCoverage as "complete" | "partial";
  }
  if (raw.command !== undefined) {
    const command = exactObject(raw.command, ["ok", "exitCode", "signal"]);
    if (!["local.shell", "probe.run"].includes(result.ref) || typeof command.ok !== "boolean" ||
        !(command.exitCode === null || Number.isSafeInteger(command.exitCode)) ||
        !(command.signal === null || typeof command.signal === "string" && /^SIG[A-Z0-9]{1,16}$/.test(command.signal)) ||
        command.ok !== (command.exitCode === 0 && command.signal === null)) return invalid();
    result.command = { ok: command.ok, exitCode: command.exitCode as number | null, signal: command.signal as string | null };
  }
  if (raw.settledBeforeDispatch !== undefined) {
    if (!["local.shell", "probe.run"].includes(result.ref) || result.dispatchState !== "dispatched") return invalid();
    result.settledBeforeDispatch = count(raw.settledBeforeDispatch);
    if (result.settledBeforeDispatch >= result.operationSequence) return invalid();
  }
  if (raw.diagnostic !== undefined) {
    const diagnostic = exactObject(raw.diagnostic, ["text", "truncated"]);
    if (!result.command || result.command.ok || typeof diagnostic.truncated !== "boolean" ||
        typeof diagnostic.text !== "string" || !diagnostic.text || Buffer.byteLength(diagnostic.text) > 512 ||
        Buffer.from(diagnostic.text, "utf8").toString("utf8") !== diagnostic.text) return invalid();
    result.diagnostic = { text: diagnostic.text, truncated: diagnostic.truncated };
  }
  if (raw.commitAcknowledgement !== undefined) {
    const ack = exactObject(raw.commitAcknowledgement, ["version", "operation"]);
    if (ack.version !== 1 || !["set", "delete", "write", "edit"].includes(ack.operation as string)) return invalid();
    result.commitAcknowledgement = { version: 1, operation: ack.operation as NonNullable<ContinuityOperationReceipt["commitAcknowledgement"]>["operation"] };
  }
  if ((result.effectOutcome === "committed") !== !!result.commitAcknowledgement) return invalid();
  if (result.dispatchState === "not_dispatched" && (result.outcome !== "failed" || result.effectOutcome !== "none" || result.command || result.path || result.sha256 || result.sources || result.commitAcknowledgement)) return invalid();
  return result;
}
/** Normalize every key order. Version 1 stays byte/hash compatible; only an
 * explicit successful capture publication upgrades a task to version 2. */
export function parseTask(value: unknown): ContinuityTask {
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  const task = exactObject(value, ["schemaVersion", "taskId", "records", "publications", ...(version === 2 || version === 3 ? ["captureVersion"] : [])]);
  if ((version !== 1 && version !== 2 && version !== 3) || (version !== 1 && task.captureVersion !== 1) || !Array.isArray(task.records) || task.records.length < 1 || task.records.length > MAX_RECORDS ||
      !Array.isArray(task.publications) || task.publications.length > MAX_PUBLICATIONS) return invalid();
  const identities = new Set<string>();
  const records = task.records.map((value, index): ContinuityRecord => {
    const base = value as Record<string, unknown>;
    if (base?.sequence !== index + 1) return invalid();
    if (version === 3 && base.provenance === "declared" && base.kind === "check") {
      const { sequence: _sequence, provenance: _provenance, kind: _kind, ...raw } = base;
      const check = parseCheck(raw);
      if (check.evidence === "captured") return invalid();
      return { sequence: index + 1, provenance: "declared", kind: "check", ...check, evidence: check.evidence };
    }
    if (base.provenance === "declared") {
      const record = exactObject(value, ["sequence", "provenance", "kind", "text"]);
      return { sequence: index + 1, provenance: "declared", ...parseFact({ kind: record.kind, text: record.text }) };
    }
    if (version === 1 || base.provenance !== "host-observed") return invalid();
    const { sequence: _sequence, provenance: _provenance, kind, ...raw } = base;
    if (kind === "capture") return { sequence: index + 1, provenance: "host-observed", kind, ...captureMetadata(raw) };
    if (kind !== "operation") return invalid();
    const receipt = parseReceipt(raw), identity = `${receipt.executionId}/${receipt.operationSequence}`;
    if (identities.has(identity)) return invalid(); identities.add(identity);
    return { sequence: index + 1, provenance: "host-observed", kind, ...receipt };
  });
  if (records[0]!.kind !== "objective") return invalid();
  const checkIds = new Set<string>();
  for (const record of records) {
    if (record.kind === "operation" && (record.diagnostic || record.sources || record.settledBeforeDispatch !== undefined) && version !== 3) return invalid();
    if (record.kind !== "check") continue;
    checkIds.add(record.id);
    if (checkIds.size > 32 || record.evidence.some(sequence => sequence >= record.sequence || records[sequence - 1]?.kind !== "operation")) return invalid();
  }
  const captures = records.filter((entry): entry is ContinuityCaptureRecord => entry.kind === "capture");
  if (version === 2 && !captures.length) return invalid();
  for (const capture of captures) {
    const observed = records.filter(entry => entry.kind === "operation" && entry.executionId === capture.executionId && entry.operationSequence <= capture.throughOperation && entry.sequence < capture.sequence);
    if (observed.length !== capture.capturedOperations) return invalid();
  }
  for (const entry of records) if (entry.kind === "operation" && !captures.some(capture => capture.executionId === entry.executionId && capture.throughOperation >= entry.operationSequence && capture.sequence > entry.sequence)) return invalid();
  let previous = 0;
  const seen = new Set<string>();
  const publications = task.publications.map((value): Publication => {
    const publication = exactObject(value, ["requestId", "requestHash", "throughSequence"], version !== 1 ? ["captureSequence"] : []);
    const id = requestId(publication.requestId), throughSequence = positiveInteger(publication.throughSequence);
    if (seen.has(id) || throughSequence <= previous || throughSequence > records.length) return invalid();
    let captureSequence: number | undefined;
    if (publication.captureSequence !== undefined) {
      captureSequence = positiveInteger(publication.captureSequence);
      if (captureSequence <= previous || captureSequence > throughSequence || records[captureSequence - 1]?.kind !== "capture") return invalid();
    }
    seen.add(id); previous = throughSequence;
    return { requestId: id, requestHash: sourceHash(publication.requestHash), throughSequence, ...(captureSequence === undefined ? {} : { captureSequence }) };
  });
  if (publications.length && previous !== records.length) return invalid();
  if (captures.some(capture => !publications.some(publication => publication.captureSequence === capture.sequence))) return invalid();
  return { schemaVersion: version, ...(version !== 1 ? { captureVersion: 1 as const } : {}), taskId: taskId(task.taskId), records, publications };
}
export const digest = (domain: string, value: unknown): string => createHash("sha256").update(domain).update("\0").update(JSON.stringify(value)).digest("hex");
export const taskHash = (task: ContinuityTask): string => digest(`continuity-task-v${task.schemaVersion}`, parseTask(task));
export const snapshot = (task: ContinuityTask, revision: number): ContinuitySnapshot => ({ task, revision: positiveInteger(revision), hash: taskHash(task) });
