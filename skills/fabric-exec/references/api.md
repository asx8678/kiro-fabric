# Checked guest API

## Top-level `fabric_exec` input

- `code: string` — required TypeScript function body; 1 to the enforced source limit
- `payloads?: Record<string, string>` — named immutable string inputs
- `resultFormat?: "auto" | "json" | "text"`
- `timeoutMs?: number` — invocation request bounded by Agent policy

No extra input fields are accepted. Type errors stop execution before QuickJS or any provider call.

## Globals

```ts
payloads: Readonly<Record<string, string>>
print(...values: unknown[]): void
parallel(items, mapper, options?): Promise<unknown[]>
parallel(tasks, options?): Promise<unknown[]>

tools.providers(): Promise<Array<{
  name: string; description: string; available: boolean; reason?: string
}>>
tools.list(): Promise<FabricActionSummary[]>
tools.search(input: string | { query: string; limit?: number }): Promise<FabricActionSummary[]>
tools.describe(input: string | { ref: string }): Promise<FabricActionSummary>
tools.call(input: { ref: string; args?: JsonObject }): Promise<JsonValue>

artifacts.read(args: { id: string; offset?: number; limit?: number }): Promise<JsonValue>

memory.get(args: { key: string }): Promise<JsonValue>
memory.set(args: { key: string; value: JsonValue }): Promise<JsonValue>
memory.search(args: { query: string; limit?: number }): Promise<JsonValue>
memory.index(args?: Record<string, never>): Promise<JsonValue>
memory.delete(args: { key: string }): Promise<JsonValue>

state.get(args: { key: string }): Promise<JsonValue>
state.set(args: { key: string; value: JsonValue; expectedRevision?: number }): Promise<JsonValue>
state.list(args?: { limit?: number }): Promise<JsonValue>
state.delete(args: { key: string; expectedRevision?: number }): Promise<JsonValue>

mcp.servers(args?: Record<string, never>): Promise<JsonValue>
mcp.tools(args: { server: string }): Promise<FabricMcpToolSummary[]>
mcp.describe(args: { server: string; tool: string }): Promise<FabricMcpToolSummary>
mcp.call(args: { server: string; tool: string; args?: JsonObject; expectedDescriptorDigest?: string }): Promise<JsonValue>
```

`FabricActionSummary.ref` is the exact `provider.action` reference. Action summaries include the full bounded public descriptor plus `descriptorDigest`; search ranks exact refs/names and token matches across descriptions, providers, namespaces, annotations, and schemas deterministically. `tools.call` validates the exact descriptor schema before approval and invocation. `mcp.tools` and `mcp.describe` contact only one explicitly configured server after network approval (and stdio/OAuth execution approval where applicable), returning bounded descriptors tied to transport/configuration and definition digests. For stdio, that transport digest binds the resolved executable plus every argument that resolved to a regular file when the transport was first bound for that server (path, inode, and content); the bound set is frozen for the runtime, so files an approved server itself creates (pid, log, or socket targets named by its own arguments) never shift the digest, while literal argument strings stay bound. It does not recursively attest a script's imported dependency graph. Standard MCP tool annotations are preserved in the descriptor digest but never grant approval. `mcp.call` rediscovers and validates the exact advertised remote schema at invocation time; pass `expectedDescriptorDigest` from discovery to reject intervening descriptor drift before the tool call.

`parallel` preserves input order and runs at most the requested number of mapper tasks, capped by `executor.maxConcurrentProviderCalls`. All guest-to-host calls share one execution-wide queue at that same cap, including nested `parallel` helpers and direct `Promise.all`, so excess bridge work waits instead of crossing the host concurrency quota.

All values crossing the bridge must fit the JSON budgets. Cycles, proxies, unsupported values, over-depth objects, over-budget logs/results, and malformed provider output fail closed. `print` output is returned in a bounded `Fabric logs` sideband after the formatted value. Cancellation and the effective request deadline propagate through nested calls.

QuickJS intentionally has no host imports, dynamic import, built-in modules, process object, environment variables, timers, filesystem, shell, or unrestricted network.
