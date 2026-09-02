import type { ProcessInstanceIdentity } from "../core/process-instance.js";

export interface OperationLockProcessObservation {
  liveness: "alive" | "missing" | "indeterminate";
  identity?: ProcessInstanceIdentity;
}

type OperationLockProcessProbe = (pid: number) => OperationLockProcessObservation;

let activeProbe: OperationLockProcessProbe | undefined;

export const currentOperationLockProcessProbeForTest = (): OperationLockProcessProbe | undefined =>
  activeProbe;

/** Test-only deterministic process-instance seam. Production never selects a
 * probe from environment or install inputs. */
export const withOperationLockProcessProbeForTest = async <T>(
  probe: OperationLockProcessProbe,
  operation: () => Promise<T>,
): Promise<T> => {
  if (activeProbe) throw new Error("operation-lock process probe is already active");
  activeProbe = probe;
  try {
    return await operation();
  } finally {
    activeProbe = undefined;
  }
};
