import { randomUUID } from "node:crypto";
import { fabricJsonText } from "../runtime/json-budget.js";
import { createTraceWriter, type TraceWriter, type TraceWriterOptions } from "./trace-writer.js";

type TraceCategory = "init" | "eval" | "bridge" | "teardown";

export interface TraceEvent {
  v: 1;
  ts: string;
  /** Monotonic microseconds (process.hrtime.bigint() based) for span math. */
  monoUs: number;
  /** Per-tracer emission order. Use seq (not monoUs ties) for strict ordering. */
  seq: number;
  cat: TraceCategory;
  ev: string;
  execId?: string;
  /** Set on span events; spanId identifies the span, parentId links it into
   * the execution tree so concurrent bridge calls attribute deterministically. */
  spanId?: string;
  parentId?: string;
  durUs?: number;
  data?: Record<string, unknown>;
}

interface TraceSpan {
  readonly id: string;
  end(data?: Record<string, unknown>): void;
}

export interface FabricTracer {
  readonly enabled: boolean;
  /** Trace file path when active; reported by fabric_info so a model can
   * locate the trace without guessing Fabric data-root internals. */
  readonly file: string | undefined;
  newExecutionId(): string;
  span(cat: TraceCategory, ev: string, execId?: string, data?: Record<string, unknown>, parentId?: string): TraceSpan;
  event(cat: TraceCategory, ev: string, execId?: string, data?: Record<string, unknown>): void;
  flush(): void;
  close(): void;
}

const MAX_EVENT_CHARS = 6_000;

const NOOP_SPAN: TraceSpan = Object.freeze({ id: "", end: () => undefined });

/** Frozen zero-allocation tracer. Hot paths must still guard on `enabled`
 * so span arguments (objects, strings) are never constructed when off. */
export const DISABLED_TRACER: FabricTracer = Object.freeze({
  enabled: false,
  file: undefined,
  newExecutionId: () => "",
  span: () => NOOP_SPAN,
  event: () => undefined,
  flush: () => undefined,
  close: () => undefined,
});

const monotonicUs = (): number => Number(process.hrtime.bigint() / 1_000n);

class ActiveFabricTracer implements FabricTracer {
  readonly enabled = true;
  readonly file: string;
  readonly #writer: TraceWriter;
  #closed = false;
  #reportedDrops = 0;
  #seq = 0;
  #spanSeq = 0;
  constructor(writer: TraceWriter) {
    this.#writer = writer;
    this.file = writer.file;
  }

  newExecutionId(): string {
    return `exec_${randomUUID()}`;
  }

  #emit(event: Omit<TraceEvent, "seq">): void {
    if (this.#closed) return;
    const sequenced: TraceEvent = { ...event, seq: ++this.#seq };
    let line: string;
    try {
      line = fabricJsonText(sequenced, MAX_EVENT_CHARS);
    } catch {
      // Event data must never break the writer. Fall back to a minimal
      // record that preserves the category/name/timing without the payload.
      const fallback: TraceEvent = { v: 1, ts: event.ts, monoUs: event.monoUs, seq: sequenced.seq, cat: event.cat, ev: event.ev, ...(event.execId ? { execId: event.execId } : {}), ...(event.spanId ? { spanId: event.spanId } : {}), ...(event.parentId ? { parentId: event.parentId } : {}), ...(event.durUs !== undefined ? { durUs: event.durUs } : {}), data: { traceDataError: true } };
      line = fabricJsonText(fallback, MAX_EVENT_CHARS);
    }
    this.#writer.write(line);
  }

  span(cat: TraceCategory, ev: string, execId?: string, data?: Record<string, unknown>, parentId?: string): TraceSpan {
    const id = `span_${++this.#spanSeq}`;
    const startedUs = monotonicUs();
    let ended = false;
    return {
      id,
      end: (endData?: Record<string, unknown>): void => {
        if (ended) return;
        ended = true;
        this.#emit({
          v: 1,
          ts: new Date().toISOString(),
          monoUs: startedUs,
          cat,
          ev,
          ...(execId ? { execId } : {}),
          spanId: id,
          ...(parentId ? { parentId } : {}),
          durUs: Math.max(0, monotonicUs() - startedUs),
          ...(data || endData ? { data: { ...(data ?? {}), ...(endData ?? {}) } } : {}),
        });
      },
    };
  }

  event(cat: TraceCategory, ev: string, execId?: string, data?: Record<string, unknown>): void {
    this.#emit({
      v: 1,
      ts: new Date().toISOString(),
      monoUs: monotonicUs(),
      cat,
      ev,
      ...(execId ? { execId } : {}),
      ...(data ? { data } : {}),
    });
  }

  flush(): void {
    this.#writer.flush();
    const dropped = this.#writer.dropped;
    if (dropped > this.#reportedDrops) {
      const lost = dropped - this.#reportedDrops;
      this.#reportedDrops = dropped;
      this.event("teardown", "trace.dropped", undefined, { lost, total: dropped });
      this.#writer.flush();
    }
  }

  close(): void {
    if (this.#closed) return;
    this.flush();
    this.#closed = true;
    this.#writer.close();
  }
}

/** Env overrides configuration: "1"/"true"/"yes" force on, "0"/"false"/"no"
 * force off, anything else defers to the configured value (default off). */
export const resolveTraceEnabled = (envValue: string | undefined, configured: boolean): boolean => {
  const normalized = envValue?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return configured;
};

export interface FabricTracerOptions extends TraceWriterOptions {
  writer?: TraceWriter;
}

/** Create the active tracer. Callers must only invoke this after checking
 * resolveTraceEnabled(); otherwise use DISABLED_TRACER. */
export const createFabricTracer = (options: FabricTracerOptions): FabricTracer =>
  new ActiveFabricTracer(options.writer ?? createTraceWriter(options));
