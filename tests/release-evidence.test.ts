import { describe, expect, it } from "vitest";
import {
  assertRealClientEvidence,
  REAL_CLIENT_NATIVE_CAPABILITIES,
  REAL_CLIENT_SESSION_COMMAND,
  REAL_CLIENT_TOOLS,
  transcriptEntry,
} from "../scripts/real-client-evidence.mjs";

const digest = "a".repeat(64);
const archiveDigest = "b".repeat(64);
const commit = "c".repeat(40);
const valid = {
  kind: "kiro-fabric.real-client-qualification",
  schemaVersion: 3,
  ok: true,
  packageDigest: digest,
  archiveDigest,
  commit,
  sessionCommand: REAL_CLIENT_SESSION_COMMAND,
  powerActivated: true,
  tools: REAL_CLIENT_TOOLS,
  customAgentSelected: false,
  driver: { digest: "d".repeat(64), version: "repository-driver-v1" },
  kiro: { path: "/usr/bin/kiro-cli", digest: "e".repeat(64), version: "1.0.0" },
  nativeCapabilities: REAL_CLIENT_NATIVE_CAPABILITIES.map((name) => ({ name, observed: true })),
  transcript: ["kiro-version", "power-activation", "mcp-tools-list", "native-capability-probes"].map((kind, index) => transcriptEntry(kind, `raw-${index}`)),
};

describe("real-client release evidence", () => {
  it("accepts only exact package/archive/commit-bound qualification evidence", () => {
    expect(assertRealClientEvidence(valid, digest, { qualification: true, archiveDigest, commit })).toBe(valid);
    for (const patch of [
      { packageDigest: "b".repeat(64) }, { archiveDigest: "c".repeat(64) }, { commit: "d".repeat(40) },
      { sessionCommand: ["kiro-cli"] }, { powerActivated: false }, { tools: ["fabric_exec"] },
      { customAgentSelected: true }, { kind: "other" }, { schemaVersion: 2 }, { ok: false },
    ]) expect(() => assertRealClientEvidence({ ...valid, ...patch }, digest, { qualification: true, archiveDigest, commit })).toThrow();
  });

  it("recomputes transcript byte counts and hashes", () => {
    const altered = structuredClone(valid);
    altered.transcript[0]!.raw = Buffer.from("forged").toString("base64");
    expect(() => assertRealClientEvidence(altered, digest, { qualification: true, archiveDigest, commit })).toThrow("transcript digest");
  });

  it("requires authoritative expected archive and commit identities", () => {
    expect(() => assertRealClientEvidence(valid, digest, { qualification: true, archiveDigest })).toThrow("exact commit");
    expect(() => assertRealClientEvidence(valid, digest, { qualification: true, commit })).toThrow("exact release archive");
  });
});
