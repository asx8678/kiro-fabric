import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/analyze-trace.mjs");
const roots: string[] = [];
const temporary = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-trace-analyze-"));
  roots.push(root);
  return root;
};
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const run = (...args: string[]): string =>
  execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

const fixture = (events: Record<string, unknown>[]): string => {
  const file = path.join(temporary(), "fixture.jsonl");
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join("\n"));
  return file;
};

const base = { v: 1, ts: "2025-01-01T00:00:00.000Z" };
const sampleEvents = [
  { ...base, seq: 1, monoUs: 1_000_000, cat: "init", ev: "agent.mcp.start", data: { file: "/x.jsonl" } },
  { ...base, seq: 2, monoUs: 1_001_000, cat: "eval", ev: "exec.start", execId: "exec_a" },
  { ...base, seq: 3, monoUs: 1_002_000, cat: "eval", ev: "compile", execId: "exec_a", spanId: "span_1", durUs: 40_000 },
  { ...base, seq: 4, monoUs: 1_050_000, cat: "eval", ev: "execute", execId: "exec_a", spanId: "span_2", durUs: 900_000 },
  { ...base, seq: 5, monoUs: 1_060_000, cat: "eval", ev: "quickjs.run", execId: "exec_a", spanId: "span_3", parentId: "span_2", durUs: 800_000 },
  { ...base, seq: 6, monoUs: 1_100_000, cat: "bridge", ev: "fabric.call", execId: "exec_a", spanId: "span_4", parentId: "span_2", durUs: 300_000, data: { actionRef: "memory.set", argsChars: 120, resultChars: 64, ok: true } },
  { ...base, seq: 7, monoUs: 1_110_000, cat: "eval", ev: "approval.wait", execId: "exec_a", spanId: "span_5", parentId: "span_4", durUs: 200_000, data: { ref: "memory.set", risk: "write", approved: true } },
  { ...base, seq: 8, monoUs: 1_900_000, cat: "eval", ev: "quickjs.memory", execId: "exec_a", data: { usage: { memory_used_size: 123_456, malloc_size: 200_000, object_count: 42 }, hostRssBytes: 90_000_000 } },
  { ...base, seq: 9, monoUs: 1_960_000, cat: "eval", ev: "exec.end", execId: "exec_a", data: { status: "succeeded", elapsedMs: 960, audits: 1, logs: 0, typeErrors: 0, resultChars: 512 } },
  { ...base, seq: 10, monoUs: 2_000_000, cat: "teardown", ev: "trace.dropped", data: { lost: 3, total: 3 } },
];

