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
import { fabricExecInputSchema, fabricExecInputSchemaJson, prepareFabricExecArguments, type FabricExecInput } from "../kernel/fabric-exec-contract.js";
import { normalizeRunDisplay } from "../run-display.js";
import { KIRO_MCP_CALL_TIMEOUT_MS } from "./deadlines.js";
import type { KiroIntegrationMode } from "./integration-mode.js";
import { readPackageVersion } from "./managed.js";
import { KiroPowerApprover } from "./power/approver.js";
import { prepareKiroPowerDataPaths, prepareKiroPowerProjectPaths } from "./power/data-paths.js";
import { KiroPowerWorkspaceBinding, type KiroPowerWorkspaceRequest } from "./power/workspace-binding.js";
import { projectFabricExecutionText } from "./projection.js";
import { prepareKiroRuntime, type KiroRuntime } from "./runtime.js";

const STRICT_DESCRIPTION = "Execute type-checked TypeScript through Fabric's configured executor for coding tools, MCP, Fabric providers, and discovery.";
const POWER_DESCRIPTION = "Execute checked TypeScript for Fabric workflows, state, MCP federation, and bounded agent orchestration. Use Kiro native tools for ordinary single-step file, shell, web, and code-intelligence operations.";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export interface KiroMcpServerOptions {
  integration?: KiroIntegrationMode;
  cwd?: string;
  pluginRoot?: string;
  pluginData?: string;
  runtime?: KiroRuntime;
  tools?: readonly string[];
  enableSubagents?: boolean;
  version?: string;
}

const workspaceSchema = {
  type: "object", additionalProperties: false, required: ["action"],
  properties: {
    action: { type: "string", enum: ["status", "list", "select", "attach", "detach"] },
    rootId: { type: "string", minLength: 1, maxLength: 64 },
    path: { type: "string", minLength: 1, maxLength: 4096 },
  },
} as const;

const workspaceRequest = (value: unknown): KiroPowerWorkspaceRequest => {
  if (!isRecord(value) || typeof value.action !== "string") throw new Error("fabric_workspace requires a closed action request");
  const keys = Object.keys(value);
  switch (value.action) {
    case "status": case "list": case "detach":
      if (keys.length !== 1) throw new Error(`${value.action} accepts no other fields`);
      return { action: value.action };
    case "select":
      if (keys.length !== 2 || typeof value.rootId !== "string") throw new Error("select requires only rootId");
      return { action: "select", rootId: value.rootId };
    case "attach":
      if (keys.length !== 2 || typeof value.path !== "string") throw new Error("attach requires only path");
      return { action: "attach", path: value.path };
    default: throw new Error("unknown fabric_workspace action");
  }
};

