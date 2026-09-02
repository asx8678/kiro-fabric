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
import { KIRO_MCP_CALL_TIMEOUT_MS, KIRO_MCP_DRAIN_TIMEOUT_MS } from "./deadlines.js";
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
  kiroPowerWorkspaceRequestSchema,
  type KiroPowerBoundWorkspace,
  type KiroPowerWorkspaceRequest,
} from "./power/workspace-binding.js";
import { projectFabricExecutionText } from "./projection.js";
import { prepareKiroRuntime, type KiroRuntime, type KiroRuntimeOptions } from "./runtime.js";

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
  /** Test/embedded-host runtime factory. */
  prepareRuntime?: (options: KiroRuntimeOptions) => Promise<KiroRuntime>;
  tools?: readonly string[];
  enableSubagents?: boolean;
  version?: string;
  /** Test/host override; Power normally adapts MCP roots through a cached provider. */
  workspaceContext?: WorkspaceContextProvider;
}

const boundedText = (value: unknown, fallback: string, maximum = 500): string => {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maximum) || fallback;
};

const publicToolError = (code: string, error: unknown, issues?: readonly unknown[]) => ({
  content: [{
    type: "text" as const,
    text: JSON.stringify({
      error: {
        code,
        message: boundedText(error, "The request failed"),
        ...(issues?.length ? { issues: issues.slice(0, 8).map((issue) => boundedText(issue, "invalid value", 200)) } : {}),
      },
    }),
  }],
  isError: true as const,
});

const workspaceRequest = (value: unknown): KiroPowerWorkspaceRequest => {
  if (Value.Check(kiroPowerWorkspaceRequestSchema, value)) return value as KiroPowerWorkspaceRequest;
  const issues = [...Value.Errors(kiroPowerWorkspaceRequestSchema, value)].map((error, index) =>
    `constraint ${index + 1}: ${error.message}`,
  );
  throw Object.assign(new Error("Invalid fabric_workspace arguments"), { issues });
};

