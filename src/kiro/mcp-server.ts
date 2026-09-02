import { readFileSync } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Value } from "typebox/value";
import { loadFabricPowerConfig } from "../config.js";
import { FABRIC_COMPILER_TIMEOUT_MS } from "../execution-service.js";
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
import { KiroPowerApprover, KiroPowerFabricApprover } from "./power/approver.js";
import { prepareKiroPowerDataPaths, prepareKiroPowerProjectPaths } from "./power/data-paths.js";
import {
  KiroPowerWorkspaceBinding,
  kiroPowerWorkspaceRequestSchema,
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

const EXEC_DESCRIPTION = "Execute bounded checked TypeScript for provider composition, artifacts, Power-scoped memory, workspace-bound state, and configured MCP federation. Use Kiro native tools for files, shell, web, and subagents.";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const bounded = (value: unknown, fallback: string, maximum = 800): string =>
  (value instanceof Error ? value.message : typeof value === "string" ? value : fallback)
    .replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, maximum) || fallback;
const toolError = (code: string, error: unknown, issues?: readonly unknown[]) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message: bounded(error, "The request failed"), ...(issues?.length ? { issues: issues.slice(0, 8).map((issue) => bounded(issue, "invalid value", 200)) } : {}) } }) }],
  isError: true as const,
});

export const supportsKiroPowerElicitation = (capabilities: unknown): boolean => {
  if (!isRecord(capabilities) || !isRecord(capabilities.elicitation)) return false;
  return Object.keys(capabilities.elicitation).length === 0 || Object.hasOwn(capabilities.elicitation, "form");
};

export interface KiroMcpServerOptions {
  pluginRoot: string;
  pluginData: string;
  version?: string;
  runtime?: KiroRuntime;
  prepareRuntime?: (options: KiroRuntimeOptions) => KiroRuntime | Promise<KiroRuntime>;
  workspaceContext?: WorkspaceContextProvider;
}
interface ActiveExecution { controller: AbortController; runtime: KiroRuntime; settled: Promise<void>; settle(): void }

const workspaceRequest = (value: unknown): KiroPowerWorkspaceRequest => {
  if (Value.Check(kiroPowerWorkspaceRequestSchema, value)) return value as KiroPowerWorkspaceRequest;
  const issues = [...Value.Errors(kiroPowerWorkspaceRequestSchema, value)].map((entry) => entry.message);
  throw Object.assign(new Error("Invalid fabric_workspace arguments"), { issues });
};

