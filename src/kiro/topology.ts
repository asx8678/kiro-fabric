import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { loadFabricConfig } from "../config.js";
import { resolveAgentDir } from "../core/agent-dir.js";
import {
  MeshCompareAndSwapError,
  MeshStore,
} from "../mesh/store.js";
import { resolveKiroProjectRoot } from "./managed.js";

const PARTICIPANT_PREFIX = "topology/participants/";
const HOST_PREFIX = "topology/hosts/";
const TOPOLOGY_FORMAT = 1 as const;
const KIRO_TOPOLOGY_VERSION = 1 as const;
export const KIRO_TOPOLOGY_DEFAULT_LEASE_MS = 15_000;
const MAX_LEASE_MS = 24 * 60 * 60 * 1_000;
const CLAIM_ATTEMPTS = 5;
const HEARTBEAT_ATTEMPTS = 3;

export interface RecordKiroTopologyInput {
  rootId: string;
  actorId?: string;
  sessionId?: string;
  roles: string[];
  parent?: string;
}

export interface KiroTopologyMarker {
  host: "kiro";
  version: typeof KIRO_TOPOLOGY_VERSION;
  roles: string[];
  actorId?: string;
  sessionId?: string;
  parent?: string;
  lease?: {
    ownerToken: string;
    durationMs: number;
  };
  notes: {
    session: string;
    durability: string;
  };
}

export type KiroParticipantKind = "root" | "agent" | "actor";

export interface KiroTopologyIdentity {
  id: string;
  name: string;
  kind: "main" | "actor" | "agent";
  sessionId?: string;
}

export interface KiroParticipantTopologyRecord {
  format: typeof TOPOLOGY_FORMAT;
  id: string;
  kind: KiroParticipantKind;
  rootId: string;
  ownerHostId: string;
  ownerIdentityId: string;
  parentId?: string;
  name: string;
  status: "running";
  runner: "kiro";
  transport: "host";
  capabilities: [];
  sessionId?: string;
  startedAt: number;
  updatedAt: number;
  controlProtocol: "v1";
  kiro: KiroTopologyMarker;
}

export interface KiroHostTopologyRecord {
  format: typeof TOPOLOGY_FORMAT;
  id: string;
  rootId: string;
  identity: KiroTopologyIdentity;
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
  kiro: KiroTopologyMarker;
}

interface KiroTopologyStateEntry {
  value: unknown;
  version: number;
}

export interface KiroTopologyWriteResult {
  meshRoot: string;
  participantKey: string;
  hostKey: string;
  participant: KiroParticipantTopologyRecord;
  host: KiroHostTopologyRecord;
}

export interface KiroTopologyLeaseOptions {
  /** Lease lifetime after each successful heartbeat. Defaults to 15 seconds. */
  leaseMs?: number;
}

export interface KiroTopologyLeaseCloseResult {
  participantDeleted: boolean;
  hostDeleted: boolean;
  ownershipLost: boolean;
}

export interface KiroTopologyLease {
  readonly ownerToken: string;
  readonly leaseMs: number;
  readonly meshRoot: string;
  readonly participantKey: string;
  readonly hostKey: string;
  readonly participant: KiroParticipantTopologyRecord;
  readonly host: KiroHostTopologyRecord;
  readonly closed: boolean;
  heartbeat(): Promise<KiroTopologyWriteResult>;
  close(): Promise<KiroTopologyLeaseCloseResult>;
}

export class KiroTopologyLeaseLostError extends Error {
  constructor() {
    super("The Kiro topology lease is no longer the owner of its mesh records");
    this.name = "KiroTopologyLeaseLostError";
  }
}

