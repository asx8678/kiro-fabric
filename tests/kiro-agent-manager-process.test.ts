import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { processIsAlive } from "../src/agents/transports/process-utils.js";
import { KiroAgentManager } from "../src/kiro/agent-manager.js";

const managers: KiroAgentManager[] = [];
const waitForFile = async (file: string): Promise<void> => {
  const deadline = Date.now() + 1_000;
  while (!existsSync(file) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!existsSync(file)) throw new Error(`Timed out waiting for ${file}`);
};

const fixture = (): { root: string; runRoot: string; worker: string } => {
  const root = mkdtempSync(join(tmpdir(), "kiro-process-manager-"));
  const runRoot = join(root, "runs");
  const worker = join(root, "worker.mjs");
  writeFileSync(worker, String.raw`
import fs from "node:fs";
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const id = value("--id");
const name = value("--name");
const cwd = value("--cwd");
const task = fs.readFileSync(value("--task-file"), "utf8");
const statusFile = value("--status-file");
const logFile = value("--log-file");
const model = args.includes("--model") ? value("--model") : undefined;
const thinking = args.includes("--thinking") ? value("--thinking") : undefined;
const now = Date.now();
if (task === "HANG") {
  process.on("SIGTERM", () => {
    setTimeout(() => process.exit(0), 150);
  });
}
fs.writeFileSync(logFile, JSON.stringify({ type: "worker.started", task }) + "\n");
if (task === "HANG") {
  setInterval(() => {}, 1000);
} else {
  const record = {
    format: 2, id, name, task, status: "completed", runner: "kiro",
    transport: "process", cwd, startedAt: now, updatedAt: now,
    finishedAt: now, turns: 1, toolCalls: 0, text: "complete",
    value: { arguments: args },
    usage: { availability: "unavailable", reason: "runner-does-not-report", input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    ...(model ? { model } : {}), ...(thinking ? { thinking } : {}),
  };
  fs.writeFileSync(statusFile, JSON.stringify(record));
}
`, { mode: 0o700 });
  return { root, runRoot, worker };
};

const manager = (overrides: Partial<typeof DEFAULT_FABRIC_CONFIG.agents> = {}) => {
  const files = fixture();
  const instance = new KiroAgentManager(files.root, {
    ...structuredClone(DEFAULT_FABRIC_CONFIG.agents),
    enabled: true,
    runner: "kiro",
    transport: "process",
    retainRuns: true,
    timeoutMs: 2_000,
    maxTokensPerChild: 0,
    budgetUsd: 0,
    ...overrides,
  }, { workerPath: files.worker, runRoot: files.runRoot, projectRoot: files.root, kiroBinary: "kiro-test" });
  managers.push(instance);
  return { instance, ...files };
};

afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((entry) => entry.close()));
});

describe("KiroAgentManager process runtime", () => {
  it("launches only a process worker and preserves terminal status and logs", async () => {
    const { instance, runRoot } = manager();
    const result = await instance.run({
      task: "finish",
      runner: "kiro",
      transport: "auto",
      kiroResidency: "one-shot",
      tools: ["read"],
      model: "test-model",
      thinking: "low",
    });

    expect(result).toMatchObject({
      status: "completed",
      runner: "kiro",
      transport: "process",
      text: "complete",
      model: "test-model",
      thinking: "low",
    });
    expect(instance.status(result.id)).toMatchObject({ status: "completed" });
    expect(instance.list()).toHaveLength(1);
    const log = instance.readLog(result.id, { lines: 1 });
    expect(log.events[0]?.parsed).toMatchObject({ type: "worker.started", task: "finish" });
    const args = (result.value as { arguments: string[] }).arguments;
    expect(args).toContain("--kiro-residency");
    expect(args).toContain("one-shot");
    expect(args).not.toContain("--steer-file");
    expect(readFileSync(join(runRoot, result.id, "task.txt"), "utf8")).toBe("finish");
  });

  it("queues resident steering commands and rejects steering after stop", async () => {
    const { instance, runRoot } = manager();
    const handle = await instance.spawn({ task: "HANG", tools: [], kiroResidency: "resident" });
    const steer = instance.steer(handle.id, "change direction", { priority: 1 });
    const followUp = instance.followUp(handle.id, "then summarize");
    instance.setSteeringMode(handle.id, "all");
    instance.setFollowUpMode(handle.id, "one-at-a-time");

    const commands = readFileSync(join(runRoot, handle.id, "steer.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string; id: string });
    expect(commands.map((entry) => entry.type)).toEqual([
      "steer", "follow_up", "set_steering_mode", "set_follow_up_mode",
    ]);
    expect(commands[0]?.id).toBe(steer.messageId);
    expect(commands[1]?.id).toBe(followUp.messageId);

    await waitForFile(join(runRoot, handle.id, "events.jsonl"));
    const pid = Number(handle.sessionId);
    const startedStopping = Date.now();
    const stopped = await instance.stop(handle.id);
    expect(stopped.status).toBe("stopped");
    expect(Date.now() - startedStopping).toBeGreaterThanOrEqual(100);
    expect(processIsAlive(pid)).toBe(false);
    expect(() => instance.steer(handle.id, "too late")).toThrow(/already finished/);
  });

  it("never invokes ambient ps helpers while controlling managed Kiro workers", async () => {
    if (process.platform !== "linux") return;
    const { instance, root, runRoot } = manager();
    const bin = join(root, "hostile-path");
    const marker = join(root, "ambient-ps-invoked");
    mkdirSync(bin);
    writeFileSync(join(bin, "ps"), `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nexit 1\n`, { mode: 0o755 });
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ""}`;
    try {
      const handle = await instance.spawn({ task: "HANG", tools: [] });
      await waitForFile(join(runRoot, handle.id, "events.jsonl"));
      await instance.stop(handle.id);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects queued launches when close begins and never starts another worker", async () => {
    const { instance, runRoot } = manager({ maxConcurrent: 1 });
    await instance.spawn({ task: "HANG", tools: [] });
    const queued = instance.spawn({ task: "must-not-launch", tools: [] });
    const queuedRejection = expect(queued).rejects.toThrow(/manager is closing/);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await instance.close();

    await queuedRejection;
    expect(readdirSync(runRoot)).toHaveLength(1);
  });

  it("rejects generic runners and non-process transports before launch", async () => {
    const { instance } = manager();
    await expect(instance.spawn({ task: "wrong runner", runner: "pi", tools: [] } as never))
      .rejects.toThrow(/only the Kiro runner/);
    await expect(instance.spawn({ task: "wrong transport", transport: "tmux", tools: [] } as never))
      .rejects.toThrow(/only process transport/);
    expect(instance.list()).toEqual([]);
  });
});
