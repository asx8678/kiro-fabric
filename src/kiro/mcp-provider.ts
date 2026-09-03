import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Runtime, ServerDefinition, ServerToolInfo } from "mcporter";
import { runAbortable, settleWithin, throwIfAbortedOrExpired } from "../async-settlement.js";
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
        transportSnapshot: { type: "object", additionalProperties: true },
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
const fileDigest = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readExplicitMcpConfiguration = (configPath: string): { servers: Record<string, unknown>; names: Set<string>; digest: string } => {
  const stats = fs.lstatSync(configPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 256 * 1024) {
    throw new Error("MCP configuration is not a bounded unaliased regular file");
  }
  if (process.platform !== "win32" &&
      ((typeof process.getuid === "function" && stats.uid !== process.getuid()) || (stats.mode & 0o077) !== 0)) {
    throw new Error("MCP configuration is not private to the current user");
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers) || !Array.isArray(parsed.imports) || parsed.imports.length !== 0 ||
      JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(["imports", "mcpServers"])) {
    throw new Error("MCP configuration must contain only mcpServers and imports: []");
  }
  const names = Object.keys(parsed.mcpServers);
  if (names.length > 128 || names.some((name) => !name || name.length > 256)) throw new Error("MCP configuration server names exceed product bounds");
  return { servers: parsed.mcpServers, names: new Set(names), digest: fileDigest(configPath) };
};
const configuredEnvironment = (configPath: string | undefined, server: string): Record<string, string> => {
  if (!configPath) return {};
  const entry = readExplicitMcpConfiguration(configPath).servers[server];
  const environment = isRecord(entry) && isRecord(entry.env) ? entry.env : {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) if (typeof value === "string") result[key] = value;
  return result;
};
const AMBIENT_MCPORTER_OPTIONS = [
  "MCPORTER_RECORD", "MCPORTER_RECORD_SERVER", "MCPORTER_REPLAY", "MCPORTER_REPLAY_SERVER",
  "MCPORTER_STDIO_LOGS", "MCPORTER_STDIO_TRACE", "MCPORTER_OAUTH_TIMEOUT", "MCPORTER_OAUTH_TIMEOUT_MS",
] as const;
const assertNoAmbientMcporterOptions = (): void => {
  const option = AMBIENT_MCPORTER_OPTIONS.find((name) => process.env[name] !== undefined);
  if (option) throw new Error(`Ambient mcporter option is not allowed in the Fabric runtime: ${option}`);
};
const executablePath = (command: string, cwd = process.cwd()): string => {
  if (command.includes("/") || command.includes("\\")) {
    return fs.realpathSync(path.isAbsolute(command) ? command : path.resolve(cwd, command));
  }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.resolve(cwd, directory, command);
    try { if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate); } catch { /* continue */ }
  }
  throw new Error(`Configured MCP executable cannot be resolved: ${command}`);
};
const environmentDigest = (): string => createHash("sha256")
  .update(JSON.stringify(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string").sort(([left], [right]) => left.localeCompare(right))))
  .digest("hex");
const configDigest = (configPath: string | undefined): string | null => configPath ? fileDigest(configPath) : null;

/** Cheap change-detection key for a file: modification or replacement flips
 * at least one component, so expensive content hashing is only repeated when
 * the file actually changed. */
const fileStatKey = (file: string): string => {
  const stats = fs.statSync(file, { bigint: true });
  // mtime can be restored by the file owner after a same-size in-place
  // mutation. ctime cannot, so it must participate in cache invalidation even
  // though the content digest remains the approved executable identity.
  return `${stats.dev}:${stats.ino}:${stats.ctimeNs}:${stats.mtimeNs}:${stats.size}:${stats.nlink}:${Number(stats.isSymbolicLink())}`;
};

const canonicalizeStdioTransport = (server: ServerDefinition): ServerDefinition => {
  if (server.command.kind !== "stdio") return server;
  const cwd = fs.realpathSync(server.command.cwd);
  const command = executablePath(server.command.command, cwd);
  return {
    ...server,
    command: { ...server.command, command, cwd },
  };
};

type McpTransportSnapshot = {
  schemaVersion: 1;
  server: string;
  kind: "stdio" | "http";
  endpoint?: string;
  executable?: string;
  executableDigest?: string;
  executableDevice?: string;
  executableFile?: string;
  cwd?: string;
  arguments?: string[];
  configuredEnvironmentDigest?: string;
  processEnvironmentDigest: string;
  configDigest: string | null;
  digest: string;
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

const normalizeServerTools = (value: unknown): ServerToolInfo[] => {
  if (!Array.isArray(value) || value.length > 1_000) throw new Error("Configured MCP tool list is malformed or exceeds product bounds");
  const tools = value.map((tool, index) => {
    if (!isRecord(tool) || typeof tool.name !== "string" || !tool.name || tool.name.length > 256 ||
        (tool.description !== undefined && typeof tool.description !== "string")) {
      throw new Error(`Configured MCP tool at index ${index} is malformed`);
    }
    return {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
      ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    };
  });
  assertFabricJsonBudget(tools);
  return tools;
};

const normalizeMcpResult = (result: unknown): unknown => {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    assertFabricJsonBudget(result);
    return result;
  }
  const projected = {
    content: result.content,
    ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }),
    ...(result.isError === undefined ? {} : { isError: result.isError }),
  };
  assertFabricJsonBudget(projected);
  const text = projected.content
    .filter((part): part is { type: "text"; text: string } =>
      isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  if (projected.isError === true) throw new Error((text || "MCP tool returned an error").slice(0, 2_000));
  return {
    text,
    content: projected.content,
    structuredContent: projected.structuredContent ?? null,
  };
};

/**
 * Fabric-only MCP federation. Configuration is fixed beneath the Fabric data root,
 * descriptors are static, and server contact happens only after the registry's
 * network approval (plus execute approval for stdio transports).
 */
type McpRuntimeFactory = () => Promise<Runtime>;
type ServerLease = { quiescence: Promise<void> };

export class KiroMcpProvider implements FabricProvider {
  readonly name = "mcp";
  readonly description = "Approval-gated calls to explicitly configured MCP servers";
  readonly #cwd: string;
  readonly #config: FabricMcpConfig;
  readonly #runtimeFactory: McpRuntimeFactory;
  readonly #closeController = new AbortController();
  #runtime: Runtime | undefined;
  #runtimeCreation: Promise<Runtime> | undefined;
  #loadedConfigDigest: string | null | undefined;
  readonly #serverTails = new Map<string, Promise<void>>();
  readonly #snapshotCache = new Map<string, { envDigest: string; statKey: string; snapshot: McpTransportSnapshot }>();
  #closed = false;

  constructor(cwd: string, config: FabricMcpConfig, runtimeFactory?: McpRuntimeFactory) {
    this.#cwd = cwd;
    this.#config = config;
    this.#runtimeFactory = runtimeFactory ?? (async () => {
      assertNoAmbientMcporterOptions();
      const { createRuntime, loadServerDefinitions } = await import("mcporter");
      let servers: ServerDefinition[] = [];
      this.#loadedConfigDigest = null;
      if (this.#config.configPath) {
        const configPath = path.resolve(this.#config.configPath);
        const explicit = readExplicitMcpConfiguration(configPath);
        servers = await loadServerDefinitions({ rootDir: this.#cwd, configPath });
        const verified = readExplicitMcpConfiguration(configPath);
        if (verified.digest !== explicit.digest) throw new Error("MCP configuration changed while loading");
        for (const server of servers) {
          const sources = server.sources ?? (server.source ? [server.source] : []);
          if (!explicit.names.has(server.name) || sources.length === 0 || sources.some((source) =>
            source.kind !== "local" || path.resolve(source.path) !== configPath)) {
            throw new Error("mcporter loaded a server outside the explicit Fabric configuration");
          }
        }
        if (servers.length !== explicit.names.size) throw new Error("mcporter did not load the exact Fabric server set");
        // Bind execution to the executable and cwd that were resolved from the
        // private configuration. mcporter otherwise resolves the original
        // command again when it creates a transport, allowing a PATH entry or
        // command symlink to be retargeted after approval.
        servers = servers.map(canonicalizeStdioTransport);
        this.#loadedConfigDigest = verified.digest;
      }
      return createRuntime({ rootDir: this.#cwd, servers, clientInfo: { name: "kiro-fabric", version: "1" } });
    });
  }

  async list(): Promise<FabricActionDescriptor[]> { return [...descriptors]; }

  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    return descriptors.find((entry) => entry.name === actionName);
  }

  async prepareArguments(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<Record<string, unknown>> {
    if (actionName !== "$call") return { ...args };
    const server = typeof args.server === "string" ? args.server.trim() : "";
    const tool = typeof args.tool === "string" ? args.tool.trim() : "";
    const runtime = await this.#getRuntime(context.signal);
    throwIfAbortedOrExpired(context.signal, context.deadline);
    this.#assertRuntimeConfigurationCurrent();
    if (!runtime.listServers().includes(server)) throw new Error(`Unknown configured MCP server: ${server}`);
    return {
      server,
      tool,
      args: isRecord(args.args) ? structuredClone(args.args) : {},
      transportSnapshot: this.#transportSnapshot(runtime, server),
    };
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    const signal = context.signal
      ? AbortSignal.any([context.signal, this.#closeController.signal])
      : this.#closeController.signal;
    const invocationContext = { ...context, signal };
    if (actionName === "$servers") {
      throwIfAbortedOrExpired(signal, context.deadline);
      const runtime = await this.#getRuntime(signal);
      throwIfAbortedOrExpired(signal, context.deadline);
      this.#assertRuntimeConfigurationCurrent();
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

    const runtime = await this.#getRuntime(signal);
    throwIfAbortedOrExpired(signal, context.deadline);
    this.#assertRuntimeConfigurationCurrent();
    if (!runtime.listServers().includes(server)) throw new Error(`Unknown configured MCP server: ${server}`);
    // ActionRegistry always injects this during canonical preparation. The
    // fallback preserves direct provider use in tests/embedders while still
    // snapshotting before any contact.
    const approvedTransport = this.#assertTransportSnapshot(
      runtime,
      server,
      args.transportSnapshot ?? this.#transportSnapshot(runtime, server),
    );
    if (approvedTransport.kind === "stdio") {
      await this.#approveExecution(STDIO_APPROVAL, approvedTransport, invocationContext);
    } else if (!this.#config.disableOAuth) {
      await this.#approveExecution(OAUTH_APPROVAL, approvedTransport, invocationContext);
    }

    throwIfAbortedOrExpired(signal, context.deadline);
    return this.#withServerLease(server, signal, async (lease) => {
      this.#assertTransportSnapshot(runtime, server, approvedTransport);
    // Discovery and invocation share one configured operation budget. Giving
    // each phase a fresh timeout would make one mcp.call consume nearly twice
    // the configured limit.
    const actionDeadline = performance.now() + this.#config.callTimeoutMs;
    const discoveryBudget = this.#remainingCallBudget(actionDeadline);
    const rawTools = await this.#bounded(
      runtime,
      server,
      runtime.listTools(server, {
        includeSchema: true,
        disableOAuth: this.#config.disableOAuth,
      }),
      signal,
      "tool discovery",
      discoveryBudget,
      lease,
    );
    const tools = normalizeServerTools(rawTools);
    const matches = tools.filter((tool) => tool.name === toolName);
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous MCP tool: ${server}.${toolName}`);
    this.#validateToolArguments(matches[0]!, toolArgs);

    throwIfAbortedOrExpired(signal, context.deadline);
    this.#assertTransportSnapshot(runtime, server, approvedTransport);
    const callBudget = this.#remainingCallBudget(actionDeadline);
    const result = await this.#bounded(
      runtime,
      server,
      runtime.callTool(server, toolName, {
        args: toolArgs,
        timeoutMs: callBudget,
        disableOAuth: this.#config.disableOAuth,
      }),
      signal,
      "tool call",
      callBudget,
      lease,
    );
    throwIfAbortedOrExpired(signal, context.deadline);
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
    // Do not declare a transport closed or reusable until every contacted
    // operation is provably quiescent. A stuck runtime intentionally keeps the
    // provider quarantined instead of enabling a successor with overlapping effects.
    await Promise.allSettled([...this.#serverTails.values()]);
    this.#serverTails.clear();
    this.#snapshotCache.clear();
    if (runtime) {
      await runtime.close();
    } else if (creation) {
      // A late creation observes #closed in its continuation and closes the
      // runtime it produced. Do not let a stuck factory make shutdown unbounded.
      await settleWithin([creation], MCP_CLOSE_GRACE_MS);
    }
  }

  #transportSnapshot(runtime: Runtime, server: string): McpTransportSnapshot {
    const definition = runtime.getDefinition(server);
    // Fast path: the expensive snapshot inputs are content hashes of the
    // executable and configuration file plus executable PATH resolution. Gate
    // them on cheap stat keys so an unchanged transport costs a few statSync
    // calls instead of full file reads and SHA-256 passes on every snapshot.
    // The process-environment digest is always recomputed, so environment
    // drift between approval and contact is still detected immediately.
    const processEnvironmentDigest = environmentDigest();
    let executable: string | undefined;
    if (definition.command.kind === "stdio") {
      // Re-resolve at every approval/use boundary. The stat-key cache below
      // avoids rehashing unchanged bytes, but never pins a stale symlink/PATH
      // resolution that differs from the command mcporter is about to use.
      executable = executablePath(definition.command.command, definition.command.cwd);
    }
    const statKey = `${executable ? fileStatKey(executable) : "-"}|${this.#config.configPath ? fileStatKey(this.#config.configPath) : "-"}`;
    const cached = this.#snapshotCache.get(server);
    if (cached && cached.envDigest === processEnvironmentDigest && cached.statKey === statKey) return cached.snapshot;
    const snapshot = this.#computeTransportSnapshot(runtime, server, processEnvironmentDigest, executable);
    this.#snapshotCache.set(server, { envDigest: processEnvironmentDigest, statKey, snapshot });
    return snapshot;
  }

  #assertRuntimeConfigurationCurrent(): void {
    if (this.#loadedConfigDigest === undefined) return;
    if (configDigest(this.#config.configPath) !== this.#loadedConfigDigest) {
      throw new Error("MCP configuration changed after runtime loading; restart before calling a server");
    }
  }

  #computeTransportSnapshot(runtime: Runtime, server: string, processEnvironmentDigest: string, resolvedExecutable?: string): McpTransportSnapshot {
    this.#assertRuntimeConfigurationCurrent();
    const definition = runtime.getDefinition(server);
    const base = {
      schemaVersion: 1 as const,
      server,
      processEnvironmentDigest,
      configDigest: configDigest(this.#config.configPath),
    };
    const details = definition.command.kind === "stdio"
      ? (() => {
          const executable = resolvedExecutable ?? executablePath(definition.command.command, definition.command.cwd);
          const stats = fs.statSync(executable, { bigint: true });
          const configured = configuredEnvironment(this.#config.configPath, server);
          return {
            kind: "stdio" as const,
            executable,
            executableDigest: fileDigest(executable),
            executableDevice: String(stats.dev),
            executableFile: String(stats.ino),
            cwd: fs.realpathSync(definition.command.cwd ?? this.#cwd),
            arguments: [...(definition.command.args ?? [])],
            configuredEnvironmentDigest: createHash("sha256").update(JSON.stringify(Object.entries(configured).sort(([left], [right]) => left.localeCompare(right)))).digest("hex"),
          };
        })()
      : { kind: "http" as const, endpoint: definition.command.url.href };
    const unsigned = { ...base, ...details };
    return { ...unsigned, digest: createHash("sha256").update("kiro-fabric-mcp-transport-v1\0").update(JSON.stringify(unsigned)).digest("hex") };
  }

  #assertTransportSnapshot(runtime: Runtime, server: string, approved: unknown): McpTransportSnapshot {
    if (!isRecord(approved)) throw new Error("MCP call is missing its approved transport snapshot");
    const current = this.#transportSnapshot(runtime, server);
    if (JSON.stringify(current) !== JSON.stringify(approved)) throw new Error("MCP transport changed after approval; approve the exact transport again");
    return current;
  }

  async #approveExecution(
    action: ResolvedFabricAction,
    details: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<void> {
    if (!context.approve) throw new Error(`${action.ref} execution approval is unavailable`);
    await context.approve(action, details);
    throwIfAbortedOrExpired(context.signal, context.deadline);
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

  async #withServerLease<T>(server: string, signal: AbortSignal | undefined, operation: (lease: ServerLease) => Promise<T>): Promise<T> {
    const previous = this.#serverTails.get(server) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current, () => current);
    this.#serverTails.set(server, tail);
    const lease: ServerLease = { quiescence: Promise.resolve() };
    try {
      await runAbortable(signal, () => previous);
      throwIfAbortedOrExpired(signal);
      return await operation(lease);
    } finally {
      // Caller cancellation may settle after bounded close grace, but the
      // same-server ownership tail remains until the raw operation itself ends.
      void lease.quiescence.finally(() => {
        release();
        if (this.#serverTails.get(server) === tail) this.#serverTails.delete(server);
      });
    }
  }

  #remainingCallBudget(deadline: number): number {
    const remaining = Math.ceil(deadline - performance.now());
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
    lease: ServerLease,
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
        const close = Promise.resolve().then(() => runtime.close(server));
        // Lease release requires both transport close and raw operation
        // settlement; close() alone is not treated as proof of quiescence.
        lease.quiescence = Promise.allSettled([lease.quiescence, operation, close]).then(() => undefined);
        void settleWithin([close], MCP_CLOSE_GRACE_MS).then(() => {
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