describe("analyze-trace", () => {
  it("builds per-execution span trees with self time and bridge payload totals", () => {
    const report = JSON.parse(run(fixture(sampleEvents), "--json")) as {
      events: number;
      malformedLines: number;
      executions: Array<Record<string, unknown>>;
      bridgeTable: Array<Record<string, unknown>>;
      memory: Record<string, unknown>;
      anomalies: Array<Record<string, unknown>>;
    };
    expect(report.events).toBe(10);
    expect(report.malformedLines).toBe(0);
    const exec = report.executions[0]!;
    expect(exec.execId).toBe("exec_a");
    expect(exec.status).toBe("succeeded");
    expect(exec.resultChars).toBe(512);
    expect(exec.legacyResultChars).toBe(512);
    expect(exec.resultValueChars).toBeNull();
    expect(exec.projectionVisibleChars).toBeNull();
    expect(exec.bridgeCalls).toBe(1);
    expect(exec.bridgeArgsChars).toBe(120);
    expect(exec.bridgeResultChars).toBe(64);
    expect(exec.approvalWaitUs).toBe(200_000);
    // Child intervals overlap, so execute subtracts their union, not their sum.
    const spans = exec.spans as Array<{ ev: string; selfUs: number | null; parent?: string }>;
    expect(spans.find((span) => span.ev === "execute")?.selfUs).toBe(100_000);
    const runSpan = spans.find((span) => span.ev === "quickjs.run");
    expect(runSpan?.parent).toBe("execute");
    const approval = spans.find((span) => span.ev === "approval.wait");
    expect(approval?.parent).toBe("fabric.call");
    // Bridge table unwraps tools.call via actionRef.
    expect(report.bridgeTable[0]!.ref).toBe("memory.set");
    expect(report.bridgeTable[0]!.p95Us).toBe(300_000);
    // Numeric heap trend.
    expect(report.memory.firstUsedBytes).toBe(123_456);
    expect(report.memory.maxUsedBytes).toBe(123_456);
    // Ring drops surface as anomalies.
    expect(report.anomalies).toContainEqual({ kind: "ring-drops", lost: 3, total: 3 });
  });

  it("counts malformed lines and flags failed executions without dying", () => {
    const file = path.join(temporary(), "fixture.jsonl");
    fs.writeFileSync(file, [
      JSON.stringify({ ...base, seq: 1, monoUs: 1, cat: "eval", ev: "exec.end", execId: "exec_b", data: { status: "failed", typeErrors: 2 } }),
      "not json",
      JSON.stringify({ ...base, seq: 2, monoUs: 2, cat: "bridge", ev: "mcp.$call", spanId: "span_9", durUs: 5, data: { error: "denied" } }),
    ].join("\n"));
    const report = JSON.parse(run(file, "--json")) as { malformedLines: number; anomalies: Array<Record<string, unknown>> };
    expect(report.malformedLines).toBe(1);
    expect(report.anomalies).toContainEqual({ kind: "failed-execution", execId: "exec_b", status: "failed", typeErrors: 2 });
    expect(report.anomalies).toContainEqual({ kind: "bridge-error", ref: "mcp.$call", error: "denied" });
  });

  it("computes serial, overlapping, nested, and parent-clipped child union time", () => {
    const events = [
      { ...base, seq: 1, monoUs: 100, ev: "parent", spanId: "p", durUs: 100 },
      { ...base, seq: 2, monoUs: 90, ev: "outside-left", spanId: "a", parentId: "p", durUs: 20 },
      { ...base, seq: 3, monoUs: 110, ev: "serial", spanId: "b", parentId: "p", durUs: 20 },
      { ...base, seq: 4, monoUs: 120, ev: "overlap", spanId: "c", parentId: "p", durUs: 30 },
      { ...base, seq: 5, monoUs: 125, ev: "nested", spanId: "d", parentId: "p", durUs: 5 },
      { ...base, seq: 6, monoUs: 190, ev: "outside-right", spanId: "e", parentId: "p", durUs: 20 },
      { ...base, seq: 7, monoUs: 60, ev: "fully-outside", spanId: "f", parentId: "p", durUs: 10 },
    ];
    const report = JSON.parse(run(fixture(events), "--json")) as { executions: Array<{ spans: Array<{ ev: string; selfUs: number }> }>; spanTable: Array<{ ev: string; totalSelfUs: number }> };
    // No execId means no execution view. The clipped child union is
    // [100,150] plus [190,200]: 60us covered, 40us self.
    expect(report.executions).toHaveLength(0);
    expect(report.spanTable.find((row) => row.ev === "parent")?.totalSelfUs).toBe(40);
  });

  it("keeps malformed timing unknown and reports anomalies", () => {
    const events = [
      { ...base, seq: 1, monoUs: 10, ev: "exec.start", execId: "bad" },
      { ...base, seq: 2, monoUs: 20, ev: "missing", execId: "bad", spanId: "m" },
      { ...base, seq: 3, monoUs: 30, ev: "negative", execId: "bad", spanId: "n", durUs: -1 },
      { ...base, seq: 4, monoUs: "nope", ev: "nonfinite", execId: "bad", spanId: "x", durUs: 4 },
      { ...base, seq: 5, monoUs: Number.MAX_VALUE, ev: "overflow", execId: "bad", spanId: "o", durUs: Number.MAX_VALUE },
    ];
    const target = fixture(events);
    const report = JSON.parse(run(target, "--json")) as { executions: Array<{ spans: Array<{ selfUs: number | null }> }>; spanTable: Array<{ totalUs: number | null }>; anomalies: Array<{ kind: string }> };
    expect(report.executions[0]!.spans).toHaveLength(4);
    expect(report.executions[0]!.spans.every((span) => span.selfUs === null)).toBe(true);
    expect(report.spanTable.every((row) => row.totalUs === null)).toBe(true);
    expect(report.anomalies.filter((a) => a.kind === "invalid-span-timing")).toHaveLength(4);
    expect(run(target)).toContain("unknown");
    const chrome = path.join(temporary(), "invalid-chrome.json");
    run(target, "--chrome", chrome);
    const trace = JSON.parse(fs.readFileSync(chrome, "utf8")) as { traceEvents: Array<{ name: string }> };
    expect(trace.traceEvents.map((event) => event.name)).toEqual(["exec.start"]);
  });

  it("reports projection metadata separately, including failures and Unicode", () => {
    const events = [
      { ...base, seq: 1, monoUs: 1, ev: "exec.start", execId: "new" },
      { ...base, seq: 2, monoUs: 2, ev: "exec.projection", execId: "new", data: { visibleChars: 2, visibleBytes: 4, isError: true, overflowed: true, artifactRetained: true } },
      { ...base, seq: 3, monoUs: 3, ev: "exec.end", execId: "new", data: { status: "failed", resultChars: 0, resultValueChars: 7 } },
      { ...base, seq: 4, monoUs: 4, ev: "exec.start", execId: "legacy" },
      { ...base, seq: 5, monoUs: 5, ev: "exec.end", execId: "legacy", data: { status: "succeeded", resultChars: 9 } },
      { ...base, seq: 6, monoUs: 6, ev: "exec.projection", execId: "invalid", data: { visibleChars: -1, visibleBytes: "4", isError: 0 } },
    ];
    const report = JSON.parse(run(fixture(events), "--json")) as { executionAttempts: number; executionFailures: number; executions: Array<Record<string, unknown>> };
    expect(report.executionAttempts).toBe(3);
    expect(report.executionFailures).toBe(1);
    expect(report.executions.find((e) => e.execId === "new")).toMatchObject({ resultChars: 0, legacyResultChars: 0, resultValueChars: 7, projectionVisibleChars: 2, projectionVisibleBytes: 4, projectionIsError: true, projectionOverflowed: true, projectionArtifactRetained: true });
    expect(report.executions.find((e) => e.execId === "legacy")).toMatchObject({ legacyResultChars: 9, resultValueChars: null, projectionVisibleChars: null });
    expect(report.executions.find((e) => e.execId === "invalid")).toMatchObject({ attempts: 1, guestAttempts: 0, projectionVisibleChars: null, projectionVisibleBytes: null, projectionIsError: null });
  });

  it("counts projection-only request outcomes once and preserves unknown bridge sizes", () => {
    const events = [
      { ...base, seq: 1, monoUs: 1, ev: "exec.projection", execId: "early", data: { isError: true } },
      { ...base, seq: 2, monoUs: 2, ev: "exec.start", execId: "both" },
      { ...base, seq: 3, monoUs: 3, ev: "exec.projection", execId: "both", data: { isError: true } },
      { ...base, seq: 4, monoUs: 4, ev: "exec.end", execId: "both", data: { status: "succeeded" } },
      { ...base, seq: 5, monoUs: 5, ev: "zero", cat: "bridge", execId: "both", spanId: "z", durUs: 1, data: { actionRef: "tool", argsChars: 0, resultChars: 0 } },
      { ...base, seq: 6, monoUs: 6, ev: "unknown", cat: "bridge", execId: "both", spanId: "u", durUs: 1, data: { actionRef: "tool", argsChars: -1 } },
    ];
    const report = JSON.parse(run(fixture(events), "--json")) as { executionAttempts: number; guestExecutionAttempts: number; executionFailures: number; executions: Array<Record<string, unknown>>; bridgeTable: Array<Record<string, unknown>>; anomalies: Array<Record<string, unknown>> };
    expect(report).toMatchObject({ executionAttempts: 2, guestExecutionAttempts: 1, executionFailures: 2, executionUnknownOutcomes: 0 });
    expect(report.executions.find((e) => e.execId === "early")).toMatchObject({ attempts: 1, guestAttempts: 0, failures: 1, requestStatus: "failed", guestStatus: null, status: "incomplete" });
    expect(report.executions.find((e) => e.execId === "both")).toMatchObject({ attempts: 1, guestAttempts: 1, failures: 1, requestStatus: "failed", guestStatus: "succeeded", status: "succeeded", bridgeArgsChars: null, bridgeArgsCharsKnownCount: 1, bridgeArgsCharsUnknownCount: 1, bridgeResultChars: null, bridgeResultCharsKnownCount: 1, bridgeResultCharsUnknownCount: 1 });
    expect(report.bridgeTable[0]).toMatchObject({ argsChars: null, argsCharsKnownCount: 1, argsCharsUnknownCount: 1, resultChars: null, resultCharsKnownCount: 1, resultCharsUnknownCount: 1 });
    expect(report.anomalies).toContainEqual({ kind: "failed-execution", execId: "early", status: "failed" });
  });

  it("counts all request evidence, unknown outcomes, incomplete coverage, and unknown heap values", () => {
    const events = [
      { ...base, seq: 1, ev: "exec.end", execId: "end-only", data: { status: "failed" } },
      { ...base, seq: 2, ev: "tool.fabric_exec", execId: "marker-only" },
      { ...base, seq: 3, ev: "exec.start", execId: "missing" },
      { ...base, seq: 4, ev: "exec.projection", execId: "known-zero", data: { visibleChars: 0, visibleBytes: 0, isError: false, overflowed: false, artifactRetained: false } },
      { ...base, seq: 5, ev: "quickjs.memory", data: { usage: {} } },
      { ...base, seq: 6, ev: "quickjs.memory", data: { usage: { memory_used_size: 10 } } },
      { ...base, seq: 7, ev: "trace.truncated" },
    ];
    const report = JSON.parse(run(fixture(events), "--json")) as any;
    expect(report).toMatchObject({ executionAttempts: 4, executionFailures: 1, executionUnknownOutcomes: 2, coverage: "incomplete-lower-bound" });
    expect(report.executions.find((e: any) => e.execId === "end-only")).toMatchObject({ requestStatus: "failed", guestStatus: "failed" });
    expect(report.executions.find((e: any) => e.execId === "marker-only")).toMatchObject({ requestStatus: "unknown", unknownOutcomes: 1 });
    expect(report.executions.find((e: any) => e.execId === "known-zero")).toMatchObject({ requestStatus: "succeeded", projectionVisibleChars: 0, projectionVisibleBytes: 0 });
    expect(report.memory).toMatchObject({ firstUsedBytes: null, lastUsedBytes: 10, deltaUsedBytes: null, maxUsedBytes: null, knownUsedBytesSnapshots: 1, unknownUsedBytesSnapshots: 1 });
  });

  it("renders text by default and Chrome Trace with --chrome", () => {
    const target = fixture(sampleEvents);
    const text = run(target);
    expect(text).toContain("executions:");
    expect(text).toContain("memory.set");
    expect(text).toContain("bridge table");
    expect(text).toContain("args=120 chars result=64 chars");
    const chrome = path.join(temporary(), "chrome.json");
    run(target, "--chrome", chrome);
    const parsed = JSON.parse(fs.readFileSync(chrome, "utf8")) as { traceEvents: Array<Record<string, unknown>> };
    const span = parsed.traceEvents.find((event) => event.ph === "X" && event.name === "memory.set");
    expect(span?.ts).toBe(1_100_000);
    expect(span?.dur).toBe(300_000);
    expect(span?.tid).toBe("exec_a");
  });
});
