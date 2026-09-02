import { describe, expect, it } from "vitest";
import {
  assertRealClientEvidence,
  REAL_CLIENT_SESSION_COMMAND,
  REAL_CLIENT_TOOLS,
} from "../scripts/real-client-evidence.mjs";

const digest = "a".repeat(64);
const valid = {
  kind: "kiro-fabric.real-client-qualification",
  schemaVersion: 1,
  ok: true,
  packageDigest: digest,
  sessionCommand: REAL_CLIENT_SESSION_COMMAND,
  powerActivated: true,
  tools: REAL_CLIENT_TOOLS,
  customAgentSelected: false,
};

describe("real-client release evidence", () => {
  it("accepts only exact digest-bound Power qualification evidence", () => {
    expect(assertRealClientEvidence(valid, digest, { qualification: true })).toBe(valid);
    for (const patch of [
      { packageDigest: "b".repeat(64) },
      { sessionCommand: ["kiro-cli"] },
      { powerActivated: false },
      { tools: ["fabric_exec"] },
      { customAgentSelected: true },
      { kind: "other" },
      { schemaVersion: 2 },
      { ok: false },
    ]) {
      expect(() => assertRealClientEvidence(
        { ...valid, ...patch },
        digest,
        { qualification: true },
      )).toThrow();
    }
  });

  it("accepts raw driver evidence without pretending it is qualification", () => {
    const { kind: _kind, schemaVersion: _schemaVersion, ok: _ok, ...driver } = valid;
    expect(assertRealClientEvidence(driver, digest)).toBe(driver);
    expect(() => assertRealClientEvidence(driver, digest, { qualification: true })).toThrow(
      "qualification identity",
    );
  });
});
