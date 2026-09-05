#!/usr/bin/env node
// Analyze a kiro-fabric JSONL execution trace.
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

const readTrace = (target) => {
  const events = [];
  let malformed = 0;
  for (const line of fs.readFileSync(target, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (typeof event !== "object" || event === null || typeof event.ev !== "string") malformed += 1;
      else events.push(event);
    } catch { malformed += 1; }
  }
  events.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
  return { events, malformed };
};

const finiteNonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const nullableNumber = (value) => finiteNonnegative(value) ? value : null;
const nullableBoolean = (value) => typeof value === "boolean" ? value : null;
const timing = (span) => {
  if (!finiteNonnegative(span.monoUs) || !finiteNonnegative(span.durUs)) return null;
  const end = span.monoUs + span.durUs;
  return Number.isFinite(end) ? { start: span.monoUs, end, duration: span.durUs } : null;
};
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const summarizeDurations = (durations) => {
  const valid = durations.filter(finiteNonnegative).sort((a, b) => a - b);
  const unknownCount = durations.length - valid.length;
  const total = valid.reduce((sum, value) => sum + value, 0);
  return {
    count: durations.length, knownCount: valid.length, unknownCount,
    totalUs: unknownCount ? null : total,
    meanUs: unknownCount || !valid.length ? null : Math.round(total / valid.length),
    maxUs: unknownCount || !valid.length ? null : valid[valid.length - 1],
    p95Us: unknownCount || !valid.length ? null : percentile(valid, 95),
  };
};
const summarizeCounts = (values) => {
  const valid = values.filter(finiteNonnegative);
  const unknownCount = values.length - valid.length;
  return {
    total: unknownCount ? null : valid.reduce((sum, value) => sum + value, 0),
    knownCount: valid.length,
    unknownCount,
  };
};

