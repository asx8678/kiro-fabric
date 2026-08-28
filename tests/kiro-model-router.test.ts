import { describe, expect, it } from "vitest";
import {
  resolveKiroTaskModel,
  resolveKiroTaskRoute,
} from "../src/kiro/model-router.js";

describe("Kiro task model routing", () => {
  it.each([
    ["List the files in this directory", "claude-haiku-4.5"],
    ["Summarize the README in one sentence", "claude-haiku-4.5"],
    ["Fix one typo in README.md", "claude-haiku-4.5"],
    ["Implement a TypeScript parser and add unit tests", "qwen3-coder-next"],
    ["Fix the authentication bug in src/auth.ts", "qwen3-coder-next"],
    [
      "Design a secure service architecture and compare the operational trade-offs",
      "claude-opus-4.5",
    ],
    ["Audit the authentication flow for security vulnerabilities", "claude-opus-4.5"],
  ])("routes %j to %s", (task, expected) => {
    expect(resolveKiroTaskModel(task)).toBe(expected);
  });

  it("sets medium effort for complex analysis, including analysis of source files", () => {
    expect(resolveKiroTaskRoute(
      "Audit src/auth.ts for security vulnerabilities and explain the trade-offs",
    )).toEqual({ model: "claude-opus-4.5", thinking: "medium" });
  });

  it("routes an ambiguous medium-sized task to Opus at medium effort", () => {
    const task =
      "Evaluate the available alternatives and provide a balanced recommendation based on the supplied context. ".repeat(7);
    expect(resolveKiroTaskRoute(task)).toEqual({
      model: "claude-opus-4.5",
      thinking: "medium",
    });
  });

  it("routes long or multi-step reasoning to Opus at medium effort", () => {
    const expected = { model: "claude-opus-4.5", thinking: "medium" };
    expect(resolveKiroTaskRoute("Consider the supplied material carefully. ".repeat(40)))
      .toEqual(expected);
    expect(resolveKiroTaskRoute(
      "Do the following:\n1. Gather facts\n2. Compare options\n3. Explain the result",
    )).toEqual(expected);
  });

  it("keeps critical mixed implementation on the capable model", () => {
    expect(resolveKiroTaskRoute(
      "Implement a secure distributed architecture, fix the race condition, and add tests",
    )).toEqual({ model: "claude-opus-4.5", thinking: "medium" });
  });

  it("routes plain source-file reviews to analysis, not the coding model", () => {
    expect(resolveKiroTaskRoute(
      "Review src/auth.ts for correctness and missing edge cases",
    )).toEqual({ model: "claude-opus-4.5", thinking: "medium" });
  });

  it("does not treat short length as simplicity for reasoning-dense tasks", () => {
    expect(resolveKiroTaskRoute(
      "Determine whether this lock-free algorithm is linearizable and justify every invariant",
    )).toEqual({ model: "claude-opus-4.5", thinking: "medium" });
  });

  it("pins low effort for cheap and coding routes instead of inheriting medium", () => {
    expect(resolveKiroTaskRoute("Fix one typo in README.md")).toEqual({
      model: "claude-haiku-4.5",
      thinking: "low",
    });
    expect(resolveKiroTaskRoute("Implement a parser and add unit tests")).toEqual({
      model: "qwen3-coder-next",
      thinking: "low",
    });
    expect(resolveKiroTaskRoute("List the files in this directory")).toEqual({
      model: "claude-haiku-4.5",
      thinking: "low",
    });
  });

  it("leaves an empty task unselected", () => {
    expect(resolveKiroTaskRoute("  \n\t ")).toEqual({});
  });
});
