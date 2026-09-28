import { FoveaProvider } from "../providers/repo-provider.js";
import type { FoveaBoundClient } from "../fovea/host.js";
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
import { KiroPowerArtifactsProvider } from "./power/artifacts-provider.js";
import { FABRIC_RUNTIME_PROVIDER_NAMES } from "./provider-inventory.js";

export interface KiroRuntimeOptions {
  cwd: string;
  configFile: string;
  mcpConfigPath: string;
  artifactsRoot: string;
  /** Only the binding authority may supply a verified root; cwd alone grants nothing. */
  workspaceRoot?: string;
  localLockRoot?: string;
  /** Borrowed host-owned analysis lease; provider disposal never closes its engine. */
  foveaClient?: FoveaBoundClient;
  stateRoot?: string;
  config?: FabricConfig;
  /** Host-issued client/workspace authorization; never accepted from guest arguments. */
  catalogBinding?: Omit<import("../core/catalog-contract.js").CatalogBinding, "runtimeNonce">;
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
    registry.register(new LocalCodingProvider({
      root: options.workspaceRoot,
      lockRoot: options.localLockRoot,
      maxResultChars: config.executor.maxNestedResultChars,
      // Leave visible headroom for formatting/metadata without raising shell or search caps.
      // Composing several results or logs can still overflow; the projection retains that evidence.
      maxReadManyChars: Math.floor(config.executor.maxOutputChars * 0.8),
    }));
  } else registry.markUnavailable("local", "verified workspace binding is required");
  if (options.workspaceRoot && options.foveaClient) registry.register(new FoveaProvider(options.foveaClient));
  else registry.markUnavailable("repo", "verified workspace and persistent host binding are required");
  registry.register(new KiroPowerArtifactsProvider(artifacts, config.artifacts));
  if (config.mcp.enabled) registry.register(new KiroMcpProvider(options.cwd, config.mcp));
  else registry.markUnavailable("mcp", "disabled by configuration");
  if (options.stateRoot && config.state.enabled) registry.register(new StateProvider(options.stateRoot, config.state));
  else registry.markUnavailable("state", config.state.enabled ? "workspace binding is required" : "disabled by configuration");
  // Fail closed if the documented current inventory and the mounted registry
  // ever diverge. This is an internal consistency guard; it does not change
  // which providers mount, their order, or their requirements policy.
  const mountedNames = registry.providers().map((provider) => provider.name).sort();
  const inventoryNames = [...FABRIC_RUNTIME_PROVIDER_NAMES].sort();
  if (JSON.stringify(mountedNames) !== JSON.stringify(inventoryNames)) {
    throw new Error(`runtime provider inventory drift: mounted=[${mountedNames.join(",")}] expected=[${inventoryNames.join(",")}]`);
  }
  const service = new FabricExecutionService(registry, config, options.cwd);
  if (options.catalogBinding) service.bindCatalog(options.catalogBinding);
  let closing: Promise<void> | undefined;
  return {
    service,
    registry,
    artifacts,
    providers: () => registry.providers(),
    close() {
      if (closing) return closing;
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      // Start service revocation synchronously, but publish the shared promise
      // first. Artifact disposal remains after the actual service drain.
      void (async () => {
        const failures: unknown[] = [];
        try { await service.close(); } catch (error) { failures.push(error); }
        try { artifacts.close(); } catch (error) { failures.push(error); }
        if (failures.length) throw new AggregateError(failures, "Kiro runtime shutdown failed");
      })().then(resolve, reject);
      return closing;
    }
  };
};
