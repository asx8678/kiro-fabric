import fs from "node:fs";
import os from "node:os";
import {
  DEFAULT_EXECUTOR_SOURCE_BYTES,
  MAX_EXECUTOR_SOURCE_BYTES,
  MIN_EXECUTOR_SOURCE_BYTES,
} from "./runtime/source-limit.js";
import type { FabricRisk } from "./protocol.js";

export type FabricApprovalMode = "allow" | "ask" | "deny";
export type FabricResultFormat = "auto" | "json" | "text";

export interface FabricExecutorConfig {
  timeoutMs: number;
  maxTimeoutMs: number;
  memoryLimitBytes: number;
  maxSourceBytes: number;
  maxInputBytes: number;
  maxOutputChars: number;
  maxNestedResultChars: number;
  maxProviderCalls: number;
  maxConcurrentProviderCalls: number;
  maxApprovalRequests: number;
  maxPendingApprovals: number;
  maxAuditEntries: number;
  maxAuditBytes: number;
  resultFormat: FabricResultFormat;
}

export interface FabricApprovalConfig extends Record<FabricRisk, FabricApprovalMode> {}

export interface FabricMcpConfig {
  enabled: boolean;
  configPath?: string;
  disableOAuth: boolean;
  callTimeoutMs: number;
}

export interface FabricMemoryConfig {
  enabled: boolean;
  maxEntries: number;
  maxValueChars: number;
}

export interface FabricStateConfig {
  enabled: boolean;
  maxEntries: number;
  maxValueChars: number;
  maxTotalChars: number;
}

export interface FabricArtifactsConfig {
  maxArtifacts: number;
  maxArtifactChars: number;
  maxTotalChars: number;
  ttlMs: number;
}

export interface FabricTracingConfig {
  enabled: boolean;
}

export interface FabricPowerConfig {
  executor: FabricExecutorConfig;
  approvals: FabricApprovalConfig;
  mcp: FabricMcpConfig;
  memory: FabricMemoryConfig;
  state: FabricStateConfig;
  artifacts: FabricArtifactsConfig;
  tracing: FabricTracingConfig;
}

const QUICKJS_MAX_MEMORY_LIMIT_BYTES = 0xffff_ffff;
const MAX_EXECUTOR_MEMORY_LIMIT_BYTES = Math.min(
  QUICKJS_MAX_MEMORY_LIMIT_BYTES,
  Math.max(8 * 1024 * 1024, Math.floor(os.totalmem())),
);

