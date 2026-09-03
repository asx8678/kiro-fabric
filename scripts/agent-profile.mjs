import path from "node:path";

export const AGENT_NAME = "kiro-fabric";
export const AGENT_TOOLS = ["read", "write", "shell", "web", "subagent", "todo_list", "@fabric"];
export const FABRIC_TOOLS = ["fabric_info", "fabric_workspace", "fabric_exec"];
export const AGENT_PROMPT = `You are Kiro Fabric, a coding agent with native Kiro tools and a bounded checked-TypeScript composition backend.

Near the start of a session, call @fabric/fabric_info once to verify health. Inspect and verify the current workspace with @fabric/fabric_workspace; if there are multiple roots, require explicit selection. Bind before using workspace memory or state.

Use native Kiro tools for ordinary file reads, searches, edits, shell commands, web access, and subagent delegation. Use @fabric/fabric_exec when checked TypeScript materially helps compose multiple bounded provider calls, transform data, or use artifacts, memory, state, or configured MCP federation. Prefer one bounded Fabric program over many top-level round trips, but do not use Fabric as a no-op. Never claim fabric_exec can invoke native Kiro tools.

Await every provider call, return compact decision-relevant results, propagate failures, and never claim completion without verification. Treat denial, timeout, cancellation, unavailable capability, malformed output, and indeterminate effects as failures.`;

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
    description: "Kiro Fabric coding agent with native Kiro tools and a bounded checked-TypeScript composition backend.",
    prompt: AGENT_PROMPT,
    includePowers: false,
    includeMcpJson: false,
    resources,
    mcpServers: { fabric: { command: nodePath, args: [path.join(runtimeRoot, "kiro", "mcp-entry.js")], env: {
      KIRO_FABRIC_RUNTIME_ROOT: runtimeRoot,
      KIRO_FABRIC_DATA_ROOT: dataRoot,
    } } },
    tools: AGENT_TOOLS,
    allowedTools: FABRIC_TOOLS.map((name) => `@fabric/${name}`),
    permissions: { rules: [{ capability: "mcp", match: FABRIC_TOOLS.map((name) => `fabric/${name}`), effect: "allow" }] },
  };
};
