// Kiro-facing protocol-clean MCP stdio server. Strict mode retains the exact
// one-tool boundary; Power mode adds only information and workspace binding.
import { randomUUID } from "node:crypto";
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
import {
  fabricExecInputSchema,
  fabricExecInputSchemaJson,
  prepareFabricExecArguments,
  type FabricExecInput,
} from "../kernel/fabric-exec-contract.js";
import { normalizeRunDisplay } from "../run-display.js";
import { KIRO_MCP_CALL_TIMEOUT_MS } from "./deadlines.js";
import type { KiroIntegrationMode } from "./integration-mode.js";
import { readPackageVersion } from "./managed.js";
import { KiroPowerApprover } from "./power/approver.js";
import {
  prepareKiroPowerDataPaths,
  prepareKiroPowerProjectPaths,
} from "./power/data-paths.js";
import {
  CachedWorkspaceContextProvider,
  type KiroWorkspaceSnapshot,
  type WorkspaceContextProvider,
} from "./power/workspace-context.js";
import {
  KiroPowerWorkspaceBinding,
  type KiroPowerBoundWorkspace,
  type KiroPowerWorkspaceRequest,
} from "./power/workspace-binding.js";
import { projectFabricExecutionText } from "./projection.js";
import { prepareKiroRuntime, type KiroRuntime } from "./runtime.js";

const STRICT_DESCRIPTION =
  "Execute type-checked TypeScript through Fabric's configured executor for coding tools, MCP, Fabric providers, and discovery.";
const POWER_DESCRIPTION =
  "Execute checked TypeScript for programmable workflows, memory, bound state, and configured MCP federation. Power ACP agents are unavailable; use Kiro native tools and native subagents outside Fabric for ordinary work.";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** MCP's empty elicitation capability is the backwards-compatible form capability. */
export const supportsKiroPowerElicitation = (capabilities: unknown): boolean => {
  if (!isRecord(capabilities) || !isRecord(capabilities.elicitation)) return false;
  const elicitation = capabilities.elicitation;
  return Object.keys(elicitation).length === 0 || Object.hasOwn(elicitation, "form");
};

export interface KiroMcpServerOptions {
  integration?: KiroIntegrationMode;
  cwd?: string;
  pluginRoot?: string;
  pluginData?: string;
  runtime?: KiroRuntime;
  tools?: readonly string[];
  enableSubagents?: boolean;
  version?: string;
  /** Test/host override; Power normally adapts MCP roots through a cached provider. */
  workspaceContext?: WorkspaceContextProvider;
}

const workspaceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["status", "list", "select", "attach", "detach"] },
    rootId: { type: "string", minLength: 1, maxLength: 64 },
    path: { type: "string", minLength: 1, maxLength: 4096 },
  },
} as const;

const workspaceRequest = (value: unknown): KiroPowerWorkspaceRequest => {
  if (!isRecord(value) || typeof value.action !== "string") {
    throw new Error("fabric_workspace requires a closed action request");
  }
  const keys = Object.keys(value);
  switch (value.action) {
    case "status":
    case "list":
    case "detach":
      if (keys.length !== 1) throw new Error(`${value.action} accepts no other fields`);
      return { action: value.action };
    case "select":
      if (keys.length !== 2 || typeof value.rootId !== "string") {
        throw new Error("select requires only rootId");
      }
      return { action: "select", rootId: value.rootId };
    case "attach":
      if (keys.length !== 2 || typeof value.path !== "string") {
        throw new Error("attach requires only path");
      }
      return { action: "attach", path: value.path };
    default:
      throw new Error("unknown fabric_workspace action");
  }
};

interface ActiveExecution {
  controller: AbortController;
  settled: Promise<void>;
  settle(): void;
}

