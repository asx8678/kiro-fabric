// Ordered Kiro timeout envelope: inner work must settle before MCP and profile deadlines.
export const KIRO_EXECUTION_TIMEOUT_MS = 900_000;
export const KIRO_MCP_CALL_TIMEOUT_MS = 930_000;
/** Rebinding/shutdown must not wait forever for an abort-insensitive execution. */
export const KIRO_MCP_DRAIN_TIMEOUT_MS = 5_000;
export const KIRO_PROFILE_REQUEST_TIMEOUT_MS = 960_000;
