import { describe, expect, it } from "vitest";
import {
  MAX_FABRIC_STRING_KEY_BYTES,
  MAX_FABRIC_STRING_KEYS,
  fabricStringsLimitError,
} from "../src/runtime/source-limit.js";

describe("fabricStringsLimitError", () => {
  it("allows missing strings", () => {
    expect(fabricStringsLimitError(undefined, 32)).toBeUndefined();
  });

  it("rejects more than MAX_FABRIC_STRING_KEYS", () => {
    const strings = Object.fromEntries(
      Array.from({ length: MAX_FABRIC_STRING_KEYS + 1 }, (_, index) => [`k${index}`, "v"]),
    );
    expect(fabricStringsLimitError(strings, 256 * 1024)).toMatch(/key count/);
  });

  it("rejects oversized keys", () => {
    expect(fabricStringsLimitError({ ["k".repeat(MAX_FABRIC_STRING_KEY_BYTES + 1)]: "v" }, 1024))
      .toMatch(/key exceeds/);
  });

  it("rejects a value larger than maxSourceBytes", () => {
    expect(fabricStringsLimitError({ payload: "é".repeat(17) }, 33))
      .toMatch(/value exceeds executor\.maxSourceBytes/);
  });

  it("rejects aggregate UTF-8 that exceeds maxSourceBytes", () => {
    expect(fabricStringsLimitError({ a: "aaaa", b: "bbbb" }, 6))
      .toMatch(/strings exceed executor\.maxSourceBytes/);
  });
});
