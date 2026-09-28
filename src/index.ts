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
export {
  FABRIC_RUNTIME_PROVIDER_INVENTORY,
  FABRIC_RUNTIME_PROVIDER_NAMES,
  FABRIC_RUNTIME_PROVIDER_REQUIREMENTS,
  type FabricProviderInventoryEntry,
} from "./kiro/provider-inventory.js";
export { FabricRepairError, FabricCompilerTimeoutError } from "./core/repair-error.js";
export type { KiroArtifactReadResult } from "./kiro/artifacts.js";
export type { KiroArtifactCheckpointResult } from "./kiro/power/artifacts-provider.js";
export type { CatalogBinding, CatalogMethod, CatalogPageOptions, CatalogContinuation, CatalogPage, DescriptorJsonPage } from "./core/catalog-contract.js";
export { remoteRef, parseRemoteRef, MAX_REMOTE_REF_CHARS } from "./core/remote-identity.js";
export { ActionRegistry } from "./core/action-registry.js";
export { LocalCodingProvider } from "./providers/local-provider.js";
export { FoveaProvider } from "./providers/repo-provider.js";
export { FoveaHost } from "./fovea/host.js";
export { KiroHostSessionAdapter, type KiroHostSession, type KiroHostTurn } from "./kiro/host-session-adapter.js";
export type { FoveaHostOptions, FoveaBoundClient } from "./fovea/host.js";
export type { RepoNavigationPacket, RepoReadWindow, RepoCoverage, RepoSourceCoverage, RepoSourceCoverageReason, RepoImportCoverage, RepoImportCoverageExample } from "./providers/repo-contract.js";
export { formatLocalEvidence } from "./providers/local-evidence.js";
export { buildRunProvenance, parseRunProvenanceDeclaration } from "./kiro/run-provenance.js";
export type { RunProvenanceInput, RunProvenanceConfiguredInput, RunProvenanceObservedInput, RunProvenanceManifest } from "./kiro/run-provenance.js";
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
  FabricArtifactAccess,
  FabricArtifactReadResult,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderRequirements,
  FabricProviderStatus,
  ResolvedFabricAction,
  ObservedFabricAction,
  McpToolDescriptor,
} from "./protocol.js";
export type {
  FabricApprovalConfig,
  FabricApprovalMode,
  FabricArtifactsConfig,
  FabricExecutorConfig,
  FabricMcpConfig,
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
