---
name: fabric-exec
description: >-
  Use when Fabric has already been selected and an exact checked-TypeScript
  fabric_exec body must be written, debugged, or repaired after a type or
  argument-shape error. Do not use to decide whether Fabric is appropriate or
  for an ordinary single native operation.
---

# fabric_exec in Kiro Fabric Power

Each call runs a type-checked TypeScript function body in QuickJS. Top-level
`await` and `return` are supported; only the returned value reaches Kiro.
Named strings are available as `π.key`.

Use Kiro native tools for ordinary reads, edits, shell, web, and subagents —
never Fabric for a single native operation. Power mode mounts no `k.*` and no
`agents.*`; neither can be probed, cast, or worked around.

## Workflow

1. Call `fabric_info` once per session for live executor limits and mounted
   capabilities. Bind a workspace with `fabric_workspace` before
   workspace-dependent actions.
2. Call an action directly when its contract is already known. Otherwise use
   `tools.search()` once, then `tools.describe({ ref })` for the selected
   action. Use `tools.providers()` only when provider availability itself is
   unknown. Never guess action contracts; mounted namespaces are
   capability-sensitive.
3. On truncated output, page with the returned opaque ID:
   `await tools.call({ ref: "artifacts.read", args: { id } })`. Artifacts are
   process-local.

Approval, timeout, cancellation, and unavailable-capability errors fail
closed: omit the operation, never retry around a denial. Power v1 work is
synchronous and session-bounded; nothing survives deactivation.

MCP tools may be client-namespaced; do not assume a fixed server prefix. Read
only the reference needed for the current request:

- Exact call contract: `references/api.md`.
- Agent boundary: `references/agents.md`.
- Configured MCP federation: `references/mcp.md`.
- MCP startup failure: `references/troubleshooting.md`.
