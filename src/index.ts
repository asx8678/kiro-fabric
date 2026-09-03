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
export { ActionRegistry } from "./core/action-registry.js";
export type {
  FabricActionDescriptor,
  FabricActionEffect,
  FabricProvider,
  FabricProviderStatus,
} from "./protocol.js";
export type {
  FabricApprovalConfig,
  FabricApprovalMode,
  FabricArtifactsConfig,
  FabricExecutorConfig,
  FabricMcpConfig,
  FabricMemoryConfig,
  FabricConfig,
  /** @deprecated Use FabricConfig. */
  FabricConfig as FabricPowerConfig,
  FabricResultFormat,
  FabricStateConfig,
  FabricTracingConfig,
} from "./config.js";
export {
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
