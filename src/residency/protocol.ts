import { createHash } from "node:crypto";
import path from "node:path";
import type { FabricOwnedModelGuidance } from "../components/model-guidance.js";
import type { FabricAgentConfig, FabricMeshConfig, FabricRetentionConfig } from "../config.js";
import type { AgentHandleInfo, AgentRunRequest } from "../agents/types.js";
import type { MeshIdentity } from "../mesh/store.js";

export const RESIDENT_HOST_FORMAT = 1 as const;
export const RESIDENT_STATE_VERSION = 2 as const;
const RESIDENT_DELIVERY_PREFIX = "residency/deliveries/";
const RESIDENT_OWNER_PREFIX = "residency/owners/";

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const residentDeliveryPayloadDigest = (
  delivery: "steer" | "followUp",
  message: string,
): string => digest(`${delivery}\0${message}`);

export const isValidResidentEpoch = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const assertResidentEpoch = (value: unknown, label = "resident epoch"): number => {
  if (!isValidResidentEpoch(value)) throw new Error(`Invalid ${label}: ${String(value)}`);
  return value;
};

export const migrateResidentStateVersion1to2 = (record: unknown): unknown => {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  const stateVersion = (record as { stateVersion?: unknown }).stateVersion;
  const candidateEpoch = (record as { epoch?: unknown }).epoch;
  if (stateVersion === RESIDENT_STATE_VERSION) {
    assertResidentEpoch(candidateEpoch, "resident state epoch");
    return record;
  }
  if (typeof stateVersion === "number" && stateVersion > RESIDENT_STATE_VERSION) {
    throw new Error(`Unsupported resident state version: ${stateVersion}`);
  }
  if (stateVersion !== undefined) {
    throw new Error(`Invalid resident state version: ${String(stateVersion)}`);
  }
  const epoch = candidateEpoch === undefined
    ? 0
    : assertResidentEpoch(candidateEpoch, "resident state epoch");
  return {
    ...(record as Record<string, unknown>),
    stateVersion: RESIDENT_STATE_VERSION,
    epoch,
  };
};

/** Historical ordering helper; protocol acceptance must use exact equality. */
export const isStaleEpoch = (candidate: number, current: number): boolean =>
  assertResidentEpoch(candidate, "candidate epoch") < assertResidentEpoch(current, "current epoch");

export const isCurrentResidentEpoch = (candidate: unknown, current: unknown): boolean =>
  isValidResidentEpoch(candidate) && isValidResidentEpoch(current) && candidate === current;

export const residentHostId = (rootId: string): string =>
  `resident:${digest(rootId).slice(0, 24)}`;

export const residentRoot = (meshRoot: string, rootId: string): string =>
  path.join(meshRoot, "residency", digest(rootId));

export const residentDeliveryPrefix = (rootId: string): string =>
  `${RESIDENT_DELIVERY_PREFIX}${digest(rootId).slice(0, 32)}/`;

export const residentOwnerClaimKey = (rootId: string): string =>
  `${RESIDENT_OWNER_PREFIX}${residentHostId(rootId)}`;

export interface ResidentHostConfig {
  format: typeof RESIDENT_HOST_FORMAT;
  rootId: string;
  sessionId: string;
  cwd: string;
  projectRoot: string;
  meshRoot: string;
  actorRoot: string;
  residencyRoot: string;
  fullCodeMode: boolean;
  agents: FabricAgentConfig;
  mesh: FabricMeshConfig;
  retention: FabricRetentionConfig;
  workerPath: string;
  fabricExtensionPath: string;
  piBinary: string;
  claudeBinary: string;
  vedaBinary: string;
  /** Optional; older format-1 hosts default to kiro-cli. */
  kiroBinary?: string;
  modelGuidance?: FabricOwnedModelGuidance[];
}

export interface ResidentHostOwner {
  format: typeof RESIDENT_HOST_FORMAT;
  stateVersion?: typeof RESIDENT_STATE_VERSION;
  hostId: string;
  pid: number;
  token: string;
  startedAt: number;
  readyAt: number;
  epoch?: number;
}

interface ResidentCommandBase {
  format: typeof RESIDENT_HOST_FORMAT;
  stateVersion?: typeof RESIDENT_STATE_VERSION;
  /** Owner epoch selected by the client; absent only on migrated v1 commands. */
  epoch?: number;
}

interface ResidentSpawnCommand extends ResidentCommandBase {
  operation: "spawn";
  requestId: string;
  rootId: string;
  request: AgentRunRequest;
  createdAt: number;
}

interface ResidentCleanupCommand extends ResidentCommandBase {
  operation: "cleanup";
  requestId: string;
  rootId: string;
  id: string;
  deleteBranch: boolean;
  createdAt: number;
}

interface ResidentForegroundCommand extends ResidentCommandBase {
  operation: "foreground";
  requestId: string;
  rootId: string;
  id: string;
  createdAt: number;
}

interface ResidentRemoveActorCommand extends ResidentCommandBase {
  operation: "removeActor";
  requestId: string;
  rootId: string;
  id: string;
  createdAt: number;
}

export type ResidentCommand =
  | ResidentSpawnCommand
  | ResidentCleanupCommand
  | ResidentForegroundCommand
  | ResidentRemoveActorCommand;

export interface ResidentCommandResponse {
  format: typeof RESIDENT_HOST_FORMAT;
  stateVersion?: typeof RESIDENT_STATE_VERSION;
  requestId: string;
  ok: boolean;
  handle?: AgentHandleInfo;
  error?: string;
  completedAt: number;
}

export interface ResidentAgentMetadata {
  format: typeof RESIDENT_HOST_FORMAT;
  stateVersion?: typeof RESIDENT_STATE_VERSION;
  rootId: string;
  id: string;
  runDirectory: string;
  handle: AgentHandleInfo;
  worktreeGitRoot?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResidentDeliveryRecord {
  format: typeof RESIDENT_HOST_FORMAT;
  stateVersion?: typeof RESIDENT_STATE_VERSION;
  id: string;
  rootId: string;
  from: MeshIdentity;
  delivery: "steer" | "followUp";
  triggerTurn: boolean;
  message: string;
  data?: unknown;
  createdAt: number;
  epoch?: number;
  payloadDigest?: string;
}
