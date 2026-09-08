import type { ManagedSearchExecutable } from "../providers/local-executable.js";
import { ActionRegistry } from "../core/action-registry.js";
import {
  DEFAULT_FABRIC_CONFIG,
  loadFabricConfig,
  normalizeFabricConfig,
  type FabricConfig,
} from "../config.js";
import { FabricExecutionService } from "../execution-service.js";
import type { FabricProviderStatus } from "../protocol.js";
import { StateProvider } from "../providers/state-provider.js";
import { LocalCodingProvider } from "../providers/local-provider.js";
import { FabricBootstrapProvider } from "./bootstrap-provider.js";
import { createKiroArtifactStore, type KiroArtifactStore } from "./artifacts.js";
import { KiroMcpProvider } from "./mcp-provider.js";
import { KiroMemoryProvider } from "./memory-provider.js";
import { KiroPowerArtifactsProvider } from "./power/artifacts-provider.js";

export interface KiroRuntimeOptions {
  cwd: string;
  configFile: string;
  mcpConfigPath: string;
  artifactsRoot: string;
  /** Only the binding authority may supply a verified root; cwd alone grants nothing. */
  workspaceRoot?: string;
  localLockRoot?: string;
  managedSearch?: ManagedSearchExecutable;
  memoryRoot?: string;
  memoryNamespace?: string;
  stateRoot?: string;
  config?: FabricConfig;
}

export interface KiroRuntime {
  service: FabricExecutionService;
  registry: ActionRegistry;
  artifacts: KiroArtifactStore;
  providers(): FabricProviderStatus[];
  close(): Promise<void>;
}

export const createKiroRuntime = (options: KiroRuntimeOptions): KiroRuntime => {
  const loaded = options.config ?? loadFabricConfig(options.configFile, DEFAULT_FABRIC_CONFIG);
  const config = normalizeFabricConfig({
    ...loaded,
    mcp: { ...loaded.mcp, configPath: options.mcpConfigPath },
  });
  const registry = new ActionRegistry();
  const artifacts = createKiroArtifactStore({ root: options.artifactsRoot, ...config.artifacts });
  registry.register(new FabricBootstrapProvider(config.executor.maxNestedResultChars));
  if (options.workspaceRoot && options.localLockRoot) {
    registry.register(new LocalCodingProvider({ root: options.workspaceRoot, lockRoot: options.localLockRoot, maxResultChars: config.executor.maxNestedResultChars, ...(options.managedSearch ? { managedSearch: options.managedSearch } : {}) }));
  } else registry.markUnavailable("local", "verified workspace binding is required");
  registry.register(new KiroPowerArtifactsProvider(artifacts));
  if (config.mcp.enabled) registry.register(new KiroMcpProvider(options.cwd, config.mcp));
  else registry.markUnavailable("mcp", "disabled by configuration");
  if (options.memoryRoot && config.memory.enabled) {
    registry.register(new KiroMemoryProvider({
      cwd: options.cwd,
      root: options.memoryRoot,
      ...(options.memoryNamespace ? { namespace: options.memoryNamespace } : {}),
      maxEntries: config.memory.maxEntries,
      maxValueChars: config.memory.maxValueChars,
    }));
  }
  else registry.markUnavailable("memory", config.memory.enabled ? "workspace binding is required" : "disabled by configuration");
  if (options.stateRoot && config.state.enabled) registry.register(new StateProvider(options.stateRoot, config.state));
  else registry.markUnavailable("state", config.state.enabled ? "workspace binding is required" : "disabled by configuration");
  const service = new FabricExecutionService(registry, config, options.cwd);
  return {
    service,
    registry,
    artifacts,
    providers: () => registry.providers(),
    async close() {
      try { await service.close(); } finally { artifacts.close(); }
    },
  };
};
