#!/usr/bin/env node
// Analyze a kiro-fabric JSONL execution trace.
//
//   node scripts/analyze-trace.mjs <trace.jsonl> [--json] [--chrome <out.json>]
//
// Default output is a compact text report sized for reading or pasting into a
// model context: per-execution span trees with self time, a bridge table with
// payload sizes and p95, the QuickJS heap trend, and anomalies (dropped or
// truncated events, failed executions, bridge errors). --json emits the same
// structure as machine-readable JSON; --chrome writes Chrome Trace / Perfetto
// format for visual inspection.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const asJson = args.includes("--json");
const chromeIndex = args.indexOf("--chrome");
const chromeOut = chromeIndex === -1 ? undefined : args[chromeIndex + 1];

if (!file || (chromeIndex !== -1 && !chromeOut)) {
  process.stderr.write("usage: node scripts/analyze-trace.mjs <trace.jsonl> [--json] [--chrome <out.json>]\n");
  process.exit(2);
}

/** Parse JSONL tolerantly: malformed lines are counted, never fatal. */
const readTrace = (target) => {
  const events = [];
  let malformed = 0;
  for (const line of fs.readFileSync(target, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (typeof event !== "object" || event === null || typeof event.ev !== "string") malformed += 1;
      else events.push(event);
    } catch {
      malformed += 1;
    }
  }
  // Emission order is authoritative via seq; fall back to file order for
  // traces written before the seq field existed.
  events.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
  return { events, malformed };
};

const percentile = (sorted, p) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const summarizeDurations = (durations) => {
  const sorted = [...durations].sort((a, b) => a - b);
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    count: durations.length,
    totalUs: total,
    meanUs: durations.length ? Math.round(total / durations.length) : 0,
    maxUs: sorted.length ? sorted[sorted.length - 1] : 0,
    p95Us: percentile(sorted, 95),
  };
};