export const DEFAULT_FABRIC_POWER_CONFIG: FabricPowerConfig = {
  executor: {
    timeoutMs: 120_000,
    maxTimeoutMs: 900_000,
    memoryLimitBytes: 64 * 1024 * 1024,
    maxSourceBytes: DEFAULT_EXECUTOR_SOURCE_BYTES,
    maxInputBytes: DEFAULT_EXECUTOR_SOURCE_BYTES,
    maxOutputChars: 50_000,
    maxNestedResultChars: 2_000_000,
    maxProviderCalls: 64,
    maxConcurrentProviderCalls: 8,
    maxApprovalRequests: 16,
    maxPendingApprovals: 2,
    maxAuditEntries: 64,
    maxAuditBytes: 64_000,
    resultFormat: "auto",
  },
  approvals: { read: "allow", write: "ask", execute: "ask", network: "ask" },
  mcp: {
    enabled: true,
    disableOAuth: true,
    callTimeoutMs: 120_000,
  },
  memory: { enabled: true, maxEntries: 128, maxValueChars: 16_000 },
  state: {
    enabled: true,
    maxEntries: 1_000,
    maxValueChars: 100_000,
    maxTotalChars: 8_000_000,
  },
  artifacts: {
    maxArtifacts: 32,
    maxArtifactChars: 2_000_000,
    maxTotalChars: 8_000_000,
    ttlMs: 3_600_000,
  },
  tracing: { enabled: false },
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
const integer = (value: unknown, fallback: number, minimum: number, maximum: number): number =>
  typeof value === "number" && Number.isSafeInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;
const approval = (value: unknown, fallback: FabricApprovalMode): FabricApprovalMode =>
  value === "allow" || value === "ask" || value === "deny" ? value : fallback;

const FILE_CONFIG_KEYS: Record<string, readonly string[]> = {
  executor: ["timeoutMs", "maxTimeoutMs", "memoryLimitBytes", "maxSourceBytes", "maxInputBytes", "maxOutputChars", "maxNestedResultChars", "maxProviderCalls", "maxConcurrentProviderCalls", "maxApprovalRequests", "maxPendingApprovals", "maxAuditEntries", "maxAuditBytes", "resultFormat"],
  approvals: ["read", "write", "execute", "network"],
  mcp: ["enabled", "disableOAuth", "callTimeoutMs"],
  memory: ["enabled", "maxEntries", "maxValueChars"],
  state: ["enabled", "maxEntries", "maxValueChars", "maxTotalChars"],
  artifacts: ["maxArtifacts", "maxArtifactChars", "maxTotalChars", "ttlMs"],
  tracing: ["enabled"],
};
const assertFileConfigShape = (value: unknown): void => {
  const root = record(value);
  if (!root) throw new Error("configuration root must be an object");
  for (const [section, raw] of Object.entries(root)) {
    const allowed = FILE_CONFIG_KEYS[section];
    if (!allowed) throw new Error(`unknown configuration section: ${section}`);
    const fields = record(raw);
    if (!fields) throw new Error(`configuration section must be an object: ${section}`);
    for (const field of Object.keys(fields)) {
      if (!allowed.includes(field)) throw new Error(`unknown configuration field: ${section}.${field}`);
    }
  }
};

export const normalizeFabricPowerConfig = (
  input: unknown,
  defaults: FabricPowerConfig = DEFAULT_FABRIC_POWER_CONFIG,
): FabricPowerConfig => {
  const root = record(input) ?? {};
  const executor = record(root.executor) ?? {};
  const approvals = record(root.approvals) ?? {};
  const mcp = record(root.mcp) ?? {};
  const memory = record(root.memory) ?? {};
  const state = record(root.state) ?? {};
  const artifacts = record(root.artifacts) ?? {};
  const tracing = record(root.tracing) ?? {};
  const timeoutMs = integer(executor.timeoutMs, defaults.executor.timeoutMs, 1, 900_000);
  const maxTimeoutMs = integer(executor.maxTimeoutMs, defaults.executor.maxTimeoutMs, timeoutMs, 900_000);
  const resultFormat = executor.resultFormat === "json" || executor.resultFormat === "text" || executor.resultFormat === "auto"
    ? executor.resultFormat
    : defaults.executor.resultFormat;
  return {
    executor: {
      timeoutMs,
      maxTimeoutMs,
      memoryLimitBytes: integer(executor.memoryLimitBytes, defaults.executor.memoryLimitBytes, 8 * 1024 * 1024, MAX_EXECUTOR_MEMORY_LIMIT_BYTES),
      maxSourceBytes: integer(executor.maxSourceBytes, defaults.executor.maxSourceBytes, MIN_EXECUTOR_SOURCE_BYTES, MAX_EXECUTOR_SOURCE_BYTES),
      maxInputBytes: integer(executor.maxInputBytes, defaults.executor.maxInputBytes, 1_024, MAX_EXECUTOR_SOURCE_BYTES),
      maxOutputChars: integer(executor.maxOutputChars, defaults.executor.maxOutputChars, 1_000, 2_000_000),
      maxNestedResultChars: integer(executor.maxNestedResultChars, defaults.executor.maxNestedResultChars, 1_000, 8_000_000),
      maxProviderCalls: integer(executor.maxProviderCalls, defaults.executor.maxProviderCalls, 1, 1_000),
      maxConcurrentProviderCalls: integer(executor.maxConcurrentProviderCalls, defaults.executor.maxConcurrentProviderCalls, 1, 64),
      maxApprovalRequests: integer(executor.maxApprovalRequests, defaults.executor.maxApprovalRequests, 0, 1_000),
      maxPendingApprovals: integer(executor.maxPendingApprovals, defaults.executor.maxPendingApprovals, 1, 32),
      maxAuditEntries: integer(executor.maxAuditEntries, defaults.executor.maxAuditEntries, 1, 1_000),
      maxAuditBytes: integer(executor.maxAuditBytes, defaults.executor.maxAuditBytes, 1_000, 1_000_000),
      resultFormat,
    },
    approvals: {
      read: approval(approvals.read, defaults.approvals.read),
      write: approval(approvals.write, defaults.approvals.write),
      execute: approval(approvals.execute, defaults.approvals.execute),
      network: approval(approvals.network, defaults.approvals.network),
    },
    mcp: {
      enabled: bool(mcp.enabled, defaults.mcp.enabled),
      ...(typeof mcp.configPath === "string" && mcp.configPath ? { configPath: mcp.configPath } : defaults.mcp.configPath ? { configPath: defaults.mcp.configPath } : {}),
      disableOAuth: bool(mcp.disableOAuth, defaults.mcp.disableOAuth),
      callTimeoutMs: integer(mcp.callTimeoutMs, defaults.mcp.callTimeoutMs, 1_000, maxTimeoutMs),
    },
    memory: {
      enabled: bool(memory.enabled, defaults.memory.enabled),
      maxEntries: integer(memory.maxEntries, defaults.memory.maxEntries, 1, 128),
      maxValueChars: integer(memory.maxValueChars, defaults.memory.maxValueChars, 1_000, 16_000),
    },
    state: {
      enabled: bool(state.enabled, defaults.state.enabled),
      maxEntries: integer(state.maxEntries, defaults.state.maxEntries, 1, 10_000),
      maxValueChars: integer(state.maxValueChars, defaults.state.maxValueChars, 1_000, 2_000_000),
      maxTotalChars: integer(state.maxTotalChars, defaults.state.maxTotalChars, 4_096, 32_000_000),
    },
    artifacts: {
      maxArtifacts: integer(artifacts.maxArtifacts, defaults.artifacts.maxArtifacts, 1, 128),
      maxArtifactChars: integer(artifacts.maxArtifactChars, defaults.artifacts.maxArtifactChars, 1_000, 8_000_000),
      maxTotalChars: integer(artifacts.maxTotalChars, defaults.artifacts.maxTotalChars, 1_000, 32_000_000),
      ttlMs: integer(artifacts.ttlMs, defaults.artifacts.ttlMs, 1_000, 86_400_000),
    },
    tracing: {
      enabled: bool(tracing.enabled, defaults.tracing.enabled),
    },
  };
};

const MAX_CONFIG_BYTES = 256 * 1024;

export const loadFabricPowerConfig = (configFile: string, defaults = DEFAULT_FABRIC_POWER_CONFIG): FabricPowerConfig => {
  let descriptor: number | undefined;
  let observed = false;
  try {
    const lexicalStats = fs.lstatSync(configFile);
    observed = true;
    if (!lexicalStats.isFile() || lexicalStats.isSymbolicLink() || lexicalStats.nlink !== 1) {
      throw new Error("configuration must be a private regular file");
    }
    descriptor = fs.openSync(
      configFile,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink !== 1 ||
        stats.dev !== lexicalStats.dev || stats.ino !== lexicalStats.ino) {
      throw new Error("configuration changed while it was being opened");
    }
    if (stats.size > MAX_CONFIG_BYTES) throw new Error("configuration exceeds 262144 bytes");
    if (process.platform !== "win32") {
      if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
        throw new Error("configuration must be owned by the current user");
      }
      if ((stats.mode & 0o077) !== 0) throw new Error("configuration permissions must be private");
    }
    // Read at most one byte beyond the limit from the verified descriptor.
    // This preserves the bound even if another same-user process grows the
    // file after fstat and avoids reopening a swapped pathname.
    const buffer = Buffer.allocUnsafe(MAX_CONFIG_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = fs.readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break;
      bytes += count;
    }
    if (bytes > MAX_CONFIG_BYTES) throw new Error("configuration exceeds 262144 bytes");
    const value: unknown = JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
    assertFileConfigShape(value);
    return normalizeFabricPowerConfig(value, defaults);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !observed) {
      return normalizeFabricPowerConfig(undefined, defaults);
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
};
