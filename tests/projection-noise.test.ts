import { describe, expect, it, vi } from "vitest";
import type { FabricExecutionResult } from "../src/execution-service.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode, type FabricTypeError } from "../src/runtime/type-checker.js";

const failure = (typeErrors: FabricTypeError[]): FabricExecutionResult => ({
  success: false, status: "failed", error: "TypeScript validation failed", typeErrors,
  logs: [], audits: [], elapsedMs: 1, effectiveTimeoutMs: 1000,
});
const project = (result: FabricExecutionResult, resultFormat: "auto" | "json" = "auto") => {
  const writeArtifact = vi.fn((_content: string) => "ka_" + "a".repeat(48));
  return { ...projectFabricExecutionText({ result, resultFormat, maxOutputChars: 50_000, writeArtifact }), writeArtifact };
};
const withoutHint = ({ hint: _hint, ...diagnostic }: FabricTypeError) => diagnostic;

describe("decision-focused compiler diagnostics", () => {
  it.each(["auto", "json"] as const)("keeps 50 compiler diagnostics inline with one shared repair hint (%s)", format => {
    const code = "const out = {};\n" + Array.from({ length: 50 }, (_, index) => `out["key${index}"] = ${index};`).join("\n") + "\nreturn out;";
    const checked = typeCheckFabricCode(code, fabricGuestDeclarations);
    expect(checked.errors).toHaveLength(50);
    expect(checked.errors.every(error => error.code === 7053 && typeof error.hint === "string")).toBe(true);
    const result = project(failure(checked.errors), format);
    expect(result.isError).toBe(true);
    expect(result.overflowed).toBe(false);
    expect(result.writeArtifact).not.toHaveBeenCalled();
    const visible = JSON.parse(result.text);
    expect(visible.typeErrors.map(withoutHint)).toEqual(checked.errors.map(withoutHint));
    expect(visible.typeErrors.filter((error: FabricTypeError) => error.hint !== undefined)).toEqual([checked.errors[0]]);
    const original = JSON.stringify({ status: "failed", error: "TypeScript validation failed", typeErrors: checked.errors, effectiveTimeoutMs: 1000 }, null, format === "json" ? 2 : undefined);
    expect(result.visibleChars).toBeLessThan(original.length * 0.6);
  });

  it("deduplicates only exact hints, preserving every diagnostic and distinct advice", () => {
    const errors: FabricTypeError[] = [
      { line: 1, column: 2, code: 7053, message: "first", hint: "Use JsonObject" },
      { line: 2, column: 3, code: 2322, message: "second", hint: "Use JsonObject" },
      { line: 3, column: 4, message: "third", hint: "Use JsonObject " },
      { line: 4, column: 5, message: "fourth" },
      { line: 5, column: 6, message: "first", hint: "Check the schema" },
      { line: 6, column: 7, message: "first", hint: "Check the schema" },
    ];
    const visible = JSON.parse(project(failure(errors)).text);
    expect(visible.typeErrors).toEqual([errors[0], withoutHint(errors[1]!), errors[2], errors[3], errors[4], withoutHint(errors[5]!)]);
  });

  it("leaves frozen source diagnostics untouched and scopes hint reuse to one response", () => {
    const errors: FabricTypeError[] = [1, 2].map(line => Object.freeze({ line, column: 1, message: "failure", hint: "repair" }));
    Object.freeze(errors);
    const result = failure(errors);
    for (let index = 0; index < 2; index++) {
      const visible = JSON.parse(project(result).text);
      expect(visible.typeErrors[0].hint).toBe("repair");
      expect(visible.typeErrors[1].hint).toBeUndefined();
    }
    expect(errors.every(error => error.hint === "repair")).toBe(true);
  });

  it("does not rewrite user-returned values, even if they resemble diagnostics", () => {
    const value = { typeErrors: [{ hint: "same" }, { hint: "same" }] };
    const result = project({ ...failure([]), success: true, status: "succeeded", value });
    expect(JSON.parse(result.text)).toEqual(value);
    expect(result.isError).toBe(false);
  });

  it("preserves failure details, guest logs, partial effects and checkpoint recovery", () => {
    const id = "ka_" + "b".repeat(48);
    const result = project({
      ...failure([{ line: 1, column: 1, message: "problem", hint: "repair" }, { line: 2, column: 2, message: "another", hint: "repair" }]),
      status: "timed_out", error: "execution timed out", logs: ["required diagnostic"],
      failure: { code: "timeout", phase: "execution", dispatchState: "dispatched", effectOutcome: "uncertain" },
      checkpoints: [{ id, label: "private label" }],
      audits: [{ ref: "local.shell", nestedToolCallId: "private id", startedAt: 1, endedAt: 2, success: false, effectOutcome: "uncertain" }],
    });
    for (const required of ["execution timed out", "required diagnostic", "local.shell", "effects are uncertain", "Inspect current state before retrying", id, "(effect uncertain)"]) expect(result.text).toContain(required);
    expect(result.text).not.toContain("private label"); expect(result.text).not.toContain("private id");
    expect(result.isError).toBe(true);
  });

  it("still retains genuinely oversized distinct diagnostics and fails visibly if retention fails", () => {
    const typeErrors = Array.from({ length: 50 }, (_, index) => ({ line: index + 1, column: 1, message: `problem ${index}`, hint: `${index}:` + "x".repeat(1000) }));
    const result = project(failure(typeErrors));
    expect(result.overflowed).toBe(true); expect(result.artifactRetained).toBe(true);
    expect(JSON.parse(result.writeArtifact.mock.calls[0]![0]!).typeErrors).toEqual(typeErrors);
    const unavailable = projectFabricExecutionText({ result: failure(typeErrors), resultFormat: "auto", maxOutputChars: 1000, writeArtifact() { throw new Error("quota"); } });
    expect(unavailable.isError).toBe(true); expect(unavailable.retention).toBe("unavailable");
    expect(unavailable.text).toContain("could not be retained");
    expect(unavailable.visibleChars).toBeLessThanOrEqual(1000);
  });
});
