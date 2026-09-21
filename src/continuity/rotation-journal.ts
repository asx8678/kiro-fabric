import { randomBytes } from "node:crypto";
import { StateProvider, type StateDirectoryBarrier } from "../providers/state-provider.js";
import { continuityBoundedId, continuityBoundedKey, continuityBoundedText } from "./validation.js";
import type { FabricInvocationContext } from "../protocol.js";

const ROTATION_MAX_JOURNALS = 16;
const ROTATION_MAX_RECORDS = 64;
const ROTATION_MAX_DOCUMENT_BYTES = 256 * 1024;
const ROTATION_MAX_TOTAL_BYTES = 1024 * 1024;

export type ContinuityRotationPhase = "preparing" | "created" | "submitting" | "active" | "blocked" | "reconciled" | "aborted";
export type ContinuityRotationDecision = "confirmed-submitted" | "confirmed-not-submitted";
const PHASES: readonly ContinuityRotationPhase[] = ["preparing", "created", "submitting", "active", "blocked", "reconciled", "aborted"];

/** Required record shape per phase. A fresh session id is forbidden before one
 * is recorded, required from `created` through the terminal outcomes, and
 * only optionally retained after a pre-submission abort as a never-reuse
 * tombstone. `uncertainEffects` must be true exactly while a submission
 * intent is published and unwitnessed. */
interface PhaseRequirements {
  newSession: "forbidden" | "required" | "optional";
  submission: "forbidden" | "required";
  uncertainEffects: boolean;
  decision: "forbidden" | "required";
}
/** Base-shape validation as data: each field carries its own check so a
 * tampered document names the exact field instead of a generic verdict. */
interface RecordFieldCheck {
  readonly field: string;
  readonly valid: (value: unknown) => boolean;
}
const RECORD_FIELD_CHECKS: readonly RecordFieldCheck[] = [
  { field: "rotationId", valid: value => typeof value === "string" && /^ro_[a-f0-9]{32}$/u.test(value) },
  { field: "epoch", valid: value => Number.isSafeInteger(value) && (value as number) >= 1 },
  { field: "archiveWatermark", valid: value => Number.isSafeInteger(value) && (value as number) >= 0 },
  { field: "checkpointHash", valid: value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) },
  { field: "archiveHeadHash", valid: value => typeof value === "string" && (value === "" || /^[a-f0-9]{64}$/u.test(value)) },
  { field: "oldPhysicalSessionId", valid: value => typeof value === "string" && value !== "" },
  { field: "phase", valid: value => typeof value === "string" && PHASES.includes(value as ContinuityRotationPhase) },
  { field: "uncertainEffects", valid: value => typeof value === "boolean" },
];

const PHASE_REQUIREMENTS: Record<ContinuityRotationPhase, PhaseRequirements> = {
  preparing:  { newSession: "forbidden", submission: "forbidden", uncertainEffects: false, decision: "forbidden" },
  created:    { newSession: "required",   submission: "forbidden", uncertainEffects: false, decision: "forbidden" },
  submitting: { newSession: "required",   submission: "required",   uncertainEffects: true,  decision: "forbidden" },
  active:     { newSession: "required",   submission: "required",   uncertainEffects: false, decision: "forbidden" },
  blocked:    { newSession: "required",   submission: "required",   uncertainEffects: true,  decision: "forbidden" },
  reconciled: { newSession: "required",   submission: "required",   uncertainEffects: false, decision: "required" },
  aborted:    { newSession: "optional",   submission: "forbidden", uncertainEffects: false, decision: "forbidden" },
};