/** Build one report object from parsed events. */
const analyze = (events, malformed) => {
  const spans = events.filter((event) => event.durUs !== undefined);
  const spanById = new Map(spans.filter((span) => span.spanId).map((span) => [span.spanId, span]));
  const childrenOf = new Map();
  for (const span of spans) {
    if (!span.parentId || !spanById.has(span.parentId)) continue;
    const list = childrenOf.get(span.parentId) ?? [];
    list.push(span);
    childrenOf.set(span.parentId, list);
  }
  const selfTimeUs = (span) =>
    (span.durUs ?? 0) - (childrenOf.get(span.spanId) ?? []).reduce((sum, child) => sum + (child.durUs ?? 0), 0);

  // Per-execution breakdown.
  const execIds = [...new Set(events.map((event) => event.execId).filter(Boolean))];
  const executions = execIds.map((execId) => {
    const owned = events.filter((event) => event.execId === execId);
    const end = owned.find((event) => event.ev === "exec.end");
    const ownedSpans = owned.filter((event) => event.durUs !== undefined);
    const bridge = ownedSpans.filter((event) => event.cat === "bridge");
    const approvals = ownedSpans.filter((event) => event.ev === "approval.wait");
    const approvalWaitUs = approvals.reduce((sum, span) => sum + (span.durUs ?? 0), 0);
    return {
      execId,
      status: end?.data?.status ?? "incomplete",
      elapsedMs: end?.data?.elapsedMs,
      resultChars: end?.data?.resultChars,
      typeErrors: end?.data?.typeErrors,
      bridgeCalls: bridge.length,
      bridgeTotalUs: bridge.reduce((sum, span) => sum + (span.durUs ?? 0), 0),
      bridgeArgsChars: bridge.reduce((sum, span) => sum + (span.data?.argsChars > 0 ? span.data.argsChars : 0), 0),
      bridgeResultChars: bridge.reduce((sum, span) => sum + (span.data?.resultChars > 0 ? span.data.resultChars : 0), 0),
      approvals: approvals.length,
      approvalWaitUs,
      spans: ownedSpans
        .map((span) => ({
          ev: span.ev,
          ref: span.data?.actionRef ?? span.ev,
          durUs: span.durUs,
          selfUs: selfTimeUs(span),
          parent: span.parentId ? spanById.get(span.parentId)?.ev : undefined,
          ...(span.data?.error ? { error: span.data.error } : {}),
        }))
        .sort((left, right) => right.selfUs - left.selfUs),
    };
  });

  // Aggregate span table by event name, with self time.
  const byEvent = new Map();
  for (const span of spans) {
    const entry = byEvent.get(span.ev) ?? { durations: [], self: [] };
    entry.durations.push(span.durUs ?? 0);
    entry.self.push(selfTimeUs(span));
    byEvent.set(span.ev, entry);
  }
  const spanTable = [...byEvent.entries()]
    .map(([ev, entry]) => ({ ev, ...summarizeDurations(entry.durations), totalSelfUs: entry.self.reduce((sum, value) => sum + value, 0) }))
    .sort((left, right) => right.totalUs - left.totalUs);

  // Bridge table keyed by resolved action ref (tools.call unwraps via actionRef).
  const byRef = new Map();
  for (const span of spans.filter((event) => event.cat === "bridge")) {
    const ref = span.data?.actionRef ?? span.ev;
    const entry = byRef.get(ref) ?? { durations: [], argsChars: 0, resultChars: 0, errors: 0 };
    entry.durations.push(span.durUs ?? 0);
    if (span.data?.argsChars > 0) entry.argsChars += span.data.argsChars;
    if (span.data?.resultChars > 0) entry.resultChars += span.data.resultChars;
    if (span.data?.error) entry.errors += 1;
    byRef.set(ref, entry);
  }
  const bridgeTable = [...byRef.entries()]
    .map(([ref, entry]) => ({ ref, ...summarizeDurations(entry.durations), argsChars: entry.argsChars, resultChars: entry.resultChars, errors: entry.errors }))
    .sort((left, right) => right.totalUs - left.totalUs);

  // QuickJS heap trend from numeric computeMemoryUsage snapshots.
  const memorySeries = events
    .filter((event) => event.ev === "quickjs.memory" && event.data?.usage && typeof event.data.usage === "object")
    .map((event) => ({
      execId: event.execId,
      monoUs: event.monoUs,
      memoryUsedBytes: event.data.usage.memory_used_size,
      mallocBytes: event.data.usage.malloc_size,
      objectCount: event.data.usage.object_count,
      hostRssBytes: event.data.hostRssBytes,
    }));
  const memory = memorySeries.length === 0
    ? undefined
    : {
        snapshots: memorySeries.length,
        firstUsedBytes: memorySeries[0].memoryUsedBytes,
        lastUsedBytes: memorySeries[memorySeries.length - 1].memoryUsedBytes,
        deltaUsedBytes: (memorySeries[memorySeries.length - 1].memoryUsedBytes ?? 0) - (memorySeries[0].memoryUsedBytes ?? 0),
        maxUsedBytes: Math.max(...memorySeries.map((point) => point.memoryUsedBytes ?? 0)),
        series: memorySeries,
      };

  const anomalies = [];
  if (malformed > 0) anomalies.push({ kind: "malformed-lines", count: malformed });
  for (const event of events) {
    if (event.ev === "trace.dropped") anomalies.push({ kind: "ring-drops", lost: event.data?.lost, total: event.data?.total });
    if (event.ev === "trace.truncated") anomalies.push({ kind: "file-cap-truncated" });
    if (event.ev === "exec.end" && event.data?.status && event.data.status !== "succeeded") {
      anomalies.push({ kind: "failed-execution", execId: event.execId, status: event.data.status, typeErrors: event.data.typeErrors });
    }
    if (event.cat === "bridge" && event.data?.error) anomalies.push({ kind: "bridge-error", ref: event.data.actionRef ?? event.ev, error: event.data.error });
    if (event.ev === "approval.wait" && event.data?.approved === false) anomalies.push({ kind: "approval-denied", ref: event.data.ref, error: event.data.error });
  }

  return {
    file,
    events: events.length,
    malformedLines: malformed,
    executions,
    spanTable,
    bridgeTable,
    memory,
    anomalies,
  };
};

