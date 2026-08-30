---
name: fabric-exec
description: Exact checked-TypeScript reference for Kiro Fabric Power workflows, state, MCP federation, and bounded orchestration.
---

# fabric_exec in Kiro Fabric Power

Each call executes a type-checked TypeScript function body in QuickJS by
default. Top-level `await` and `return` are supported; only the returned value
reaches Kiro. Named strings are available as `π.key`.

Use Kiro native tools outside Fabric for normal reads, edits, shell, web, code
intelligence, and simple native subagents. Power mode intentionally does not
mount `k.*`; never use Fabric as a substitute for one native operation.

Mounted namespaces are capability-sensitive. Use `tools.providers()`,
`tools.search()`, and `tools.describe()` rather than guessing. Call
`fabric_info` first and bind a workspace with `fabric_workspace` before using
workspace-dependent actions. `agents.*` is omitted unless Kiro ACP is qualified.

Power v1 supports synchronous, session-bounded work only. No detached actors or
durability across deactivation is promised. Approval, timeout, cancellation,
and unavailable-capability errors fail closed.

See `references/api.md`, `references/agents.md`, and `references/mcp.md` for
advanced contracts. MCP tools may be client-namespaced; do not assume a fixed
server prefix.
