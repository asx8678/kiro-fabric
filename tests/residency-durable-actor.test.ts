import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import type { FabricMainAgentDeliveryRequest, FabricMainAgentTarget } from "../src/main-agent.js";
import { MeshStore, type MeshIdentity } from "../src/mesh/store.js";
import { ResidencyClient } from "../src/residency/client.js";
import { ResidentHost } from "../src/residency/host.js";
import {
  RESIDENT_HOST_FORMAT,
  residentDeliveryPrefix,
  residentHostId,
  residentOwnerClaimKey,
  residentRoot,
  type ResidentHostConfig,
} from "../src/residency/protocol.js";
import { installKiroProfile } from "../src/kiro/install-test-helper.js";
import { FabricControlPlane } from "../src/topology/control-plane.js";
import { ParticipantDirectory } from "../src/topology/participant-directory.js";
import { makeTreeRemovable } from "./helpers/removable-tree.js";

const repoRoot = process.cwd();
const kiroWorker = path.resolve("dist/kiro/agent-worker-entry.js");
const distExtension = path.resolve("dist/index.js");
const fakeKiroWorker = path.resolve("tests/fixtures/kiro/fake-kiro-worker.mjs");
const roots: string[] = [];
let sequence = 0;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean, timeoutMs = 10_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for durable actor state");
    await delay(25);
  }
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const initGitRepository = (prefix: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "kiro-fabric-tests@example.invalid");
  git(root, "config", "user.name", "Pi Fabric tests");
  fs.writeFileSync(path.join(root, "README.md"), "test repository\n", { mode: 0o600 });
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  return fs.realpathSync(root);
};

