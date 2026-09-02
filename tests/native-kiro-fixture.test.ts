import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NATIVE_KIRO_FIXTURE_TESTS,
  assertNativeKiroFixtureToolchain,
} from "./helpers/native-kiro-fixture.js";

const previousGoBinary = process.env.KIRO_FABRIC_GO_BINARY;
afterEach(() => {
  if (previousGoBinary === undefined) delete process.env.KIRO_FABRIC_GO_BINARY;
  else process.env.KIRO_FABRIC_GO_BINARY = previousGoBinary;
});

describe("native Kiro fixture toolchain", () => {
  it("names every affected test in the missing-Go preflight", () => {
    process.env.KIRO_FABRIC_GO_BINARY = path.join(
      process.cwd(),
      "definitely-missing-go-for-kiro-fixture",
    );
    let message = "";
    try {
      assertNativeKiroFixtureToolchain();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Go 1.22 or newer");
    for (const test of NATIVE_KIRO_FIXTURE_TESTS) expect(message).toContain(test);
  });
});
