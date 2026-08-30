import { afterEach, describe, expect, it } from "vitest";
import { inheritedCapabilityCommitment } from "../src/fabric-runtime-state.js";

const REQUIREMENTS = "KIRO_FABRIC_CAPABILITY_REQUIREMENTS";
const DIGEST = "KIRO_FABRIC_CAPABILITY_DIGEST";
const originalRequirements = process.env[REQUIREMENTS];
const originalDigest = process.env[DIGEST];

const restore = (key: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

afterEach(() => {
  restore(REQUIREMENTS, originalRequirements);
  restore(DIGEST, originalDigest);
});

describe.sequential("inherited child capability commitments", () => {
  it("preserves the unrestricted default only when both commitment fields are absent", () => {
    delete process.env[REQUIREMENTS];
    delete process.env[DIGEST];
    expect(inheritedCapabilityCommitment()).toBeUndefined();
  });

  it("accepts an explicitly empty attenuated view with a canonical digest", () => {
    process.env[REQUIREMENTS] = "[]";
    process.env[DIGEST] = "a".repeat(64);
    expect(inheritedCapabilityCommitment()).toEqual({
      requirements: [],
      digest: "a".repeat(64),
    });
  });

  it("fails closed for missing, malformed, or non-canonical commitments", () => {
    process.env[REQUIREMENTS] = JSON.stringify(["memory.get"]);
    delete process.env[DIGEST];
    expect(() => inheritedCapabilityCommitment()).toThrow(
      "requires requirements and a canonical digest",
    );

    delete process.env[REQUIREMENTS];
    process.env[DIGEST] = "b".repeat(64);
    expect(() => inheritedCapabilityCommitment()).toThrow(
      "requires requirements and a canonical digest",
    );

    process.env[REQUIREMENTS] = JSON.stringify(["memory.get"]);
    process.env[DIGEST] = "not-canonical";
    expect(() => inheritedCapabilityCommitment()).toThrow(
      "requires requirements and a canonical digest",
    );
  });
});
