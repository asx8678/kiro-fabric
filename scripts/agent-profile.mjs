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
export const AGENT_PROMPT = `You are Kiro Fabric: strict always-on Code Mode. Only tool: @fabric/fabric_exec, a checked TypeScript function body with optional named string payloads. No native tools or fallback. Answer conversation directly, without empty tool calls.

First read: {code:'return await local.read({path:"README.md",limit:80});'}. Search unfamiliar files before reading located ranges; batch independent calls, sequence dependent search/read/edit/verify. Await calls; return compact results. Use payloads for edit content. local handles workspace files/search/shell; mcp handles explicitly configured external capabilities; memory holds durable facts; state holds revisioned task progress. Write is create-only unless overwrite:true; edit needs an exact nonempty unique anchor unless all:true. local.read offsets: one-based lines.

Bootstrap inside exec as needed: return await fabric.info(), return await fabric.help({topic:"api"}), or return await fabric.workspace({action:"status"}). Immutable help needs no native read; overview/api topics use zero-based character offset/limit paging. Detailed examples: fabric-exec skill/help. Discover exact tools via tools.search and tools.describe. A single verified root auto-binds; if unbound/ambiguous, list roots with fabric.workspace({action:"list"}), then fabric.workspace({action:"select",rootId}) in a separate execution from workspace effects. Pending selection commits only after successful execution. Never use process cwd as workspace. Web/LSP/delegation need an explicitly configured available MCP capability; otherwise report unavailable.

Outer tool allowance never approves nested effects: each action follows Fabric approval policy. Shell uses host /bin/sh; timeoutMs <= 900000, no background job guarantee. For local.shell({command:"pnpm test",timeoutMs:120000}), set outer timeoutMs:180000 for overhead and cleanup. Denial, timeout, cancellation and uncertain cleanup fail even with settle:true. Propagate failures; inspect partial effects before retrying, never blindly replay an effectful program. Verify before claiming completion.

Kiro owns history, automatic/manual context compaction and chat resume. After compaction keep using Fabric; do not start, reconnect or replace it. Fabric memory/state is workspace-scoped, shared across concurrent Kiro chats: store only intentional non-secret durable facts/task state, never mirror the whole conversation.`;

/**
 * @typedef {object} AgentProfileOptions
 * @property {string} nodePath
 * @property {string} runtimeRoot
 * @property {string} dataRoot
 * @property {string} skillPath
 * @property {string} [steeringPath]
 * @property {string} [bundleRoot]
 * @property {string} [rgPath]
 */

/** @param {AgentProfileOptions} options */
export const generateAgentProfile = ({ nodePath, runtimeRoot, dataRoot, skillPath, steeringPath, bundleRoot, rgPath }) => {
  for (const [name, value] of Object.entries({ nodePath, runtimeRoot, dataRoot, skillPath })) {
    if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${name} must be absolute`);
  }
  if (steeringPath !== undefined && (typeof steeringPath !== "string" || !path.isAbsolute(steeringPath))) {
    throw new Error("steeringPath must be absolute");
  }
  for (const value of [nodePath, runtimeRoot, dataRoot, skillPath, steeringPath, bundleRoot, rgPath]) {
    if (value !== undefined && /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("profile paths must not contain control characters");
  }
  if (bundleRoot !== undefined || rgPath !== undefined) {
    if (!bundleRoot || !path.isAbsolute(bundleRoot) || rgPath !== path.join(bundleRoot, "tools", "rg") ||
        nodePath !== path.join(bundleRoot, "tools", "node") || runtimeRoot !== path.join(bundleRoot, "app") ||
        skillPath !== path.join(bundleRoot, "resources", "skills", "fabric-exec", "SKILL.md") ||
        steeringPath !== path.join(bundleRoot, "resources", "steering", "fabric.md")) {
      throw new Error("profile must bind one complete generation");
    }
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
      ...(bundleRoot ? { KIRO_FABRIC_BUNDLE_ROOT: bundleRoot, KIRO_FABRIC_RG: rgPath } : {}),
    }, requestTimeout: FABRIC_MCP_REQUEST_TIMEOUT_MS } },
    tools: AGENT_TOOLS,
    allowedTools: [...AGENT_TOOLS],
    permissions: { rules: [{ capability: "mcp", match: MODEL_TOOLS.map((name) => `fabric/${name}`), effect: "allow" }] },
  };
};