const formatUs = (value) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}s` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}ms` : `${value}us`);

const renderText = (report) => {
  const lines = [];
  lines.push(`trace: ${report.file}`);
  lines.push(`events: ${report.events} (${report.malformedLines} malformed) · executions: ${report.executions.length}`);
  lines.push("");
  lines.push("executions:");
  for (const exec of report.executions) {
    lines.push(`  ${exec.execId} ${exec.status} elapsed=${exec.elapsedMs ?? "?"}ms bridges=${exec.bridgeCalls} (${formatUs(exec.bridgeTotalUs)}) approvals=${exec.approvals} (${formatUs(exec.approvalWaitUs)}) resultChars=${exec.resultChars ?? "-"}`);
    for (const span of exec.spans.slice(0, 12)) {
      lines.push(`    ${formatUs(span.selfUs).padStart(8)} self  ${formatUs(span.durUs).padStart(8)} total  ${span.ref}${span.parent ? `  <- ${span.parent}` : ""}${span.error ? `  ERROR: ${span.error}` : ""}`);
    }
  }
  lines.push("");
  lines.push("bridge table (by resolved ref):");
  for (const row of report.bridgeTable) {
    lines.push(`  ${row.ref.padEnd(28)} n=${String(row.count).padStart(3)} total=${formatUs(row.totalUs).padStart(8)} p95=${formatUs(row.p95Us).padStart(8)} max=${formatUs(row.maxUs).padStart(8)} args=${row.argsChars}B result=${row.resultChars}B errors=${row.errors}`);
  }
  lines.push("");
  lines.push("span table (by event):");
  for (const row of report.spanTable) {
    lines.push(`  ${row.ev.padEnd(28)} n=${String(row.count).padStart(3)} total=${formatUs(row.totalUs).padStart(8)} self=${formatUs(row.totalSelfUs).padStart(8)} p95=${formatUs(row.p95Us).padStart(8)} max=${formatUs(row.maxUs).padStart(8)}`);
  }
  if (report.memory) {
    lines.push("");
    lines.push(`quickjs heap: snapshots=${report.memory.snapshots} used ${report.memory.firstUsedBytes} -> ${report.memory.lastUsedBytes} bytes (delta ${report.memory.deltaUsedBytes}, max ${report.memory.maxUsedBytes})`);
  }
  if (report.anomalies.length) {
    lines.push("");
    lines.push("anomalies:");
    for (const anomaly of report.anomalies) lines.push(`  ${JSON.stringify(anomaly)}`);
  }
  return `${lines.join("\n")}\n`;
};

const toChromeTrace = (events) => ({
  traceEvents: events.flatMap((event) => {
    const base = { name: event.data?.actionRef ?? event.ev, cat: event.cat, pid: 1, tid: event.execId ?? 0, args: event.data ?? {} };
    return event.durUs !== undefined
      ? [{ ...base, ph: "X", ts: event.monoUs, dur: event.durUs }]
      : [{ ...base, ph: "i", s: "t", ts: event.monoUs }];
  }),
});

const { events, malformed } = readTrace(file);
const report = analyze(events, malformed);
if (chromeOut) {
  fs.mkdirSync(path.dirname(path.resolve(chromeOut)), { recursive: true });
  fs.writeFileSync(chromeOut, JSON.stringify(toChromeTrace(events)));
}
process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : renderText(report));
process.exit(report.anomalies.some((anomaly) => anomaly.kind === "malformed-lines") && report.events === 0 ? 1 : 0);
