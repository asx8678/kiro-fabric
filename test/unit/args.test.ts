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

describe("parseArgs --permissions", () => {
  it("defaults to headless", () => {
    expect(parseArgs(["run"]).permissions).toBe("headless");
  });

  it.each(["headless", "interactive"] as const)("accepts %s for run and exec", (mode) => {
    expect(parseArgs(["run", "--permissions", mode]).permissions).toBe(mode);
    expect(parseArgs(["exec", "--permissions", mode]).permissions).toBe(mode);
  });

  it("rejects unsupported permission modes", () => {
    expect(() => parseArgs(["run", "--permissions", "auto"])).toThrow(/expected headless or interactive/);
    expect(() => parseArgs(["run", "--permissions"])).toThrow(/requires a value/);
  });

  it("rejects --permissions for commands without an approval surface", () => {
    for (const command of ["check", "docs", "models", "doctor", "install-kiro"]) {
      expect(() => parseArgs([command, "--permissions", "interactive"])).toThrow(/only supported for run and exec/);
    }
  });
});