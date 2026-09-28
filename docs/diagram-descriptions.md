# Fabric diagrams: text versions

These descriptions follow the README's four schematics in reading order. They retain the details and implementation references that would crowd the images. Blue solid arrows carry calls; green dashed arrows carry returned data; amber branches show conditions that stop the normal path. Each branch is also labeled in text.

[Back to README](../README.md)

## Runtime topology

[Open system map](images/runtime-topology.svg)

**Read the upper row from left to right, then follow the dashed return path.** Kiro chooses a program. Fabric compiles it, runs it, and checks every nested provider action. The lower row shows resources reached through providers; it is not a separate set of model-facing tools.

1. **Kiro plans.** The agent profile exposes `@fabric/fabric_exec`. Kiro sends a TypeScript function body and optional named string payloads over stdio MCP to a private Fabric backend. Kiro owns saved chat history, resume and compaction.
2. **Fabric compiles.** A worker checks the program against Fabric's guest declarations with restricted compiler file access. A service-owned cache may reuse successful compiler output for the exact source and declarations. It never caches approvals, payload values or provider results.
3. **QuickJS runs.** A sandbox worker hosts a fresh guest context for each execution. Guest variables end with the call. Guest code has no ambient filesystem, shell or network access; host calls cross a bounded JSON bridge.
4. **The registry checks each action.** `ActionRegistry` prepares arguments, validates schemas, freezes the canonical request, reserves effects and audit capacity, and applies `allow`, `ask` or `deny` before provider invocation. Workspace operations require a verified binding. An outer tool allowance does not authorize every nested effect.
5. **Providers reach resources.** The diagram shows four main routes: local files/shell, the separate Navigator engine child, workspace data and configured external MCP servers. The Navigator host starts its child lazily and owns its lifetime above replaceable workspace runtimes. Compiler and sandbox workers are threads in the Fabric process, not separate MCP servers.
6. **Evidence returns.** Nested results return to QuickJS. Guest code selects a value and may print logs. Response projection formats and bounds that output, using a preview and temporary artifact when overflow retention succeeds. Kiro answers or chooses another step from the evidence.

The full provider inventory includes supporting namespaces omitted from the schematic:

| Namespace | Responsibility |
| --- | --- |
| `fabric` | Bootstrap, help and workspace selection |
| `local` | Workspace file operations and host shell execution |
| `repo` | Advisory repository navigation through Navigator |
| `memory` | Intentional durable workspace facts |
| `state` | Revisioned durable workspace progress |
| `artifacts` | Temporary retained output and checkpoint access |
| `mcp` | Explicitly configured external MCP capabilities |

Provider availability depends on configuration and verified bindings. Multiple workspace roots require a separate selection execution. Namespace discovery is not authorization. The schematic describes the profile contract; native tool filtering and interactive approval still require client qualification.

Source: [runtime assembly](../src/kiro/runtime.ts), [provider inventory](../src/kiro/provider-inventory.ts), [sandbox worker boundary](../src/runtime/quickjs-runtime.ts), [workspace binding](../src/kiro/mcp-workspace.ts), [response projection](../src/kiro/projection.ts), and [Navigator host](../src/fovea/host.ts).

## Checked call sequence

[Open read trace](images/checked-call-sequence.svg)

**Start with the program, follow the four stages from left to right, then follow the dashed response path upward.** This is an illustrative read of the first 12 lines of the repository's README, not a captured execution transcript. The program is the body of `fabric_exec`'s `code` field:

```ts
const file = await local.read({
  path: "README.md",
  offset: 1, limit: 12
});
return file;
```

1. **Admit:** validate the request and limits, establish the required workspace authority and admit the execution. The outer request also accepts `payloads`, `resultFormat` and `timeoutMs`.
2. **Compile:** check TypeScript against the guest API, or reuse successful compiler output for identical source and declarations. A type error stops before QuickJS and all provider calls.
3. **Run:** create a fresh QuickJS context. `await local.read(...)` crosses the JSON bridge and resumes with the provider result.
4. **Gate and read:** apply the registry's preparation, schema and policy checks before the local provider reads the file. Read policy defaults to `allow`; an explicit denial blocks invocation. Provider errors, cancellation and deadline failures are additional failure paths not expanded in the picture.

