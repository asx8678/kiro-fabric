import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Runtime, ServerToolInfo } from "mcporter";
import { runAbortable, settleWithin, throwIfAborted } from "../async-settlement.js";
import type { FabricMcpConfig } from "../config.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  ResolvedFabricAction,
} from "../protocol.js";
import { validateSchemaValue } from "../schema-validation.js";
import { assertFabricJsonBudget } from "../runtime/json-budget.js";

const descriptors: readonly FabricActionDescriptor[] = [
  {
    name: "$servers",
    description: "List explicitly configured MCP servers without connecting",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    risk: "read",
    namespace: "management",
    effect: { kind: "none" },
  },
  {
    name: "$call",
    description: "Call one configured MCP tool after network approval",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", minLength: 1, maxLength: 256 },
        tool: { type: "string", minLength: 1, maxLength: 256 },
        args: { type: "object", additionalProperties: true },
      },
      required: ["server", "tool"],
      additionalProperties: false,
    },
    risk: "network",
    namespace: "management",
    effect: { kind: "emission" },
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const MCP_CLOSE_GRACE_MS = 1_000;
const configuredEnvironment = (configPath: string | undefined, server: string): Record<string, string> => {
  if (!configPath) return {};
  const stats = fs.lstatSync(configPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 256 * 1024) throw new Error("MCP configuration is not a bounded unaliased regular file");
  const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const root = isRecord(parsed) ? parsed : {};
  const servers = isRecord(root.mcpServers) ? root.mcpServers : root;
  const entry = isRecord(servers[server]) ? servers[server] : {};
  const environment = isRecord(entry.env) ? entry.env : {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) if (typeof value === "string") result[key] = value;
  return result;
};
const executableIdentity = (command: string): string => {
  if (command.includes("/") || command.includes("\\")) return fs.realpathSync(command);
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try { if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate); } catch { /* continue */ }
  }
  throw new Error(`Configured MCP executable cannot be resolved: ${command}`);
};
const executeApproval = (
  name: "$stdio" | "$oauth",
  description: string,
): ResolvedFabricAction => ({
  name,
  ref: `mcp.${name}`,
  provider: "mcp",
  description,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  risk: "execute",
  namespace: "management",
  effect: { kind: "emission" },
});
const STDIO_APPROVAL = executeApproval("$stdio", "Start one explicitly configured stdio MCP server");
const OAUTH_APPROVAL = executeApproval("$oauth", "Launch configured HTTP MCP authorization");

const abortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new Error(typeof signal.reason === "string" && signal.reason
      ? signal.reason
      : "MCP call cancelled");

