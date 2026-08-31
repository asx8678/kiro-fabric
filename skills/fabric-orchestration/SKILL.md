---
name: fabric-orchestration
description: Use Fabric for checked programmable aggregation, workflow logic, Fabric memory/state, or configured MCP federation in Kiro.
---

# Kiro Fabric orchestration

Use Kiro native tools for ordinary file reads, edits, shell commands, code
intelligence, web operations, and native subagents. Do not invoke Fabric for one
simple read, grep, edit, shell command, or subagent call.

Use `fabric_exec` when independent configured-provider calls need checked
fan-out and aggregation, or when a workflow needs branches, loops, Fabric
memory/state, or configured Fabric MCP federation. Fabric cannot call backward
into the outer Kiro session's native tools. The current Power release does not
mount `agents.*`; run subagents with Kiro's native interface outside Fabric.

Call `fabric_info` and check workspace status before any workspace-dependent
capability. Discover providers and action contracts rather than guessing.
Missing workspace or approval capability means omit that operation; never work
around a denial.

```ts
const requests = [
  { server: "docs", tool: "search", args: { query: "token validation" } },
  { server: "issues", tool: "search", args: { query: "token validation" } },
];
const results = await Promise.all(requests.map(async (request) => {
  try {
    return { request, ok: true, value: await mcp.call(request) };
  } catch (error) {
    return { request, ok: false, error: String(error) };
  }
}));
return results;
```

Use `await mcp.servers()` first and replace the example server/tool names with
configured contracts. For a native file read or native subagent, stay outside
Fabric.

Power v1 work is session-bounded. Do not create detached or durable work and do
not claim execution survives Power deactivation. See `references/patterns.md`
and `references/safety.md` for advanced guidance.
