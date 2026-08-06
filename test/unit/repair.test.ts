import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  escapeStringControlChars,
  repairFramedOutput,
  salvageJson,
  tryRepairOutput,
} from "../../src/runners/repair.js";
import { parseFramed } from "../../src/runners/parser.js";
import { createApi } from "../../src/api.js";
import { defaults, type FabricConfig } from "../../src/config.js";
import { FakeAiRunner } from "../../src/runners/fake.js";

const framed = (value: unknown) =>
  `FABRIC_RESULT_BEGIN\n${JSON.stringify(value)}\nFABRIC_RESULT_END`;

const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    paths: { type: "array", items: { type: "string" } },
    count: { type: "integer" },
    verified: { type: "boolean" },
    note: { type: "string" },
    slug: { type: "string", pattern: "^[a-z-]+$" },
  },
  required: ["summary", "paths"],
  additionalProperties: false,
} as const;

describe("deterministic output repair ladder", () => {
  it("drops null on optional fields", () => {
    const out = tryRepairOutput(
      { summary: "s", paths: ["a"], note: null },
      schema as unknown as Record<string, unknown>,
    );
    expect(out?.value).toEqual({ summary: "s", paths: ["a"] });
    expect(out?.repairs).toEqual(["dropNullOptional(note)"]);
  });

  it("keeps null when the schema permits or requires it", () => {
    expect(
      tryRepairOutput({ summary: "s", paths: ["a"], note: null }, {
        ...schema,
        properties: { ...schema.properties, note: { type: ["string", "null"] } },
      } as unknown as Record<string, unknown>),
    ).toBeDefined();
    const requiredNull = tryRepairOutput({ summary: "s", paths: ["a"], note: null }, {
      ...schema,
      required: ["summary", "paths", "note"],
    } as unknown as Record<string, unknown>);
    expect(requiredNull).toBeUndefined();
  });

  it("parses stringified arrays and drops empty-object placeholders", () => {
    const out = tryRepairOutput(
      { summary: "s", paths: '["a","b"]', note: {} },
      schema as unknown as Record<string, unknown>,
    );
    expect(out?.value).toEqual({ summary: "s", paths: ["a", "b"] });
    expect(out?.repairs).toContain("parseStringifiedValue(paths)");
    expect(out?.repairs).toContain("dropEmptyObjectPlaceholder(note)");
  });

  it("wraps bare strings as arrays", () => {
    const out = tryRepairOutput(
      { summary: "s", paths: "a.ts" },
      schema as unknown as Record<string, unknown>,
    );
    expect(out?.value).toEqual({ summary: "s", paths: ["a.ts"] });
    expect(out?.repairs).toEqual(["wrapBareValueAsArray(paths)"]);
  });

  it("coerces scalar strings to numbers and booleans", () => {
    const out = tryRepairOutput(
      { summary: "s", paths: [], count: "42", verified: "true" },
      schema as unknown as Record<string, unknown>,
    );
    expect(out?.value).toEqual({ summary: "s", paths: [], count: 42, verified: true });
    expect(out?.repairs).toContain("coerceScalar(count)");
    expect(out?.repairs).toContain("coerceScalar(verified)");
  });

  it("renames alias field names to schema properties", () => {
    const aliased = tryRepairOutput(
      { summary: "s", Paths: ["a"] },
      schema as unknown as Record<string, unknown>,
    );
    expect(aliased?.value).toEqual({ summary: "s", paths: ["a"] });
    expect(aliased?.repairs).toContain("renameAliasedField(Paths→paths)");
  });

  it("strips schema anchor bleed only where a pattern is declared", () => {
    const out = tryRepairOutput(
      { summary: "^kept$", paths: ["a"], slug: "^my-slug$" },
      schema as unknown as Record<string, unknown>,
    );
    expect(out?.value).toEqual({ summary: "^kept$", paths: ["a"], slug: "my-slug" });
    expect(out?.repairs).toEqual(["stripAnchorBleed(slug)"]);
  });

  it("repairs nested objects and returns undefined for unrepairable values", () => {
    const nested = tryRepairOutput(
      { summary: "s", paths: ["a"], extra: "nope" },
      schema as unknown as Record<string, unknown>,
    );
    expect(nested).toBeUndefined();
  });

  it("salvages JSON from prose and code fences", () => {
    expect(salvageJson('Sure! Here is the result:\n```json\n{"ok":true}\n```')).toEqual({
      ok: true,
    });
    expect(salvageJson("no json here")).toBeUndefined();
  });

  it("recovers framed output with a schema violation", () => {
    const out = repairFramedOutput(
      framed({ summary: "s", paths: "a.ts", note: null }),
      schema as unknown as Record<string, unknown>,
      16000,
    );
    expect(out?.value).toEqual({ summary: "s", paths: ["a.ts"] });
    expect(out?.repairs).toEqual(["wrapBareValueAsArray(paths)", "dropNullOptional(note)"]);
  });

  it("salvages unframed output", () => {
    const out = repairFramedOutput(
      'I think the answer is {"summary":"s","paths":["a"]} — hope that helps',
      schema as unknown as Record<string, unknown>,
      16000,
    );
    expect(out?.value).toEqual({ summary: "s", paths: ["a"] });
    expect(out?.repairs).toEqual(["salvageJson"]);
  });
});

