export {
  createKiroMcpServer,
  supportsKiroElicitation,
  /** @deprecated Use supportsKiroElicitation. */
  supportsKiroElicitation as supportsKiroPowerElicitation,
  type KiroMcpServerOptions,
} from "./kiro/mcp-server.js";
export {
  createKiroRuntime,
  type KiroRuntime,
  type KiroRuntimeOptions,
} from "./kiro/runtime.js";
export { FabricRepairError, FabricCompilerTimeoutError } from "./core/repair-error.js";
export type { KiroArtifactReadResult } from "./kiro/artifacts.js";
export type { KiroArtifactCheckpointResult } from "./kiro/power/artifacts-provider.js";
export { ActionRegistry } from "./core/action-registry.js";
export { LocalCodingProvider } from "./providers/local-provider.js";
export { formatLocalEvidence } from "./providers/local-evidence.js";
export { ReviewProvider } from "./providers/review-provider.js";
export { buildRunProvenance, parseRunProvenanceDeclaration } from "./kiro/run-provenance.js";
export type { RunProvenanceInput, RunProvenanceConfiguredInput, RunProvenanceObservedInput, RunProvenanceManifest } from "./kiro/run-provenance.js";
export { ProbeProvider, ProbeRunExitError } from "./providers/probe-provider.js";
export { WebProvider, browserHarnessEnvironment, resolveBrowserHarnessExecutable, verifyBrowserHarnessExecutable } from "./providers/web-provider.js";
export type { BrowserHarnessExecutable, WebOpenOutput, WebSearchOutput, WebSearchResult } from "./providers/web-provider.js";
export { PROBE_ACTION_DESCRIPTORS, PROBE_GUEST_DECLARATIONS } from "./providers/probe-contract.js";
export { REVIEW_GUEST_DECLARATIONS } from "./providers/review-contract.js";
export type * from "./providers/review-contract.js";
export type * from "./providers/probe-contract.js";
export type {
  LocalProviderOptions, LocalReadArguments, LocalGrepArguments, LocalFindArguments,
  LocalReadWindow, LocalReadManyArguments, LocalSourceWindow, LocalReadManyResult, LocalShellInput,
  LocalReadEvidenceArguments, LocalReadEvidenceResult, LocalEvidenceMetadata,
  LocalListArguments, LocalWriteArguments, LocalEditArguments, LocalShellArguments,
  LocalIdentity, LocalReadResult, LocalSearchScope, LocalGrepResult, LocalFindResult, LocalListResult,
  LocalMutationResult, LocalShellResult, LocalShellOptions,
} from "./providers/local-contract.js";
export type {
  FabricActionDescriptor,
  FabricActionEffect,
  FabricToolAnnotations,
  FabricFailureMetadata,
  FabricCheckpointHandle,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderStatus,
} from "./protocol.js";
export type {
  FabricApprovalConfig,
  FabricApprovalMode,
  FabricArtifactsConfig,
  FabricExecutorConfig,
  FabricMcpConfig,
  FabricWebConfig,
  FabricMemoryConfig,
  FabricConfig,
  /** @deprecated Use FabricConfig. */
  FabricConfig as FabricPowerConfig,
  FabricResultFormat,
  FabricStateConfig,
  FabricTracingConfig,
} from "./config.js";
export {
  CURRENT_FABRIC_CONFIG_SCHEMA_VERSION,
  DEFAULT_FABRIC_CONFIG,
  loadFabricConfig,
  normalizeFabricConfig,
  /** @deprecated Use DEFAULT_FABRIC_CONFIG. */
  DEFAULT_FABRIC_CONFIG as DEFAULT_FABRIC_POWER_CONFIG,
  /** @deprecated Use loadFabricConfig. */
  loadFabricConfig as loadFabricPowerConfig,
  /** @deprecated Use normalizeFabricConfig. */
  normalizeFabricConfig as normalizeFabricPowerConfig,
} from "./config.js";
export type {
  KiroWorkspaceContextStatus,
  KiroWorkspaceRoot,
  WorkspaceContextProvider,
} from "./kiro/power/workspace-context.js";
export * from "./kernel/index.js";
