import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Runtime, ServerDefinition, ServerToolInfo } from "mcporter";
import { runAbortable, settleWithin, throwIfAbortedOrExpired } from "../async-settlement.js";
import type { FabricMcpConfig } from "../config.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricToolAnnotations,
  ResolvedFabricAction,
} from "../protocol.js";
import { validateSchemaValue } from "../schema-validation.js";
import { assertFabricJsonBudget } from "../runtime/json-budget.js";
import { semanticDigest } from "../core/semantic-digest.js";

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
    name: "$tools",
    description: "Discover bounded schemas from one explicitly configured MCP server after approval",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", minLength: 1, maxLength: 256 },
        transportSnapshot: { type: "object", additionalProperties: true },
      },
      required: ["server"],
      additionalProperties: false,
    },
    risk: "network",
    namespace: "management",
    effect: { kind: "emission" },
  },
  {
    name: "$describe",
    description: "Describe one configured MCP tool with its bounded schema after approval",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", minLength: 1, maxLength: 256 },
        tool: { type: "string", minLength: 1, maxLength: 256 },
        transportSnapshot: { type: "object", additionalProperties: true },
      },
      required: ["server", "tool"],
      additionalProperties: false,
    },
    risk: "network",
    namespace: "management",
    effect: { kind: "emission" },
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
        expectedDescriptorDigest: { type: "string", minLength: 64, maxLength: 64 },
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
const MAX_MCP_DISCOVERY_PAGES = 100;
const MAX_MCP_DISCOVERY_TOOLS = 1_000;
const MAX_MCP_CURSOR_CHARS = 4_096;
const MAX_MCP_TRANSPORT_FILE_BYTES = 512 * 1024 * 1024;
const MAX_MCP_STDIO_ARGUMENTS = 256;
const MAX_MCP_ARGUMENT_FILES = 32;
const MAX_MCP_ARGUMENT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_MCP_ARGUMENT_FILES_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_EXPLICIT_MCP_CONFIG_BYTES = 256 * 1024;
const fileDigest = (file: string, maximumBytes = MAX_MCP_TRANSPORT_FILE_BYTES): string => {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maximumBytes)) {
      throw new Error(`MCP transport file is not regular or exceeds ${maximumBytes} bytes`);
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < Number(before.size)) {
      const count = fs.readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - position),
        position,
      );
      if (count === 0) throw new Error("MCP transport file changed while hashing");
      digest.update(buffer.subarray(0, count));
      position += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.ctimeNs !== after.ctimeNs || before.mtimeNs !== after.mtimeNs || before.nlink !== after.nlink) {
      throw new Error("MCP transport file changed while hashing");
    }
    return digest.digest("hex");
  } finally {
    fs.closeSync(descriptor);
  }
};
const sameFileIdentity = (left: fs.BigIntStats, right: fs.BigIntStats): boolean =>
  left.isFile() && right.isFile() && !left.isSymbolicLink() && !right.isSymbolicLink() &&
  left.nlink === 1n && right.nlink === 1n && left.dev === right.dev && left.ino === right.ino;
const sameFileVersion = (left: fs.BigIntStats, right: fs.BigIntStats): boolean =>
  sameFileIdentity(left, right) && left.size === right.size && left.ctimeNs === right.ctimeNs && left.mtimeNs === right.mtimeNs;
