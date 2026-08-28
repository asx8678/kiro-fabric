import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ActorManager } from "../src/actors/manager.js";
import { AgentManager } from "../src/agents/manager.js";
import type { AgentRunRequest, AgentRunResult } from "../src/agents/types.js";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { MeshStore, type MeshIdentity } from "../src/mesh/store.js";

const waitFor = async (predicate: () => boolean, timeoutMs = 4_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for actor inbox state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const completedRun = (
  root: string,
  request: AgentRunRequest,
  sequence: number,
): AgentRunResult => {
  const now = Date.now();
  return {
    id: `completed-${sequence}`,
    name: request.name ?? "actor",
    task: request.task,
    status: "completed",
    runner: request.runner ?? "pi",
    transport: request.transport ?? "process",
    cwd: request.cwd ?? root,
    startedAt: now,
    updatedAt: now,
    finishedAt: now,
    turns: 1,
    toolCalls: 0,
    text: `completed-${sequence}`,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  };
};

describe("durable actor mesh inbox", () => {
  it("journals before cursor acknowledgment and replays an unfinished activation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-actor-inbox-"));
    const actorRoot = path.join(root, "actors");
    const cursorPath = path.join(root, "actor-cursor.json");
    const meshConfig = { ...DEFAULT_FABRIC_CONFIG.mesh, actorPollMs: 20 };
    const mesh = new MeshStore(path.join(root, "mesh"), 64 * 1024, 100);
    const agents = new AgentManager(root, DEFAULT_FABRIC_CONFIG.agents, {
      workerPath: path.resolve("tests/fixtures/fake-worker.mjs"),
      runRoot: path.join(root, "runs"),
    });
    const run = vi.spyOn(agents, "run").mockImplementation((_request, signal) =>
      new Promise((_resolve, reject) => {
        const fail = () => reject(new Error("simulated process stop"));
        if (signal?.aborted) fail();
        else signal?.addEventListener("abort", fail, { once: true });
      }),
    );
    const identity: MeshIdentity = {
      id: "session:durable-inbox",
      name: "main",
      kind: "main",
      sessionId: "durable-inbox",
    };
    const makeManager = () => new ActorManager(
      "durable-inbox",
      identity,
      mesh,
      meshConfig,
      agents,
      () => {},
      { actorRoot, persistent: true, meshCursorPath: cursorPath },
    );

    const first = makeManager();
    let second: ActorManager | undefined;
    try {
      const actor = await first.create({
        name: "durable inbox actor",
        instructions: "Process subscribed mesh work.",
        topics: ["team.durable"],
      });
      await mesh.publish({
        topic: "team.durable",
        from: { id: "peer", name: "peer", kind: "actor" },
        text: "must survive",
      });
      await waitFor(() => run.mock.calls.length === 1);

      const inboxPath = `${cursorPath}.inbox`;
      await waitFor(() => fs.existsSync(inboxPath) && fs.existsSync(cursorPath));
      expect(JSON.parse(fs.readFileSync(inboxPath, "utf8"))).toMatchObject({
        format: 1,
        entries: [expect.objectContaining({
          actorId: actor.id,
          status: "pending",
          item: expect.objectContaining({ source: "mesh:team.durable" }),
        })],
      });

      // Graceful close exercises the same state boundary as a crash after the
      // cursor write: in-flight work is aborted, but its pending journal row is
      // deliberately retained for the next process.
      await first.close();
      expect(JSON.parse(fs.readFileSync(inboxPath, "utf8")))
        .toMatchObject({ entries: [expect.objectContaining({ status: "pending" })] });

      second = makeManager();
      await waitFor(() => run.mock.calls.length === 2);
      expect(second.status(actor.id).status).toBe("running");
    } finally {
      await second?.close().catch(() => undefined);
      await first.close().catch(() => undefined);
      await agents.close().catch(() => undefined);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refills every journaled activation after restoring beyond the queue limit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-actor-overflow-"));
    const actorRoot = path.join(root, "actors");
    const cursorPath = path.join(root, "actor-cursor.json");
    const meshConfig = {
      ...DEFAULT_FABRIC_CONFIG.mesh,
      actorPollMs: 20,
      actorQueueLimit: 1,
    };
    const mesh = new MeshStore(path.join(root, "mesh"), 64 * 1024, 100);
    const agents = new AgentManager(root, DEFAULT_FABRIC_CONFIG.agents, {
      workerPath: path.resolve("tests/fixtures/fake-worker.mjs"),
      runRoot: path.join(root, "runs"),
    });
    let blocking = true;
    let completed = 0;
    const run = vi.spyOn(agents, "run").mockImplementation((request, signal) => {
      if (!blocking) return Promise.resolve(completedRun(root, request, ++completed));
      return new Promise((_resolve, reject) => {
        const fail = () => reject(new Error("simulated process stop"));
        if (signal?.aborted) fail();
        else signal?.addEventListener("abort", fail, { once: true });
      });
    });
    const identity: MeshIdentity = {
      id: "session:overflow",
      name: "main",
      kind: "main",
      sessionId: "overflow",
    };
    const makeManager = () => new ActorManager(
      "overflow",
      identity,
      mesh,
      meshConfig,
      agents,
      () => {},
      { actorRoot, persistent: true, meshCursorPath: cursorPath },
    );
    const first = makeManager();
    let second: ActorManager | undefined;
    try {
      const actor = await first.create({
        name: "overflow actor",
        instructions: "Process every durable event.",
        topics: ["team.overflow"],
      });
      for (let index = 0; index < 3; index++) {
        await mesh.publish({
          topic: "team.overflow",
          from: { id: "peer", name: "peer", kind: "actor" },
          text: `event-${index}`,
        });
      }
      const inboxPath = `${cursorPath}.inbox`;
      await waitFor(() => run.mock.calls.length === 1 && fs.existsSync(cursorPath));
      await waitFor(() => {
        const inbox = JSON.parse(fs.readFileSync(inboxPath, "utf8")) as { entries: unknown[] };
        return inbox.entries.length === 3;
      });

      await first.close();
      blocking = false;
      second = makeManager();
      await waitFor(() => completed === 3);
      await waitFor(() => {
        const inbox = JSON.parse(fs.readFileSync(inboxPath, "utf8")) as { entries: unknown[] };
        return inbox.entries.length === 0;
      });
      expect(second.status(actor.id)).toMatchObject({ status: "idle", queued: 0 });
    } finally {
      await second?.close().catch(() => undefined);
      await first.close().catch(() => undefined);
      await agents.close().catch(() => undefined);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets another actor progress while a saturated actor uses durable backlog", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-actor-isolation-"));
    const actorRoot = path.join(root, "actors");
    const cursorPath = path.join(root, "actor-cursor.json");
    const meshConfig = {
      ...DEFAULT_FABRIC_CONFIG.mesh,
      actorPollMs: 20,
      actorQueueLimit: 1,
    };
    const mesh = new MeshStore(path.join(root, "mesh"), 64 * 1024, 100);
    const agents = new AgentManager(root, DEFAULT_FABRIC_CONFIG.agents, {
      workerPath: path.resolve("tests/fixtures/fake-worker.mjs"),
      runRoot: path.join(root, "runs"),
    });
    let fastRuns = 0;
    const run = vi.spyOn(agents, "run").mockImplementation((request, signal) => {
      if (request.actorName === "slow actor") {
        return new Promise((_resolve, reject) => {
          const fail = () => reject(new Error("slow actor stopped"));
          if (signal?.aborted) fail();
          else signal?.addEventListener("abort", fail, { once: true });
        });
      }
      fastRuns++;
      return Promise.resolve(completedRun(root, request, fastRuns));
    });
    const identity: MeshIdentity = {
      id: "session:isolation",
      name: "main",
      kind: "main",
      sessionId: "isolation",
    };
    const manager = new ActorManager(
      "isolation",
      identity,
      mesh,
      meshConfig,
      agents,
      () => {},
      { actorRoot, persistent: true, meshCursorPath: cursorPath },
    );
    try {
      await manager.create({
        name: "slow actor",
        instructions: "Block until stopped.",
        topics: ["team.slow"],
      });
      const fast = await manager.create({
        name: "fast actor",
        instructions: "Finish immediately.",
        topics: ["team.fast"],
      });
      for (let index = 0; index < 3; index++) {
        await mesh.publish({
          topic: "team.slow",
          from: { id: "peer", name: "peer", kind: "actor" },
          text: `slow-${index}`,
        });
      }
      await mesh.publish({
        topic: "team.fast",
        from: { id: "peer", name: "peer", kind: "actor" },
        text: "fast",
      });

      await waitFor(() => fastRuns === 1 && fs.existsSync(cursorPath));
      expect(manager.status(fast.id).status).toBe("idle");
      expect(run.mock.calls.some(([request]) => request.actorName === "slow actor")).toBe(true);
    } finally {
      await manager.close().catch(() => undefined);
      await agents.close().catch(() => undefined);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("coalesces relayed host events while journaling every source event", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-actor-coalesce-"));
    const actorRoot = path.join(root, "actors");
    const cursorPath = path.join(root, "actor-cursor.json");
    const meshConfig = {
      ...DEFAULT_FABRIC_CONFIG.mesh,
      actorPollMs: 20,
      actorQueueLimit: 1,
    };
    const mesh = new MeshStore(path.join(root, "mesh"), 64 * 1024, 100);
    const agents = new AgentManager(root, DEFAULT_FABRIC_CONFIG.agents, {
      workerPath: path.resolve("tests/fixtures/fake-worker.mjs"),
      runRoot: path.join(root, "runs"),
    });
    const run = vi.spyOn(agents, "run").mockImplementation((_request, signal) =>
      new Promise((_resolve, reject) => {
        const fail = () => reject(new Error("coalesced actor stopped"));
        if (signal?.aborted) fail();
        else signal?.addEventListener("abort", fail, { once: true });
      }),
    );
    const identity: MeshIdentity = {
      id: "session:coalesce",
      name: "main",
      kind: "main",
      sessionId: "coalesce",
    };
    const manager = new ActorManager(
      "coalesce",
      identity,
      mesh,
      meshConfig,
      agents,
      () => {},
      { actorRoot, persistent: true, meshCursorPath: cursorPath },
    );
    try {
      const actor = await manager.create({
        name: "coalescing actor",
        instructions: "Use the latest turn end.",
        events: ["turn_end"],
        coalesce: true,
      });
      for (let index = 0; index < 3; index++) {
        await mesh.publish({
          topic: "fabric.actor.host-event",
          kind: "turn_end",
          from: identity,
          to: actor.id,
          data: {
            version: 1,
            actorId: actor.id,
            event: "turn_end",
            mainRevision: index + 1,
            taskRevision: 0,
            idle: true,
            payload: { index },
          },
        });
      }
      const inboxPath = `${cursorPath}.inbox`;
      await waitFor(() => run.mock.calls.length === 1 && fs.existsSync(cursorPath));
      await waitFor(() => {
        const inbox = JSON.parse(fs.readFileSync(inboxPath, "utf8")) as {
          entries: Array<{ item: { id: string; payload: unknown } }>;
        };
        return inbox.entries.length === 3 &&
          new Set(inbox.entries.map((entry) => entry.item.id)).size === 2;
      });
      const inbox = JSON.parse(fs.readFileSync(inboxPath, "utf8")) as {
        entries: Array<{ item: { id: string; payload: unknown } }>;
      };
      const grouped = new Map<string, typeof inbox.entries>();
      for (const entry of inbox.entries) {
        const entries = grouped.get(entry.item.id) ?? [];
        entries.push(entry);
        grouped.set(entry.item.id, entries);
      }
      const coalesced = [...grouped.values()].find((entries) => entries.length === 2)!;
      expect(coalesced.map((entry) => entry.item.payload))
        .toEqual([{ index: 2 }, { index: 2 }]);
    } finally {
      await manager.close().catch(() => undefined);
      await agents.close().catch(() => undefined);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("completes invalidated journal rows without leaving an active item stuck", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-actor-stale-"));
    const actorRoot = path.join(root, "actors");
    const cursorPath = path.join(root, "actor-cursor.json");
    const meshConfig = { ...DEFAULT_FABRIC_CONFIG.mesh, actorPollMs: 20 };
    const mesh = new MeshStore(path.join(root, "mesh"), 64 * 1024, 100);
    const agents = new AgentManager(root, DEFAULT_FABRIC_CONFIG.agents, {
      workerPath: path.resolve("tests/fixtures/fake-worker.mjs"),
      runRoot: path.join(root, "runs"),
    });
    const run = vi.spyOn(agents, "run");
    const identity: MeshIdentity = {
      id: "session:stale",
      name: "main",
      kind: "main",
      sessionId: "stale",
    };
    const manager = new ActorManager(
      "stale",
      identity,
      mesh,
      meshConfig,
      agents,
      () => {},
      { actorRoot, persistent: true, meshCursorPath: cursorPath },
    );
    try {
      const actor = await manager.create({
        name: "stale actor",
        instructions: "Never run stale work.",
        topics: ["team.stale"],
        validWhile: { version: 1, source: "() => false" },
      });
      for (let index = 0; index < 2; index++) {
        await mesh.publish({
          topic: "team.stale",
          from: { id: "peer", name: "peer", kind: "actor" },
          text: `stale-${index}`,
        });
      }
      const inboxPath = `${cursorPath}.inbox`;
      await waitFor(() => fs.existsSync(cursorPath) && fs.existsSync(inboxPath));
      await waitFor(() => {
        const inbox = JSON.parse(fs.readFileSync(inboxPath, "utf8")) as { entries: unknown[] };
        return inbox.entries.length === 0;
      });
      expect(manager.status(actor.id)).toMatchObject({ status: "idle", queued: 0 });
      expect(run).not.toHaveBeenCalled();
    } finally {
      await manager.close().catch(() => undefined);
      await agents.close().catch(() => undefined);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
