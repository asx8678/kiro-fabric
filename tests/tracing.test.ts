import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { normalizeFabricConfig } from "../src/config.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { QuickJsRuntime } from "../src/runtime/quickjs-runtime.js";
import { createTraceWriter, type TraceWriter } from "../src/trace/trace-writer.js";
import {
  DISABLED_TRACER,
  createFabricTracer,
  resolveTraceEnabled,
} from "../src/trace/tracer.js";

// Observed JSONL wire shape for assertions, not an export of tracer internals.
type TraceEvent = {
  v: 1; ts: string; monoUs: number; seq: number;
  cat: Parameters<ReturnType<typeof createFabricTracer>["event"]>[0];
  ev: string; execId?: string; spanId?: string; parentId?: string;
  durUs?: number; data?: Record<string, unknown>;
};

const roots: string[] = [];
const temporary = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-trace-"));
  roots.push(root);
  return root;
};
afterAll(() => {
  for (const root of roots) removeFixtureSync(root, { recursive: true, force: true });
});

const readEvents = (file: string): TraceEvent[] =>
  fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as TraceEvent);

describe("trace toggle", () => {
  it("resolves the environment override over configuration", () => {
    expect(resolveTraceEnabled("1", false)).toBe(true);
    expect(resolveTraceEnabled("true", false)).toBe(true);
    expect(resolveTraceEnabled("0", true)).toBe(false);
    expect(resolveTraceEnabled("false", true)).toBe(false);
    expect(resolveTraceEnabled(undefined, true)).toBe(true);
    expect(resolveTraceEnabled(undefined, false)).toBe(false);
    expect(resolveTraceEnabled("unexpected", true)).toBe(true);
  });

  it("keeps tracing disabled by default and normalizes the configuration section", () => {
    expect(normalizeFabricConfig(undefined).tracing).toEqual({ enabled: false });
    expect(normalizeFabricConfig({ tracing: { enabled: true } }).tracing).toEqual({ enabled: true });
    expect(normalizeFabricConfig({ tracing: { enabled: "yes" } }).tracing).toEqual({ enabled: false });
  });

  it("provides a zero-allocation disabled tracer", () => {
    expect(DISABLED_TRACER.enabled).toBe(false);
    expect(DISABLED_TRACER.newExecutionId()).toBe("");
    // Repeated disabled spans return one frozen shared object: no per-call allocation.
    expect(DISABLED_TRACER.span("eval", "noop")).toBe(DISABLED_TRACER.span("eval", "noop"));
    DISABLED_TRACER.event("eval", "noop");
    DISABLED_TRACER.flush();
    DISABLED_TRACER.close();
  });
});

