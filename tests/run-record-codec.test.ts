import { describe, expect, it } from "vitest";
import {
  parseAgentRunRecord,
  parseAgentUsage,
  serializeAgentRunRecord,
} from "../src/agents/run-record-codec.js";
import { AGENT_RUN_RECORD_FORMAT, unavailableUsage } from "../src/agents/types.js";
import type { AgentRunRecord } from "../src/agents/types.js";

const baseRecord = {
  id: "abc",
  name: "task",
  task: "do work",
  status: "completed",
  runner: "pi",
  transport: "process",
  cwd: "/tmp",
  startedAt: 1,
  updatedAt: 2,
  turns: 1,
  toolCalls: 0,
  text: "ok",
  usage: { input: 3, output: 4, cacheRead: 1, cacheWrite: 0, cost: 0.5 },
} as const;

describe("agent run record codec", () => {
  it("preserves unversioned numeric usage and known runners without coercing them to Pi", () => {
    const parsed = parseAgentRunRecord({ ...baseRecord, runner: "claude" });
    expect(parsed?.runner).toBe("claude");
    expect(parsed?.format).toBeUndefined();
    expect(parsed?.usage).toEqual({
      input: 3,
      output: 4,
      cacheRead: 1,
      cacheWrite: 0,
      cost: 0.5,
    });
  });

  it("accepts format 2 Kiro records with unavailable usage", () => {
    const parsed = parseAgentRunRecord({
      ...baseRecord,
      format: AGENT_RUN_RECORD_FORMAT,
      runner: "kiro",
      usage: unavailableUsage("runner-does-not-report"),
    });
    expect(parsed?.runner).toBe("kiro");
    expect(parsed?.usage).toEqual(unavailableUsage("runner-does-not-report"));
  });

  it("defaults a missing legacy runner to Pi", () => {
    const { runner: _runner, ...withoutRunner } = baseRecord;
    expect(parseAgentRunRecord(withoutRunner)?.runner).toBe("pi");
  });

  it("rejects unknown runners and newer record formats instead of coercing them to Pi", () => {
    expect(parseAgentRunRecord({ ...baseRecord, runner: "future-runner" })).toBeUndefined();
    expect(parseAgentRunRecord({ ...baseRecord, format: 3, runner: "pi" })).toBeUndefined();
  });

  it("serializes current records as format 2 with explicit availability", () => {
    const serialized = serializeAgentRunRecord(baseRecord as unknown as AgentRunRecord);
    expect(serialized.format).toBe(AGENT_RUN_RECORD_FORMAT);
    expect(serialized.usage.availability).toBe("available");
    expect(parseAgentUsage({ availability: "unavailable", reason: "worker-did-not-report" })).toEqual(
      unavailableUsage("worker-did-not-report"),
    );
  });
});
