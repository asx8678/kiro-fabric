// Kiro-facing MCP adapter. Host-neutral execution seam: builds a standalone
// ActionRegistry + FabricExecutionService against a fail-closed Kiro host.
// No Pi host packages are imported here beyond the structural core-tools provider,
// exposed to Kiro as k.read/k.write/... without a live extension runner.

import { createHash } from "node:crypto";
import path from "node:path";
import { ActionRegistry } from "../core/action-registry.js";
import type {
  FabricCapabilityResolution,
  FabricCommittedCapabilityView,
  FabricInvocationContext,
  FabricProvider,
} from "../protocol.js";
import { resolveAgentDir } from "../core/agent-dir.js";
import { FabricSessionApprovals } from "../core/session-approvals.js";
import { FabricExecutionService } from "../execution-service.js";
import { loadFabricConfig, type FabricConfig } from "../config.js";
import { KiroToolsProvider } from "./tools-provider.js";
import { createKiroAgentsProvider } from "./agents-host.js";
import { KiroMcpProvider } from "./mcp-provider.js";
import { KiroMemoryProvider } from "./memory-provider.js";
import { MeshStore } from "../mesh/store.js";
import { StateProvider } from "../providers/state-provider.js";
import { KiroPowerFabricApprover, type KiroPowerApprover } from "./power/approver.js";
import { KiroPowerArtifactsProvider } from "./power/artifacts-provider.js";
import { createKiroArtifactStore, type KiroArtifactStore } from "./artifacts.js";
import {
  FabricDenyApprovalFallback,
  type FabricExecutionHost,
} from "./host.js";
import {
  kiroChildToolRefs,
  parseKiroChildTools,
  type KiroChildTool,
} from "./run-scope.js";
import { KIRO_EXECUTION_TIMEOUT_MS } from "./deadlines.js";
import { assertKiroAccountingCompatible } from "./accounting-compatibility.js";
import type { KiroProjectionExecutionResult } from "./projection.js";
import type { KiroIntegrationMode } from "./integration-mode.js";

export interface KiroCapabilityLease extends FabricCapabilityResolution {
  release(): Promise<void>;
}

/** Public registry seam for adding host-neutral providers to managed Kiro. */
export interface KiroProviderRegistry {
  register(provider: FabricProvider, options?: { overwrite?: boolean }): void;
  has(name: string): boolean;
  markUnavailable(name: string, reason: string): void;
  providers(): Array<{ name: string; description: string }>;
  unavailableProviders(): Array<{ name: string; reason: string }>;
  acquireCapabilityView(
    requirements: readonly string[],
    context: FabricInvocationContext,
  ): Promise<KiroCapabilityLease>;
  close(): Promise<void>;
}

export interface KiroExecutionPartial {
  audits: unknown[];
  phases: string[];
  progress?: string;
}

export interface KiroExecutionRequest {
  code: string;
  strings?: Record<string, string>;
  signal: AbortSignal | undefined;
  parentToolCallId: string;
  host: FabricExecutionHost;
  tokenBudget?: number;
  maxAgentCalls?: number;
  display?: { name?: string; description?: string };
  onPartial(snapshot: KiroExecutionPartial): void;
}

/** Host-neutral execution seam exposed from the Kiro package entry. */
export interface KiroExecutionService {
  readonly config: FabricConfig;
  execute(options: KiroExecutionRequest): Promise<KiroProjectionExecutionResult>;
  setCapabilityView(view: FabricCommittedCapabilityView | undefined): void;
}