const analyze = (events, malformed) => {
  // A span timestamp is its START. Invalid timing remains unknown throughout.
  const spans = events.filter((event) => event.spanId || event.durUs !== undefined);
  const spanById = new Map(spans.filter((span) => span.spanId).map((span) => [span.spanId, span]));
  const childrenOf = new Map();
  for (const span of spans) {
    if (!span.parentId || !spanById.has(span.parentId)) continue;
    const list = childrenOf.get(span.parentId) ?? [];
    list.push(span);
    childrenOf.set(span.parentId, list);
  }
  const selfTimeUs = (span) => {
    const parent = timing(span);
    if (!parent) return null;
    const intervals = [];
    for (const child of childrenOf.get(span.spanId) ?? []) {
      const childTime = timing(child);
      if (!childTime) return null;
      const start = Math.max(parent.start, childTime.start);
      const end = Math.min(parent.end, childTime.end);
      if (end > start) intervals.push([start, end]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = -Infinity;
    for (const [start, nextEnd] of intervals) {
      if (start > end) covered += nextEnd - start;
      else if (nextEnd > end) covered += nextEnd - end;
      end = Math.max(end, nextEnd);
    }
    return parent.duration - covered;
  };

  const execIds = [...new Set(events.map((event) => event.execId).filter(Boolean))];
  const executions = execIds.map((execId) => {
    const owned = events.filter((event) => event.execId === execId);
    const end = owned.findLast((event) => event.ev === "exec.end");
    const projection = owned.findLast((event) => event.ev === "exec.projection");
    const ownedSpans = owned.filter((event) => event.spanId || event.durUs !== undefined);
    const bridge = ownedSpans.filter((event) => event.cat === "bridge");
    const approvals = ownedSpans.filter((event) => event.ev === "approval.wait");
    const approvalSummary = summarizeDurations(approvals.map((span) => timing(span)?.duration ?? null));
    const bridgeSummary = summarizeDurations(bridge.map((span) => timing(span)?.duration ?? null));
    const argsSummary = summarizeCounts(bridge.map((span) => span.data?.argsChars));
    const resultSummary = summarizeCounts(bridge.map((span) => span.data?.resultChars));
    const observedRequest = owned.some((event) => ["tool.fabric_exec", "exec.start", "exec.end", "exec.projection"].includes(event.ev));
    const guestStatus = typeof end?.data?.status === "string" ? end.data.status : null;
    // Projection is the caller boundary and therefore overrides a successful
    // guest outcome (for example when overflow retention fails).
    const requestStatus = typeof projection?.data?.isError === "boolean"
      ? (projection.data.isError ? "failed" : "succeeded")
      : guestStatus === null ? "unknown" : guestStatus === "succeeded" ? "succeeded" : "failed";
    return {
      execId,
      attempts: observedRequest ? 1 : 0,
      guestAttempts: owned.filter((event) => event.ev === "exec.start").length,
      failures: observedRequest && requestStatus === "failed" ? 1 : 0,
      unknownOutcomes: observedRequest && requestStatus === "unknown" ? 1 : 0,
      requestStatus,
      guestStatus,
      status: guestStatus ?? "incomplete",
      elapsedMs: nullableNumber(end?.data?.elapsedMs),
      resultChars: nullableNumber(end?.data?.resultChars),
      legacyResultChars: nullableNumber(end?.data?.resultChars),
      resultValueChars: nullableNumber(end?.data?.resultValueChars),
      projectionVisibleChars: nullableNumber(projection?.data?.visibleChars),
      projectionVisibleBytes: nullableNumber(projection?.data?.visibleBytes),
      projectionIsError: nullableBoolean(projection?.data?.isError),
      projectionOverflowed: nullableBoolean(projection?.data?.overflowed),
      projectionArtifactRetained: nullableBoolean(projection?.data?.artifactRetained),
      typeErrors: nullableNumber(end?.data?.typeErrors),
      bridgeCalls: bridge.length,
      bridgeTotalUs: bridgeSummary.totalUs,
      bridgeArgsChars: argsSummary.total,
      bridgeArgsCharsKnownCount: argsSummary.knownCount,
      bridgeArgsCharsUnknownCount: argsSummary.unknownCount,
      bridgeResultChars: resultSummary.total,
      bridgeResultCharsKnownCount: resultSummary.knownCount,
      bridgeResultCharsUnknownCount: resultSummary.unknownCount,
      approvals: approvals.length,
      approvalWaitUs: approvalSummary.totalUs,
      spans: ownedSpans.map((span) => ({
        ev: span.ev, ref: span.data?.actionRef ?? span.ev,
        durUs: timing(span)?.duration ?? null, selfUs: selfTimeUs(span),
        parent: span.parentId ? spanById.get(span.parentId)?.ev : undefined,
        ...(span.data?.error ? { error: span.data.error } : {}),
      })).sort((left, right) => (right.selfUs ?? -Infinity) - (left.selfUs ?? -Infinity)),
    };
  });

  const byEvent = new Map();
  for (const span of spans) {
    const entry = byEvent.get(span.ev) ?? { durations: [], self: [] };
    entry.durations.push(timing(span)?.duration ?? null);
    entry.self.push(selfTimeUs(span));
    byEvent.set(span.ev, entry);
  }
  const spanTable = [...byEvent.entries()].map(([ev, entry]) => {
    const duration = summarizeDurations(entry.durations);
    const self = summarizeDurations(entry.self);
    return { ev, ...duration, totalSelfUs: self.totalUs, unknownSelfCount: self.unknownCount };
  }).sort((left, right) => (right.totalUs ?? -Infinity) - (left.totalUs ?? -Infinity));

  const byRef = new Map();
  for (const span of spans.filter((event) => event.cat === "bridge")) {
    const ref = span.data?.actionRef ?? span.ev;
    const entry = byRef.get(ref) ?? { durations: [], argsChars: [], resultChars: [], errors: 0 };
    entry.durations.push(timing(span)?.duration ?? null);
    entry.argsChars.push(span.data?.argsChars);
    entry.resultChars.push(span.data?.resultChars);
    if (span.data?.error) entry.errors += 1;
    byRef.set(ref, entry);
  }
  const bridgeTable = [...byRef.entries()].map(([ref, entry]) => {
    const args = summarizeCounts(entry.argsChars);
    const result = summarizeCounts(entry.resultChars);
    return { ref, ...summarizeDurations(entry.durations), argsChars: args.total, argsCharsKnownCount: args.knownCount, argsCharsUnknownCount: args.unknownCount, resultChars: result.total, resultCharsKnownCount: result.knownCount, resultCharsUnknownCount: result.unknownCount, errors: entry.errors };
  })
    .sort((left, right) => (right.totalUs ?? -Infinity) - (left.totalUs ?? -Infinity));

  const memorySeries = events.filter((event) => event.ev === "quickjs.memory" && event.data?.usage && typeof event.data.usage === "object").map((event) => ({
    execId: event.execId, monoUs: event.monoUs, memoryUsedBytes: event.data.usage.memory_used_size,
    mallocBytes: event.data.usage.malloc_size, objectCount: event.data.usage.object_count, hostRssBytes: event.data.hostRssBytes,
  }));
  const memoryValues = memorySeries.map((point) => point.memoryUsedBytes);
  const knownMemoryValues = memoryValues.filter(finiteNonnegative);
  const firstMemory = memoryValues[0];
  const lastMemory = memoryValues.at(-1);
  const memory = memorySeries.length === 0 ? undefined : {
    snapshots: memorySeries.length,
    knownUsedBytesSnapshots: knownMemoryValues.length,
    unknownUsedBytesSnapshots: memorySeries.length - knownMemoryValues.length,
    firstUsedBytes: nullableNumber(firstMemory),
    lastUsedBytes: nullableNumber(lastMemory),
    deltaUsedBytes: finiteNonnegative(firstMemory) && finiteNonnegative(lastMemory) ? lastMemory - firstMemory : null,
    maxUsedBytes: knownMemoryValues.length === memorySeries.length ? Math.max(...knownMemoryValues) : null,
    series: memorySeries,
  };

  const anomalies = [];
  if (malformed > 0) anomalies.push({ kind: "malformed-lines", count: malformed });
  for (const span of spans) if (!timing(span)) anomalies.push({ kind: "invalid-span-timing", spanId: span.spanId ?? null, ev: span.ev });
  for (const execution of executions) {
    if (execution.failures && !events.some((event) => event.execId === execution.execId && event.ev === "exec.end")) {
      anomalies.push({ kind: "failed-execution", execId: execution.execId, status: execution.requestStatus });
    }
  }
  for (const event of events) {
    if (event.ev === "trace.dropped") anomalies.push({ kind: "ring-drops", lost: event.data?.lost, total: event.data?.total });
    if (event.ev === "trace.truncated") anomalies.push({ kind: "file-cap-truncated" });
    if (event.ev === "exec.end" && event.data?.status && event.data.status !== "succeeded") anomalies.push({ kind: "failed-execution", execId: event.execId, status: event.data.status, typeErrors: event.data.typeErrors });
    if (event.cat === "bridge" && event.data?.error) anomalies.push({ kind: "bridge-error", ref: event.data.actionRef ?? event.ev, error: event.data.error });
    if (event.ev === "approval.wait" && event.data?.approved === false) anomalies.push({ kind: "approval-denied", ref: event.data.ref, error: event.data.error });
  }
  const observedExecutions = executions.filter((execution) => execution.attempts === 1);
  const incompleteMarkers = events.filter((event) => event.ev === "trace.dropped" || event.ev === "trace.truncated").length;
  return { file, events: events.length, malformedLines: malformed,
    executionAttempts: observedExecutions.length,
    guestExecutionAttempts: events.filter((event) => event.ev === "exec.start").length,
    executionFailures: observedExecutions.reduce((sum, execution) => sum + execution.failures, 0),
    executionUnknownOutcomes: observedExecutions.reduce((sum, execution) => sum + execution.unknownOutcomes, 0),
    coverage: incompleteMarkers || malformed ? "incomplete-lower-bound" : "complete-observed-records",
    executions, spanTable, bridgeTable, memory, anomalies };
};

const formatUs = (value) => value === null || value === undefined ? "unknown" : value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}s` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}ms` : `${value}us`;
const renderText = (report) => {
  const lines = [`trace: ${report.file}`, `events: ${report.events} (${report.malformedLines} malformed) · coverage=${report.coverage} · executions: ${report.executions.length} attempts=${report.executionAttempts} failures=${report.executionFailures} unknown=${report.executionUnknownOutcomes}`, "", "executions:"];
  for (const exec of report.executions) {
    lines.push(`  ${exec.execId} request=${exec.requestStatus} guest=${exec.guestStatus ?? "unknown"} elapsed=${exec.elapsedMs ?? "?"}ms bridges=${exec.bridgeCalls} (${formatUs(exec.bridgeTotalUs)}) approvals=${exec.approvals} (${formatUs(exec.approvalWaitUs)}) legacyResultChars=${exec.legacyResultChars ?? "unknown"} resultValueChars=${exec.resultValueChars ?? "unknown"} visibleChars=${exec.projectionVisibleChars ?? "unknown"} visibleBytes=${exec.projectionVisibleBytes ?? "unknown"} isError=${exec.projectionIsError ?? "unknown"} overflowed=${exec.projectionOverflowed ?? "unknown"} artifactRetained=${exec.projectionArtifactRetained ?? "unknown"}`);
    for (const span of exec.spans.slice(0, 12)) lines.push(`    ${formatUs(span.selfUs).padStart(8)} self  ${formatUs(span.durUs).padStart(8)} total  ${span.ref}${span.parent ? `  <- ${span.parent}` : ""}${span.error ? `  ERROR: ${span.error}` : ""}`);
  }
  lines.push("", "bridge table (by resolved ref):");
  for (const row of report.bridgeTable) lines.push(`  ${row.ref.padEnd(28)} n=${String(row.count).padStart(3)} total=${formatUs(row.totalUs).padStart(8)} p95=${formatUs(row.p95Us).padStart(8)} max=${formatUs(row.maxUs).padStart(8)} args=${row.argsChars ?? "unknown"} chars result=${row.resultChars ?? "unknown"} chars errors=${row.errors}`);
  lines.push("", "span table (by event):");
  for (const row of report.spanTable) lines.push(`  ${row.ev.padEnd(28)} n=${String(row.count).padStart(3)} total=${formatUs(row.totalUs).padStart(8)} self=${formatUs(row.totalSelfUs).padStart(8)} p95=${formatUs(row.p95Us).padStart(8)} max=${formatUs(row.maxUs).padStart(8)}`);
  if (report.memory) lines.push("", `quickjs heap: snapshots=${report.memory.snapshots} used ${report.memory.firstUsedBytes} -> ${report.memory.lastUsedBytes} bytes (delta ${report.memory.deltaUsedBytes}, max ${report.memory.maxUsedBytes})`);
  if (report.anomalies.length) { lines.push("", "anomalies:"); for (const anomaly of report.anomalies) lines.push(`  ${JSON.stringify(anomaly)}`); }
  return `${lines.join("\n")}\n`;
};
const toChromeTrace = (events) => ({ traceEvents: events.flatMap((event) => {
  const base = { name: event.data?.actionRef ?? event.ev, cat: event.cat, pid: 1, tid: event.execId ?? 0, args: event.data ?? {} };
  if (event.spanId || event.durUs !== undefined) {
    const spanTime = timing(event);
    return spanTime ? [{ ...base, ph: "X", ts: spanTime.start, dur: spanTime.duration }] : [];
  }
  return finiteNonnegative(event.monoUs) ? [{ ...base, ph: "i", s: "t", ts: event.monoUs }] : [];
}) });
const { events, malformed } = readTrace(file);
const report = analyze(events, malformed);
if (chromeOut) { fs.mkdirSync(path.dirname(path.resolve(chromeOut)), { recursive: true }); fs.writeFileSync(chromeOut, JSON.stringify(toChromeTrace(events))); }
process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : renderText(report));
process.exit(report.anomalies.some((anomaly) => anomaly.kind === "malformed-lines") && report.events === 0 ? 1 : 0);
