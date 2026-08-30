import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { installKiroProfile } from "../src/kiro/install-test-helper.js";
import type { FabricMainAgentDeliveryRequest, FabricMainAgentTarget } from "../src/main-agent.js";
import { MeshStore, type MeshIdentity, type MeshStateEntry } from "../src/mesh/store.js";
import { ResidencyClient } from "../src/residency/client.js";
import { ResidentHost } from "../src/residency/host.js";
import {
  RESIDENT_HOST_FORMAT,
  RESIDENT_STATE_VERSION,
  residentDeliveryPayloadDigest,
  residentDeliveryPrefix,
  residentHostId,
  residentRoot,
  type ResidentDeliveryRecord,
  type ResidentHostConfig,
} from "../src/residency/protocol.js";
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
    if (Date.now() >= deadline) throw new Error("Timed out waiting for reliable mailbox state");
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

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

const clientStateKey = (rootId: string): string => {
  const rootDigest = digest(rootId);
  return `residency/clients/${rootDigest}/${residentHostId(rootId)}`;
};

const claimKey = (rootId: string, record: ResidentDeliveryRecord): string => {
  const rootDigest = digest(rootId);
  const payloadDigest = record.payloadDigest ?? residentDeliveryPayloadDigest(record.delivery, record.message);
  const idempotencyKey = `${record.id}:${payloadDigest}`;
  return `residency/delivery-claims/${rootDigest}/${digest(idempotencyKey).slice(0, 40)}`;
};

const mainTarget = (
  identity: MeshIdentity,
  deliveries: FabricMainAgentDeliveryRequest[],
): FabricMainAgentTarget => ({
  id: identity.id,
  local: true,
  matches: (id) => id === "main" || id === identity.id,
  info: () => {
    throw new Error("not used by reliability mailbox tests");
  },
  deliverAgent: (request) => {
    deliveries.push(structuredClone(request));
    return { queued: true, messageId: `main-${++sequence}`, routed: "main" };
  },
});

interface TestHarness {
  projectRoot: string;
  mesh: MeshStore;
  identity: MeshIdentity;
  participants: ParticipantDirectory;
  deliveries: FabricMainAgentDeliveryRequest[];
  mainAgent: FabricMainAgentTarget;
  config: ResidentHostConfig;
}

