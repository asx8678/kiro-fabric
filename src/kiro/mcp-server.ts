import { randomBytes } from "node:crypto";
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadFabricConfig } from "../config.js";
import { fabricExecInputSchemaJson } from "../kernel/fabric-exec-contract.js";
import { FoveaHost, type FoveaBoundClient } from "../fovea/host.js";
import type { FoveaParserDescriptor } from "../fovea/protocol.js";
import { DISABLED_TRACER, createFabricTracer, resolveTraceEnabled, type FabricTracer } from "../trace/tracer.js";
import { FoveaResponseDelivery } from "./fovea-context.js";
import { inspectCanonicalPath } from "./canonical-path.js";
import { KiroPowerApprover, kiroElicitationFailureReason } from "./power/approver.js";
import { prepareKiroPowerDataPaths } from "./power/data-paths.js";
import { kiroWorkspaceToolInputSchema } from "./power/workspace-binding.js";
import type { WorkspaceContextProvider } from "./power/workspace-context.js";
import type { KiroRuntime, KiroRuntimeOptions } from "./runtime.js";
import { buildRunProvenance, parseRunProvenanceDeclaration, type RunProvenanceInput } from "./run-provenance.js";
import { createMcpSession } from "./mcp-session.js";
import { attemptCleanup } from "./mcp-session-lifecycle.js";
import { isRecord, supportsKiroElicitation, toolError } from "./mcp-response.js";

const EXEC_DESCRIPTION = "Kiro Fabric Code Mode: checked TypeScript; await, then return only what you need (strings print as text). Navigator: repo.focus/sketch/impact; repo.focusRead({query}) adds source reads. local.read({path,offset?,limit?})->{text:string,totalLines,truncated,nextOffset?}. local.readMany({windows,maxChars?,partial?})->{files,remaining,complete,unreadTails}; complete=windows only. local.grep({pattern,path?,glob?,literal?,hidden?,limit?}); local.find({pattern,path?,hidden?,limit?}). local.edit({path,expectedSha256,oldText,newText,all?}); local.write overwrite needs expectedSha256 from read. local.shell({command,settle:true})->{ok,exitCode,stdout,stderr,truncated}; scripts: {script,interpreter:'bash',args?}. Availability/APIs: tools.providers(), tools.search, tools.describe. Help: fabric.help. No native fallback.";
const MCP_INSTANCE_ID = `fmcp_${randomBytes(16).toString("hex")}`;
const MCP_STARTED_AT = new Date().toISOString();
const MCP_PARENT_PID = process.ppid;
export { supportsKiroElicitation } from "./mcp-response.js";

export interface KiroMcpServerOptions {
  runtimeRoot: string;
  dataRoot: string;
  kiroHome?: string;
  /** Explicit user-selected project supplied by the installed start launcher; never MCP cwd. */
  launchWorkspaceRoot?: string;
  managedParser?: FoveaParserDescriptor;
  /** Same-call visible Navigator suffix from this invocation's observed files. Not native session routing. */
  foveaCallContext?: true;
  version?: string;
  /** Explicit host metadata: launch JSON may supply configured, never observed. */
  runProvenance?: RunProvenanceInput;
  runtime?: KiroRuntime;
  prepareRuntime?: (options: KiroRuntimeOptions) => KiroRuntime | Promise<KiroRuntime>;
  workspaceContext?: WorkspaceContextProvider;
}
const installedKiroHomeFor = (runtimeRoot: string, dataRoot: string): string | undefined => {
  const runtime = inspectCanonicalPath(runtimeRoot, { kind: "directory", rejectFinalSymlink: true }).canonicalPath;
  const data = inspectCanonicalPath(dataRoot, { kind: "directory", rejectFinalSymlink: true }).canonicalPath;
  const installRoot = path.dirname(data);
  if (path.basename(data) !== "data" || path.basename(installRoot) !== "kiro-fabric") return undefined;
  if (runtime !== path.join(installRoot, "app")) {
    throw new Error("installed Agent data root does not match its app layout");
  }
  return inspectCanonicalPath(path.dirname(installRoot), {
    kind: "directory",
    rejectFinalSymlink: true,
  }).canonicalPath;
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
  const runProvenance = buildRunProvenance({
    configured: options.runProvenance?.configured ?? parseRunProvenanceDeclaration(process.env.KIRO_FABRIC_RUN_DECLARATION) ?? {},
    observed: { ...options.runProvenance?.observed, runtimeVersion: version },
  });
  const server = new Server({ name: "kiro-fabric", version }, { capabilities: { tools: {} } });
  const data = prepareKiroPowerDataPaths(options.dataRoot);
  const tracer = createAgentTracer(data, version);
  // Process owner lives above replaceable workspace runtimes. Construction is
  // idle: no parser child or indexing starts until an authorized analysis query.
  const fovea = new FoveaHost({ dataRoot: data.root, configFile: path.join(data.config, "fovea.v1.json"),
    ...(options.managedParser ? { parser: options.managedParser } : {}),
    entrypoint: path.join(options.runtimeRoot, "fovea", "engine-entry.js") });
  const foveaClients = new WeakMap<KiroRuntime, FoveaBoundClient>();
  const foveaDelivery = new FoveaResponseDelivery();
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
  let serverClosing = false;
  const session = createMcpSession({
    options, server, data, kiroHome, version, runProvenance, tracer, fovea, foveaClients,
    foveaDelivery, fabricApprover, serverClosing: () => serverClosing,
    identity: { id: MCP_INSTANCE_ID, parentPid: MCP_PARENT_PID, startedAt: MCP_STARTED_AT },
  });
  let closeTask: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closeTask) return closeTask;
    serverClosing = true;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    closeTask = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void (async () => {
      const failures: unknown[] = [];
      await attemptCleanup(failures, () => session.close());
      await attemptCleanup(failures, () => foveaDelivery.close());
      await attemptCleanup(failures, () => fovea.close());
      await attemptCleanup(failures, () => server.close());
      await attemptCleanup(failures, () => tracer.close());
      if (failures.length) throw new AggregateError(failures, "MCP server shutdown failed");
    })().then(resolve, reject);
    return closeTask;
  };
  try {
    server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      if (serverClosing) throw new Error("Agent MCP server is shutting down");
      await session.refresh(true);
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (serverClosing) throw new Error("Agent MCP server is shutting down");
      await session.refresh();
      return { tools: [
        { name: "fabric_info", description: "Report bounded Kiro Fabric Agent health and provider status without secrets.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
        { name: "fabric_workspace", description: "Inspect or explicitly bind the canonical workspace used for durable state. Actions: status and list take no other fields; select requires rootId from list; attach requires an absolute path; detach takes no other fields.", inputSchema: kiroWorkspaceToolInputSchema, annotations: { readOnlyHint: false } },
        { name: "fabric_exec", description: EXEC_DESCRIPTION, inputSchema: fabricExecInputSchemaJson(), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
      ] };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      if (serverClosing) return toolError("server_unavailable", "Agent MCP server is shutting down");
      return session.call(request, extra);
    });

    const transport = new StdioServerTransport();
    if (options.foveaCallContext === true) {
      const send = transport.send.bind(transport);
      transport.send = message => foveaDelivery.send(message, send);
    }
    await server.connect(transport);
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "MCP startup and cleanup failed", { cause: error }); }
    throw error;
  }
  return { close };
};