export interface ContinuityRotationRecord {
  rotationId: string;
  epoch: number;
  /** Immutable handoff packet hash binding this rotation to its checkpoint. */
  checkpointHash: string;
  /** Archive sequence and head hash binding this rotation to its source events. */
  archiveWatermark: number;
  archiveHeadHash: string;
  oldPhysicalSessionId: string;
  newPhysicalSessionId?: string;
  submissionId?: string;
  phase: ContinuityRotationPhase;
  /** A submission intent was published and its outcome is not yet witnessed. */
  uncertainEffects: boolean;
  note?: string;
  decision?: { outcome: ContinuityRotationDecision; note: string };
}
export interface ContinuityRotationStatus { archiveId: string; revision: number; lastEpoch: number; rotations: ContinuityRotationRecord[] }
export interface ContinuityRotationBeginInput {
  archiveId: string; workspaceKey: string; checkpointHash: string;
  archiveWatermark: number; archiveHeadHash: string; oldPhysicalSessionId: string;
}
interface ContinuityRotationDocument { schemaVersion: 1 | 2; archiveId: string; workspaceKey: string; lastEpoch: number; rotations: ContinuityRotationRecord[] }

const archiveIdOf = (value: unknown): string => continuityBoundedId(value, "rotation archive id");
const workspaceKeyOf = (value: unknown): string => continuityBoundedKey(value, "rotation workspace key");
const sessionOf = (value: unknown): string => {
  const session = continuityBoundedKey(value, "rotation session id");
  if (session.includes("\0")) throw new Error("continuity rotation session id is malformed");
  return session;
};
const hash64 = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error("continuity rotation hash is malformed");
  return value;
};
const noteOf = (value: unknown): string => continuityBoundedText(value, "rotation note");
const boundedId = (value: unknown, label: string): string => continuityBoundedId(value, `rotation ${label}`);

const parseRecord = (value: unknown, schemaVersion: 1 | 2): ContinuityRotationRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("continuity rotation journal is corrupt");
  const record = value as Record<string, unknown>;
  for (const check of RECORD_FIELD_CHECKS) {
    if (!check.valid(record[check.field])) throw new Error(`continuity rotation journal is corrupt: field "${check.field}"`);
  }
  // Cross-field rule: a zero watermark pairs with an empty head hash.
  if ((record.archiveWatermark === 0) !== (record.archiveHeadHash === "")) {
    throw new Error('continuity rotation journal is corrupt: field "archiveWatermark"');
  }
  const phase = record.phase as ContinuityRotationPhase;
  // Schema v1 journals predate the aborted phase; only a v2 document carries it.
  if (schemaVersion !== 2 && phase === "aborted") throw new Error("continuity rotation journal is corrupt");
  const requirements = PHASE_REQUIREMENTS[phase];
  const result: ContinuityRotationRecord = {
    rotationId: record.rotationId as string, epoch: record.epoch as number, checkpointHash: record.checkpointHash as string,
    archiveWatermark: record.archiveWatermark as number, archiveHeadHash: record.archiveHeadHash as string,
    oldPhysicalSessionId: record.oldPhysicalSessionId as string, phase,
    uncertainEffects: record.uncertainEffects as boolean,
  };
  if (record.newPhysicalSessionId !== undefined) result.newPhysicalSessionId = sessionOf(record.newPhysicalSessionId);
  if (record.submissionId !== undefined) result.submissionId = boundedId(record.submissionId, "submission id");
  if (record.note !== undefined) result.note = noteOf(record.note);
  if (record.decision !== undefined) {
    const decision = record.decision as Record<string, unknown>;
    if (!decision || typeof decision !== "object" || Array.isArray(decision) ||
        (decision.outcome !== "confirmed-submitted" && decision.outcome !== "confirmed-not-submitted") || typeof decision.note !== "string") throw new Error("continuity rotation journal is corrupt");
    result.decision = { outcome: decision.outcome, note: decision.note };
  }
  if (requirements.newSession === "forbidden" && result.newPhysicalSessionId !== undefined) throw new Error("continuity rotation journal is corrupt");
  if (requirements.newSession === "required" && result.newPhysicalSessionId === undefined) throw new Error("continuity rotation journal is corrupt");
  if (requirements.submission === "forbidden" && result.submissionId !== undefined) throw new Error("continuity rotation journal is corrupt");
  if (requirements.submission === "required" && result.submissionId === undefined) throw new Error("continuity rotation journal is corrupt");
  if (result.uncertainEffects !== requirements.uncertainEffects) throw new Error("continuity rotation journal is corrupt");
  if (requirements.decision === "forbidden" && result.decision !== undefined) throw new Error("continuity rotation journal is corrupt");
  if (requirements.decision === "required" && result.decision === undefined) throw new Error("continuity rotation journal is corrupt");
  return result;
};

