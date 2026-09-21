import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acpToolDataContaining,
  automaticCompactionInInterval,
  collectAutomaticCompactionPressure,
  completedAcpAutomaticCompactions,
  parseAcpJsonlFrames,
} from "../scripts/run-kiro-agent-real-driver.mjs";
import { REAL_CLIENT_AUTO_COMPACTION_MAX_PRESSURE_TURNS } from "../scripts/real-client-evidence.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const sessionId = "11111111-1111-4111-8111-111111111111";
const fact = "conversation-only-unpredictable-fact";
const envelope = (direction: string, message: object) => ({ direction, message: { jsonrpc: "2.0", ...message } });
const status = (type: string) => envelope("server-to-client", {
  method: "_kiro.dev/compaction/status", params: { sessionId, status: { type } },
});

function pressureFixture(successAt: number, intervening?: object) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qualification-pressure-")); roots.push(root);
  const recordFile = path.join(root, "acp.jsonl");
  const seed = envelope("client-to-server", { id: "seed", method: "session/prompt", params: {
    sessionId, prompt: [{ type: "text", text: `Remember ${fact}` }],
  } });
  const seedTool = envelope("server-to-client", { method: "session/update", params: { sessionId, update: {
    sessionUpdate: "tool_call", toolCallId: "expected-seed", rawInput: { code: "return {verified: true}" },
  } } });
  // The conversation-only fact is in the prompt, never in its seed tool data.
  fs.writeFileSync(recordFile, [seed, seedTool].map(frame => JSON.stringify(frame) + "\n").join(""));
  const seedEndOffset = fs.statSync(recordFile).size;
  let turns = 0;
  const starts: number[] = [];
  const append = (frame: object) => fs.appendFileSync(recordFile, JSON.stringify(frame) + "\n");
  const collect = () => collectAutomaticCompactionPressure({
    recordFile, sessionId,
    sendPressure: async (prompt: string) => {
      turns += 1;
      expect(prompt).not.toContain(fact);
      append(envelope("client-to-server", { id: turns, method: "session/prompt", params: {
        sessionId, prompt: [{ type: "text", text: prompt }],
      } }));
      if (turns === 1 && intervening) append(intervening);
      if (turns === successAt) { append(status("started")); append(status("completed")); }
      append(envelope("server-to-client", { id: turns, result: { stopReason: "end_turn" } }));
      return Buffer.from("ACK");
    },
    observePressure: async (start: number, marker: string) => {
      starts.push(start);
      return automaticCompactionInInterval(recordFile, start, sessionId, marker);
    },
  });
  return { collect, recordFile, seedEndOffset, starts, turns: () => turns };
}

describe("offline automatic pressure producer", () => {
  it.each([1, 2, REAL_CLIENT_AUTO_COMPACTION_MAX_PRESSURE_TURNS])("binds success on turn %i to the entire seed-adjacent pressure interval", async successAt => {
    const f = pressureFixture(successAt);
    const result = await f.collect();
    expect(result.intervalStartOffset).toBe(f.seedEndOffset);
    expect(f.starts).toEqual(Array(successAt).fill(f.seedEndOffset));
    expect(result.attempts).toHaveLength(successAt);
    expect(result.attempts.map(attempt => attempt.index)).toEqual(Array.from({ length: successAt }, (_, i) => i + 1));
    expect(new Set(result.attempts.map(attempt => attempt.pressureMarkerDigest)).size).toBe(successAt);
    const observed = result.observed!;
    const observedEvent = observed.event;
    expect(observedEvent).toBeDefined();
    expect(result.attempts.at(-1)!.pressureMarkerDigest).toBe(observedEvent!.pressureMarkerDigest);
    const bytes = fs.readFileSync(f.recordFile);
    expect(observed.endOffset).toBe(bytes.length);
    const pressure = parseAcpJsonlFrames(bytes, result.intervalStartOffset, observed.endOffset);
    expect(completedAcpAutomaticCompactions(pressure, sessionId, result.pressureMarker)).toEqual([observedEvent]);
    expect(acpToolDataContaining(parseAcpJsonlFrames(bytes), fact)).toEqual([]);
  });

  it.each(["tool_call", "tool_call_update", "benign-tool", "manual"])("rejects an intervening %s in an earlier pressure attempt", async kind => {
    const frame = kind === "manual"
      ? envelope("client-to-server", { id: "manual", method: "_kiro.dev/commands/execute", params: { sessionId, command: "/compact" } })
      : envelope("server-to-client", { method: "session/update", params: { sessionId, update: {
        sessionUpdate: kind === "benign-tool" ? "tool_call" : kind, toolCallId: "unexpected",
        rawInput: kind === "benign-tool" ? { code: "return 1" } : { leaked: fact },
      } } });
    const f = pressureFixture(2, frame);
    await expect(f.collect()).rejects.toThrow("12 bounded natural pressure turns");
    expect(f.turns()).toBe(REAL_CLIENT_AUTO_COMPACTION_MAX_PRESSURE_TURNS);
    const leaks = acpToolDataContaining(parseAcpJsonlFrames(fs.readFileSync(f.recordFile)), fact);
    if (["manual", "benign-tool"].includes(kind)) expect(leaks).toEqual([]);
    else expect(leaks).not.toEqual([]);
  });

  it("stops after the bounded maximum without fabricating completion", async () => {
    const f = pressureFixture(REAL_CLIENT_AUTO_COMPACTION_MAX_PRESSURE_TURNS + 1);
    await expect(f.collect()).rejects.toThrow("12 bounded natural pressure turns");
    expect(f.turns()).toBe(REAL_CLIENT_AUTO_COMPACTION_MAX_PRESSURE_TURNS);
  });
});
