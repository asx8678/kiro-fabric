import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { installKiroProfile } from "../src/kiro/install.js";
import type { FabricMainAgentDeliveryRequest, FabricMainAgentTarget } from "../src/main-agent.js";
import { MeshStore, type MeshIdentity } from "../src/mesh/store.js";
import { ResidentHost } from "../src/residency/host.js";
import {
  RESIDENT_HOST_FORMAT,
  residentRoot,
  type ResidentHostConfig,
} from "../src/residency/protocol.js";
import { ParticipantDirectory } from "../src/topology/participant-directory.js";

const repoRoot = process.cwd();
const distWorker = path.resolve("dist/worker.js");
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

const inboundFrames = (
  logFile: string,
): Array<{ method?: string; params?: Record<string, unknown> }> =>
  readLogEntries(logFile)
    .filter((entry) => entry.event === "inbound")
    .map((entry) => (entry.frame as { method?: string; params?: Record<string, unknown> } | undefined) ?? {});

interface ActorRegistryMessage {
  direction?: string;
  text?: string;
  data?: { message?: string };
}

interface ActorRegistryEntry {
  id: string;
  runnerSessionId?: string;
  lastRunId?: string;
  sessionFile?: string;
  messages?: ActorRegistryMessage[];
}

const actorRegistryEntry = (actorRoot: string, actorId: string): ActorRegistryEntry | undefined => {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(actorRoot, "actors.json"), "utf8")) as {
      actors: ActorRegistryEntry[];
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
    throw new Error("not used by reliability session resume test");
  },
  deliverAgent: (request) => {
    deliveries.push(request);
    return { queued: true, messageId: `main-${++sequence}`, routed: "main" };
  },
});

interface TestHarness {
  projectRoot: string;
  mesh: MeshStore;
  identity: MeshIdentity;
  participants: ParticipantDirectory;
  config: ResidentHostConfig;
}

const createHarness = async (name: string): Promise<TestHarness> => {
  const projectRoot = initGitRepository(`kiro-fabric-reliability-${name}-`);
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
  return {
    projectRoot,
    mesh,
    identity,
    participants,
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
      workerPath: distWorker,
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
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("durable kiro session resume reliability", () => {
  it("replays a durable owner restart with session/load and no duplicate mailbox delivery", { timeout: 20_000 }, async () => {
    const harness = await createHarness("session-resume");
    const firstLog = path.join(harness.projectRoot, "resident-first.log");
    const secondLog = path.join(harness.projectRoot, "resident-second.log");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.FAKE_KIRO_WORKER_LOG = firstLog;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";

    const firstHost = new ResidentHost(harness.config);
    await firstHost.start();
    try {
      const actor = await firstHost.actors.create({
        name: "resident kiro reliability",
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

      const firstRegistry = actorRegistryEntry(harness.config.actorRoot, actor.id);
      const persistedSessionId = retainedRunnerSessionId(
        harness.config.actorRoot,
        actor.id,
        firstRegistry?.lastRunId,
      );
      expect(persistedSessionId).toMatch(/^fake-acp-session-/);
      expect(firstRegistry?.runnerSessionId).toBe(persistedSessionId);

      await firstHost.close();
      process.env.FAKE_KIRO_WORKER_SCENARIO = "resident-load";
      process.env.FAKE_KIRO_WORKER_LOG = secondLog;

      const restartedHost = new ResidentHost(harness.config);
      await restartedHost.start();
      try {
        const resumedReply = await restartedHost.actors.ask(actor.id, "second durable turn");
        expect(resumedReply.text).toContain("prompt 1:");
        expect(resumedReply.text).toContain("second durable turn");
        await waitFor(() => restartedHost.actors.status(actor.id).status === "idle");

        const resumedFrames = inboundFrames(secondLog);
        expect(resumedFrames.map((frame) => frame.method).slice(0, 6)).toEqual([
          "initialize",
          "session/load",
          "session/set_mode",
          "session/set_config_option",
          "session/set_config_option",
          "session/prompt",
        ]);
        expect(resumedFrames.some((frame) => frame.method === "session/new")).toBe(false);
        expect(
          resumedFrames.filter((frame) => frame.method === "session/prompt"),
        ).toHaveLength(1);
        expect(
          resumedFrames.find((frame) => frame.method === "session/load")?.params?.sessionId,
        ).toBe(persistedSessionId);

        const resumedRegistry = actorRegistryEntry(harness.config.actorRoot, actor.id);
        expect(
          retainedRunnerSessionId(harness.config.actorRoot, actor.id, resumedRegistry?.lastRunId),
        ).toBe(persistedSessionId);
        expect(resumedRegistry?.runnerSessionId).toBe(persistedSessionId);
        expect(
          resumedRegistry?.messages?.filter(
            (message) => message.direction === "in" && message.data?.message === "second durable turn",
          ) ?? [],
        ).toHaveLength(1);
      } finally {
        await restartedHost.close();
      }
    } finally {
      await harness.participants.close();
    }
  });
});
