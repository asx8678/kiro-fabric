import { isFabricAgentRunner } from "./runners.js";
import {
  AGENT_RUN_RECORD_FORMAT,
  isAvailableUsage,
  unavailableUsage,
  type AgentRunRecord,
  type AgentUnavailableReason,
  type AgentUsage,
} from "./types.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberField = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseAvailableUsage = (value: Record<string, unknown>): AgentUsage | undefined => {
  const input = numberField(value.input);
  const output = numberField(value.output);
  const cacheRead = numberField(value.cacheRead);
  const cacheWrite = numberField(value.cacheWrite);
  const cost = numberField(value.cost);
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    cost === undefined
  ) {
    return undefined;
  }
  return {
    availability: "available",
    input,
    output,
    cacheRead,
    cacheWrite,
    cost,
  };
};

export const parseAgentUsage = (
  value: unknown,
  options?: { unavailableReason?: AgentUnavailableReason },
): AgentUsage | undefined => {
  if (!isObject(value)) return undefined;
  if (value.availability === "unavailable") {
    const reason =
      value.reason === "runner-does-not-report" || value.reason === "worker-did-not-report"
        ? value.reason
        : options?.unavailableReason ?? "worker-did-not-report";
    return unavailableUsage(reason);
  }
  return parseAvailableUsage(value);
};

export const parseAgentRunRecord = (value: unknown): AgentRunRecord | undefined => {
  if (!isObject(value)) return undefined;
  const format = value.format;
  if (format !== undefined && format !== AGENT_RUN_RECORD_FORMAT && format !== 1) {
    return undefined;
  }
  const runner =
    value.runner === undefined
      ? "pi"
      : isFabricAgentRunner(value.runner)
        ? value.runner
        : undefined;
  if (runner === undefined) return undefined;
  const usage = parseAgentUsage(value.usage, {
    unavailableReason:
      runner === "kiro" ? "runner-does-not-report" : "worker-did-not-report",
  });
  if (!usage) return undefined;
  const record = value as unknown as AgentRunRecord;
  if (format === AGENT_RUN_RECORD_FORMAT) {
    return {
      ...record,
      format: AGENT_RUN_RECORD_FORMAT,
      runner,
      usage,
    };
  }
  const legacyUsage =
    usage.availability === "unavailable"
      ? usage
      : {
          input: usage.input,
          output: usage.output,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
          cost: usage.cost,
        };
  return {
    ...record,
    runner,
    usage: legacyUsage,
  };
};

export const serializeAgentRunRecord = (record: AgentRunRecord): AgentRunRecord => ({
  ...record,
  format: AGENT_RUN_RECORD_FORMAT,
  usage: isAvailableUsage(record.usage)
    ? {
        availability: "available",
        input: record.usage.input,
        output: record.usage.output,
        cacheRead: record.usage.cacheRead,
        cacheWrite: record.usage.cacheWrite,
        cost: record.usage.cost,
      }
    : unavailableUsage(record.usage.reason ?? "worker-did-not-report"),
});
