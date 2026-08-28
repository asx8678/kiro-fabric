import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "../core/atomic-write.js";
import type { FabricAgentLog, AgentHandleInfo, AgentRunRecord, AgentRunRequest, AgentRunResult } from "../agents/types.js";
import { resolveAgentCwd, validateAgentCwdRequest } from "../agents/manager.js";
import { executeFile, processIsAlive, spawnDetached } from "../agents/transports/process-utils.js";
import { readJsonlPage } from "../log-tail.js";
import type { FabricOwnedModelGuidance } from "../components/model-guidance.js";
import type { FabricMainAgentTarget } from "../main-agent.js";
import {
  MeshCompareAndSwapError,
  MeshStore,
  type MeshStateEntry,
} from "../mesh/store.js";
import type { FabricParticipantSource } from "../topology/types.js";
import {
  RESIDENT_HOST_FORMAT,
  RESIDENT_STATE_VERSION,
  isCurrentResidentEpoch,
  isStaleEpoch,
  isValidResidentEpoch,
  migrateResidentStateVersion1to2,
  residentDeliveryPayloadDigest,
  residentDeliveryPrefix,
  residentHostId,
  residentOwnerClaimKey,
  type ResidentAgentMetadata,
  type ResidentCommand,
  type ResidentCommandResponse,
  type ResidentDeliveryRecord,
  type ResidentHostConfig,
  type ResidentHostOwner,
} from "./protocol.js";

const STARTUP_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 30_000;
const STATUS_POLL_MS = 100;
const AGENT_ID_PATTERN = /^[a-f0-9]{32}$/;
const RESIDENT_CLIENT_STATE_VERSION = RESIDENT_STATE_VERSION;
const TOPOLOGY_HOST_PREFIX = "topology/hosts/";
const RESIDENT_CLIENT_STATE_PREFIX = "residency/clients/";
const RESIDENT_DELIVERY_CLAIM_PREFIX = "residency/delivery-claims/";
const DELIVERY_PENDING_LEASE_MS = 30_000;
const DELIVERY_DEDUP_RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_DELIVERY_DEDUP_RECORDS = 4_096;

interface ResidentClientCursor {
  updatedAt: number;
  version: number;
  key: string;
}

interface ResidentClientState {
  stateVersion: typeof RESIDENT_CLIENT_STATE_VERSION;
  hostId: string;
  ownerEpoch: number;
  cursor: ResidentClientCursor;
  deliveredKeys: Record<string, number>;
}

type ResidentDeliveryEffectStatus = "pending" | "delivered" | "acknowledged";

interface ResidentDeliveryEffectRecord {
  stateVersion: typeof RESIDENT_STATE_VERSION;
  hostId: string;
  ownerEpoch: number;
  idempotencyKey: string;
  sourceKey: string;
  status: ResidentDeliveryEffectStatus;
  attemptId: string;
  attemptPid?: number;
  updatedAt: number;
  deliveredAt?: number;
  acknowledgedAt?: number;
  lastError?: string;
}

