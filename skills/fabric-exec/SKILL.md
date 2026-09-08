---
name: fabric-exec
description: Strict always-on Code Mode for local coding, bounded provider composition, durable memory/state, artifacts and explicitly configured MCP federation. No native tool fallback.
license: MIT
compatibility: Kiro CLI v3 with the Kiro Fabric Agent enabled
---

# Fabric execution

Use the sole model tool `@fabric/fabric_exec` for every tool operation. Answer conversation directly without dummy calls. For a first read: `return await local.read({path:"README.md",limit:80});`. For immutable bundled instructions: `return await fabric.help({topic:"api"});` — no native file read is required. It accepts only a TypeScript function body, strictly checks the documented API, and runs it in QuickJS. There is no text, action-name, manual-command, or legacy execution fallback. QuickJS has no operating-system, filesystem, shell, environment, import, timer, or direct-network API.

Search before reading unfamiliar files; read only located ranges. Batch independent work, but keep dependent search/read/edit/test steps sequential. `local` handles workspace files/search/shell; `mcp` handles configured external capabilities; `memory` holds intentional durable facts; `state` holds revisioned task progress. Read offsets are one-based lines; help accepts `{topic:"overview"|"api",offset?,limit?}` with zero-based character paging. Shell timeoutMs is at most 900000; there is no background job guarantee. Provider-generated `review` contains canonical approval material, not a caller-supplied authorization.

Prefer one bounded program that composes the required provider calls instead of many top-level round trips. Use `payloads` for named string input:

```ts
const request = JSON.parse(payloads.request);
return { id: request.id, normalized: String(request.value).trim() };
```

Provider composition uses exact references. `fabric.info()` returns an `actions` array plus `catalog` completeness metadata for the bound workspace. When `catalog.complete` or `catalog.digestComplete` is false, recover targeted live descriptors with `tools.search` and `tools.describe`; describe downstream MCP tools again before calling because their freshness is transport-specific:

```ts
return await memory.get({ key: "release" });
```

Within one Code Mode execution, `local.shell`, `local.write`, and `local.edit` are queued FIFO in host-call arrival order, including calls through `tools.call`. Even `cat`/`find` shell commands are treated as potential writes; no command-text safety guessing occurs. Their preparation, approval, execution and cleanup complete before the next local effect starts. A failed predecessor stops the remaining local effects in that execution, even when caught. `settle:true` permits continuation only for ordinary nonzero shell exits. Cancellation/deadline never starts queued effects. Other executions/processes still fail fast on conflicting workspace locks.

Prefer `local.read`, `local.list`, `local.find`, and `local.grep` for parallel inspection. Reads/searches are not queued; explicitly await a write before a read that depends on it. Queue wait consumes the outer execution deadline and existing provider-call/concurrency budgets. Shell timeout applies when that command runs; allow outer timeout headroom for the entire batch.

Use the bounded helper for independent calls instead of an unbounded `Promise.all`:

```ts
const keys = ["release", "owner", "status"];
return await parallel(keys, async (key) => memory.get({ key }));
```

Inspect a configured downstream MCP server before calling it. Discovery itself is approval-gated and returns a live descriptor bound to the current transport/configuration digest:

```ts
const descriptor = await mcp.describe({ server: "reports", tool: "summarize" });
return await mcp.call({
  server: "reports",
  tool: "summarize",
  args: { report: payloads.report },
  expectedDescriptorDigest: descriptor.descriptorDigest,
});
```

The mounted namespaces are `local`, `fabric`, `artifacts`, `memory`, `state`, and `mcp`. Bootstrap when needed through `fabric.info()` and `fabric.workspace({action:"status"})` inside exec, not top-level compatibility tools. Workspace-scoped providers require a verified binding. Select an ambiguous root in a separate execution with `fabric.workspace({action:"select",rootId})`; do not mix selection and workspace effects. Web/LSP/delegation are unavailable unless explicitly configured through MCP. Write, execute, and network calls follow Fabric approval policy and fail closed when required elicitation is unavailable; batching work into one program does not merge approvals — each write/network action elicits separately. Cancellation and the effective deadline propagate through nested calls.

Nested call arguments and results do not enter context automatically. The returned value plus bounded diagnostics, guest logs, and failure progress re-enter context. Returned output is capped (`executor.maxOutputChars`, 50,000 chars by default) and spills to an artifact reference when exceeded, so filter, aggregate, and slice inside the program and return only the data the task needs.

Use `fabric.help({topic:"api"})` for the bundled [API reference](references/api.md). Local shell is an approved host capability, not ambient QuickJS access. Request outer `timeoutMs:180000` when using `local.shell({command:"pnpm test",timeoutMs:120000})`, leaving cleanup time. Never retry a whole effectful program automatically.
