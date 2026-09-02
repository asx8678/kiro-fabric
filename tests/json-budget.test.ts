import { describe, expect, it } from "vitest";
import {
  assertFabricJsonBudget,
  fabricJsonText,
} from "../src/runtime/json-budget.js";

describe("bounded host JSON", () => {
  it("accepts plain finite JSON and checks exact escaped length", () => {
    expect(fabricJsonText({ ok: true, values: [1, null, "x"] }, 100)).toBe(
      '{"ok":true,"values":[1,null,"x"]}',
    );
    expect(() => fabricJsonText("\n", 3)).toThrow("serialized characters");
    expect(fabricJsonText(undefined, 10)).toBe("null");
  });

  it("rejects ambiguous, executable, cyclic, and non-finite values", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const shared = {};
    const accessor = Object.defineProperty({}, "secret", { enumerable: true, get: () => "value" });
    for (const value of [
      cycle,
      [shared, shared],
      accessor,
      { value: Number.NaN },
      { value: 1n },
      { value: undefined },
      { value: () => true },
      new Date(),
    ]) {
      expect(() => assertFabricJsonBudget(value, 10_000)).toThrow("bounded JSON contract");
    }
  });

  it("rejects proxies without executing their traps", () => {
    let trapped = false;
    const proxy = new Proxy({}, {
      getPrototypeOf() { trapped = true; return Object.prototype; },
      ownKeys() { trapped = true; return []; },
    });
    expect(() => assertFabricJsonBudget(proxy, 10_000)).toThrow("proxy object");
    expect(trapped).toBe(false);
  });

  it("rejects excessive depth and node counts before serialization", () => {
    let deep: unknown = null;
    for (let index = 0; index < 65; index++) deep = [deep];
    expect(() => assertFabricJsonBudget(deep, 10_000)).toThrow("depth limit");
    expect(() => assertFabricJsonBudget(new Array(100_001).fill(null), 8_000_000)).toThrow("node limit");
  });
});
