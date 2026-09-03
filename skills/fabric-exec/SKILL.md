---
name: fabric-exec
description: Use when checked TypeScript must compose bounded Fabric providers, perform non-trivial bounded data transformation, or access artifacts, memory, workspace state, or configured MCP federation. Do not use it to reimplement ordinary file, edit, shell, web, or subagent work owned by Kiro native tools.
license: MIT
compatibility: Kiro CLI v3 with the Kiro Fabric Agent enabled
---

# Fabric execution

Use `fabric_exec` whenever work is intentionally routed through Fabric. It accepts only a TypeScript function body, strictly checks the documented API, and runs it in QuickJS. There is no text, action-name, manual-command, or legacy execution fallback. QuickJS has no operating-system, filesystem, shell, environment, import, timer, or direct-network API.

Prefer one bounded program that composes the required provider calls instead of many top-level round trips. Use `payloads` for named string input:

```ts
const request = JSON.parse(payloads.request);
return { id: request.id, normalized: String(request.value).trim() };
```

Provider composition uses exact references:

```ts
const actions = await tools.list();
const result = await tools.call({ ref: "memory.get", args: { key: "release" } });
return { actions: actions.length, result };
```

The mounted namespaces are `artifacts`, `memory`, `state`, and `mcp`. Workspace-scoped providers remain unavailable until `fabric_workspace` has a verified binding. Write, execute, and network calls follow Fabric approval policy and fail closed when required elicitation is unavailable; batching work into one program does not merge approvals — each write/network action elicits separately. Cancellation and the effective deadline propagate through nested calls.

Only the returned value re-enters context. Returned output is capped (`executor.maxOutputChars`, 50,000 chars by default) and spills to an artifact reference when exceeded, so filter, aggregate, and slice inside the program and return only the data the task needs.

See [references/api.md](references/api.md) for the complete guest surface.
