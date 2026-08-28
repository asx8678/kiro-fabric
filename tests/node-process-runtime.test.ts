import { describe, expect, it, vi } from "vitest";
import { NodeProcessRuntime } from "../src/runtime/node-process-runtime.js";
import {
  DEFAULT_EXECUTOR_SOURCE_BYTES,
  MAX_EXECUTOR_SOURCE_BYTES,
  MAX_EXECUTOR_TRANSPILED_BYTES,
} from "../src/runtime/source-limit.js";

const options = {
  timeoutMs: 5_000,
  memoryLimitBytes: 128 * 1024 * 1024,
};

describe("NodeProcessRuntime", () => {
  it("rejects oversized UTF-8 source before transpilation or child spawn", async () => {
    const hostCall = vi.fn(async () => undefined);
    const result = await new NodeProcessRuntime().execute(
      "é".repeat(17),
      hostCall,
      { ...options, maxSourceBytes: 33 },
    );

    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toBe(
      "Fabric source exceeds executor.maxSourceBytes: received 34 bytes, limit 33 bytes",
    );
    expect(result.logs).toEqual([]);
    expect(hostCall).not.toHaveBeenCalled();
  });

  it.each([
    [Number.NaN, DEFAULT_EXECUTOR_SOURCE_BYTES],
    [Number.POSITIVE_INFINITY, DEFAULT_EXECUTOR_SOURCE_BYTES],
    [MAX_EXECUTOR_SOURCE_BYTES + 1, MAX_EXECUTOR_SOURCE_BYTES],
  ])("normalizes a noncanonical direct source limit %s", async (configured, effective) => {
    const result = await new NodeProcessRuntime().execute(
      "x".repeat(effective + 1),
      async () => undefined,
      { ...options, maxSourceBytes: configured },
    );
    expect(result.error).toContain(`limit ${effective} bytes`);
  });

  it("rejects oversized caller-supplied transpiled code before child spawn", async () => {
    const hostCall = vi.fn(async () => undefined);
    const result = await new NodeProcessRuntime().execute(
      "return 1;",
      hostCall,
      { ...options, transpiledCode: "x".repeat(MAX_EXECUTOR_TRANSPILED_BYTES + 1) },
    );
    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("Fabric transpiled source exceeds hard limit");
    expect(hostCall).not.toHaveBeenCalled();
  });

  it("keeps deadline extensions monotonic across wall-clock rollback", async () => {
    const realNow = Date.now();
    let dateSpy: ReturnType<typeof vi.spyOn> | undefined;
    const started = performance.now();
    try {
      const result = await new NodeProcessRuntime().execute(
        'await tools.call({ ref: "demo.once", args: {} }); while (true) {}',
        async () => undefined,
        {
          ...options,
          timeoutMs: 50,
          minimumTimeoutMsForHostCall: () => {
            dateSpy = vi.spyOn(Date, "now").mockReturnValue(realNow - 60_000);
            return 150;
          },
        },
      );
      expect(result.terminationReason).toBe("timed_out");
      expect(performance.now() - started).toBeLessThan(1_000);
    } finally {
      dateSpy?.mockRestore();
    }
  });

  it("runs guest code in a disposable process and bridges host calls", async () => {
    const result = await new NodeProcessRuntime().execute(
      `
const models = await tools.models();
print("models", models.length);
return { models, process: typeof process, require: typeof require };
`,
      async (ref) => ref === "fabric.$models" ? [{ id: "large-model" }] : undefined,
      options,
    );

    expect(result.error).toBeUndefined();
    expect(result.logs).toEqual(["models 1"]);
    expect(result.value).toEqual({
      models: [{ id: "large-model" }],
      process: "undefined",
      require: "undefined",
    });
  });

  it("routes actor-management guest proxies through the shared setup", async () => {
    const calls: Array<{ ref: string; args: Record<string, unknown> }> = [];
    const result = await new NodeProcessRuntime().execute(
      `
await agents.setTools({ id: "a1", tools: ["read"] });
await agents.setDeliveryPolicy({ id: "a1", delivery: "mailbox", triggerTurn: false });
await agents.clearMessages({ id: "a1" });
await agents.import({ name: "template" });
await agents.export({ id: "a1" });
return "ok";
`,
      async (ref, args) => {
        calls.push({ ref, args });
        return { id: String(args.id ?? "template") };
      },
      options,
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toBe("ok");
    expect(calls.map((call) => call.ref)).toEqual([
      "agents.setTools",
      "agents.setDeliveryPolicy",
      "agents.clearMessages",
      "agents.import",
      "agents.export",
    ]);
  });

  it("binds the Kiro-only k namespace without exposing pi", async () => {
    const result = await new NodeProcessRuntime().execute(
      'return { value: await k.read({ path: "package.json" }), piType: typeof pi };',
      async (ref, args) => {
        expect(ref).toBe("k.read");
        expect(args).toEqual({ path: "package.json" });
        return "kiro-read";
      },
      { ...options, coreToolNamespace: "k" },
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({ value: "kiro-read", piType: "undefined" });
  });

  it("normalizes the string shorthand for tools.search", async () => {
    const result = await new NodeProcessRuntime().execute(
      'return tools.search("fovea");',
      async (ref, args) => {
        expect(ref).toBe("fabric.$search");
        expect(args).toEqual({ query: "fovea" });
        return [{ ref: "extensions.fovea_focus" }];
      },
      options,
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual([{ ref: "extensions.fovea_focus" }]);
  });

  it("extends the active deadline for a long host call", async () => {
    const result = await new NodeProcessRuntime().execute(
      'await tools.call({ ref: "pi.bash", args: { timeout: 1 } }); return "ok";',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_250));
        return { output: "ok" };
      },
      {
        ...options,
        timeoutMs: 1_000,
        minimumTimeoutMsForHostCall(ref) {
          return ref === "fabric.$call" ? 3_000 : undefined;
        },
      },
    );

    expect(result.terminationReason).toBe("completed");
    expect(result.value).toBe("ok");
  });

  it("keeps one absolute deadline across sequential host-call extensions", async () => {
    const result = await new NodeProcessRuntime().execute(
      `
await tools.call({ ref: "demo.delay" });
return tools.call({ ref: "agents.run", args: { task: "late" } });
`,
      async () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ status: "completed" }), 70);
        }),
      {
        ...options,
        timeoutMs: 100,
        minimumTimeoutMsForHostCall(ref) {
          return ref === "fabric.$call" ? 100 : undefined;
        },
      },
    );

    expect(result.terminationReason).toBe("timed_out");
    expect(result.error).toBe("Execution timed out after 100ms");
  });

  it("preserves named string payloads", async () => {
    const content = [
      "multiline",
      "` ${value} { braces }",
      "quotes: \" '",
      "nul:" + String.fromCharCode(0) + " end",
    ].join("\n");
    const result = await new NodeProcessRuntime().execute(
      "return π.content;",
      async () => undefined,
      { ...options, strings: { content } },
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toBe(content);
  });

  it("accepts a heap limit above the QuickJS WASM32 ceiling", async () => {
    const result = await new NodeProcessRuntime().execute(
      "return 1;",
      async () => undefined,
      { ...options, memoryLimitBytes: 5 * 1024 ** 3 },
    );

    expect(result.terminationReason).toBe("completed");
    expect(result.value).toBe(1);
  });

  it("waits for issued host calls before completing", async () => {
    let settled = false;
    const result = await new NodeProcessRuntime().execute(
      'void tools.call({ ref: "demo.background" }); return "done";',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        settled = true;
      },
      options,
    );

    expect(result.value).toBe("done");
    expect(settled).toBe(true);
  });

  it("does not wait for a non-cooperative sibling host call after guest failure", async () => {
    const startedAt = Date.now();
    const result = await new NodeProcessRuntime().execute(
      `
await Promise.all([
  tools.call({ ref: "demo.never" }),
  Promise.reject(new Error("branch failed")),
]);
`,
      async () => new Promise(() => undefined),
      options,
    );

    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("branch failed");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("bounds non-cooperative fire-and-forget host calls", async () => {
    const startedAt = Date.now();
    const result = await new NodeProcessRuntime().execute(
      'void tools.call({ ref: "demo.never" }); return "done";',
      async () => new Promise(() => undefined),
      options,
    );

    expect(result.terminationReason).toBe("completed");
    expect(result.value).toBe("done");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("forcibly terminates synchronous infinite loops", async () => {
    const result = await new NodeProcessRuntime().execute(
      "while (true) {}",
      async () => undefined,
      { ...options, timeoutMs: 50 },
    );

    expect(result.terminationReason).toBe("timed_out");
    expect(result.error).toContain("timed out after 50ms");
  });

  it("surfaces unbounded recursion as a runtime error", async () => {
    const result = await new NodeProcessRuntime().execute(
      "function f() { return f() + 1; } f();",
      async () => undefined,
      options,
    );

    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("Maximum call stack size exceeded");
  });

  it("terminates the child process when externally aborted", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("stop")), 25);
    const result = await new NodeProcessRuntime().execute(
      "await new Promise(() => {});",
      async () => undefined,
      { ...options, signal: controller.signal },
    );

    expect(result.terminationReason).toBe("aborted");
    expect(result.error).toBe("Execution cancelled");
  });
});

describe("NodeProcessRuntime guest stack remapping", () => {
  it("remaps child error frames to user code lines", async () => {
    const result = await new NodeProcessRuntime().execute(
      ["const before = 1;", "print(before);", 'throw new Error("boom");'].join("\n"),
      async () => undefined,
      { timeoutMs: 5_000, memoryLimitBytes: 128 * 1024 * 1024 },
    );

    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("guest code:3:");
    expect(result.error).toContain("boom");
  });
});
