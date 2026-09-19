import { randomBytes } from "node:crypto";
import fs, { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Value } from "typebox/value";
import { settleWithin } from "../async-settlement.js";
import { loadFabricConfig } from "../config.js";
import { fabricInfoCatalog } from "./info-catalog.js";
import { FABRIC_COMPILER_TIMEOUT_MS, effectiveFabricTimeout } from "../execution-service.js";
import {
  fabricExecInputSchema,
  fabricExecInputSchemaJson,
  prepareFabricExecArguments,
  type FabricExecInput,
} from "../kernel/fabric-exec-contract.js";
import {
  fabricPayloadsLimitError,
  fabricSourceLimitError,
  MAX_EXECUTOR_SOURCE_BYTES,
} from "../runtime/source-limit.js";
import { KIRO_MCP_DRAIN_TIMEOUT_MS, kiroMcpOuterDeadlineMs } from "./deadlines.js";
import { inspectCanonicalPath } from "./canonical-path.js";
import { KiroPowerApprover, KiroPowerFabricApprover, kiroElicitationFailureReason } from "./power/approver.js";
import { prepareKiroPowerDataPaths, prepareKiroPowerProjectPaths } from "./power/data-paths.js";
import {
  KiroPowerWorkspaceBinding,
  kiroPowerWorkspaceRequestSchema,
  kiroWorkspaceToolInputSchema,
  type KiroPowerBoundWorkspace,
  type KiroPowerWorkspaceRequest,
  type KiroPowerWorkspaceMutation,
} from "./power/workspace-binding.js";
import {
  CachedWorkspaceContextProvider,
  type KiroWorkspaceSnapshot,
  type WorkspaceContextProvider,
} from "./power/workspace-context.js";
import { projectFabricExecutionText } from "./projection.js";
import { createKiroRuntime, type KiroRuntime, type KiroRuntimeOptions } from "./runtime.js";
import { buildRunProvenance, parseRunProvenanceDeclaration, type RunProvenanceInput } from "./run-provenance.js";
import {
  DISABLED_TRACER,
  createFabricTracer,
  resolveTraceEnabled,
  type FabricTracer,
} from "../trace/tracer.js";

const EXEC_DESCRIPTION = "Checked TypeScript; await/return. local.read({path,offset?,limit?})->{text:string,totalLines,truncated,nextOffset?}, not a string/array. local.readMany({windows,maxChars?,partial?})->{files,remaining,complete,unreadTails}; complete=windows only. local.readEvidence({windows,maxChars?,partial?})->string packet+metadata. local.grep({pattern,path?,glob?,literal?,hidden?,limit?})->{matches,scope,truncated}; local.find({pattern,path?,hidden?,limit?})->{paths,scope,truncated}. local.edit({path,expectedSha256,oldText,newText,all?}); local.write overwrite requires expectedSha256 from read; local.shell({command,settle:true})->{ok,exitCode,stdout,stderr,truncated}; scripts: {script,interpreter:'bash',args?}. Optional review/probe APIs: tools.describe. hidden:true; ignore rules still apply; fabric.help({topic:'review'}). No native fallback.";
const MCP_INSTANCE_ID = `fmcp_${randomBytes(16).toString("hex")}`;
const MCP_STARTED_AT = new Date().toISOString();
const MCP_PARENT_PID = process.ppid;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const bounded = (value: unknown, fallback: string, maximum = 800): string =>
  (value instanceof Error ? value.message : typeof value === "string" ? value : fallback)
    .replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, maximum) || fallback;
const toolError = (code: string, error: unknown, issues?: readonly unknown[]) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message: bounded(error, "The request failed"), ...(issues?.length ? { issues: issues.slice(0, 8).map((issue) => bounded(issue, "invalid value", 200)) } : {}) } }) }],
  isError: true as const,
});

export const supportsKiroElicitation = (capabilities: unknown): boolean => {
  if (!isRecord(capabilities) || !isRecord(capabilities.elicitation)) return false;
  return Object.keys(capabilities.elicitation).length === 0 || Object.hasOwn(capabilities.elicitation, "form");
};

