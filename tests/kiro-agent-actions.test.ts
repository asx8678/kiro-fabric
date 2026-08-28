import { describe, expect, it } from "vitest";
import { KIRO_AGENT_ACTION_DESCRIPTORS } from "../src/kiro/agent-actions.js";
import { actionArgNormalizer } from "../src/providers/arg-normalization.js";

const expectedNames = [
  "run", "spawn", "wait", "status", "list", "models", "stop", "cleanup", "steer",
  "followUp", "setSteeringMode", "setFollowUpMode", "log",
];

const expectedDescriptions: Record<string, string> = {
  run: "Run one narrowly scoped Kiro ACP child with trusted-shell verification and wait for its result; omitted models use capability routing when those models are advertised, otherwise Kiro auto",
  spawn: "Start one narrowly scoped Kiro ACP child with trusted-shell verification and return its local handle immediately; fan out at most four non-overlapping tasks",
  wait: "Wait for a Kiro ACP child started by this managed Kiro session",
  status: "Get the latest status of a Kiro ACP child started by this managed Kiro session",
  list: "List Kiro ACP children started by this managed Kiro session",
  models: "List Kiro models discovered from `kiro-cli chat --v3 --list-models --format json` (cached, non-billable)",
  stop: "Stop a Kiro ACP child started by this managed Kiro session",
  cleanup: "Remove a completed Kiro ACP child's retained run files",
  steer: "Steer a running Kiro ACP child between turns",
  followUp: "Queue a follow-up turn for a running Kiro ACP child",
  setSteeringMode: "Set how queued steering messages are delivered to a Kiro ACP child",
  setFollowUpMode: "Set how queued follow-up messages are delivered to a Kiro ACP child",
  log: "Read a Kiro ACP child's retained Fabric event log",
};

const propertiesOf = (name: string): Record<string, any> => {
  const descriptor = KIRO_AGENT_ACTION_DESCRIPTORS.find((entry) => entry.name === name);
  expect(descriptor).toBeDefined();
  return descriptor!.inputSchema.properties as Record<string, any>;
};

describe("managed Kiro agent action catalog", () => {
  it("contains exactly the 13 session-local ACP child actions", () => {
    expect(KIRO_AGENT_ACTION_DESCRIPTORS.map((entry) => entry.name)).toEqual(expectedNames);
    expect(Object.fromEntries(KIRO_AGENT_ACTION_DESCRIPTORS.map((entry) => [entry.name, entry.description])))
      .toEqual(expectedDescriptions);
  });

  it("uses Kiro-only run schemas and process-capable transports", () => {
    for (const name of ["run", "spawn"]) {
      const properties = propertiesOf(name);
      expect(properties.runner).toMatchObject({ type: "string" });
      expect(properties.runner.description).toMatch(/only `kiro`.*`kiro-cli`/i);
      expect(properties.transport.enum).toEqual(["auto", "process"]);
      expect(properties.context).toMatchObject({ type: "object", additionalProperties: false });
      expect(properties).not.toHaveProperty("persona");
      expect(properties).not.toHaveProperty("residency");
      expect(properties).not.toHaveProperty("recursive");
      expect(properties).not.toHaveProperty("worktree");
      expect(properties).not.toHaveProperty("compact");
    }
    expect(propertiesOf("models").runner.enum).toEqual(["kiro"]);
  });

  it("does not expose generic agent action or schema vocabulary", () => {
    const schemas = JSON.stringify(KIRO_AGENT_ACTION_DESCRIPTORS.map((entry) => entry.inputSchema));
    for (const forbidden of [
      '"residency"', '"recursive"', '"worktree"', '"compact"', '"actorStatus"',
      '"actors"', '"create"', '"ask"', '"tell"',
    ]) {
      expect(schemas).not.toContain(forbidden);
    }
  });

  it("retains schema-derived task and child-id aliases", () => {
    const normalize = actionArgNormalizer(() => KIRO_AGENT_ACTION_DESCRIPTORS);
    expect(normalize("run", { prompt: "review this" })).toEqual({ task: "review this" });
    expect(normalize("wait", { agentId: "child-1" })).toEqual({ id: "child-1" });
    expect(normalize("log", { runId: "child-2", lines: "20" })).toEqual({ id: "child-2", lines: 20 });
  });
});