const writeKiroWrapper = (dir: string): string => {
  const wrapper = path.join(dir, "fake-kiro");
  fs.writeFileSync(
    wrapper,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeKiroWorker)} "$@"\n`,
    { mode: 0o755 },
  );
  fs.chmodSync(wrapper, 0o755);
  return wrapper;
};

const installFakeKiro = async (projectRoot: string, wrapper: string): Promise<void> => {
  const mcpEntryPath = path.join(projectRoot, "dummy-mcp.js");
  fs.writeFileSync(mcpEntryPath, "export {};\n", { mode: 0o600 });
  await installKiroProfile({ projectRoot, kiroBinary: wrapper, mcpEntryPath });
};

const readLogEntries = (logFile: string): Array<Record<string, unknown>> => {
  if (!fs.existsSync(logFile)) return [];
  const content = fs.readFileSync(logFile, "utf8").trim();
  if (!content) return [];
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const inboundMethods = (logFile: string): string[] =>
  readLogEntries(logFile)
    .filter((entry) => entry.event === "inbound")
    .map((entry) => (entry.frame as { method?: string } | undefined)?.method)
    .filter((method): method is string => typeof method === "string");

const actorRegistryEntry = (
  actorRoot: string,
  actorId: string,
): { id: string; runnerSessionId?: string; lastRunId?: string; kiroAgentEngine?: string } | undefined => {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(actorRoot, "actors.json"), "utf8")) as {
      actors: Array<{
        id: string;
        runnerSessionId?: string;
        lastRunId?: string;
        kiroAgentEngine?: string;
      }>;
    };
    return registry.actors.find((entry) => entry.id === actorId);
  } catch {
    return undefined;
  }
};

const retainedRunnerSessionId = (actorRoot: string, actorId: string, runId?: string): string | undefined => {
  if (!runId) return undefined;
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(actorRoot, actorId, "runs", runId, "status.json"), "utf8"),
    ) as { runnerSessionId?: string };
    return typeof record.runnerSessionId === "string" ? record.runnerSessionId : undefined;
  } catch {
    return undefined;
  }
};

const runFinished = (actorRoot: string, actorId: string, runId?: string): boolean => {
  if (!runId) return false;
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(actorRoot, actorId, "runs", runId, "status.json"), "utf8"),
    ) as { finishedAt?: unknown };
    return typeof record.finishedAt === "number";
  } catch {
    return false;
  }
};

const mainTarget = (
  identity: MeshIdentity,
  deliveries: FabricMainAgentDeliveryRequest[],
): FabricMainAgentTarget => ({
  id: identity.id,
  local: true,
  matches: (id) => id === "main" || id === identity.id,
  info: () => {
    throw new Error("not used by durable actor tests");
  },
  deliverAgent: (request) => {
    deliveries.push(request);
    return { queued: true, messageId: `main-${++sequence}`, routed: "main" };
  },
});

interface TestHarness {
  projectRoot: string;
  wrapper: string;
  mesh: MeshStore;
  identity: MeshIdentity;
  participants: ParticipantDirectory;
  deliveries: FabricMainAgentDeliveryRequest[];
  mainAgent: FabricMainAgentTarget;
  config: ResidentHostConfig;
}

const createHarness = async (name: string): Promise<TestHarness> => {
  const projectRoot = initGitRepository(`kiro-fabric-durable-${name}-`);
  const wrapper = writeKiroWrapper(projectRoot);
  await installFakeKiro(projectRoot, wrapper);
  const meshRoot = path.join(projectRoot, "mesh");
  const meshConfig = { ...DEFAULT_FABRIC_CONFIG.mesh, actorPollMs: 20 };
  const mesh = new MeshStore(meshRoot, meshConfig.maxEventBytes, meshConfig.maxReadEvents);
  const identity: MeshIdentity = {
    id: `session:${name}:${++sequence}`,
    name: "main",
    kind: "main",
    sessionId: name,
  };
  const participants = new ParticipantDirectory(mesh, {
    enabled: true,
    hostId: identity.id,
    rootId: identity.id,
    identity,
    heartbeatMs: 50,
    leaseMs: 300,
  });
  participants.registerSource(() => [{
    format: 1,
    id: identity.id,
    kind: "root",
    rootId: identity.id,
    ownerHostId: identity.id,
    ownerIdentityId: identity.id,
    name: "main",
    status: "idle",
    residency: "session",
    runner: "pi",
    transport: "host",
    capabilities: ["steer", "followUp", "fabric"],
    cwd: repoRoot,
    sessionId: name,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    controlProtocol: "v1",
  }]);
  await participants.start();
  const deliveries: FabricMainAgentDeliveryRequest[] = [];
  return {
    projectRoot,
    wrapper,
    mesh,
    identity,
    participants,
    deliveries,
    mainAgent: mainTarget(identity, deliveries),
    config: {
      format: RESIDENT_HOST_FORMAT,
      rootId: identity.id,
      sessionId: name,
      cwd: projectRoot,
      projectRoot,
      meshRoot,
      actorRoot: path.join(meshRoot, "actors"),
      residencyRoot: residentRoot(meshRoot, identity.id),
      fullCodeMode: false,
      agents: { ...DEFAULT_FABRIC_CONFIG.agents, timeoutMs: 6_000 },
      mesh: meshConfig,
      retention: DEFAULT_FABRIC_CONFIG.retention,
      workerPath: kiroWorker,
      fabricExtensionPath: distExtension,
      piBinary: "pi",
      claudeBinary: "claude",
      vedaBinary: "veda",
      kiroBinary: wrapper,
    },
  };
};

afterEach(async () => {
  delete process.env.FAKE_KIRO_WORKER_SCENARIO;
  delete process.env.FAKE_KIRO_WORKER_LOG;
  delete process.env.KIRO_FABRIC_KIRO_IDLE_MS;
  for (const root of roots.splice(0)) {
    makeTreeRemovable(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("durable kiro actor crash/restart rehearsal", () => {
  it("persists runnerSessionId and resumes via session/load after a host restart", { timeout: 20_000 }, async () => {
    const harness = await createHarness("resume-session");
    const firstLog = path.join(harness.projectRoot, "resident-first.log");
    const secondLog = path.join(harness.projectRoot, "resident-second.log");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.FAKE_KIRO_WORKER_LOG = firstLog;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";

    const firstHost = new ResidentHost(harness.config);
    await firstHost.start();
    try {
      const actor = await firstHost.actors.create({
        name: "resident kiro",
        instructions: "Reply with the prompt count.",
        residency: "durable",
        runner: "kiro",
        delivery: "mailbox",
      });
      const firstReply = await firstHost.actors.ask(actor.id, "first durable turn");
      expect(firstReply.text).toContain("prompt 1:");
      expect(firstReply.text).toContain("first durable turn");
      await waitFor(() => firstHost.actors.status(actor.id).status === "idle");
      await waitFor(() => typeof actorRegistryEntry(harness.config.actorRoot, actor.id)?.lastRunId === "string");

      const persistedSessionId = retainedRunnerSessionId(
        harness.config.actorRoot,
        actor.id,
        actorRegistryEntry(harness.config.actorRoot, actor.id)?.lastRunId,
      );
      expect(persistedSessionId).toMatch(/^fake-acp-session-/);
      expect(actorRegistryEntry(harness.config.actorRoot, actor.id)?.kiroAgentEngine).toBe("v3");

      await firstHost.close();
      process.env.FAKE_KIRO_WORKER_SCENARIO = "resident-load";
      process.env.FAKE_KIRO_WORKER_LOG = secondLog;

      const restartedHost = new ResidentHost(harness.config);
      await restartedHost.start();
      try {
        const resumedReply = await restartedHost.actors.ask(actor.id, "second durable turn");
        expect(resumedReply.text).toContain("prompt 1:");
        expect(resumedReply.text).toContain("second durable turn");
        expect(inboundMethods(secondLog).slice(0, 6)).toEqual([
          "initialize",
          "session/load",
          "session/set_mode",
          "session/set_config_option",
          "session/set_config_option",
          "session/prompt",
        ]);
        expect(retainedRunnerSessionId(
          harness.config.actorRoot,
          actor.id,
          actorRegistryEntry(harness.config.actorRoot, actor.id)?.lastRunId,
        )).toBe(persistedSessionId);
      } finally {
        await restartedHost.close();
      }
    } finally {
      await harness.participants.close();
    }
  });

  it("delivers a pre-crash resident delivery exactly once after a drain restart", { timeout: 20_000 }, async () => {
    const harness = await createHarness("delivery-dedupe");
    const logFile = path.join(harness.projectRoot, "resident-delivery.log");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.FAKE_KIRO_WORKER_LOG = logFile;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";

    const host = new ResidentHost(harness.config);
    await host.start();
    const prefix = residentDeliveryPrefix(harness.config.rootId);
    try {
      const actor = await host.actors.create({
        name: "resident notifier",
        instructions: "Always answer with a follow-up.",
        residency: "durable",
        runner: "kiro",
        delivery: "followUp",
        triggerTurn: false,
      });
      const reply = await host.actors.ask(actor.id, "deliver once");
      expect(reply.text).toContain("prompt 1:");
      expect(reply.text).toContain("deliver once");
      await waitFor(() => harness.mesh.listAll(prefix).length === 1);

      const originalDelete = harness.mesh.delete.bind(harness.mesh);
      harness.mesh.delete = (async (input) => {
        if (input.key.startsWith(prefix)) {
          throw new Error("simulated crash after delivery effect");
        }
        return originalDelete(input);
      }) as typeof harness.mesh.delete;

      const firstClient = new ResidencyClient({
        config: harness.config,
        mesh: harness.mesh,
        participants: harness.participants,
        mainAgent: harness.mainAgent,
      });
      firstClient.start();
      await waitFor(() => harness.deliveries.length === 1);
      expect(harness.deliveries[0]).toMatchObject({
        from: { id: actor.id, kind: "actor" },
        delivery: "followUp",
        triggerTurn: false,
      });
      expect(harness.deliveries[0]?.message).toContain("prompt 1:");
      expect(harness.deliveries[0]?.message).toContain("deliver once");
      expect(harness.mesh.listAll(prefix)).toHaveLength(1);
      await firstClient.close();
      harness.mesh.delete = originalDelete;

      const restartedClient = new ResidencyClient({
        config: harness.config,
        mesh: harness.mesh,
        participants: harness.participants,
        mainAgent: harness.mainAgent,
      });
      restartedClient.start();
      try {
        await waitFor(() => harness.mesh.listAll(prefix).length === 0);
        await delay(150);
        expect(harness.deliveries).toHaveLength(1);
        expect(harness.deliveries.filter((delivery) => delivery.from.id === actor.id)).toHaveLength(1);
      } finally {
        await restartedClient.close();
      }
    } finally {
      await host.close();
      await harness.participants.close();
    }
  });

  it("retries a durable outbox on the same host without rerunning the actor after delivery-store failure", { timeout: 20_000 }, async () => {
    const harness = await createHarness("delivery-put-retry");
    const logFile = path.join(harness.projectRoot, "delivery-put-retry.log");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.FAKE_KIRO_WORKER_LOG = logFile;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";

    const host = new ResidentHost(harness.config);
    await host.start();
    const prefix = residentDeliveryPrefix(harness.config.rootId);
    const inboxPath = path.join(
      harness.config.residencyRoot,
      "actor-mesh-cursor.json.inbox",
    );
    const originalPut = host.mesh.put.bind(host.mesh);
    let rejectedPuts = 0;
    host.mesh.put = (async (input) => {
      if (input.key.startsWith(prefix)) {
        rejectedPuts++;
        throw new Error("simulated delivery store outage");
      }
      return originalPut(input);
    }) as typeof host.mesh.put;
    try {
      const actor = await host.actors.create({
        name: "resident retry notifier",
        instructions: "Always answer with a follow-up.",
        residency: "durable",
        runner: "kiro",
        delivery: "followUp",
        triggerTurn: false,
      });
      await harness.mesh.publish({
        topic: "test.delivery",
        kind: "message",
        from: harness.identity,
        to: actor.id,
        text: "persist before settle",
      });
      await waitFor(() => rejectedPuts >= 5 && fs.existsSync(inboxPath));
      const inbox = JSON.parse(fs.readFileSync(inboxPath, "utf8")) as {
        entries: Array<{
          status: string;
          outbox?: { message?: { id?: string; text?: string; activationId?: string } };
        }>;
      };
      const pending = inbox.entries.find((entry) => entry.status === "pending" && entry.outbox);
      expect(pending?.outbox?.message).toMatchObject({
        id: expect.any(String),
        activationId: expect.any(String),
        text: expect.stringContaining("persist before settle"),
      });
      expect(inboundMethods(logFile).filter((method) => method === "session/prompt")).toHaveLength(1);

      await harness.mesh.publish({
        topic: "test.delivery",
        kind: "message",
        from: harness.identity,
        to: actor.id,
        text: "deliver after the persisted activation",
      });
      await waitFor(() => {
        const durableInbox = JSON.parse(fs.readFileSync(inboxPath, "utf8")) as {
          entries?: unknown[];
        };
        return durableInbox.entries?.length === 2;
      });

      let ambiguousCommit = true;
      const deliveredMessages: string[] = [];
      host.mesh.put = (async (input) => {
        if (input.key.startsWith(prefix)) {
          deliveredMessages.push((input.value as { message?: string }).message ?? "");
          if (ambiguousCommit) {
            ambiguousCommit = false;
            await originalPut(input);
            throw new Error("simulated ambiguous store acknowledgement");
          }
        }
        return originalPut(input);
      }) as typeof host.mesh.put;
      await waitFor(() => harness.mesh.listAll(prefix).length === 2);
      const delivery = harness.mesh
        .listAll(prefix)
        .find((entry) => (entry.value as { id?: string }).id === pending?.outbox?.message?.id);
      expect((delivery?.value as { id?: string }).id).toBe(pending?.outbox?.message?.id);
      expect(deliveredMessages[0]).toContain("persist before settle");
      expect(deliveredMessages.at(-1)).toContain("deliver after the persisted activation");
      await delay(200);
      expect(inboundMethods(logFile).filter((method) => method === "session/prompt")).toHaveLength(2);
    } finally {
      host.mesh.put = originalPut;
      await host.close();
      await harness.participants.close();
    }
  });

  it("rejects a stale lower-epoch durable owner and resumes on the current owner", { timeout: 20_000 }, async () => {
    const harness = await createHarness("stale-epoch");
    const firstLog = path.join(harness.projectRoot, "stale-first.log");
    const secondLog = path.join(harness.projectRoot, "stale-second.log");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.FAKE_KIRO_WORKER_LOG = firstLog;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";

    const firstHost = new ResidentHost(harness.config);
    await firstHost.start();
    const requester = new FabricControlPlane(harness.mesh, harness.identity, {
      enabled: true,
      hostId: harness.identity.id,
      pollMs: 20,
      acknowledgementTimeoutMs: 3_000,
    });
    requester.start(() => ({ accepted: false }));
    try {
      const actor = await firstHost.actors.create({
        name: "epoch fenced kiro",
        instructions: "Resume only on the latest owner.",
        residency: "durable",
        runner: "kiro",
        delivery: "mailbox",
      });
      const firstReply = await firstHost.actors.ask(actor.id, "epoch one");
      expect(firstReply.text).toContain("prompt 1:");
      expect(firstReply.text).toContain("epoch one");
      await waitFor(() => firstHost.actors.status(actor.id).status === "idle");
      await waitFor(() => typeof actorRegistryEntry(harness.config.actorRoot, actor.id)?.lastRunId === "string");
      const firstRunId = actorRegistryEntry(harness.config.actorRoot, actor.id)?.lastRunId;
      const persistedSessionId = retainedRunnerSessionId(
        harness.config.actorRoot,
        actor.id,
        firstRunId,
      );
      expect(persistedSessionId).toMatch(/^fake-acp-session-/);
      // Actor status becomes idle when the turn finishes; wait separately for
      // the resident worker to reap its ACP transport and release the run lease.
      await waitFor(() => runFinished(harness.config.actorRoot, actor.id, firstRunId));

      const ownerClaimKey = residentOwnerClaimKey(harness.config.rootId);
      const currentClaim = harness.mesh.get(ownerClaimKey);
      const currentOwner = currentClaim?.value as { epoch?: number } | undefined;
      const staleEpoch = Number(currentOwner?.epoch ?? 0);
      await harness.mesh.put({
        key: ownerClaimKey,
        value: {
          ...(currentClaim?.value as Record<string, unknown>),
          token: "superseding-test-owner",
          epoch: staleEpoch + 1,
          startedAt: Date.now(),
          readyAt: Date.now(),
          pid: process.pid,
        },
        identity: { id: residentHostId(harness.config.rootId), name: "superseding host", kind: "agent" },
        ifVersion: currentClaim?.version ?? 0,
      });

      await expect(
        requester.requestResult(
          residentHostId(harness.config.rootId),
          actor.id,
          "ask",
          { message: "must be rejected as stale" },
          residentHostId(harness.config.rootId),
          { timeoutMs: 3_000 },
        ),
      ).rejects.toThrow(/stale-worker/);

      await firstHost.close().catch(() => undefined);
      fs.rmSync(path.join(harness.config.residencyRoot, "owner.json"), { force: true });
      fs.rmSync(path.join(harness.config.residencyRoot, "host.lock"), { force: true });
      process.env.FAKE_KIRO_WORKER_SCENARIO = "resident-load";
      process.env.FAKE_KIRO_WORKER_LOG = secondLog;
      // Recovery starts the resident worker before the remote command arrives;
      // allow for the durable mesh publication path during that handoff.
      process.env.KIRO_FABRIC_KIRO_IDLE_MS = "3000";

      const restartedHost = new ResidentHost(harness.config);
      await restartedHost.start();
      // start() publishes ownership before every durable actor transport has
      // completed restoration; do not race the first remote delivery with it.
      await delay(500);
      try {
        const resumed = await requester.requestResult<{ id: string; text: string }>(
          residentHostId(harness.config.rootId),
          actor.id,
          "ask",
          { message: "epoch current" },
          residentHostId(harness.config.rootId),
          { timeoutMs: 6_000 },
        );
        expect(resumed.text).toContain("prompt 1:");
        expect(resumed.text).toContain("epoch current");
        expect(inboundMethods(secondLog).slice(0, 6)).toEqual([
          "initialize",
          "session/load",
          "session/set_mode",
          "session/set_config_option",
          "session/set_config_option",
          "session/prompt",
        ]);
      } finally {
        await restartedHost.close();
      }
    } finally {
      await requester.close();
      await harness.participants.close();
    }
  });
});
