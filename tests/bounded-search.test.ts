import { describe, expect, it, vi } from "vitest";
import { largestFittingInteger } from "../src/bounded-search.js";

describe("largest fitting integer", () => {
  it("matches every threshold in bounded zero and nonzero-offset ranges", () => {
    for (const lower of [0, 17, 1000]) {
      for (let width = 0; width <= 64; width++) {
        const upper = lower + width;
        for (let threshold = lower - 1; threshold <= upper + 1; threshold++) {
          const visited: number[] = [];
          const result = largestFittingInteger(lower, upper, value => {
            visited.push(value);
            return value <= threshold;
          });
          expect(result).toBe(Math.max(lower, Math.min(upper, threshold)));
          expect(visited.every(value => Number.isInteger(value) && value > lower && value <= upper)).toBe(true);
          expect(visited.length).toBeLessThanOrEqual(Math.ceil(Math.log2(width + 1)));
        }
      }
    }
  });

  it("returns the lower sentinel without testing empty ranges", () => {
    const fits = vi.fn(() => false);
    expect(largestFittingInteger(12, 12, fits)).toBe(12);
    expect(largestFittingInteger(12, 11, fits)).toBe(12);
    expect(fits).not.toHaveBeenCalled();
  });

  it("propagates predicate failures unchanged", () => {
    const failure = new Error("page construction failed");
    expect(() => largestFittingInteger(0, 10, () => { throw failure; })).toThrow(failure);
  });
});