export interface KiroRuntimeOptions {
  cwd: string;
  /** Explicit host boundary. Omitted only for backwards-compatible Strict callers. */
  integration?: KiroIntegrationMode;
  /**
   * Trusted-local opt-in: allow execute-risk actions (e.g. `k.bash`) to run
   * without approval. Defaults to false; the managed profile enables it only
   * when installed with --allow-shell. Only set this on a trusted local machine.
   */
  allowExecute?: boolean;
  /** Override config (tests); defaults to loading from the host-owned agent directory. */
  config?: FabricConfig;
  /** Host-owned configuration directory. Power sets this beneath PLUGIN_DATA. */
  agentDir?: string;
  /** Power-only explicit Mcporter configuration; must be beneath PLUGIN_DATA. */
  powerMcpConfigPath?: string;
  /** Extra providers to register (tests). */
  registerProviders?: (registry: KiroProviderRegistry) => void;
  /**
   * Trusted-local opt-in for bounded Kiro ACP subagent fan-out. Managed
   * profiles set this only when installed with --subagents; shell execution
   * must also be enabled so children can verify their findings.
   */
  enableSubagents?: boolean;
  /** Agent worker module override (tests/embedded hosts). */
  agentWorkerPath?: string;
  /** Agent run store override (tests/embedded hosts). */
  agentRunRoot?: string;
  /** Kiro CLI executable override; defaults to KIRO_FABRIC_KIRO_BINARY or kiro-cli. */
  kiroBinary?: string;
  /** Known model inventory override for tests/embedded hosts. */
  agentAvailableModelIds?: readonly string[];
  /** Persistent Kiro memory root override (tests/embedded hosts). */
  memoryRoot?: string;
  /** Power-only state root. Omitted while no source workspace is bound. */
  stateRoot?: string;
  /** Power-only standards-based approve-once elicitation bridge. */
  powerApprover?: KiroPowerApprover;
  /**
   * When provided (including `[]`), commit a capability view so only those
   * portable `k.*` tools are discoverable or callable. Omitted means Kiro Main
   * unrestricted mode.
   */
  tools?: readonly string[];
}

export interface KiroRuntime {
  service: KiroExecutionService;
  host: FabricExecutionHost;
  registry: KiroProviderRegistry;
  artifacts: KiroArtifactStore;
  close(): Promise<void>;
}

const scopeContext = (cwd: string) => ({
  cwd,
  signal: undefined,
  parentToolCallId: "kiro:scope",
  nestedToolCallId: "kiro:scope",
  extensionContext: makeKiroContext(cwd),
  update() {},
});

export const applyKiroRuntimeScope = async (
  runtime: KiroRuntime,
  tools: readonly string[],
): Promise<KiroChildTool[]> => {
  const parsed = parseKiroChildTools(tools);
  const lease = await runtime.registry.acquireCapabilityView(
    kiroChildToolRefs(parsed),
    scopeContext(runtime.host.cwd),
  );
  if (!lease.satisfied || !lease.view) {
    throw new Error(
      `Kiro child tools are unavailable: ${lease.missing.join(", ") || "<none>"}`,
    );
  }
  runtime.service.setCapabilityView(lease.view);
  const previous = runtime.close.bind(runtime);
  runtime.close = async () => {
    await lease.release();
    await previous();
  };
  return parsed;
};

export const prepareKiroRuntime = async (
  options: KiroRuntimeOptions,
): Promise<KiroRuntime> => {
  const runtime = createKiroRuntime(options);
  if (options.tools) await applyKiroRuntimeScope(runtime, options.tools);
  return runtime;
};

const KIRO_UNAVAILABLE_REASON =
  "Managed Kiro exposes no MCP elicitation approval bridge; approval-requiring actions fail closed";

/**
 * Minimal structural ExtensionContext for standalone `k.*` tool definitions.
 * The shared core tool definitions only need `cwd`; the rest are inert.
 */
const makeKiroContext = (cwd: string): FabricInvocationContext["extensionContext"] =>
  ({
    cwd,
    hasUI: false,
    model: undefined,
    modelRegistry: {
      getAvailable: () => [],
      find: () => undefined,
    },
  });

