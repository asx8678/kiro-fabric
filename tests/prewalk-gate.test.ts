import { describe, expect, it } from "vitest";
import { evaluateFabricPrewalkGate } from "../src/prewalk/gate.js";

describe("selective prewalk gate", () => {
  it("keeps always and disabled modes unconditional", () => {
    expect(evaluateFabricPrewalkGate("always").eligible).toBe(true);
    expect(evaluateFabricPrewalkGate("always").reason).toBe("activation-always");
    expect(evaluateFabricPrewalkGate("disabled", "Implement API tests and docs")).toMatchObject({
      eligible: false,
      reason: "activation-disabled",
    });
  });

  it("fails closed without explicit mutation intent or sufficient complexity", () => {
    expect(evaluateFabricPrewalkGate("gated")).toMatchObject({
      eligible: false,
      reason: "task-unavailable",
    });
    expect(evaluateFabricPrewalkGate("gated", "Explain the configuration API and tests")).toMatchObject({
      eligible: false,
      reason: "no-mutation-intent",
    });
    expect(evaluateFabricPrewalkGate("gated", "Fix the parser bug")).toMatchObject({
      eligible: false,
      reason: "insufficient-complexity",
    });
    expect(evaluateFabricPrewalkGate("gated", "Fix only a typo in README.md")).toMatchObject({
      eligible: false,
      reason: "explicitly-narrow",
    });
  });

  it("selects broad, multi-concern, or explicitly multi-file changes deterministically", () => {
    const task = "Implement selective prewalk configuration and API wiring, telemetry benchmarks, tests and docs.";
    const first = evaluateFabricPrewalkGate("gated", task);
    expect(first).toMatchObject({ eligible: true, reason: "multiple-concerns" });
    expect(evaluateFabricPrewalkGate("gated", task)).toEqual(first);

    expect(evaluateFabricPrewalkGate("gated", "Refactor authentication across the repository")).toMatchObject({
      eligible: true,
      reason: "broad-change",
    });
    expect(evaluateFabricPrewalkGate("gated", "Update src/a.ts and tests/a.test.ts")).toMatchObject({
      eligible: true,
      reason: "multiple-files",
    });
  });

  it("records only bounded metadata, never task text", () => {
    const task = "Implement API configuration, benchmark telemetry, tests and docs. " + "x".repeat(500);
    const decision = evaluateFabricPrewalkGate("gated", task);
    expect(decision.taskChars).toBe(task.length);
    expect(JSON.stringify(decision)).not.toContain(task);
    expect(decision.signals).toEqual([...decision.signals].sort());
  });
});
