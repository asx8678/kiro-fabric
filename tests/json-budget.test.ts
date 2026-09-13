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

describe("bounded host JSON boundary properties", () => {
  const seeded = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };
  const makeValue = (next: () => number, depth: number): unknown => {
    if (depth <= 0 || next() < 0.3) {
      const choice = next();
      if (choice < 0.25) return null;
      if (choice < 0.5) return next() < 0.5;
      if (choice < 0.75) return Math.floor(next() * 1e6);
      return Array.from({ length: Math.floor(next() * 8) }, () => "abcdefghij0123456789"[Math.floor(next() * 20)]).join("");
    }
    if (next() < 0.5) return Array.from({ length: Math.floor(next() * 5) }, () => makeValue(next, depth - 1));
    return Object.fromEntries(
      Array.from({ length: Math.floor(next() * 5) }, () => [`key${Math.floor(next() * 1e6)}`, makeValue(next, depth - 1)]),
    );
  };

  it("round-trips deterministic random plain structures", () => {
    const next = seeded(0x5eed);
    for (let index = 0; index < 200; index++) {
      const value = makeValue(next, 5);
      expect(JSON.parse(fabricJsonText(value, 1_000_000))).toEqual(value);
    }
  });

  it("enforces the exact character boundary for random strings", () => {
    const next = seeded(0xbeef);
    for (let index = 0; index < 100; index++) {
      const text = Array.from({ length: Math.floor(next() * 64) + 1 }, () => "abcdefghij0123456789"[Math.floor(next() * 20)]).join("");
      expect(JSON.parse(fabricJsonText(text, text.length + 2))).toBe(text);
      expect(() => fabricJsonText(text, text.length + 1)).toThrow("serialized characters");
    }
  });

  it("rejects random graphs exactly past the depth bound", () => {
    const next = seeded(0xd00d);
    for (let index = 0; index < 50; index++) {
      const depth = 60 + Math.floor(next() * 10);
      let value: unknown = null;
      for (let level = 0; level < depth; level++) value = [value];
      if (depth > 64) expect(() => assertFabricJsonBudget(value, 1_000_000)).toThrow("depth limit");
      else expect(() => assertFabricJsonBudget(value, 1_000_000)).not.toThrow();
    }
  });

  it("rejects own array properties that are not real array indices", () => {
    // 2^32-1 is digit-only but is NOT an array index. It previously passed the
    // index check, escaped value validation, and let a self-referential property
    // reach unbounded catalog accounting.
    const hostile: unknown[] = [];
    Object.defineProperty(hostile, "4294967295", { value: hostile, enumerable: true, configurable: true, writable: true });
    expect(() => fabricJsonText(hostile, 1_000)).toThrow("non-index array property");
    for (const key of ["4294967295", "4294967296", "99999999999999999999", "00", "01", "-1", "1.0", " 1"]) {
      const value: unknown[] = [];
      Object.defineProperty(value, key, { value: 1, enumerable: true, configurable: true, writable: true });
      expect(() => fabricJsonText(value, 1_000)).toThrow("non-index array property");
    }
    // Ordinary contiguous arrays remain accepted.
    expect(fabricJsonText([1, 2, 3], 100)).toBe("[1,2,3]");
  });
});
