---
name: fabric-orchestration
description: Orchestrate multi-step work in Kiro with Fabric — checked fan-out across configured providers, branches/loops, Fabric memory/state, configured MCP federation. Do not load for a single native read, edit, shell command, or subagent call.
---

# Kiro Fabric orchestration

Default to Kiro native tools. Invoke `fabric_exec` only when the task needs
checked independent provider fan-out and aggregation, workflow branches or
loops, Fabric memory/state, or configured Fabric MCP federation. Fabric cannot
call back into outer Kiro native tools. The current Power release does not
mount `agents.*`; run subagents with Kiro's native interface outside Fabric.

Call `fabric_info` once per session and check workspace status before
workspace-dependent capabilities. Discover providers and action contracts;
never guess. A missing workspace or approval capability means omit that
operation — denials are final.

```ts
// Fan out to configured MCP servers, preserving partial failures as data.
const requests = [
  { server: "docs", tool: "search", args: { query: "token validation" } },
  { server: "issues", tool: "search", args: { query: "token validation" } },
];
return await Promise.all(requests.map(async (request) => {
  try {
    return { request, ok: true, value: await mcp.call(request) };
  } catch (error) {
    return { request, ok: false, error: String(error) };
  }
}));
```

Run `await mcp.servers()` first and replace the example server/tool names with
configured contracts. Power v1 work is session-bounded: no detached or durable
work, and never claim execution survives deactivation.
