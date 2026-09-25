// Focused W6 safety boundaries; not full behavioral or native-client qualification.
import { createAdmissionCases, requiredIds as admissionIds } from "./w6-admission-cases.mjs";
import { createRuntimeBoundaryCases, requiredIds as runtimeIds } from "./w6-runtime-cases.mjs";

export const requiredIds = [...admissionIds, ...runtimeIds].sort();

/** @returns {any[]} */
export function createCases() {
  return [...createAdmissionCases(), ...createRuntimeBoundaryCases()]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