type ExplicitMcpConfiguration = {
  names: Set<string>;
  digest: string;
  bytes: Buffer;
  stats: fs.BigIntStats;
};
const readExplicitMcpConfiguration = (configPath: string): ExplicitMcpConfiguration => {
  const lexical = fs.lstatSync(configPath, { bigint: true });
  if (!lexical.isFile() || lexical.isSymbolicLink() || lexical.nlink !== 1n ||
      lexical.size > BigInt(MAX_EXPLICIT_MCP_CONFIG_BYTES)) {
    throw new Error("MCP configuration is not a bounded unaliased regular file");
  }
  if (process.platform !== "win32" &&
      ((typeof process.getuid === "function" && lexical.uid !== BigInt(process.getuid())) || (lexical.mode & 0o077n) !== 0n)) {
    throw new Error("MCP configuration is not private to the current user");
  }
  const descriptor = fs.openSync(configPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let opened: fs.BigIntStats;
  let after: fs.BigIntStats;
  const buffer = Buffer.allocUnsafe(MAX_EXPLICIT_MCP_CONFIG_BYTES + 1);
  let byteCount = 0;
  try {
    opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(lexical, opened)) throw new Error("MCP configuration changed while opening");
    while (byteCount < buffer.length) {
      const count = fs.readSync(descriptor, buffer, byteCount, buffer.length - byteCount, byteCount);
      if (count === 0) break;
      byteCount += count;
    }
    if (byteCount > MAX_EXPLICIT_MCP_CONFIG_BYTES) throw new Error("MCP configuration exceeds 262144 bytes");
    after = fs.fstatSync(descriptor, { bigint: true });
  } finally {
    fs.closeSync(descriptor);
  }
  const current = fs.lstatSync(configPath, { bigint: true });
  if (!sameFileVersion(opened, after) || !sameFileVersion(opened, current)) {
    throw new Error("MCP configuration changed while reading");
  }
  const bytes = Buffer.from(buffer.subarray(0, byteCount));
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers) || !Array.isArray(parsed.imports) || parsed.imports.length !== 0 ||
      JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(["imports", "mcpServers"])) {
    throw new Error("MCP configuration must contain only mcpServers and imports: []");
  }
  const names = Object.keys(parsed.mcpServers);
  if (names.length > 128 || names.some((name) => !name || name.length > 256)) throw new Error("MCP configuration server names exceed product bounds");
  return {
    names: new Set(names),
    digest: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    stats: opened,
  };
};
const fsyncDirectory = (directory: string): void => {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
};
type StagedMcpConfiguration = { path: string; directory: string; digest: string; stats: fs.BigIntStats };
const stageExplicitMcpConfiguration = (
  configPath: string,
  explicit: ExplicitMcpConfiguration,
): StagedMcpConfiguration => {
  const directory = path.dirname(configPath);
  const directoryStats = fs.lstatSync(directory, { bigint: true });
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink() ||
      (process.platform !== "win32" &&
        ((typeof process.getuid === "function" && directoryStats.uid !== BigInt(process.getuid())) ||
          (directoryStats.mode & 0o077n) !== 0n))) {
    throw new Error("MCP configuration directory is not private to the current user");
  }
  const stagedPath = path.join(
    directory,
    `.kiro-fabric-mcp-snapshot-${process.pid}-${randomBytes(16).toString("hex")}.json`,
  );
  let descriptor: number | undefined;
  let createdStats: fs.BigIntStats | undefined;
  try {
    descriptor = fs.openSync(
      stagedPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    createdStats = fs.fstatSync(descriptor, { bigint: true });
    fs.writeFileSync(descriptor, explicit.bytes);
    fs.fsyncSync(descriptor);
    const writtenStats = fs.fstatSync(descriptor, { bigint: true });
    fs.closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(directory);
    const verified = readExplicitMcpConfiguration(stagedPath);
    if (!sameFileIdentity(createdStats, writtenStats) || !sameFileIdentity(writtenStats, verified.stats) ||
        verified.digest !== explicit.digest) {
      throw new Error("staged MCP configuration changed while writing");
    }
    return { path: stagedPath, directory, digest: explicit.digest, stats: verified.stats };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (createdStats !== undefined) {
      try {
        const current = fs.lstatSync(stagedPath, { bigint: true });
        if (sameFileIdentity(createdStats, current)) {
          fs.unlinkSync(stagedPath);
          fsyncDirectory(directory);
        }
      } catch { /* retain the staging error and preserve anything unowned */ }
    }
    throw error;
  }
};
const removeStagedMcpConfiguration = (staged: StagedMcpConfiguration): void => {
  let verification: unknown;
  try {
    const verified = readExplicitMcpConfiguration(staged.path);
    if (!sameFileIdentity(staged.stats, verified.stats) || verified.digest !== staged.digest) {
      throw new Error("staged MCP configuration ownership changed while loading");
    }
  } catch (error) {
    verification = error;
  }
  try {
    // Remove exactly the staged file this process created, even when
    // verification failed, so a rejected load never leaks a snapshot in the
    // user's configuration directory. A file this process no longer provably
    // owns stays untouched and the verification failure is surfaced instead.
    const current = fs.lstatSync(staged.path, { bigint: true });
    if (sameFileIdentity(staged.stats, current)) {
      fs.unlinkSync(staged.path);
      fsyncDirectory(staged.directory);
    }
  } catch (error) {
    if (verification === undefined) throw error;
  }
  if (verification !== undefined) throw verification;
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
const configDigest = (configPath: string | undefined): string | null =>
  configPath ? readExplicitMcpConfiguration(configPath).digest : null;

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

const boundArgumentStatKey = (entry: ResolvedStdioArgumentFile): string => {
  try {
    return `${entry.argumentIndex}:${entry.argument}:${entry.resolvedPath}:${fileStatKey(entry.resolvedPath)}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Configured MCP stdio argument file disappeared after it was approved: ${entry.resolvedPath}`);
    }
    throw error;
  }
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
  schemaVersion: 2;
  server: string;
  kind: "stdio" | "http";
  endpoint?: string;
  executable?: string;
  executableDigest?: string;
  executableDevice?: string;
  executableFile?: string;
  cwd?: string;
  arguments?: string[];
  argumentFiles?: McpTransportArgumentFile[];
  configuredEnvironmentDigest?: string;
  processEnvironmentDigest: string;
  configDigest: string | null;
  digest: string;
};
type McpTransportArgumentFile = {
  argumentIndex: number;
  argument: string;
  resolvedPath: string;
  digest: string;
  device: string;
  file: string;
};
type ResolvedStdioArgumentFile = Pick<McpTransportArgumentFile, "argumentIndex" | "argument" | "resolvedPath">;