const normalizeMcpResult = (result: unknown): unknown => {
  assertFabricJsonBudget(result);
  if (!isRecord(result) || !Array.isArray(result.content)) return result;
  const text = result.content
    .filter((part): part is { type: "text"; text: string } =>
      isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  if (result.isError === true) throw new Error((text || "MCP tool returned an error").slice(0, 2_000));
  return {
    text,
    content: result.content,
    structuredContent: result.structuredContent ?? null,
  };
};

/**
 * Power-only MCP federation. Configuration is fixed beneath PLUGIN_DATA,
 * descriptors are static, and server contact happens only after the registry's
 * network approval (plus execute approval for stdio transports).
 */
type McpRuntimeFactory = () => Promise<Runtime>;

export class KiroMcpProvider implements FabricProvider {
  readonly name = "mcp";
  readonly description = "Approval-gated calls to explicitly configured MCP servers";
  readonly #cwd: string;
  readonly #config: FabricMcpConfig;
  readonly #runtimeFactory: McpRuntimeFactory;
  readonly #closeController = new AbortController();
  #runtime: Runtime | undefined;
  #runtimeCreation: Promise<Runtime> | undefined;
  readonly #serverTails = new Map<string, Promise<void>>();
  #closed = false;

  constructor(cwd: string, config: FabricMcpConfig, runtimeFactory?: McpRuntimeFactory) {
    this.#cwd = cwd;
    this.#config = config;
    this.#runtimeFactory = runtimeFactory ?? (async () => {
      const { createRuntime } = await import("mcporter");
      return createRuntime({
        rootDir: this.#cwd,
        ...(this.#config.configPath ? { configPath: this.#config.configPath } : {}),
        clientInfo: { name: "kiro-fabric", version: "1" },
      });
    });
  }

  async list(): Promise<FabricActionDescriptor[]> { return [...descriptors]; }

  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    return descriptors.find((entry) => entry.name === actionName);
  }

  async prepareArguments(actionName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (actionName !== "$call") return { ...args };
    return {
      ...args,
      ...(typeof args.server === "string" ? { server: args.server.trim() } : {}),
      ...(typeof args.tool === "string" ? { tool: args.tool.trim() } : {}),
      ...(isRecord(args.args) ? { args: structuredClone(args.args) } : {}),
    };
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    if (actionName === "$servers") {
      throwIfAborted(context.signal);
      const runtime = await this.#getRuntime(context.signal);
      throwIfAborted(context.signal);
      const servers = runtime.listServers();
      if (servers.length > 128) throw new Error("Configured MCP server limit exceeded");
      return servers.map((name) => {
        const definition = runtime.getDefinition(name);
        return {
          name,
          description: definition.description ?? null,
          transport: definition.command.kind,
        };
      });
    }
    if (actionName !== "$call") throw new Error(`Unknown MCP federation action: ${actionName}`);

    const server = typeof args.server === "string" ? args.server : "";
    const toolName = typeof args.tool === "string" ? args.tool : "";
    const toolArgs = args.args === undefined ? {} : args.args;
    if (!server || !toolName || !isRecord(toolArgs)) {
      throw new Error("MCP call requires non-empty server/tool strings and object args");
    }

    const runtime = await this.#getRuntime(context.signal);
    throwIfAborted(context.signal);
    if (!runtime.listServers().includes(server)) throw new Error(`Unknown configured MCP server: ${server}`);
    const definition = runtime.getDefinition(server);
    if (definition.command.kind === "stdio") {
      const configuredCwd = definition.command.cwd ?? this.#cwd;
      const canonicalCwd = fs.realpathSync(configuredCwd);
      const environment = configuredEnvironment(this.#config.configPath, server);
      const environmentEntries = Object.keys(environment).sort().map((key) => [key, environment[key]] as const);
      const environmentDigest = createHash("sha256").update(JSON.stringify(environmentEntries)).digest("hex");
      await this.#approveExecution(STDIO_APPROVAL, {
        server,
        executable: executableIdentity(definition.command.command),
        cwd: canonicalCwd,
        arguments: [...(definition.command.args ?? [])],
        environment: {
          values: Object.fromEntries(environmentEntries.map(([key]) => [key, "<redacted>"])),
          redactedDigest: environmentDigest,
        },
      }, context);
    } else if (!this.#config.disableOAuth) {
      await this.#approveExecution(OAUTH_APPROVAL, {
        server,
        endpoint: definition.command.url.origin,
      }, context);
    }

    throwIfAborted(context.signal);
    return this.#withServerLease(server, context.signal, async () => {
    // Discovery and invocation share one configured operation budget. Giving
    // each phase a fresh timeout would make one mcp.call consume nearly twice
    // the configured limit.
    const actionDeadline = Date.now() + this.#config.callTimeoutMs;
    const discoveryBudget = this.#remainingCallBudget(actionDeadline);
    const tools = await this.#bounded(
      runtime,
      server,
      runtime.listTools(server, {
        includeSchema: true,
        disableOAuth: this.#config.disableOAuth,
      }),
      context.signal,
      "tool discovery",
      discoveryBudget,
    );
    assertFabricJsonBudget(tools);
    if (tools.length > 1_000) throw new Error("Configured MCP tool limit exceeded");
    const matches = tools.filter((tool) => tool.name === toolName);
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous MCP tool: ${server}.${toolName}`);
    this.#validateToolArguments(matches[0]!, toolArgs);

    throwIfAborted(context.signal);
    const callBudget = this.#remainingCallBudget(actionDeadline);
    const result = await this.#bounded(
      runtime,
      server,
      runtime.callTool(server, toolName, {
        args: toolArgs,
        timeoutMs: callBudget,
        disableOAuth: this.#config.disableOAuth,
      }),
      context.signal,
      "tool call",
      callBudget,
    );
    throwIfAborted(context.signal);
    return normalizeMcpResult(result);
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeController.abort(new Error("MCP provider is closed"));
    const runtime = this.#runtime;
    const creation = this.#runtimeCreation;
    this.#runtime = undefined;
    this.#runtimeCreation = undefined;
    await settleWithin([...this.#serverTails.values()], MCP_CLOSE_GRACE_MS);
    this.#serverTails.clear();
    if (runtime) {
      await settleWithin([Promise.resolve().then(() => runtime.close())], MCP_CLOSE_GRACE_MS);
    } else if (creation) {
      // A late creation observes #closed in its continuation and closes the
      // runtime it produced. Do not let a stuck factory make shutdown unbounded.
      await settleWithin([creation], MCP_CLOSE_GRACE_MS);
    }
  }

  async #approveExecution(
    action: ResolvedFabricAction,
    details: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<void> {
    if (!context.approve) throw new Error(`${action.ref} execution approval is unavailable`);
    await runAbortable(context.signal, () => context.approve!(action, details));
    throwIfAborted(context.signal);
  }

  #validateToolArguments(tool: ServerToolInfo, args: Record<string, unknown>): void {
    const validation = validateSchemaValue(tool.inputSchema, args, {
      pathPrefix: "/args",
      includeInstancePath: true,
    });
    // External schemas are advisory. Unsupported schemas still receive the
    // remote server's authoritative validation.
    if (validation.status === "invalid") {
      throw new Error(`Invalid arguments for mcp.call: ${validation.message}`);
    }
  }

  async #getRuntime(requestSignal?: AbortSignal): Promise<Runtime> {
    if (this.#closed) throw new Error("MCP provider is closed");
    if (this.#runtime) return this.#runtime;
    if (!this.#runtimeCreation) {
      const creation = this.#runtimeFactory()
        .then(async (runtime) => {
          if (this.#closed) {
            await runtime.close();
            throw new Error("MCP provider closed during runtime creation");
          }
          this.#runtime = runtime;
          return runtime;
        });
      this.#runtimeCreation = creation;
      void creation.finally(() => {
        if (this.#runtimeCreation === creation) this.#runtimeCreation = undefined;
      }).catch(() => undefined);
    }
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, this.#closeController.signal])
      : this.#closeController.signal;
    return runAbortable(signal, () => this.#runtimeCreation!);
  }

  async #withServerLease<T>(server: string, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    const previous = this.#serverTails.get(server) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current, () => current);
    this.#serverTails.set(server, tail);
    try {
      await runAbortable(signal, () => previous);
      throwIfAborted(signal);
      return await operation();
    } finally {
      release();
      if (this.#serverTails.get(server) === tail) this.#serverTails.delete(server);
    }
  }

  #remainingCallBudget(deadline: number): number {
    const remaining = Math.ceil(deadline - Date.now());
    if (remaining < 1) throw new Error(`MCP call timed out after ${this.#config.callTimeoutMs}ms`);
    return remaining;
  }

  #bounded<T>(
    runtime: Runtime,
    server: string,
    operation: Promise<T>,
    signal: AbortSignal | undefined,
    label: string,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let terminating = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const finish = (callback: () => void): void => {
        if (settled || terminating) return;
        settled = true;
        cleanup();
        callback();
      };
      const terminate = (error: Error): void => {
        if (settled || terminating) return;
        terminating = true;
        cleanup();
        void settleWithin([Promise.resolve().then(() => runtime.close(server))], MCP_CLOSE_GRACE_MS).then(() => {
          settled = true;
          reject(error);
        });
      };
      const onAbort = (): void => terminate(abortError(signal!));
      const timer = setTimeout(
        () => terminate(new Error(`MCP ${label} timed out after ${this.#config.callTimeoutMs}ms total`)),
        timeoutMs,
      );
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      operation.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }
}
