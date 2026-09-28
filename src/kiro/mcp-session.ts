import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolRequest, ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { loadFabricConfig } from "../config.js";
import type { FoveaHost, FoveaBoundClient } from "../fovea/host.js";
import type { FabricTracer } from "../trace/tracer.js";
import { foveaHookCapability } from "./fovea-native.js";
import type { FoveaResponseDelivery } from "./fovea-context.js";
import type { KiroHostSession, KiroHostTurn } from "./host-session-adapter.js";
import { inspectCanonicalPath } from "./canonical-path.js";
import { fabricInfoCatalog } from "./info-catalog.js";
import { createKiroArtifactOwner } from "./artifact-owner.js";
import { createKiroRuntime, type KiroRuntime } from "./runtime.js";
import type { buildRunProvenance } from "./run-provenance.js";
import type { KiroPowerApprover } from "./power/approver.js";
import { prepareKiroPowerProjectPaths, type KiroPowerDataPaths } from "./power/data-paths.js";
import { KiroPowerWorkspaceBinding, type KiroPowerBoundWorkspace } from "./power/workspace-binding.js";
import { CachedWorkspaceContextProvider, type KiroWorkspaceSnapshot } from "./power/workspace-context.js";
import type { KiroMcpServerOptions } from "./mcp-server.js";
import { createMcpSessionLifecycle, attemptCleanup, type ActiveExecution } from "./mcp-session-lifecycle.js";
import { callMcpExecution, type McpExecutionContext } from "./mcp-execution.js";
import { callWorkspace, type WorkspaceTransitionContext } from "./mcp-workspace.js";
import { supportsKiroElicitation, toolError } from "./mcp-response.js";

interface McpSessionOptions {
  options: KiroMcpServerOptions;
  server: Server;
  data: KiroPowerDataPaths;
  kiroHome: string | undefined;
  version: string;
  runProvenance: ReturnType<typeof buildRunProvenance>;
  tracer: FabricTracer;
  fovea: FoveaHost;
  foveaClients: WeakMap<KiroRuntime, FoveaBoundClient>;
  foveaDelivery: FoveaResponseDelivery;
  fabricApprover: KiroPowerApprover;
  ownedRuntimes: WeakSet<KiroRuntime>;
  serverClosing(): boolean;
  identity: { id: string; parentPid: number; startedAt: string };
}

/** Bind one authenticated host-session epoch (or the legacy MCP owner) to
 * its replaceable runtimes, persistent workspace binding and artifact owner. */