interface ResidentTopologyHostRecord {
  format: 1;
  id: string;
  rootId: string;
  identity: { id: string };
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const atomicWrite = (filePath: string, value: unknown): void => {
  writeJsonAtomic(filePath, value, { space: 2 });
};

const readJson = <T>(filePath: string): T | undefined => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const terminal = (status: string): status is AgentRunResult["status"] =>
  status === "completed" || status === "failed" || status === "stopped" || status === "timed_out";

const samePath = (left: string, right: string): boolean => {
  try {
    return path.relative(fs.realpathSync.native(left), fs.realpathSync.native(right)) === "";
  } catch {
    return false;
  }
};

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const topologyHostKey = (hostId: string): string =>
  `${TOPOLOGY_HOST_PREFIX}${digest(hostId)}`;

const deliveryPayloadDigest = (value: ResidentDeliveryRecord): string =>
  value.payloadDigest ?? residentDeliveryPayloadDigest(value.delivery, value.message);

const deliveryIdempotencyKey = (value: ResidentDeliveryRecord): string =>
  `${value.id}:${deliveryPayloadDigest(value)}`;

const compareCursor = (
  left: ResidentClientCursor,
  right: ResidentClientCursor,
): number =>
  left.updatedAt - right.updatedAt || left.version - right.version || left.key.localeCompare(right.key);

const entryCursor = (entry: MeshStateEntry): ResidentClientCursor => ({
  updatedAt: entry.updatedAt,
  version: entry.version,
  key: entry.key,
});

/** Refuse cleanup unless the selected repository still owns this worktree. */
const registeredWorktree = async (gitRoot: string, worktreePath: string): Promise<string> => {
  let output: string;
  try {
    output = (await executeFile("git", ["worktree", "list", "--porcelain"], {
      cwd: gitRoot,
      timeoutMs: 30_000,
    })).stdout;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot validate durable worktree ${JSON.stringify(worktreePath)}: ${reason}`);
  }
  const registered = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  const match = registered.find((candidate) => samePath(candidate, worktreePath));
  if (!match) {
    throw new Error(
      `Refusing durable worktree cleanup: ${JSON.stringify(worktreePath)} is not registered by ${JSON.stringify(gitRoot)}`,
    );
  }
  return match;
};

export interface ResidencyClientOptions {
  config: ResidentHostConfig;
  mesh: MeshStore;
  participants: FabricParticipantSource;
  mainAgent: FabricMainAgentTarget;
  hostPath?: string;
}

export class ResidencyClient {
  readonly hostId: string;
  readonly #configPath: string;
  readonly #ownerPath: string;
  readonly #errorPath: string;
  readonly #requestsPath: string;
  readonly #responsesPath: string;
  readonly #agentsPath: string;
  readonly #deliveryPrefix: string;
  readonly #hostPath: string;
  readonly #clientStateKey: string;
  readonly #deliveryClaimPrefix: string;
  readonly #deliveryAttemptId = randomUUID();
  #deliveryTimer: NodeJS.Timeout | undefined;
  #modelGuidanceJson: string | undefined;
  #drainingDeliveries = false;
  #closed = false;

  constructor(readonly options: ResidencyClientOptions) {
    this.hostId = residentHostId(options.config.rootId);
    this.#configPath = path.join(options.config.residencyRoot, "config.json");
    this.#ownerPath = path.join(options.config.residencyRoot, "owner.json");
    this.#errorPath = path.join(options.config.residencyRoot, "error.json");
    this.#requestsPath = path.join(options.config.residencyRoot, "requests");
    this.#responsesPath = path.join(options.config.residencyRoot, "responses");
    this.#agentsPath = path.join(options.config.residencyRoot, "agents");
    this.#deliveryPrefix = residentDeliveryPrefix(options.config.rootId);
    this.#hostPath = options.hostPath ?? fileURLToPath(new URL("./host.js", import.meta.url));
    const rootDigest = digest(options.config.rootId);
    this.#clientStateKey = `${RESIDENT_CLIENT_STATE_PREFIX}${rootDigest}/${this.hostId}`;
    this.#deliveryClaimPrefix = `${RESIDENT_DELIVERY_CLAIM_PREFIX}${rootDigest}/`;
  }

  start(): void {
    if (this.#deliveryTimer || this.#closed || !this.options.mainAgent.local) return;
    this.#deliveryTimer = setInterval(
      () => void this.#drainDeliveries().catch(() => undefined),
      Math.max(20, this.options.config.mesh.actorPollMs),
    );
    this.#deliveryTimer.unref();
    void this.#drainDeliveries().catch(() => undefined);
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#deliveryTimer) clearInterval(this.#deliveryTimer);
    this.#deliveryTimer = undefined;
    while (this.#drainingDeliveries) await delay(10);
  }

  updateModelGuidance(guidance: readonly FabricOwnedModelGuidance[]): void {
    const snapshot: FabricOwnedModelGuidance[] = structuredClone([...guidance]);
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.#modelGuidanceJson) return;
    this.#modelGuidanceJson = serialized;
    this.options.config.modelGuidance = snapshot;
    if (fs.existsSync(this.options.config.residencyRoot)) {
      atomicWrite(this.#configPath, this.options.config);
    }
  }

  async ensureHost(): Promise<ResidentHostOwner> {
    if (this.#closed) throw new Error("Fabric residency client is closed");
    atomicWrite(this.#configPath, this.options.config);
    const existing = this.#selectedOwner();
    if (existing) return existing;
    fs.rmSync(this.#errorPath, { force: true });
    await spawnDetached(
      this.#hostPath,
      ["--config", this.#configPath],
      this.options.config.cwd,
    );
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const owner = this.#selectedOwner();
      if (owner) return owner;
      const failure = readJson<{ error?: unknown }>(this.#errorPath);
      if (typeof failure?.error === "string") {
        throw new Error(`Fabric resident host failed to start: ${failure.error}`);
      }
      await delay(STATUS_POLL_MS);
    }
    throw new Error(`Timed out starting Fabric resident host ${this.hostId}`);
  }

  async ensureActor(id: string): Promise<void> {
    await this.ensureHost();
    await this.#waitForParticipant(id, "actor");
  }

  async spawnAgent(request: AgentRunRequest, signal?: AbortSignal): Promise<AgentHandleInfo> {
    validateAgentCwdRequest(request);
    const resolvedRequest = request.cwd === undefined
      ? request
      : { ...request, cwd: resolveAgentCwd(this.options.config.cwd, request.cwd) };
    await this.ensureHost();
    const response = await this.#command(
      {
        format: RESIDENT_HOST_FORMAT,
        stateVersion: RESIDENT_STATE_VERSION,
        operation: "spawn",
        requestId: randomUUID(),
        rootId: this.options.config.rootId,
        request: { ...resolvedRequest, residency: "durable" },
        createdAt: Date.now(),
      },
      signal,
    );
    if (!response.handle) throw new Error("Fabric resident host returned no agent handle");
    await this.#waitForParticipant(response.handle.id, "agent");
    return response.handle;
  }

  hasAgent(id: string): boolean {
    return AGENT_ID_PATTERN.test(id) && fs.existsSync(this.#metadataPath(id));
  }

  statusAgent(id: string): AgentRunRecord | AgentHandleInfo {
    const metadata = this.#metadata(id);
    if (!metadata) throw new Error(`Unknown durable Fabric agent: ${id}`);
    const record = readJson<AgentRunRecord>(path.join(metadata.runDirectory, "status.json"));
    if (!record || record.id !== metadata.id) return structuredClone(metadata.handle);
    return {
      ...record,
      cwd: metadata.handle.cwd,
      residency: "durable",
      logFile: path.join(metadata.runDirectory, "events.jsonl"),
      ...(metadata.handle.sessionId ? { sessionId: metadata.handle.sessionId } : {}),
      ...(metadata.handle.attachCommand ? { attachCommand: metadata.handle.attachCommand } : {}),
    };
  }

  listAgents(): Array<AgentRunRecord | AgentHandleInfo> {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.#agentsPath);
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.endsWith(".json"))
      .flatMap((entry) => {
        try {
          return [this.statusAgent(entry.slice(0, -5))];
        } catch {
          return [];
        }
      });
  }

  async waitAgent(id: string, signal?: AbortSignal): Promise<AgentRunResult> {
    if (this.#liveOwner()) {
      await this.#command({
        format: RESIDENT_HOST_FORMAT,
        stateVersion: RESIDENT_STATE_VERSION,
        operation: "foreground",
        requestId: randomUUID(),
        rootId: this.options.config.rootId,
        id,
        createdAt: Date.now(),
      }, signal).catch(() => undefined);
    }
    while (true) {
      if (signal?.aborted) throw new Error(`Waiting for durable Fabric agent ${id} was aborted`);
      const status = this.statusAgent(id);
      if (terminal(status.status) && "startedAt" in status) return status as AgentRunResult;
      await delay(STATUS_POLL_MS);
    }
  }

  readAgentLog(id: string, options: { lines?: number; before?: number } = {}): FabricAgentLog {
    const metadata = this.#metadata(id);
    if (!metadata) throw new Error(`Unknown durable Fabric agent: ${id}`);
    const logFile = path.join(metadata.runDirectory, "events.jsonl");
    const page = readJsonlPage(logFile, Math.max(1, Math.min(options.lines ?? 200, 5_000)), options.before);
    const status = readJson<AgentRunRecord>(path.join(metadata.runDirectory, "status.json"));
    return {
      id,
      runDirectory: metadata.runDirectory,
      logFile,
      ...(status ? { status: { ...status, cwd: metadata.handle.cwd, residency: "durable" } } : {}),
      events: page.lines,
      hasMore: page.hasMore,
      ...(page.before !== undefined ? { before: page.before } : {}),
    };
  }

  async removeActor(id: string): Promise<{ removed: boolean }> {
    await this.ensureHost();
    await this.#command({
      format: RESIDENT_HOST_FORMAT,
      stateVersion: RESIDENT_STATE_VERSION,
      operation: "removeActor",
      requestId: randomUUID(),
      rootId: this.options.config.rootId,
      id,
      createdAt: Date.now(),
    });
    return { removed: true };
  }

  async cleanupAgent(id: string, deleteBranch = false): Promise<{ cleaned: boolean }> {
    const metadata = this.#metadata(id);
    if (!metadata) throw new Error(`Unknown durable Fabric agent: ${id}`);
    if (!this.#liveOwner()) return this.#cleanupTerminalFiles(metadata, deleteBranch);
    let response: ResidentCommandResponse;
    try {
      response = await this.#command({
        format: RESIDENT_HOST_FORMAT,
        stateVersion: RESIDENT_STATE_VERSION,
        operation: "cleanup",
        requestId: randomUUID(),
        rootId: this.options.config.rootId,
        id,
        deleteBranch,
        createdAt: Date.now(),
      });
    } catch (error) {
      if (error instanceof Error && /Unknown Fabric agent/.test(error.message)) {
        return this.#cleanupTerminalFiles(metadata, deleteBranch);
      }
      throw error;
    }
    if (!response.ok) throw new Error(response.error ?? `Failed to clean durable Fabric agent ${id}`);
    return { cleaned: true };
  }

  async #cleanupTerminalFiles(
    metadata: ResidentAgentMetadata,
    deleteBranch: boolean,
  ): Promise<{ cleaned: boolean }> {
    const status = this.statusAgent(metadata.id);
    if (!("startedAt" in status) || !terminal(status.status)) {
      throw new Error(`Cannot clean up running durable Fabric agent ${metadata.id}`);
    }
    if (metadata.handle.worktree) {
      const gitRoot = metadata.worktreeGitRoot ?? this.options.config.projectRoot;
      const worktree = await registeredWorktree(gitRoot, metadata.handle.worktree);
      await executeFile(
        "git",
        ["worktree", "remove", "--force", worktree],
        { cwd: gitRoot, timeoutMs: 60_000 },
      );
      if (deleteBranch && metadata.handle.branch) {
        await executeFile(
          "git",
          ["branch", "-D", metadata.handle.branch],
          { cwd: gitRoot, timeoutMs: 30_000 },
        );
      }
    } else if (deleteBranch) {
      throw new Error(`Durable Fabric agent ${metadata.id} has no worktree branch to delete`);
    }
    fs.rmSync(metadata.runDirectory, { recursive: true, force: true });
    fs.rmSync(this.#metadataPath(metadata.id), { force: true });
    return { cleaned: true };
  }

  async #command(command: ResidentCommand, signal?: AbortSignal): Promise<ResidentCommandResponse> {
    const owner = this.#selectedOwner();
    if (!owner) throw new Error("Fabric resident host has no current fenced owner");
    const epoch = owner.epoch ?? 0;
    const fencedCommand: ResidentCommand = {
      ...command,
      stateVersion: RESIDENT_STATE_VERSION,
      epoch,
    };
    const responsePath = path.join(this.#responsesPath, `${command.requestId}.json`);
    atomicWrite(path.join(this.#requestsPath, `${command.requestId}.json`), fencedCommand);
    const deadline = Date.now() + COMMAND_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("Fabric residency request was aborted");
      const response = readJson<ResidentCommandResponse>(responsePath);
      if (response?.format === RESIDENT_HOST_FORMAT && response.requestId === command.requestId) {
        fs.rmSync(responsePath, { force: true });
        if (!response.ok) throw new Error(response.error ?? "Fabric resident host rejected request");
        return response;
      }
      const owner = this.#liveOwner();
      if (!owner) throw new Error("Fabric resident host exited while processing a request");
      await delay(STATUS_POLL_MS);
    }
    throw new Error(`Timed out waiting for Fabric residency request ${command.requestId}`);
  }

  async #waitForParticipant(id: string, kind: "actor" | "agent"): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const participant = this.options.participants.get(id);
      if (
        participant?.kind === kind &&
        participant.ownerHostId === this.hostId &&
        participant.residency === "durable" &&
        !participant.stale
      ) {
        return;
      }
      await delay(STATUS_POLL_MS);
    }
    throw new Error(`Timed out publishing durable Fabric ${kind} ${id} from ${this.hostId}`);
  }

  #metadataPath(id: string): string {
    return path.join(this.#agentsPath, `${id}.json`);
  }

  #metadata(id: string): ResidentAgentMetadata | undefined {
    if (!AGENT_ID_PATTERN.test(id)) return undefined;
    const metadata = readJson<ResidentAgentMetadata>(this.#metadataPath(id));
    if (
      metadata?.format !== RESIDENT_HOST_FORMAT ||
      metadata.rootId !== this.options.config.rootId ||
      metadata.id !== id ||
      metadata.handle.id !== id ||
      (metadata.worktreeGitRoot !== undefined && typeof metadata.worktreeGitRoot !== "string") ||
      path.resolve(metadata.runDirectory) !==
        path.resolve(this.options.config.residencyRoot, "runs", id)
    ) {
      return undefined;
    }
    if (
      metadata.handle.worktree &&
      path.resolve(metadata.handle.worktree) !==
        path.resolve(os.tmpdir(), "kiro-fabric-worktrees", id)
    ) {
      return undefined;
    }
    if (
      metadata.handle.branch &&
      (!metadata.handle.branch.startsWith("kiro-fabric/") ||
        !metadata.handle.branch.endsWith(`-${id.slice(0, 8)}`))
    ) {
      return undefined;
    }
    return metadata;
  }

  #liveOwner(): ResidentHostOwner | undefined {
    const migrated = migrateResidentStateVersion1to2(readJson<ResidentHostOwner>(this.#ownerPath));
    if (!migrated || typeof migrated !== "object" || Array.isArray(migrated)) {
      return undefined;
    }
    const owner = migrated as Partial<ResidentHostOwner>;
    if (
      owner.format !== RESIDENT_HOST_FORMAT ||
      owner.hostId !== this.hostId ||
      typeof owner.pid !== "number" ||
      !Number.isSafeInteger(owner.pid) ||
      !processIsAlive(owner.pid)
    ) {
      return undefined;
    }
    return owner as ResidentHostOwner;
  }

  #selectedOwner(): ResidentHostOwner | undefined {
    const owner = this.#liveOwner();
    if (!owner) return undefined;
    const selected = this.options.mesh.get(topologyHostKey(this.hostId));
    if (typeof selected?.value !== "object" || selected.value === null || Array.isArray(selected.value)) {
      return undefined;
    }
    const host = selected.value as Partial<ResidentTopologyHostRecord>;
    if (
      host.format !== 1 ||
      host.id !== this.hostId ||
      host.rootId !== this.options.config.rootId ||
      typeof host.identity !== "object" ||
      host.identity === null ||
      host.identity.id !== this.hostId ||
      typeof host.updatedAt !== "number"
    ) {
      return undefined;
    }
    const ownerEpoch = owner.epoch ?? 0;
    const claimEntry = this.options.mesh.get(residentOwnerClaimKey(this.options.config.rootId));
    if (!claimEntry) {
      // A v1 host predates mesh-backed fencing. Its migrated epoch is zero;
      // retain read compatibility until that host drains and restarts as v2.
      return ownerEpoch === 0 ? owner : undefined;
    }
    const migratedClaim = migrateResidentStateVersion1to2(claimEntry.value);
    if (
      typeof migratedClaim !== "object" ||
      migratedClaim === null ||
      Array.isArray(migratedClaim)
    ) {
      return undefined;
    }
    const claim = migratedClaim as Partial<ResidentHostOwner>;
    return claim.format === RESIDENT_HOST_FORMAT &&
      claim.hostId === this.hostId &&
      claim.token === owner.token &&
      claim.epoch === ownerEpoch
      ? owner
      : undefined;
  }

  #clientState(ownerEpoch: number): ResidentClientState {
    const entry = this.options.mesh.get(this.#clientStateKey);
    if (typeof entry?.value !== "object" || entry.value === null || Array.isArray(entry.value)) {
      return {
        stateVersion: RESIDENT_CLIENT_STATE_VERSION,
        hostId: this.hostId,
        ownerEpoch,
        cursor: { updatedAt: 0, version: 0, key: "" },
        deliveredKeys: {},
      };
    }
    const value = entry.value as Partial<ResidentClientState>;
    if (
      value.stateVersion !== RESIDENT_CLIENT_STATE_VERSION ||
      value.hostId !== this.hostId ||
      !isValidResidentEpoch(value.ownerEpoch) ||
      typeof value.cursor !== "object" ||
      value.cursor === null ||
      typeof value.cursor.updatedAt !== "number" ||
      typeof value.cursor.version !== "number" ||
      typeof value.cursor.key !== "string" ||
      typeof value.deliveredKeys !== "object" ||
      value.deliveredKeys === null ||
      Array.isArray(value.deliveredKeys)
    ) {
      return {
        stateVersion: RESIDENT_CLIENT_STATE_VERSION,
        hostId: this.hostId,
        ownerEpoch,
        cursor: { updatedAt: 0, version: 0, key: "" },
        deliveredKeys: {},
      };
    }
    const cutoff = Date.now() - DELIVERY_DEDUP_RETENTION_MS;
    const deliveredKeys = Object.fromEntries(
      Object.entries(value.deliveredKeys)
        .filter((entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= cutoff)
        .sort((left, right) => right[1] - left[1])
        .slice(0, MAX_DELIVERY_DEDUP_RECORDS),
    );
    return {
      stateVersion: RESIDENT_CLIENT_STATE_VERSION,
      hostId: this.hostId,
      // A future value from disk must never advance the selected owner cursor.
      // The live owner claim is authoritative and exact-epoch fenced.
      ownerEpoch,
      cursor: {
        updatedAt: value.cursor.updatedAt,
        version: value.cursor.version,
        key: value.cursor.key,
      },
      deliveredKeys,
    };
  }

  async #writeClientState(
    state: ResidentClientState,
    retentionCutoff = Number.NEGATIVE_INFINITY,
  ): Promise<void> {
    let expectedVersion = this.options.mesh.get(this.#clientStateKey)?.version ?? 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = this.options.mesh.get(this.#clientStateKey);
      if (current) expectedVersion = current.version;
      const value = current?.value;
      const currentState = typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Partial<ResidentClientState>
        : undefined;
      const currentDelivered = currentState?.stateVersion === RESIDENT_CLIENT_STATE_VERSION &&
          currentState.hostId === this.hostId &&
          typeof currentState.deliveredKeys === "object" &&
          currentState.deliveredKeys !== null &&
          !Array.isArray(currentState.deliveredKeys)
        ? Object.fromEntries(
            Object.entries(currentState.deliveredKeys).filter(
              (entry): entry is [string, number] =>
                typeof entry[1] === "number" && Number.isFinite(entry[1]),
            ),
          )
        : {};
      const currentCursor = currentState?.ownerEpoch === state.ownerEpoch &&
          typeof currentState.cursor === "object" &&
          currentState.cursor !== null &&
          typeof currentState.cursor.updatedAt === "number" &&
          typeof currentState.cursor.version === "number" &&
          typeof currentState.cursor.key === "string"
        ? currentState.cursor as ResidentClientCursor
        : undefined;
      const deliveredKeys = Object.fromEntries(
        Object.entries({ ...currentDelivered, ...state.deliveredKeys })
          .filter(([, timestamp]) => timestamp >= retentionCutoff)
          .sort((left, right) => right[1] - left[1])
          .slice(0, MAX_DELIVERY_DEDUP_RECORDS),
      );
      const next: ResidentClientState = {
        ...state,
        cursor: currentCursor && compareCursor(currentCursor, state.cursor) > 0
          ? currentCursor
          : state.cursor,
        deliveredKeys,
      };
      try {
        await this.options.mesh.put({
          key: this.#clientStateKey,
          value: next,
          identity: { id: this.hostId, name: "Fabric residency client", kind: "agent" },
          ifVersion: expectedVersion,
        });
        state.cursor = next.cursor;
        state.deliveredKeys = next.deliveredKeys;
        return;
      } catch (error) {
        if (!(error instanceof MeshCompareAndSwapError)) throw error;
        expectedVersion = error.actualVersion;
      }
    }
    throw new Error(`Resident client state contention for ${this.#clientStateKey}`);
  }

  async #drainDeliveries(): Promise<void> {
    if (this.#drainingDeliveries || this.#closed || !this.options.mainAgent.local) return;
    this.#drainingDeliveries = true;
    try {
      const owner = this.#selectedOwner();
      if (!owner) return;
      if (!isValidResidentEpoch(owner.epoch)) return;
      const ownerEpoch = owner.epoch;
      const state = this.#clientState(ownerEpoch);
      const entries = this.options.mesh
        .listAll(this.#deliveryPrefix)
        .filter((entry) => entry.key !== this.#clientStateKey)
        .sort((left, right) => compareCursor(entryCursor(left), entryCursor(right)));
      for (const entry of entries) {
        // Pending mesh entries are authoritative. The cursor is diagnostic;
        // durable effect records, not timestamp ordering, prevent replay after
        // a crash (two writes can share a millisecond and key versions).
        await this.#deliver(entry, state);
      }
      await this.#gcDeliveryEffects(state);
    } finally {
      this.#drainingDeliveries = false;
    }
  }

  #deliveryEffect(
    entry: MeshStateEntry,
    idempotencyKey: string,
    sourceKey: string,
  ): ResidentDeliveryEffectRecord {
    if (typeof entry.value !== "object" || entry.value === null || Array.isArray(entry.value)) {
      throw new Error(`Invalid resident delivery effect ${entry.key}`);
    }
    const value = entry.value as Partial<ResidentDeliveryEffectRecord> & { claimedAt?: unknown };
    const legacyPending = value.status === undefined && typeof value.claimedAt === "number";
    const status = legacyPending ? "pending" : value.status;
    const updatedAt = typeof value.updatedAt === "number"
      ? value.updatedAt
      : typeof value.claimedAt === "number"
        ? value.claimedAt
        : NaN;
    if (
      value.stateVersion !== RESIDENT_STATE_VERSION ||
      value.hostId !== this.hostId ||
      !isValidResidentEpoch(value.ownerEpoch) ||
      value.idempotencyKey !== idempotencyKey ||
      (status !== "pending" && status !== "delivered" && status !== "acknowledged") ||
      !Number.isFinite(updatedAt)
    ) {
      throw new Error(`Invalid resident delivery effect ${entry.key}`);
    }
    return {
      stateVersion: RESIDENT_STATE_VERSION,
      hostId: this.hostId,
      ownerEpoch: value.ownerEpoch,
      idempotencyKey,
      sourceKey: typeof value.sourceKey === "string" ? value.sourceKey : sourceKey,
      status,
      attemptId: typeof value.attemptId === "string" ? value.attemptId : "legacy",
      ...(Number.isSafeInteger(value.attemptPid) && (value.attemptPid ?? 0) > 0
        ? { attemptPid: value.attemptPid }
        : {}),
      updatedAt,
      ...(typeof value.deliveredAt === "number" ? { deliveredAt: value.deliveredAt } : {}),
      ...(typeof value.acknowledgedAt === "number"
        ? { acknowledgedAt: value.acknowledgedAt }
        : {}),
      ...(typeof value.lastError === "string" ? { lastError: value.lastError } : {}),
    };
  }

  async #acquireDeliveryEffect(
    claimKey: string,
    idempotencyKey: string,
    sourceKey: string,
    ownerEpoch: number,
  ): Promise<{ entry: MeshStateEntry; effect: ResidentDeliveryEffectRecord } | undefined> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = this.options.mesh.get(claimKey);
      if (!existing) {
        const now = Date.now();
        const effect: ResidentDeliveryEffectRecord = {
          stateVersion: RESIDENT_STATE_VERSION,
          hostId: this.hostId,
          ownerEpoch,
          idempotencyKey,
          sourceKey,
          status: "pending",
          attemptId: this.#deliveryAttemptId,
          attemptPid: process.pid,
          updatedAt: now,
        };
        try {
          const entry = await this.options.mesh.put({
            key: claimKey,
            value: effect,
            identity: { id: this.hostId, name: "Fabric residency client", kind: "agent" },
            ifVersion: 0,
          });
          return { entry, effect };
        } catch (error) {
          if (error instanceof MeshCompareAndSwapError) continue;
          throw error;
        }
      }

      const effect = this.#deliveryEffect(existing, idempotencyKey, sourceKey);
      if (!isCurrentResidentEpoch(effect.ownerEpoch, ownerEpoch)) {
        throw new Error(
          `Resident delivery effect epoch ${effect.ownerEpoch} does not match owner epoch ${ownerEpoch}`,
        );
      }
      if (effect.status !== "pending") return { entry: existing, effect };
      const sameAttempt = effect.attemptId === this.#deliveryAttemptId;
      const leaseExpired = Date.now() - effect.updatedAt >= DELIVERY_PENDING_LEASE_MS;
      // A live, still-in-flight attemptPid is an exclusive fence. Lease expiry
      // only applies to legacy records that predate pid tracking; lastError
      // explicitly releases the fence so a failed synchronous delivery retries.
      if (
        !sameAttempt &&
        effect.attemptPid !== undefined &&
        processIsAlive(effect.attemptPid) &&
        !effect.lastError
      ) {
        return undefined;
      }
      if (
        !sameAttempt &&
        effect.attemptPid === undefined &&
        !leaseExpired &&
        !effect.lastError
      ) {
        return undefined;
      }
      const renewed: ResidentDeliveryEffectRecord = {
        ...effect,
        sourceKey,
        attemptId: this.#deliveryAttemptId,
        attemptPid: process.pid,
        updatedAt: Date.now(),
      };
      delete renewed.lastError;
      try {
        const entry = await this.options.mesh.put({
          key: claimKey,
          value: renewed,
          identity: { id: this.hostId, name: "Fabric residency client", kind: "agent" },
          ifVersion: existing.version,
        });
        return { entry, effect: renewed };
      } catch (error) {
        if (error instanceof MeshCompareAndSwapError) continue;
        throw error;
      }
    }
    return undefined;
  }

