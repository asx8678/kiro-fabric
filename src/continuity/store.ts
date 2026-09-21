import { randomBytes } from "node:crypto";
import { semanticDigest } from "../core/semantic-digest.js";
import type { FabricInvocationContext } from "../protocol.js";
import { StateProvider } from "../providers/state-provider.js";
import {
  declarationText, digest, MAX_PUBLICATIONS, MAX_RECORDS, parseFacts, parseChecks, parseTask, positiveInteger,
  requestId, snapshot, sourceHash, taskId, captureMetadata, type ContinuitySnapshot, type ContinuityTask, type ContinuityRecord,
} from "./records.js";

export interface ContinuityStoreOptions { maxTasks: number; maxTaskBytes: number; maxTotalBytes: number }
export type ContinuityHandle = { taskId: string; revision: number; hash: string; admittedRecords: number };
const handle = (source: ContinuitySnapshot): ContinuityHandle => ({
  taskId: source.task.taskId, revision: source.revision, hash: source.hash, admittedRecords: source.task.records.length,
});

/** Private instance: never registered as the public arbitrary-value state provider. */
export class ContinuityStore {
  readonly #state: StateProvider;
  readonly #maxTasks: number;
  constructor(root: string, options: ContinuityStoreOptions) {
    this.#maxTasks = options.maxTasks;
    this.#state = new StateProvider(root, {
      maxEntries: options.maxTasks, maxValueChars: options.maxTaskBytes, maxTotalChars: options.maxTotalBytes,
      maxValueBytes: options.maxTaskBytes, maxTotalBytes: options.maxTotalBytes,
    });
  }
  async create(objective: unknown, constraints: unknown, context: FabricInvocationContext): Promise<ContinuityHandle> {
    if (constraints !== undefined && (!Array.isArray(constraints) || constraints.length > 31)) throw new Error("continuity constraints exceed bounds");
    const facts = [{ kind: "objective" as const, text: declarationText(objective) },
      ...((constraints ?? []) as unknown[]).map(text => ({ kind: "constraint" as const, text: declarationText(text) }))];
    const task: ContinuityTask = {
      schemaVersion: 1, taskId: `ct_${randomBytes(16).toString("hex")}`,
      records: facts.map((fact, index) => ({ sequence: index + 1, provenance: "declared", ...fact })), publications: [],
    };
    return handle(await this.#save(task, 0, context));
  }
  async read(id: unknown, expectedRevision: unknown, context: FabricInvocationContext): Promise<ContinuitySnapshot> {
    const key = taskId(id);
    if (expectedRevision !== undefined) positiveInteger(expectedRevision);
    const entry = await this.#state.invoke("get", { key }, context) as { found?: false; revision: number; value: unknown };
    if (entry.found === false) throw new Error("continuity task not found in this workspace");
    if (expectedRevision !== undefined && expectedRevision !== entry.revision) throw new Error("continuity revision conflict; read before retrying");
    const task = parseTask(entry.value);
    if (task.taskId !== key) throw new Error("continuity task identity mismatch");
    return snapshot(task, entry.revision);
  }
  async checkpoint(id: unknown, expectedRevision: unknown, publicationId: unknown, values: unknown, context: FabricInvocationContext, captureCurrentExecution = false, checkValues: unknown = []) {
    const checks = parseChecks(checkValues);
    const revision = positiveInteger(expectedRevision), idempotencyKey = requestId(publicationId), facts = parseFacts(values ?? [], captureCurrentExecution || checks.length > 0);
    // Preserve v1 publication identities for declaration-only callers. Capture is
    // part of request identity, but retrying a committed request never recaptures.
    const identity = checks.length
      ? digest("continuity-publication-v3", { expectedRevision: revision, facts, captureCurrentExecution, checks })
      : captureCurrentExecution
      ? digest("continuity-publication-v2", { expectedRevision: revision, facts, captureCurrentExecution: true })
      : digest("continuity-publication-v1", { expectedRevision: revision, facts });
    const current = await this.read(id, undefined, context);
    const existing = current.task.publications.find(publication => publication.requestId === idempotencyKey);
    if (existing) {
      if (existing.requestHash !== identity) throw new Error("continuity publication request ID conflict");
      const record = existing.captureSequence === undefined ? undefined : current.task.records[existing.captureSequence - 1];
      const capture = record?.kind === "capture" ? {
        executionId: record.executionId, throughOperation: record.throughOperation, admittedOperations: record.admittedOperations,
        capturedOperations: record.capturedOperations, unsupportedOperations: record.unsupportedOperations, excludedOperations: record.excludedOperations,
      } : undefined;
      return { ...handle(current), alreadyPublished: true, publishedThroughSequence: existing.throughSequence, ...(capture ? { capture } : {}) };
    }
    if (current.revision !== revision) throw new Error("continuity revision conflict; read before retrying");
    // Only this host closure can supply observations. Never accept them in args.
    if (captureCurrentExecution && !context.continuityCapture) throw new Error("continuity capture requires an enabled host execution context");
    const captured = captureCurrentExecution ? context.continuityCapture!() : undefined;
    const records: ContinuityRecord[] = [...current.task.records];
    for (const fact of facts) records.push({ sequence: records.length + 1, provenance: "declared", ...fact });
    let captureSequence: number | undefined;
    const capture = captured ? captureMetadata({ executionId: captured.executionId, throughOperation: captured.throughOperation,
      admittedOperations: captured.admittedOperations, capturedOperations: captured.capturedOperations,
      unsupportedOperations: captured.unsupportedOperations, excludedOperations: captured.excludedOperations }) : undefined;
    if (captured && capture) {
      const identities = new Map(records.filter(record => record.kind === "operation").map(record => [`${record.executionId}/${record.operationSequence}`, record]));
      for (const receipt of captured.receipts) {
        const key = `${receipt.executionId}/${receipt.operationSequence}`, prior = identities.get(key);
        if (prior) {
          const { sequence: _sequence, provenance: _provenance, kind: _kind, ...original } = prior;
          if (semanticDigest("continuity-receipt-v1", original) !== semanticDigest("continuity-receipt-v1", receipt)) throw new Error("continuity operation identity conflict");
        } else {
          const record: ContinuityRecord = { sequence: records.length + 1, provenance: "host-observed", kind: "operation", ...receipt };
          records.push(record); identities.set(key, record);
        }
      }
      captureSequence = records.length + 1;
      records.push({ sequence: captureSequence, provenance: "host-observed", kind: "capture", ...capture });
    }
    for (const check of checks) {
      if (check.evidence === "captured" && !captured) throw new Error("captured check evidence requires captureCurrentExecution");
      const evidence = check.evidence === "captured" ? records.filter(record => record.kind === "operation" &&
        record.executionId === captured!.executionId && record.operationSequence <= captured!.throughOperation).map(record => record.sequence) : check.evidence;
      if (evidence.length > 32 || evidence.some(sequence => records[sequence - 1]?.kind !== "operation")) throw new Error("check evidence must reference at most 32 retained host receipts");
      records.push({ sequence: records.length + 1, provenance: "declared", kind: "check", ...check, evidence });
    }
    if (records.length > MAX_RECORDS || current.task.publications.length >= MAX_PUBLICATIONS) {
      throw new Error("continuity record/publication quota reached; original records retained");
    }
    const upgraded = current.task.schemaVersion === 3 || checks.length > 0 || captured?.receipts.some(receipt => receipt.diagnostic || receipt.sources || receipt.settledBeforeDispatch !== undefined);
    const task: ContinuityTask = { ...current.task, ...(upgraded ? { schemaVersion: 3 as const, captureVersion: 1 as const } : captured ? { schemaVersion: 2 as const, captureVersion: 1 as const } : {}), records,
      publications: [...current.task.publications, { requestId: idempotencyKey, requestHash: identity, throughSequence: records.length,
        ...(captureSequence === undefined ? {} : { captureSequence }) }] };
    const saved = await this.#save(task, revision, context);
    return { ...handle(saved), alreadyPublished: false, publishedThroughSequence: records.length, ...(capture ? { capture } : {}) };
  }
  async expandSource(id: unknown, revision: unknown, hash: unknown, context: FabricInvocationContext): Promise<ContinuitySnapshot> {
    const expected = sourceHash(hash);
    const source = await this.read(id, positiveInteger(revision), context);
    if (source.hash !== expected) throw new Error("continuity source hash mismatch; source pointer is stale");
    return source;
  }
  async list(context: FabricInvocationContext) {
    const result = await this.#state.invoke("list", { limit: this.#maxTasks }, context) as {
      revision: number; entries: { key: string; revision: number; updatedAt: number }[];
    };
    const tasks = result.entries.map(entry => ({ taskId: taskId(entry.key), revision: entry.revision, updatedAt: entry.updatedAt }))
      .sort((left, right) => left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0);
    return { indexRevision: result.revision, tasks };
  }
  async delete(id: unknown, expectedRevision: unknown, context: FabricInvocationContext) {
    const source = await this.read(id, positiveInteger(expectedRevision), context);
    await this.#state.invoke("delete", { key: source.task.taskId, expectedRevision: source.revision }, context);
    return { taskId: source.task.taskId, deleted: true as const };
  }
  async #save(task: ContinuityTask, expectedRevision: number, context: FabricInvocationContext): Promise<ContinuitySnapshot> {
    const normalized = parseTask(task);
    // Quotas and CAS are checked together under StateProvider's cross-process mutation lock.
    // Do not wrap its committed-but-unacknowledged marker or retry a write here.
    const result = await this.#state.setSerialized({ key: normalized.taskId, value: normalized, text: JSON.stringify(normalized), expectedRevision }, context);
    return snapshot(normalized, result.revision);
  }
}
