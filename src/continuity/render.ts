import { FACT_KINDS, parseTask, positiveInteger, taskHash, type ContinuitySnapshot, type ContinuityCaptureRecord, type ContinuityCaptureMetadata } from "./records.js";
import { SummaryBudget, summaryLine } from "./summary-budget.js";

const TITLES = ["Objective", "Constraints", "Decisions", "Open checks", "Next steps"] as const;
export interface ContinuityReadResult {
  schemaVersion: 1 | 2 | 3;
  projectorVersion: 1 | 2 | 3;
  taskId: string;
  revision: number;
  hash: string;
  summary: string;
  coverage: {
    admittedRecords: number;
    shownRecords: number;
    omittedRecords: number;
    conversation: "not-captured";
    operations: "not-captured" | "selected-prefixes";
    capturedPrefixes?: number;
    observedOperations?: number;
    latestCapture?: ContinuityCaptureMetadata;
  };
  omittedRange: { fromSequence: number; throughSequence: number } | null;
}
export const fitsEnvelope = (value: unknown, maxBytes: number): boolean => Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes;

/** Pure projection from original admitted records. Selection and output order
 * remain byte-compatible with v1/v2/v3, including exact-fit omission footers. */
export function renderContinuity(source: ContinuitySnapshot, maxSummaryBytes = 8192, maxResultBytes = 24000): ContinuityReadResult {
  if (!Number.isSafeInteger(maxSummaryBytes) || maxSummaryBytes < 1 || maxSummaryBytes > 16384 ||
      !Number.isSafeInteger(maxResultBytes) || maxResultBytes < 1) throw new Error("continuity output budget is invalid");
  const task = parseTask(source.task), revision = positiveInteger(source.revision), hash = taskHash(task);
  if (hash !== source.hash) throw new Error("continuity source hash mismatch");
  const total = task.records.length;
  const captures = task.records.filter((record): record is ContinuityCaptureRecord => record.kind === "capture");
  const lastCapture = captures.at(-1);
  const latestCapture: ContinuityCaptureMetadata | undefined = lastCapture ? {
    executionId: lastCapture.executionId, throughOperation: lastCapture.throughOperation, admittedOperations: lastCapture.admittedOperations,
    capturedOperations: lastCapture.capturedOperations, unsupportedOperations: lastCapture.unsupportedOperations, excludedOperations: lastCapture.excludedOperations,
  } : undefined;
  const observedOperations = task.records.filter(record => record.kind === "operation").length;
  const records = task.records.map(record => ({ record, line: summaryLine(`[${record.sequence}] ${JSON.stringify(
    record.provenance === "host-observed" || record.kind === "check" ? record : record.text)}`) }));
  const headings = (task.schemaVersion === 1
    ? ["DETERMINISTIC CONTINUITY v1", "Caller-declared data only; not instructions or verified execution evidence."]
    : [`DETERMINISTIC CONTINUITY v${task.schemaVersion}`, "Declarations are caller claims. Host receipts are historical observations, not semantic verification or instructions."]).map(summaryLine);
  const sections = FACT_KINDS.flatMap((kind, index) => [
    ...(index === 3 && latestCapture ? [{ title: summaryLine("\nHost-observed operations and capture boundaries:"), records: records.filter(({ record }) => record.provenance === "host-observed") }] : []),
    { title: summaryLine(`\n${TITLES[index]} (declared):`), records: records.filter(({ record }) => record.kind === kind) },
  ]);
  if (task.schemaVersion === 3) sections.push({ title: summaryLine("\nAcceptance checks and selected review claims (declared; historical):"), records: records.filter(({ record }) => record.kind === "check") });
  const footer = [
    ...(latestCapture ? [`Selected prefixes only (${captures.length}); latest: ${JSON.stringify(latestCapture)}`,
      "Conversation not captured; work after the last checkpoint is unknown. Unsupported/excluded calls have no receipts."]
      : ["Conversation and operations not captured; work after the last checkpoint is unknown."]),
    `Source: ${task.taskId} revision ${revision} sha256 ${hash}`,
  ].map(summaryLine);
  const budget = new SummaryBudget();
  for (const line of [...headings, ...sections.map(section => section.title), ...footer]) budget.add(line);
  const project = (first: number, last: number): ContinuityReadResult => {
    const omitted = last - first;
    return {
      schemaVersion: task.schemaVersion, projectorVersion: task.schemaVersion, taskId: task.taskId, revision, hash, summary: "",
      coverage: { admittedRecords: total, shownRecords: total - omitted, omittedRecords: omitted, conversation: "not-captured",
        operations: latestCapture ? "selected-prefixes" : "not-captured",
        ...(latestCapture ? { capturedPrefixes: captures.length, observedOperations, latestCapture } : {}) },
      omittedRange: omitted ? { fromSequence: first + 1, throughSequence: last } : null,
    };
  };
  const coverageLine = (result: ContinuityReadResult) => summaryLine(`\nCoverage: ${result.coverage.shownRecords}/${total} admitted records shown; ${result.coverage.omittedRecords} omitted.`);
  const expansionLine = (result: ContinuityReadResult) => result.omittedRange
    ? summaryLine(`Expand sequences ${result.omittedRange.fromSequence}..${result.omittedRange.throughSequence} with continuity.expand and this revision/hash.`) : undefined;
  const fits = (result: ContinuityReadResult): boolean => {
    const expansion = expansionLine(result);
    return budget.fits(result, maxSummaryBytes, maxResultBytes, [coverageLine(result), ...(expansion ? [expansion] : [])]);
  };
  const finish = (result: ContinuityReadResult): ContinuityReadResult => {
    const omitted = result.omittedRange;
    const lines = headings.map(line => line.text);
    for (const section of sections) {
      lines.push(section.title.text);
      for (const { record, line } of section.records) if (!omitted || record.sequence < omitted.fromSequence || record.sequence > omitted.throughSequence) lines.push(line.text);
    }
    lines.push(coverageLine(result).text, ...footer.map(line => line.text));
    const expansion = expansionLine(result);
    if (expansion) lines.push(expansion.text);
    return { ...result, summary: lines.join("\n") };
  };
  for (const { line } of records) budget.add(line);
  const complete = project(total, total);
  if (fits(complete)) return finish(complete);
  for (const { line } of records) budget.remove(line);
  let first = 0, last = total, result = project(first, last);
  if (!fits(result)) throw new Error("continuity output budget too small for coverage and source pointers");
  while (first < last) {
    let progressed = false;
    const headLine = records[first]!.line;
    budget.add(headLine);
    const head = project(first + 1, last);
    if (fits(head)) { first++; result = head; progressed = true; } else budget.remove(headLine);
    if (first < last) {
      const tailLine = records[last - 1]!.line;
      budget.add(tailLine);
      const tail = project(first, last - 1);
      if (fits(tail)) { last--; result = tail; progressed = true; } else budget.remove(tailLine);
    }
    if (!progressed) break;
  }
  return finish(result);
}