const createHarness = async (name: string): Promise<TestHarness> => {
  const projectRoot = initGitRepository(`kiro-fabric-reliable-mailbox-${name}-`);
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

const residentEntries = (mesh: MeshStore, rootId: string): MeshStateEntry[] =>
  mesh.listAll(residentDeliveryPrefix(rootId));

const findDeliveries = (deliveries: readonly FabricMainAgentDeliveryRequest[], actorId: string, needle: string) =>
  deliveries.filter((delivery) => delivery.from.id === actorId && delivery.message.includes(needle));

const captureSingleDelivery = async (
  mesh: MeshStore,
  rootId: string,
  expectedCount: number,
  needle: string,
): Promise<{ key: string; record: ResidentDeliveryRecord }> => {
  await waitFor(() => residentEntries(mesh, rootId).length === expectedCount);
  const entry = residentEntries(mesh, rootId).find((candidate) =>
    String((candidate.value as ResidentDeliveryRecord).message).includes(needle)
  );
  if (!entry) throw new Error(`Missing resident delivery entry for ${needle}`);
  return { key: entry.key, record: structuredClone(entry.value as ResidentDeliveryRecord) };
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

describe("reliability no duplicate mailbox", () => {
  it("dedupes a claimed-but-unacked resident delivery across durable owner restarts", { timeout: 20_000 }, async () => {
    const harness = await createHarness("claim-restart");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";

    const firstHost = new ResidentHost(harness.config);
    await firstHost.start();
    const actor = await firstHost.actors.create({
      name: "resident mailbox actor",
      instructions: "Reply with the prompt count.",
      residency: "durable",
      runner: "kiro",
      delivery: "followUp",
      triggerTurn: false,
    });
    await firstHost.actors.ask(actor.id, "warm restart");
    await waitFor(() => residentEntries(harness.mesh, harness.config.rootId).length === 1);
    await firstHost.close();

    const restartedHost = new ResidentHost(harness.config);
    await restartedHost.start();
    await waitFor(() => restartedHost.actors.status(actor.id).status === "idle");
    await restartedHost.actors.ask(actor.id, "claimed-but-unacked");
    const pending = await captureSingleDelivery(harness.mesh, harness.config.rootId, 2, "claimed-but-unacked");

    const originalDelete = harness.mesh.delete.bind(harness.mesh);
    harness.mesh.delete = (async (input) => {
      if (input.key === pending.key) throw new Error("simulated crash before ack");
      return originalDelete(input);
    }) as typeof harness.mesh.delete;

    const crashingClient = new ResidencyClient({
      config: harness.config,
      mesh: harness.mesh,
      participants: harness.participants,
      mainAgent: harness.mainAgent,
    });
    crashingClient.start();
    await waitFor(() => findDeliveries(harness.deliveries, actor.id, "claimed-but-unacked").length === 1);
    const effectKey = claimKey(harness.config.rootId, pending.record);
    expect(harness.mesh.get(effectKey)).toBeDefined();
    expect(residentEntries(harness.mesh, harness.config.rootId).some((entry) => entry.key === pending.key)).toBe(true);
    const idempotencyKey = `${pending.record.id}:${pending.record.payloadDigest ?? residentDeliveryPayloadDigest(pending.record.delivery, pending.record.message)}`;
    await waitFor(() => {
      const value = harness.mesh.get(clientStateKey(harness.config.rootId))?.value as
        | { deliveredKeys?: Record<string, number> }
        | undefined;
      return typeof value?.deliveredKeys?.[idempotencyKey] === "number";
    });
    // Simulate retention/repair removing the terminal effect while the source
    // delete is still pending. Persisted deliveredKeys must remain sufficient
    // to suppress replay.
    const effect = harness.mesh.get(effectKey)!;
    await originalDelete({ key: effectKey, ifVersion: effect.version });
    await crashingClient.close();
    harness.mesh.delete = originalDelete;

    const recoveryClient = new ResidencyClient({
      config: harness.config,
      mesh: harness.mesh,
      participants: harness.participants,
      mainAgent: harness.mainAgent,
    });
    recoveryClient.start();
    try {
      await waitFor(() => !residentEntries(harness.mesh, harness.config.rootId).some((entry) => entry.key === pending.key));
      await delay(100);
      const matches = findDeliveries(harness.deliveries, actor.id, "claimed-but-unacked");
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        from: { id: actor.id, kind: "actor" },
        delivery: "followUp",
        triggerTurn: false,
      });
    } finally {
      await recoveryClient.close();
      await restartedHost.close();
      await harness.participants.close();
    }
  });

  it("does not steal a live pending delivery after the old one-second window", { timeout: 20_000 }, async () => {
    const harness = await createHarness("live-pending-lease");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";
    const host = new ResidentHost(harness.config);
    await host.start();
    const actor = await host.actors.create({
      name: "resident lease actor",
      instructions: "Reply once.",
      residency: "durable",
      runner: "kiro",
      delivery: "followUp",
      triggerTurn: false,
    });
    await host.actors.ask(actor.id, "live-pending-lease");
    const pending = await captureSingleDelivery(
      harness.mesh,
      harness.config.rootId,
      1,
      "live-pending-lease",
    );
    const payloadDigest = pending.record.payloadDigest ?? residentDeliveryPayloadDigest(
      pending.record.delivery,
      pending.record.message,
    );
    const idempotencyKey = `${pending.record.id}:${payloadDigest}`;
    await harness.mesh.put({
      key: claimKey(harness.config.rootId, pending.record),
      value: {
        stateVersion: RESIDENT_STATE_VERSION,
        hostId: residentHostId(harness.config.rootId),
        ownerEpoch: pending.record.epoch,
        idempotencyKey,
        sourceKey: pending.key,
        status: "pending",
        attemptId: "other-live-client",
        attemptPid: process.pid,
        updatedAt: Date.now() - 60_000,
      },
      identity: { id: residentHostId(harness.config.rootId), name: "live claim", kind: "agent" },
      ifVersion: 0,
    });
    const client = new ResidencyClient({
      config: harness.config,
      mesh: harness.mesh,
      participants: harness.participants,
      mainAgent: harness.mainAgent,
    });
    client.start();
    try {
      await delay(1_300);
      expect(findDeliveries(harness.deliveries, actor.id, "live-pending-lease"))
        .toHaveLength(0);
      expect(harness.mesh.get(pending.key)).toBeDefined();
    } finally {
      await client.close();
      await host.close();
      await harness.participants.close();
    }
  });

  it("retries a pending claim when local delivery throws", { timeout: 20_000 }, async () => {
    const harness = await createHarness("delivery-throws");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";
    const host = new ResidentHost(harness.config);
    await host.start();
    const actor = await host.actors.create({
      name: "resident retry actor",
      instructions: "Reply once.",
      residency: "durable",
      runner: "kiro",
      delivery: "followUp",
      triggerTurn: false,
    });
    await host.actors.ask(actor.id, "retry-after-throw");
    const pending = await captureSingleDelivery(
      harness.mesh,
      harness.config.rootId,
      1,
      "retry-after-throw",
    );
    let throwOnce = true;
    const retryingTarget: FabricMainAgentTarget = {
      ...harness.mainAgent,
      deliverAgent(request) {
        if (throwOnce) {
          throwOnce = false;
          throw new Error("simulated local delivery failure");
        }
        return harness.mainAgent.deliverAgent(request);
      },
    };
    const client = new ResidencyClient({
      config: harness.config,
      mesh: harness.mesh,
      participants: harness.participants,
      mainAgent: retryingTarget,
    });
    client.start();
    try {
      await waitFor(() => findDeliveries(
        harness.deliveries,
        actor.id,
        "retry-after-throw",
      ).length === 1);
      await waitFor(() => harness.mesh.get(pending.key) === undefined);
      expect(harness.mesh.get(claimKey(harness.config.rootId, pending.record))?.value)
        .toMatchObject({ status: "acknowledged" });
    } finally {
      await client.close();
      await host.close();
      await harness.participants.close();
    }
  });

  it("dedupes a replayed resident delivery when the persisted consumer cursor lags", { timeout: 20_000 }, async () => {
    const harness = await createHarness("cursor-replay");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";

    const firstHost = new ResidentHost(harness.config);
    await firstHost.start();
    const actor = await firstHost.actors.create({
      name: "resident replay actor",
      instructions: "Reply with the prompt count.",
      residency: "durable",
      runner: "kiro",
      delivery: "followUp",
      triggerTurn: false,
    });
    await firstHost.actors.ask(actor.id, "warm restart");
    await waitFor(() => residentEntries(harness.mesh, harness.config.rootId).length === 1);
    await firstHost.close();

    const restartedHost = new ResidentHost(harness.config);
    await restartedHost.start();
    await waitFor(() => restartedHost.actors.status(actor.id).status === "idle");
    await restartedHost.actors.ask(actor.id, "cursor-lag");
    const pending = await captureSingleDelivery(harness.mesh, harness.config.rootId, 2, "cursor-lag");

    const firstClient = new ResidencyClient({
      config: harness.config,
      mesh: harness.mesh,
      participants: harness.participants,
      mainAgent: harness.mainAgent,
    });
    firstClient.start();
    await waitFor(() => !residentEntries(harness.mesh, harness.config.rootId).some((entry) => entry.key === pending.key));
    await waitFor(() => findDeliveries(harness.deliveries, actor.id, "cursor-lag").length === 1);
    await firstClient.close();

    const stateEntry = harness.mesh.get(clientStateKey(harness.config.rootId));
    expect(stateEntry?.value).toMatchObject({
      stateVersion: RESIDENT_STATE_VERSION,
      deliveredKeys: expect.any(Object),
    });
    await harness.mesh.put({
      key: clientStateKey(harness.config.rootId),
      value: {
        ...(stateEntry?.value as object),
        cursor: { updatedAt: 0, version: 0, key: "" },
      },
      identity: { id: residentHostId(harness.config.rootId), name: "rewind", kind: "agent" },
      ifVersion: stateEntry?.version ?? 0,
    });
    await harness.mesh.put({
      key: `${residentDeliveryPrefix(harness.config.rootId)}replayed-${pending.record.id}`,
      value: pending.record,
      identity: { id: residentHostId(harness.config.rootId), name: "replay", kind: "agent" },
      ifVersion: 0,
    });

    const replayClient = new ResidencyClient({
      config: harness.config,
      mesh: harness.mesh,
      participants: harness.participants,
      mainAgent: harness.mainAgent,
    });
    replayClient.start();
    try {
      await waitFor(() => residentEntries(harness.mesh, harness.config.rootId).every((entry) => entry.key !== `${residentDeliveryPrefix(harness.config.rootId)}replayed-${pending.record.id}`));
      await delay(100);
      const matches = findDeliveries(harness.deliveries, actor.id, "cursor-lag");
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        from: { id: actor.id, kind: "actor" },
        delivery: "followUp",
        triggerTurn: false,
      });
    } finally {
      await replayClient.close();
      await restartedHost.close();
      await harness.participants.close();
    }
  });
});
