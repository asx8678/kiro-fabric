# Kiro Fabric

**A coding agent for Kiro CLI v3 that lets the model express tool work as checked TypeScript.**

You describe a task in Kiro. The model writes a small program. Fabric checks that program, runs it in an isolated JavaScript engine, and routes its tool calls through schemas, permissions, and resource limits. The program can search, read, transform, and combine data before returning the evidence Kiro needs for its next decision.

The aim is to spend less of the conversation coordinating routine tool work. Fabric provides the execution layer; Kiro provides the model, conversation, and user interface.

![Architecture: Kiro sends one fabric_exec request to a private Fabric backend, which checks TypeScript, runs QuickJS, gates provider calls, and returns a bounded result.](docs/images/execution-flow.svg)

> **Project status:** source installation is available. Authenticated real-client qualification remains incomplete, including the exact tool inventory and compaction/resume lifecycle. Public signed distribution remains blocked. The efficiency mechanisms below are implemented, but the repository does not establish an end-to-end speedup, token-saving percentage, or lower billed cost. See [release gates](docs/release.md) and [measurement scope](docs/efficiency-baseline.md).

## Read this guide

[Start](#start) · [Architecture](#1-how-kiro-and-fabric-fit-together) · [Execution deep dive](#2-the-life-of-one-execution) · [Worked example](#3-a-worked-example-search-read-and-reduce) · [Efficiency](#4-where-the-efficiency-comes-from) · [Permissions](#5-how-permissions-and-side-effects-work) · [Output](#6-how-results-stay-manageable) · [Sessions](#7-what-survives-a-call-a-compaction-and-a-restart) · [Limits](#8-default-budgets-and-their-tradeoffs) · [Source map](#9-explore-and-verify-the-implementation)

## Start

Use an authenticated Kiro CLI installation with v3 support. Source development requires **Node.js ≥24**, **pnpm 11.20.0**, Bash, and a supported POSIX host. Keep ripgrep (`rg`) available for local development and search. Project tools such as Git, Python, or Docker remain separate dependencies.

```sh
# From this repository, as your normal user:
pnpm install --frozen-lockfile
pnpm run agent:install

# Start Kiro in the project you want to work on:
cd /path/to/your/project
kiro-cli --v3 --agent kiro-fabric
```

If you use a custom `KIRO_HOME`, export it before both installation and launch. Kiro authentication is separate from Fabric installation. Restart Kiro after updating the installed agent so it loads the matching runtime and resources.

Talk to Kiro normally, for example: “Find where request timeouts are configured, explain the defaults, and suggest a focused change.” You do not need to write the TypeScript yourself. The examples below show the programs the model can send to Fabric.

## 1. How Kiro and Fabric fit together

Fabric installs a **native Kiro custom-agent profile** named `kiro-fabric`. Selecting it tells Kiro to launch one private backend over **stdio MCP**: the Model Context Protocol transported through the child process’s standard input and output. There is no separate server to start manually.

The profile exposes exactly one model-visible tool, **`@fabric/fabric_exec`**. It also supplies guidance and the Fabric skill. `--v3` selects Kiro’s agent engine; the generated profile does not pin a model.

| Component | Responsibility |
| --- | --- |
| Kiro CLI and its model | Understand the task, generate tool programs, interpret results, and manage the conversation |
| Agent profile | Select Fabric’s backend, resources, and single outer tool |
| Fabric MCP backend | Bind the workspace, retain its runtime, accept executions, and format responses |
| TypeScript compiler worker | Check the guest program against the actual Fabric declarations and emit JavaScript |
| QuickJS | Execute the checked program in a fresh, constrained JavaScript context |
| JSON bridge and ActionRegistry | Resolve actions, validate arguments, apply policy, coordinate effects, and record outcomes |
| Providers | Perform local coding, memory/state operations, bootstrap/help, artifact reads, or configured MCP calls |

The raw backend retains `fabric_info`, `fabric_workspace`, and `fabric_exec` for compatibility and operator use. That raw inventory differs from the profile’s **one-tool model inventory**. Inside an execution, the model uses `fabric.info()` and `fabric.workspace()` through the checked API.

The profile sets `includePowers: false` and `includeMcpJson: false`. Downstream MCP capabilities come from Fabric’s private configuration. Web access, language-server operations, and delegation become available only when suitable MCP capabilities are explicitly configured.

Implementation: [agent profile](scripts/agent-profile.mjs), [MCP server](src/kiro/mcp-server.ts), and [runtime assembly](src/kiro/runtime.ts).

## 2. The life of one execution

### Step 1 — Kiro submits a function body

`fabric_exec` accepts four fields:

| Field | Meaning |
| --- | --- |
| `code` | Required TypeScript function body; use `await` and return a JSON-compatible value |
| `payloads` | Optional named, immutable strings for content such as replacement text |
| `resultFormat` | Optional `auto`, `json`, or `text` response formatting |
| `timeoutMs` | Optional requested timeout, subject to the effective deadline policy |

For example, this is a complete request:

```json
{
  "code": "return await local.read({ path: 'README.md', limit: 80 });",
  "resultFormat": "json"
}
```

The code is a function body, so it can contain loops, conditions, local variables, and multiple awaited tool calls. Imports and host modules are unavailable. A conversation-only answer requires no execution.

### Step 2 — Fabric establishes authority and admits the request

Fabric obtains workspace roots from the client and verifies their identity. A single verified root can bind automatically. With multiple roots, the model lists and selects one explicitly. Selection must complete in a separate execution before workspace effects run; an unsuccessful selection execution does not commit the transition.

The backend’s working directory is not workspace authorization. If binding is unavailable, bootstrap/help can remain usable while workspace providers are unavailable.

The execution service then checks admission and input budgets. Its concurrency limit covers compilation, approval waits, and guest execution together. Excess executions are rejected immediately instead of joining an unbounded queue.

### Step 3 — TypeScript is checked before any provider action

Fabric wraps the function body and compiles it against its guest API declarations. The compiler host can read the generated inputs and approved TypeScript standard-library declarations; it does not resolve arbitrary project files or packages.

Invalid types or a broken wrapper stop the execution before QuickJS or provider calls. For instance, a string where a numeric line limit is required is a compile-time failure. Runtime schemas still matter: dynamically discovered tool arguments and external data need validation when used.

The compiler runs in a bounded Node worker thread. A warm worker can be reused, while cancellation, failure, idle expiry, and recycling release it. Checking every new program remains mandatory.

### Step 4 — QuickJS runs the checked JavaScript

Each execution gets a **fresh QuickJS context**. It exposes the Fabric facades and helpers, including `local`, `tools`, `mcp`, `memory`, `state`, `fabric`, `artifacts`, `parallel`, and `print`.

Guest code has no ambient `process`, filesystem, shell, environment, timers, host imports, or unrestricted network. Those capabilities are reachable only through host-provided actions. Memory and execution deadlines bound the guest.

Local JavaScript variables last for that call. Compiler reuse does not retain guest variables or skip approval checks.

### Step 5 — Every tool call crosses the host boundary

A call such as `local.read(...)` becomes a bounded JSON request. For a registry action, Fabric resolves its descriptor, prepares canonical arguments, validates the schema, calculates affected resources, reserves audit/effect capacity, evaluates approval policy, and invokes the provider.

The provider’s result is validated and bounded before returning to the guest. The guest can then inspect it, select a few fields, or use it in the next dependent call. Independent calls can overlap within the configured concurrency limit.

### Step 6 — Kiro receives the result

The final `return` value, bounded logs, and relevant diagnostics are projected into an MCP response. Oversized output gets a head-and-tail preview and, when retention succeeds, a temporary artifact reference. Kiro uses the result to answer, request clarification, or generate another program.

Errors remain visible. A later failure does not undo earlier completed effects, so Fabric includes bounded progress information when applicable and directs the caller to inspect state before retrying.

Implementation: [execution service](src/execution-service.ts), [compiler](src/runtime/type-checker.ts), [QuickJS runtime](src/runtime/quickjs-runtime.ts), and [ActionRegistry](src/core/action-registry.ts).

## 3. A worked example: search, read, and reduce

Suppose the task is to locate timeout-related TypeScript code. This program searches first, reads a small amount of context around up to four hits, and returns only those excerpts:

```ts
const hits = await local.grep({
  pattern: "timeoutMs",
  path: "src",
  glob: "**/*.ts",
  literal: true,
  limit: 4,
});

const excerpts = await parallel(hits.matches, async (hit) => {
  const offset = Math.max(1, hit.line - 2);
  const file = await local.read({ path: hit.path, offset, limit: 7 });
  return {
    path: hit.path,
    matchLine: hit.line,
    excerptStartLine: offset,
    text: file.text,
    truncated: file.truncated,
  };
}, { concurrency: 4 });

return { searchTruncated: hits.truncated, excerpts };
```

This is **one outer execution**, with one search and at most four reads. The search must finish before the read locations are known. The reads are independent, so they can run together. `parallel` preserves input order and queues excess host work under the execution-wide limit.

The model receives the evidence needed to reason about the change. The returned truncation flags also make the limits of that evidence explicit. The search is literal; it does not claim semantic understanding or an exhaustive inventory.

For an edit, use an exact anchor and pass replacement content as payloads. After inspecting a real file and choosing the intended change, the model can send a request shaped like this:

```json
{
  "code": "return await local.edit({ path: 'example.txt', oldText: payloads.before, newText: payloads.after });",
  "payloads": {
    "before": "status=before",
    "after": "status=after"
  }
}
```

`example.txt` is illustrative. The default edit requires a nonempty, unique exact match. The provider prepares review material for the actual change; write approval still applies. `local.write` is create-only unless `overwrite: true` is explicit.

For a project that uses pnpm, a verification command can use an outer deadline with room beyond the shell deadline:

```json
{
  "code": "return await local.shell({ command: 'pnpm test', timeoutMs: 120000 });",
  "timeoutMs": 180000
}
```

Use the project’s actual check command. Ordinary nonzero shell exits fail by default. `settle: true` makes an ordinary nonzero exit return data for inspection; permission denial, cancellation, timeout, and uncertain cleanup still fail.

## 4. Where the efficiency comes from

![Illustrative comparison: coordinating each read through the model requires repeated tool exchanges; a Fabric program can read independent files together, reduce the data locally, and return one result. This is not a timing benchmark.](docs/images/efficiency-flow.svg)

### Fewer model decisions for routine coordination

When the next action is already determined by data, code can express it directly: search, loop over matches, read bounded ranges, and assemble a result. The model does not need to generate a fresh tool request for every step.

In an illustrative workflow with four known independent reads, issuing one read per model/tool exchange takes four outer invocations. Fabric can express the same four reads in one `fabric_exec`. There are still four provider operations, with their own validation and policy checks. This is a reduction in outer coordination for that example, not a measured fourfold speedup; other tool interfaces may also support batching.

Batch only work whose control flow is already known. A decision that needs new model reasoning still belongs between executions.

### Less intermediate data in the conversation

Provider results can stay inside the guest while code filters, sorts, aggregates, or extracts fields. Returning a few relevant excerpts can keep unrelated file content out of the next model input. `print` is also visible output, so printing every intermediate value defeats this benefit.

The input still includes the generated code and any payloads. Large programs, excessive help pages, repeated discovery, and artifact rereads can increase work. Returning too little evidence can also force another round or lead to a poor decision.

### Capabilities discovered when needed

The model-visible tool inventory contains one execution tool. Inside code, `tools.search` and `tools.describe` expose registry descriptors, and `mcp.tools`/`mcp.describe` inspect a configured downstream server.

This design lets the agent request the capabilities it needs rather than exposing every downstream schema as an outer tool. A descriptor includes its schema and digest, so discovery remains useful for validation. The total prompt still includes the agent guidance, resources, requested help, returned descriptors, and conversation; a one-tool inventory does not imply a tiny total context.

Configured MCP discovery itself can require network and execution approval. For external calls, the caller can pass `expectedDescriptorDigest` from discovery so a changed descriptor is rejected before invocation. Tool annotations do not grant permission.

### Bounded parallel I/O

`parallel` overlaps independent operations. A shared semaphore also covers direct `Promise.all` and nested helpers, so they cannot multiply host concurrency beyond the execution-wide cap. Default host-call concurrency is eight.

For independent I/O, overlap can reduce waiting compared with executing each request serially. Actual latency depends on providers, approvals, available resources, and the task. Parallelism is inappropriate for dependent edits or conflicting writes; effect reservations reject overlapping work.

### Reuse where it preserves isolation

The backend caches a runtime for the verified workspace. An execution service retains at most **one idle compiler worker for 30 seconds**, recycling it after **250 uses**. The compiler also reuses stable declaration/standard-library inputs and checker state.

This can avoid repeatedly paying worker startup and compiler setup costs during active work. Every program is still checked and gets a new QuickJS context. The design avoids retaining arbitrary guest state between executions.

### How to evaluate the benefit honestly

Fabric trades model coordination and visible intermediate output for compilation, bridge validation, bookkeeping, and local execution. A single trivial read may gain little; a large deterministic inspection task offers more opportunities to batch and reduce data.

The repository’s [efficiency preparation](docs/efficiency-baseline.md) provides fixed fixtures, source/build identities, and bounded-help probes. It does **not** run comparable file tasks through both a native Kiro client and Fabric, or measure actual billing. Character counts are not token counts.

A defensible comparison needs the same task and success criteria, recorded client/model/configuration, cold and warm conditions, all failed attempts and retries, client-visible output, latency, and actual usage/cost evidence. Report cost per successful task only when those costs are known. There is currently no supported savings percentage to quote.

## 5. How permissions and side effects work

![Permission path: guest intent becomes canonical schema-checked arguments, reserves effect and audit capacity, receives allow/ask/deny policy, and only then reaches a provider. Approval applies to the exact action.](docs/images/approval-boundary.svg)

There are two relevant decisions: Kiro allows the **outer execution tool**, and Fabric evaluates each **inner action**. The outer allowance gives the model a way to submit a program. It does not approve the program’s file changes, shell commands, or network requests.

Fabric’s default risk policy is:

| Risk | Default | Example |
| --- | --- | --- |
| Read | Allow | Reading a verified workspace file |
| Write | Ask | Editing a file or persisting a memory value |
| Execute | Ask | Running a host shell command |
| Network | Ask | Contacting a configured MCP server |

An explicit policy decision still occurs for reads. Silent allow/deny decisions consume no interactive-approval slots; an admitted ask does. Decline, cancellation, or failed elicitation does not refund an already admitted attempt.

Arguments are prepared and validated **before** approval. The canonical snapshot is frozen, so approval and invocation refer to the same request. Write/effect reservations are taken before prompting to prevent conflicting operations from accumulating behind approval dialogs. Local mutations also coordinate through a workspace lock shared by cooperating Fabric processes.

**QuickJS isolates the guest program; an approved shell command runs with host OS authority.** A working directory does not confine the shell’s filesystem or network access. Path checks, environment filtering, and bounded process-group cleanup add protection, but they do not make Fabric a container or guarantee containment of arbitrary host programs. External editors do not participate in Fabric locks.

Likewise, a multi-step program is not a transaction. If an edit succeeds and a later test fails, the edit remains. A memory/state mutation can commit and then lose its acknowledgement. Inspect current files or durable state before retrying, and use state revisions when coordinating updates.

Further detail: [configuration and recovery semantics](docs/configuration.md) and [security boundaries](SECURITY.md).

## 6. How results stay manageable

![Result handling: a guest selects relevant data, Fabric formats it, and an oversized response becomes a head-and-tail preview plus a temporary artifact when retention succeeds. Failed retention is reported as an error.](docs/images/output-flow.svg)

Fabric applies distinct limits at distinct points:

1. **Provider boundary:** arguments are schema-checked, and arguments/results cross bounded JSON bridges. Provider-specific truncation can happen here.
2. **Guest program:** code selects what to return; intermediate values need not enter the conversation.
3. **Visible response:** the default output budget is 50,000 characters. Failure output has an additional 20,000-character ceiling.
4. **Overflow storage:** when a formatted response exceeds the visible budget, Fabric tries to retain the complete formatted response in a private temporary artifact and returns a deterministic head-and-tail preview with a read hint.

The artifact stores the response that reached projection; it cannot restore data already omitted by a provider’s own bounds. If retention fails, the response explicitly reports that failure and is marked as an error. A successful guest run therefore does not automatically mean a successful caller-visible response.

Artifacts can be read in bounded pages through `artifacts.read`. They are subject to quotas, expiry, and eviction. By default the idle expiry is one hour, and reads refresh the last-read time. They are process-owned scratch data, even when backed by files; do not depend on an artifact ID after a restart.

Failed executions can include a bounded summary of completed nested calls, their outcomes, and known committed mutations. This added summary omits call arguments and results. It exists to support recovery, not to promise that all effects were rolled back.

Implementation: [result projection](src/kiro/projection.ts) and [artifact store](src/kiro/artifacts.ts).

## 7. What survives a call, a compaction, and a restart

![Lifetime diagram: Kiro retains conversation history, a Fabric backend retains the verified workspace runtime and a bounded compiler pool, every call gets a fresh QuickJS context, and memory/state persist independently on disk.](docs/images/sessions-and-storage.svg)

| Data or component | Lifetime and owner |
| --- | --- |
| Conversation and compacted summary | Kiro manages saving, compaction, and chat resume |
| Fabric backend process | Intended to stay connected through ordinary turns and compaction within the selected Kiro process |
| Workspace runtime | Cached for the verified workspace; changing workspace can replace it within the same backend PID |
| Compiler worker | Reused within its pool limits; can expire or restart independently |
| QuickJS variables | One `fabric_exec` only |
| Overflow artifacts | Temporary, bounded, process-owned storage |
| `memory` | Intentional durable workspace facts, such as a project convention |
| `state` | Durable, revisioned workspace progress, such as completed task steps |

Memory and state are **workspace-scoped**, so separate Kiro chats bound to the same workspace may share them. Store intentional facts and task progress, rather than mirroring the entire conversation. Use `expectedRevision` on state mutations to detect conflicting updates.

Durable Fabric configuration and project data live under `${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/data/fabric/`, separately from installed runtime code. Configuration lives in `config/config.json`; explicitly configured MCP federation lives in sibling `config/mcp.json`. Private ownership and file validation apply when those files are loaded.

The intended lifecycle is one retained backend through Kiro compaction, followed by a **new backend process** when Kiro later resumes in a new process. Kiro would restore its saved conversation, and Fabric would reopen durable workspace data. Exact same-process compaction and new-process resume remain authenticated real-client qualification gates; local storage tests alone cannot prove Kiro’s behavior.

To inspect a running Fabric instance, the model can execute:

```ts
return await fabric.info();
```

The returned PID, `mcpInstanceId`, start time, and runtime generation help distinguish a new backend from a workspace-runtime change. No repeated health-check ritual is required to do useful work.

## 8. Default budgets and their tradeoffs

These are defaults from [configuration](src/config.ts), not throughput guarantees. Limits apply together; the first exhausted budget stops further work.

| Budget | Default | Why it exists |
| --- | --- | --- |
| Admitted executions per service | 4 | Bounds compilation, guest runs, and approval waits together |
| Host calls per execution | 64 | Bounds total nested activity |
| Concurrent host calls per execution | 8 | Queues excess parallel I/O |
| Interactive approval attempts per execution | 16 | Bounds admitted prompts, including unsuccessful attempts |
| Simultaneous approval waits per execution | 2 | Bounds open approval interactions |
| Audit entries / bytes per execution | 64 / 64,000 | Keeps outcome bookkeeping bounded |
| Guest heap limit | 64 MiB | Limits the QuickJS heap, not total backend memory |
| Base timeout / maximum | 120 s / 900 s | Bounds work; effective deadlines also account for action policy |
| Source / payload input budgets | 256 KiB each | Bounds generated code and named string inputs |
| Nested result budget | 2,000,000 characters | Bounds data crossing into the guest |
| Visible output budget | 50,000 characters | Limits the formatted response returned to Kiro |
| Artifact count / per artifact / total | 32 / 2,000,000 / 8,000,000 characters | Bounds temporary overflow retention |

**The audit budget is often the tighter limit.** Each audited registry call reserves 2,048 bytes, so the default 64,000-byte budget admits at most **31 audited calls**, even though the host-call ceiling is 64. A batch of 64 audited calls needs at least 131,072 audit bytes as well as enough call, entry, time, and other capacity. Split work deliberately or configure budgets with an understanding of the resource cost.

Character budgets generally count UTF-16 code units; source/payload limits count UTF-8 bytes. Neither is a billed-token measurement. See the [guest API](skills/fabric-exec/references/api.md) for per-tool limits, paging conventions, and complete schemas.

## 9. Explore and verify the implementation

| Start here | What to inspect |
| --- | --- |
| [Agent profile](scripts/agent-profile.mjs) | One-tool inventory, backend launch, and model instructions |
| [MCP server](src/kiro/mcp-server.ts) | Client boundary, workspace lifecycle, and execution dispatch |
| [Execution service](src/execution-service.ts) | Admission, compilation, deadlines, approvals, and nested-call accounting |
| [Compiler](src/runtime/type-checker.ts) | Restricted compiler host and worker reuse |
| [QuickJS runtime](src/runtime/quickjs-runtime.ts) | Guest isolation, JSON bridge, and shared concurrency queue |
| [ActionRegistry](src/core/action-registry.ts) | Descriptor lookup, schemas, canonical arguments, and effect reservations |
| [Local provider](src/providers/local-provider.ts) | Workspace file/search/edit/shell operations |
| [MCP provider](src/kiro/mcp-provider.ts) | Explicit federation, discovery, transport, and descriptor checks |
| [Memory](src/kiro/memory.ts) and [state](src/providers/state-provider.ts) | Durable storage and concurrent mutation behavior |
| [Projection](src/kiro/projection.ts) | Visible output, overflow, and failure-progress reporting |

```sh
# Build the runtime Kiro actually loads:
pnpm run build

# Required before committing:
pnpm run check

# Prepare offline efficiency evidence without model inference:
pnpm run efficiency:manifest
pnpm run efficiency:probe
```

`pnpm run check` runs typechecking, build, tests, dead-code lint, local agent staging/certification, and SBOM generation. The local certification exercises the component MCP boundary; authenticated Kiro lifecycle qualification is separate. A fresh build matters because Kiro loads `dist/`, while tests primarily exercise source.

For runtime investigation, enable private tracing with `KIRO_FABRIC_DEBUG=1` or the private configuration, then inspect the trace file reported by Fabric. The analyzer accepts a trace path:

```sh
node scripts/analyze-trace.mjs /path/to/trace.jsonl --json
```

Traces report operational durations and sizes, including visible output and incomplete coverage. They do not supply billing or token counts. See [tracing](docs/tracing.md) before sharing evidence.

[Architecture details](docs/architecture.md) · [Configuration](docs/configuration.md) · [Guest API](skills/fabric-exec/references/api.md) · [Efficiency evidence](docs/efficiency-baseline.md) · [Release qualification](docs/release.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
