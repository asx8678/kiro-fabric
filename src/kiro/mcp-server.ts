import { randomBytes } from "node:crypto";
import fs, { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
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
  prepareFabricExecArgumentsWithDiagnostics,
  type FabricExecInput,
} from "../kernel/fabric-exec-contract.js";
import {
  fabricPayloadsLimitError,
  fabricSourceLimitError,
  MAX_EXECUTOR_SOURCE_BYTES,
} from "../runtime/source-limit.js";
import { KIRO_MCP_DRAIN_TIMEOUT_MS, kiroMcpOuterDeadlineMs } from "./deadlines.js";
import { inspectCanonicalPath } from "./canonical-path.js";
import { KiroPowerApprover, KiroPowerFabricApprover } from "./power/approver.js";
import { prepareKiroPowerDataPaths, prepareKiroPowerProjectPaths } from "./power/data-paths.js";
import {
  KiroPowerWorkspaceBinding,
  kiroPowerWorkspaceRequestSchema,
  kiroWorkspaceToolInputSchema,
  type KiroPowerBoundWorkspace,
  type KiroPowerWorkspaceRequest,
} from "./power/workspace-binding.js";
import {
  CachedWorkspaceContextProvider,
  type KiroWorkspaceSnapshot,
  type WorkspaceContextProvider,
} from "./power/workspace-context.js";
import { projectFabricExecutionText } from "./projection.js";
import { createKiroRuntime, type KiroRuntime, type KiroRuntimeOptions } from "./runtime.js";
import {
  DISABLED_TRACER,
  createFabricTracer,
  resolveTraceEnabled,
  type FabricTracer,
} from "../trace/tracer.js";

const EXEC_DESCRIPTION = "Execute bounded checked TypeScript for provider composition, artifacts, workspace-scoped durable memory and state, and configured MCP federation. Compose multiple provider calls in one program and return only the data needed. Use Kiro native tools for files, shell, web, and subagents.";
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
  version?: string;
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
  if (!/^[a-f0-9]{64}$/u.test(path.basename(runtime)) || path.dirname(runtime) !== path.join(installRoot, "runtime")) {
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
          tracer.event("eval", "approval.form.response", undefined, { elicitationId, action: "error", approved: false });
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
        binding.updateClientRoots(snapshot.roots);
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
      ...(project ? { memoryRoot: project.memory, memoryNamespace: project.memoryNamespace, stateRoot: project.state } : {}),
    });
  };
  const runtimeForIdentity = async (): Promise<KiroRuntime> => {
    const observation = binding.workspaceObservation();
    if (observation.status === "temporarily-unavailable") throw new Error("bound workspace is temporarily unverifiable");
    const workspace = observation.status === "verified" ? observation.workspace : undefined;
    const identity = binding.bindingIdentity();
    if (runtime && (runtimeIdentity === identity || runtimeIdentity === "<injected>")) return runtime;
    await closeRuntime(new Error("workspace binding changed"));
    runtime = await createRuntimeFor(workspace);
    runtimeIdentity = identity;
    runtimeGeneration += 1;
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
        const workspaceObservation = binding.workspaceObservation();
        const workspaceBlocked = unavailableWorkspace() || workspaceObservation.status === "temporarily-unavailable";
        const current = workspaceBlocked ? runtime : await getRuntime();
        const limits = current?.service.config.executor ?? loadFabricConfig(data.configFile).executor;
        const providers = current
          ? current.providers().map((provider) => workspaceBlocked
              ? { ...provider, available: false, reason: "workspace identity is temporarily unverifiable" }
              : provider)
          : ["artifacts", "memory", "state", "mcp"].map((name) => ({
              name,
              description: "Provider unavailable until workspace identity can be verified",
              available: false,
              reason: "workspace identity is temporarily unverifiable",
            }));
        const lifecycleInfo = {
          mcpInstanceId: MCP_INSTANCE_ID,
          pid: process.pid,
          parentPid: MCP_PARENT_PID,
          startedAt: MCP_STARTED_AT,
          runtimeGeneration,
          runtimeActive: current !== undefined,
          clientCapabilities: {
            roots: (server.getClientCapabilities() as { roots?: unknown } | undefined)?.roots !== undefined,
            formElicitation: supportsKiroElicitation(server.getClientCapabilities()),
          },
        };
        const expectedNode = process.env.KIRO_FABRIC_EXPECTED_NODE;
        const interpreterInfo = expectedNode === undefined
          ? { actual: realpathSync(process.execPath), expected: null, matches: "unknown" as const }
          : { actual: realpathSync(process.execPath), expected: expectedNode, matches: realpathSync(process.execPath) === expectedNode };
        const actionCatalog = fabricInfoCatalog(current && !workspaceBlocked ? await current.registry.list() : []);
        if (tracer.enabled) {
          tracer.event("eval", "tool.fabric_info", undefined, lifecycleInfo);
          tracer.flush();
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({
          product: "kiro-fabric-agent",
          version,
          executor: "quickjs",
          limits,
          workspace: {
            ...binding.status(),
            context: workspaceSnapshot?.status ?? "temporarily-unavailable",
            verification: workspaceObservation.status,
          },
          providers,
          tracing: tracer.enabled ? { enabled: true, file: tracer.file } : { enabled: false },
          lifecycle: lifecycleInfo,
          interpreter: interpreterInfo,
          actions: actionCatalog.actions,
          catalog: actionCatalog.catalog,
          nativeKiroTools: { owner: "kiro", availability: "declared-by-agent-profile" },
        }) }] };
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
        const mutation = await binding.prepareMutation(parsed, extra.signal);
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
    if (unavailableWorkspace()) return tracedError("workspace_unavailable", "workspace roots are temporarily unverifiable");
    const normalized = prepareFabricExecArgumentsWithDiagnostics(request.params.arguments ?? {});
    const normalizedRecord = isRecord(normalized.value) ? normalized.value : undefined;
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
    if (!Value.Check(fabricExecInputSchema, normalized.value)) {
      const errors = [...Value.Errors(fabricExecInputSchema, normalized.value)].map((entry) => entry.message);
      return tracedError("invalid_exec_arguments", "Invalid fabric_exec arguments", errors);
    }
    const input = normalized.value as FabricExecInput;
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
      const result = await current.service.execute({
        code: input.code,
        ...(input.payloads ? { payloads: input.payloads } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        signal: controller.signal,
        approver,
        onEffectiveTimeoutChange: scheduleOuterDeadline,
        ...(execId !== undefined ? { tracer, execId } : {}),
      });
      const projection = projectFabricExecutionText({
        result,
        resultFormat: input.resultFormat ?? current.service.config.executor.resultFormat,
        maxOutputChars: current.service.config.executor.maxOutputChars,
        writeArtifact: (content) => current.artifacts.write(content),
        normalizationDiagnostics: normalized.diagnostics,
      });
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
      return { content: [{ type: "text" as const, text: projection.text }], ...(projection.isError ? { isError: true } : {}) };
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
