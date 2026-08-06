import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toYaml } from "../../src/api/yaml.js";
import { compressContextText } from "../../src/api/compress.js";
import { formatContext } from "../../src/api/args.js";
import { payloadsInput, MAX_PAYLOADS_CHARS } from "../../src/cli/input.js";
import { createApi } from "../../src/api.js";
import { defaults, type FabricConfig } from "../../src/config.js";
import { FakeAiRunner } from "../../src/runners/fake.js";

async function fixture(handler?: ConstructorParameters<typeof FakeAiRunner>[0]) {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-ergo-"));
  await writeFile(path.join(root, "a.ts"), "one");
  const config: FabricConfig = {
    ...defaults,
    projectRoot: root,
    budgets: { ...defaults.budgets },
    filesystem: { ...defaults.filesystem, allowWrite: [] },
    git: { ...defaults.git },
    shell: { ...defaults.shell },
    runner: { ...defaults.runner },
    output: { ...defaults.output },
    mutation: { ...defaults.mutation, enabled: false },
  };
  return { root, config, runner: new FakeAiRunner(handler) };
}

describe("fabric.util.toYaml", () => {
  it("serializes nested structures without JSON punctuation", () => {
    const yaml = toYaml({
      summary: "found it",
      paths: ["src/a.ts", "src/b.ts"],
      meta: { count: 2, verified: true, note: null },
    });
    expect(yaml).toBe(
      [
        "summary: found it",
        "paths:",
        "  - src/a.ts",
        "  - src/b.ts",
        "meta:",
        "  count: 2",
        "  verified: true",
        "  note: null",
      ].join("\n"),
    );
    expect(yaml.length).toBeLessThan(
      JSON.stringify({
        summary: "found it",
        paths: ["src/a.ts", "src/b.ts"],
        meta: { count: 2, verified: true, note: null },
      }).length,
    );
  });

  it("quotes unsafe strings and emits block scalars for multiline text", () => {
    expect(toYaml({ key: "a: b" })).toBe('key: "a: b"');
    expect(toYaml({ key: "true" })).toBe('key: "true"');
    expect(toYaml({ key: "line1\nline2" })).toBe("key: |-\n  line1\n  line2");
    expect(toYaml({ key: "trail \n" })).toBe('key: "trail \\n"');
    expect(toYaml("root")).toBe("root");
    expect(toYaml([])).toBe("[]");
    expect(toYaml({})).toBe("{}");
  });

  it("drops undefined properties and rejects cycles", () => {
    expect(toYaml({ a: undefined, b: 1 })).toBe("b: 1");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => toYaml(cyclic)).toThrow(/cyclic/);
  });
});

describe("deterministic context compression", () => {
  it("collapses duplicates, drops comments, and guarantees the bound", () => {
    // Comments + code that stays over budget until comments are dropped.
    const comments = Array.from({ length: 10 }, (_, i) => `// note number ${i} here`);
    const code = Array.from({ length: 10 }, (_, i) => `const value${i} = ${i};`);
    const text = [...comments, ...code, ...code].join("\n");
    const compressed = compressContextText(text, 300);
    expect(compressed).not.toContain("// note number 0");
    expect(compressed).toContain("comment lines dropped");
    // Consecutive duplicates were collapsed before comment extraction.
    expect(compressed.indexOf("const value0 = 0;")).toBe(
      compressed.lastIndexOf("const value0 = 0;"),
    );
    expect(compressed.length).toBeLessThanOrEqual(300);
  });

  it("middle-truncates when extraction is not enough", () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
    const compressed = compressContextText(text, 500);
    expect(compressed.length).toBeLessThanOrEqual(500);
    expect(compressed).toContain("chars omitted");
    expect(compressed).toContain("line 0");
    expect(compressed).toContain("line 199");
  });

  it("truncates over-long lines before anything else", () => {
    const compressed = compressContextText(`${"y".repeat(5000)}\nshort`, 100);
    expect(compressed.length).toBeLessThanOrEqual(100);
    expect(compressed).toContain("short");
  });

  it("does not guillotine single-line JSON payloads to a stub", () => {
    // Regression: a compactJson-style one-line context must reach the final
    // head+tail truncation, not the per-line stage — a fixed line cap turned a
    // 220KB evidence pack into 240 chars (observed in a real fabric.ai.run).
    const payload = JSON.stringify({
      head: "A".repeat(10000),
      middle: { paths: ["a.ts", "b.ts"] },
      tail: "Z".repeat(10000),
    });
    const compressed = compressContextText(payload, 2000);
    expect(compressed.length).toBeLessThanOrEqual(2000);
    expect(compressed.length).toBeGreaterThan(1000);
    expect(compressed).toContain("chars omitted");
    expect(compressed).toContain("AAAA");
    expect(compressed).toContain("ZZZZ");
  });
});

