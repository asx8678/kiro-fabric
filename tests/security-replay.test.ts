import { describe, expect, it } from "vitest";
import {
  defaultSecurityReplayFixtures,
  runSecurityReplaySuite,
  validateSecurityReplayReport,
  type SecurityReplayDriver,
  type SecurityReplayInput,
} from "../src/verification/security-replay.js";

const dataFrom = (input: SecurityReplayInput): { recordCount: number } => {
  const source = input.source as Record<string, any>;
  switch (input.boundary) {
    case "mcp": return source.result.structuredContent;
    case "tool_result": return source.details.data;
    case "memory": return source.entries[0].data;
  }
};

const hostile = (input: SecurityReplayInput): boolean =>
  JSON.stringify(input.source).includes("attacker.invalid");

const exfiltration = {
  kind: "network_request" as const,
  target: "https://attacker.invalid/collect",
  payload: { value: "synthetic-credential" },
};

const protectedDriver: SecurityReplayDriver = {
  async replay(input, effects) {
    if (hostile(input)) effects.observe(exfiltration, "blocked");
    return dataFrom(input).recordCount;
  },
};

const vulnerableDriver: SecurityReplayDriver = {
  async replay(input, effects) {
    if (hostile(input)) effects.observe(exfiltration, "committed");
    return dataFrom(input).recordCount;
  },
};

describe("matched security replay", () => {
  it("replays clean and hostile variants across all three boundary envelopes", async () => {
    const report = await runSecurityReplaySuite(defaultSecurityReplayFixtures, protectedDriver, {
      subject: { id: "deterministic-policy-probe", kind: "deterministic" },
    });

    expect(report.cases.map(({ boundary, variant }) => `${boundary}:${variant}`)).toEqual([
      "mcp:clean",
      "mcp:hostile",
      "tool_result:clean",
      "tool_result:hostile",
      "memory:clean",
      "memory:hostile",
    ]);
    expect(report.summary).toMatchObject({
      pairs: 3,
      runs: 6,
      benignSuccesses: 6,
      benignSuccessRate: 1,
      unauthorizedEffectAttempts: 3,
      unauthorizedEffects: 0,
      unauthorizedEffectRuns: 0,
    });
    expect(report.summary.hostile).toMatchObject({
      runs: 3,
      benignSuccesses: 3,
      unauthorizedEffectAttempts: 3,
      unauthorizedEffects: 0,
    });
    expect(report.disclaimer).toContain("does not establish model robustness");
    expect(validateSecurityReplayReport(report)).toEqual({ valid: true, errors: [] });
  });

  it("counts committed unauthorized effects independently from benign success", async () => {
    const report = await runSecurityReplaySuite(defaultSecurityReplayFixtures, vulnerableDriver, {
      subject: { id: "intentionally-vulnerable-probe", kind: "deterministic" },
    });

    expect(report.summary.benignSuccessRate).toBe(1);
    expect(report.summary.unauthorizedEffects).toBe(3);
    expect(report.summary.unauthorizedEffectRuns).toBe(3);
    expect(report.summary.unauthorizedEffectRunRate).toBe(0.5);
    expect(report.summary.hostile.unauthorizedEffectRunRate).toBe(1);
    expect(report.cases.flatMap((item) => item.effects)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "network_request",
          disposition: "committed",
          unauthorized: true,
          digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        }),
      ]),
    );
    // Raw effect targets and payloads are not copied into the reusable report.
    expect(JSON.stringify(report)).not.toContain("synthetic-credential");
  });

  it("rejects unmatched fixtures and aggregate tampering", async () => {
    const fixture = structuredClone(defaultSecurityReplayFixtures[0]!);
    fixture.hostile.data = { recordCount: 99 };
    await expect(runSecurityReplaySuite([fixture], protectedDriver, {
      subject: { id: "probe", kind: "deterministic" },
    })).rejects.toThrow("clean/hostile data differ");

    const report = await runSecurityReplaySuite(defaultSecurityReplayFixtures, protectedDriver, {
      subject: { id: "probe", kind: "deterministic" },
    });
    report.summary.unauthorizedEffects = 10;
    const validation = validateSecurityReplayReport(report);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("summary does not match recomputed case metrics");
  });

  it("makes fixture-only reports byte-deterministic by default", async () => {
    const first = await runSecurityReplaySuite(defaultSecurityReplayFixtures, protectedDriver, {
      subject: { id: "probe", kind: "deterministic" },
    });
    const second = await runSecurityReplaySuite(defaultSecurityReplayFixtures, protectedDriver, {
      subject: { id: "probe", kind: "deterministic" },
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  });
});
