import { describe, expect, it } from "vitest";
import {
  formatCallEvent,
  formatRunStart,
  formatValue,
  parseDisplayMeta,
  renderCheckText,
  renderDiagnostics,
  renderProgram,
  renderRunText,
} from "../../src/cli/render.js";
import type { RunEnvelope } from "../../src/runtime/executor.js";

describe("text renderer", () => {
  it("parses display pragmas from leading comments", () => {
    expect(parseDisplayMeta("// @name: Demo\n// @description: A test\nreturn 1;")).toEqual({
      name: "Demo",
      description: "A test",
    });
    expect(parseDisplayMeta("return 1;\n// @name: ignored")).toEqual({});
  });

  it("formats nested values, arrays, multiline strings, and truncation", () => {
    const formatted = formatValue({
      user: { name: "Ada" },
      items: ["one", { ok: true }],
      note: "a\nb",
    });
    expect(formatted).toContain("user:\n  name: Ada");
    expect(formatted).toContain("items:\n  - one\n  -\n    ok: true");
    expect(formatted).toContain("note: |\n  a\n  b");
    expect(formatValue("x".repeat(21_000))).toContain("output truncated");
  });

  it("aligns diagnostic carets with the numbered source gutter", () => {
    const rendered = renderDiagnostics(
      [{ code: 9002, category: "error", message: "bad token", line: 1, column: 7 }],
      "return nope;",
    );
    expect(rendered).toContain("error TS9002: bad token");
    expect(rendered).toContain("  1 │ return nope;");
    expect(rendered).toContain("    │       ^");
  });

  it("renders run headers, results, and failures", () => {
    const body = "// @name: Demo\nreturn { ok: true };";
    const success = {
      version: 1,
      runId: "run_abc123",
      status: "succeeded",
      value: { ok: true },
      metrics: { elapsedMs: 1_200, aiCalls: 3 },
    } as RunEnvelope;
    expect(renderRunText({ body, envelope: success }, { color: false })).toContain(
      "▸ fabric-lite run_abc123 · Demo · TypeScript · 2 lines · 1.2s · 3 AI calls",
    );
    expect(renderRunText({ body, envelope: success }, { color: false })).toContain("─ result");

    const failure = {
      version: 1,
      runId: "run_bad",
      status: "failed",
      error: {
        code: "TYPECHECK_FAILED",
        message: "bad program",
        diagnostics: [{ line: 2, column: 1, message: "bad" }],
      },
    } as RunEnvelope;
    expect(renderRunText({ body, envelope: failure }, { color: false })).toContain(
      "✗ TYPECHECK_FAILED: bad program",
    );
    expect(renderRunText({ body, envelope: failure }, { color: false })).toContain("error: bad");
  });

  it("renders check status and warning carets", () => {
    expect(
      renderCheckText(
        {
          ok: true,
          diagnostics: [{ code: 1, category: "warning", message: "style", line: 1, column: 1 }],
        },
        "return 1;",
        { color: false },
      ),
    ).toContain("✓ program valid · 1 lines");
    expect(
      renderCheckText(
        {
          ok: true,
          diagnostics: [{ code: 1, category: "warning", message: "style", line: 1, column: 1 }],
        },
        "return 1;",
        { color: false },
      ),
    ).toContain("warning TS1: style");
    expect(
      renderCheckText(
        {
          ok: false,
          diagnostics: [{ code: 1, category: "error", message: "bad", line: 1, column: 1 }],
        },
        "return 1;",
        { color: false },
      ),
    ).toContain("✗ type check failed");
  });

  it("formats successful, failed, and repair call events", () => {
    expect(
      formatCallEvent(
        { role: "worker", inputChars: 1_200, outputChars: 340, elapsedMs: 1_200, exitCode: 0 },
        { color: false },
      ),
    ).toBe("› worker · 1200 in · 340 out · 1.2s");
    expect(
      formatCallEvent(
        { role: "worker", inputChars: 1, outputChars: 2, elapsedMs: 10, exitCode: 1, repair: true },
        { color: false },
      ),
    ).toBe("✗ worker · 1 in · 2 out · 10ms · repair");
    expect(
      formatCallEvent(
        { role: "worker", inputChars: 1, outputChars: 2, elapsedMs: 10, exitCode: 0, repair: true },
        { color: false },
      ),
    ).toBe("↻ worker · 1 in · 2 out · 10ms · repair");
  });

  it("uses a gold accent for brand, rules, gutters, and retry markers", () => {
    const body = "// @name: Demo\nreturn { ok: true };";
    const envelope = {
      version: 1,
      runId: "run_gold",
      status: "succeeded",
      value: { ok: true },
      metrics: { elapsedMs: 5, aiCalls: 2, retries: 2 },
    } as RunEnvelope;
    const rendered = renderRunText({ body, envelope }, { color: true });
    expect(rendered).toContain("[38;5;220m");
    expect(rendered).toContain("─ program");
    expect(rendered).toContain("─ result");
    expect(rendered).toContain("2 retries");
    const plain = renderRunText({ body, envelope }, { color: false });
    expect(plain).not.toContain("[38;5;220m");
    expect(plain).toContain(
      "▸ fabric-lite run_gold · Demo · TypeScript · 2 lines · 5ms · 2 AI calls · 2 retries",
    );
    expect(formatCallEvent({ role: "worker", exitCode: 0 }, { color: true })).toContain(
      "[38;5;220m",
    );
    expect(formatRunStart({ runId: "run_gold", body }, { color: false })).toBe(
      "▸ fabric-lite run_gold Demo · running 2 lines…",
    );
    expect(formatRunStart({ runId: "run_gold", body }, { color: true })).toContain("[38;5;220m");
  });

  it("marks failed runs with a red error rule", () => {
    const failure = {
      version: 1,
      runId: "run_bad",
      status: "failed",
      error: { code: "RUNTIME_FAILED", message: "boom" },
    } as RunEnvelope;
    const rendered = renderRunText({ body: "return 1;", envelope: failure }, { color: true });
    expect(rendered).toContain("─ error");
    expect(rendered).toContain("[31m");
  });

  it("only highlights source when enabled", () => {
    const plain = renderProgram('const value = "ok";', { highlight: false, color: true });
    const highlighted = renderProgram('const value = "ok";', { highlight: true, color: true });
    expect(plain).not.toContain("\u001b[36m");
    expect(highlighted).toContain("\u001b[36m");
  });
});