async function fixture(handler?: ConstructorParameters<typeof FakeAiRunner>[0]) {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-repair-"));
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

describe("parse-level repair: control-character escaping", () => {
  it("escapes raw control characters inside strings only", () => {
    expect(escapeStringControlChars('{"a":"line1\nline2"}')).toBe('{"a":"line1\\nline2"}');
    expect(escapeStringControlChars('{"a":"x\t\r\u0001y"}')).toBe('{"a":"x\\t\\r\\u0001y"}');
    // Outside strings, whitespace and structure pass through unchanged.
    expect(escapeStringControlChars('{\n  "a": 1\n}')).toBe('{\n  "a": 1\n}');
    // Already-escaped sequences are not double-escaped.
    expect(escapeStringControlChars('{"a":"\\n"}')).toBe('{"a":"\\n"}');
  });

  it("repairs framed output with raw newlines inside code strings", () => {
    // The exact failure observed in production: a large code payload emitted
    // with unescaped newlines inside JSON string values.
    const code = "export function x() {\n  return 1;\n}";
    const broken = `FABRIC_RESULT_BEGIN\n{"summary":"done","paths":["a.ts"],"note":"${code}"}\nFABRIC_RESULT_END`;
    expect(() => JSON.parse('{"note":"' + code + '"}')).toThrow();
    const out = repairFramedOutput(broken, schema as unknown as Record<string, unknown>, 16000);
    expect(out?.value).toEqual({ summary: "done", paths: ["a.ts"], note: code });
    expect(out?.repairs).toEqual(["escapeStringControlChars"]);
  });

  it("still returns undefined for unrecoverable syntax errors", () => {
    // An unescaped quote mid-string cannot be disambiguated deterministically.
    const broken =
      'FABRIC_RESULT_BEGIN\n{"summary":"he said "hi" loudly","paths":["a"]}\nFABRIC_RESULT_END';
    expect(
      repairFramedOutput(broken, schema as unknown as Record<string, unknown>, 16000),
    ).toBeUndefined();
  });
});

describe("ai.run deterministic repair integration", () => {
  it("repairs parse-level control-character errors without an LLM retry", async () => {
    const { root, config, runner } = await fixture(
      () =>
        'FABRIC_RESULT_BEGIN\n{"summary":"first line\nsecond line","paths":["a"]}\nFABRIC_RESULT_END',
    );
    try {
      const { fabric } = createApi(config, runner);
      const result = await fabric.ai.run({
        instruction: "x",
        outputSchema: schema as unknown as Record<string, unknown>,
      });
      expect(result.value).toEqual({ summary: "first line\nsecond line", paths: ["a"] });
      expect(result.repairPath).toBe("deterministic");
      expect(result.repairs).toEqual(["escapeStringControlChars"]);
      expect(runner.calls).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("repairs schema violations without an LLM retry", async () => {
    const { root, config, runner } = await fixture(() => ({
      summary: "s",
      paths: "a.ts",
      note: null,
    }));
    try {
      const { fabric } = createApi(config, runner);
      const result = await fabric.ai.run({
        instruction: "x",
        outputSchema: schema as unknown as Record<string, unknown>,
      });
      expect(result.value).toEqual({ summary: "s", paths: ["a.ts"] });
      expect(result.repaired).toBe(true);
      expect(result.repairPath).toBe("deterministic");
      expect(result.repairs).toEqual(["wrapBareValueAsArray(paths)", "dropNullOptional(note)"]);
      // Exactly one paid call: the deterministic ladder avoided the retry.
      expect(runner.calls).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("repairs even when LLM retries are disabled", async () => {
    const { root, config, runner } = await fixture(
      () => `Here you go: {"summary":"s","paths":["a"]}`,
    );
    try {
      const { fabric } = createApi(config, runner);
      const result = await fabric.ai.run({
        instruction: "x",
        outputSchema: schema as unknown as Record<string, unknown>,
        retryInvalidJson: false,
      });
      expect(result.value).toEqual({ summary: "s", paths: ["a"] });
      expect(result.repairPath).toBe("deterministic");
      expect(runner.calls).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the LLM repair retry for unrepairable output", async () => {
    let call = 0;
    const { root, config, runner } = await fixture(() => {
      call++;
      if (call === 1) return "total garbage with no json";
      return { summary: "fixed", paths: ["a"] };
    });
    try {
      const { fabric } = createApi(config, runner);
      const result = await fabric.ai.run({
        instruction: "x",
        outputSchema: schema as unknown as Record<string, unknown>,
      });
      expect(result.value).toEqual({ summary: "fixed", paths: ["a"] });
      expect(result.repaired).toBe(true);
      expect(result.repairPath).toBe("llm");
      expect(runner.calls).toHaveLength(2);
      expect(runner.calls[1]!.repair).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies the ladder to failed LLM repair output before giving up", async () => {
    let call = 0;
    const { root, config, runner } = await fixture(() => {
      call++;
      if (call === 1) return "garbage";
      return { summary: "fixed", paths: "a.ts" };
    });
    try {
      const { fabric } = createApi(config, runner);
      const result = await fabric.ai.run({
        instruction: "x",
        outputSchema: schema as unknown as Record<string, unknown>,
      });
      expect(result.value).toEqual({ summary: "fixed", paths: ["a.ts"] });
      expect(result.repairPath).toBe("llm");
      expect(result.repairs).toEqual(["wrapBareValueAsArray(paths)"]);
      expect(runner.calls).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still throws when nothing can repair the output", async () => {
    const { root, config, runner } = await fixture(() => "garbage");
    try {
      const { fabric } = createApi(config, runner);
      await expect(
        fabric.ai.run({
          instruction: "x",
          outputSchema: schema as unknown as Record<string, unknown>,
        }),
      ).rejects.toMatchObject({ code: "INVALID_AI_OUTPUT" });
      expect(runner.calls).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves already-valid output untouched", () => {
    expect(
      parseFramed(
        framed({ summary: "s", paths: ["a"] }),
        schema as unknown as Record<string, unknown>,
      ),
    ).toEqual({ summary: "s", paths: ["a"] });
    expect(
      repairFramedOutput(
        framed({ summary: "s", paths: ["a"] }),
        schema as unknown as Record<string, unknown>,
        16000,
      )?.repairs,
    ).toEqual([]);
  });
});
