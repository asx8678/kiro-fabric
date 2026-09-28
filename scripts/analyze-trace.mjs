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
const failure = (event) => event.data?.error || (event.data?.ok === false || event.data?.errorKind
  ? (typeof event.data?.errorKind === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(event.data.errorKind) ? event.data.errorKind : "provider_failed")
  : undefined);
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

  // Group once by execution id. Per-execution analysis then reads its own bucket
  // instead of rescanning the entire event list, which made distinct-execution
  // traces quadratic in (events x executions).
  const eventsByExecId = new Map();
  for (const event of events) {
    if (!event.execId) continue;
    const bucket = eventsByExecId.get(event.execId);
    if (bucket) bucket.push(event); else eventsByExecId.set(event.execId, [event]);
  }
  const execIds = [...eventsByExecId.keys()];
  const execEndByExecId = new Map();
  const executions = execIds.map((execId) => {
    const owned = eventsByExecId.get(execId) ?? [];
    const end = owned.findLast((event) => event.ev === "exec.end");
    const projection = owned.findLast((event) => event.ev === "exec.projection");
    if (end) execEndByExecId.set(execId, end);
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
        ...(failure(span) ? { error: failure(span) } : {}),
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
    if (failure(span)) entry.errors += 1;
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
  let knownMemoryCount = 0;
  let maxMemory = 0;
  for (const { memoryUsedBytes } of memorySeries) {
    if (!finiteNonnegative(memoryUsedBytes)) continue;
    knownMemoryCount += 1;
    maxMemory = Math.max(maxMemory, memoryUsedBytes);
  }
  const firstMemory = memorySeries[0]?.memoryUsedBytes;
  const lastMemory = memorySeries.at(-1)?.memoryUsedBytes;
  const memory = memorySeries.length === 0 ? undefined : {
    snapshots: memorySeries.length,
    knownUsedBytesSnapshots: knownMemoryCount,
    unknownUsedBytesSnapshots: memorySeries.length - knownMemoryCount,
    firstUsedBytes: nullableNumber(firstMemory),
    lastUsedBytes: nullableNumber(lastMemory),
    deltaUsedBytes: finiteNonnegative(firstMemory) && finiteNonnegative(lastMemory) ? lastMemory - firstMemory : null,
    maxUsedBytes: knownMemoryCount === memorySeries.length ? maxMemory : null,
    series: memorySeries,
  };

  const anomalies = [];
  if (malformed > 0) anomalies.push({ kind: "malformed-lines", count: malformed });
  for (const span of spans) if (!timing(span)) anomalies.push({ kind: "invalid-span-timing", spanId: span.spanId ?? null, ev: span.ev });
  for (const execution of executions) {
    if (!execution.failures) continue;
    const end = execEndByExecId.get(execution.execId);
    // A caller-visible failure is otherwise unattributed when the guest never
    // ended, or when a successful guest outcome was overridden at the caller
    // boundary (failed projection/overflow retention). The exec.end rule below
    // covers the remaining case, so each execution reports exactly one anomaly.
    if (!end || end.data?.status === "succeeded") {
      anomalies.push({ kind: "failed-execution", execId: execution.execId, status: execution.requestStatus });
    }
  }
  let incompleteMarkers = 0;
  for (const event of events) {
    if (event.ev === "trace.dropped") { incompleteMarkers += 1; anomalies.push({ kind: "ring-drops", lost: event.data?.lost, total: event.data?.total }); }
    if (event.ev === "trace.truncated") { incompleteMarkers += 1; anomalies.push({ kind: "file-cap-truncated" }); }
    if (event.ev === "line.truncated") { incompleteMarkers += 1; anomalies.push({ kind: "line-truncated", bytes: nullableNumber(event.data?.bytes ?? event.bytes) }); }
    if (event.ev === "exec.end" && event.data?.status && event.data.status !== "succeeded") anomalies.push({ kind: "failed-execution", execId: event.execId, status: event.data.status, typeErrors: event.data.typeErrors });
    if (event.cat === "bridge" && failure(event)) anomalies.push({ kind: "bridge-error", ref: event.data?.actionRef ?? event.ev, error: failure(event) });
    if (event.ev === "approval.wait" && event.data?.approved === false) anomalies.push({ kind: "approval-denied", ref: event.data.ref, error: failure(event) });
  }
  const observedExecutions = executions.filter((execution) => execution.attempts === 1);
  const compileResults = events.filter((event) => event.ev === "compile.result");
  const compileSpans = spans.filter((event) => event.ev === "compile");
  const countMatching = (value, key) => compileResults.filter((event) => event.data?.[key] === value).length;
  // Failed and legacy spans have no cache classification; never infer cold or hit.
  const compileClass = (span) => span.data?.failed === true ? "failed" : span.data?.cache === "hit" ? "cacheHit"
    : ["cold", "warm", "custom"].includes(span.data?.worker) ? span.data.worker : "unknown";
  const compile = compileResults.length === 0 && compileSpans.length === 0 ? undefined : {
    samples: compileResults.length,
    cacheHits: countMatching("hit", "cache"), cacheMisses: countMatching("miss", "cache"), cacheBypasses: countMatching("bypass", "cache"),
    cacheUnknown: compileResults.filter((event) => !["hit", "miss", "bypass"].includes(event.data?.cache)).length,
    coldWorkers: countMatching("cold", "worker"), warmWorkers: countMatching("warm", "worker"), customWorkers: countMatching("custom", "worker"),
    typeErrorChecks: compileResults.filter((event) => finiteNonnegative(event.data?.typeErrors) && event.data.typeErrors > 0).length,
    typeErrors: summarizeCounts(compileResults.map((event) => event.data?.typeErrors)),
    // Span samples differ from result samples on failures and old/partial traces.
    latency: Object.fromEntries(["cacheHit", "cold", "warm", "custom", "failed", "unknown"].map((kind) => [kind,
      summarizeDurations(compileSpans.filter((span) => compileClass(span) === kind).map((span) => timing(span)?.duration))])),
  };
  return { file, events: events.length, malformedLines: malformed, compile,
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
  if (report.compile) {
    lines.push("", `compiler: samples=${report.compile.samples} cache hits=${report.compile.cacheHits} misses=${report.compile.cacheMisses} bypasses=${report.compile.cacheBypasses} unknown=${report.compile.cacheUnknown} workers cold=${report.compile.coldWorkers} warm=${report.compile.warmWorkers} custom=${report.compile.customWorkers} type-error checks=${report.compile.typeErrorChecks}`);
    for (const [kind, stats] of Object.entries(report.compile.latency)) lines.push(`  ${kind} n=${stats.count} total=${formatUs(stats.totalUs)} mean=${formatUs(stats.meanUs)} p95=${formatUs(stats.p95Us)}`);
  }
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
// Never process.exit() here. A report larger than the OS pipe buffer (64 KiB)
// leaves bytes queued on stdout, and process.exit() discards them, corrupting
// piped/JSON output. exitCode lets Node drain stdout first, same status.
process.exitCode = report.anomalies.some((anomaly) => anomaly.kind === "malformed-lines") && report.events === 0 ? 1 : 0;