export const createKiroMcpServer = async (options: KiroMcpServerOptions): Promise<{ close(): Promise<void> }> => {
  if (!options.pluginRoot || !options.pluginData) throw new Error("Power MCP launch requires PLUGIN_ROOT and PLUGIN_DATA");
  const version = options.version ?? String((JSON.parse(readFileSync(path.join(options.pluginRoot, "package.json"), "utf8")) as { version: unknown }).version);
  const server = new Server({ name: "kiro-fabric", version }, { capabilities: { tools: {} } });
  const data = prepareKiroPowerDataPaths(options.pluginData);
  const powerApprover = new KiroPowerApprover({
    supported: () => supportsKiroPowerElicitation(server.getClientCapabilities()),
    request: async ({ title: _title, message, signal, timeoutMs }) => {
      const result = await server.elicitInput({
        mode: "form",
        message,
        requestedSchema: { type: "object", properties: { approved: { type: "boolean", title: "Approve once", default: false } }, required: ["approved"] },
      }, { ...(signal ? { signal } : {}), timeout: timeoutMs });
      return { action: result.action, ...(isRecord(result.content) && result.content.approved === true ? { approved: true } : {}) };
    },
  });
  const binding = new KiroPowerWorkspaceBinding({
    pluginRoot: options.pluginRoot,
    pluginData: options.pluginData,
    elicitor: { approveWorkspace: (canonicalPath, signal) => powerApprover.approveOnce({ risk: "write", provider: "fabric_workspace", action: "attach", summary: `Canonical workspace: ${canonicalPath}`, ...(signal ? { signal } : {}) }) },
  });
  const workspaceContext = options.workspaceContext ?? new CachedWorkspaceContextProvider({
    supported: () => (server.getClientCapabilities() as { roots?: unknown } | undefined)?.roots !== undefined,
    load: async () => (await server.listRoots(undefined, { timeout: 2_000 })).roots,
  });
  let workspaceSnapshot: KiroWorkspaceSnapshot | undefined;
  let runtime = options.runtime;
  let runtimeIdentity = runtime ? "<injected>" : "";
  let closing = false;
  let lifecycleTail = Promise.resolve();
  const active = new Set<ActiveExecution>();

  const lifecycle = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = lifecycleTail.then(operation, operation);
    lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const drain = async (items: readonly ActiveExecution[], reason: Error): Promise<boolean> => {
    for (const item of items) item.controller.abort(reason);
    if (!items.length) return true;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        Promise.allSettled(items.map((item) => item.settled)).then(() => true),
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), KIRO_MCP_DRAIN_TIMEOUT_MS); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  };
  const closeRuntime = async (reason: Error, knownDrained?: boolean): Promise<void> => {
    const current = runtime;
    runtime = undefined;
    runtimeIdentity = "";
    if (!current) return;
    const leases = [...active].filter((item) => item.runtime === current);
    const drained = knownDrained ?? await drain(leases, reason);
    if (drained || !leases.length) await current.close();
    else void Promise.allSettled(leases.map((item) => item.settled)).then(() => current.close()).catch(() => {});
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
      ...(project ? { memoryRoot: project.memory, stateRoot: project.state } : {}),
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
    return runtime;
  };
  const getRuntime = (): Promise<KiroRuntime> => lifecycle(async () => {
    if (closing) throw new Error("Power MCP server is shutting down");
    return runtimeForIdentity();
  });
  const acquireRuntime = (controller: AbortController): Promise<{ current: KiroRuntime; execution: ActiveExecution }> => lifecycle(async () => {
    if (closing) throw new Error("Power MCP server is shutting down");
    const current = await runtimeForIdentity();
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
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
      { name: "fabric_info", description: "Report bounded Kiro Fabric Power health and provider status without secrets.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "fabric_workspace", description: "Inspect or explicitly bind the canonical workspace used for Power-scoped state and memory.", inputSchema: JSON.parse(JSON.stringify(kiroPowerWorkspaceRequestSchema)), annotations: { readOnlyHint: false } },
      { name: "fabric_exec", description: EXEC_DESCRIPTION, inputSchema: fabricExecInputSchemaJson(), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
    ] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    await syncWorkspace();
    const name = request.params.name;
    if (name === "fabric_info") {
      if (Object.keys(request.params.arguments ?? {}).length) return toolError("invalid_info_arguments", "fabric_info accepts no arguments");
      try {
        const workspaceObservation = binding.workspaceObservation();
        const workspaceBlocked = unavailableWorkspace() || workspaceObservation.status === "temporarily-unavailable";
        const current = workspaceBlocked ? runtime : await getRuntime();
        const limits = current?.service.config.executor ?? loadFabricPowerConfig(data.configFile).executor;
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
        return { content: [{ type: "text" as const, text: JSON.stringify({
          product: "kiro-fabric-power",
          version,
          executor: "quickjs",
          limits,
          workspace: {
            ...binding.status(),
            context: workspaceSnapshot?.status ?? "temporarily-unavailable",
            verification: workspaceObservation.status,
          },
          providers,
          nativeKiroTools: { owner: "kiro", availability: "not-observed-by-power" },
        }) }] };
      } catch (error) { return toolError("info_request_failed", error); }
    }
    if (name === "fabric_workspace") {
      try {
        const parsed = workspaceRequest(request.params.arguments ?? {});
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
    if (unavailableWorkspace()) return toolError("workspace_unavailable", "workspace roots are temporarily unverifiable");
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
      return toolError("invalid_exec_arguments", absoluteInputError ?? absolutePayloadError!);
    }
    if (!Value.Check(fabricExecInputSchema, normalized.value)) {
      const errors = [...Value.Errors(fabricExecInputSchema, normalized.value)].map((entry) => entry.message);
      return toolError("invalid_exec_arguments", "Invalid fabric_exec arguments", errors);
    }
    const input = normalized.value as FabricExecInput;
    const controller = new AbortController();
    const cancel = (): void => controller.abort(extra.signal.reason ?? new Error("MCP request cancelled"));
    if (extra.signal.aborted) cancel(); else extra.signal.addEventListener("abort", cancel, { once: true });
    let execution: ActiveExecution | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      const acquired = await acquireRuntime(controller);
      execution = acquired.execution;
      const current = acquired.current;
      const outerDeadline = kiroMcpOuterDeadlineMs(
        current.service.config.executor.maxTimeoutMs,
        FABRIC_COMPILER_TIMEOUT_MS,
      );
      timer = setTimeout(() => controller.abort(new Error(`MCP request exceeded ${outerDeadline}ms`)), outerDeadline);
      const approver = new KiroPowerFabricApprover(
        current.service.config.approvals,
        powerApprover,
        current.service.cwd,
      );
      const result = await current.service.execute({
        code: input.code,
        ...(input.payloads ? { payloads: input.payloads } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        signal: controller.signal,
        approver,
      });
      const projection = projectFabricExecutionText({
        result,
        resultFormat: input.resultFormat ?? current.service.config.executor.resultFormat,
        maxOutputChars: current.service.config.executor.maxOutputChars,
        writeArtifact: (content) => current.artifacts.write(content),
        normalizationDiagnostics: normalized.diagnostics,
      });
      return { content: [{ type: "text" as const, text: projection.text }], ...(projection.isError ? { isError: true } : {}) };
    } catch (error) { return toolError("adapter_error", error); }
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
          const reason = new Error("Power MCP server shutting down");
          const drained = await drain([...active], reason);
          await closeRuntime(reason, drained);
        });
      } finally { await server.close(); }
    })();
    return closeTask;
  } };
};