The dashed return path abbreviates the nested result returning to QuickJS, `return file`, and Fabric's response projection. The image shows selected response fields:

| Field | Meaning in the example |
| --- | --- |
| `path` | `README.md`, relative to the verified workspace |
| `text` | The requested source lines; the image uses a placeholder |
| `sha256` | Full-file SHA-256, including bytes outside the selected lines |
| `truncated` | `true` because the file has an unread suffix after line 12 |
| `nextOffset` | `13`, the next one-based line for a follow-up read |

The actual result also includes `totalLines`, `identity`, `requestedRangeDelivered` and `fileExhausted`. An unread suffix does not by itself mean the requested prefix was incomplete. Keep relevant continuation and failure metadata when selecting a smaller result.

| Current default | Bound |
| --- | --- |
| Admitted executions per service | 4; excess admission fails without a queue |
| Concurrent host calls per execution | 8; excess calls wait in the shared guest queue |
| Total host calls per execution | 64; audit and other budgets also apply |
| Visible response | 50,000 UTF-16 code units, including logs and formatting |

Independent calls can overlap within those limits; dependent operations remain ordered. Intermediate guest values are not model-visible unless returned or printed. Failure diagnostics and overflow information are also preserved as appropriate. A later failure does not roll back earlier actions.

Source: [request contract](../src/kernel/fabric-exec-contract.ts), [execution service](../src/execution-service.ts), [compiler cache and pool](../src/runtime/type-checker.ts), [local read contract](../src/providers/local-contract.ts), [action registry](../src/core/action-registry.ts), and [current defaults](../src/config.ts).

## Navigator evidence

[Open Navigator schematic](images/navigator-evidence-flow.svg)

**Read from the query to the graph, across to the source window, then down to the read and its evidence.** The graph shows illustrative relations from this repository: `createKiroRuntime` constructs `LocalCodingProvider` and `FabricExecutionService`. This is not a claim that the diagram reproduces a particular Navigator query response.

1. **Find locations:** `repo.focus({ query: "createKiroRuntime" })` uses advisory navigation to identify source locations. Navigator builds its graph from verified bounded source snapshots using generation-private `ast-grep`. Extraction failures and omissions remain explicit coverage data. A map is not source inspection or correctness evidence.
2. **Produce a read window:** each entry in `navigation.reads` can carry a `path`, one-based `offset`, `limit` and `expectedSha256`. The image's illustrative window selects 16 lines beginning at line 57 of `src/kiro/runtime.ts`. `H1` abbreviates the full-file SHA-256 of the snapshot, not a literal API value or graph generation.
3. **Read the source:** `local.readMany({ windows })` uses ordinary registry validation and read policy. It verifies expected hashes and revalidates snapshots before returning. If a hash is stale, refresh navigation and reread instead of dropping the hash constraint.
4. **Inspect the evidence:** read the actual source text and hash, plus failures, coverage limits, `remaining` and `unreadTails`. `repo.focusRead` composes focus and bounded reads; it also returns `deferredReads` for windows not admitted to that batch. Its default batch is at most four windows with a 14,000-character read budget and partial results enabled. This budget is not the total envelope budget.

If analysis is unavailable or incomplete, disclose that and use permitted bounded local search/read. `repo.status` diagnoses availability without starting indexing. Never treat a navigation score, graph version, or returned packet as proof of complete inspection.

Managed standard/review profiles may append invocation-local advisory suffixes after qualifying successful source operations. Native prompt/stop delivery, restoration, chat isolation and automatic continuations remain separate qualification concerns. Emission is not model acknowledgment.

Source: [focus/read composition](../src/runtime/guest-bootstrap.ts), [runtime relationships](../src/kiro/runtime.ts), [source capture](../src/fovea/source-access.ts), [fact extraction](../src/fovea/core/build.ts), [graph construction](../src/fovea/core/graph.ts), [bounded source reads](../src/providers/local-read-many.ts), and [Navigator capabilities](../skills/fabric-exec/references/fovea.md).

## Version-bound edits

[Open edit decision flow](images/edit-consistency-flow.svg)

**Read left to right. At the diamond, matching source follows the publication path; detected drift follows the refusal path below.** `H1`, `H2` and `Hx` are shorthand for complete SHA-256 values. The example assumes the edit changes file content.

