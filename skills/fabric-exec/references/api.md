# Checked guest API

## Top-level `fabric_exec` input

- `code: string` — required TypeScript function body; 1 to the enforced source limit
- `payloads?: Record<string, string>` — named immutable string inputs
- `resultFormat?: "auto" | "json" | "text"`
- `timeoutMs?: number` — invocation request bounded by Power policy

No extra input fields are accepted. Type errors stop execution before QuickJS or any provider call.

## Globals

```ts
payloads: Readonly<Record<string, string>>
print(...values: unknown[]): void

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

state.get(args: { key: string }): Promise<JsonValue>
state.set(args: { key: string; value: JsonValue; expectedRevision?: number }): Promise<JsonValue>
state.list(args?: { limit?: number }): Promise<JsonValue>
state.delete(args: { key: string; expectedRevision?: number }): Promise<JsonValue>

mcp.servers(args?: Record<string, never>): Promise<JsonValue>
mcp.call(args: { server: string; tool: string; args?: JsonObject }): Promise<JsonValue>
```

`FabricActionSummary.ref` is the exact `provider.action` reference. `tools.call` validates the exact descriptor schema before approval and invocation. `mcp.call` validates the exact advertised remote schema when available.

All values crossing the bridge must fit the JSON budgets. Cycles, proxies, unsupported values, over-depth objects, over-budget logs/results, and malformed provider output fail closed. `print` output is returned in a bounded `Fabric logs` sideband after the formatted value. Conservative payload decoding similarly adds an explicit normalization-diagnostics sideband. Cancellation and the effective request deadline propagate through nested calls.

QuickJS intentionally has no host imports, dynamic import, built-in modules, process object, environment variables, timers, filesystem, shell, or unrestricted network.
