import { describe, expect, it } from "vitest";
import { routeTask, roleHints, ROLE_PROFILES, cheapFirstPlan, routeAndPlan } from "../src/core/task-router.js";

describe("task-router", () => {
  it("routes a broad uncertain audit to fabric", () => {
    const result = routeTask({
      likelyFiles: 200,
      independentDomains: 4,
      answerBounded: false,
      requiresModification: false,
      safelyParallelizable: true,
      expectedCommandCost: 0.8,
      expectedContextSize: 0.9,
    });
    expect(result.kind).toBe("fabric");
    expect(result.score).toBeGreaterThan(0.6);
  });

  it("bypasses Fabric for a narrow bounded verification (the benchmark failure case)", () => {
    const result = routeTask({
      likelyFiles: 3,
      independentDomains: 1,
      answerBounded: true,
      requiresModification: false,
      safelyParallelizable: false,
      expectedCommandCost: 0.2,
      expectedContextSize: 0.2,
    });
    expect(result.kind).toBe("single");
    expect(result.reasons.join(" ")).toMatch(/bounded/i);
  });

  it("forces the single-writer workflow when the task modifies production code", () => {
    const result = routeTask({
      likelyFiles: 5,
      independentDomains: 1,
      answerBounded: true,
      requiresModification: true,
      safelyParallelizable: false,
      expectedCommandCost: 0.4,
      expectedContextSize: 0.5,
    });
    expect(result.kind).toBe("writer_plus_review");
    expect(result.reasons.join(" ")).toMatch(/single-writer/i);
  });

  it("routes a one-function explanation to a single agent", () => {
    const result = routeTask({
      likelyFiles: 1,
      independentDomains: 1,
      answerBounded: true,
      requiresModification: false,
      safelyParallelizable: false,
      expectedCommandCost: 0.0,
      expectedContextSize: 0.1,
    });
    expect(result.kind).toBe("single");
  });

  it("assigns model/effort per role (ref: mapper cheap, fixer reasoner)", () => {
    expect(ROLE_PROFILES.mapper.effort).toBe("low");
    expect(ROLE_PROFILES.fixer.modelTier).toBe("reasoner");
    expect(roleHints("mapper").thinking).toBe("minimal");
    expect(roleHints("fixer").thinking).toBe("high");
    expect(roleHints("security").effort).toBe("medium");
  });
});
describe("cheap-first plan (V5)", () => {
  it("keeps model review and billable eval last for bounded tasks", () => {
    const plan = cheapFirstPlan({
      likelyFiles: 2, independentDomains: 1, answerBounded: true,
      requiresModification: false, safelyParallelizable: true,
      expectedCommandCost: 0.1, expectedContextSize: 0.3,
    });
    expect(plan.version).toBe(5);
    const kinds = plan.stages.map((s) => s.kind);
    // bounded non-mutating tasks drop model review + billable eval entirely
    expect(kinds).not.toContain("model_review");
    expect(kinds).not.toContain("real_model_eval");
    expect(kinds).toContain("focused_test");
  });

  it("starts with a ci-safe static_check and routes in parallel", () => {
    const { result, plan } = routeAndPlan({
      likelyFiles: 100, independentDomains: 3, answerBounded: false,
      requiresModification: true, safelyParallelizable: true,
      expectedCommandCost: 0.9, expectedContextSize: 0.8,
    });
    expect(plan.stages[0]?.kind).toBe("static_check");
    expect(plan.stages[0]?.ciSafe).toBe(true);
    expect(result.kind).toBe("writer_plus_review");
  });
});
