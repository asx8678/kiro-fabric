import type { FabricConfig } from "../config.js";
import type { AiCache } from "../cache.js";
import type { PermissionGate } from "../permissions.js";
import type { AiRunner } from "../runners/types.js";
import type { BudgetState, AiResult } from "./budget.js";

export type MutationMode = "clean" | "checkpoint";

export interface MutationSession {
  checkpointId: string;
  checkpointRef?: string;
  baseHead: string;
  mode: MutationMode;
  label?: string;
  createdFiles: Set<string>;
  modifiedFiles: Set<string>;
}

export type AiRunFn = <T = unknown>(input: unknown, signal?: AbortSignal) => Promise<AiResult<T>>;

/** Shared state threaded through every fabric.* domain factory. */
export interface ApiContext {
  config: FabricConfig;
  root: string;
  runner: AiRunner;
  budgets: BudgetState;
  cache: AiCache;
  gate: PermissionGate;
  mutationSession: MutationSession | undefined;
  mutationWriteRequired: () => MutationSession;
  recordMutationWrite: (
    session: MutationSession,
    target: { absolute: string; relative: string },
    existed: boolean,
  ) => void;
  aiRun: AiRunFn;
}