export const createKiroMcpServer = async (
  options: KiroMcpServerOptions,
): Promise<{ close(): Promise<void> }> => {
  const integration = options.integration ?? "strict";
  if (integration === "internal-child" && options.tools === undefined) {
    throw new Error("internal-child MCP launch requires an explicit tool scope");
  }
  if (integration !== "power" && !options.cwd) {
    throw new Error(`${integration} MCP launch requires cwd`);
  }
  if (integration === "power" && (!options.pluginRoot || !options.pluginData)) {
    throw new Error("power MCP launch requires PLUGIN_ROOT and PLUGIN_DATA");
  }

  const version = options.version ?? (integration === "power"
    ? String((JSON.parse(readFileSync(path.join(options.pluginRoot!, "package.json"), "utf8")) as { version: unknown }).version)
    : readPackageVersion());
  const server = new Server(
    { name: "kiro-fabric", version },
    { capabilities: { tools: {} } },
  );
  const active = new Set<ActiveExecution>();
  let runtime = options.runtime;
  let runtimeIdentity = options.runtime && integration === "power"
    ? "<unbound>"
    : options.cwd ?? "";
  let closing = false;
  let lifecycleTail = Promise.resolve();
  const data = integration === "power"
    ? prepareKiroPowerDataPaths(options.pluginData!)
    : undefined;

  const runLifecycle = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = lifecycleTail.then(operation, operation);
    lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const drainActive = async (reason: Error): Promise<void> => {
    const executions = [...active];
    for (const execution of executions) execution.controller.abort(reason);
    await Promise.allSettled(executions.map((execution) => execution.settled));
  };
  const closeRuntime = async (): Promise<void> => {
    const current = runtime;
    runtime = undefined;
    runtimeIdentity = "";
    await current?.close();
  };

  const powerApprover = integration === "power" ? new KiroPowerApprover({
    supported: () => supportsKiroPowerElicitation(server.getClientCapabilities()),
    request: async ({ message, signal, timeoutMs }) => {
      const result = await server.elicitInput({
        mode: "form",
        message,
        requestedSchema: {
          type: "object",
          properties: {
            approved: { type: "boolean", title: "Approve once", default: false },
          },
          required: ["approved"],
        },
      }, { ...(signal ? { signal } : {}), timeout: timeoutMs });
      return {
        action: result.action,
        ...(isRecord(result.content) && result.content.approved === true
          ? { approved: true }
          : {}),
      };
    },
  }) : undefined;
  const binding = integration === "power" ? new KiroPowerWorkspaceBinding({
    pluginRoot: options.pluginRoot!,
    pluginData: options.pluginData!,
    elicitor: {
      approveWorkspace: (canonicalPath, signal) => powerApprover!.approveOnce({
        risk: "write",
        provider: "fabric_workspace",
        action: "attach",
        summary: `Canonical workspace: ${canonicalPath}`,
        ...(signal ? { signal } : {}),
      }),
    },
  }) : undefined;
  const workspaceContext = integration === "power"
    ? options.workspaceContext ?? new CachedWorkspaceContextProvider({
        supported: () => {
          const capabilities = server.getClientCapabilities() as { roots?: unknown } | undefined;
          return capabilities?.roots !== undefined;
        },
        load: async () => (await server.listRoots(undefined, { timeout: 2_000 })).roots,
      })
    : undefined;
  let workspaceSnapshot: KiroWorkspaceSnapshot | undefined;

  const identityKey = (workspace: KiroPowerBoundWorkspace | undefined): string => workspace
    ? `${workspace.canonicalPath}\0${workspace.deviceId}\0${workspace.fileId}`
    : "<unbound>";

  const syncWorkspaceContext = async (force = false): Promise<KiroWorkspaceSnapshot | undefined> => {
    if (!binding || !workspaceContext) return undefined;
    const snapshot = await workspaceContext.current({ force });
    await runLifecycle(async () => {
      if (closing) return;
      workspaceSnapshot = snapshot;
      if (snapshot.status === "temporarily-unavailable") return;
      const previous = identityKey(binding.boundWorkspace());
      binding.updateClientRoots(snapshot.roots);
      if (previous !== identityKey(binding.boundWorkspace())) {
        await drainActive(new Error("MCP workspace roots changed"));
        await closeRuntime();
      }
    });
    return snapshot;
  };

  const clientWorkspaceTemporarilyUnavailable = (): boolean =>
    workspaceSnapshot?.status === "temporarily-unavailable" &&
    binding?.boundWorkspace()?.source === "client-roots";

  const createRuntime = async (): Promise<KiroRuntime> => {
    if (integration !== "power") {
      return prepareKiroRuntime({
        cwd: options.cwd!,
        integration,
        ...(options.tools ? { tools: options.tools } : {}),
        ...(options.enableSubagents ? { enableSubagents: true } : {}),
      });
    }
    const bound = binding!.boundWorkspace();
    const project = bound
      ? prepareKiroPowerProjectPaths(data!.projects, bound)
      : undefined;
    return prepareKiroRuntime({
      cwd: bound?.canonicalPath ?? data!.root,
      integration: "power",
      agentDir: data!.config,
      powerMcpConfigPath: data!.mcpConfig,
      ...(project ? { memoryRoot: project.memory, stateRoot: project.state } : {}),
      powerApprover: powerApprover!,
    });
  };

  const runtimeForCurrentIdentity = async (): Promise<KiroRuntime> => {
    const identity = integration === "power"
      ? identityKey(binding!.boundWorkspace())
      : options.cwd!;
    if (runtime && runtimeIdentity === identity) return runtime;
    await closeRuntime();
    runtime = await createRuntime();
    runtimeIdentity = identity;
    return runtime;
  };

  const getRuntime = (): Promise<KiroRuntime> => runLifecycle(async () => {
    if (closing) throw new Error("MCP server is shutting down");
    return runtimeForCurrentIdentity();
  });

  const acquireExecutionRuntime = (
    controller: AbortController,
  ): Promise<{ current: KiroRuntime; execution: ActiveExecution }> =>
    runLifecycle(async () => {
      if (closing) throw new Error("MCP server is shutting down");
      const current = await runtimeForCurrentIdentity();
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => { settle = resolve; });
      const execution = { controller, settled, settle };
      active.add(execution);
      return { current, execution };
    });

  const handleWorkspace = async (
    request: KiroPowerWorkspaceRequest,
    signal: AbortSignal,
  ): Promise<unknown> => runLifecycle(async () => {
    if (closing) throw new Error("MCP server is shutting down");
    const mutating = request.action === "select" ||
      request.action === "attach" ||
      request.action === "detach";
    if (request.action === "select" && clientWorkspaceTemporarilyUnavailable()) {
      throw new Error("workspace roots are temporarily unverifiable; retry after the client recovers");
    }
    const previous = identityKey(binding!.boundWorkspace());
    if (mutating) {
      await drainActive(new Error("Power workspace binding changed"));
    }
    const result = await binding!.handle(request, signal);
    if (previous !== identityKey(binding!.boundWorkspace())) await closeRuntime();
    return result;
  });

  if (integration === "power") {
    server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      workspaceContext!.invalidate();
      await syncWorkspaceContext(true);
    });
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (integration === "power") await syncWorkspaceContext();
    const exec = {
      name: "fabric_exec",
      description: integration === "power" ? POWER_DESCRIPTION : STRICT_DESCRIPTION,
      inputSchema: fabricExecInputSchemaJson() as never,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    };
    if (integration !== "power") return { tools: [exec] };
    return {
      tools: [
        {
          name: "fabric_info",
          description: "Report bounded Kiro Fabric Power capability and lifecycle status without secrets.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        {
          name: "fabric_workspace",
          description: "Inspect or explicitly bind the Power to one validated workspace. Manual paths require approve-once MCP elicitation.",
          inputSchema: workspaceSchema,
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
          },
        },
        exec,
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (integration === "power") await syncWorkspaceContext();
    const name = request.params.name;
    if (integration === "power" && name === "fabric_info") {
      if (Object.keys(request.params.arguments ?? {}).length) {
        return {
          content: [{ type: "text" as const, text: "fabric_info accepts no arguments" }],
          isError: true,
        };
      }
      const status = binding!.status();
      const current = await getRuntime();
      const providers = new Set(current.registry.providers().map((provider) => provider.name));
      const capabilities = [
        "checked-execution",
        ...(providers.has("artifacts") ? ["overflow-artifacts"] : []),
        ...(providers.has("memory") ? ["memory"] : []),
        ...(providers.has("state") ? ["state"] : []),
        ...(providers.has("mcp") ? ["mcp-federation"] : []),
      ];
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            integration: "power",
            version,
            runtime: { quickjs: "available" },
            workspace: {
              ...status,
              capabilities,
              context: {
                status: workspaceSnapshot?.status ?? "temporarily-unavailable",
                revision: workspaceSnapshot?.revision ?? 0,
              },
            },
            kiroAcp: {
              status: "unavailable",
              agents: false,
              reason: "real Kiro ACP qualification is a separate fail-closed gate",
            },
            capabilities,
            durability: { guaranteedAcrossPowerDeactivation: false },
          }),
        }],
      };
    }
    if (integration === "power" && name === "fabric_workspace") {
      try {
        const parsed = workspaceRequest(request.params.arguments ?? {});
        const result = await handleWorkspace(parsed, extra.signal);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Workspace binding failed: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
    }
    if (name !== "fabric_exec") {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${String(name)}` }],
        isError: true,
      };
    }
    if (integration === "power" && clientWorkspaceTemporarilyUnavailable()) {
      return {
        content: [{
          type: "text" as const,
          text: "Fabric adapter error: workspace roots are temporarily unverifiable; retry after the client recovers",
        }],
        isError: true,
      };
    }
    const prepared = prepareFabricExecArguments(request.params.arguments ?? {});
    if (!isRecord(prepared) || !Value.Check(fabricExecInputSchema, prepared)) {
      const errors = isRecord(prepared)
        ? [...Value.Errors(fabricExecInputSchema, prepared)].map((error) => error.message).join("; ")
        : "arguments must be an object";
      return {
        content: [{ type: "text" as const, text: `Invalid fabric_exec arguments: ${errors}` }],
        isError: true,
      };
    }

    const input = prepared as unknown as FabricExecInput;
    const controller = new AbortController();
    const cancel = (): void => controller.abort(extra.signal.reason);
    if (extra.signal.aborted) cancel();
    else extra.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), KIRO_MCP_CALL_TIMEOUT_MS);
    timer.unref?.();
    let execution: ActiveExecution | undefined;
    try {
      const acquired = await acquireExecutionRuntime(controller);
      execution = acquired.execution;
      const current = acquired.current;
      const result = await current.service.execute({
        code: input.code,
        ...(input.strings ? { strings: input.strings } : {}),
        signal: controller.signal,
        parentToolCallId: `kiro:${randomUUID()}`,
        host: current.host,
        ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
        ...(input.agentBudget !== undefined ? { maxAgentCalls: input.agentBudget } : {}),
        ...(normalizeRunDisplay(input.display)
          ? { display: normalizeRunDisplay(input.display)! }
          : {}),
        onPartial() {},
      });
      const projected = await projectFabricExecutionText({
        result,
        code: input.code,
        resultFormat: input.resultFormat ?? current.service.config.executor.resultFormat,
        maxOutputChars: current.service.config.executor.maxOutputChars,
        writeArtifact: (content) => Promise.resolve(current.artifacts.write(content)),
        ...(integration === "power"
          ? {
              artifactReadHint: (id: string) =>
                `await tools.call({ ref: "artifacts.read", args: { id: ${JSON.stringify(id)} } })`,
            }
          : {}),
      });
      return {
        content: [{ type: "text" as const, text: projected.text }],
        ...(projected.isError ? { isError: true } : {}),
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Fabric adapter error: ${(error as Error).message}`,
        }],
        isError: true,
      };
    } finally {
      clearTimeout(timer);
      if (execution) {
        active.delete(execution);
        execution.settle();
      }
      extra.signal.removeEventListener("abort", cancel);
    }
  });

  await server.connect(new StdioServerTransport());
  let closeTask: Promise<void> | undefined;
  return {
    close() {
      closeTask ??= (async () => {
        try {
          await runLifecycle(async () => {
            closing = true;
            await drainActive(new Error("Power MCP server shutting down"));
            await closeRuntime();
          });
        } finally {
          await server.close();
        }
      })();
      return closeTask;
    },
  };
};
