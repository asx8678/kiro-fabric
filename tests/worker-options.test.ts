import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseWorkerOptions } from "../src/worker/options.js";

const args = (overrides: Record<string, string> = {}): string[] => {
  const values = {
    id: "run1",
    name: "test",
    runner: "kiro",
    "task-file": "/tmp/task.txt",
    "status-file": "/tmp/status.json",
    "lifecycle-file": "/tmp/lifecycle.jsonl",
    "log-file": "/tmp/events.jsonl",
    cwd: "/tmp",
    "pi-binary": "pi",
    "claude-binary": "claude",
    "veda-binary": "veda",
    "veda-backend": "agy",
    "veda-persona": "navigator-chat",
    "timeout-ms": "1000",
    depth: "1",
    "full-code-mode": "false",
    extensions: "false",
    tools: "[]",
    "granted-risks": "[]",
    transport: "process",
    "kiro-binary": "kiro-cli",
    ...overrides,
  };
  return [
    "node",
    "worker.js",
    ...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]),
  ];
};

describe("parseWorkerOptions", () => {
  it("accepts the Kiro runner", () => {
    expect(parseWorkerOptions(args()).runner).toBe("kiro");
  });

  it("rejects an unknown runner instead of falling back to Pi", () => {
    expect(() => parseWorkerOptions(args({ runner: "future-runner" }))).toThrow(
      /Unsupported Fabric agent runner: future-runner/,
    );
  });

  it("requires --kiro-binary", () => {
    expect(parseWorkerOptions(args()).kiroBinary).toBe("kiro-cli");
    expect(() => parseWorkerOptions(args({ "kiro-binary": "" }))).toThrow(
      /Missing worker argument: --kiro-binary/,
    );
  });

  it("requires a complete canonical capability commitment", () => {
    expect(() => parseWorkerOptions(args({
      "capability-requirements": JSON.stringify(["memory.get"]),
    }))).toThrow("requires both requirements and digest");
    expect(() => parseWorkerOptions(args({
      "capability-digest": "a".repeat(64),
    }))).toThrow("requires both requirements and digest");
    expect(() => parseWorkerOptions(args({
      "capability-requirements": JSON.stringify(["memory.get"]),
      "capability-digest": "not-canonical",
    }))).toThrow("Invalid worker capability digest");
    expect(parseWorkerOptions(args({
      "capability-requirements": JSON.stringify(["memory.get"]),
      "capability-digest": "a".repeat(64),
    }))).toMatchObject({
      capabilityRequirements: ["memory.get"],
      capabilityDigest: "a".repeat(64),
    });
  });

  it("validates semantic context files and fails closed on corrupt input", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-worker-options-context-"));
    try {
      const contextFile = path.join(root, "context.json");
      fs.writeFileSync(contextFile, JSON.stringify({ objective: "review" }), { mode: 0o600 });
      expect(parseWorkerOptions(args({ "kiro-context-file": contextFile })).kiroContext)
        .toEqual({ objective: "review" });

      fs.writeFileSync(contextFile, "not json", { mode: 0o600 });
      expect(() => parseWorkerOptions(args({ "kiro-context-file": contextFile })))
        .toThrow(/invalid JSON/);
      expect(() => parseWorkerOptions(args({
        "kiro-context-file": path.join(root, "missing.json"),
      }))).toThrow(/Cannot open Kiro semantic context file/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
