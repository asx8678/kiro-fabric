import path from "node:path";

export const AGENT_NAME = "kiro-fabric";
export const MODEL_TOOLS = ["fabric_exec"];
export const AGENT_TOOLS = MODEL_TOOLS.map((name) => `@fabric/${name}`);
export const FABRIC_TOOLS = ["fabric_info", "fabric_workspace", "fabric_exec"];
// Raw compatibility endpoints above are not the model tool inventory.
export const NATIVE_AUTO_APPROVED_TOOLS = [];
// Keep this bound to the runtime deadline formula in tests: the maximum guest
// deadline, plus compiler time, plus the outer MCP cancellation grace period,
// then a positive client-response margin so Fabric's own deadline wins first.
export const FABRIC_MAX_GUEST_TIMEOUT_MS = 900_000;
export const FABRIC_MCP_INTERNAL_DEADLINE_MS = FABRIC_MAX_GUEST_TIMEOUT_MS + 10_000 + 2_000;
export const FABRIC_MCP_CLIENT_RESPONSE_MARGIN_MS = 5_000;
export const FABRIC_MCP_REQUEST_TIMEOUT_MS = FABRIC_MCP_INTERNAL_DEADLINE_MS + FABRIC_MCP_CLIENT_RESPONSE_MARGIN_MS;
export const AGENT_PROMPT = `You are Kiro Fabric, a coding agent using strict always-on Code Mode. The only tool is @fabric/fabric_exec: a checked TypeScript function body with optional named string payloads. No native tools or fallback exist. Answer conversational requests directly; do not make ritual or empty tool calls.

For a first file read, use {code:'return await local.read({path:"README.md",limit:80});'}. Other local calls: local.grep({pattern,path?}), local.find({pattern,path?}), local.list({path?}), local.write({path,content,overwrite?}), local.edit({path,oldText,newText,all?}), local.shell({command,cwd?,timeoutMs?,settle?}). Write is create-only unless overwrite:true; edit requires one exact nonempty anchor unless all:true. Use payloads for edit content. Search before reading unfamiliar files; read only located ranges. Batch independent calls; keep dependent search/read/edit/verify steps sequential. local handles workspace files/search/shell; mcp calls explicitly configured external capabilities; memory stores intentional durable facts; state stores revisioned task progress. Await calls and return compact results. local.read offsets are one-based lines; fabric.help({topic:"overview"|"api",offset?,limit?}) uses zero-based character paging. Shell timeoutMs is at most 900000; no background job guarantee. Shell uses host /bin/sh; for a 120000ms shell request set outer timeoutMs:180000 for overhead and cleanup. Denial, timeout, cancellation and uncertain cleanup fail even with settle:true.

When needed, bootstrap inside exec with return await fabric.info(), return await fabric.help({topic:"api"}), or return await fabric.workspace({action:"status"}). Bundled help is immutable and requires no native read. A verified single root binds automatically; if unbound or ambiguous inspect/list roots and explicitly select with fabric.workspace({action:"select",rootId}). Select in a separate execution from workspace effects; a pending selection commits only after successful execution. Never substitute process cwd. Web, LSP and delegation require an explicitly configured available MCP capability; otherwise report unavailable.

Kiro owns conversation history, automatic and manual context compaction, and chat resume. Continue using Fabric after Kiro compacts; compaction is not a reason to start, reconnect, or replace Fabric. Store only intentional non-secret durable facts or task state; never mirror the whole conversation. Fabric memory/state is workspace-scoped and may be shared by concurrent Kiro chats.

Outer tool allowance never approves nested effects. Discover exact tools with tools.search/describe; each nested action follows Fabric policy. Propagate failures, inspect partial progress before retrying, and never claim completion without verification.`;

/**
 * @typedef {object} AgentProfileOptions
 * @property {string} nodePath
 * @property {string} runtimeRoot
 * @property {string} dataRoot
 * @property {string} skillPath
 * @property {string} [steeringPath]
 */

/** @param {AgentProfileOptions} options */
export const generateAgentProfile = ({ nodePath, runtimeRoot, dataRoot, skillPath, steeringPath }) => {
  for (const [name, value] of Object.entries({ nodePath, runtimeRoot, dataRoot, skillPath })) {
    if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${name} must be absolute`);
  }
  if (steeringPath !== undefined && (typeof steeringPath !== "string" || !path.isAbsolute(steeringPath))) {
    throw new Error("steeringPath must be absolute");
  }
  const resources = [`skill://${skillPath}`];
  if (steeringPath) resources.push(`file://${steeringPath}`);
  return {
    name: AGENT_NAME,
    description: "Kiro Fabric coding agent with strict always-on checked-TypeScript Code Mode.",
    prompt: AGENT_PROMPT,
    includePowers: false,
    includeMcpJson: false,
    resources,
    mcpServers: { fabric: { command: nodePath, args: [path.join(runtimeRoot, "kiro", "mcp-entry.js")], env: {
      KIRO_FABRIC_RUNTIME_ROOT: runtimeRoot,
      KIRO_FABRIC_DATA_ROOT: dataRoot,
      KIRO_FABRIC_EXPECTED_NODE: nodePath,
    }, requestTimeout: FABRIC_MCP_REQUEST_TIMEOUT_MS } },
    tools: AGENT_TOOLS,
    allowedTools: [...AGENT_TOOLS],
    permissions: { rules: [{ capability: "mcp", match: MODEL_TOOLS.map((name) => `fabric/${name}`), effect: "allow" }] },
  };
};
