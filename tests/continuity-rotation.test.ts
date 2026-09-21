import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContinuityRotationJournal, type ContinuityRotationRecord } from "../src/continuity/rotation-journal.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const context = { cwd: "/workspace" };
const journalRoot = (): string => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-continuity-rotation-")));
  roots.push(root);
  return path.join(root, "journal");
};
const checkpoint = "a".repeat(64);

describe("crash-safe rotation journal", () => {
  it("publishes intent before session creation and submission before continuation", async () => {
    const journal = new ContinuityRotationJournal(journalRoot());
    const begin = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint,
      archiveWatermark: 3, archiveHeadHash: "b".repeat(64), oldPhysicalSessionId: "session-old" }, context);
    expect(begin).toMatchObject({ epoch: 1, phase: "preparing", uncertainEffects: false, oldPhysicalSessionId: "session-old", checkpointHash: checkpoint, archiveWatermark: 3 });
    // Submission intent cannot be published before a fresh session exists.
    await expect(journal.beginSubmission({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, submissionId: "submit-1" }, context)).rejects.toThrow("no created session");
    const created = await journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, newPhysicalSessionId: "session-new-1" }, context);
    expect(created).toMatchObject({ phase: "created", newPhysicalSessionId: "session-new-1" });
    const submitting = await journal.beginSubmission({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, submissionId: "submit-1" }, context);
    expect(submitting).toMatchObject({ phase: "submitting", submissionId: "submit-1", uncertainEffects: true });
    const active = await journal.complete({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId }, context);
    expect(active).toMatchObject({ phase: "active", uncertainEffects: false });
    // Unknown rotations and wrong phases are explicit errors.
    await expect(journal.complete({ archiveId: "conv-1", workspaceKey: "key", rotationId: `ro_${"c".repeat(32)}` }, context)).rejects.toThrow("unknown");
    await expect(journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, newPhysicalSessionId: "session-new-2" }, context)).rejects.toThrow("not in the preparing phase");
  });

  it("requires fresh sessions and rejects stale old-session admissions across repeated rotations", async () => {
    const journal = new ContinuityRotationJournal(journalRoot());
    const first = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    await expect(journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: first.rotationId, newPhysicalSessionId: "session-A" }, context)).rejects.toThrow("fresh physical session");
    await journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: first.rotationId, newPhysicalSessionId: "session-B" }, context);
    await journal.beginSubmission({ archiveId: "conv-1", workspaceKey: "key", rotationId: first.rotationId, submissionId: "s1" }, context);
    await journal.complete({ archiveId: "conv-1", workspaceKey: "key", rotationId: first.rotationId }, context);
    // A second rotation must continue from the current physical session B, not the retired A.
    await expect(journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context)).rejects.toThrow("current physical session");
    const second = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-B" }, context);
    expect(second.epoch).toBe(2);
    // session-B was already used; a rotation can never resume a known physical session.
    await expect(journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: second.rotationId, newPhysicalSessionId: "session-B" }, context)).rejects.toThrow("fresh physical session");
    await journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: second.rotationId, newPhysicalSessionId: "session-C" }, context);
    await journal.beginSubmission({ archiveId: "conv-1", workspaceKey: "key", rotationId: second.rotationId, submissionId: "s2" }, context);
    await journal.complete({ archiveId: "conv-1", workspaceKey: "key", rotationId: second.rotationId }, context);
    const status = await journal.status("conv-1", "key", context);
    expect(status.rotations.map(record => record.phase)).toEqual(["active", "active"]);
    expect(status.lastEpoch).toBe(2);
  });

  it("blocks new rotations after an ambiguous submission and requires explicit reconciliation", async () => {
    const root = journalRoot();
    const first = new ContinuityRotationJournal(root);
    const begin = await first.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 1, archiveHeadHash: "b".repeat(64), oldPhysicalSessionId: "session-A" }, context);
    await first.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, newPhysicalSessionId: "session-B" }, context);
    await first.beginSubmission({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, submissionId: "submit-1" }, context);
    // A restart is a fresh journal instance over the same durable storage. It sees
    // the interrupted submission, cannot begin a new rotation, and has no replay
    // path: only an explicit operator decision resolves the ambiguity.
    const restarted = new ContinuityRotationJournal(root);
    const status = await restarted.status("conv-1", "key", context);
    expect(status.rotations[0]).toMatchObject({ phase: "submitting", uncertainEffects: true, submissionId: "submit-1" });
    await expect(restarted.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 1, archiveHeadHash: "b".repeat(64), oldPhysicalSessionId: "session-B" }, context)).rejects.toThrow("unresolved rotation");
    const blocked = await restarted.markBlocked({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, note: "restart lost the submission acknowledgement" }, context);
    expect(blocked).toMatchObject({ phase: "blocked", uncertainEffects: true });
    await expect(restarted.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 1, archiveHeadHash: "b".repeat(64), oldPhysicalSessionId: "session-B" }, context)).rejects.toThrow("unresolved rotation");
    // confirmed-submitted makes the fresh session current; the next rotation continues from it.
    const reconciled = await restarted.reconcile({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, decision: "confirmed-submitted", note: "operator verified delivery in the session transcript" }, context);
    expect(reconciled).toMatchObject({ phase: "reconciled", uncertainEffects: false });
    const next = await restarted.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 1, archiveHeadHash: "b".repeat(64), oldPhysicalSessionId: "session-B" }, context);
    expect(next.epoch).toBe(2);
  });

  it("keeps the old session current when reconciliation confirms no submission", async () => {
    const journal = new ContinuityRotationJournal(journalRoot());
    const begin = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    await journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, newPhysicalSessionId: "session-B" }, context);
    await journal.beginSubmission({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, submissionId: "submit-1" }, context);
    await journal.markBlocked({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, note: "ambiguous" }, context);
    await journal.reconcile({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, decision: "confirmed-not-submitted", note: "verified never sent" }, context);
    await expect(journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-B" }, context)).rejects.toThrow("current physical session");
    await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
  });

  it("resolves concurrent rotation begins to one winner and one explicit conflict", async () => {
    const root = journalRoot();
    const left = new ContinuityRotationJournal(root), right = new ContinuityRotationJournal(root);
    const input = { archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" };
    const results = await Promise.allSettled([left.begin(input, context), right.begin(input, context)]);
    const fulfilled = results.filter(result => result.status === "fulfilled") as PromiseFulfilledResult<ContinuityRotationRecord>[];
    expect(fulfilled).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const status = await left.status("conv-1", "key", context);
    expect(status.rotations).toHaveLength(1);
  });

  it("isolates conversations and validates archive bindings", async () => {
    const journal = new ContinuityRotationJournal(journalRoot());
    await journal.begin({ archiveId: "conv-1", workspaceKey: "key-1", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    await expect(journal.status("conv-1", "key-2", context)).rejects.toThrow("another conversation/workspace");
    await expect(journal.status("conv-2", "key-1", context)).resolves.toMatchObject({ rotations: [] });
    await expect(journal.begin({ archiveId: "conv-1", workspaceKey: "key-1", checkpointHash: "short", archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context)).rejects.toThrow("hash is malformed");
    await expect(journal.begin({ archiveId: "conv-1", workspaceKey: "key-1", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "b".repeat(64), oldPhysicalSessionId: "session-A" }, context)).rejects.toThrow("watermark and head hash disagree");
    await expect(journal.begin({ archiveId: "conv-1", workspaceKey: "key-1", checkpointHash: checkpoint, archiveWatermark: 1, archiveHeadHash: "b".repeat(64), oldPhysicalSessionId: "session-A" }, context)).rejects.toThrow("unresolved rotation");
  });

  it("rejects a tampered journal document fail-closed", async () => {
    const root = journalRoot();
    const journal = new ContinuityRotationJournal(root);
    await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    const state = JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8")) as { entries: Record<string, { value: { archiveId?: string; rotations?: Record<string, unknown>[] } }> };
    const entry = Object.values(state.entries).find(item => item.value.archiveId === "conv-1")!;
    entry.value.rotations![0]!.epoch = 5;
    fs.writeFileSync(path.join(root, "state.json"), JSON.stringify(state));
    const reopened = new ContinuityRotationJournal(root);
    await expect(reopened.status("conv-1", "key", context)).rejects.toThrow("corrupt");
  });
});

describe("pre-submission abandonment", () => {
  /** Shared read-modify-write access to the stored journal document for the
   * tamper tests; one implementation instead of per-test copies. */
  type StoredJournal = { entries: Record<string, { value: { schemaVersion?: number; archiveId?: string; rotations?: Array<Record<string, unknown>> } }> };
  const storedJournal = (root: string): StoredJournal => JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8")) as StoredJournal;
  const journalEntryOf = (state: StoredJournal) => Object.values(state.entries).find(item => item.value.archiveId === "conv-1")!;
  const writeJournalRecord = (root: string, mutate: (record: Record<string, unknown>) => void): void => {
    const state = storedJournal(root);
    mutate(journalEntryOf(state).value.rotations![0]!);
    fs.writeFileSync(path.join(root, "state.json"), JSON.stringify(state));
  };

  it("aborts a preparing rotation and keeps the old session current", async () => {
    const journal = new ContinuityRotationJournal(journalRoot());
    const begin = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    const status = await journal.status("conv-1", "key", context);
    const aborted = await journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "operator abandoned the attempt" }, context);
    expect(aborted).toMatchObject({ phase: "aborted", uncertainEffects: false, note: "operator abandoned the attempt", oldPhysicalSessionId: "session-A", epoch: 1, checkpointHash: checkpoint });
    expect(aborted.newPhysicalSessionId).toBeUndefined();
    expect(aborted.submissionId).toBeUndefined();
    // The old session is still current: a wrong old session is rejected.
    await expect(journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-B" }, context)).rejects.toThrow("current physical session");
    const next = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    expect(next.epoch).toBe(2);
    // Late completions for the abandoned record are refused.
    await expect(journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, newPhysicalSessionId: "session-B" }, context)).rejects.toThrow("not in the preparing phase");
    await expect(journal.beginSubmission({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, submissionId: "s" }, context)).rejects.toThrow("no created session");
    // Aborting a terminal record never transitions again.
    const after = await journal.status("conv-1", "key", context);
    await expect(journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: after.revision, expectedEpoch: begin.epoch, reason: "twice" }, context)).rejects.toThrow("reconciliation");
  });

  it("aborts a created rotation and retains the fresh session as a never-reuse tombstone", async () => {
    const journal = new ContinuityRotationJournal(journalRoot());
    const begin = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    await journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, newPhysicalSessionId: "session-B" }, context);
    const status = await journal.status("conv-1", "key", context);
    const aborted = await journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "session creation raced with shutdown" }, context);
    expect(aborted).toMatchObject({ phase: "aborted", newPhysicalSessionId: "session-B", oldPhysicalSessionId: "session-A", uncertainEffects: false });
    // The old session remains current and a new rotation may begin from it.
    const next = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    expect(next.epoch).toBe(2);
    // The tombstone session id can never be reused by a later rotation.
    await expect(journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: next.rotationId, newPhysicalSessionId: "session-B" }, context)).rejects.toThrow("fresh physical session");
  });

  it("refuses to abort submitted, blocked or terminal rotations", async () => {
    const journal = new ContinuityRotationJournal(journalRoot());
    const begin = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    await journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, newPhysicalSessionId: "session-B" }, context);
    await journal.beginSubmission({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, submissionId: "submit-1" }, context);
    let status = await journal.status("conv-1", "key", context);
    await expect(journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "too late" }, context)).rejects.toThrow("reconciliation");
    await journal.markBlocked({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, note: "ambiguous" }, context);
    status = await journal.status("conv-1", "key", context);
    await expect(journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "too late" }, context)).rejects.toThrow("reconciliation");
    await journal.reconcile({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, decision: "confirmed-not-submitted", note: "operator verified" }, context);
    status = await journal.status("conv-1", "key", context);
    await expect(journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "terminal" }, context)).rejects.toThrow("reconciliation");
    expect((await journal.status("conv-1", "key", context)).rotations[0]).toMatchObject({ phase: "reconciled" });
  });

  it("requires the observed revision and epoch and rejects stale or foreign views", async () => {
    const journal = new ContinuityRotationJournal(journalRoot());
    const begin = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    const status = await journal.status("conv-1", "key", context);
    await expect(journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision - 1, expectedEpoch: begin.epoch, reason: "stale" }, context)).rejects.toThrow("revision conflict");
    await expect(journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch + 1, reason: "stale" }, context)).rejects.toThrow("epoch conflict");
    await expect(journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: `ro_${"c".repeat(32)}`, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "unknown" }, context)).rejects.toThrow("unknown");
    await expect(journal.abort({ archiveId: "conv-1", workspaceKey: "key-2", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "foreign" }, context)).rejects.toThrow("another conversation/workspace");
    await expect(journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "x".repeat(513) }, context)).rejects.toThrow("note is malformed");
    await expect(journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: 1.5, expectedEpoch: begin.epoch, reason: "fractional" } as never, context)).rejects.toThrow("observed journal revision");
    expect((await journal.status("conv-1", "key", context)).rotations[0]).toMatchObject({ phase: "preparing" });
  });

  it("aborts across a restart and resolves concurrent aborts to one winner", async () => {
    const root = journalRoot();
    const first = new ContinuityRotationJournal(root);
    const begin = await first.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    const status = await first.status("conv-1", "key", context);
    const restarted = new ContinuityRotationJournal(root);
    const results = await Promise.allSettled([
      first.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "left wins" }, context),
      restarted.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "right loses" }, context),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const final = await restarted.status("conv-1", "key", context);
    expect(final.rotations[0]).toMatchObject({ phase: "aborted" });
    expect(final.rotations[0]).not.toHaveProperty("submissionId");
  });

  it("upgrades a v1 journal to v2 only through a successful abort mutation", async () => {
    const root = journalRoot();
    const journal = new ContinuityRotationJournal(root);
    const begin = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    // A fresh journal is still a readable v1 document with no aborted record.
    expect(journalEntryOf(storedJournal(root)).value.schemaVersion).toBe(1);
    const status = await journal.status("conv-1", "key", context);
    await journal.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "upgrade through mutation" }, context);
    expect(journalEntryOf(storedJournal(root)).value.schemaVersion).toBe(2);
    const reopened = new ContinuityRotationJournal(root);
    expect((await reopened.status("conv-1", "key", context)).rotations[0]).toMatchObject({ phase: "aborted" });
    // A hand-written v1 document carrying an aborted record is rejected fail-closed.
    const tampered = storedJournal(root);
    const entry = journalEntryOf(tampered);
    (entry.value as { schemaVersion?: number }).schemaVersion = 1;
    fs.writeFileSync(path.join(root, "state.json"), JSON.stringify(tampered));
    const rejected = new ContinuityRotationJournal(root);
    await expect(rejected.status("conv-1", "key", context)).rejects.toThrow("corrupt");
  });

  it("enforces phase invariants fail-closed and returns normalized records", async () => {
    const root = journalRoot();
    const journal = new ContinuityRotationJournal(root);
    const begin = await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    await journal.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, newPhysicalSessionId: "session-B" }, context);
    await journal.beginSubmission({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, submissionId: "submit-1" }, context);
    await journal.complete({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId }, context);
    // An active record without its submission id is corrupt.
    writeJournalRecord(root, record => { delete record.submissionId; });
    await expect(new ContinuityRotationJournal(root).status("conv-1", "key", context)).rejects.toThrow("corrupt");
    // A blocked record must keep uncertain effects true.
    writeJournalRecord(root, record => { record.phase = "blocked"; record.submissionId = "submit-1"; record.uncertainEffects = false; });
    await expect(new ContinuityRotationJournal(root).status("conv-1", "key", context)).rejects.toThrow("corrupt");
    // An aborted record must not carry a submission intent.
    writeJournalRecord(root, record => { record.phase = "aborted"; record.uncertainEffects = false; record.submissionId = "submit-1"; });
    await expect(new ContinuityRotationJournal(root).status("conv-1", "key", context)).rejects.toThrow("corrupt");
    // A clean active record is readable and normalization drops unknown fields.
    writeJournalRecord(root, record => { record.phase = "active"; record.uncertainEffects = false; delete record.submissionId; record.submissionId = "submit-1"; record.extraField = true; });
    const reopened = new ContinuityRotationJournal(root);
    const status = await reopened.status("conv-1", "key", context);
    expect(status.rotations[0]).not.toHaveProperty("extraField");
    expect(status.rotations[0]).toMatchObject({ phase: "active", submissionId: "submit-1" });
  });

  it("names the exact field when base-shape validation fails", async () => {
    const root = journalRoot();
    const journal = new ContinuityRotationJournal(root);
    await journal.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    writeJournalRecord(root, record => { record.epoch = 0; });
    await expect(new ContinuityRotationJournal(root).status("conv-1", "key", context)).rejects.toThrow('corrupt: field "epoch"');
  });
});