  async #transitionDeliveryEffect(
    entry: MeshStateEntry,
    effect: ResidentDeliveryEffectRecord,
    next: ResidentDeliveryEffectRecord,
  ): Promise<{ entry: MeshStateEntry; effect: ResidentDeliveryEffectRecord }> {
    try {
      const updated = await this.options.mesh.put({
        key: entry.key,
        value: next,
        identity: { id: this.hostId, name: "Fabric residency client", kind: "agent" },
        ifVersion: entry.version,
      });
      return { entry: updated, effect: next };
    } catch (error) {
      if (!(error instanceof MeshCompareAndSwapError)) throw error;
      const current = this.options.mesh.get(entry.key);
      if (!current) throw error;
      const currentEffect = this.#deliveryEffect(current, effect.idempotencyKey, effect.sourceKey);
      if (
        currentEffect.status === "delivered" ||
        currentEffect.status === "acknowledged"
      ) {
        return { entry: current, effect: currentEffect };
      }
      throw error;
    }
  }

  async #acknowledgeDeliveryEffect(
    claimKey: string,
    idempotencyKey: string,
    sourceKey: string,
    ownerEpoch: number,
    acknowledgedAt: number,
  ): Promise<void> {
    const entry = this.options.mesh.get(claimKey);
    if (!entry) return;
    const effect = this.#deliveryEffect(entry, idempotencyKey, sourceKey);
    if (!isCurrentResidentEpoch(effect.ownerEpoch, ownerEpoch) || effect.status === "acknowledged") {
      return;
    }
    await this.#transitionDeliveryEffect(entry, effect, {
      ...effect,
      status: "acknowledged",
      deliveredAt: effect.deliveredAt ?? acknowledgedAt,
      acknowledgedAt,
      updatedAt: acknowledgedAt,
    });
  }

  async #gcDeliveryEffects(state: ResidentClientState): Promise<void> {
    const now = Date.now();
    const cutoff = now - DELIVERY_DEDUP_RETENTION_MS;
    const delivered = Object.entries(state.deliveredKeys)
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
      .sort((left, right) => right[1] - left[1]);
    state.deliveredKeys = Object.fromEntries(
      delivered
        .filter(([, timestamp]) => timestamp >= cutoff)
        .slice(0, MAX_DELIVERY_DEDUP_RECORDS),
    );
    const persisted = this.options.mesh.get(this.#clientStateKey)?.value as
      | Partial<ResidentClientState>
      | undefined;
    if (JSON.stringify(persisted?.deliveredKeys ?? {}) !== JSON.stringify(state.deliveredKeys)) {
      await this.#writeClientState(state, cutoff);
    }

    const effects = this.options.mesh.listAll(this.#deliveryClaimPrefix)
      .flatMap((entry) => {
        try {
          if (typeof entry.value !== "object" || entry.value === null || Array.isArray(entry.value)) {
            return [];
          }
          const value = entry.value as Partial<ResidentDeliveryEffectRecord>;
          if (typeof value.idempotencyKey !== "string") return [];
          return [{ entry, effect: this.#deliveryEffect(
            entry,
            value.idempotencyKey,
            typeof value.sourceKey === "string" ? value.sourceKey : "",
          ) }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.effect.updatedAt - left.effect.updatedAt);
    const removableTerminal = effects.filter(({ effect }) =>
      effect.status !== "pending" &&
      (!effect.sourceKey || this.options.mesh.get(effect.sourceKey) === undefined),
    );
    const excess = new Set(
      removableTerminal.slice(MAX_DELIVERY_DEDUP_RECORDS).map(({ entry }) => entry.key),
    );
    for (const { entry, effect } of effects) {
      const sourceGone = !effect.sourceKey || this.options.mesh.get(effect.sourceKey) === undefined;
      // Never GC the durable proof while its source remains. Otherwise a
      // delayed source cleanup can turn retention into duplicate delivery.
      const expiredTerminal = effect.status !== "pending" && sourceGone && effect.updatedAt < cutoff;
      const abandonedPending = effect.status === "pending" && sourceGone && effect.updatedAt < cutoff;
      if (!expiredTerminal && !abandonedPending && !excess.has(entry.key)) continue;
      try {
        await this.options.mesh.delete({ key: entry.key, ifVersion: entry.version });
      } catch (error) {
        if (!(error instanceof MeshCompareAndSwapError)) throw error;
      }
    }
  }

  async #deliver(entry: MeshStateEntry, state: ResidentClientState): Promise<void> {
    if (typeof entry.value !== "object" || entry.value === null || Array.isArray(entry.value)) return;
    const value = entry.value as Partial<ResidentDeliveryRecord>;
    if (
      value.format !== RESIDENT_HOST_FORMAT ||
      value.rootId !== this.options.config.rootId ||
      typeof value.id !== "string" ||
      typeof value.message !== "string" ||
      (value.delivery !== "steer" && value.delivery !== "followUp") ||
      typeof value.triggerTurn !== "boolean" ||
      typeof value.from !== "object" ||
      value.from === null ||
      entry.updatedBy.id !== this.hostId
    ) {
      return;
    }
    const record = migrateResidentStateVersion1to2(value) as ResidentDeliveryRecord;
    if (record.stateVersion !== RESIDENT_STATE_VERSION || !isValidResidentEpoch(record.epoch)) return;
    if (!isCurrentResidentEpoch(record.epoch, state.ownerEpoch)) {
      if (isStaleEpoch(record.epoch, state.ownerEpoch)) {
        state.cursor = entryCursor(entry);
        await this.#writeClientState(state);
        await this.options.mesh.delete({ key: entry.key, ifVersion: entry.version });
      }
      // Future epochs stay pending for the matching selected owner. They never
      // advance this client's ownerEpoch/cursor and cannot poison it.
      return;
    }

    const idempotencyKey = deliveryIdempotencyKey(record);
    const claimKey = `${this.#deliveryClaimPrefix}${digest(idempotencyKey).slice(0, 40)}`;
    const deliveredAt = state.deliveredKeys[idempotencyKey];
    if (deliveredAt !== undefined) {
      state.cursor = entryCursor(entry);
      state.ownerEpoch = record.epoch;
      await this.#writeClientState(state);
      await this.options.mesh.delete({ key: entry.key, ifVersion: entry.version });
      await this.#acknowledgeDeliveryEffect(
        claimKey,
        idempotencyKey,
        entry.key,
        state.ownerEpoch,
        deliveredAt,
      );
      this.options.mainAgent.acknowledgeDelivery?.(idempotencyKey);
      return;
    }

    let acquired = await this.#acquireDeliveryEffect(
      claimKey,
      idempotencyKey,
      entry.key,
      state.ownerEpoch,
    );
    if (!acquired) return;

    if (acquired.effect.status === "pending") {
      try {
        this.options.mainAgent.deliverAgent({
          from: record.from,
          message: record.message,
          delivery: record.delivery,
          triggerTurn: record.triggerTurn,
          ...(record.data === undefined ? {} : { data: record.data }),
          idempotencyKey,
        });
      } catch (error) {
        const failed: ResidentDeliveryEffectRecord = {
          ...acquired.effect,
          updatedAt: Date.now(),
          lastError: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
        };
        await this.#transitionDeliveryEffect(acquired.entry, acquired.effect, failed).catch(
          (transitionError) => {
            if (!(transitionError instanceof MeshCompareAndSwapError)) throw transitionError;
          },
        );
        throw error;
      }
      const now = Date.now();
      const deliveredEffect: ResidentDeliveryEffectRecord = {
        ...acquired.effect,
        status: "delivered",
        updatedAt: now,
        deliveredAt: now,
      };
      acquired = await this.#transitionDeliveryEffect(
        acquired.entry,
        acquired.effect,
        deliveredEffect,
      );
    }

    state.cursor = entryCursor(entry);
    state.ownerEpoch = record.epoch;
    state.deliveredKeys[idempotencyKey] = acquired.effect.deliveredAt ?? Date.now();
    await this.#writeClientState(state);
    await this.options.mesh.delete({ key: entry.key, ifVersion: entry.version });

    if (acquired.effect.status !== "acknowledged") {
      const now = Date.now();
      const acknowledged: ResidentDeliveryEffectRecord = {
        ...acquired.effect,
        status: "acknowledged",
        updatedAt: now,
        acknowledgedAt: now,
      };
      await this.#transitionDeliveryEffect(acquired.entry, acquired.effect, acknowledged);
    }
    this.options.mainAgent.acknowledgeDelivery?.(idempotencyKey);
  }
}