const parseDocument = (value: unknown, expectedArchiveId: string, expectedWorkspaceKey: string, maxRecords: number): ContinuityRotationDocument => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("continuity rotation journal is missing or corrupt");
  const document = value as Partial<ContinuityRotationDocument>;
  if ((document.schemaVersion !== 1 && document.schemaVersion !== 2) || document.archiveId !== expectedArchiveId || document.workspaceKey !== expectedWorkspaceKey ||
      !Number.isSafeInteger(document.lastEpoch) || (document.lastEpoch as number) < 0 || !Array.isArray(document.rotations)) throw new Error("continuity rotation journal is malformed or bound to another conversation/workspace");
  const schemaVersion = document.schemaVersion;
  const rawRotations = document.rotations;
  if (rawRotations.length > maxRecords) throw new Error("continuity rotation journal record quota was exceeded");
  const lastEpoch = document.lastEpoch as number;
  // Records are returned normalized: unknown fields never flow back to callers.
  const rotations: ContinuityRotationRecord[] = [];
  const seen = new Set<string>();
  let previousEpoch = 0;
  for (const raw of rawRotations) {
    const record = parseRecord(raw, schemaVersion);
    if (seen.has(record.rotationId) || record.epoch <= previousEpoch || record.epoch > lastEpoch) throw new Error("continuity rotation journal is corrupt");
    seen.add(record.rotationId);
    previousEpoch = record.epoch;
    rotations.push(record);
  }
  return { schemaVersion, archiveId: expectedArchiveId, workspaceKey: expectedWorkspaceKey, lastEpoch, rotations };
};

const currentSession = (document: ContinuityRotationDocument): string | null => {
  for (let index = document.rotations.length - 1; index >= 0; index--) {
    const record = document.rotations[index]!;
    if (record.phase === "active") return record.newPhysicalSessionId ?? null;
    if (record.phase === "reconciled") return record.decision?.outcome === "confirmed-submitted" ? record.newPhysicalSessionId ?? record.oldPhysicalSessionId : record.oldPhysicalSessionId;
    // An abandoned attempt never happened: the old session stays current and
    // a retained fresh-session tombstone is never resumed.
    if (record.phase === "aborted") return record.oldPhysicalSessionId;
  }
  return null;
};

/** Crash-safe rotation journal. Intent is durably recorded in the `preparing`
 * phase before any session creation, and the `submitting` phase (with the
 * submission id) is durably recorded before a continuation may be sent. A
 * record left in `submitting` after a restart is never replayed or assumed
 * rolled back: new rotations are rejected until an explicit reconciliation
 * records the operator decision. A rotation that never reached a submission
 * can be explicitly aborted before any continuation is sent; submitted work
 * is only ever resolved through reconciliation. Journal documents use schema
 * v2 once they carry an aborted record; valid v1 journals stay readable and
 * are upgraded only through a successful compare-and-set mutation.
 *
 * Durability gating sits at the external-effect commitment points: `begin`,
 * `beginSubmission` and `abort` call `assertDurablePublication()`. The
 * bookkeeping transitions inside an already-gated rotation add no new external
 * commitment, and every POSIX write still runs the per-mutation directory
 * fsync, so a second instance over the same storage cannot weaken a gated
 * rotation's durability. New methods that precede an external effect must
 * call the gate first. */