interface ActiveExecution {
  controller: AbortController;
  runtime: KiroRuntime;
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
  const drainExecutions = async (
    executions: readonly ActiveExecution[],
    reason: Error,
  ): Promise<boolean> => {
    for (const execution of executions) execution.controller.abort(reason);
    if (executions.length === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    let drained = false;
    try {
      await Promise.race([
        Promise.allSettled(executions.map((execution) => execution.settled)).then(() => { drained = true; }),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, KIRO_MCP_DRAIN_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
      return drained;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const drainActive = (reason: Error): Promise<boolean> =>
    drainExecutions([...active], reason);
  const closeRuntime = async (reason: Error, knownDrained?: boolean): Promise<void> => {
    const current = runtime;
    runtime = undefined;
    runtimeIdentity = "";
    if (!current) return;
    const executions = [...active].filter((execution) => execution.runtime === current);
    const drained = knownDrained ?? await drainExecutions(executions, reason);
    if (drained || executions.length === 0) {
      await current.close();
      return;
    }
    // A bounded drain must not close provider/process resources underneath an
    // abort-insensitive stale execution. Retire the runtime and close it only
    // after every execution that leased it has actually settled.
    void Promise.allSettled(executions.map((execution) => execution.settled))
      .then(() => current.close())
      .catch(() => {});
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

  const syncWorkspaceContext = async (force = false): Promise<KiroWorkspaceSnapshot | undefined> => {
    if (!binding || !workspaceContext) return undefined;
    const snapshot = await workspaceContext.current({ force });
    await runLifecycle(async () => {
      if (closing) return;
      workspaceSnapshot = snapshot;
      if (snapshot.status === "temporarily-unavailable") return;
      const previous = binding.bindingIdentity();
      binding.updateClientRoots(snapshot.roots);
      if (previous !== binding.bindingIdentity()) {
        await closeRuntime(new Error("MCP workspace roots changed"));
      }
    });
    return snapshot;
  };

  const clientWorkspaceTemporarilyUnavailable = (): boolean =>
    workspaceSnapshot?.status === "temporarily-unavailable" &&
    binding?.bindingSource() === "client-roots";

  const createRuntime = async (
    powerWorkspace?: KiroPowerBoundWorkspace,
  ): Promise<KiroRuntime> => {
    const prepareRuntime = options.prepareRuntime ?? prepareKiroRuntime;
    if (integration !== "power") {
      return prepareRuntime({
        cwd: options.cwd!,
        integration,
        ...(options.tools ? { tools: options.tools } : {}),
        ...(options.enableSubagents ? { enableSubagents: true } : {}),
      });
    }
    const project = powerWorkspace
      ? prepareKiroPowerProjectPaths(data!.projects, powerWorkspace)
      : undefined;
    return prepareRuntime({
      cwd: powerWorkspace?.canonicalPath ?? data!.root,
      integration: "power",
      agentDir: data!.config,
      powerMcpConfigPath: data!.mcpConfig,
      ...(project ? { memoryRoot: project.memory, stateRoot: project.state } : {}),
      powerApprover: powerApprover!,
    });
  };

  const runtimeForCurrentIdentity = async (): Promise<KiroRuntime> => {
    const observation = integration === "power" ? binding!.workspaceObservation() : undefined;
    if (observation?.status === "temporarily-unavailable") {
      throw new Error("bound workspace is temporarily unverifiable; retry after local filesystem access recovers");
    }
    const powerWorkspace = observation?.status === "verified" ? observation.workspace : undefined;
    const identity = integration === "power"
      ? binding!.bindingIdentity()
      : options.cwd!;
    if (runtime && runtimeIdentity === identity) return runtime;
    await closeRuntime(new Error("MCP runtime identity changed"));
    runtime = await createRuntime(powerWorkspace);
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
      const execution = { controller, runtime: current, settled, settle };
      active.add(execution);
      return { current, execution };
    });

  const registryCapabilities = (current: KiroRuntime): string[] => {
    const providers = new Set(current.registry.providers().map((provider) => provider.name));
    return [
      "checked-execution",
      ...(providers.has("artifacts") ? ["overflow-artifacts"] : []),
      ...(providers.has("memory") ? ["memory"] : []),
      ...(providers.has("state") ? ["state"] : []),
      ...(providers.has("mcp") ? ["mcp-federation"] : []),
    ];
  };
  const reportWorkspace = (result: unknown): unknown => {
    const identity = binding!.bindingIdentity();
    const verified = binding!.workspaceObservation().status === "verified";
    return {
      ...(result as object),
      // Read-only status/list must not initialize a heavyweight runtime. Only
      // report capabilities that have actually been observed for this exact
      // binding; fabric_info is the explicit runtime probe.
      ...(verified && runtime && runtimeIdentity === identity
        ? { capabilities: registryCapabilities(runtime) }
        : {}),
    };
  };

  const handleWorkspace = async (
    request: KiroPowerWorkspaceRequest,
    signal: AbortSignal,
  ): Promise<unknown> => {
    if (request.action === "status") return reportWorkspace(binding!.status());
    if (request.action === "list") return reportWorkspace(binding!.list());
    if (request.action === "select" && clientWorkspaceTemporarilyUnavailable()) {
      throw new Error("workspace roots are temporarily unverifiable; retry after the client recovers");
    }
    // Validation, canonicalization, and potentially slow user elicitation happen
    // before entering the lifecycle queue, while the current workspace remains usable.
    const mutation = await binding!.prepareMutation(request, signal);
    const result = await runLifecycle(async () => {
      if (closing) throw new Error("MCP server is shutting down");
      if (request.action === "select" && clientWorkspaceTemporarilyUnavailable()) {
        throw new Error("workspace roots are temporarily unverifiable; retry after the client recovers");
      }
      const previous = binding!.bindingIdentity();
      const committed = binding!.commitMutation(mutation);
      const changed = previous !== binding!.bindingIdentity();
      if (changed) {
        await closeRuntime(new Error("Power workspace binding changed"));
      }
      return committed;
    });
    return reportWorkspace(result);
  };

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
          inputSchema: kiroPowerWorkspaceRequestSchema as never,
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
      try {
        if (Object.keys(request.params.arguments ?? {}).length) {
          return publicToolError("invalid_info_arguments", "fabric_info accepts no arguments");
        }
        const status = binding!.status();
        const current = await getRuntime();
        const capabilities = registryCapabilities(current);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              integration: "power",
              version,
              runtime: {
                executor: current.service.config.executor.runtime,
                limits: {
                  timeoutMs: current.service.config.executor.timeoutMs,
                  memoryLimitBytes: current.service.config.executor.memoryLimitBytes,
                  maxSourceBytes: current.service.config.executor.maxSourceBytes,
                  maxOutputChars: current.service.config.executor.maxOutputChars,
                  maxNestedResultChars: current.service.config.executor.maxNestedResultChars,
                },
              },
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
      } catch (error) {
        return publicToolError("info_request_failed", error);
      }
    }
    if (integration === "power" && name === "fabric_workspace") {
      try {
        const parsed = workspaceRequest(request.params.arguments ?? {});
        const result = await handleWorkspace(parsed, extra.signal);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        const issues = isRecord(error) && Array.isArray(error.issues) ? error.issues : undefined;
        return publicToolError("workspace_request_failed", error, issues);
      }
    }
    if (name !== "fabric_exec") {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${String(name)}` }],
        isError: true,
      };
    }
    if (integration === "power" && clientWorkspaceTemporarilyUnavailable()) {
      return publicToolError("workspace_unavailable", "workspace roots are temporarily unverifiable; retry after the client recovers");
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
      return publicToolError("adapter_error", error);
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
            const reason = new Error("Power MCP server shutting down");
            const drained = await drainActive(reason);
            await closeRuntime(reason, drained);
          });
        } finally {
          await server.close();
        }
      })();
      return closeTask;
    },
  };
};