export const createMcpSession = (context: McpSessionOptions, owner?: KiroHostSession) => {
  const { options, server, data, kiroHome, version, runProvenance, tracer, fovea,
    foveaClients, foveaDelivery, fabricApprover, ownedRuntimes, serverClosing, identity } = context;
  // Legacy fallback identifies only the MCP owner, never a native chat.
  // Host sessions arrive as authenticated capabilities, not inferred metadata.
  const foveaConversation = owner?.conversationId ?? `host_${randomBytes(24).toString("hex")}`;
  const binding = new KiroPowerWorkspaceBinding({
    pluginRoot: options.runtimeRoot,
    pluginData: options.dataRoot,
    ...(kiroHome === undefined ? {} : { kiroHome }),
    elicitor: { approveWorkspace: (canonicalPath, signal) => fabricApprover.approveOnce({ risk: "write", provider: "fabric_workspace", action: "attach", summary: `Canonical workspace: ${canonicalPath}`, ...(signal ? { signal } : {}) }) },
  });
  const workspaceContext = owner?.workspaceContext ?? options.workspaceContext ?? new CachedWorkspaceContextProvider({
    supported: () => (server.getClientCapabilities() as { roots?: unknown } | undefined)?.roots !== undefined,
    load: async () => (await server.listRoots(undefined, { timeout: 2_000 })).roots,
  });
  let workspaceSnapshot: KiroWorkspaceSnapshot | undefined;
  let clientRootsObserved = false;
  const catalogClientSession = randomBytes(24).toString("hex");
  let runtime = options.runtime;
  let runtimeIdentity = runtime ? "<injected>" : "";
  let runtimeGeneration = runtime ? 1 : 0;
  // Authority and quotas belong to this owner, not the replaceable workspace.
  // The shared private directory is only backing storage: no owner imports or
  // looks up another owner's files, and guests never choose this capability.
  const artifacts = createKiroArtifactOwner(() => ({ root: data.artifacts, ...loadFabricConfig(data.configFile).artifacts }));
  const artifactAccess = Object.freeze({
    read(id: string, offset?: number, limit?: number) { assertAvailable(); return artifacts.access.read(id, offset, limit); },
    checkpoint(content: string): string { assertAvailable(); return artifacts.access.checkpoint(content); },
  });
  const sessionLifecycle = createMcpSessionLifecycle({
    retiring: () => serverClosing() || owner?.signal.aborted === true,
    currentRuntime: () => runtime,
    runtimeClosed: current => {
      if (runtime === current) {
        if (tracer.enabled) tracer.event("teardown", "runtime.stop", undefined, { runtimeGeneration });
        runtime = undefined;
        runtimeIdentity = "";
      }
    },
    closeClient: current => foveaClients.get(current)?.close(),
    retireConversation: () => fovea.retireConversation(foveaConversation, owner?.conversationEpoch ?? 0),
    revokeArtifacts: () => artifacts.revoke(),
    closeArtifacts: () => artifacts.close(),
  });
  const { assertAvailable, lifecycle, disposeRuntime, closeRuntime } = sessionLifecycle;
  const discardUnpublished = async (created: KiroRuntime, error: unknown): Promise<never> => {
    await disposeRuntime(created, new Error("MCP runtime publication failed"), [error]);
    throw error;
  };
  const syncWorkspace = async (force = false): Promise<KiroWorkspaceSnapshot> => {
    const snapshot = await workspaceContext.current({ force });
    await lifecycle(async () => {
      assertAvailable();
      workspaceSnapshot = snapshot;
      const before = binding.bindingIdentity();
      if (snapshot.status !== "temporarily-unavailable") {
        if (snapshot.roots.length > 0) clientRootsObserved = true;
        // Client roots always win. Once advertised, their removal must not
        // silently reactivate the launch directory. Failures never use fallback.
        const roots = !owner && !clientRootsObserved && snapshot.status === "explicitly-empty" && options.launchWorkspaceRoot
          ? [{ uri: pathToFileURL(options.launchWorkspaceRoot).href }]
          : snapshot.roots;
        binding.updateClientRoots(roots);
      }
      const observation = binding.workspaceObservation();
      const contextBlocks = snapshot.status === "temporarily-unavailable" &&
        binding.bindingSource() !== "manual";
      if (
        before !== binding.bindingIdentity() || contextBlocks ||
        observation.status === "temporarily-unavailable"
      ) {
        await closeRuntime(new Error("workspace identity became unavailable or changed"));
      }
    });
    return snapshot;
  };
  const createRuntimeFor = async (workspace?: KiroPowerBoundWorkspace): Promise<KiroRuntime> => {
    // Teardown/factory awaits may have retired the session before ANY binding
    // existed. Never grant new controls after its cleanup barrier.
    assertAvailable();
    const project = workspace ? prepareKiroPowerProjectPaths(data.projects, workspace) : undefined;
    const create = options.prepareRuntime ?? createKiroRuntime;
    const client = workspace ? fovea.bind({ canonicalPath: workspace.canonicalPath, deviceId: workspace.deviceId, fileId: workspace.fileId,
      conversationId: foveaConversation, conversationEpoch: owner?.conversationEpoch ?? 0, authorizationEpoch: runtimeGeneration + 1 }) : undefined;
    let created: KiroRuntime;
    try {
      created = await create({
        cwd: workspace?.canonicalPath ?? data.root,
        configFile: data.configFile,
        mcpConfigPath: data.mcpConfig,
        artifactsRoot: project?.artifacts ?? data.artifacts,
        ...(client ? { foveaClient: client } : {}),
        ...(project && workspace ? { memoryRoot: project.memory, memoryNamespace: project.memoryNamespace, stateRoot: project.state, continuityRoot: project.continuity, workspaceRoot: workspace.canonicalPath, localLockRoot: path.join(path.dirname(project.state), "local-locks") } : {}),
      });
      // A rejected borrowed runtime belongs to another session, not this
      // factory. Dispose only our binding in that case.
      if (owner && ownedRuntimes.has(created)) throw new Error("Host sessions require distinct runtime instances");
      // Legacy factories must not attach a fresh binding to a cached disposal
      // task either. The catch owns this new binding, never the retired runtime.
      if (sessionLifecycle.isRetired(created)) throw new Error("Runtime factory returned an already retired MCP runtime");
    } catch (error) {
      const failures: unknown[] = [];
      await attemptCleanup(failures, () => client?.close());
      if (failures.length) {
        const failure = new AggregateError([error, ...failures], "MCP runtime creation and binding cleanup failed", { cause: error });
        if (client) sessionLifecycle.recordCleanupFailure(client, failure);
        throw failure;
      }
      throw error;
    }
    if (owner) ownedRuntimes.add(created);
    if (client) foveaClients.set(created, client);
    if (sessionLifecycle.retiring()) return discardUnpublished(created, new Error("Host session retired during runtime creation"));
    return created;
  };
  const runtimeForIdentity = async (): Promise<KiroRuntime> => {
    assertAvailable();
    const observation = binding.workspaceObservation();
    const blocked = unavailableWorkspace() || observation.status === "temporarily-unavailable";
    const workspace = !blocked && observation.status === "verified" ? observation.workspace : undefined;
    const identity = blocked ? `<unavailable>:${binding.bindingIdentity()}` : binding.bindingIdentity();
    if (runtime && runtimeIdentity === identity) return runtime;
    const authorizeCatalog = (current: KiroRuntime, generation: number): void => {
      const observed = inspectCanonicalPath(workspace?.canonicalPath ?? data.root, { kind: "directory", rejectFinalSymlink: true });
      current.service.bindCatalog({ clientSession: catalogClientSession, workspace: observed.canonicalPath,
        device: workspace?.deviceId ?? String(observed.identity.dev), inode: workspace?.fileId ?? String(observed.identity.ino),
        authorizationEpoch: String(generation) });
    };
    if (runtime && runtimeIdentity === "<injected>") {
      const injected = runtime;
      try { authorizeCatalog(injected, runtimeGeneration); assertAvailable(); }
      catch (error) { return discardUnpublished(injected, error); }
      runtimeIdentity = identity;
      return injected;
    }
    await closeRuntime(new Error("workspace binding changed"));
    const created = await createRuntimeFor(workspace);
    const generation = runtimeGeneration + 1;
    try {
      // The factory await and catalog callbacks can reenter retirement. Publish
      // only after authorization succeeds and both terminal checks pass.
      if (sessionLifecycle.retiring()) throw new Error("Host session retired before runtime publication");
      authorizeCatalog(created, generation);
      if (sessionLifecycle.retiring()) throw new Error("Host session retired during runtime publication");
      if (tracer.enabled) tracer.event("init", "runtime.start", undefined, { runtimeGeneration: generation });
    } catch (error) { return discardUnpublished(created, error); }
    runtime = created;
    runtimeIdentity = identity;
    runtimeGeneration = generation;
    return created;
  };
  const getRuntime = (): Promise<KiroRuntime> => lifecycle(async () => {
    assertAvailable();
    return runtimeForIdentity();
  });
  const acquireRuntime = (controller: AbortController): Promise<{ current: KiroRuntime; execution: ActiveExecution }> => lifecycle(async () => {
    assertAvailable();
    controller.signal.throwIfAborted();
    const current = await runtimeForIdentity();
    assertAvailable();
    controller.signal.throwIfAborted();
    const execution = sessionLifecycle.track(current, controller);
    return { current, execution };
  });
  const unavailableWorkspace = (): boolean =>
    workspaceSnapshot?.status === "temporarily-unavailable" &&
    binding.bindingSource() !== "manual";

  // Shared internals: guest bootstrap does not MCP-call this same server or
  // acquire another runtime lease while its existing lease is active.
  const workspaceValue = (action: "status" | "list") => ({
    ...(action === "list" ? binding.list() : binding.status()),
    context: workspaceSnapshot?.status ?? "temporarily-unavailable",
    verification: binding.workspaceObservation().status,
    ...(workspaceSnapshot?.status === "explicitly-empty" && binding.workspaceObservation().status === "unbound" ? {
      recovery: {
        reason: "Kiro supplied no usable workspace roots or authorized launch directory. The profile may predate direct CLI workspace binding, or the launch directory may be reserved.",
        instruction: "Ask the user to start a new session from a project directory outside Kiro/Fabric storage. Update older installations, use the installed kiro-fabric start launcher, or run this shell command. Do not execute it inside fabric_exec or infer a project from the backend cwd.",
        command: 'KIRO_FABRIC_LAUNCH_WORKSPACE="$(pwd -P)" kiro-cli --v3 --agent kiro-fabric',
      },
    } : {}),
  });
  const infoValue = async (current: KiroRuntime | undefined, workspaceBlocked: boolean) => {
    const lifecycleInfo = {
      mcpInstanceId: identity.id, pid: process.pid, parentPid: identity.parentPid,
      startedAt: identity.startedAt, runtimeGeneration, runtimeActive: current !== undefined,
      clientCapabilities: {
        roots: (server.getClientCapabilities() as { roots?: unknown } | undefined)?.roots !== undefined,
        formElicitation: supportsKiroElicitation(server.getClientCapabilities()),
      },
    };
    const expectedNode = process.env.KIRO_FABRIC_EXPECTED_NODE;
    const interpreter = expectedNode === undefined
      ? { actual: realpathSync(process.execPath), expected: null, matches: "unknown" as const }
      : { actual: realpathSync(process.execPath), expected: expectedNode, matches: realpathSync(process.execPath) === expectedNode };
    const providers = current ? current.providers().map((provider) => workspaceBlocked && provider.name !== "fabric"
      ? { ...provider, available: false, reason: "workspace identity is temporarily unverifiable" } : provider)
      : ["fabric", "local", "review", "probe", "artifacts", "memory", "state", "mcp"].map((name) => ({ name, description: "Provider awaits runtime", available: false, reason: "runtime unavailable" }));
    const actionCatalog = fabricInfoCatalog(current && !workspaceBlocked ? await current.registry.list() : []);
    if (tracer.enabled) { tracer.event("eval", "tool.fabric_info", undefined, lifecycleInfo); tracer.flush(); }
    return {
      product: "kiro-fabric-agent", version, executor: "quickjs", runProvenance,
      artifactRetention: { owner: owner ? "host-session-epoch" : "mcp-instance", workspaceIndependent: true,
        durability: "ephemeral", expiry: "idle TTL or quota eviction", retiredWithOwner: true, nativeChatIsolationQualified: false },
      limits: current?.service.config.executor ?? loadFabricConfig(data.configFile).executor,
      workspace: workspaceValue("status"), providers,
      tracing: tracer.enabled ? { enabled: true, file: tracer.file } : { enabled: false },
      lifecycle: lifecycleInfo, interpreter, actions: actionCatalog.actions, catalog: actionCatalog.catalog,
      nativeKiroTools: { owner: "kiro", availability: "not-exposed", scope: "fabric-local", modelInventoryVerified: false },
      fovea: { nativeHooks: foveaHookCapability(),
        postToolContext: options.foveaPostToolContext?.authorizedAnalysis === true && options.foveaPostToolContext.qualifiedVisibleDelivery === true ? "trusted-embedder-visible" : "disabled",
        callContext: options.foveaCallContext === true ? "invocation-local-visible" : "disabled",
        nativeSessionAssociation: owner ? "trusted-embedder; native-unqualified" : "unavailable", modelInputAcknowledged: false,
        modelInputReceipts: owner ? "host-only exact-turn receipts; not native qualification" : "unavailable",
        sessionBoundElicitation: false,
        sessionIsolation: { supported: !!owner, stateOwner: owner ? "host-session-epoch" : "mcp-instance", nativeClearResetGuaranteed: false,
          warning: owner ? "Embedding bridge owns authenticated routing and retirement; managed Kiro lifecycle remains unqualified. Unassociated approval forms are disabled."
            : "A reused MCP instance can retain focus, results, session settings and rule trust across native chats. Native /clear is not a Fabric state boundary." },
        automaticQualification: { ready: false, requiredNativeGates: ["H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08", "H09", "H10", "H11", "H12"], qualifiedNativeGates: [] } },
    };
  };

  const transitions: WorkspaceTransitionContext = {
    binding, tracer, syncWorkspace, snapshot: () => workspaceSnapshot, unavailableWorkspace,
    currentRuntime: () => runtime, getRuntime, lifecycle, assertAvailable, closeRuntime,
  };
  const callInfo = async (args: Record<string, unknown>) => {
    await syncWorkspace();
    if (Object.keys(args).length) return toolError("invalid_info_arguments", "fabric_info accepts no arguments");
    try {
      const blocked = unavailableWorkspace() || binding.workspaceObservation().status === "temporarily-unavailable";
      const current = blocked ? runtime : await getRuntime();
      return { content: [{ type: "text" as const, text: JSON.stringify(await infoValue(current, blocked)) }] };
    } catch (error) { return toolError("info_request_failed", error); }
  };
  const executionContext: McpExecutionContext = {
    options, data, tracer, binding, fabricApprover, artifacts, artifactAccess,
    sessionLifecycle, transitions, foveaClients, foveaDelivery, syncWorkspace,
    unavailableWorkspace, acquireRuntime, infoValue, workspaceValue,
  };
  const call = (request: CallToolRequest, extra: RequestHandlerExtra<ServerRequest, ServerNotification>, turn?: KiroHostTurn) => {
    const args = request.params.arguments ?? {};
    switch (request.params.name) {
      case "fabric_info": return callInfo(args);
      case "fabric_workspace": return callWorkspace(transitions, args, extra.signal);
      case "fabric_exec": return callMcpExecution(executionContext, request, extra, turn);
      default: return toolError("unknown_tool", `Unknown tool: ${String(request.params.name)}`);
    }
  };
  return {
    call,
    refresh: async (force = false) => { if (force) workspaceContext.invalidate(); await syncWorkspace(force); },
    close: sessionLifecycle.close,
  };
};