export const createKiroMcpServer = async (options: KiroMcpServerOptions): Promise<{ close(): Promise<void> }> => {
  const integration = options.integration ?? "strict";
  if (integration === "internal-child" && options.tools === undefined) throw new Error("internal-child MCP launch requires an explicit tool scope");
  if (integration !== "power" && !options.cwd) throw new Error(`${integration} MCP launch requires cwd`);
  if (integration === "power" && (!options.pluginRoot || !options.pluginData)) throw new Error("power MCP launch requires PLUGIN_ROOT and PLUGIN_DATA");

  const version = options.version ?? (integration === "power"
    ? String((JSON.parse(readFileSync(path.join(options.pluginRoot!, "package.json"), "utf8")) as { version: unknown }).version)
    : readPackageVersion());
  const server = new Server({ name: "kiro-fabric", version }, { capabilities: { tools: {} } });
  const active = new Set<AbortController>();
  let runtime = options.runtime;
  let runtimeIdentity = options.cwd ?? "";
  const data = integration === "power" ? prepareKiroPowerDataPaths(options.pluginData!) : undefined;
  const powerApprover = integration === "power" ? new KiroPowerApprover({
    supported: () => Boolean((server.getClientCapabilities() as { elicitation?: { form?: unknown } } | undefined)?.elicitation?.form),
    request: async ({ message, signal, timeoutMs }) => {
      const result = await server.elicitInput({
        mode: "form",
        message,
        requestedSchema: {
          type: "object",
          properties: { approved: { type: "boolean", title: "Approve once", default: false } },
          required: ["approved"],
        },
      }, { ...(signal ? { signal } : {}), timeout: timeoutMs });
      return {
        action: result.action,
        ...(isRecord(result.content) && result.content.approved === true ? { approved: true } : {}),
      };
    },
  }) : undefined;
  const binding = integration === "power" ? new KiroPowerWorkspaceBinding({
    pluginRoot: options.pluginRoot!, pluginData: options.pluginData!,
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

  const refreshRoots = async (): Promise<void> => {
    if (!binding) return;
    const capabilities = server.getClientCapabilities() as { roots?: unknown } | undefined;
    if (!capabilities?.roots) { binding.updateClientRoots([]); return; }
    try {
      const result = await server.listRoots(undefined, { timeout: 5_000 });
      binding.updateClientRoots(result.roots);
    } catch { binding.updateClientRoots([]); }
  };

  const getRuntime = async (): Promise<KiroRuntime> => {
    if (integration !== "power") {
      if (!runtime) runtime = await prepareKiroRuntime({ cwd: options.cwd!, integration, ...(options.tools ? { tools: options.tools } : {}), ...(options.enableSubagents ? { enableSubagents: true } : {}) });
      return runtime;
    }
    const bound = binding!.boundRoot();
    const identity = bound ?? "<unbound>";
    if (runtime && identity === runtimeIdentity) return runtime;
    await runtime?.close();
    const project = bound ? prepareKiroPowerProjectPaths(data!.projects, bound) : undefined;
    runtime = await prepareKiroRuntime({
      cwd: bound ?? data!.root,
      integration: "power",
      memoryRoot: project?.memory ?? path.join(data!.root, "global", "memory"),
      ...(project ? { stateRoot: project.state } : {}),
      powerApprover: powerApprover!,
    });
    runtimeIdentity = identity;
    return runtime;
  };

  if (integration === "power") {
    server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      for (const controller of active) controller.abort(new Error("MCP workspace roots changed"));
      const previous = binding!.boundRoot();
      await refreshRoots();
      if (runtime && previous !== binding!.boundRoot()) {
        await runtime.close();
        runtime = undefined;
        runtimeIdentity = "";
      }
    });
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (integration === "power") await refreshRoots();
    const exec = { name: "fabric_exec", description: integration === "power" ? POWER_DESCRIPTION : STRICT_DESCRIPTION, inputSchema: fabricExecInputSchemaJson() as never, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } };
    if (integration !== "power") return { tools: [exec] };
    return { tools: [
      { name: "fabric_info", description: "Report bounded Kiro Fabric Power capability and lifecycle status without secrets.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      { name: "fabric_workspace", description: "Inspect or explicitly bind the Power to one validated workspace. Manual paths require approve-once MCP elicitation.", inputSchema: workspaceSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      exec,
    ] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (integration === "power") await refreshRoots();
    const name = request.params.name;
    if (integration === "power" && name === "fabric_info") {
      if (Object.keys(request.params.arguments ?? {}).length) return { content: [{ type: "text" as const, text: "fabric_info accepts no arguments" }], isError: true };
      const status = binding!.status();
      return { content: [{ type: "text" as const, text: JSON.stringify({ integration: "power", version, runtime: { quickjs: "available" }, workspace: status, kiroAcp: { status: "unavailable", agents: false, reason: "real Kiro ACP qualification is a separate fail-closed gate" }, capabilities: status.capabilities, durability: { guaranteedAcrossPowerDeactivation: false } }) }] };
    }
    if (integration === "power" && name === "fabric_workspace") {
      try { await refreshRoots(); return { content: [{ type: "text" as const, text: JSON.stringify(await binding!.handle(workspaceRequest(request.params.arguments ?? {}), extra.signal)) }] }; }
      catch (error) { return { content: [{ type: "text" as const, text: `Workspace binding failed: ${(error as Error).message}` }], isError: true }; }
    }
    if (name !== "fabric_exec") return { content: [{ type: "text" as const, text: `Unknown tool: ${String(name)}` }], isError: true };
    const prepared = prepareFabricExecArguments(request.params.arguments ?? {});
    if (!isRecord(prepared) || !Value.Check(fabricExecInputSchema, prepared)) {
      const errors = isRecord(prepared) ? [...Value.Errors(fabricExecInputSchema, prepared)].map((e) => e.message).join("; ") : "arguments must be an object";
      return { content: [{ type: "text" as const, text: `Invalid fabric_exec arguments: ${errors}` }], isError: true };
    }
    const input = prepared as unknown as FabricExecInput;
    const controller = new AbortController(); active.add(controller);
    const cancel = () => controller.abort(extra.signal.reason);
    if (extra.signal.aborted) cancel(); else extra.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), KIRO_MCP_CALL_TIMEOUT_MS); timer.unref?.();
    try {
      const current = await getRuntime();
      const result = await current.service.execute({ code: input.code, ...(input.strings ? { strings: input.strings } : {}), signal: controller.signal, parentToolCallId: `kiro:${randomUUID()}`, host: current.host, ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}), ...(input.agentBudget !== undefined ? { maxAgentCalls: input.agentBudget } : {}), ...(normalizeRunDisplay(input.display) ? { display: normalizeRunDisplay(input.display)! } : {}), onPartial() {} });
      const projected = await projectFabricExecutionText({ result, code: input.code, resultFormat: input.resultFormat ?? current.service.config.executor.resultFormat, maxOutputChars: current.service.config.executor.maxOutputChars, writeArtifact: (content) => Promise.resolve(current.artifacts.write(content)) });
      return { content: [{ type: "text" as const, text: projected.text }], ...(projected.isError ? { isError: true } : {}) };
    } catch (error) { return { content: [{ type: "text" as const, text: `Fabric adapter error: ${(error as Error).message}` }], isError: true }; }
    finally { clearTimeout(timer); active.delete(controller); extra.signal.removeEventListener("abort", cancel); }
  });

  await server.connect(new StdioServerTransport());
  return { async close() { for (const controller of active) controller.abort(new Error("Power MCP server shutting down")); active.clear(); try { await runtime?.close(); } finally { await server.close(); } } };
};
