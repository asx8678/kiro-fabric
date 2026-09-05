import { describe, expect, it } from "vitest";
import { fabricInfoActions } from "../src/kiro/info-catalog.js";

const action = (ref: string) => ({ ref, risk: "read" as const, descriptorDigest: "a".repeat(64) });
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");
const limit = 20_000;

describe("fabric_info action catalog", () => {
  it("preserves complete small catalogs and empty catalogs", () => {
    expect(fabricInfoActions([])).toEqual([]);
    const actions = [action("state.get"), action("state.list")];
    expect(fabricInfoActions(actions)).toEqual(actions);
  });

  it("drops digests before truncating references", () => {
    const actions = Array.from({ length: 180 }, (_, i) => action(`catalog.action${i}`));
    expect(bytes(actions)).toBeGreaterThan(limit);
    const result = fabricInfoActions(actions);
    expect(result).toEqual(actions.map(({ ref, risk }) => ({ ref, risk })));
    expect(bytes(result)).toBeLessThanOrEqual(limit);
  });

  it("measures both object representations in UTF-8 bytes, not code units", () => {
    const actions = Array.from({ length: 50 }, (_, i) => action(`catalog.${"漢".repeat(100)}${i}`));
    expect(JSON.stringify(actions).length).toBeLessThan(limit);
    expect(bytes(actions)).toBeGreaterThan(limit);
    const refsAndRisk = actions.map(({ ref, risk }) => ({ ref, risk }));
    expect(bytes(refsAndRisk)).toBeLessThan(limit);
    expect(fabricInfoActions(actions)).toEqual(refsAndRisk);
  });

  it("keeps the largest fitting reference prefix, accounting for escaping and multibyte text", () => {
    const actions = Array.from({ length: 100 }, (_, i) => action(`catalog.${"漢\\\"".repeat(100)}${i}`));
    const result = fabricInfoActions(actions);
    const refs = actions.map(({ ref }) => ref);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(refs.length);
    expect(result).toEqual(refs.slice(0, result.length));
    expect(bytes(result)).toBeLessThanOrEqual(limit);
    expect(bytes(refs.slice(0, result.length + 1))).toBeGreaterThan(limit);
  });

  it("accepts an exact-boundary reference and excludes an oversized first reference", () => {
    const exact = "r".repeat(limit - 4); // ["..."]
    expect(fabricInfoActions([action(exact)])).toEqual([exact]);
    expect(bytes([exact])).toBe(limit);
    expect(fabricInfoActions([action(exact + "r")])).toEqual([]);
  });
});