export const createKiroRuntime = (options: KiroRuntimeOptions): KiroRuntime => {
  // The agent (configuration) directory must never be the project cwd: an
  // untrusted repository-owned fabric.json would otherwise be loaded as the
  // "global" configuration and silently govern this runtime's approval and
  // executor policy. Resolve the real user Fabric agent directory instead.
  const base = options.config ?? loadFabricConfig({
    cwd: options.cwd,
    agentDir: options.agentDir ?? resolveAgentDir(),
    projectTrusted: false,
  });
  if (options.enableSubagents === true) {
    assertKiroAccountingCompatible(base.agents, true);
  }
  // Kiro hosts always run full-code mode so `k.*` coding tools are available;
  // the outer fabric_exec tool is the only model-visible surface.
  //
  // Trusted-local shell knob: k.bash is an execute-risk action that the
  // fail-closed approver denies unless its risk mode is `allow`. Flip that on
  // here only when explicitly requested (option or KIRO_FABRIC_ALLOW_SHELL=1)
  // so a trusted local session can run shell while the default stays deny.
  //
  // Execute is never inherited from a user/global default that happened to be
  // "allow": unless the explicit opt-in is present, the policy is forced to
  // DENY, so a Kiro host cannot grant shell access by mere omission.
  const power = options.integration === "power";
  const allowExecute =
    options.allowExecute === true ||
    (!power && /^1$/i.test(process.env.KIRO_FABRIC_ALLOW_SHELL ?? ""));
  if (options.enableSubagents === true && !allowExecute) {
    throw new Error(
      "Managed Kiro subagents require trusted-local shell access; install with --allow-shell --subagents",
    );
  }
  const config: FabricConfig = {
    ...base,
    fullCodeMode: true,
    executor: {
      ...base.executor,
      // Inner work must settle before the MCP deadline and the profile
      // request timeout, so the outer transport always observes a final
      // result instead of a dead call. Trusted-shell runs get the full
      // 15-minute execution window; orchestration may extend up to it but
      // never past the MCP envelope.
      timeoutMs: allowExecute
        ? Math.max(base.executor.timeoutMs, KIRO_EXECUTION_TIMEOUT_MS)
        : Math.min(base.executor.timeoutMs, KIRO_EXECUTION_TIMEOUT_MS),
    },
    agents: options.enableSubagents === true
      ? {
          ...base.agents,
          // Four scoped children matched the useful native-Kiro comparison;
          // larger fan-outs duplicated review work and increased cost. Agent
          // deadlines must fit inside the Kiro MCP execution envelope: a
          // valid child must settle before the outer call aborts.
          maxConcurrent: Math.min(base.agents.maxConcurrent, 4),
          maxPerExecution: Math.min(base.agents.maxPerExecution, 4),
          maxDepth: 1,
          timeoutMs: Math.min(base.agents.timeoutMs, KIRO_EXECUTION_TIMEOUT_MS),
        }
      : base.agents,
    approvals: {
      ...base.approvals,
      execute: allowExecute ? "allow" : "deny",
      network: power ? "ask" : base.approvals.network,
    },
    mcp: {
      ...base.mcp,
      ...(power
        ? {
            ...(options.powerMcpConfigPath ? { configPath: options.powerMcpConfigPath } : {}),
            allowDynamicServers: false,
          }
        : {}),
    },
  };
  if (power && config.mcp.enabled && !options.powerMcpConfigPath) {
    throw new Error("Power MCP federation requires a PLUGIN_DATA-owned configuration path");
  }

  const registry = new ActionRegistry();
  const artifacts = createKiroArtifactStore();
  const managedNode = process.env.KIRO_FABRIC_NODE_BINARY;
  const protectedRelease = managedNode && path.isAbsolute(managedNode)
    ? path.dirname(path.dirname(managedNode))
    : undefined;
  if (!power) {
    registry.register(
      new KiroToolsProvider(options.cwd, {
        readArtifact: ({ id, offset, limit }) => artifacts.read(id, offset, limit),
        ...(protectedRelease ? { protectedRoots: [protectedRelease] } : {}),
      }),
    );
    registry.markUnavailable("artifacts", "Strict mode exposes overflow artifacts through k.readArtifact");
  } else {
    registry.markUnavailable(
      "k",
      "Power mode intentionally uses Kiro native tools for ordinary repository and shell operations",
    );
    registry.register(new KiroPowerArtifactsProvider(artifacts));
  }
  // Main gets an on-demand MCP facade: configured servers are never contacted
  // during discovery/type checking, and the statically described mcp.call is
  // approval-gated before the shared provider performs tool discovery.
  if (options.tools === undefined && config.mcp.enabled) {
    registry.register(new KiroMcpProvider(options.cwd, config.mcp));
  } else {
    registry.markUnavailable(
      "mcp",
      options.tools === undefined
        ? "disabled by Fabric configuration"
        : "MCP federation is unavailable inside scoped Kiro ACP children",
    );
  }
  const memoryAvailable = options.tools === undefined &&
    config.memory.enabled &&
    (!power || options.memoryRoot !== undefined);
  if (memoryAvailable) {
    registry.register(new KiroMemoryProvider({
      cwd: options.cwd,
      root: options.memoryRoot ?? path.join(resolveAgentDir(), "fabric", "kiro-memory"),
    }));
  } else {
    registry.markUnavailable(
      "memory",
      power && options.memoryRoot === undefined
        ? "Power-scoped memory is unavailable until a workspace is bound"
        : options.tools === undefined
          ? "disabled by Fabric configuration"
          : "persistent memory is unavailable inside scoped Kiro ACP children",
    );
  }
  // Main may opt into a small verification-capable fan-out. Internal child
  // profiles always carry an explicit tool scope, so recursion stays disabled.
  if (
    options.enableSubagents === true &&
    options.tools === undefined &&
    config.agents.enabled
  ) {
    registry.register(createKiroAgentsProvider({
      cwd: options.cwd,
      config: config.agents,
      ...(options.agentWorkerPath ? { workerPath: options.agentWorkerPath } : {}),
      ...(options.agentRunRoot ? { runRoot: options.agentRunRoot } : {}),
      ...(options.kiroBinary ? { kiroBinary: options.kiroBinary } : {}),
      ...(options.agentAvailableModelIds
        ? { availableModelIds: options.agentAvailableModelIds }
        : {}),
    }));
  } else {
    registry.markUnavailable(
      "agents",
      options.tools !== undefined
        ? "recursive subagents are unavailable inside scoped Kiro ACP children"
        : power
          ? "Kiro ACP agents are unavailable until the certified CLI capability probe succeeds"
          : "managed Kiro subagents require the trusted --allow-shell --subagents opt-in",
    );
  }
  if (power && options.stateRoot) {
    const mesh = new MeshStore(
      options.stateRoot,
      config.mesh.maxEventBytes,
      config.mesh.maxReadEvents,
    );
    registry.register(new StateProvider(mesh, {
      id: createHash("sha256").update(options.stateRoot).digest("hex").slice(0, 24),
      name: "kiro-power",
      kind: "main",
    }));
  } else {
    registry.markUnavailable(
      "state",
      power
        ? "Power-scoped state is unavailable until a workspace is bound"
        : "state.* requires the managed project mesh lifecycle",
    );
  }
  for (const [provider, reason] of [
    ["extensions", "captured Pi extension tools require a live Pi extension host"],
    ["mesh", power ? "Power v1 does not expose a durable mesh lifecycle" : "managed Kiro does not own a project mesh lifecycle"],
    ["schema", "schema transactions require Pi-owned workspace and mesh authorization"],
    ["components", "component supervision requires the Pi host lifecycle"],
    ["compact", "Kiro CLI exposes no safe host context-compaction commit boundary"],
  ] as const) {
    registry.markUnavailable(provider, reason);
  }
  options.registerProviders?.(registry);

  const service = new FabricExecutionService(registry, config);
  const sessionApprovals = new FabricSessionApprovals();

  const host: FabricExecutionHost = {
    cwd: options.cwd,
    payload: makeKiroContext(options.cwd),
    // ACP results intentionally report usage as unavailable. Agent-backed
    // workflow helpers would otherwise start a billable child and only then
    // reject while recording usage; omit those helpers before guest execution.
    agentBackedOrchestration: false,
    // No model registry in the Kiro host.
    createApprover() {
      if (power && options.powerApprover) {
        return new KiroPowerFabricApprover(config.approvals, options.powerApprover, options.cwd);
      }
      return new FabricDenyApprovalFallback(
        config.approvals,
        sessionApprovals.approvedRisks as never,
        power
          ? "the MCP client does not advertise standards-based elicitation"
          : KIRO_UNAVAILABLE_REASON,
      );
    },
  };

  return {
    service: service as KiroExecutionService,
    host,
    registry,
    artifacts,
    async close() {
      try {
        await registry.close();
      } finally {
        artifacts.close();
      }
    },
  };
};
