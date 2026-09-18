import { createHash } from "node:crypto";
import { snapshot, type ContinuityRecord, type ContinuitySnapshot, type ContinuityTask } from "../../src/continuity/records.js";

/** Deterministic mixed records: ordering, escaping, captures and superseded checks. */
export function renderingFixture(version: 1 | 2 | 3, count: number): ContinuitySnapshot {
  const records: ContinuityRecord[] = Array.from({ length: count }, (_, i) => ({
    sequence: i + 1, provenance: "declared", kind: i === 0 || i === 15 ? "objective" : i < 3 ? "constraint" : (["decision", "open-check", "next-step"] as const)[i % 3]!,
    text: `Fact ${i}: 😀 雪 ${'"\\\n\t\u0001'.repeat(i % 7)}${"x".repeat((i % 6) * 12)}`,
  }));
  const task: ContinuityTask = { schemaVersion: version, taskId: `ct_${"a".repeat(32)}`, records, publications: [] };
  if (version !== 1) {
    task.captureVersion = 1;
    const executionId = `ce_${"b".repeat(32)}`, readSequence = records.length + 1;
    records.push({ sequence: readSequence, provenance: "host-observed", kind: "operation", executionId, operationSequence: 1,
      ref: "local.read", outcome: "succeeded", dispatchState: "dispatched", effectOutcome: "none", path: "input.ts", sha256: "c".repeat(64) });
    if (version === 3) records.push({ sequence: records.length + 1, provenance: "host-observed", kind: "operation", executionId, operationSequence: 2,
      ref: "local.shell", outcome: "succeeded", dispatchState: "dispatched", effectOutcome: "none", settledBeforeDispatch: 1,
      command: { ok: true, exitCode: 0, signal: null } });
    const captureSequence = records.length + 1, operations = version === 3 ? 2 : 1;
    records.push({ sequence: captureSequence, provenance: "host-observed", kind: "capture", executionId, throughOperation: operations,
      admittedOperations: operations, capturedOperations: operations, unsupportedOperations: 0, excludedOperations: 0 });
    if (version === 3) for (let i = 0; i < 3; i++) records.push({ sequence: records.length + 1, provenance: "declared", kind: "check",
      id: i === 1 ? "other" : "regression", text: `Check ${i}: 😀 "quoted"\nline`, status: i === 2 ? "passed" : "blocked",
      evidence: [readSequence, readSequence + 1], note: "Caller-declared, not proof" });
    task.publications.push({ requestId: "initial", requestHash: "d".repeat(64), throughSequence: records.length, captureSequence });
  }
  return snapshot(task, 7);
}

export const RENDERING_FIXTURES = [[1, 1], [1, 8], [1, 48], [1, 512], [2, 12], [2, 75], [3, 24], [3, 128]] as const;
type Projection = { summary: string };
export function projectionFingerprint(project: (summaryBytes: number, resultBytes: number) => Projection): string {
  const hash = createHash("sha256");
  const budgets = [1, 512, 1024, 1400, 2048, 4096, 8192, 16384].flatMap(summary =>
    [768, 1200, 2400, 8000, 24000].map(result => [summary, result] as const));
  const full = project(16384, 24000);
  const summary = Buffer.byteLength(full.summary), result = Buffer.byteLength(JSON.stringify(full));
  budgets.push([summary - 1, result], [summary, result - 1], [summary, result], [summary + 1, result + 1]);
  for (const [summaryBytes, resultBytes] of budgets) {
    let outcome: unknown;
    try { outcome = { value: project(summaryBytes, resultBytes) }; }
    catch (error) { outcome = { error: error instanceof Error ? error.message : String(error) }; }
    hash.update(JSON.stringify({ summaryBytes, resultBytes, outcome }));
  }
  return hash.digest("hex");
}
