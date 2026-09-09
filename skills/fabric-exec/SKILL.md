---
name: fabric-exec
description: Strict always-on Code Mode for local coding, bounded provider composition, durable memory/state, artifacts and explicitly configured MCP federation. No native tool fallback.
license: MIT
compatibility: Kiro CLI v3 with the Kiro Fabric Agent enabled
---

# Fabric execution

Use the sole model tool `@fabric/fabric_exec` for every tool operation. User tool/output constraints override workflow advice: if tools are forbidden, use none, including pure computation, formatting, help or verification. Answer general explanations from context without workspace inspection. For workspace work, act directly on known task paths; no ritual listing/help call. For an unknown layout, once bound, first list: `return await local.list({path:".",limit:100});`. For immutable bundled instructions, `fabric.help` exposes fixed topics: `api` (declarations), `skill` (this document), `guide` (API prose), `recipes` and `workflow`. These require no native read, workspace binding or shell; follow `nextOffset` when `truncated` is true. Do not load help ritually when the needed contract is already known. It accepts only a TypeScript function body, strictly checks the documented API, and runs it in QuickJS. There is no text, action-name, manual-command, or legacy execution fallback. QuickJS has no operating-system, filesystem, shell, environment, import, timer, or direct-network API.

`local.list` accepts only `{path?,limit?}` and lists direct children, including hidden entries; there is no `depth` argument. To find nested files, use `local.find({pattern:"README*",path:".",limit:20})` or list an observed child directory. Never assume a root `README.md` exists. Check discovery results and their `truncated` flags, then read selected existing files in the same execution when no model decision is needed; do not batch a speculative read with the listing/search it depends on. If an API's arguments are uncertain, use `tools.describe` rather than inventing options. Search before reading unfamiliar files; read only located ranges. Batch independent work, but keep dependent search/read/edit/test steps sequential. `local` handles workspace files/search/shell; `mcp` handles configured external capabilities; `memory` holds intentional durable facts; `state` holds revisioned task progress. Read offsets are one-based lines; help accepts `{topic:"overview"|"api"|"skill"|"guide"|"recipes"|"workflow",offset?,limit?}` with zero-based UTF-16 character paging. Shell timeoutMs is at most 900000; there is no background job guarantee. Provider-generated `review` contains canonical approval material, not a caller-supplied authorization.

Only when tools are allowed and needed, prefer one bounded program that composes the required provider calls instead of many top-level round trips. Sequence dependent steps with `await` inside that program when intermediate model judgment is unnecessary. Stop/narrow on incomplete discovery; do not infer completeness from a returned prefix. Inspect before deciding source edits, then batch known edits and their verification. Do not skip tests or hide failures to reduce calls.

## Task and output contracts

Code Mode governs routing when a tool is needed, not an obligation to call a tool. Explicit tool bans include pure computations and verification. Read user-provided files before content-dependent claims when a suitable read capability is available; local.read is UTF-8 only, not visual image/PDF inspection. If tools are forbidden or a reader is unavailable, state the blocker without assuming contents.

Choose the requested final format before work. For JSON-only output, emit no visible assistant commentary before or between tool calls: Kiro concatenates that text into finalText, even when the last message alone is valid JSON. For JSON, keep permitted status, explanation, verification and blockers inside one valid JSON value; no prose, fences, post-test Markdown summary or extra fields contrary to an exact schema. Complete requested output overrides the default brevity limit. Before sending, recheck format without tools. No steering rule is a constrained decoder or a hard no-tools switch.

Default to a short outcome with concrete check results and unresolved blockers, not a transcript. Progress is only for meaningful milestones, plan changes or blockers; no routine tool narration or repeated recap. Requested detail and exact formats still win.

For coding, keep an acceptance ledger of concrete checks, trace the affected path before editing, and verify public symbols, registrations and configuration. Use targeted tests and behavioral probes, escalating for failures or cross-cutting risk; do not rerun unchanged passing checks unless required. A build alone is not completion. Stop when the ledger is satisfied or explicitly blocked.

## Hot local recipes and workflow

read returns an object with text:string, not content, lines or a bare string. text[0] is one character, not the first line. Use `text.split(/\r?\n/,1)[0]` for a complete first line, preserving whitespace. Search is local.grep, not local.search; edit fields are oldText/newText. Use targeted tools.describe on uncertainty, not guessed options or a full API dump.

Load [bounded recipes](references/recipes.md) with fabric.help({topic:"recipes"}) for complete first lines, discover/read composition, exact or same-file edits, settled nonzero commands and known-schema data pipelines. Load [workflow rules](references/workflow.md) with fabric.help({topic:"workflow"}) for acceptance ledgers, user-file handling, coding style, safe Git history, commitlint, PR templates, authorized in-thread review replies, noninteractive commands and file-backed Markdown bodies. Follow nextOffset if a required page is truncated. Reading help never executes an example or grants approval.

Only for authorized deterministic data work: read, parse, join/filter/compute, write and verify inside one bounded execution. Keep raw records in guest variables, not model round trips or persistent scratch state. Inspect unknown schemas before choosing transformations. Bounded parallel is for independent read-only work, not overlapping writes or commands.

Use `payloads` for named string input:

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

The mounted namespaces are `local`, `fabric`, `artifacts`, `memory`, `state`, and `mcp`. Bootstrap when needed through `fabric.info()` and `fabric.workspace({action:"status"})` inside exec, not top-level compatibility tools. Workspace-scoped providers require a verified binding. Select an ambiguous root in a separate execution with `fabric.workspace({action:"select",rootId})`; do not mix selection and workspace effects. Web/LSP/delegation are unavailable unless explicitly configured through MCP. Write, execute, and network calls follow Fabric approval policy and fail closed when required elicitation is unavailable; batching work into one program does not merge approvals: each write/network action independently follows Fabric approval policy; elicitation occurs only when that policy requires it. Cancellation and the effective deadline propagate through nested calls.

Nested call arguments and results do not enter context automatically. The returned value plus bounded diagnostics, guest logs, and failure progress re-enter context. Returned output is capped (`executor.maxOutputChars`, 50,000 chars by default) and spills to an artifact reference when exceeded, so filter, aggregate, and slice inside the program and return only the data the task needs.

Local shell is an approved host capability. Request outer `timeoutMs:180000` for `local.shell({command:"pnpm test",timeoutMs:120000})`, leaving cleanup time. Never automatically retry an effectful program.
