import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertRealClientEvidence,
  REAL_CLIENT_NATIVE_CAPABILITIES,
  REAL_CLIENT_SESSION_COMMAND,
  REAL_CLIENT_TOOLS,
  transcriptEntry,
} from "../scripts/real-client-evidence.mjs";
import { runRealKiroAgentDriver } from "../scripts/run-kiro-agent-real-driver.mjs";

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
  powerActivated: false,
  tools: REAL_CLIENT_TOOLS,
  customAgentSelected: true,
  driver: { digest: "d".repeat(64), version: "repository-driver-v1" },
  kiro: { path: "/usr/bin/kiro-cli", digest: "e".repeat(64), version: "1.0.0" },
  nativeCapabilities: REAL_CLIENT_NATIVE_CAPABILITIES.map((name) => ({ name, observed: true })),
  transcript: ["kiro-version", "agent-selection", "mcp-tools-list", "native-capability-probes"].map((kind, index) => transcriptEntry(kind, `raw-${index}`)),
};

describe("real-client release evidence", () => {
  it("accepts only exact package/archive/commit-bound qualification evidence", () => {
    expect(assertRealClientEvidence(valid, digest, { qualification: true, archiveDigest, commit })).toBe(valid);
    for (const patch of [
      { packageDigest: "b".repeat(64) }, { archiveDigest: "c".repeat(64) }, { commit: "d".repeat(40) },
      { sessionCommand: ["kiro-cli"] }, { powerActivated: true }, { tools: ["fabric_exec"] },
      { customAgentSelected: false }, { kind: "other" }, { schemaVersion: 2 }, { ok: false },
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

  it("runs native probes from a private empty qualification workspace", () => {
    if (process.platform === "win32") return;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-real-driver-test-"));
    const workspace = path.join(temporary, "workspace");
    const packageRoot = path.join(temporary, "package");
    const executable = path.join(temporary, "kiro-cli");
    const output = path.join(temporary, "evidence.json");
    const marker = path.join(temporary, "cwd.txt");
    fs.mkdirSync(workspace, { mode: 0o700 });
    fs.mkdirSync(packageRoot, { mode: 0o700 });
    fs.writeFileSync(executable, `#!${process.execPath}
import fs from "node:fs";
if (process.argv.includes("--version")) { console.log("kiro-cli test"); } else {
  const prompt = fs.readFileSync(0, "utf8");
  const nonce = /qualificationNonce=([a-f0-9]+)/u.exec(prompt)?.[1];
  fs.writeFileSync(process.env.KIRO_TEST_CWD_MARKER, process.cwd());
  console.log(JSON.stringify({ qualificationNonce: nonce, powerActivated: false, tools: ${JSON.stringify(REAL_CLIENT_TOOLS)}, customAgentSelected: true, nativeCapabilities: ${JSON.stringify(REAL_CLIENT_NATIVE_CAPABILITIES.map((name) => ({ name, observed: true })))} }));
}
`, { mode: 0o700 });
    const previousPath = process.env.PATH;
    const previousMarker = process.env.KIRO_TEST_CWD_MARKER;
    process.env.PATH = temporary;
    process.env.KIRO_TEST_CWD_MARKER = marker;
    try {
      runRealKiroAgentDriver({ packageRoot, packageDigest: digest, archiveDigest, commit, driverDigest: "d".repeat(64), output, workspace });
      expect(fs.readFileSync(marker, "utf8")).toBe(fs.realpathSync(workspace));
      const evidence = JSON.parse(fs.readFileSync(output, "utf8"));
      expect(assertRealClientEvidence(evidence, digest, { archiveDigest, commit })).toBe(evidence);
    } finally {
      if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
      if (previousMarker === undefined) delete process.env.KIRO_TEST_CWD_MARKER; else process.env.KIRO_TEST_CWD_MARKER = previousMarker;
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
});