export class ContinuityRotationJournal {
  readonly #state: StateProvider;
  readonly #maxRecords: number;
  constructor(root: string, options: { maxJournals?: number; maxRecords?: number; maxDocumentBytes?: number; maxTotalBytes?: number } = {}) {
    this.#maxRecords = options.maxRecords ?? ROTATION_MAX_RECORDS;
    this.#state = new StateProvider(root, {
      maxEntries: options.maxJournals ?? ROTATION_MAX_JOURNALS,
      maxValueChars: Math.ceil((options.maxDocumentBytes ?? ROTATION_MAX_DOCUMENT_BYTES) / 2),
      maxValueBytes: options.maxDocumentBytes ?? ROTATION_MAX_DOCUMENT_BYTES,
      maxTotalChars: Math.ceil((options.maxTotalBytes ?? ROTATION_MAX_TOTAL_BYTES) / 2),
      maxTotalBytes: options.maxTotalBytes ?? ROTATION_MAX_TOTAL_BYTES,
    });
  }

  async #load(archiveIdInput: unknown, workspaceKeyInput: unknown, context: FabricInvocationContext): Promise<{ revision: number; document: ContinuityRotationDocument }> {
    const id = archiveIdOf(archiveIdInput), key = workspaceKeyOf(workspaceKeyInput);
    const entry = await this.#state.invoke("get", { key: `cr:${id}` }, context) as { found?: false; revision: number; value: unknown };
    if (entry.found === false) return { revision: 0, document: { schemaVersion: 1, archiveId: id, workspaceKey: key, lastEpoch: 0, rotations: [] } };
    return { revision: entry.revision, document: parseDocument(entry.value, id, key, this.#maxRecords) };
  }

  /** Mirrors the state store's directory barrier: "unconfirmed" means this
   * journal cannot claim crash-safe publication on this platform or store. */
  get directoryBarrier(): StateDirectoryBarrier { return this.#state.directoryBarrier; }

  /** Throws unless the backing store can confirm directory durability. The
   * operations that gate external effects — beginning a rotation, publishing
   * a submission intent, and abandoning a preparation — must never promise
   * crash-safe publication over an unconfirmed barrier. */
  assertDurablePublication(): void {
    if (this.directoryBarrier !== "fsync") {
      throw new Error("continuity rotation journal cannot confirm directory durability; refuse crash-safe publication");
    }
  }

  async status(archiveIdInput: unknown, workspaceKeyInput: unknown, context: FabricInvocationContext): Promise<ContinuityRotationStatus> {
    const { revision, document } = await this.#load(archiveIdInput, workspaceKeyInput, context);
    // The document is freshly parsed for every read and never retained, so
    // the records can be handed out without a second full-document clone.
    return { archiveId: document.archiveId, revision, lastEpoch: document.lastEpoch, rotations: document.rotations };
  }

  async begin(input: ContinuityRotationBeginInput, context: FabricInvocationContext): Promise<ContinuityRotationRecord> {
    this.assertDurablePublication();
    const id = archiveIdOf(input.archiveId), key = workspaceKeyOf(input.workspaceKey);
    const checkpointHash = hash64(input.checkpointHash);
    if (!Number.isSafeInteger(input.archiveWatermark) || input.archiveWatermark < 0) throw new Error("continuity rotation archive watermark is invalid");
    if ((input.archiveWatermark === 0) !== (input.archiveHeadHash === "")) throw new Error("continuity rotation archive watermark and head hash disagree");
    const headHash = input.archiveHeadHash === "" ? "" : hash64(input.archiveHeadHash);
    const oldSession = sessionOf(input.oldPhysicalSessionId);
    const { revision, document } = await this.#load(id, key, context);
    if (document.rotations.some(record => record.phase === "preparing" || record.phase === "created" || record.phase === "submitting" || record.phase === "blocked"))
      throw new Error("continuity rotation journal has an unresolved rotation; reconcile it before beginning another");
    const current = currentSession(document);
    if (current !== null && current !== oldSession) throw new Error("continuity rotation must continue from the current physical session");
    const record: ContinuityRotationRecord = {
      rotationId: `ro_${randomBytes(16).toString("hex")}`, epoch: document.lastEpoch + 1, checkpointHash,
      archiveWatermark: input.archiveWatermark, archiveHeadHash: headHash, oldPhysicalSessionId: oldSession,
      phase: "preparing", uncertainEffects: false,
    };
    const rotations = [...document.rotations, record];
    if (rotations.length > this.#maxRecords) throw new Error("continuity rotation journal record quota reached; earlier records retained");
    const updated: ContinuityRotationDocument = { ...document, lastEpoch: record.epoch, rotations };
    await this.#state.setSerialized({ key: `cr:${id}`, value: updated, text: JSON.stringify(updated), expectedRevision: revision }, context);
    return structuredClone(record);
  }

  async #mutate(archiveIdInput: unknown, workspaceKeyInput: unknown, rotationIdInput: unknown, context: FabricInvocationContext,
    apply: (record: ContinuityRotationRecord, document: ContinuityRotationDocument) => void): Promise<ContinuityRotationRecord> {
    const id = archiveIdOf(archiveIdInput), key = workspaceKeyOf(workspaceKeyInput);
    if (typeof rotationIdInput !== "string" || !/^ro_[a-f0-9]{32}$/u.test(rotationIdInput)) throw new Error("continuity rotation id is malformed");
    const { revision, document } = await this.#load(id, key, context);
    const index = document.rotations.findIndex(record => record.rotationId === rotationIdInput);
    if (index < 0) throw new Error("continuity rotation is unknown in this journal");
    const rotations = structuredClone(document.rotations);
    const record = rotations[index]!;
    apply(record, { ...document, rotations });
    const updated: ContinuityRotationDocument = { ...document, rotations };
    await this.#state.setSerialized({ key: `cr:${id}`, value: updated, text: JSON.stringify(updated), expectedRevision: revision }, context);
    return structuredClone(record);
  }

  /** Records the freshly created physical session. The id must never have been
   * seen in any rotation: a resumed or reused session id is rejected. */
  async recordSessionCreated(input: { archiveId: string; workspaceKey: string; rotationId: string; newPhysicalSessionId: string }, context: FabricInvocationContext): Promise<ContinuityRotationRecord> {
    return await this.#mutate(input.archiveId, input.workspaceKey, input.rotationId, context, (record, document) => {
      if (record.phase !== "preparing") throw new Error("continuity rotation is not in the preparing phase");
      const newSession = sessionOf(input.newPhysicalSessionId);
      const known = new Set<string>();
      for (const other of document.rotations) {
        known.add(other.oldPhysicalSessionId);
        if (other.newPhysicalSessionId !== undefined) known.add(other.newPhysicalSessionId);
      }
      if (known.has(newSession)) throw new Error("continuity rotation requires a fresh physical session, not a resume");
      record.phase = "created";
      record.newPhysicalSessionId = newSession;
    });
  }

  /** Durably publishes the submission intent before any continuation is sent.
   * After this point an unacknowledged submission must be reconciled, never
   * replayed. */
  async beginSubmission(input: { archiveId: string; workspaceKey: string; rotationId: string; submissionId: string }, context: FabricInvocationContext): Promise<ContinuityRotationRecord> {
    this.assertDurablePublication();
    return await this.#mutate(input.archiveId, input.workspaceKey, input.rotationId, context, record => {
      if (record.phase !== "created") throw new Error("continuity rotation has no created session to submit");
      const submissionId = boundedId(input.submissionId, "submission id");
      record.phase = "submitting";
      record.submissionId = submissionId;
      record.uncertainEffects = true;
    });
  }

  async complete(input: { archiveId: string; workspaceKey: string; rotationId: string }, context: FabricInvocationContext): Promise<ContinuityRotationRecord> {
    return await this.#mutate(input.archiveId, input.workspaceKey, input.rotationId, context, record => {
      if (record.phase !== "submitting") throw new Error("continuity rotation submission is not in progress");
      record.phase = "active";
      record.uncertainEffects = false;
    });
  }

  async markBlocked(input: { archiveId: string; workspaceKey: string; rotationId: string; note?: string }, context: FabricInvocationContext): Promise<ContinuityRotationRecord> {
    return await this.#mutate(input.archiveId, input.workspaceKey, input.rotationId, context, record => {
      if (record.phase !== "submitting") throw new Error("continuity rotation submission is not in progress");
      record.phase = "blocked";
      if (input.note !== undefined) record.note = noteOf(input.note);
    });
  }

  /** Explicitly abandons a rotation that never published a submission intent.
   * `preparing` keeps the original bindings and the old session current;
   * `created` retains the fresh session id as a never-reuse tombstone. Work
   * that already reached `submitting` or `blocked` must be reconciled
   * instead, and terminal records never transition again. The operator
   * supplies the journal revision and epoch they observed, so a stale view
   * conflicts instead of silently abandoning newer state. */
  async abort(input: { archiveId: string; workspaceKey: string; rotationId: string; expectedRevision: number; expectedEpoch: number; reason: string }, context: FabricInvocationContext): Promise<ContinuityRotationRecord> {
    this.assertDurablePublication();
    const id = archiveIdOf(input.archiveId), key = workspaceKeyOf(input.workspaceKey);
    if (typeof input.rotationId !== "string" || !/^ro_[a-f0-9]{32}$/u.test(input.rotationId)) throw new Error("continuity rotation id is malformed");
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) throw new Error("continuity rotation abort requires the observed journal revision");
    if (!Number.isSafeInteger(input.expectedEpoch) || (input.expectedEpoch as number) < 1) throw new Error("continuity rotation abort requires the observed epoch");
    const reason = noteOf(input.reason);
    const { revision, document } = await this.#load(id, key, context);
    if (revision !== input.expectedRevision) throw new Error("continuity rotation journal revision conflict; read before retrying");
    const index = document.rotations.findIndex(record => record.rotationId === input.rotationId);
    if (index < 0) throw new Error("continuity rotation is unknown in this journal");
    const observed = document.rotations[index]!;
    if (observed.epoch !== input.expectedEpoch) throw new Error("continuity rotation epoch conflict; read before retrying");
    if (observed.phase !== "preparing" && observed.phase !== "created") {
      throw new Error("continuity rotation can only be aborted before a submission is published; use explicit reconciliation for submitted work");
    }
    const rotations = structuredClone(document.rotations);
    const record = rotations[index]!;
    record.phase = "aborted";
    record.uncertainEffects = false;
    record.note = reason;
    const updated: ContinuityRotationDocument = { ...document, schemaVersion: 2, rotations };
    await this.#state.setSerialized({ key: `cr:${id}`, value: updated, text: JSON.stringify(updated), expectedRevision: revision }, context);
    return structuredClone(record);
  }

  /** Records the explicit operator decision about an ambiguous submission.
   * This is the only exit from `blocked`, and it never replays effects. */
  async reconcile(input: { archiveId: string; workspaceKey: string; rotationId: string; decision: ContinuityRotationDecision; note: string }, context: FabricInvocationContext): Promise<ContinuityRotationRecord> {
    return await this.#mutate(input.archiveId, input.workspaceKey, input.rotationId, context, record => {
      if (record.phase !== "blocked") throw new Error("continuity rotation is not blocked");
      if (input.decision !== "confirmed-submitted" && input.decision !== "confirmed-not-submitted") throw new Error("continuity rotation reconciliation decision is malformed");
      record.phase = "reconciled";
      record.uncertainEffects = false;
      record.decision = { outcome: input.decision, note: noteOf(input.note) };
    });
  }
}