const keyFor = (prefix: string, id: string): string =>
  prefix + createHash("sha256").update(id).digest("hex");

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeRoles = (roles: string[]): string[] => {
  const normalized = [...new Set(roles.map((role) => role.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error("Kiro topology roles must be non-empty");
  return normalized;
};

const participantKindOf = (
  roles: string[],
  actorId: string | undefined,
): KiroParticipantKind => {
  if (roles.includes("root") || roles.includes("main")) return "root";
  if (roles.includes("actor")) return "actor";
  if (roles.includes("agent") || roles.includes("child") || actorId) return "agent";
  return "agent";
};

const participantIdOf = (input: {
  kind: KiroParticipantKind;
  rootId: string;
  actorId?: string;
  sessionId?: string;
  roles: string[];
}): string => {
  if (input.kind === "root") return input.rootId;
  if (input.actorId) return input.actorId;
  if (input.sessionId) return `kiro:${input.sessionId}`;
  return `kiro:${input.rootId}:${input.roles.join("+")}`;
};

const identityKindOf = (kind: KiroParticipantKind): KiroTopologyIdentity["kind"] =>
  kind === "root" ? "main" : kind;

const markerFor = (input: {
  kind: KiroParticipantKind;
  roles: string[];
  actorId?: string;
  sessionId?: string;
  parent?: string;
  lease?: { ownerToken: string; durationMs: number };
}): KiroTopologyMarker => ({
  host: "kiro",
  version: KIRO_TOPOLOGY_VERSION,
  roles: input.roles,
  ...(input.actorId ? { actorId: input.actorId } : {}),
  ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  ...(input.parent ? { parent: input.parent } : {}),
  ...(input.lease ? { lease: input.lease } : {}),
  notes: {
    session: input.sessionId
      ? "Ephemeral Kiro session reference only; no private Kiro session database is read or written."
      : "No Kiro sessionId was provided; this record is topology-only metadata.",
    durability: input.lease
      ? "This record is fenced by an explicit renewable Kiro topology lease; its owner must heartbeat or close it."
      : input.kind === "actor"
        ? "Actor durability is not inferred here; durable ownership, recovery, and leases remain Fabric-owned elsewhere."
        : "This record does not claim durable ownership; it only publishes the current Kiro participant into shared topology.",
  },
});

const displayNameOf = (kind: KiroParticipantKind, roles: string[], participantId: string): string => {
  const suffix = roles.join("/");
  if (kind === "root") return suffix ? `kiro:${suffix}` : "kiro:root";
  return suffix ? `kiro:${suffix}:${participantId}` : `kiro:${participantId}`;
};

const resolveMeshRoot = (): string => {
  const projectRoot = resolveKiroProjectRoot(
    process.env.KIRO_FABRIC_PROJECT_ROOT ?? process.cwd(),
  );
  const config = loadFabricConfig({
    cwd: projectRoot,
    agentDir: resolveAgentDir(),
    projectTrusted: false,
  });
  if (!config.mesh.enabled) {
    throw new Error(
      'Kiro topology is unavailable because mesh.enabled=false; topology records stay fail-closed without shared mesh state.',
    );
  }
  return process.env.KIRO_FABRIC_MESH_ROOT ??
    (config.mesh.root
      ? path.resolve(projectRoot, config.mesh.root)
      : path.join(projectRoot, ".pi", "fabric", "mesh"));
};

export const recordKiroTopology = async (
  input: RecordKiroTopologyInput,
): Promise<KiroTopologyWriteResult> => {
  const prepared = prepareTopology(input, Date.now());
  const mesh = new MeshStore(prepared.meshRoot, 256 * 1024, 500);
  await mesh.put({
    key: prepared.hostKey,
    value: prepared.host,
    identity: prepared.host.identity,
  });
  await mesh.put({
    key: prepared.participantKey,
    value: prepared.participant,
    identity: prepared.host.identity,
  });
  return prepared;
};

const prepareTopology = (
  input: RecordKiroTopologyInput,
  now: number,
  lease?: { ownerToken: string; durationMs: number },
): KiroTopologyWriteResult => {
  const roles = normalizeRoles(input.roles);
  const kind = participantKindOf(roles, input.actorId);
  const participantId = participantIdOf({
    kind,
    rootId: input.rootId,
    roles,
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  const marker = markerFor({
    kind,
    roles,
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.parent ? { parent: input.parent } : {}),
    ...(lease ? { lease } : {}),
  });
  const meshRoot = resolveMeshRoot();
  const hostId = `kiro-host:${participantId}`;
  const hostIdentity: KiroTopologyIdentity = {
    id: participantId,
    name: displayNameOf(kind, roles, participantId),
    kind: identityKindOf(kind),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
  const participant: KiroParticipantTopologyRecord = {
    format: TOPOLOGY_FORMAT,
    id: participantId,
    kind,
    rootId: input.rootId,
    ownerHostId: hostId,
    ownerIdentityId: hostIdentity.id,
    ...(kind === "root" ? {} : { parentId: input.parent ?? input.rootId }),
    name: hostIdentity.name,
    status: "running",
    runner: "kiro",
    transport: "host",
    capabilities: [],
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    startedAt: now,
    updatedAt: now,
    controlProtocol: "v1",
    kiro: marker,
  };
  const host: KiroHostTopologyRecord = {
    format: TOPOLOGY_FORMAT,
    id: hostId,
    rootId: input.rootId,
    identity: hostIdentity,
    startedAt: now,
    updatedAt: now,
    expiresAt: now + (lease?.durationMs ?? KIRO_TOPOLOGY_DEFAULT_LEASE_MS),
    kiro: marker,
  };
  const hostKey = keyFor(HOST_PREFIX, host.id);
  const participantKey = keyFor(PARTICIPANT_PREFIX, participant.id);
  return { meshRoot, participantKey, hostKey, participant, host };
};

const normalizeLeaseMs = (value: number | undefined): number => {
  const leaseMs = Math.floor(value ?? KIRO_TOPOLOGY_DEFAULT_LEASE_MS);
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0 || leaseMs > MAX_LEASE_MS) {
    throw new Error(`Kiro topology leaseMs must be an integer between 1 and ${MAX_LEASE_MS}`);
  }
  return leaseMs;
};

const ownerTokenOf = (entry: KiroTopologyStateEntry | undefined): string | undefined => {
  if (!entry || !isObject(entry.value)) return undefined;
  const marker = entry.value.kiro;
  if (!isObject(marker)) return undefined;
  const lease = marker.lease;
  if (!isObject(lease)) return undefined;
  return typeof lease.ownerToken === "string" ? lease.ownerToken : undefined;
};

const entryRecord = <T>(entry: KiroTopologyStateEntry): T => entry.value as T;

const putClaim = async (
  mesh: MeshStore,
  key: string,
  value: unknown,
  identity: KiroTopologyIdentity,
): Promise<KiroTopologyStateEntry> => {
  const occupied = mesh.get(key);
  return mesh.put({
    key,
    value,
    identity,
    ...(occupied ? { ifVersion: occupied.version } : {}),
  });
};

const deleteOwned = async (
  mesh: MeshStore,
  key: string,
  ownerToken: string,
): Promise<{ deleted: boolean; ownershipLost: boolean }> => {
  for (let attempt = 0; attempt < HEARTBEAT_ATTEMPTS; attempt += 1) {
    const entry = mesh.get(key);
    if (!entry) return { deleted: false, ownershipLost: false };
    if (ownerTokenOf(entry) !== ownerToken) return { deleted: false, ownershipLost: true };
    try {
      const result = await mesh.delete({ key, ifVersion: entry.version });
      return { deleted: result.deleted, ownershipLost: false };
    } catch (error) {
      if (!(error instanceof MeshCompareAndSwapError)) throw error;
      if (ownerTokenOf(mesh.get(key)) !== ownerToken) {
        return { deleted: false, ownershipLost: true };
      }
    }
  }
  return { deleted: false, ownershipLost: ownerTokenOf(mesh.get(key)) !== ownerToken };
};

class KiroTopologyLeaseHandle implements KiroTopologyLease {
  #snapshot: KiroTopologyWriteResult;
  #closed = false;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly mesh: MeshStore,
    snapshot: KiroTopologyWriteResult,
    readonly ownerToken: string,
    readonly leaseMs: number,
  ) {
    this.#snapshot = snapshot;
  }

  get meshRoot(): string {
    return this.#snapshot.meshRoot;
  }

  get participantKey(): string {
    return this.#snapshot.participantKey;
  }

  get hostKey(): string {
    return this.#snapshot.hostKey;
  }

  get participant(): KiroParticipantTopologyRecord {
    return this.#snapshot.participant;
  }

  get host(): KiroHostTopologyRecord {
    return this.#snapshot.host;
  }

  get closed(): boolean {
    return this.#closed;
  }

  async heartbeat(): Promise<KiroTopologyWriteResult> {
    return this.#enqueue(() => this.#heartbeat());
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async #heartbeat(): Promise<KiroTopologyWriteResult> {
    if (this.#closed) throw new Error("The Kiro topology lease is closed");
    const loseLease = async (): Promise<never> => {
      await deleteOwned(this.mesh, this.participantKey, this.ownerToken).catch(() => undefined);
      await deleteOwned(this.mesh, this.hostKey, this.ownerToken).catch(() => undefined);
      throw new KiroTopologyLeaseLostError();
    };
    for (let attempt = 0; attempt < HEARTBEAT_ATTEMPTS; attempt += 1) {
      const hostEntry = this.mesh.get(this.hostKey);
      const participantEntry = this.mesh.get(this.participantKey);
      if (
        ownerTokenOf(hostEntry) !== this.ownerToken ||
        ownerTokenOf(participantEntry) !== this.ownerToken
      ) {
        return loseLease();
      }
      const currentHost = entryRecord<KiroHostTopologyRecord>(hostEntry!);
      const currentParticipant = entryRecord<KiroParticipantTopologyRecord>(participantEntry!);
      const now = Math.max(Date.now(), currentHost.updatedAt + 1, currentParticipant.updatedAt + 1);
      const host: KiroHostTopologyRecord = {
        ...currentHost,
        updatedAt: now,
        expiresAt: now + this.leaseMs,
      };
      const participant: KiroParticipantTopologyRecord = {
        ...currentParticipant,
        status: "running",
        updatedAt: now,
      };
      try {
        await this.mesh.put({
          key: this.hostKey,
          value: host,
          identity: host.identity,
          ifVersion: hostEntry!.version,
        });
        await this.mesh.put({
          key: this.participantKey,
          value: participant,
          identity: host.identity,
          ifVersion: participantEntry!.version,
        });
        if (
          ownerTokenOf(this.mesh.get(this.hostKey)) !== this.ownerToken ||
          ownerTokenOf(this.mesh.get(this.participantKey)) !== this.ownerToken
        ) {
          return loseLease();
        }
        this.#snapshot = { ...this.#snapshot, host, participant };
        return this.#snapshot;
      } catch (error) {
        if (!(error instanceof MeshCompareAndSwapError)) throw error;
        if (
          ownerTokenOf(this.mesh.get(this.hostKey)) !== this.ownerToken ||
          ownerTokenOf(this.mesh.get(this.participantKey)) !== this.ownerToken
        ) {
          return loseLease();
        }
      }
    }
    throw new Error("Kiro topology heartbeat could not acquire a stable mesh version");
  }

  async close(): Promise<KiroTopologyLeaseCloseResult> {
    return this.#enqueue(() => this.#close());
  }

  async #close(): Promise<KiroTopologyLeaseCloseResult> {
    if (this.#closed) {
      return { participantDeleted: false, hostDeleted: false, ownershipLost: false };
    }
    let participant: Awaited<ReturnType<typeof deleteOwned>> | undefined;
    let host: Awaited<ReturnType<typeof deleteOwned>> | undefined;
    let participantError: unknown;
    let hostError: unknown;
    try {
      participant = await deleteOwned(this.mesh, this.participantKey, this.ownerToken);
    } catch (error) {
      participantError = error;
    }
    // Always attempt both records. If either delete fails, leave the handle
    // open so a later close() can retry the still-owned remainder.
    try {
      host = await deleteOwned(this.mesh, this.hostKey, this.ownerToken);
    } catch (error) {
      hostError = error;
    }
    if (participantError || hostError) {
      throw participantError ?? hostError;
    }
    this.#closed = true;
    return {
      participantDeleted: participant!.deleted,
      hostDeleted: host!.deleted,
      ownershipLost: participant!.ownershipLost || host!.ownershipLost,
    };
  }
}

/**
 * Explicitly publish renewable Kiro topology records. No runtime calls this
 * automatically: callers own both the heartbeat cadence and lifecycle close.
 */
export const createKiroTopologyLease = async (
  input: RecordKiroTopologyInput,
  options: KiroTopologyLeaseOptions = {},
): Promise<KiroTopologyLease> => {
  const leaseMs = normalizeLeaseMs(options.leaseMs);
  const ownerToken = randomUUID();
  let lastPrepared: KiroTopologyWriteResult | undefined;
  let mesh: MeshStore | undefined;

  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const prepared = prepareTopology(input, Date.now(), { ownerToken, durationMs: leaseMs });
    lastPrepared = prepared;
    mesh ??= new MeshStore(prepared.meshRoot, 256 * 1024, 500);
    try {
      await putClaim(mesh, prepared.hostKey, prepared.host, prepared.host.identity);
      await putClaim(mesh, prepared.participantKey, prepared.participant, prepared.host.identity);
      if (
        ownerTokenOf(mesh.get(prepared.hostKey)) === ownerToken &&
        ownerTokenOf(mesh.get(prepared.participantKey)) === ownerToken
      ) {
        return new KiroTopologyLeaseHandle(mesh, prepared, ownerToken, leaseMs);
      }
    } catch (error) {
      await deleteOwned(mesh, prepared.participantKey, ownerToken).catch(() => undefined);
      await deleteOwned(mesh, prepared.hostKey, ownerToken).catch(() => undefined);
      if (!(error instanceof MeshCompareAndSwapError)) throw error;
      continue;
    }
    await deleteOwned(mesh, prepared.participantKey, ownerToken).catch(() => undefined);
    await deleteOwned(mesh, prepared.hostKey, ownerToken).catch(() => undefined);
  }

  if (mesh && lastPrepared) {
    await deleteOwned(mesh, lastPrepared.participantKey, ownerToken);
    await deleteOwned(mesh, lastPrepared.hostKey, ownerToken);
  }
  throw new Error("Kiro topology lease could not claim stable mesh records");
};

export const isKiroNode = (entry: KiroTopologyStateEntry): boolean => {
  if (!isObject(entry.value)) return false;
  const marker = entry.value.kiro;
  if (!isObject(marker)) return false;
  return marker.host === "kiro" && marker.version === KIRO_TOPOLOGY_VERSION;
};
