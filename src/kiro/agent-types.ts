import type { FabricThinking } from "../thinking.js";

export type KiroAgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "timed_out";

type KiroAgentTransport =
  | "auto"
  | "process"
  | "tmux"
  | "screen"
  | "localterm"
  | "herdr";

export interface KiroImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface KiroAgentRunRequest {
  task: string;
  name?: string;
  /** Managed Kiro always launches the `kiro-cli` ACP runner. */
  runner?: "kiro";
  transport?: "auto" | "process";
  model?: string;
  thinking?: FabricThinking;
  tools?: string[];
  timeoutMs?: number;
  cwd?: string;
  kiroResidency?: "one-shot" | "resident";
  suppressThinkingDefault?: boolean;
  kiroContext?: {
    objective?: string;
    facts?: string[];
    relevantFiles?: string[];
    constraints?: string[];
    exclusions?: string[];
  };
  /** Rejected by the managed Kiro manager; retained only for fail-fast validation. */
  recursive?: boolean;
  /** Rejected by the managed Kiro manager; it never creates worktrees. */
  worktree?: boolean;
  /** Only session-local requests are accepted. */
  residency?: "session" | "durable";
  schema?: Record<string, unknown>;
  systemPrompt?: string;
}

interface KiroAgentUsage {
  availability?: "available" | "unavailable";
  reason?: "runner-does-not-report" | "worker-did-not-report";
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface KiroAgentRunRecord {
  format?: 2;
  id: string;
  name: string;
  task: string;
  status: KiroAgentRunStatus;
  /** Logical runner identifier for the `kiro-cli` ACP process. */
  runner: "kiro";
  /** Engine provenance for ACP sessions; v2 session ids must never be loaded here. */
  kiroAgentEngine?: "v3";
  /**
   * SHA-256 over the security-relevant session configuration (adapter, CLI
   * version, agent engine/auth, custom-agent prompt/tools/permissions, MCP
   * server identity, cwd, model, effort). A saved session is only resumed when
   * the current configuration reproduces the same digest; any profile or
   * security change forces a fresh session instead of silently resuming under
   * a different boundary.
   */
  kiroSessionProfileSha256?: string;
  transport: KiroAgentTransport;
  cwd: string;
  model?: string;
  thinking?: FabricThinking;
  actorId?: string;
  actorName?: string;
  capabilityRequirements?: string[];
  capabilityDigest?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  currentTool?: string;
  turns: number;
  toolCalls: number;
  text: string;
  value?: unknown;
  error?: string;
  stderr?: string;
  exitCode?: number | null;
  usage: KiroAgentUsage;
  sessionId?: string;
  runnerSessionId?: string;
  branch?: string;
  worktree?: string;
  logFile?: string;
  pendingMessages?: { steering: string[]; followUp: string[] };
}

export interface KiroAgentRunResult extends KiroAgentRunRecord {
  status: "completed" | "failed" | "stopped" | "timed_out";
}

export interface KiroAgentHandleInfo {
  id: string;
  name: string;
  status: KiroAgentRunStatus;
  runner: "kiro";
  transport: "process";
  cwd: string;
  model?: string;
  thinking?: FabricThinking;
  sessionId?: string;
  runnerSessionId?: string;
}

export interface KiroAgentTransportHandle {
  kind: "process";
  sessionId?: string;
  isAlive(): Promise<boolean>;
  stop(): Promise<void>;
}

interface KiroFabricLogLine {
  index?: number;
  offset: number;
  raw: string;
  parsed?: unknown;
}

export interface KiroAgentLog {
  id: string;
  runDirectory: string;
  logFile: string;
  status?: KiroAgentRunRecord;
  events: KiroFabricLogLine[];
  hasMore: boolean;
  before?: number;
}

export type KiroSteeringMode = "all" | "one-at-a-time";

export interface KiroAgentSteerEntry {
  type: "steer" | "follow_up" | "set_steering_mode" | "set_follow_up_mode";
  id: string;
  message?: string;
  mode?: KiroSteeringMode;
  data?: unknown;
  ts: number;
}

export interface KiroAgentSteerResult {
  queued: true;
  messageId: string;
}
