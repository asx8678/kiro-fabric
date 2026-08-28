#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "../core/atomic-write.js";
import {
  parseFabricOwnedModelGuidance,
  resolveFabricModelGuidance,
} from "../components/model-guidance.js";
import { ActorManager } from "../actors/manager.js";
import { AgentManager } from "../agents/manager.js";
import { useBudgetLedger } from "../agents/budget-ledger.js";
import { LifecycleBroker } from "../lifecycle/broker.js";
import { lifecycleSourceIdentity, type FabricLifecycleEvent, type FabricLifecycleSubscription } from "../lifecycle/types.js";
import { MeshStore, type MeshIdentity, type MeshStateEntry } from "../mesh/store.js";
import { FabricControlPlane, type FabricControlAcceptance, type FabricControlCommand } from "../topology/control-plane.js";
import { ParticipantDirectory } from "../topology/participant-directory.js";
import { actorParticipantRecord, agentParticipantRecords } from "../topology/records.js";
import * as residencyProtocol from "./protocol.js";
import {
  RESIDENT_HOST_FORMAT,
  RESIDENT_STATE_VERSION,
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

const REQUEST_POLL_MS = 50;
const IDLE_EXIT_MS = 30_000;
const COMPLETION_MAX_CHARS = 8_000;
let residentEpochCounter = 0;

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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const processAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const nextResidentEpoch = (minimum: number): number => {
  if (!residencyProtocol.isValidResidentEpoch(minimum)) {
    throw new Error(`Invalid next resident epoch: ${String(minimum)}`);
  }
  const candidate = Math.max(residentEpochCounter + 1, minimum);
  if (!residencyProtocol.isValidResidentEpoch(candidate)) {
    throw new Error("Resident epoch counter exhausted");
  }
  residentEpochCounter = candidate;
  return residentEpochCounter;
};

interface ResidentOwnerState extends ResidentHostOwner {
  stateVersion: typeof RESIDENT_STATE_VERSION;
  epoch: number;
}

class ResidentHostAlreadyRunning extends Error {}

const parseConfigPath = (argv: readonly string[]): string => {
  const index = argv.indexOf("--config");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error("Missing resident host argument: --config");
  return path.resolve(value);
};

const validateConfig = (value: unknown, configPath: string): ResidentHostConfig => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Fabric resident host config");
  }
  const config = value as Partial<ResidentHostConfig>;
  if (
    config.format !== RESIDENT_HOST_FORMAT ||
    typeof config.rootId !== "string" ||
    typeof config.sessionId !== "string" ||
    typeof config.cwd !== "string" ||
    typeof config.projectRoot !== "string" ||
    typeof config.meshRoot !== "string" ||
    typeof config.actorRoot !== "string" ||
    typeof config.residencyRoot !== "string" ||
    typeof config.fullCodeMode !== "boolean" ||
    typeof config.agents !== "object" ||
    config.agents === null ||
    typeof config.mesh !== "object" ||
    config.mesh === null ||
    typeof config.retention !== "object" ||
    config.retention === null ||
    typeof config.workerPath !== "string" ||
    typeof config.fabricExtensionPath !== "string" ||
    typeof config.piBinary !== "string" ||
    typeof config.claudeBinary !== "string" ||
    typeof config.vedaBinary !== "string" ||
    (config.kiroBinary !== undefined && typeof config.kiroBinary !== "string")
  ) {
    throw new Error("Fabric resident host config is incomplete");
  }
  if (path.resolve(config.residencyRoot) !== path.dirname(configPath)) {
    throw new Error("Fabric resident host config is outside its residency root");
  }
  if (!config.mesh.enabled) throw new Error("Durable residency requires the Fabric mesh");
  return config as ResidentHostConfig;
};

