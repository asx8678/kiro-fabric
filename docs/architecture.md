# Architecture

`kiro-fabric` is a Kiro custom agent. Its profile owns native Kiro tools and one stdio `mcpServers.fabric` process. The server exposes exactly three tools: `fabric_info`, `fabric_workspace`, and `fabric_exec`. Checked TypeScript flows through the isolated compiler worker into QuickJS and the ActionRegistry-backed artifacts, memory, state, and configured MCP providers.

Kiro owns ordinary file, write, shell, web, todo, and subagent behavior. Fabric cannot call those native tools. Fabric approvals are an independent inner boundary and fail closed when roots, identity, form elicitation, cancellation, schemas, or effects are indeterminate. Runtime and writable data roots are explicit absolute `KIRO_FABRIC_RUNTIME_ROOT` and `KIRO_FABRIC_DATA_ROOT` values and must be distinct and non-containing.

The reachability baseline is `docs/architecture/agent-reachability-baseline.json`. Private source names and storage salts containing “power” remain compatibility details only; they do not define a second product.