export interface KiroMcpServerOptions {
  runtimeRoot: string;
  dataRoot: string;
  kiroHome?: string;
  /** Explicit user-selected project supplied by the installed start launcher; never MCP cwd. */
  launchWorkspaceRoot?: string;
  managedSearch?: KiroRuntimeOptions["managedSearch"];
  version?: string;
  /** Explicit host metadata: launch JSON may supply configured, never observed. */
  runProvenance?: RunProvenanceInput;
  runtime?: KiroRuntime;
  prepareRuntime?: (options: KiroRuntimeOptions) => KiroRuntime | Promise<KiroRuntime>;
  workspaceContext?: WorkspaceContextProvider;
}
interface ActiveExecution { controller: AbortController; runtime: KiroRuntime; settled: Promise<void>; settle(): void }

export const installedKiroHomeFor = (runtimeRoot: string, dataRoot: string): string | undefined => {
  const runtime = inspectCanonicalPath(runtimeRoot, { kind: "directory", rejectFinalSymlink: true }).canonicalPath;
  const data = inspectCanonicalPath(dataRoot, { kind: "directory", rejectFinalSymlink: true }).canonicalPath;
  const installRoot = path.dirname(data);
  if (path.basename(data) !== "data" || path.basename(installRoot) !== "kiro-fabric") return undefined;
  const generation = path.basename(runtime) === "app" ? path.dirname(runtime) : runtime;
  if (!/^[a-f0-9]{64}$/u.test(path.basename(generation)) || path.dirname(generation) !== path.join(installRoot, "runtime")) {
    throw new Error("installed Agent data root does not match its digest-named runtime layout");
  }
  return inspectCanonicalPath(path.dirname(installRoot), {
    kind: "directory",
    rejectFinalSymlink: true,
  }).canonicalPath;
};

const workspaceRequest = (value: unknown): KiroPowerWorkspaceRequest => {
  if (Value.Check(kiroPowerWorkspaceRequestSchema, value)) return value as KiroPowerWorkspaceRequest;
  const issues = [...Value.Errors(kiroPowerWorkspaceRequestSchema, value)].map((entry) => entry.message);
  throw Object.assign(new Error("Invalid fabric_workspace arguments"), { issues });
};

const TRACE_RETENTION_MAX_FILES = 16;
const TRACE_RETENTION_MAX_AGE_MS = 7 * 86_400_000;
const TRACE_FILE_NAME = /^fabric-\d+-[a-z0-9]+\.jsonl$/u;

/** Best-effort trace hygiene: keep only the newest few trace files and
 * nothing older than a week. Never touches non-trace entries or symlinks;
 * failure never blocks startup. */
const sweepTraceDirectory = (directory: string): void => {
  try {
    const now = Date.now();
    const candidates = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && TRACE_FILE_NAME.test(entry.name))
      .map((entry) => {
        try { return { name: entry.name, mtimeMs: fs.lstatSync(path.join(directory, entry.name)).mtimeMs }; }
        catch { return undefined; }
      })
      .filter((entry): entry is { name: string; mtimeMs: number } => entry !== undefined)
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    candidates.forEach((entry, index) => {
      if (index < TRACE_RETENTION_MAX_FILES && now - entry.mtimeMs <= TRACE_RETENTION_MAX_AGE_MS) return;
      try { fs.rmSync(path.join(directory, entry.name), { force: true }); } catch { /* best effort */ }
    });
  } catch { /* missing directory or unreadable entries: nothing to sweep */ }
};

/** Tracing is off unless KIRO_FABRIC_DEBUG forces it on/off or the Agent
 * configuration enables it. A malformed configuration or an uncreatable
 * trace file must never break Agent startup: fall back to the frozen
 * zero-allocation disabled tracer. */
const createAgentTracer = (data: { root: string; configFile: string }, version: string): FabricTracer => {
  let configured = false;
  try {
    configured = loadFabricConfig(data.configFile).tracing.enabled;
  } catch {
    configured = false;
  }
  if (!resolveTraceEnabled(process.env.KIRO_FABRIC_DEBUG, configured)) return DISABLED_TRACER;
  try {
    const directory = path.join(data.root, "traces");
    sweepTraceDirectory(directory);
    const file = path.join(directory, `fabric-${process.pid}-${Date.now().toString(36)}.jsonl`);
    const tracer = createFabricTracer({ file });
    tracer.event("init", "agent.mcp.start", undefined, {
      product: "kiro-fabric-agent",
      version,
      pid: process.pid,
      parentPid: MCP_PARENT_PID,
      mcpInstanceId: MCP_INSTANCE_ID,
      startedAt: MCP_STARTED_AT,
      file,
    });
    // Persist process identity before accepting MCP traffic so even a
    // short-lived crash/reconnect is visible to startup-count qualification.
    tracer.flush();
    return tracer;
  } catch {
    return DISABLED_TRACER;
  }
};

