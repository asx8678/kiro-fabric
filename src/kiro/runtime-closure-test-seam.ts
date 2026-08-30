// Deterministic filesystem-race seam. Not exported by the package.

export type RuntimeClosureQuarantineKind = "generation" | "marker";

type BeforeQuarantine = (kind: RuntimeClosureQuarantineKind, source: string) => void;
let beforeQuarantine: BeforeQuarantine | undefined;

export const runBeforeRuntimeQuarantineForTest = (
  kind: RuntimeClosureQuarantineKind,
  source: string,
): void => beforeQuarantine?.(kind, source);

export const withRuntimeQuarantineRaceForTest = <T>(
  hook: BeforeQuarantine,
  operation: () => T,
): T => {
  if (beforeQuarantine) throw new Error("runtime quarantine race seam is already active");
  beforeQuarantine = hook;
  try {
    return operation();
  } finally {
    beforeQuarantine = undefined;
  }
};
