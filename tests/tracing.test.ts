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
  type TraceEvent,
} from "../src/trace/tracer.js";

const roots: string[] = [];
const temporary = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-trace-"));
  roots.push(root);
  return root;
};
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
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

  it("truncates oversized lines instead of dropping the buffer bound", () => {
    const file = path.join(temporary(), "trace.jsonl");
    const writer = createTraceWriter({ file, maxLineBytes: 128 });
    writer.write(JSON.stringify({ ev: "large", pad: "y".repeat(4_096) }));
    writer.flush();
    const text = fs.readFileSync(file, "utf8");
    expect(text.length).toBeLessThanOrEqual(200);
    writer.close();
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
    const span = tracer.span("bridge", "memory.get", execId, { key: "k" }, parent.id);
    span.end({ ok: true });
    parent.end();
    tracer.event("eval", "marker", execId);
    const [spanEvent, parentEvent, marker] = lines.map((line) => JSON.parse(line) as TraceEvent);
    expect(spanEvent!.cat).toBe("bridge");
    expect(spanEvent!.ev).toBe("memory.get");
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
      "await memory.get({ key: 'k' }); return { ok: true }",
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