const resolveStdioArgumentFiles = (arguments_: readonly string[], cwd: string): ResolvedStdioArgumentFile[] => {
  if (arguments_.length > MAX_MCP_STDIO_ARGUMENTS) {
    throw new Error(`Configured MCP stdio arguments exceed ${MAX_MCP_STDIO_ARGUMENTS} entries`);
  }
  const files: ResolvedStdioArgumentFile[] = [];
  let totalBytes = 0;
  for (const [argumentIndex, argument] of arguments_.entries()) {
    if (!argument || argument.includes("\0")) continue;
    const candidate = path.isAbsolute(argument) ? argument : path.resolve(cwd, argument);
    try {
      const resolvedPath = fs.realpathSync(candidate);
      const stats = fs.statSync(resolvedPath);
      if (!stats.isFile()) continue;
      if (stats.size > MAX_MCP_ARGUMENT_FILE_BYTES) {
        throw new Error(`Configured MCP stdio argument file exceeds ${MAX_MCP_ARGUMENT_FILE_BYTES} bytes`);
      }
      if (files.length >= MAX_MCP_ARGUMENT_FILES) {
        throw new Error(`Configured MCP stdio arguments exceed ${MAX_MCP_ARGUMENT_FILES} file inputs`);
      }
      totalBytes += stats.size;
      if (totalBytes > MAX_MCP_ARGUMENT_FILES_TOTAL_BYTES) {
        throw new Error(`Configured MCP stdio argument files exceed ${MAX_MCP_ARGUMENT_FILES_TOTAL_BYTES} bytes total`);
      }
      files.push({ argumentIndex, argument, resolvedPath });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Configured MCP stdio")) throw error;
      // Options, inline source, module names, and output paths commonly are
      // not existing files. Their literal values remain digest-bound through
      // `arguments`; only existing regular-file inputs receive byte binding.
    }
  }
  return files;
};
const executeApproval = (
  name: "$stdio" | "$oauth",
  description: string,
): ResolvedFabricAction => {
  const descriptor = {
    name,
    ref: `mcp.${name}`,
    provider: "mcp",
    description,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    risk: "execute" as const,
    namespace: "management",
    effect: { kind: "emission" as const },
  };
  return {
    ...descriptor,
    descriptorDigest: semanticDigest("kiro-fabric-action-descriptor-v1", descriptor),
  };
};
const STDIO_APPROVAL = executeApproval("$stdio", "Start one explicitly configured stdio MCP server");
const OAUTH_APPROVAL = executeApproval("$oauth", "Launch configured HTTP MCP authorization");

const abortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new Error(typeof signal.reason === "string" && signal.reason
      ? signal.reason
      : "MCP call cancelled");

type NormalizedServerTool = Omit<ServerToolInfo, "inputSchema"> & {
  inputSchema: Record<string, unknown>;
  annotations?: FabricToolAnnotations;
};
const MCP_ANNOTATION_KEYS = new Set([
  "title", "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint",
]);
const normalizeToolAnnotations = (value: unknown, index: number): FabricToolAnnotations | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).some((key) => !MCP_ANNOTATION_KEYS.has(key)) ||
      (value.title !== undefined && (typeof value.title !== "string" || value.title.length > 1_000)) ||
      ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]
        .some((key) => value[key] !== undefined && typeof value[key] !== "boolean")) {
    throw new Error(`Configured MCP tool annotations at index ${index} are malformed`);
  }
  return {
    ...(value.title === undefined ? {} : { title: value.title as string }),
    ...(value.readOnlyHint === undefined ? {} : { readOnlyHint: value.readOnlyHint as boolean }),
    ...(value.destructiveHint === undefined ? {} : { destructiveHint: value.destructiveHint as boolean }),
    ...(value.idempotentHint === undefined ? {} : { idempotentHint: value.idempotentHint as boolean }),
    ...(value.openWorldHint === undefined ? {} : { openWorldHint: value.openWorldHint as boolean }),
  };
};
const normalizeServerTools = (value: unknown): NormalizedServerTool[] => {
  if (!Array.isArray(value) || value.length > 1_000) throw new Error("Configured MCP tool list is malformed or exceeds product bounds");
  const tools: NormalizedServerTool[] = value.map((tool, index) => {
    if (!isRecord(tool) || typeof tool.name !== "string" || !tool.name || tool.name.length > 256 ||
        (tool.description !== undefined && typeof tool.description !== "string") ||
        !isRecord(tool.inputSchema) ||
        (tool.outputSchema !== undefined && !isRecord(tool.outputSchema))) {
      throw new Error(`Configured MCP tool at index ${index} is malformed`);
    }
    const annotations = normalizeToolAnnotations((tool as { annotations?: unknown }).annotations, index);
    return {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
      ...(annotations === undefined ? {} : { annotations }),
    };
  });
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`Configured MCP tool list contains a duplicate name: ${tool.name}`);
    names.add(tool.name);
  }
  assertFabricJsonBudget(tools);
  return tools;
};

