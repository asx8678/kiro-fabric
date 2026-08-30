# Managed Kiro MCP reference

The managed Kiro adapter exposes a deliberately small, lazy MCP facade. Server
processes are not contacted during type checking or provider discovery.

- `mcp.servers()` returns configured server metadata as
  `{name, description, transport}[]`.
- `mcp.call({server, tool, args?})` calls one exact server/tool pair and returns
  the server-defined value.

```ts
const servers = await mcp.servers();
if (!servers.some((server) => server.name === "project-docs")) {
  return { available: false, servers };
}
return mcp.call({
  server: "project-docs",
  tool: "search",
  args: { query: π.query },
});
```

Pass the query as `strings.query`. MCP server and tool names are exact strings;
managed Kiro does not expose dynamic `mcp.server.tool` proxies, registration,
reload, or OAuth prompts. Use `tools.describe({ref:"mcp.call"})` if the facade
contract is uncertain. Calls remain subject to configured network/execute
approval and timeouts. Kiro v3 can support MCP elicitation, but the managed Fabric
adapter intentionally does not delegate nested policy decisions to it.
