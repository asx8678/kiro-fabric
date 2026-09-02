export const KIRO_MCP_DEADLINE_GRACE_MS = 2_000;
export const KIRO_MCP_DRAIN_TIMEOUT_MS = 3_000;

export const kiroMcpOuterDeadlineMs = (
  guestMaximumMs: number,
  compilerTimeoutMs: number,
): number => guestMaximumMs + compilerTimeoutMs + KIRO_MCP_DEADLINE_GRACE_MS;