const projectRemoteTool = (server: string, tool: NormalizedServerTool, transport: McpTransportSnapshot) => {
  const descriptor = {
    server,
    name: tool.name,
    ref: `${server}.${tool.name}`,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
    transport: {
      kind: transport.kind,
      digest: transport.digest,
      configDigest: transport.configDigest,
    },
  };
  return {
    ...descriptor,
    descriptorDigest: semanticDigest("kiro-fabric-remote-mcp-descriptor-v1", descriptor),
    stale: false as const,
  };
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
  readonly #argumentFileBindings = new Map<string, ResolvedStdioArgumentFile[]>();
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
        const staged = stageExplicitMcpConfiguration(configPath, explicit);
        try {
          // Parse only the verified byte snapshot. Loading the live pathname
          // would allow a transient A→B→A replacement to supply definitions
          // that are not represented by the approved configuration digest.
          servers = await loadServerDefinitions({ rootDir: this.#cwd, configPath: staged.path });
          const stagedAfterLoad = readExplicitMcpConfiguration(staged.path);
          if (!sameFileIdentity(staged.stats, stagedAfterLoad.stats) || stagedAfterLoad.digest !== staged.digest) {
            throw new Error("staged MCP configuration changed while loading");
          }
          for (const server of servers) {
            const sources = server.sources ?? (server.source ? [server.source] : []);
            if (!explicit.names.has(server.name) || sources.length === 0 || sources.some((source) =>
              source.kind !== "local" || path.resolve(source.path) !== staged.path)) {
              throw new Error("mcporter loaded a server outside the explicit Fabric configuration snapshot");
            }
          }
        } finally {
          removeStagedMcpConfiguration(staged);
        }
        const verified = readExplicitMcpConfiguration(configPath);
        if (verified.digest !== explicit.digest) throw new Error("MCP configuration changed while loading");
        if (servers.length !== explicit.names.size) throw new Error("mcporter did not load the exact Fabric server set");
        // Bind execution to the executable and cwd that were resolved from the
        // private configuration. mcporter otherwise resolves the original
        // command again when it creates a transport, allowing a PATH entry or
        // command symlink to be retargeted after approval.
        servers = servers.map(canonicalizeStdioTransport);
        this.#loadedConfigDigest = explicit.digest;
      }
      return createRuntime({ rootDir: this.#cwd, servers, clientInfo: { name: "kiro-fabric", version: "1" } });
    });
  }

  async list(): Promise<FabricActionDescriptor[]> { return [...descriptors]; }

  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    return descriptors.find((entry) => entry.name === actionName);
  }

  async prepareArguments(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<Record<string, unknown>> {
    if (actionName !== "$call" && actionName !== "$tools" && actionName !== "$describe") return { ...args };
    const server = typeof args.server === "string" ? args.server.trim() : "";
    const tool = typeof args.tool === "string" ? args.tool.trim() : "";
    if (!server || ((actionName === "$call" || actionName === "$describe") && !tool)) {
      throw new Error("MCP call requires non-empty server/tool strings");
    }
    if (actionName === "$call" && args.args !== undefined && !isRecord(args.args)) {
      throw new Error("MCP call args must be an object when provided");
    }
    if (actionName === "$call" && args.expectedDescriptorDigest !== undefined &&
        (typeof args.expectedDescriptorDigest !== "string" ||
          !/^[a-f0-9]{64}$/u.test(args.expectedDescriptorDigest))) {
      throw new Error("MCP expectedDescriptorDigest must be a lowercase SHA-256 digest");
    }
    const runtime = await this.#getRuntime(context.signal);
    throwIfAbortedOrExpired(context.signal, context.deadline);
    this.#assertRuntimeConfigurationCurrent();
    if (!runtime.listServers().includes(server)) throw new Error(`Unknown configured MCP server: ${server}`);
    return {
      server,
      ...(actionName === "$call" || actionName === "$describe" ? { tool } : {}),
      ...(actionName === "$call" ? { args: args.args === undefined ? {} : structuredClone(args.args) } : {}),
      ...(actionName === "$call" && Object.hasOwn(args, "expectedDescriptorDigest")
        ? { expectedDescriptorDigest: args.expectedDescriptorDigest }
        : {}),
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
    if (actionName !== "$call" && actionName !== "$tools" && actionName !== "$describe") {
      throw new Error(`Unknown MCP federation action: ${actionName}`);
    }

    const server = typeof args.server === "string" ? args.server : "";
    const toolName = typeof args.tool === "string" ? args.tool : "";
    const toolArgs = args.args === undefined ? {} : args.args;
    const expectedDescriptorDigest = args.expectedDescriptorDigest;
    if (!server || ((actionName === "$call" || actionName === "$describe") && !toolName) ||
        (actionName === "$call" && (!isRecord(toolArgs) ||
          (expectedDescriptorDigest !== undefined &&
            (typeof expectedDescriptorDigest !== "string" || !/^[a-f0-9]{64}$/u.test(expectedDescriptorDigest)))))) {
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
        this.#listRawTools(runtime, server, actionDeadline, signal),
        signal,
        "tool discovery",
        discoveryBudget,
        lease,
      );
      const tools = normalizeServerTools(rawTools);
      const projected = tools.map((tool) => projectRemoteTool(server, tool, approvedTransport));
      if (actionName === "$tools") return projected;
      const matches = tools.map((tool, index) => ({ tool, projected: projected[index]! }))
        .filter(({ tool }) => tool.name === toolName);
      if (matches.length !== 1) throw new Error(`Unknown or ambiguous MCP tool: ${server}.${toolName}`);
      if (actionName === "$describe") return matches[0]!.projected;
      if (expectedDescriptorDigest !== undefined &&
          matches[0]!.projected.descriptorDigest !== expectedDescriptorDigest) {
        throw new Error(`MCP tool descriptor changed before invocation: ${server}.${toolName}`);
      }
      this.#validateToolArguments(matches[0]!.tool, toolArgs as Record<string, unknown>);

      throwIfAbortedOrExpired(signal, context.deadline);
      this.#assertTransportSnapshot(runtime, server, approvedTransport);
      const callBudget = this.#remainingCallBudget(actionDeadline);
      const result = await this.#bounded(
        runtime,
        server,
        runtime.callTool(server, toolName, {
          args: toolArgs as Record<string, unknown>,
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
    this.#argumentFileBindings.clear();
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
    let argumentFiles: ResolvedStdioArgumentFile[] = [];
    if (definition.command.kind === "stdio") {
      // Re-resolve at every approval/use boundary. The stat-key cache below
      // avoids rehashing unchanged bytes, but never pins a stale symlink/PATH
      // resolution that differs from the command mcporter is about to use.
      executable = executablePath(definition.command.command, definition.command.cwd);
      argumentFiles = this.#boundArgumentFiles(server, definition.command);
    }
    const argumentStatKey = argumentFiles.map(boundArgumentStatKey).join("|");
    const statKey = `${executable ? fileStatKey(executable) : "-"}|${argumentStatKey}|${this.#config.configPath ? fileStatKey(this.#config.configPath) : "-"}`;
    const cached = this.#snapshotCache.get(server);
    if (cached && cached.envDigest === processEnvironmentDigest && cached.statKey === statKey) return cached.snapshot;
    const snapshot = this.#computeTransportSnapshot(runtime, server, processEnvironmentDigest, executable, argumentFiles);
    this.#snapshotCache.set(server, { envDigest: processEnvironmentDigest, statKey, snapshot });
    return snapshot;
  }

  /**
   * The bound argument-file set is frozen the first time a transport snapshot
   * is resolved for a server on this runtime. Stdio servers routinely create
   * files their own command line names (pid, log, or socket targets) once
   * they start, and those appearances must not invalidate the approved
   * transport or shift the approved digest; their literal argument strings
   * remain bound either way. Files that existed at first resolution keep
   * their full stat and byte binding for the lifetime of this runtime.
   */
  #boundArgumentFiles(server: string, command: Extract<ServerDefinition["command"], { kind: "stdio" }>): ResolvedStdioArgumentFile[] {
    const bound = this.#argumentFileBindings.get(server);
    if (bound !== undefined) return bound;
    const resolved = resolveStdioArgumentFiles(command.args ?? [], fs.realpathSync(command.cwd ?? this.#cwd));
    this.#argumentFileBindings.set(server, resolved);
    return resolved;
  }

  #assertRuntimeConfigurationCurrent(): void {
    if (this.#loadedConfigDigest === undefined) return;
    if (configDigest(this.#config.configPath) !== this.#loadedConfigDigest) {
      throw new Error("MCP configuration changed after runtime loading; restart before calling a server");
    }
  }

  #computeTransportSnapshot(
    runtime: Runtime,
    server: string,
    processEnvironmentDigest: string,
    resolvedExecutable: string | undefined,
    resolvedArgumentFiles: ResolvedStdioArgumentFile[],
  ): McpTransportSnapshot {
    this.#assertRuntimeConfigurationCurrent();
    const definition = runtime.getDefinition(server);
    const base = {
      schemaVersion: 2 as const,
      server,
      processEnvironmentDigest,
      configDigest: configDigest(this.#config.configPath),
    };
    const details = definition.command.kind === "stdio"
      ? (() => {
          const executable = resolvedExecutable ?? executablePath(definition.command.command, definition.command.cwd);
          const stats = fs.statSync(executable, { bigint: true });
          const configured = definition.env ?? {};
          const arguments_ = [...(definition.command.args ?? [])];
          // The caller owns the bound set: never re-resolve existence here, or
          // a file the approved server itself created would shift the digest.
          const argumentFiles = resolvedArgumentFiles.map((entry): McpTransportArgumentFile => {
              const argumentStats = fs.statSync(entry.resolvedPath, { bigint: true });
              return {
                ...entry,
                digest: fileDigest(entry.resolvedPath, MAX_MCP_ARGUMENT_FILE_BYTES),
                device: String(argumentStats.dev),
                file: String(argumentStats.ino),
              };
            });
          return {
            kind: "stdio" as const,
            executable,
            executableDigest: fileDigest(executable),
            executableDevice: String(stats.dev),
            executableFile: String(stats.ino),
            cwd: fs.realpathSync(definition.command.cwd ?? this.#cwd),
            arguments: arguments_,
            argumentFiles,
            configuredEnvironmentDigest: createHash("sha256").update(JSON.stringify(Object.entries(configured).sort(([left], [right]) => left.localeCompare(right)))).digest("hex"),
          };
        })()
      : { kind: "http" as const, endpoint: definition.command.url.href };
    const unsigned = { ...base, ...details };
    return { ...unsigned, digest: createHash("sha256").update("kiro-fabric-mcp-transport-v2\0").update(JSON.stringify(unsigned)).digest("hex") };
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

  async #listRawTools(runtime: Runtime, server: string, deadline: number, signal?: AbortSignal): Promise<unknown> {
    try {
      throwIfAbortedOrExpired(signal);
      this.#remainingCallBudget(deadline);
      const connection = await runtime.connect(server, {
        disableOAuth: this.#config.disableOAuth,
        oauthTimeoutMs: this.#remainingCallBudget(deadline),
      });
      const tools: unknown[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; ; page += 1) {
        throwIfAbortedOrExpired(signal);
        this.#remainingCallBudget(deadline);
        if (page >= MAX_MCP_DISCOVERY_PAGES) throw new Error("Configured MCP discovery page limit exceeded");
        const remaining = this.#remainingCallBudget(deadline);
        const response = await connection.client.listTools(cursor === undefined ? undefined : { cursor }, {
          timeout: remaining,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: remaining,
          ...(signal ? { signal } : {}),
        });
        throwIfAbortedOrExpired(signal);
        this.#remainingCallBudget(deadline);
        if (!Array.isArray(response.tools) || tools.length + response.tools.length > MAX_MCP_DISCOVERY_TOOLS) {
          throw new Error("Configured MCP tool list is malformed or exceeds product bounds");
        }
        tools.push(...response.tools);
        assertFabricJsonBudget(tools);
        if (response.nextCursor === undefined) break;
        if (typeof response.nextCursor !== "string" || response.nextCursor.length > MAX_MCP_CURSOR_CHARS) {
          throw new Error("Configured MCP discovery cursor is malformed or exceeds product bounds");
        }
        if (cursors.has(response.nextCursor)) throw new Error("Configured MCP discovery cursor cycle");
        cursors.add(response.nextCursor);
        cursor = response.nextCursor;
      }
      const definition = runtime.getDefinition(server);
      return tools.filter((tool) => {
        if (!isRecord(tool) || typeof tool.name !== "string") return true;
        if (definition.allowedTools !== undefined) return definition.allowedTools.includes(tool.name);
        if (definition.blockedTools !== undefined) return !definition.blockedTools.includes(tool.name);
        return true;
      });
    } catch (error) {
      // Match mcporter's public listTools recovery behavior: a failed raw MCP
      // listing invalidates the cached connection before a later retry.
      try { await runtime.close(server); } catch { /* retain the discovery error */ }
      throw error;
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
