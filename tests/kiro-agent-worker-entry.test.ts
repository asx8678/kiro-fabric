import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { KiroAgentRunRecord } from "../src/kiro/agent-types.js";
import { parseKiroAgentWorkerOptions } from "../src/kiro/agent-worker-options.js";
import { writeKiroWorkerCrashStatus } from "../src/kiro/agent-worker-entry.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const argv = (overrides: Record<string, string> = {}): string[] => {
  const values = {
    id: "kiro-run",
    name: "Kiro child",
    runner: "kiro",
    "task-file": "/tmp/task.txt",
    "status-file": "/tmp/status.json",
    "log-file": "/tmp/events.jsonl",
    cwd: "/tmp",
    "kiro-binary": "kiro-cli",
    "timeout-ms": "1000",
    tools: "[]",
    transport: "process",
    ...overrides,
  };
  return ["node", "agent-worker-entry.js", ...Object.entries(values).flatMap(([key, value]) => ["--" + key, value])];
};

describe("Kiro agent worker entry", () => {
  it("parses the standalone Kiro contract without generic runner arguments", () => {
    const options = parseKiroAgentWorkerOptions(argv());
    expect(options).toMatchObject({
      id: "kiro-run",
      runner: "kiro",
      kiroBinary: "kiro-cli",
      timeoutMs: 1000,
      tools: [],
    });
    expect(options).not.toHaveProperty("piBinary");
    expect(options).not.toHaveProperty("claudeBinary");
    expect(options).not.toHaveProperty("vedaBinary");
  });

  it("fails closed on non-Kiro runners and malformed numeric arguments", () => {
    expect(() => parseKiroAgentWorkerOptions(argv({ runner: "claude" }))).toThrow(/Unsupported Kiro worker runner/);
    expect(() => parseKiroAgentWorkerOptions(argv({ "timeout-ms": "NaN" }))).toThrow(/--timeout-ms/);
  });

  it("writes a terminal failed record for a running worker crash", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-agent-worker-entry-"));
    roots.push(root);
    const statusFile = path.join(root, "status.json");
    const record: KiroAgentRunRecord = {
      id: "run", name: "child", task: "work", status: "running", runner: "kiro",
      transport: "process", cwd: root, startedAt: 1, updatedAt: 1, turns: 0,
      toolCalls: 0, text: "", usage: { availability: "unavailable", reason: "runner-does-not-report", input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    };
    writeKiroWorkerCrashStatus({ statusFile, record }, new Error("boom"));
    const written = JSON.parse(fs.readFileSync(statusFile, "utf8")) as KiroAgentRunRecord;
    expect(written.status).toBe("failed");
    expect(written.error).toContain("Worker crashed before reporting a result: boom");
    expect(written.finishedAt).toEqual(expect.any(Number));
  });

  it("does not import the generic worker or runner-specific modules", () => {
    const source = fs.readFileSync(path.resolve("src/kiro/agent-worker-entry.ts"), "utf8");
    expect(source).not.toMatch(/(?:\.\.\/worker|session-export|claude|veda)/i);
    expect(source).toContain('from "./acp-worker.js"');
  });
});