export class ResidentHost {
  readonly hostId: string;
  readonly identity: MeshIdentity;
  readonly mesh: MeshStore;
  readonly participants: ParticipantDirectory;
  readonly control: FabricControlPlane;
  readonly agents: AgentManager;
  actors!: ActorManager;
  readonly lifecycle: LifecycleBroker;
  readonly #ownerPath: string;
  readonly #lockPath: string;
  readonly #errorPath: string;
  readonly #requestsPath: string;
  readonly #processingPath: string;
  readonly #responsesPath: string;
  readonly #agentsPath: string;
  readonly #deliveryPrefix: string;
  readonly #ownerClaimKey: string;
  readonly #token = randomUUID();
  #requestTimer: NodeJS.Timeout | undefined;
  #pollingRequests = false;
  #closed = false;
  #started = false;
  #idleSince = Date.now();
  #epoch = 0;
  #startedAt = 0;
  #readyAt = 0;
  #staleReason: string | undefined;
  #stepDownScheduled = false;
  #ownershipFenceCurrent = false;

  constructor(
    readonly config: ResidentHostConfig,
    readonly onIdle: () => void = () => {},
  ) {
    this.hostId = residentHostId(config.rootId);
    this.identity = { id: this.hostId, name: "Fabric resident host", kind: "agent" };
    this.#ownerPath = path.join(config.residencyRoot, "owner.json");
    this.#lockPath = path.join(config.residencyRoot, "host.lock");
    this.#errorPath = path.join(config.residencyRoot, "error.json");
    this.#requestsPath = path.join(config.residencyRoot, "requests");
    this.#processingPath = path.join(config.residencyRoot, "processing");
    this.#responsesPath = path.join(config.residencyRoot, "responses");
    this.#agentsPath = path.join(config.residencyRoot, "agents");
    this.#deliveryPrefix = residentDeliveryPrefix(config.rootId);
    this.#ownerClaimKey = residentOwnerClaimKey(config.rootId);
    this.mesh = new MeshStore(config.meshRoot, config.mesh.maxEventBytes, config.mesh.maxReadEvents);
    this.participants = new ParticipantDirectory(this.mesh, {
      enabled: true,
      hostId: this.hostId,
      rootId: config.rootId,
      identity: this.identity,
    });
    this.control = new FabricControlPlane(this.mesh, this.identity, {
      enabled: true,
      hostId: this.hostId,
      pollMs: config.mesh.actorPollMs,
    });
    if (config.agents.budgetUsd > 0) {
      const budgetFile = path.join(config.residencyRoot, "budget.jsonl");
      fs.mkdirSync(path.dirname(budgetFile), { recursive: true, mode: 0o700 });
      if (!fs.existsSync(budgetFile)) fs.writeFileSync(budgetFile, "", { mode: 0o600 });
      useBudgetLedger({
        budget: config.agents.budgetUsd,
        file: budgetFile,
        id: this.hostId,
      });
    }
    const guidanceConfigPath = path.join(config.residencyRoot, "config.json");
    const currentModelGuidance = () => {
      const current = readJson<Partial<ResidentHostConfig>>(guidanceConfigPath);
      return parseFabricOwnedModelGuidance(current?.modelGuidance ?? config.modelGuidance);
    };
    this.agents = new AgentManager(config.cwd, config.agents, {
      workerPath: config.workerPath,
      fabricExtensionPath: config.fabricExtensionPath,
      piBinary: config.piBinary,
      claudeBinary: config.claudeBinary,
      vedaBinary: config.vedaBinary,
      kiroBinary: config.kiroBinary ?? "kiro-cli",
      runRoot: path.join(config.residencyRoot, "runs"),
      fullCodeMode: config.fullCodeMode,
      mainAgentId: config.rootId,
      meshRoot: config.meshRoot,
      projectRoot: config.projectRoot,
      hostId: this.hostId,
      identityId: this.identity.id,
      retention: config.retention,
      resolveParticipantGuidance: ({ model }) => {
        if (!model) return undefined;
        return resolveFabricModelGuidance(currentModelGuidance(), {
          model,
          target: "participant",
          includeSlots: false,
        }).appendText || undefined;
      },
      onLifecycle: (event) => void this.lifecycle?.publish(event).catch(() => undefined),
      onBackgroundComplete: (result) => {
        if (!config.agents.notifyOnComplete) return;
        const durationMs = Math.max(0, (result.finishedAt ?? Date.now()) - result.startedAt);
        const summary = (result.text || result.error || "no result").slice(0, COMPLETION_MAX_CHARS);
        void this.#queueDelivery(
          { id: result.id, name: result.name, kind: "agent" },
          `Fabric agent ${result.id.slice(0, 8)} ${result.status} after ${Math.round(durationMs / 1_000)}s: ${summary}`,
          "followUp",
          true,
          result,
        ).catch(() => undefined);
      },
    });
    this.lifecycle = new LifecycleBroker(
      this.mesh,
      this.identity,
      this.participants,
      {
        enabled: true,
        pollMs: config.mesh.actorPollMs,
        maxReadEvents: config.mesh.maxReadEvents,
      },
      (subscription, event) => this.#deliverLifecycle(subscription, event),
    );
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#acquireLock();
    this.#started = true;
    fs.mkdirSync(this.#requestsPath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.#processingPath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.#responsesPath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.#agentsPath, { recursive: true, mode: 0o700 });
    this.#recoverInterruptedRequests();
    const owner = await this.#claimOwnership();
    this.actors = this.#createActorManager();
    const firstSeenAgents = new Map<string, number>();
    this.participants.registerSource(() =>
      agentParticipantRecords(
        this.agents.listForUi(),
        this.config.rootId,
        this.hostId,
        this.identity.id,
        this.config.rootId,
        firstSeenAgents,
      ),
    );
    this.participants.registerSource(() =>
      this.actors.listOwned().map((actor) =>
        actorParticipantRecord(
          actor,
          this.config.rootId,
          this.hostId,
          this.identity.id,
          this.config.rootId,
        ),
      ),
    );
    this.agents.subscribeUi(() => this.participants.scheduleRefresh());
    this.actors.subscribe(() => this.participants.scheduleRefresh());
    this.control.start((command, from, signal) =>
      this.#acceptControl(command, from, signal));
    await this.participants.start().catch(() => undefined);
    this.lifecycle.start();
    this.#requestTimer = setInterval(
      () => void this.#pollRequests().catch(() => undefined),
      REQUEST_POLL_MS,
    );
    this.#readyAt = Date.now();
    atomicWrite(this.#ownerPath, { ...owner, readyAt: this.#readyAt });
    fs.rmSync(this.#errorPath, { force: true });
    this.#assertCurrentOwner("host start", owner.epoch);
    await this.#pollRequests();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#requestTimer) clearInterval(this.#requestTimer);
    this.#requestTimer = undefined;
    while (this.#pollingRequests) await delay(10);
    await this.participants.quiesce().catch(() => undefined);
    await this.lifecycle.close().catch(() => undefined);
    await this.control.close().catch(() => undefined);
    try {
      if (this.actors) await this.actors.close();
    } finally {
      await this.agents.close();
      await this.participants.close().catch(() => undefined);
      this.#releaseLock();
    }
  }

  /**
   * Resume durable actors only after the current epoch is fenced in. ActorManager's
   * own mesh cursor + queue replay remain authoritative for pending deliveries,
   * so the host must not rebuild or re-enqueue a delivery set here.
   */
  #createActorManager(): ActorManager {
    const canManageActor = (id: string): boolean | undefined => {
      // Ownership probes are hot (queue drains, presence refreshes, topology
      // snapshots). Use the fence refreshed by request polling instead of
      // turning every probe into claim I/O. Every durable mutation still calls
      // assertPersistentMutation immediately before writing.
      if (!this.#ownershipFenceCurrent || this.#staleReason) return false;
      const participant = this.participants.get(id);
      return participant ? participant.ownerHostId === this.hostId : undefined;
    };
    const lineageAlive = (rootId: string): boolean =>
      this.participants.get(rootId) !== undefined;
    return new ActorManager(
      this.config.sessionId,
      this.identity,
      this.mesh,
      this.config.mesh,
      this.agents,
      async ({ actor, message, delivery, triggerTurn }) => {
        if (!message.text) return;
        const mode = delivery === "steer" ? "steer" : "followUp";
        const triggers = delivery === "nextTurn" ? false : triggerTurn;
        await this.#queueDeliveryDurably(
          { id: actor.id, name: actor.name, kind: "actor" },
          message.text,
          mode,
          triggers,
          message.data,
          message.id,
        );
      },
      {
        actorRoot: this.config.actorRoot,
        persistent: true,
        canManageActor,
        lineageAlive,
        claimResidency: "durable",
        rootId: this.config.rootId,
        meshCursorPath: path.join(this.config.residencyRoot, "actor-mesh-cursor.json"),
        assertPersistentMutation: () => {
          this.#assertCurrentOwner("actor persistent mutation", this.#epoch);
        },
        retention: this.config.retention,
      },
    );
  }

  async #acceptControl(
    command: FabricControlCommand,
    _from: MeshIdentity,
    signal?: AbortSignal,
  ): Promise<FabricControlAcceptance> {
    try {
      this.#assertCurrentOwner(`control ${command.operation}`);
    } catch (error) {
      return { accepted: false, error: errorMessage(error) };
    }
    if (command.operation === "cancel") {
      return { accepted: false, error: "Cancel commands are handled by the control plane" };
    }
    if (command.operation === "stop") {
      try {
        await this.agents.stop(command.targetId);
        this.participants.scheduleRefresh();
        return { accepted: true, messageId: command.commandId };
      } catch (error) {
        if (!(error instanceof Error && /Unknown Fabric agent/.test(error.message))) {
          return { accepted: false, error: errorMessage(error) };
        }
      }
      try {
        if (!this.actors.owns(command.targetId)) {
          return { accepted: false, error: `Resident host does not own ${command.targetId}` };
        }
        await this.actors.stop(command.targetId);
        this.participants.scheduleRefresh();
        return { accepted: true, messageId: command.commandId };
      } catch (error) {
        return { accepted: false, error: errorMessage(error) };
      }
    }
    const message = command.message?.trim();
    if (!message) return { accepted: false, error: "Fabric control message must not be empty" };
    if (command.operation === "ask") {
      try {
        if (!this.actors.owns(command.targetId)) {
          return { accepted: false, error: `Resident host does not own ${command.targetId}` };
        }
        const result = await this.actors.ask(
          command.targetId,
          message,
          command.data,
          signal,
          command.binding !== undefined ? { binding: command.binding } : {},
        );
        return { accepted: true, messageId: result.id, result };
      } catch (error) {
        return { accepted: false, error: errorMessage(error) };
      }
    }
    try {
      this.agents.status(command.targetId);
      const result = command.operation === "steer"
        ? this.agents.steer(command.targetId, message, command.data)
        : this.agents.followUp(command.targetId, message, command.data);
      return { accepted: true, messageId: result.messageId };
    } catch (error) {
      if (!(error instanceof Error && /Unknown Fabric agent/.test(error.message))) {
        return { accepted: false, error: errorMessage(error) };
      }
    }
    try {
      if (!this.actors.owns(command.targetId)) {
        return { accepted: false, error: `Resident host does not own ${command.targetId}` };
      }
      const result = this.actors.tell(
        command.targetId,
        message,
        command.data,
        command.binding !== undefined ? { binding: command.binding } : {},
      );
      return { accepted: true, messageId: result.messageId };
    } catch (error) {
      return { accepted: false, error: errorMessage(error) };
    }
  }

  async #deliverLifecycle(
    subscription: FabricLifecycleSubscription,
    event: FabricLifecycleEvent,
  ): Promise<void> {
    this.#assertCurrentOwner(`lifecycle delivery ${subscription.to}`);
    const message = `Fabric lifecycle ${event.event} from ${event.source.name} (${event.source.id})${event.status ? ` with status ${event.status}` : ""}.`;
    if (subscription.to === this.config.rootId) {
      await this.#queueDelivery(
        lifecycleSourceIdentity(event.source),
        message,
        subscription.delivery,
        subscription.triggerTurn,
        event,
      );
      return;
    }
    try {
      this.agents.status(subscription.to);
      if (subscription.delivery === "steer") this.agents.steer(subscription.to, message, event);
      else this.agents.followUp(subscription.to, message, event);
      return;
    } catch (error) {
      if (!(error instanceof Error && /Unknown Fabric agent/.test(error.message))) throw error;
    }
    try {
      if (this.actors.owns(subscription.to)) {
        this.actors.tell(subscription.to, message, event);
        return;
      }
    } catch {
      // Route through the current remote owner below.
    }
    const target = this.participants.get(subscription.to);
    if (!target) throw new Error(`Unknown Fabric lifecycle target: ${subscription.to}`);
    await this.control.request(
      target.ownerHostId,
      target.id,
      subscription.delivery,
      { message, data: event, triggerTurn: subscription.triggerTurn },
      target.ownerIdentityId,
    );
  }

  async #queueDeliveryDurably(
    from: MeshIdentity,
    message: string,
    delivery: "steer" | "followUp",
    triggerTurn: boolean,
    data?: unknown,
    deliveryId: string = randomUUID(),
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.#queueDelivery(
          from,
          message,
          delivery,
          triggerTurn,
          data,
          deliveryId,
        );
        return;
      } catch (error) {
        lastError = error;
        if (this.#closed || this.#staleReason || !this.#ownershipFenceCurrent) {
          throw error;
        }
        if (attempt < 4) await delay(REQUEST_POLL_MS * (2 ** attempt));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Unable to persist resident ${delivery} delivery`);
  }

  async #queueDelivery(
    from: MeshIdentity,
    message: string,
    delivery: "steer" | "followUp",
    triggerTurn: boolean,
    data?: unknown,
    id: string = randomUUID(),
  ): Promise<void> {
    const current = this.#assertCurrentOwner(`delivery ${delivery}`, this.#epoch);
    const record: ResidentDeliveryRecord = {
      format: RESIDENT_HOST_FORMAT,
      stateVersion: RESIDENT_STATE_VERSION,
      id,
      rootId: this.config.rootId,
      from,
      delivery,
      triggerTurn,
      message,
      ...(data === undefined ? {} : { data }),
      createdAt: Date.now(),
      epoch: current.epoch,
      payloadDigest: residentDeliveryPayloadDigest(delivery, message),
    };
    const key = `${this.#deliveryPrefix}${id}:${current.epoch}`;
    const alreadyPersisted = (): boolean => {
      const value = this.mesh.get(key)?.value as Partial<ResidentDeliveryRecord> | undefined;
      return value?.format === RESIDENT_HOST_FORMAT &&
        value.id === record.id &&
        value.rootId === record.rootId &&
        value.from?.id === record.from.id &&
        value.delivery === record.delivery &&
        value.triggerTurn === record.triggerTurn &&
        value.epoch === record.epoch &&
        value.payloadDigest === record.payloadDigest;
    };
    try {
      await this.mesh.put({
        key,
        value: record,
        identity: this.identity,
        ifVersion: 0,
      });
      return;
    } catch (error) {
      if (alreadyPersisted()) return;
      try {
        await this.mesh.put({
          key,
          value: {
            ...record,
            message: message.slice(0, Math.max(1, this.config.mesh.eventContextChars)),
            data: { fabricTruncated: true },
          },
          identity: this.identity,
          ifVersion: 0,
        });
        return;
      } catch (fallbackError) {
        if (alreadyPersisted()) return;
        throw fallbackError instanceof Error ? fallbackError : error;
      }
    }
  }

  async #pollRequests(): Promise<void> {
    if (this.#pollingRequests || this.#closed) return;
    this.#assertCurrentOwner("request poll");
    this.#pollingRequests = true;
    try {
      let entries: string[];
      try {
        entries = fs.readdirSync(this.#requestsPath).filter((entry) => entry.endsWith(".json"));
      } catch {
        return;
      }
      for (const entry of entries.slice(0, 32)) {
        this.#assertCurrentOwner(`request ${entry}`);
        const source = path.join(this.#requestsPath, entry);
        const processing = path.join(this.#processingPath, entry);
        try {
          fs.renameSync(source, processing);
        } catch {
          continue;
        }
        await this.#processRequest(processing);
      }
    } finally {
      this.#pollingRequests = false;
      this.#checkIdle();
    }
  }

  #checkIdle(): void {
    const activeActor = this.actors
      .listOwned()
      .some((actor) => actor.residency === "durable" && actor.status !== "stopped");
    const activeAgent = this.agents
      .listForUi()
      .some((agent) => agent.status === "queued" || agent.status === "running");
    let pendingRequest = false;
    try {
      pendingRequest = fs.readdirSync(this.#requestsPath).some((entry) => entry.endsWith(".json"));
    } catch {
      // Missing request directory is empty.
    }
    if (activeActor || activeAgent || pendingRequest) {
      this.#idleSince = Date.now();
      return;
    }
    if (Date.now() - this.#idleSince >= IDLE_EXIT_MS) this.onIdle();
  }

  async #processRequest(filePath: string): Promise<void> {
    const command = this.#readCommand(filePath);
    const requestId = command?.requestId ?? path.basename(filePath, ".json");
    let response: ResidentCommandResponse;
    try {
      this.#assertCurrentOwner(`operation ${requestId}`, command?.epoch);
      if (
        command?.format !== RESIDENT_HOST_FORMAT ||
        command.rootId !== this.config.rootId ||
        command.requestId !== requestId
      ) {
        throw new Error("Invalid Fabric residency request");
      }
      if (command.operation === "spawn") {
        if (
          command.request.sessionSeed ||
          command.request.sessionFile ||
          command.request.actorId ||
          command.request.actorName ||
          command.request.meshRoot ||
          command.request.runnerSessionId ||
          command.request.systemPrompt ||
          command.request.images
        ) {
          throw new Error("Durable agents.spawn accepts only its public task and run settings");
        }
        const handle = await this.agents.spawn({ ...command.request, residency: "durable" });
        this.agents.detachSignal(handle.id);
        const runDirectory = this.agents.runDirectory(handle.id);
        if (!runDirectory) throw new Error(`Resident agent ${handle.id} has no run directory`);
        const worktreeGitRoot = this.agents.worktreeGitRoot(handle.id);
        const metadata: ResidentAgentMetadata = {
          format: RESIDENT_HOST_FORMAT,
          stateVersion: RESIDENT_STATE_VERSION,
          rootId: this.config.rootId,
          id: handle.id,
          runDirectory,
          handle: { ...handle, residency: "durable" },
          ...(worktreeGitRoot ? { worktreeGitRoot } : {}),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        atomicWrite(path.join(this.#agentsPath, `${handle.id}.json`), metadata);
        response = {
          format: RESIDENT_HOST_FORMAT,
          stateVersion: RESIDENT_STATE_VERSION,
          requestId,
          ok: true,
          handle: metadata.handle,
          completedAt: Date.now(),
        };
      } else if (command.operation === "foreground") {
        this.agents.markForeground(command.id);
        response = {
          format: RESIDENT_HOST_FORMAT,
          stateVersion: RESIDENT_STATE_VERSION,
          requestId,
          ok: true,
          completedAt: Date.now(),
        };
      } else if (command.operation === "cleanup") {
        await this.agents.wait(command.id);
        await this.agents.cleanup(command.id, command.deleteBranch);
        fs.rmSync(path.join(this.#agentsPath, `${command.id}.json`), { force: true });
        response = {
          format: RESIDENT_HOST_FORMAT,
          stateVersion: RESIDENT_STATE_VERSION,
          requestId,
          ok: true,
          completedAt: Date.now(),
        };
      } else {
        if (!this.actors.owns(command.id)) {
          throw new Error(`Resident host does not own ${command.id}`);
        }
        await this.actors.remove(command.id);
        response = {
          format: RESIDENT_HOST_FORMAT,
          stateVersion: RESIDENT_STATE_VERSION,
          requestId,
          ok: true,
          completedAt: Date.now(),
        };
      }
    } catch (error) {
      response = {
        format: RESIDENT_HOST_FORMAT,
        stateVersion: RESIDENT_STATE_VERSION,
        requestId,
        ok: false,
        error: errorMessage(error),
        completedAt: Date.now(),
      };
    }
    atomicWrite(path.join(this.#responsesPath, `${requestId}.json`), response);
    fs.rmSync(filePath, { force: true });
    this.participants.scheduleRefresh();
  }

  #recoverInterruptedRequests(): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.#processingPath).filter((entry) => entry.endsWith(".json"));
    } catch {
      return;
    }
    for (const entry of entries) {
      const requestId = path.basename(entry, ".json");
      const response: ResidentCommandResponse = {
        format: RESIDENT_HOST_FORMAT,
        stateVersion: RESIDENT_STATE_VERSION,
        requestId,
        ok: false,
        error: "Fabric residency outcome is indeterminate after resident host restart",
        completedAt: Date.now(),
      };
      atomicWrite(path.join(this.#responsesPath, entry), response);
      fs.rmSync(path.join(this.#processingPath, entry), { force: true });
    }
  }

  #acquireLock(): void {
    fs.mkdirSync(this.config.residencyRoot, { recursive: true, mode: 0o700 });
    const existing = this.#readOwnerFile();
    if (existing && processAlive(existing.pid)) {
      throw new ResidentHostAlreadyRunning(`Fabric resident host is already running (${existing.pid})`);
    }
    try {
      const descriptor = fs.openSync(this.#lockPath, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ token: this.#token, pid: process.pid }));
      fs.closeSync(descriptor);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        const locked = readJson<{ pid?: unknown }>(this.#lockPath);
        if (typeof locked?.pid === "number" && processAlive(locked.pid)) {
          throw new ResidentHostAlreadyRunning(`Fabric resident host is starting (${locked.pid})`);
        }
        fs.rmSync(this.#lockPath, { force: true });
        const descriptor = fs.openSync(this.#lockPath, "wx", 0o600);
        fs.writeFileSync(descriptor, JSON.stringify({ token: this.#token, pid: process.pid }));
        fs.closeSync(descriptor);
      } else {
        throw error;
      }
    }
  }

  #releaseLock(): void {
    const lock = readJson<{ token?: unknown }>(this.#lockPath);
    if (lock?.token === this.#token) fs.rmSync(this.#lockPath, { force: true });
    const owner = this.#readOwnerFile();
    if (owner?.token === this.#token) fs.rmSync(this.#ownerPath, { force: true });
  }

  #readOwnerFile(): ResidentOwnerState | undefined {
    const owner = readJson<unknown>(this.#ownerPath);
    return owner === undefined ? undefined : this.#migrateOwner(owner, "resident owner file");
  }

  #readMeshOwner(): { entry: MeshStateEntry; owner: ResidentOwnerState } | undefined {
    const entry = this.mesh.get(this.#ownerClaimKey);
    if (!entry) return undefined;
    return { entry, owner: this.#migrateOwner(entry.value, "mesh owner claim") };
  }

  #migrateOwner(value: unknown, source: string): ResidentOwnerState {
    const migrated = residencyProtocol.migrateResidentStateVersion1to2(value) as Partial<ResidentOwnerState>;
    const epoch = migrated.epoch;
    if (
      migrated.format !== RESIDENT_HOST_FORMAT ||
      migrated.stateVersion !== RESIDENT_STATE_VERSION ||
      migrated.hostId !== this.hostId ||
      !Number.isSafeInteger(migrated.pid) ||
      typeof migrated.token !== "string" ||
      typeof migrated.startedAt !== "number" ||
      typeof migrated.readyAt !== "number" ||
      typeof epoch !== "number" ||
      !Number.isSafeInteger(epoch) ||
      epoch < 0
    ) {
      throw new Error(`Invalid ${source} for ${this.hostId}`);
    }
    residentEpochCounter = Math.max(residentEpochCounter, epoch);
    return migrated as ResidentOwnerState;
  }

  #readCommand(filePath: string): ResidentCommand | undefined {
    const command = readJson<unknown>(filePath);
    if (command === undefined) return undefined;
    if (typeof command !== "object" || command === null || Array.isArray(command)) {
      return undefined;
    }
    const wasV1 = (command as { stateVersion?: unknown }).stateVersion === undefined;
    const migrated = residencyProtocol.migrateResidentStateVersion1to2(command);
    if (typeof migrated !== "object" || migrated === null || Array.isArray(migrated)) {
      return undefined;
    }
    const record = migrated as ResidentCommand;
    // A format-1 command predates fencing. It is accepted only by the local
    // owner that migrated it; every v2 client must name the selected epoch.
    if (wasV1) return { ...record, epoch: this.#epoch };
    if (!Number.isSafeInteger(record.epoch) || (record.epoch ?? -1) < 0) {
      throw new Error("Invalid resident command epoch");
    }
    return record;
  }

  async #claimOwnership(): Promise<ResidentOwnerState> {
    const existing = this.#readMeshOwner();
    const epoch = nextResidentEpoch((existing?.owner.epoch ?? 0) + 1);
    const now = Date.now();
    this.#startedAt = now;
    this.#readyAt = now;
    const owner: ResidentOwnerState = {
      format: RESIDENT_HOST_FORMAT,
      stateVersion: RESIDENT_STATE_VERSION,
      hostId: this.hostId,
      pid: process.pid,
      token: this.#token,
      epoch,
      startedAt: now,
      readyAt: now,
    };
    try {
      await this.mesh.put({
        key: this.#ownerClaimKey,
        value: owner,
        identity: this.identity,
        ifVersion: existing?.entry.version ?? 0,
      });
    } catch (error) {
      throw new Error(
        `stale-worker: resident host ${this.hostId} could not claim epoch ${epoch}: ${errorMessage(error)}`,
      );
    }
    this.#epoch = epoch;
    const latest = this.#readMeshOwner();
    if (!latest || latest.owner.token !== this.#token || latest.owner.epoch !== epoch) {
      const latestEpoch = latest?.owner.epoch ?? "unknown";
      this.#stepDown(
        `stale-worker: resident host ${this.hostId} epoch ${epoch} was superseded before startup by epoch ${latestEpoch}`,
      );
      throw new Error(this.#staleReason);
    }
    this.#ownershipFenceCurrent = true;
    return owner;
  }

  #assertCurrentOwner(operation: string, referencedEpoch?: number): ResidentOwnerState {
    if (this.#staleReason) throw new Error(this.#staleReason);
    const current = this.#readMeshOwner();
    if (!current) {
      const reason = `stale-worker: resident host ${this.hostId} lost ownership before ${operation}`;
      this.#stepDown(reason);
      throw new Error(reason);
    }
    if (
      current.owner.token !== this.#token ||
      !residencyProtocol.isCurrentResidentEpoch(this.#epoch, current.owner.epoch)
    ) {
      const reason =
        `stale-worker: resident host ${this.hostId} epoch ${this.#epoch} was superseded by epoch ${current.owner.epoch}`;
      this.#stepDown(reason);
      throw new Error(reason);
    }
    if (
      referencedEpoch !== undefined &&
      !residencyProtocol.isCurrentResidentEpoch(referencedEpoch, current.owner.epoch)
    ) {
      throw new Error(
        `stale-worker: ${operation} epoch ${String(referencedEpoch)} does not match current owner epoch ${current.owner.epoch}`,
      );
    }
    this.#ownershipFenceCurrent = true;
    return current.owner;
  }

  #stepDown(reason: string): void {
    this.#ownershipFenceCurrent = false;
    if (!this.#staleReason) this.#staleReason = reason;
    if (this.#requestTimer) clearInterval(this.#requestTimer);
    this.#requestTimer = undefined;
    if (this.#stepDownScheduled) return;
    this.#stepDownScheduled = true;
    queueMicrotask(() => {
      void this.close().catch(() => undefined);
    });
  }
}

export const runResidentHost = async (
  config: ResidentHostConfig,
  signal?: AbortSignal,
): Promise<void> => {
  let finishIdle: (() => void) | undefined;
  const idle = new Promise<void>((resolve) => {
    finishIdle = resolve;
  });
  const host = new ResidentHost(config, () => finishIdle?.());
  await host.start();
  if (signal?.aborted) {
    await host.close();
    return;
  }
  await Promise.race([
    idle,
    new Promise<void>((resolve) => {
      const finish = (): void => resolve();
      signal?.addEventListener("abort", finish, { once: true });
      process.once("SIGTERM", finish);
      process.once("SIGINT", finish);
    }),
  ]);
  await host.close();
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const configPath = parseConfigPath(process.argv);
  let config: ResidentHostConfig | undefined;
  try {
    config = validateConfig(readJson<unknown>(configPath), configPath);
    await runResidentHost(config);
  } catch (error) {
    if (!(error instanceof ResidentHostAlreadyRunning)) {
      const residencyRoot = config?.residencyRoot ?? path.dirname(configPath);
      try {
        atomicWrite(path.join(residencyRoot, "error.json"), {
          error: errorMessage(error),
          occurredAt: Date.now(),
        });
      } catch {
        // Startup diagnostics are best-effort.
      }
      process.exitCode = 1;
    }
  }
}
