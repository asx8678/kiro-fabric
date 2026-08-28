// Kiro public surface: profile generation + runtime/server constructors.

export {
  KIRO_ACP_AUTH_METHOD,
  KIRO_AGENT_ENGINE,
  KIRO_CLI_VERSION,
  generateKiroProfile,
  kiroProfilePath,
  type KiroProfileDocument,
  type KiroProfileOptions,
} from "./profile.js";
export {
  assertKiroV3AgentModeAvailable,
  buildKiroV3SessionParams,
  KIRO_V3_AGENT_MODE,
  type KiroV3SessionParams,
} from "./v3-session.js";
export {
  applyKiroRuntimeScope,
  createKiroRuntime,
  prepareKiroRuntime,
  type KiroCapabilityLease,
  type KiroExecutionPartial,
  type KiroExecutionRequest,
  type KiroExecutionService,
  type KiroProviderRegistry,
  type KiroRuntime,
  type KiroRuntimeOptions,
} from "./runtime.js";
export { createKiroMcpServer, type KiroMcpServerOptions } from "./mcp-server.js";
export {
  KIRO_MODEL_OUTPUT_MAX_CHARS,
  projectFabricExecutionText,
  type FabricExecTextProjection,
  type KiroProjectionExecutionResult,
  type KiroProjectionTypeError,
} from "./projection.js";
export {
  FabricDenyApprovalFallback,
  type FabricExecutionHost,
  type FabricHostApprover,
  type FabricHostAutoApprovalDecision,
  type FabricResolvedAction,
  type FabricUsage,
} from "./host.js";
export {
  installKiroProfile,
  planKiroProfileInstall,
  resolveKiroProjectRoot,
  KiroInstallError,
  KIRO_INSTALL_MANIFEST_FORMAT,
  type KiroInstallAction,
  type KiroInstallOptions,
  type KiroInstallPlan,
  type KiroInstallResult,
} from "./install.js";
export {
  planKiroProfileUninstall,
  uninstallKiroProfile,
  type KiroUninstallAction,
  type KiroUninstallOptions,
  type KiroUninstallPlan,
  type KiroUninstallResult,
} from "./uninstall.js";
export {
  resolveKiroHome,
  resolveKiroInstallRoots,
  type KiroInstallRoots,
} from "./home.js";
export {
  runKiroDoctor,
  type KiroDoctorCheck,
  type KiroDoctorOptions,
  type KiroDoctorReport,
} from "./doctor.js";
export {
  KIRO_SEMANTIC_CONTEXT_MAX_CHARS,
  KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS,
  KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
  KIRO_SEMANTIC_CONTEXT_MAX_OBJECTIVE_CHARS,
  composeKiroSemanticHandoff,
  handoffFidelityOf,
  normalizeKiroSemanticContext,
  type KiroHandoffFidelity,
  type KiroSemanticContextPacket,
  type KiroSemanticHandoffContext,
  type KiroSemanticHandoffEnvelope,
} from "./handoff.js";
export {
  KIRO_TOPOLOGY_DEFAULT_LEASE_MS,
  KiroTopologyLeaseLostError,
  createKiroTopologyLease,
  isKiroNode,
  recordKiroTopology,
  type KiroHostTopologyRecord,
  type KiroParticipantKind,
  type KiroParticipantTopologyRecord,
  type KiroTopologyLease,
  type KiroTopologyLeaseCloseResult,
  type KiroTopologyLeaseOptions,
  type KiroTopologyMarker,
  type KiroTopologyIdentity,
  type KiroTopologyWriteResult,
  type RecordKiroTopologyInput,
} from "./topology.js";
export {
  neverNativeTranscriptOK,
  kiroFeatureDiagnostics,
  kiroParsiveFidelity,
  type KiroFeatureDiagnosticRow,
  type KiroFeatureName,
  type KiroFeatureSupport,
} from "./diagnostics.js";
export {
  KiroMemoryScopeError,
  openKiroMemory,
  type KiroMemoryBinding,
  type KiroMemoryEntry,
} from "./memory.js";

export {
  KIRO_CLAIMS_KIND,
  KIRO_CLAIMS_SCHEMA_VERSION,
  REQUIRED_KIRO_CLAIMS,
  buildKiroClaimsReport,
  fail,
  isKiroClaimResult,
  isKiroClaimsReport,
  pass,
  skipped,
  type KiroClaimId,
  type KiroClaimResult,
  type KiroClaimsReport,
  type KiroClaimSurface,
} from "./claims.js";
