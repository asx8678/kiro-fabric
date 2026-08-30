// Kiro Fabric public entry. Pi extension lifecycle integration is intentionally not exported.
export * from "./kiro/index.js";
export * from "./kernel/index.js";
export * from "./verification/index.js";
export {
  PREWALK_DECISION_ENTRY_TYPE,
  effectiveFabricPrewalkActivation,
  evaluateFabricPrewalkGate,
  type FabricPrewalkGateDecision,
  type FabricPrewalkGateReason,
} from "./prewalk/gate.js";
export type { FabricPrewalkActivation } from "./config.js";
