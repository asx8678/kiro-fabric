// Kiro-facing MCP stdio server. Speaks MCP over newline-delimited JSON-RPC
// (the transport Kiro v3 stdio servers use), advertising exactly one tool:
// `fabric_exec`, whose inputSchema is the byte-identical PR 3 kernel contract.
//
// Fail-closed policy:
// - Nested Fabric approval is not delegated to an MCP client; approval-requiring
//   actions deny with a stable diagnostic (handled by the Kiro host approver).
// - MCP cancellation and the hard per-call deadline share one abort signal.
//   Process-group kill remains owned by doctor/managed launchers.
// - diagnostics go to stderr only; stdout carries protocol frames exclusively.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Value } from "typebox/value";
import {
  fabricExecInputSchema,
  fabricExecInputSchemaJson,
  prepareFabricExecArguments,
  type FabricExecInput,
} from "../kernel/fabric-exec-contract.js";
import { KIRO_MCP_CALL_TIMEOUT_MS } from "./deadlines.js";
import { prepareKiroRuntime, type KiroRuntime } from "./runtime.js";
import { projectFabricExecutionText } from "./projection.js";
import { normalizeRunDisplay } from "../run-display.js";

const TOOL_NAME = "fabric_exec";

const TOOL_DESCRIPTION =
  "Execute type-checked TypeScript through Fabric's configured executor for coding tools, MCP, Fabric providers, and discovery.";

export interface KiroMcpServerOptions {
  cwd: string;
  runtime?: KiroRuntime;
  /** Bare portable child tools; when set (including `[]`), the runtime is scoped. */
  tools?: readonly string[];
  /** Trusted-local, managed-main opt-in for bounded ACP child fan-out. */
  enableSubagents?: boolean;
  /** Package version advertised in serverInfo. */
  version?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readPackageVersion = (): string => {
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(cursor, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "kiro-fabric" && pkg.version) return pkg.version;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return "0.0.0";
};

export const createKiroMcpServer = async (
  options: KiroMcpServerOptions,
): Promise<{ close(): Promise<void> }> => {
  const runtime =
    options.runtime ??
    (await prepareKiroRuntime({
      cwd: options.cwd,
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.enableSubagents ? { enableSubagents: true } : {}),
    }));

  const server = new Server(
    {
      name: "kiro-fabric",
      version: options.version ?? readPackageVersion(),
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        inputSchema: fabricExecInputSchemaJson() as never,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name } = request.params;
    if (name !== TOOL_NAME) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${String(name)}` }],
        isError: true,
      };
    }

    const prepared = prepareFabricExecArguments(request.params.arguments ?? {});
    if (!isRecord(prepared) || !Value.Check(fabricExecInputSchema, prepared)) {
      const errors = isRecord(prepared)
        ? [...Value.Errors(fabricExecInputSchema, prepared)]
            .map((e) => e.message)
            .join("; ")
        : "arguments must be an object";
      return {
        content: [{ type: "text" as const, text: `Invalid fabric_exec arguments: ${errors}` }],
        isError: true,
      };
    }
    const input = prepared as unknown as FabricExecInput;
    const display = normalizeRunDisplay(input.display);

    const controller = new AbortController();
    const forwardCancellation = (): void => controller.abort(extra.signal.reason);
    if (extra.signal.aborted) forwardCancellation();
    else extra.signal.addEventListener("abort", forwardCancellation, { once: true });
    const callId = `kiro:${randomUUID()}`;
    const timer = setTimeout(() => controller.abort(), KIRO_MCP_CALL_TIMEOUT_MS);
    timer.unref?.();
    try {
      const result = await runtime.service.execute({
        code: input.code,
        ...(input.strings ? { strings: input.strings } : {}),
        signal: controller.signal,
        parentToolCallId: callId,
        host: runtime.host,
        ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
        ...(input.agentBudget !== undefined ? { maxAgentCalls: input.agentBudget } : {}),
        ...(display ? { display } : {}),
        onPartial() {},
      });

      const projected = await projectFabricExecutionText({
        result,
        code: input.code,
        resultFormat: input.resultFormat ?? runtime.service.config.executor.resultFormat,
        maxOutputChars: runtime.service.config.executor.maxOutputChars,
        // The returned token is readable only through k.readArtifact during
        // this MCP session; no sensitive overflow is persisted to disk.
        writeArtifact: (content) => Promise.resolve(runtime.artifacts.write(content)),
      });
      return {
        content: [{ type: "text" as const, text: projected.text }],
        ...(projected.isError ? { isError: true } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Fabric adapter error: ${message}` }],
        isError: true,
      };
    } finally {
      clearTimeout(timer);
      extra.signal.removeEventListener("abort", forwardCancellation);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    async close() {
      try {
        await runtime.close();
      } finally {
        await server.close();
      }
    },
  };
};