describe("durability capability gate", () => {
  it("refuses crash-safe intent operations when the barrier is unconfirmed", async () => {
    const root = journalRoot();
    class UnconfirmedJournal extends ContinuityRotationJournal {
      override get directoryBarrier() { return "unconfirmed" as const; }
    }
    const unconfirmed = new UnconfirmedJournal(root);
    await expect(unconfirmed.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context)).rejects.toThrow("cannot confirm directory durability");
    // Reads still work: only operations that gate external effects refuse.
    expect((await unconfirmed.status("conv-1", "key", context)).rotations).toEqual([]);
    const confirmed = new ContinuityRotationJournal(root);
    const begin = await confirmed.begin({ archiveId: "conv-1", workspaceKey: "key", checkpointHash: checkpoint, archiveWatermark: 0, archiveHeadHash: "", oldPhysicalSessionId: "session-A" }, context);
    await confirmed.recordSessionCreated({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, newPhysicalSessionId: "session-B" }, context);
    const status = await confirmed.status("conv-1", "key", context);
    await expect(unconfirmed.beginSubmission({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, submissionId: "s1" }, context)).rejects.toThrow("cannot confirm directory durability");
    await expect(unconfirmed.abort({ archiveId: "conv-1", workspaceKey: "key", rotationId: begin.rotationId, expectedRevision: status.revision, expectedEpoch: begin.epoch, reason: "gate" }, context)).rejects.toThrow("cannot confirm directory durability");
    // The refusals mutated nothing.
    expect((await unconfirmed.status("conv-1", "key", context)).rotations[0]).toMatchObject({ phase: "created" });
  });

  it("passes silently on a confirmed barrier", () => {
    const journal = new ContinuityRotationJournal(journalRoot());
    expect(journal.directoryBarrier).toBe(process.platform === "win32" ? "unconfirmed" : "fsync");
    if (process.platform !== "win32") expect(() => journal.assertDurablePublication()).not.toThrow();
  });
});