1. **Read source:** obtain text, file identity and full-file hash `H1` from `local.read` or `local.readMany`. Keep that hash with the source used to choose edit anchors.
2. **Prepare and permit:** call `local.edit` with `path`, `expectedSha256: H1` and exact `oldText`/`newText` replacements or an `edits` array. The provider checks the current snapshot, resolves disjoint anchors and builds the complete diff. The registry validates and freezes the canonical request, reserves write intent and audit capacity, and acquires the provider's cross-process intent lock before applying policy. The default write policy is `ask`; denial, declined approval or unavailable approval UI blocks publication for this request.
3. **Recheck:** after permission and before publication, revalidate the file and parent identities and source content. The diamond highlights the content-hash comparison; an identity failure also stops publication even if the hash matches. An external writer may change the file while approval is pending, yielding `Hx` while the request still holds `H1`.
4. **Publish or refuse:** if all checks pass, publish exactly the prepared bytes and return `changed` plus the resulting hash `H2`. Then verify the change with appropriate reads and checks. If drift is detected, refuse the write, reread current source and prepare a new request. Removing `expectedSha256` is not a recovery path.

Approval binds the same canonical request used for invocation. These are local conflict checks, not a multi-action transaction or OS isolation from hostile concurrent writers. A later failure does not undo an earlier write; inspect current source or durable state before retrying an uncertain operation. Shell commands retain host authority and are not confined by these file-provider checks.

Source: [local preparation and publication](../src/providers/local-provider.ts), [exact edit anchors](../src/providers/local-edit.ts), [path and snapshot checks](../src/providers/local-path.ts), [registry reservations](../src/core/action-registry.ts), and [approval policy](../src/kiro/power/approver.ts).

## Execution

[Open execution diagram](images/execution-flow.svg)

1. **Kiro submits a program.** The `kiro-fabric` agent exposes one model-visible tool, `@fabric/fabric_exec`. Kiro sends a TypeScript function body to the private backend through stdio MCP, the Model Context Protocol over standard input/output. The request accepts `code` and optional `payloads`, `resultFormat`, and `timeoutMs`.
2. **Bind and admit.** Fabric verifies the workspace root. By default, a service admits up to four executions across compilation, approval waits, and execution; excess requests are rejected. A single verified root binds automatically. Multiple roots need explicit selection in a separate execution.
3. **Check TypeScript.** A worker compiles against Fabric's guest declarations with restricted compiler file access. Invalid types or an invalid wrapper stop the program before guest execution or provider actions.
4. **Run fresh QuickJS.** Every call receives a new guest context. It has no direct filesystem, shell, or network access. Host calls cross a bounded JSON bridge and shared host-call queue. The default guest heap limit is 64 MiB. The base timeout is 120 seconds and the configured maximum is 900 seconds; the effective deadline also depends on action policy.
5. **Gate every action.** Fabric prepares canonical arguments, validates schemas, reserves effects, and applies approval policy before invoking local coding, memory/state, or configured MCP tools. Bounded JSON results return to the guest. Outer execution allowance does not approve inner effects.
6. **Return evidence.** Guest code filters and combines results. Logs count as visible output too. Fabric returns a bounded response, with a default 50,000-character budget and an overflow artifact when retention succeeds; Kiro uses it to answer or continue. A later failure may leave earlier effects committed.

Source: [execution service](../src/execution-service.ts), [compiler](../src/runtime/type-checker.ts), and [QuickJS runtime](../src/runtime/quickjs-runtime.ts).

## Efficiency

[Open efficiency diagram](images/efficiency-flow.svg)

1. **Batch routine work.** Four known file reads can be expressed in one outer execution. The diagram branches into four reads and joins their results in the guest. All four provider calls and their validation/policy checks still occur. This can reduce model/tool exchanges compared with issuing each read separately.
2. **Overlap independent I/O.** The default execution-wide limit is eight simultaneous host calls. A shared queue covers `parallel` and direct `Promise.all`, so excess work waits. The host-call ceiling is 64; audit admission separately accounts for retained entries and temporary pending-call reservations. Dependent operations stay sequential; conflicting writes can be rejected.
3. **Reduce data in code.** Intermediate results stay inside the guest unless returned or printed. Code can filter and combine them, returning only the fields the model needs.
4. **Reuse the compiler.** Each service retains at most one warm idle compiler worker. Its idle expiry is 30 seconds, and it is recycled after 250 uses. The compiler reuses stable declarations, but every new program is checked and gets a fresh guest context.