describe("stable-first context ordering", () => {
  it("moves volatile items after stable ones, preserving relative order", () => {
    const formatted = formatContext([
      { stability: "volatile", id: 1 },
      { id: 2 },
      { stability: "stable", id: 3 },
      { stability: "volatile", id: 4 },
    ]);
    const parsed = JSON.parse(formatted) as Array<Record<string, unknown>>;
    expect(parsed.map((item) => item.id)).toEqual([2, 3, 1, 4]);
    expect(parsed[2]).toMatchObject({ _stability: "volatile" });
    expect(parsed[0]).not.toHaveProperty("_stability");
  });

  it("combines with relevanceHint and leaves plain arrays untouched", () => {
    const formatted = formatContext([{ relevanceHint: "high", stability: "volatile", data: "x" }]);
    expect(JSON.parse(formatted)).toEqual([
      { _relevance: "high", _stability: "volatile", data: "x" },
    ]);
    expect(formatContext([{ a: 1 }, "b"])).toBe(JSON.stringify([{ a: 1 }, "b"]));
  });
});

describe("ai.run label and compressContext", () => {
  it("echoes label on results and rejects invalid labels", async () => {
    const { root, config, runner } = await fixture();
    try {
      const { fabric } = createApi(config, runner);
      const result = await fabric.ai.run({ instruction: "x", label: "planner-1" });
      expect(result.label).toBe("planner-1");
      expect(result.compressed).toBeUndefined();
      await expect(fabric.ai.run({ instruction: "x", label: "line1\nline2" })).rejects.toThrow(
        /label/,
      );
      await expect(fabric.ai.run({ instruction: "x", label: "y".repeat(121) })).rejects.toThrow(
        /label/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("carries labels on parallel error entries", async () => {
    const { root, config, runner } = await fixture(() => "garbage with no frame");
    try {
      config.budgets = { ...config.budgets, maxRetriesPerCall: 0 };
      const { fabric } = createApi(config, runner);
      const results = await fabric.ai.parallel({
        tasks: [{ instruction: "x", label: "doomed-call" }],
      });
      expect(results[0]).toMatchObject({ label: "doomed-call" });
      expect(results[0]!.error).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("compresses over-budget contexts only when opted in", async () => {
    const { root, config, runner } = await fixture();
    try {
      config.budgets = { ...config.budgets, maxContextCharsPerCall: 500 };
      const { fabric } = createApi(config, runner);
      const big = Array.from({ length: 100 }, (_, i) => `// note ${i}\nconst v${i} = ${i};`).join(
        "\n",
      );
      await expect(fabric.ai.run({ instruction: "x", context: big })).rejects.toMatchObject({
        code: "BUDGET_EXCEEDED",
      });
      const result = await fabric.ai.run({ instruction: "x", context: big, compressContext: true });
      expect(result.compressed).toBe(true);
      expect(result.value).toEqual({ ok: true });
      expect(runner.calls[0]!.context.length).toBeLessThanOrEqual(500);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("readMany strict mode and compactJson default", () => {
  it("returns missing placeholders with strict:false and still throws on policy", async () => {
    const { root, config, runner } = await fixture();
    try {
      const { fabric } = createApi(config, runner);
      const results = await fabric.fs.readMany({
        paths: ["a.ts", "AGENTS.md", "CONTRIBUTING.md"],
        strict: false,
      });
      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({ path: "a.ts", chars: 3 });
      expect(results[1]).toMatchObject({ path: "AGENTS.md", content: "", missing: true });
      expect(results[2]).toMatchObject({ path: "CONTRIBUTING.md", missing: true });
      // Default remains strict.
      await expect(fabric.fs.readMany({ paths: ["a.ts", "AGENTS.md"] })).rejects.toThrow();
      // Policy violations are never softened.
      await expect(fabric.fs.readMany({ paths: [".env"], strict: false })).rejects.toMatchObject({
        code: "POLICY_DENIED",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("compactJson bounds output with a default cap", async () => {
    const { root, config, runner } = await fixture();
    try {
      const { fabric } = createApi(config, runner);
      expect(fabric.util.compactJson({ a: 1 })).toBe('{"a":1}');
      expect(fabric.util.compactJson({ a: "x".repeat(20000) }).length).toBeLessThanOrEqual(16000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("named payloads", () => {
  it("exposes validated payloads as fabric.payloads", async () => {
    const { root, config, runner } = await fixture();
    try {
      const { fabric } = createApi(config, runner, {
        payloads: { "big-spec": "a lot of text" },
      });
      expect(fabric.payloads).toEqual({ "big-spec": "a lot of text" });
      expect(Object.isFrozen(fabric.payloads)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates the payloads file shape", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fabric-payloads-"));
    try {
      const good = path.join(dir, "good.json");
      await writeFile(good, JSON.stringify({ spec: "text", "log-2024.01": "lines" }));
      expect(await payloadsInput(good)).toEqual({ spec: "text", "log-2024.01": "lines" });

      const badKey = path.join(dir, "bad-key.json");
      await writeFile(badKey, JSON.stringify({ "not ok": "x" }));
      await expect(payloadsInput(badKey)).rejects.toThrow(/payload key/);

      const badValue = path.join(dir, "bad-value.json");
      await writeFile(badValue, JSON.stringify({ spec: 42 }));
      await expect(payloadsInput(badValue)).rejects.toThrow(/must be a string/);

      const notObject = path.join(dir, "array.json");
      await writeFile(notObject, JSON.stringify(["x"]));
      await expect(payloadsInput(notObject)).rejects.toThrow(/JSON object/);

      const huge = path.join(dir, "huge.json");
      await writeFile(huge, JSON.stringify({ spec: "x".repeat(MAX_PAYLOADS_CHARS) }));
      await expect(payloadsInput(huge)).rejects.toThrow(/exceed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
