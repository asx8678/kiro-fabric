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
  RESIDENT_STATE_VERSION,
  residentDeliveryPrefix,
  residentHostId,
  residentOwnerClaimKey,
  residentRoot,
  type ResidentCommandResponse,
  type ResidentDeliveryRecord,
  type ResidentHostConfig,
} from "../src/residency/protocol.js";
import { installKiroProfile } from "../src/kiro/install.js";
import { ParticipantDirectory } from "../src/topology/participant-directory.js";

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
    if (Date.now() >= deadline) throw new Error("Timed out waiting for crash rehearsal state");
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
): { id: string; name?: string; lastRunId?: string } | undefined => {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(actorRoot, "actors.json"), "utf8")) as {
      actors: Array<{ id: string; name?: string; lastRunId?: string }>;
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

const mainTarget = (
  identity: MeshIdentity,
  deliveries: FabricMainAgentDeliveryRequest[],
): FabricMainAgentTarget => ({
  id: identity.id,
  local: true,
  matches: (id) => id === "main" || id === identity.id,
  info: () => {
    throw new Error("not used by crash rehearsal tests");
  },
  deliverAgent: (request) => {
    deliveries.push(request);
    return { queued: true, messageId: `main-${++sequence}`, routed: "main" };
  },
});

interface CrashHarness {
  projectRoot: string;
  mesh: MeshStore;
  identity: MeshIdentity;
  participants: ParticipantDirectory;
  deliveries: FabricMainAgentDeliveryRequest[];
  mainAgent: FabricMainAgentTarget;
  config: ResidentHostConfig;
}

const createHarness = async (name: string): Promise<CrashHarness> => {
  const projectRoot = initGitRepository(`kiro-fabric-crash-single-owner-${name}-`);
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

const ownerEpoch = (harness: CrashHarness): number => {
  const claim = harness.mesh.get(residentOwnerClaimKey(harness.config.rootId));
  const value = claim?.value as { epoch?: number } | undefined;
  expect(typeof value?.epoch).toBe("number");
  return Number(value?.epoch);
};

const simulateHardCrash = (config: ResidentHostConfig): void => {
  fs.rmSync(path.join(config.residencyRoot, "owner.json"), { force: true });
  fs.rmSync(path.join(config.residencyRoot, "host.lock"), { force: true });
};

const waitForResponse = async (
  responsePath: string,
): Promise<ResidentCommandResponse> => {
  await waitFor(() => fs.existsSync(responsePath));
  return JSON.parse(fs.readFileSync(responsePath, "utf8")) as ResidentCommandResponse;
};

afterEach(async () => {
  delete process.env.FAKE_KIRO_WORKER_SCENARIO;
  delete process.env.FAKE_KIRO_WORKER_LOG;
  delete process.env.KIRO_FABRIC_KIRO_IDLE_MS;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("reliability single-owner crash rehearsal", () => {
  it("restores one fenced durable owner after a hard crash before any delegation", { timeout: 20_000 }, async () => {
    const harness = await createHarness("before-delegation");
    const firstLog = path.join(harness.projectRoot, "before-delegation-first.log");
    const secondLog = path.join(harness.projectRoot, "before-delegation-second.log");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.FAKE_KIRO_WORKER_LOG = firstLog;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";

    const firstHost = new ResidentHost(harness.config);
    let restartedHost: ResidentHost | undefined;
    try {
      await firstHost.start();
      const actor = await firstHost.actors.create({
        name: "single owner mailbox",
        instructions: "Resume only on the latest durable owner.",
        residency: "durable",
        runner: "kiro",
        delivery: "mailbox",
      });
      const firstReply = await firstHost.actors.ask(actor.id, "before crash");
      expect(firstReply.text).toContain("before crash");
      expect(harness.deliveries).toHaveLength(0);
      await waitFor(() => firstHost.actors.status(actor.id).status === "idle");
      await waitFor(() => typeof actorRegistryEntry(harness.config.actorRoot, actor.id)?.lastRunId === "string");
      const persistedSessionId = retainedRunnerSessionId(
        harness.config.actorRoot,
        actor.id,
        actorRegistryEntry(harness.config.actorRoot, actor.id)?.lastRunId,
      );
      expect(persistedSessionId).toMatch(/^fake-acp-session-/);
      const staleEpoch = ownerEpoch(harness);

      simulateHardCrash(harness.config);
      await firstHost.close().catch(() => undefined);
      process.env.FAKE_KIRO_WORKER_SCENARIO = "resident-load";
      process.env.FAKE_KIRO_WORKER_LOG = secondLog;

      restartedHost = new ResidentHost(harness.config);
      await restartedHost.start();
      await waitFor(() => ownerEpoch(harness) > staleEpoch);
      expect(restartedHost.actors.owns(actor.id)).toBe(true);

      const resumedReply = await restartedHost.actors.ask(actor.id, "after restart");
      expect(resumedReply.text).toContain("after restart");
      expect(inboundMethods(secondLog).slice(0, 6)).toEqual([
        "initialize",
        "session/load",
        "session/set_mode",
        "session/set_config_option",
        "session/set_config_option",
        "session/prompt",
      ]);

      const requestId = `stale-remove-${++sequence}`;
      const requestPath = path.join(harness.config.residencyRoot, "requests", `${requestId}.json`);
      const responsePath = path.join(harness.config.residencyRoot, "responses", `${requestId}.json`);
      fs.writeFileSync(requestPath, JSON.stringify({
        format: RESIDENT_HOST_FORMAT,
        stateVersion: RESIDENT_STATE_VERSION,
        epoch: staleEpoch,
        operation: "removeActor",
        requestId,
        rootId: harness.config.rootId,
        id: actor.id,
        createdAt: Date.now(),
      }, null, 2));
      const response = await waitForResponse(responsePath);
      expect(response.ok).toBe(false);
      expect(response.error).toMatch(/stale-worker/);
      expect(restartedHost.actors.owns(actor.id)).toBe(true);
    } finally {
      await restartedHost?.close().catch(() => undefined);
      await firstHost.close().catch(() => undefined);
      await harness.participants.close();
    }
  });

  it("keeps exactly one durable owner after a hard crash that follows delegated deliveries", { timeout: 20_000 }, async () => {
    const harness = await createHarness("after-deliveries");
    const firstLog = path.join(harness.projectRoot, "after-deliveries-first.log");
    const secondLog = path.join(harness.projectRoot, "after-deliveries-second.log");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.FAKE_KIRO_WORKER_LOG = firstLog;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";

    const firstHost = new ResidentHost(harness.config);
    let restartedHost: ResidentHost | undefined;
    let restartedClient: ResidencyClient | undefined;
    const firstClient = new ResidencyClient({
      config: harness.config,
      mesh: harness.mesh,
      participants: harness.participants,
      mainAgent: harness.mainAgent,
    });
    try {
      await firstHost.start();
      firstClient.start();
      const actor = await firstHost.actors.create({
        name: "single owner follow-up",
        instructions: "Always answer with a follow-up.",
        residency: "durable",
        runner: "kiro",
        delivery: "followUp",
        triggerTurn: false,
      });
      await firstHost.actors.ask(actor.id, "delivery one");
      await firstHost.actors.ask(actor.id, "delivery two");
      await waitFor(() => harness.deliveries.length === 2);
      expect(harness.deliveries.map((delivery) => delivery.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("delivery one"),
          expect.stringContaining("delivery two"),
        ]),
      );
      const staleEpoch = ownerEpoch(harness);

      await firstClient.close();
      simulateHardCrash(harness.config);
      await firstHost.close().catch(() => undefined);
      process.env.FAKE_KIRO_WORKER_SCENARIO = "resident-load";
      process.env.FAKE_KIRO_WORKER_LOG = secondLog;

      restartedHost = new ResidentHost(harness.config);
      await restartedHost.start();
      await waitFor(() => ownerEpoch(harness) > staleEpoch);
      expect(restartedHost.actors.owns(actor.id)).toBe(true);

      const staleDeliveryKey = `${residentDeliveryPrefix(harness.config.rootId)}stale-${++sequence}`;
      const actorEntry = actorRegistryEntry(harness.config.actorRoot, actor.id);
      const staleDelivery: ResidentDeliveryRecord = {
        format: RESIDENT_HOST_FORMAT,
        stateVersion: RESIDENT_STATE_VERSION,
        id: `stale-${sequence}`,
        rootId: harness.config.rootId,
        from: {
          id: actor.id,
          name: actorEntry?.name ?? "single owner follow-up",
          kind: "actor",
        },
        delivery: "followUp",
        triggerTurn: false,
        message: "stale delegated delivery",
        createdAt: Date.now(),
        epoch: staleEpoch,
      };
      await harness.mesh.put({
        key: staleDeliveryKey,
        value: staleDelivery,
        identity: { id: residentHostId(harness.config.rootId), name: "stale owner", kind: "agent" },
        ifVersion: 0,
      });

      restartedClient = new ResidencyClient({
        config: harness.config,
        mesh: harness.mesh,
        participants: harness.participants,
        mainAgent: harness.mainAgent,
      });
      restartedClient.start();
      await waitFor(() => harness.mesh.get(staleDeliveryKey) === undefined);
      await delay(150);
      expect(harness.deliveries).toHaveLength(2);
      expect(harness.deliveries.some((delivery) => delivery.message.includes("stale delegated delivery"))).toBe(false);

      const resumedReply = await restartedHost.actors.ask(actor.id, "delivery current");
      expect(resumedReply.text).toContain("delivery current");
      await waitFor(() => harness.deliveries.length === 3);
      expect(harness.deliveries[2]?.message).toContain("delivery current");
      expect(inboundMethods(secondLog).slice(0, 6)).toEqual([
        "initialize",
        "session/load",
        "session/set_mode",
        "session/set_config_option",
        "session/set_config_option",
        "session/prompt",
      ]);
      expect(ownerEpoch(harness)).toBeGreaterThan(staleEpoch);
    } finally {
      await restartedClient?.close().catch(() => undefined);
      await firstClient.close().catch(() => undefined);
      await restartedHost?.close().catch(() => undefined);
      await firstHost.close().catch(() => undefined);
      await harness.participants.close();
    }
  });
});