Actions can be discovered on demand using `tools.search` and `tools.describe`. Configured MCP discovery still follows approval policy. Compilation, validation, and bookkeeping add cost. The repository has no comparable end-to-end benchmark establishing speed, token, or billed-cost savings. See the efficiency measurement scope note (archived in Git history).

## Permissions

[Open permissions diagram](images/approval-boundary.svg)

1. **Fix the exact request.** Resolve the descriptor, prepare arguments, validate their input schema, then freeze the canonical request. Approval and invocation use that same request.
2. **Reserve before prompting.** Calculate affected resources and reserve write intent, audit capacity, and provider-owned locks. Reject conflicting writes before opening approval prompts.
3. **Apply policy.** Allow invokes the action. Ask invokes it only after approval. Deny returns a failure without invoking it.

Default risk policy:

| Risk | Default policy |
| --- | --- |
| Read | `allow` |
| Execute | `allow` |
| Write | `ask` |
| Network | `ask` |

Explicit per-risk configuration overrides these defaults. An `ask` policy blocks the action if elicitation is unavailable or declined. Shell execution follows the execute policy; permitted commands can modify files or access the network, and those effects are not blocked by the separate write/network provider policies.

Interactive budgets admit at most **16 attempts** and **two simultaneous waits** per execution. Silent allow/deny decisions consume neither counter. Decline or cancellation still consumes an admitted attempt.

The default audit budget is 64,000 bytes per execution. Each pending registry call reserves **8,192 bytes plus initial audit metadata and 2 bytes of framing** before approval. After the call and cleanup settle, only the actual escaped UTF-8 terminal entry size plus framing is retained. Thus 64 small sequential audited calls can fit; concurrency and larger entries need more capacity. The separate host-call and audit-entry ceilings are both 64; all budgets apply together.

A permitted shell command runs with host OS authority. A later failure does not undo earlier effects. Inspect current files or durable state before retrying.

Source: [ActionRegistry](../src/core/action-registry.ts), [configuration](configuration.md), and [security](../SECURITY.md).

## Output

[Open output diagram](images/output-flow.svg)

1. **Bound nested results.** The default nested-result budget is 2,000,000 characters. Provider-specific bounds also apply. Guest code selects the evidence to return.
2. **Bound the visible response.** The default is 50,000 characters, including the formatted value, logs, and diagnostics. Failure responses have an additional ceiling of 20,000 characters.

There are three outcomes:

- **Output fits:** return the formatted response directly; no overflow artifact is needed.
- **Overflow retained:** return a head-and-tail preview and retain the complete formatted response in a temporary artifact. Further reads use bounded pages through `artifacts.read({ id, offset, limit })`.
- **Retention fails:** return a bounded preview, report the unavailable full response, and mark the response as an error.

Default artifact quotas are 32 entries, 2,000,000 characters per artifact, and 8,000,000 characters total. Idle expiry is one hour, and reads refresh the last-read time. Artifacts cannot restore data already truncated by a provider. Character budgets count UTF-16 code units, not billed tokens.

Source: [result projection](../src/kiro/projection.ts) and [artifact storage](../src/kiro/artifacts.ts).

## Lifetimes

[Open lifetime diagram](images/sessions-and-storage.svg)

- **Kiro conversation:** Kiro owns saved history, summaries, context compaction, and chat resume.
- **Fabric runtime:** cached for the verified workspace, with a bounded compiler pool. A workspace change can replace the runtime without changing the backend PID. `fabric.info()` reports PID, `mcpInstanceId`, and runtime generation for inspection.
- **One execution:** each call gets a new QuickJS context. Local variables end with that call.
- **Durable memory and state:** intentional facts and revisioned task progress survive process restart. They are shared by chats bound to the same verified workspace. `expectedRevision` detects stale state updates. Durable storage is under `${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/data/fabric/`.
- **Temporary artifacts:** process-owned overflow data has a default one-hour idle expiry. Reads refresh its last-read time; quotas and eviction also apply. Do not rely on artifact IDs after restart.

Same-process compaction and new-process resume remain authenticated real-client qualification gates. Restart Kiro after installing an updated agent.

Source: [architecture and lifecycle](architecture.md).