describe("trace writer", () => {
  it("writes JSONL and flushes synchronously", () => {
    const file = path.join(temporary(), "trace.jsonl");
    const writer = createTraceWriter({ file });
    writer.write('{"v":1,"ev":"a"}');
    writer.write('{"v":1,"ev":"b"}');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("");
    writer.flush();
    expect(readEvents(file).map((event) => event.ev)).toEqual(["a", "b"]);
    writer.close();
  });

  it("drops oldest lines when the ring is full and reports the count", () => {
    const file = path.join(temporary(), "trace.jsonl");
    const writer = createTraceWriter({ file, maxBufferLines: 2 });
    writer.write('{"ev":"a"}');
    writer.write('{"ev":"b"}');
    writer.write('{"ev":"c"}');
    expect(writer.dropped).toBe(1);
    writer.flush();
    expect(readEvents(file).map((event) => event.ev)).toEqual(["b", "c"]);
    writer.close();
  });

  it("emits a truncation marker and disables itself at the file cap", () => {
    const file = path.join(temporary(), "trace.jsonl");
    const writer = createTraceWriter({ file, maxFileBytes: 600 });
    for (let index = 0; index < 40; index += 1) writer.write(JSON.stringify({ ev: "bulk", index, pad: "x".repeat(64) }));
    writer.flush();
    writer.write('{"ev":"after-cap"}');
    writer.flush();
    expect(writer.disabled).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("trace.truncated");
    expect(text).not.toContain("after-cap");
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(600);
    writer.close();
  });

  it.each([16, 128])("keeps oversized UTF-8 JSONL within a %i-byte line cap", (maxLineBytes) => {
    const file = path.join(temporary(), "trace.jsonl");
    const writer = createTraceWriter({ file, maxLineBytes });
    writer.write(JSON.stringify({ ev: "large", pad: "界".repeat(4_096) }));
    writer.close();
    const text = fs.readFileSync(file, "utf8");
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(maxLineBytes);
    expect(() => JSON.parse(text.trim())).not.toThrow();
  });

  it("never leaves an unterminated marker line at caps too small for one", () => {
    const oversized = JSON.stringify({ ev: "large", pad: "x".repeat(4_096) });
    for (const maxLineBytes of [2, 7, 22]) {
      const file = path.join(temporary(), "trace.jsonl");
      const writer = createTraceWriter({ file, maxLineBytes });
      writer.write(oversized);
      writer.write(oversized);
      writer.close();
      const text = fs.readFileSync(file, "utf8");
      // Unterminated markers would merge into one malformed JSONL record, so a
      // cap that cannot hold a marker plus its newline drops the line instead.
      expect(text === "" || text.endsWith("\n"), String(maxLineBytes)).toBe(true);
      for (const line of text.split("\n").filter(Boolean)) expect(() => JSON.parse(line), `${maxLineBytes}: ${line}`).not.toThrow();
      // `{}\n` is the smallest marker (3 bytes): a 2-byte cap can hold nothing
      // and drops both lines, while 7 and 22 bytes admit the fallback markers.
      expect(writer.dropped, String(maxLineBytes)).toBe(maxLineBytes === 2 ? 2 : 0);
    }
  });

  it("rejects an unusable ring capacity without leaving a trace file or descriptor", () => {
    const file = path.join(temporary(), "trace.jsonl");
    expect(() => createTraceWriter({ file, maxBufferLines: 2 ** 32 })).toThrow();
    // The ring is built before the exclusive create, so the rejected writer
    // cannot leave an empty trace file or a leaked descriptor behind.
    expect(fs.existsSync(file)).toBe(false);
    const writer = createTraceWriter({ file });
    writer.write('{"ev":"ok"}');
    writer.close();
    expect(readEvents(file).map((event) => event.ev)).toEqual(["ok"]);
  });

  it("refuses a pre-existing symlink target and never touches its destination", () => {
    const root = temporary();
    const victim = path.join(root, "victim.jsonl");
    fs.writeFileSync(victim, "PRESERVE", { mode: 0o600 });
    for (const destination of [victim, path.join(root, "absent.jsonl")]) {
      const link = path.join(root, `trace-${path.basename(destination)}.jsonl`);
      fs.symlinkSync(destination, link);
      // The trace file is created exclusively ('wx'), so a symlink at that path
      // is refused instead of redirecting a private trace into another file.
      expect(() => createTraceWriter({ file: link }), destination).toThrow();
      expect(fs.lstatSync(link).isSymbolicLink(), destination).toBe(true);
      if (destination === victim) expect(fs.readFileSync(victim, "utf8"), destination).toBe("PRESERVE");
      else expect(fs.existsSync(destination), destination).toBe(false);
    }
  });

  it("accepts each documented maximum bound", () => {
    const file = path.join(temporary(), "trace.jsonl");
    const writer = createTraceWriter({
      file, maxBufferLines: 1_048_576, maxBufferBytes: 256 * 1024 * 1024,
      maxFileBytes: 1024 * 1024 * 1024, maxLineBytes: 1024 * 1024, flushIntervalMs: 60_000,
    });
    writer.write('{"ev":"ok"}');
    writer.close();
    expect(readEvents(file).map((event) => event.ev)).toEqual(["ok"]);
  });

  it("counts every eviction needed to admit one larger line", () => {
    const file = path.join(temporary(), "trace.jsonl");
    const writer = createTraceWriter({ file, maxBufferBytes: 64, maxLineBytes: 64 });
    for (let n = 0; n < 4; n++) writer.write(JSON.stringify({ n }));
    writer.write(JSON.stringify({ pad: "x".repeat(50) }));
    expect(writer.dropped).toBe(4);
    writer.close();
    expect(readEvents(file)).toEqual([{ pad: "x".repeat(50) }]);
  });

  it("drops an unbufferable line without evicting existing lines", () => {
    const file = path.join(temporary(), "trace.jsonl");
    const writer = createTraceWriter({ file, maxBufferBytes: 8 });
    writer.write("{}");
    writer.write('{"n":123456789}');
    expect(writer.dropped).toBe(1);
    writer.close();
    expect(fs.readFileSync(file, "utf8")).toBe("{}\n");
  });

  it.each([
    { maxBufferLines: 0 }, { maxBufferLines: -1 }, { maxBufferLines: 1.5 },
    { maxBufferLines: Number.NaN }, { maxBufferBytes: 0 },
    { maxLineBytes: 0 }, { maxFileBytes: -1 }, { flushIntervalMs: 0 },
    // Practical maxima: an over-range bound would otherwise let a caller request
    // an unbounded ring allocation or an effectively uncapped trace file.
    { maxBufferLines: 1_048_577 }, { maxBufferBytes: 256 * 1024 * 1024 + 1 },
    { maxFileBytes: 1024 * 1024 * 1024 + 1 }, { maxLineBytes: 1024 * 1024 + 1 },
    { flushIntervalMs: 60_001 }, { maxBufferLines: Number.MAX_SAFE_INTEGER },
  ])("rejects invalid writer bounds before creating a file: %j", (bounds) => {
    const file = path.join(temporary(), "trace.jsonl");
    expect(() => { const writer = createTraceWriter({ file, ...bounds }); writer.close(); }).toThrow(/must be/);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("fabric tracer", () => {
  const capture = (): { writer: TraceWriter; lines: string[] } => {
    const lines: string[] = [];
    return {
      lines,
      writer: {
        file: "/unused",
        dropped: 0,
        disabled: false,
        write: (line: string) => lines.push(line),
        flush: () => undefined,
        close: () => undefined,
      },
    };
  };

  it("emits microsecond-span events with correlation ids", () => {
    const { writer, lines } = capture();
    const tracer = createFabricTracer({ file: "/unused", writer });
    expect(tracer.enabled).toBe(true);
    expect(tracer.file).toBe("/unused");
    const execId = tracer.newExecutionId();
    expect(execId).toMatch(/^exec_/u);
    const parent = tracer.span("eval", "execute", execId);
    const span = tracer.span("bridge", "state.get", execId, { key: "k" }, parent.id);
    span.end({ ok: true });
    parent.end();
    tracer.event("eval", "marker", execId);
    const [spanEvent, parentEvent, marker] = lines.map((line) => JSON.parse(line) as TraceEvent);
    expect(spanEvent!.cat).toBe("bridge");
    expect(spanEvent!.ev).toBe("state.get");
    expect(spanEvent!.execId).toBe(execId);
    expect(spanEvent!.durUs).toBeGreaterThanOrEqual(0);
    expect(spanEvent!.data).toEqual({ key: "k", ok: true });
    expect(spanEvent!.spanId).toMatch(/^span_/u);
    expect(spanEvent!.parentId).toBe(parent.id);
    expect(parentEvent!.spanId).toBe(parent.id);
    expect(parentEvent!.parentId).toBeUndefined();
    expect(marker!.durUs).toBeUndefined();
    expect(marker!.spanId).toBeUndefined();
    expect(marker!.monoUs).toBeGreaterThan(0);
    // seq gives strict emission order even when monoUs ties.
    const seqs = lines.map((line) => (JSON.parse(line) as TraceEvent).seq);
    expect(seqs).toEqual([...seqs].sort((left, right) => (left ?? 0) - (right ?? 0)));
    expect(new Set(seqs).size).toBe(seqs.length);
    tracer.close();
  });

  it("falls back to a minimal record when event data is outside the JSON contract", () => {
    const { writer, lines } = capture();
    const tracer = createFabricTracer({ file: "/unused", writer });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    tracer.event("eval", "cyclic", undefined, { bad: cyclic });
    const event = JSON.parse(lines[0]!) as TraceEvent;
    expect(event.ev).toBe("cyclic");
    expect(event.data).toEqual({ traceDataError: true });
    tracer.close();
  });
});

describe("QuickJS trace hooks", () => {
  const defaults = { timeoutMs: 5_000, maxTimeoutMs: 10_000, memoryLimitBytes: 32 * 1024 * 1024, maxSourceBytes: 64 * 1024, maxLogChars: 1_000 };

  it("emits the full execution lifecycle with one correlation id", async () => {
    const file = path.join(temporary(), "trace.jsonl");
    const tracer = createFabricTracer({ file });
    const execId = tracer.newExecutionId();
    const result = await new QuickJsRuntime().execute(
      "await state.get({ key: 'k' }); return { ok: true }",
      async (ref) => ({ ref, found: false }),
      { ...defaults, tracer, execId },
    );
    expect(result.terminationReason).toBe("completed");
    tracer.close();
    const events = readEvents(file);
    const names = events.map((event) => event.ev);
    expect(names).toEqual(expect.arrayContaining([
      "quickjs.module.acquire",
      "quickjs.context.create",
      "quickjs.eval.setup",
      "quickjs.eval.guest",
      "quickjs.run",
      "quickjs.memory",
      "quickjs.teardown",
    ]));
    for (const event of events) expect(event.execId).toBe(execId);
    const memory = events.find((event) => event.ev === "quickjs.memory");
    expect(typeof memory?.data?.usage).toBe("object");
    expect(typeof (memory?.data?.usage as Record<string, unknown>)?.memory_used_size).toBe("number");
    expect(typeof memory?.data?.hostRssBytes).toBe("number");
    // Sandbox spans are parented to the service-level execute span when one
    // is supplied, and standalone otherwise.
    const spans = events.filter((event) => event.durUs !== undefined);
    expect(spans.length).toBeGreaterThanOrEqual(5);
    for (const span of spans) expect(span.monoUs).toBeGreaterThan(0);
  });

  it("adds no trace events when the disabled tracer is supplied", async () => {
    const result = await new QuickJsRuntime().execute(
      "return 1 + 1",
      async () => null,
      { ...defaults, tracer: DISABLED_TRACER, execId: "" },
    );
    expect(result.terminationReason).toBe("completed");
    expect(result.value).toBe(2);
  });

  it("forwards the tracer from the execution service into the QuickJS sandbox", async () => {
    const file = path.join(temporary(), "trace.jsonl");
    const tracer = createFabricTracer({ file });
    const execId = tracer.newExecutionId();
    const config = normalizeFabricConfig({ executor: { timeoutMs: 5_000 } });
    const service = new FabricExecutionService(new ActionRegistry(), config, "/workspace");
    const result = await service.execute({
      code: "return 40 + 2",
      approver: { async approve() {} },
      tracer,
      execId,
    });
    await service.close();
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.value).toBe(42);
    tracer.close();
    const names = readEvents(file).map((event) => event.ev);
    expect(names).toEqual(expect.arrayContaining([
      "exec.start",
      "compile",
      "execute",
      "quickjs.run",
      "quickjs.memory",
      "quickjs.teardown",
      "exec.end",
    ]));
  });

  it("emits parent-linked bridge and approval spans with payload sizes", async () => {
    const file = path.join(temporary(), "trace.jsonl");
    const tracer = createFabricTracer({ file });
    const execId = tracer.newExecutionId();
    const registry = new ActionRegistry();
    registry.register({
      name: "probe",
      description: "probe provider",
      async list() {
        return [{ name: "put", description: "store a value", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false }, risk: "write", effect: { kind: "write" } }];
      },
      async describe(actionName) {
        return (await this.list()).find((descriptor) => descriptor.name === actionName);
      },
      async invoke(_actionName, args) {
        return { stored: true, echo: args.value };
      },
    });
    const config = normalizeFabricConfig({ executor: { timeoutMs: 5_000 } });
    const service = new FabricExecutionService(registry, config, "/workspace");
    const result = await service.execute({
      code: "return await tools.call({ ref: 'probe.put', args: { value: 'x'.repeat(200) } })",
      approver: { async approve() {} },
      tracer,
      execId,
    });
    await service.close();
    expect(result.success, JSON.stringify(result)).toBe(true);
    tracer.close();
    const events = readEvents(file);
    const execute = events.find((event) => event.ev === "execute");
    const bridge = events.find((event) => event.cat === "bridge" && event.ev === "fabric.call");
    expect(bridge?.data?.actionRef).toBe("probe.put");
    expect(bridge?.data?.ok).toBe(true);
    expect(bridge?.data?.argsChars).toBeGreaterThan(200);
    expect(bridge?.data?.resultChars).toBeGreaterThan(200);
    expect(bridge?.parentId).toBe(execute?.spanId);
    const approval = events.find((event) => event.ev === "approval.wait");
    expect(approval?.data).toMatchObject({ ref: "probe.put", risk: "write", approved: true });
    expect(approval?.parentId).toBe(bridge?.spanId);
    // Sandbox-internal spans hang under the execute span too.
    const run = events.find((event) => event.ev === "quickjs.run");
    expect(run?.parentId).toBe(execute?.spanId);
    const end = events.find((event) => event.ev === "exec.end");
    expect(end?.data?.status).toBe("succeeded");
    expect(end?.data?.resultChars).toBeGreaterThan(200);
  });

  it.each(["approval", "provider"] as const)("keeps free-form %s errors out of routine traces", async (failure) => {
    const marker = "benign-unique-error-marker-7319";
    const file = path.join(temporary(), "trace.jsonl");
    const tracer = createFabricTracer({ file });
    const registry = new ActionRegistry();
    registry.register({
      name: "probe", description: "fixture",
      async list() { return [{ name: "fail", description: "fixture", inputSchema: { type: "object" }, risk: "read", effect: { kind: "read" } }]; },
      async describe() { return (await this.list())[0]; },
      async invoke() { throw new Error(marker); },
    });
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 5_000 } }), "/workspace");
    try {
      const result = await service.execute({
        code: "return await tools.call({ ref: 'probe.fail', args: {} })",
        approver: { async approve() { if (failure === "approval") throw new Error(marker); } },
        tracer, execId: tracer.newExecutionId(),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain(marker);
    } finally { await service.close(); tracer.close(); }
    expect(fs.readFileSync(file, "utf8")).not.toContain(marker);
    const events = readEvents(file);
    expect(events.find((event) => event.cat === "bridge")?.data).toMatchObject({ ok: false, errorKind: "provider_failed" });
    expect(events.find((event) => event.ev === "approval.wait")?.data).toMatchObject(failure === "approval"
      ? { approved: false, errorKind: "approval_failed" } : { approved: true });
    expect(events.every((event) => event.data?.error === undefined)).toBe(true);
  });

  it("records pool-observed cache and worker outcomes through real execution traces", async () => {
    const file = path.join(temporary(), "compile-trace.jsonl");
    const tracer = createFabricTracer({ file });
    const service = new FabricExecutionService(new ActionRegistry(), normalizeFabricConfig({ executor: { timeoutMs: 5_000 } }), "/workspace");
    const programs = ["return 'compiler-private-payload'", "return 'compiler-private-payload'", "return 2", "return missingCompileFixtureName"];
    const ids: string[] = [];
    try {
      for (const [index, code] of programs.entries()) {
        const execId = tracer.newExecutionId(); ids.push(execId);
        const result = await service.execute({ code, tracer, execId, approver: { async approve() {} } });
        expect(result.success, JSON.stringify(result)).toBe(index !== 3);
      }
    } finally { await service.close(); tracer.close(); }
    const events = readEvents(file);
    const results = events.filter(event => event.ev === "compile.result");
    expect(results.map(event => event.execId)).toEqual(ids);
    expect(results.map(event => event.data)).toEqual([
      { cache: "miss", worker: "cold", typeErrors: 0 },
      { cache: "hit", typeErrors: 0 },
      { cache: "miss", worker: "warm", typeErrors: 0 },
      { cache: "miss", worker: "warm", typeErrors: expect.any(Number) },
    ]);
    expect(results[3]!.data!.typeErrors).toBeGreaterThan(0);
    for (const event of results) {
      const span = events.find(span => span.ev === "compile" && span.execId === event.execId);
      expect(span?.data?.cache).toBe(event.data?.cache);
      expect(span?.data?.worker).toBe(event.data?.worker);
      expect(span?.durUs).toBeGreaterThanOrEqual(0);
    }
    expect(fs.readFileSync(file, "utf8")).not.toContain("compiler-private-payload");
  });

  it("emits exec.end on type-check failure with the error count", async () => {
    const file = path.join(temporary(), "trace.jsonl");
    const tracer = createFabricTracer({ file });
    const execId = tracer.newExecutionId();
    const config = normalizeFabricConfig({ executor: { timeoutMs: 5_000 } });
    const service = new FabricExecutionService(new ActionRegistry(), config, "/workspace");
    const result = await service.execute({
      code: "return doesNotExist + 1",
      approver: { async approve() {} },
      tracer,
      execId,
    });
    await service.close();
    expect(result.success).toBe(false);
    tracer.close();
    const events = readEvents(file);
    const end = events.find((event) => event.ev === "exec.end");
    expect(end?.data?.status).toBe("failed");
    expect(end?.data?.typeErrors).toBeGreaterThan(0);
    expect(events.some((event) => event.ev === "quickjs.run")).toBe(false);
  });
});
