import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.js";

describe("parseArgs --format", () => {
  it.each(["json", "text"] as const)("accepts %s", (format) => {
    expect(parseArgs(["check", "--format", format]).format).toBe(format);
  });

  it("rejects unsupported formats", () => {
    expect(() => parseArgs(["check", "--format", "yaml"])).toThrow(/expected json or text/);
  });

  it("rejects a missing format value", () => {
    expect(() => parseArgs(["check", "--format"])).toThrow(/requires a value/);
    expect(() => parseArgs(["check", "--format", "--compact"])).toThrow(/requires a value/);
  });
});