export const createKiroMcpServer = async (options: KiroMcpServerOptions): Promise<{ close(): Promise<void> }> => {
  if (!options.runtimeRoot || !options.dataRoot) throw new Error("Agent MCP launch requires KIRO_FABRIC_RUNTIME_ROOT and KIRO_FABRIC_DATA_ROOT");
  const inferredKiroHome = installedKiroHomeFor(options.runtimeRoot, options.dataRoot);
  const explicitKiroHome = options.kiroHome === undefined
    ? undefined
    : inspectCanonicalPath(options.kiroHome, { kind: "directory", rejectFinalSymlink: true }).canonicalPath;
  if (inferredKiroHome !== undefined && explicitKiroHome !== undefined && inferredKiroHome !== explicitKiroHome) {
    throw new Error("explicit Kiro home does not match the installed Agent storage layout");
  }
  const kiroHome = explicitKiroHome ?? inferredKiroHome;
  const version = options.version ?? String((JSON.parse(readFileSync(path.join(options.runtimeRoot, "package.json"), "utf8")) as { version: unknown }).version);
  const generationName = path.basename(path.dirname(options.runtimeRoot));
  const runProvenance = buildRunProvenance({
    configured: options.runProvenance?.configured ?? parseRunProvenanceDeclaration(process.env.KIRO_FABRIC_RUN_DECLARATION) ?? {},
    observed: { ...options.runProvenance?.observed, runtimeVersion: version,
      runtimeBundle: path.basename(options.runtimeRoot) === "app" && /^[a-f0-9]{64}$/u.test(generationName) ? generationName : undefined },
  });
  const server = new Server({ name: "kiro-fabric", version }, { capabilities: { tools: {} } });
  const data = prepareKiroPowerDataPaths(options.dataRoot);
  const tracer = createAgentTracer(data, version);
  const fabricApprover = new KiroPowerApprover({
    supported: () => supportsKiroElicitation(server.getClientCapabilities()),
    request: async ({ title: _title, message, signal, timeoutMs }) => {
      const elicitationId = `form_${randomBytes(8).toString("hex")}`;
      if (tracer.enabled) {
        tracer.event("eval", "approval.form.request", undefined, { elicitationId });
        tracer.flush();
      }
      try {
        const result = await server.elicitInput({
          mode: "form",
          message,
          requestedSchema: { type: "object", properties: { approved: { type: "boolean", title: "Approve once", default: false } }, required: ["approved"] },
        }, { ...(signal ? { signal } : {}), timeout: timeoutMs });
        const approved = isRecord(result.content) && result.content.approved === true;
        if (tracer.enabled) {
          tracer.event("eval", "approval.form.response", undefined, { elicitationId, action: result.action, approved });
          tracer.flush();
        }
        return { action: result.action, ...(approved ? { approved: true } : {}) };
      } catch (error) {
        if (tracer.enabled) {
          tracer.event("eval", "approval.form.response", undefined, { elicitationId, action: "error", approved: false, reason: kiroElicitationFailureReason(error) });
          tracer.flush();
        }
        throw error;
      }
    },
  });
  const binding = new KiroPowerWorkspaceBinding({
    pluginRoot: options.runtimeRoot,
    pluginData: options.dataRoot,
    ...(kiroHome === undefined ? {} : { kiroHome }),
    elicitor: { approveWorkspace: (canonicalPath, signal) => fabricApprover.approveOnce({ risk: "write", provider: "fabric_workspace", action: "attach", summary: `Canonical workspace: ${canonicalPath}`, ...(signal ? { signal } : {}) }) },
  });
  const workspaceContext = options.workspaceContext ?? new CachedWorkspaceContextProvider({
    supported: () => (server.getClientCapabilities() as { roots?: unknown } | undefined)?.roots !== undefined,
    load: async () => (await server.listRoots(undefined, { timeout: 2_000 })).roots,
  });
  let workspaceSnapshot: KiroWorkspaceSnapshot | undefined;
  let clientRootsObserved = false;
  const catalogClientSession = randomBytes(24).toString("hex");
  let runtime = options.runtime;
  let runtimeIdentity = runtime ? "<injected>" : "";
  let runtimeGeneration = runtime ? 1 : 0;
  let closing = false;
  let lifecycleTail = Promise.resolve();
  const active = new Set<ActiveExecution>();

  const lifecycle = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = lifecycleTail.then(operation, operation);
    lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const drain = (items: readonly ActiveExecution[], reason: Error): Promise<boolean> => {
    for (const item of items) item.controller.abort(reason);
    return settleWithin(items.map((item) => item.settled), KIRO_MCP_DRAIN_TIMEOUT_MS);
  };
  const closeRuntime = async (reason: Error, knownDrained?: boolean): Promise<void> => {
    const current = runtime;
    if (!current) return;
    // Revoke cursor access synchronously, before abort/drain/transport cleanup.
    current.service.invalidateCatalogs();
    const leases = [...active].filter((item) => item.runtime === current);
    const drained = knownDrained ?? await drain(leases, reason);
    if (!drained) await Promise.allSettled(leases.map((item) => item.settled));
    await current.close();
    if (runtime === current) {
      if (tracer.enabled) tracer.event("teardown", "runtime.stop", undefined, { runtimeGeneration });
      runtime = undefined;
      runtimeIdentity = "";
    }
  };
  const syncWorkspace = async (force = false): Promise<KiroWorkspaceSnapshot> => {
    const snapshot = await workspaceContext.current({ force });
    await lifecycle(async () => {
      workspaceSnapshot = snapshot;
      const before = binding.bindingIdentity();
      if (snapshot.status !== "temporarily-unavailable") {
        if (snapshot.roots.length > 0) clientRootsObserved = true;
        // Client roots always win. Once advertised, their removal must not
        // silently reactivate the launch directory. Failures never use fallback.
        const roots = !clientRootsObserved && snapshot.status === "explicitly-empty" && options.launchWorkspaceRoot
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
    const project = workspace ? prepareKiroPowerProjectPaths(data.projects, workspace) : undefined;
    const create = options.prepareRuntime ?? createKiroRuntime;
    return create({
      cwd: workspace?.canonicalPath ?? data.root,
      configFile: data.configFile,
      mcpConfigPath: data.mcpConfig,
      artifactsRoot: project?.artifacts ?? data.artifacts,
      ...(options.managedSearch ? { managedSearch: options.managedSearch } : {}),
      ...(project && workspace ? { memoryRoot: project.memory, memoryNamespace: project.memoryNamespace, stateRoot: project.state, continuityRoot: project.continuity, workspaceRoot: workspace.canonicalPath, localLockRoot: path.join(path.dirname(project.state), "local-locks") } : {}),
    });
  };
  const runtimeForIdentity = async (): Promise<KiroRuntime> => {
    const observation = binding.workspaceObservation();
    const blocked = unavailableWorkspace() || observation.status === "temporarily-unavailable";
    const workspace = !blocked && observation.status === "verified" ? observation.workspace : undefined;
    const identity = blocked ? `<unavailable>:${binding.bindingIdentity()}` : binding.bindingIdentity();
    if (runtime && runtimeIdentity === identity) return runtime;
    const authorizeCatalog = (current: KiroRuntime): void => {
      const observed = inspectCanonicalPath(workspace?.canonicalPath ?? data.root, { kind: "directory", rejectFinalSymlink: true });
      current.service.bindCatalog({ clientSession: catalogClientSession, workspace: observed.canonicalPath,
        device: workspace?.deviceId ?? String(observed.identity.dev), inode: workspace?.fileId ?? String(observed.identity.ino),
        authorizationEpoch: String(runtimeGeneration) });
    };
    if (runtime && runtimeIdentity === "<injected>") {
      authorizeCatalog(runtime);
      runtimeIdentity = identity;
      return runtime;
    }
    await closeRuntime(new Error("workspace binding changed"));
    runtime = await createRuntimeFor(workspace);
    runtimeIdentity = identity;
    runtimeGeneration += 1;
    authorizeCatalog(runtime);
    if (tracer.enabled) tracer.event("init", "runtime.start", undefined, { runtimeGeneration });
    return runtime;
  };
  const getRuntime = (): Promise<KiroRuntime> => lifecycle(async () => {
    if (closing) throw new Error("Agent MCP server is shutting down");
    return runtimeForIdentity();
  });
  const acquireRuntime = (controller: AbortController): Promise<{ current: KiroRuntime; execution: ActiveExecution }> => lifecycle(async () => {
    if (closing) throw new Error("Agent MCP server is shutting down");
    controller.signal.throwIfAborted();
    const current = await runtimeForIdentity();
    controller.signal.throwIfAborted();
    let resolveSettled!: () => void;
    let didSettle = false;
    const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
    const settle = () => { if (!didSettle) { didSettle = true; resolveSettled(); } };
    const execution = { controller, runtime: current, settled, settle };
    active.add(execution);
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
      mcpInstanceId: MCP_INSTANCE_ID, pid: process.pid, parentPid: MCP_PARENT_PID,
      startedAt: MCP_STARTED_AT, runtimeGeneration, runtimeActive: current !== undefined,
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
      limits: current?.service.config.executor ?? loadFabricConfig(data.configFile).executor,
      workspace: workspaceValue("status"), providers,
      tracing: tracer.enabled ? { enabled: true, file: tracer.file } : { enabled: false },
      lifecycle: lifecycleInfo, interpreter, actions: actionCatalog.actions, catalog: actionCatalog.catalog,
      nativeKiroTools: { owner: "kiro", availability: "not-exposed", scope: "fabric-local", modelInventoryVerified: false },
    };
  };

  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => { workspaceContext.invalidate(); await syncWorkspace(true); });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await syncWorkspace();
    return { tools: [
      { name: "fabric_info", description: "Report bounded Kiro Fabric Agent health and provider status without secrets.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "fabric_workspace", description: "Inspect or explicitly bind the canonical workspace used for durable memory and state. Actions: status and list take no other fields; select requires rootId from list; attach requires an absolute path; detach takes no other fields.", inputSchema: kiroWorkspaceToolInputSchema, annotations: { readOnlyHint: false } },
      { name: "fabric_exec", description: EXEC_DESCRIPTION, inputSchema: fabricExecInputSchemaJson(), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
    ] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    if (name === "fabric_info") {
      await syncWorkspace();
      if (Object.keys(request.params.arguments ?? {}).length) return toolError("invalid_info_arguments", "fabric_info accepts no arguments");
      try {
        const blocked = unavailableWorkspace() || binding.workspaceObservation().status === "temporarily-unavailable";
        const current = blocked ? runtime : await getRuntime();
        return { content: [{ type: "text" as const, text: JSON.stringify(await infoValue(current, blocked)) }] };
      } catch (error) { return toolError("info_request_failed", error); }
    }
    if (name === "fabric_workspace") {
      try {
        await syncWorkspace();
        const parsed = workspaceRequest(request.params.arguments ?? {});
        if (tracer.enabled) {
          tracer.event("eval", "tool.fabric_workspace", undefined, { action: parsed.action });
          tracer.flush();
        }
        if (parsed.action === "status") return { content: [{ type: "text" as const, text: JSON.stringify({
          ...binding.status(),
          context: workspaceSnapshot?.status ?? "temporarily-unavailable",
          verification: binding.workspaceObservation().status,
        }) }] };
        if (parsed.action === "list") return { content: [{ type: "text" as const, text: JSON.stringify({
          ...binding.list(),
          context: workspaceSnapshot?.status ?? "temporarily-unavailable",
        }) }] };
        if (parsed.action === "select" && unavailableWorkspace()) throw new Error("workspace roots are temporarily unverifiable");
        // This direct tool path has no Fabric execution to charge, so it honors
        // the configured prompt budget itself: a zero budget must not open an
        // interactive attachment dialog. A host that injects no executor budget
        // keeps the previous behavior.
        const chargeApproval = async (prompt: () => Promise<void>): Promise<void> => {
          const budget = (runtime ?? await getRuntime()).service.config.executor.maxApprovalRequests;
          if (typeof budget === "number" && budget < 1) {
            throw new Error("Manual workspace attachment is blocked: executor.maxApprovalRequests is 0");
          }
          await prompt();
        };
        const mutation = await binding.prepareMutation(parsed, extra.signal, chargeApproval);
        const result = await lifecycle(async () => {
          if (closing) throw new Error("Agent MCP server is shutting down");
          extra.signal.throwIfAborted();
          const before = binding.bindingIdentity();
          const committed = binding.commitMutation(mutation);
          if (before !== binding.bindingIdentity()) await closeRuntime(new Error("workspace binding changed"));
          return committed;
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        const issues = isRecord(error) && Array.isArray(error.issues) ? error.issues : undefined;
        return toolError("workspace_request_failed", error, issues);
      }
    }
    if (name !== "fabric_exec") return toolError("unknown_tool", `Unknown tool: ${String(name)}`);
    const execId = tracer.enabled ? tracer.newExecutionId() : undefined;
    if (tracer.enabled) tracer.event("eval", "tool.fabric_exec", execId);
    const tracedError = (code: string, error: unknown, issues?: readonly unknown[]) => {
      const response = toolError(code, error, issues);
      if (tracer.enabled) {
        const text = response.content[0]!.text;
        tracer.event("eval", "exec.projection", execId, {
          visibleChars: text.length,
          visibleBytes: Buffer.byteLength(text, "utf8"),
          isError: true,
          overflowed: false,
          artifactRetained: false,
        });
        tracer.flush();
      }
      return response;
    };
    try {
      await syncWorkspace();
    } catch (error) {
      return tracedError("adapter_error", error);
    }
    const normalized = prepareFabricExecArguments(request.params.arguments ?? {});
    const normalizedRecord = isRecord(normalized) ? normalized : undefined;
    const absoluteInputError = typeof normalizedRecord?.code === "string"
      ? fabricSourceLimitError(normalizedRecord.code, MAX_EXECUTOR_SOURCE_BYTES)
      : undefined;
    const absolutePayloadError = isRecord(normalizedRecord?.payloads)
      ? fabricPayloadsLimitError(
          normalizedRecord.payloads as Record<string, string>,
          MAX_EXECUTOR_SOURCE_BYTES,
        )
      : undefined;
    if (absoluteInputError || absolutePayloadError) {
      return tracedError("invalid_exec_arguments", absoluteInputError ?? absolutePayloadError!);
    }
    if (!Value.Check(fabricExecInputSchema, normalized)) {
      const errors = [...Value.Errors(fabricExecInputSchema, normalized)].map((entry) => entry.message);
      return tracedError("invalid_exec_arguments", "Invalid fabric_exec arguments", errors);
    }
    const input = normalized as FabricExecInput;
    const controller = new AbortController();
    const cancel = (): void => controller.abort(extra.signal.reason ?? new Error("MCP request cancelled"));
    if (extra.signal.aborted) cancel(); else extra.signal.addEventListener("abort", cancel, { once: true });
    let execution: ActiveExecution | undefined;
    let timer: NodeJS.Timeout | undefined;
    const outerStarted = performance.now();
    let outerDeadline = 0;
    const scheduleOuterDeadline = (guestTimeoutMs: number): void => {
      outerDeadline = kiroMcpOuterDeadlineMs(guestTimeoutMs, FABRIC_COMPILER_TIMEOUT_MS);
      if (timer) clearTimeout(timer);
      const remaining = Math.max(0, outerStarted + outerDeadline - performance.now());
      timer = setTimeout(() => controller.abort(new Error(`MCP request exceeded ${outerDeadline}ms`)), remaining);
    };
    try {
      // Configuration I/O is part of the request lifetime: malformed/private
      // config must use the same bounded response, telemetry, and cleanup path.
      const initialConfig = loadFabricConfig(data.configFile);
      scheduleOuterDeadline(effectiveFabricTimeout(
        initialConfig.executor.maxTimeoutMs,
        initialConfig.executor.timeoutMs,
        0,
        input.timeoutMs ?? 0,
      ));
      const acquired = await acquireRuntime(controller);
      execution = acquired.execution;
      const current = acquired.current;
      scheduleOuterDeadline(effectiveFabricTimeout(
        current.service.config.executor.maxTimeoutMs,
        current.service.config.executor.timeoutMs,
        0,
        input.timeoutMs ?? 0,
      ));
      const approver = new KiroPowerFabricApprover(
        current.service.config.approvals,
        fabricApprover,
        current.service.cwd,
      );
      const pinnedIdentity = binding.bindingIdentity();
      const workspaceVerified = !unavailableWorkspace() && binding.workspaceObservation().status === "verified";
      let pendingMutation: KiroPowerWorkspaceMutation | undefined;
      const bootstrap = {
        info: () => infoValue(current, unavailableWorkspace() || binding.workspaceObservation().status === "temporarily-unavailable"),
        workspace: async (
          args: Record<string, unknown>,
          signal?: AbortSignal,
          chargeApproval?: (prompt: () => Promise<void>) => Promise<void>,
        ) => {
          const parsed = workspaceRequest(args);
          if (tracer.enabled) { tracer.event("eval", "tool.fabric_workspace", execId, { action: parsed.action }); tracer.flush(); }
          if (parsed.action === "status" || parsed.action === "list") return workspaceValue(parsed.action);
          if (pendingMutation) throw new Error("Only one workspace transition is permitted per execution");
          if (parsed.action === "select" && unavailableWorkspace()) throw new Error("workspace roots are temporarily unverifiable");
          pendingMutation = await binding.prepareMutation(parsed, signal, chargeApproval);
          signal?.throwIfAborted();
          if (binding.bindingIdentity() !== pinnedIdentity) throw new Error("Workspace changed during bootstrap preparation");
          return { status: "pending", action: parsed.action, committed: false, nextExecutionRequired: true };
        },
      };
      const result = await current.service.execute({
        code: input.code,
        ...(input.payloads ? { payloads: input.payloads } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        signal: controller.signal,
        approver,
        bootstrap,
        workspaceBound: workspaceVerified,
        workspaceUnavailable: unavailableWorkspace() || binding.workspaceObservation().status === "temporarily-unavailable",
        onEffectiveTimeoutChange: scheduleOuterDeadline,
        ...(execId !== undefined ? { tracer, execId } : {}),
      });
      const projection = projectFabricExecutionText({
        result,
        resultFormat: input.resultFormat ?? current.service.config.executor.resultFormat,
        maxOutputChars: current.service.config.executor.maxOutputChars - (pendingMutation ? 512 : 0),
        writeArtifact: (content) => current.artifacts.write(content),
      });
      if (pendingMutation && !projection.isError) {
        // Release OUR lease before entering a transition that drains leases.
        // The source program is already settled and cannot issue later calls.
        active.delete(execution);
        execution.settle();
        execution = undefined;
        const mutation = pendingMutation;
        const transition = await lifecycle(async () => {
          if (closing) throw new Error("Agent MCP server is shutting down");
          controller.signal.throwIfAborted();
          if (binding.bindingIdentity() !== pinnedIdentity) throw new Error("Workspace changed before deferred transition; list roots again");
          await closeRuntime(new Error("workspace binding changed"));
          controller.signal.throwIfAborted();
          return binding.commitMutation(mutation);
        });
        const suffix = `\n\nWorkspace transition: ${JSON.stringify({ committed: true, ...transition, nextExecutionRequired: true })}`;
        if (suffix.length > 512) throw new Error("Workspace transition committed but acknowledgement exceeds bounds; inspect fabric.workspace status before retrying");
        projection.text += suffix;
        projection.visibleChars = projection.text.length;
        projection.visibleBytes = Buffer.byteLength(projection.text, "utf8");
      }
      if (tracer.enabled) {
        tracer.event("eval", "exec.projection", execId, {
          visibleChars: projection.visibleChars,
          visibleBytes: projection.visibleBytes,
          isError: projection.isError,
          overflowed: projection.overflowed,
          artifactRetained: projection.artifactRetained,
        });
        tracer.flush();
      }
      return {
        content: [{ type: "text" as const, text: projection.text }],
        // Additive host metadata; never wrap or rewrite the program's returned value.
        structuredContent: {
          executionStatus: projection.executionStatus,
          deliveryStatus: projection.deliveryStatus,
          retryProgram: projection.retryProgram,
          ...(projection.receiptId === undefined ? {} : { receiptId: projection.receiptId }),
          ...(projection.artifactId === undefined ? {} : { artifactId: projection.artifactId }),
        },
        ...(projection.isError ? { isError: true } : {}),
      };
    } catch (error) { return tracedError("adapter_error", error); }
    finally {
      if (timer) clearTimeout(timer);
      if (execution) { active.delete(execution); execution.settle(); }
      extra.signal.removeEventListener("abort", cancel);
    }
  });

  await server.connect(new StdioServerTransport());
  let closeTask: Promise<void> | undefined;
  return { close() {
    runtime?.service.invalidateCatalogs();
    closeTask ??= (async () => {
      try {
        await lifecycle(async () => {
          closing = true;
          const reason = new Error("Agent MCP server shutting down");
          const drained = await drain([...active], reason);
          await closeRuntime(reason, drained);
        });
      } finally { await server.close(); tracer.close(); }
    })();
    return closeTask;
  } };
};
