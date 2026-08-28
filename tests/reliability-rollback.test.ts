import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { ResidentHost } from "../src/residency/host.js";
import {
  RESIDENT_HOST_FORMAT,
  RESIDENT_STATE_VERSION,
  isStaleEpoch,
  migrateResidentStateVersion1to2,
  residentOwnerClaimKey,
  residentRoot,
  type ResidentHostConfig,
} from "../src/residency/protocol.js";
import { installKiroProfile } from "../src/kiro/install.js";

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
    if (Date.now() >= deadline) throw new Error("Timed out waiting for rollback rehearsal state");
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
  fs.writeFileSync(path.join(root, "README.md"), "rollback rehearsal\n", { mode: 0o600 });
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
): Record<string, unknown> | undefined => {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(actorRoot, "actors.json"), "utf8")) as {
      actors: Array<Record<string, unknown>>;
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

const snapshotActorState = (actorRoot: string, actorId: string) => {
  const entry = actorRegistryEntry(actorRoot, actorId);
  if (!entry) throw new Error(`Missing actor registry entry for ${actorId}`);
  return {
    id: String(entry.id),
    name: String(entry.name),
    instructions: String(entry.instructions),
    residency: entry.residency,
    runner: entry.runner,
    lastRunId: typeof entry.lastRunId === "string" ? entry.lastRunId : undefined,
    runnerSessionId:
      typeof entry.runnerSessionId === "string"
        ? entry.runnerSessionId
        : retainedRunnerSessionId(
            actorRoot,
            actorId,
            typeof entry.lastRunId === "string" ? entry.lastRunId : undefined,
          ),
  };
};

const readBytes = (filePath: string): Buffer => fs.readFileSync(filePath);

const loadResidentRecordV2 = (filePath: string): { ok: true; record: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, record: migrateResidentStateVersion1to2(JSON.parse(fs.readFileSync(filePath, "utf8"))) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

const loadResidentRecordV1Only = (
  filePath: string,
): { ok: true; record: unknown } | { ok: false; error: string } => {
  try {
    const record = JSON.parse(fs.readFileSync(filePath, "utf8")) as { stateVersion?: unknown };
    if (record && typeof record === "object" && !Array.isArray(record) && record.stateVersion !== undefined) {
      return {
        ok: false,
        error: `Unsupported resident state version for v1 target: ${String(record.stateVersion)}`,
      };
    }
    return { ok: true, record };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

const downgradeMeshOwnerClaimToV1 = (meshRoot: string, rootId: string): void => {
  const statePath = path.join(meshRoot, "state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
    entries?: Record<string, { value?: Record<string, unknown> }>;
  };
  const key = residentOwnerClaimKey(rootId);
  const value = state.entries?.[key]?.value;
  if (!value) throw new Error(`Missing resident owner claim ${key}`);
  delete value.stateVersion;
  delete value.epoch;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
};

interface TestHarness {
  projectRoot: string;
  config: ResidentHostConfig;
}

const createHarness = async (name: string): Promise<TestHarness> => {
  const projectRoot = initGitRepository(`kiro-fabric-rollback-${name}-`);
  const wrapper = writeKiroWrapper(projectRoot);
  await installFakeKiro(projectRoot, wrapper);
  const meshRoot = path.join(projectRoot, "mesh");
  const meshConfig = { ...DEFAULT_FABRIC_CONFIG.mesh, actorPollMs: 20 };
  return {
    projectRoot,
    config: {
      format: RESIDENT_HOST_FORMAT,
      rootId: `session:${name}:${++sequence}`,
      sessionId: name,
      cwd: projectRoot,
      projectRoot,
      meshRoot,
      actorRoot: path.join(meshRoot, "actors"),
      residencyRoot: residentRoot(meshRoot, `session:${name}:${sequence}`),
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

afterEach(() => {
  delete process.env.FAKE_KIRO_WORKER_SCENARIO;
  delete process.env.FAKE_KIRO_WORKER_LOG;
  delete process.env.KIRO_FABRIC_KIRO_IDLE_MS;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("reliability rollback rehearsal", () => {
  it("rejects newer resident state fail-closed without mutating persisted bytes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-future-"));
    roots.push(root);
    const filePath = path.join(root, "owner.json");
    fs.writeFileSync(filePath, JSON.stringify({
      format: RESIDENT_HOST_FORMAT,
      stateVersion: RESIDENT_STATE_VERSION + 1,
      hostId: "resident:test",
      pid: 123,
      token: "future-token",
      startedAt: 1,
      readyAt: 2,
      epoch: 9,
    }, null, 2));

    const before = readBytes(filePath);
    const result = loadResidentRecordV2(filePath);
    const after = readBytes(filePath);

    expect(result).toEqual({
      ok: false,
      error: `Unsupported resident state version: ${RESIDENT_STATE_VERSION + 1}`,
    });
    expect(after.equals(before)).toBe(true);
  });

  it("loads v1 resident state into v2 memory without touching disk", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-v1-"));
    roots.push(root);
    const filePath = path.join(root, "owner.json");
    fs.writeFileSync(filePath, JSON.stringify({
      format: RESIDENT_HOST_FORMAT,
      hostId: "resident:test",
      pid: 321,
      token: "legacy-token",
      startedAt: 10,
      readyAt: 11,
    }, null, 2));

    const before = readBytes(filePath);
    const result = loadResidentRecordV2(filePath);
    const after = readBytes(filePath);

    expect(result).toEqual({
      ok: true,
      record: {
        format: RESIDENT_HOST_FORMAT,
        stateVersion: RESIDENT_STATE_VERSION,
        hostId: "resident:test",
        pid: 321,
        token: "legacy-token",
        startedAt: 10,
        readyAt: 11,
        epoch: 0,
      },
    });
    expect(isStaleEpoch(0, 1)).toBe(true);
    expect(after.equals(before)).toBe(true);
  });

  it("restores a durable actor unchanged across a compatible rollback and preserves runnerSessionId", { timeout: 20_000 }, async () => {
    const harness = await createHarness("compatible");
    const firstLog = path.join(harness.projectRoot, "rollback-first.log");
    const secondLog = path.join(harness.projectRoot, "rollback-second.log");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.FAKE_KIRO_WORKER_LOG = firstLog;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";

    const firstHost = new ResidentHost(harness.config);
    await firstHost.start();
    let actorId = "";
    let beforeRestart: ReturnType<typeof snapshotActorState> | undefined;
    try {
      const actor = await firstHost.actors.create({
        name: "rollback actor",
        instructions: "Resume safely after a compatible rollback.",
        residency: "durable",
        runner: "kiro",
        delivery: "mailbox",
      });
      actorId = actor.id;
      const firstReply = await firstHost.actors.ask(actor.id, "first rollback turn");
      expect(firstReply.text).toContain("first rollback turn");
      await waitFor(() => firstHost.actors.status(actor.id).status === "idle");
      await waitFor(() => typeof actorRegistryEntry(harness.config.actorRoot, actor.id)?.lastRunId === "string");
      beforeRestart = snapshotActorState(harness.config.actorRoot, actor.id);
      expect(beforeRestart.runnerSessionId).toMatch(/^fake-acp-session-/);
    } finally {
      await firstHost.close();
    }

    downgradeMeshOwnerClaimToV1(harness.config.meshRoot, harness.config.rootId);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident-load";
    process.env.FAKE_KIRO_WORKER_LOG = secondLog;

    const restartedHost = new ResidentHost(harness.config);
    await restartedHost.start();
    try {
      const restored = restartedHost.actors.status(actorId);
      const afterLoad = snapshotActorState(harness.config.actorRoot, actorId);
      expect({
        id: restored.id,
        name: restored.name,
        residency: restored.residency,
        runner: restored.runner,
      }).toEqual({
        id: beforeRestart!.id,
        name: beforeRestart!.name,
        residency: beforeRestart!.residency,
        runner: beforeRestart!.runner,
      });
      expect(afterLoad).toEqual(beforeRestart);

      const resumedReply = await restartedHost.actors.ask(actorId, "second rollback turn");
      expect(resumedReply.text).toContain("second rollback turn");
      expect(inboundMethods(secondLog).slice(0, 6)).toEqual([
        "initialize",
        "session/load",
        "session/set_mode",
        "session/set_config_option",
        "session/set_config_option",
        "session/prompt",
      ]);
      expect(snapshotActorState(harness.config.actorRoot, actorId).runnerSessionId).toBe(
        beforeRestart!.runnerSessionId,
      );
    } finally {
      await restartedHost.close();
    }
  });

  it("fails closed on v2 downgrade to a v1-only target without mutating persisted bytes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-downgrade-"));
    roots.push(root);
    const filePath = path.join(root, "owner.json");
    fs.writeFileSync(filePath, JSON.stringify({
      format: RESIDENT_HOST_FORMAT,
      stateVersion: RESIDENT_STATE_VERSION,
      hostId: "resident:test",
      pid: 456,
      token: "v2-token",
      startedAt: 20,
      readyAt: 21,
      epoch: 2,
    }, null, 2));

    const before = readBytes(filePath);
    const result = loadResidentRecordV1Only(filePath);
    const after = readBytes(filePath);

    expect(result).toEqual({
      ok: false,
      error: `Unsupported resident state version for v1 target: ${RESIDENT_STATE_VERSION}`,
    });
    expect(after.equals(before)).toBe(true);
  });
});
