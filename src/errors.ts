export type ErrorCode = "TYPECHECK_FAILED" | "RUNTIME_FAILED" | "CONFIG_ERROR" | "BUDGET_EXCEEDED" | "TIMEOUT" | "CANCELLED" | "INVALID_AI_OUTPUT" | "POLICY_DENIED";
export class FabricError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly details?: unknown) { super(message); this.name = "FabricError"; }
}
export const exitCode = (code: ErrorCode): number => ({ TYPECHECK_FAILED: 2, RUNTIME_FAILED: 1, CONFIG_ERROR: 3, BUDGET_EXCEEDED: 4, TIMEOUT: 5, CANCELLED: 6, INVALID_AI_OUTPUT: 7, POLICY_DENIED: 1 } satisfies Record<ErrorCode, number>)[code];
export function errorObject(error: unknown): { code: string; message: string; diagnostics?: unknown } {
  if (error instanceof FabricError) return { code: error.code, message: error.message, ...(error.details === undefined ? {} : { diagnostics: error.details }) };
  return { code: "RUNTIME_FAILED", message: error instanceof Error ? error.message : String(error) };
}