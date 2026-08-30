import type { FabricPrewalkGateDecision } from "./prewalk/gate.js";

const BOUNDARY_SYMBOL = Symbol.for("kiro-fabric.benchmark-boundary.v1");

interface BenchmarkBoundary {
  document: Record<string, unknown>;
  emit(event: unknown): void;
}

const boundary = (): BenchmarkBoundary | undefined => {
  const value = (globalThis as Record<symbol, unknown>)[BOUNDARY_SYMBOL];
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<BenchmarkBoundary>;
  if (!candidate.document || typeof candidate.document !== "object" || typeof candidate.emit !== "function") {
    return undefined;
  }
  return candidate as BenchmarkBoundary;
};

/** Controller-provided config held only in the isolated Pi process. */
export const benchmarkTreatmentDocument = (): Record<string, unknown> | undefined =>
  boundary()?.document;

/**
 * Send prewalk telemetry over the controller's write-only channel. Returning
 * true means the event must not also be appended to the candidate session.
 */
export const emitPrivateBenchmarkPrewalkDecision = (
  decision: FabricPrewalkGateDecision,
  result: { armed: boolean; skipReason?: string },
): boolean => {
  const target = boundary();
  if (!target) return false;
  target.emit({
    type: "prewalk-decision",
    data: {
      ...decision,
      armed: result.armed,
      ...(result.skipReason ? { skipReason: result.skipReason } : {}),
    },
  });
  return true;
};

export const hasPrivateBenchmarkBoundary = (): boolean => boundary() !== undefined;
