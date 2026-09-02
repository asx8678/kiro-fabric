import { describe, expect, it } from "vitest";
import {
  DEFAULT_FABRIC_JSON_CHARS,
  assertFabricJsonBudget,
  fabricJsonText,
} from "../src/runtime/json-budget.js";

describe("Fabric host JSON budget", () => {
  it("serializes JSON-compatible values within the budget", () => {
    expect(fabricJsonText({ a: 1 })).toBe("{\"a\":1}");
    expect(() => assertFabricJsonBudget("ok")).not.toThrow();
  });

  it("rejects oversized strings before guest injection", () => {
    expect(() => assertFabricJsonBudget("x".repeat(DEFAULT_FABRIC_JSON_CHARS + 1)))
      .toThrow(/Fabric host JSON exceeds/);
  });

  it("rejects oversized objects on the host bridge", () => {
    expect(() => fabricJsonText({ payload: "x".repeat(DEFAULT_FABRIC_JSON_CHARS) }))
      .toThrow(/Fabric host JSON exceeds/);
  });
});
