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
  { ...base, seq: 1, monoUs: 1_000_000, cat: "init", ev: "power.start", data: { file: "/x.jsonl" } },
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
    expect(exec.bridgeCalls).toBe(1);
    expect(exec.bridgeArgsChars).toBe(120);
    expect(exec.bridgeResultChars).toBe(64);
    expect(exec.approvalWaitUs).toBe(200_000);
    // execute self time subtracts the child quickjs.run span only (the
    // bridge span is parented to execute but also nests under it).
    const spans = exec.spans as Array<{ ev: string; selfUs: number; parent?: string }>;
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

  it("renders text by default and Chrome Trace with --chrome", () => {
    const target = fixture(sampleEvents);
    const text = run(target);
    expect(text).toContain("executions:");
    expect(text).toContain("memory.set");
    expect(text).toContain("bridge table");
    const chrome = path.join(temporary(), "chrome.json");
    run(target, "--chrome", chrome);
    const parsed = JSON.parse(fs.readFileSync(chrome, "utf8")) as { traceEvents: Array<Record<string, unknown>> };
    const span = parsed.traceEvents.find((event) => event.ph === "X" && event.name === "memory.set");
    expect(span?.ts).toBe(1_100_000);
    expect(span?.dur).toBe(300_000);
    expect(span?.tid).toBe("exec_a");
  });
});
