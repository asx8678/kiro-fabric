import { fitsEnvelope } from "./render.js";
import { receiptSources } from "./task-view.js";
import { parseTask, taskHash, type ContinuityRecord, type ContinuitySnapshot } from "./records.js";

export interface ContinuityRecallArguments {
  taskId: string; expectedRevision?: number; hash?: string; query?: string; checkId?: string; path?: string;
  ref?: string; outcome?: "succeeded" | "failed"; offset?: number; limit?: number; snippetChars?: number;
}
export interface ContinuityRecallResult {
  taskId: string; revision: number; hash: string; total: number;
  hits: { sequence: number; kind: string; provenance: string; snippet: string; truncated: boolean;
    follow: { ref: "continuity.expand"; args: { taskId: string; expectedRevision: number; hash: string; fromSequence: number; limit: 1 } } }[];
  next: { ref: "continuity.recall"; args: ContinuityRecallArguments } | null;
  coverage: { scope: "retained-task-records"; scannedRecords: number; conversation: "not-captured"; operations: "not-captured" | "selected-prefixes"; freshness: "historical-not-reconciled" };
}
export function recallContinuity(source: ContinuitySnapshot, args: ContinuityRecallArguments, budget: number): ContinuityRecallResult {
  const task = parseTask(source.task);
  if (taskHash(task) !== source.hash) throw new Error("continuity source hash mismatch");
  const terms = [...new Set((args.query ?? "").toLowerCase().split(/\s+/u).filter(Boolean))];
  const offset = args.offset ?? 0, limit = args.limit ?? 5, snippetChars = args.snippetChars ?? 200;
  const linked = (record: ContinuityRecord): ContinuityRecord[] => record.kind === "check" ? record.evidence.map(sequence => task.records[sequence - 1]!) : [record];
  const checks = task.records.filter(record => record.kind === "check" && record.id === args.checkId);
  const checkSequences = new Set(checks.flatMap(record => record.kind === "check" ? [record.sequence, ...record.evidence] : []));
  const failed = (record: ContinuityRecord) => record.kind === "operation" ? record.outcome === "failed" || record.command?.ok === false : record.kind === "check" && record.status === "failed";
  const rows = task.records.flatMap(record => {
    if (args.checkId && !checkSequences.has(record.sequence)) return [];
    const evidence = linked(record);
    if (args.path && !evidence.some(item => receiptSources(item).some(source => source.path === args.path))) return [];
    if (args.ref && !evidence.some(item => item.kind === "operation" && item.ref === args.ref)) return [];
    if (args.outcome && !evidence.some(item => item.kind === "operation" && (args.outcome === "failed" ? failed(item) : !failed(item) && item.outcome === "succeeded"))) return [];
    const text = JSON.stringify(record), normalized = text.toLowerCase();
    if (!terms.every(term => normalized.includes(term))) return [];
    const priority = failed(record) ? 0 : record.kind === "check" && record.status !== "passed" ? 1 : 2;
    return [{ record, text, normalized, priority }];
  }).sort((a, b) => a.priority - b.priority || b.record.sequence - a.record.sequence);
  if (offset > rows.length) throw new Error("continuity recall offset is out of range");
  const result: ContinuityRecallResult = { taskId: task.taskId, revision: source.revision, hash: source.hash, total: rows.length, hits: [], next: null,
    coverage: { scope: "retained-task-records", scannedRecords: task.records.length, conversation: "not-captured",
      operations: task.records.some(record => record.kind === "capture") ? "selected-prefixes" : "not-captured", freshness: "historical-not-reconciled" } };
  const next = (at: number): ContinuityRecallResult["next"] => at < rows.length ? { ref: "continuity.recall", args: {
    ...args, taskId: task.taskId, expectedRevision: source.revision, hash: source.hash, offset: at, limit, snippetChars,
  } } : null;
  for (const row of rows.slice(offset, offset + limit)) {
    const match = terms.length ? row.normalized.indexOf(terms[0]!) : 0;
    const start = Math.max(0, match - 40), snippet = Array.from(row.text.slice(start)).slice(0, snippetChars).join("");
    const hit: ContinuityRecallResult["hits"][number] = { sequence: row.record.sequence, kind: row.record.kind, provenance: row.record.provenance,
      snippet, truncated: start > 0 || snippet.length < row.text.length,
      follow: { ref: "continuity.expand", args: { taskId: task.taskId, expectedRevision: source.revision, hash: source.hash, fromSequence: row.record.sequence, limit: 1 } } };
    const candidate = { ...result, hits: [...result.hits, hit], next: next(offset + result.hits.length + 1) };
    if (!fitsEnvelope(candidate, budget)) break;
    Object.assign(result, candidate);
  }
  if ((!result.hits.length && offset < rows.length) || !fitsEnvelope(result, budget)) throw new Error("continuity output budget too small for recall metadata and one hit");
  return result;
}
