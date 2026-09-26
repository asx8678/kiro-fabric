# Fabric diagrams: text versions

These descriptions contain the technical content of the README diagrams as selectable, reflowable text. Each section follows the same reading order as its image.

[Back to README](../README.md)

## Runtime topology

[Open runtime topology](images/runtime-topology.svg)

1. **Kiro owns the conversation.** The agent profile exposes `@fabric/fabric_exec`. Kiro chooses a TypeScript program and sends it, with optional string payloads, over stdio MCP to a private Fabric backend. It uses returned evidence to answer or choose another step. Chat history, resume and compaction belong to Kiro.
2. **Fabric binds the workspace.** Verified client roots or a trusted launch handoff authorize a workspace runtime. Multiple roots require explicit selection in a separate execution. Availability also depends on configuration; a namespace in the inventory does not grant authority.
3. **Workers execute checked code.** A compiler worker checks TypeScript against the guest declarations with restricted compiler file access. Successful exact source and declarations may reuse cached compiler output. The sandbox worker runs a fresh QuickJS guest context for each execution. Guest code has no ambient filesystem, shell or network access, and its local variables do not survive the call.
4. **The host gates provider actions.** A bounded JSON bridge reaches `ActionRegistry`, which validates schemas, freezes canonical arguments, reserves effects and applies `allow`, `ask` or `deny` before provider invocation. The response is projected into bounded evidence for Kiro.
5. **The host owns Navigator.** The `repo` provider borrows a revocable host binding. The host lazily starts a separate Navigator engine child using generation-private parser bytes. Closing a workspace provider does not itself own engine shutdown.

The diagram groups the current provider inventory by purpose:

| Group | Namespaces | Role |
| --- | --- | --- |
| Workspace | `local`, `repo`, `review`, `probe` | File operations, advisory navigation, review accounting and retained probes |
| Durable data | `memory`, `state`, `continuity` | Workspace facts, revisioned progress and opt-in task recovery |
| Support and external capabilities | `fabric`, `artifacts`, `mcp` | Bootstrap, temporary retained output and explicitly configured MCP servers |

The picture describes the profile and runtime contract. It does not qualify complete native tool filtering, interactive approvals, or native conversation lifecycle behavior.

Source: [runtime assembly](../src/kiro/runtime.ts), [current provider inventory](../src/kiro/provider-inventory.ts), [sandbox worker boundary](../src/runtime/quickjs-runtime.ts), [workspace binding](../src/kiro/mcp-workspace.ts), and [Navigator host](../src/fovea/host.ts).

## Checked call sequence

[Open checked call sequence](images/checked-call-sequence.svg)

Read downward across the four lanes: Kiro agent, Fabric service, compiler/QuickJS workers, and registry/providers. These lanes group responsibilities; the workers belong to the Fabric process rather than separate MCP servers.

1. Kiro submits a TypeScript function body and optional named string payloads. The outer request also accepts `resultFormat` and `timeoutMs`.
2. Fabric checks the request, workspace authority and admission limits. A compiler-cache miss checks the program in an isolated compiler worker; a hit reuses successful output for the exact source and declarations. Type errors stop before QuickJS and provider effects.
3. A fresh QuickJS context sends each nested host call through the bounded JSON bridge. The registry prepares and validates arguments, reserves effects and audit capacity, applies policy, then invokes the provider if permitted. An outer tool allowance does not authorize all nested effects.
4. A bounded provider result returns to the guest. Further provider calls repeat the same checks. Independent I/O may overlap within the shared call limit; dependencies require sequencing.
5. Guest code selects its result. Intermediate records stay in guest variables unless returned or printed; logs also consume output budget.
6. Fabric formats and bounds the visible response. Overflow may retain the complete formatted response as a temporary artifact; failed retention is reported. Kiro uses this evidence to continue the conversation.

| Current default | Bound |
| --- | --- |
| Admitted executions per service | 4; excess admission fails without a queue |
| Concurrent host calls per execution | 8; excess calls wait in the guest's shared queue |
| Total host calls per execution | 64; audit and other budgets also apply |
| Visible response | 50,000 UTF-16 code units, including logs and formatting |

Compiler reuse never caches provider results, payload values, approvals or guest state. A later failure can leave earlier actions committed; execution is not a transaction.

Source: [request contract](../src/kernel/fabric-exec-contract.ts), [execution service](../src/execution-service.ts), [compiler cache and pool](../src/runtime/type-checker.ts), [action registry](../src/core/action-registry.ts), [response projection](../src/kiro/projection.ts), and [current defaults](../src/config.ts).

## Navigator evidence

[Open Navigator evidence pipeline](images/navigator-evidence-flow.svg)

1. **Capture:** a verified workspace lease authorizes bounded source capture into private snapshots. Identity and content checks bind the parsed bytes; unsupported source-access capabilities fail closed.
2. **Extract:** the generation-private `ast-grep` parser extracts symbols, imports, calls and anchors. Content-based fact reuse avoids repeating unchanged extraction; failures and omissions remain explicit coverage data.
3. **Navigate:** a typed graph and query context support `repo.sketch`, `repo.focus` and `repo.impact`. These maps guide inspection. They do not establish source coverage, correctness or edit permission.
4. **Locate:** focus returns advisory text and `reads` windows containing `path`, one-based `offset`, `limit` and `expectedSha256` for source bytes.
5. **Read:** `local.readMany` uses those windows through ordinary registry validation and read policy. It checks expected hashes and revalidates snapshots before return. `repo.focusRead` composes focus and a bounded batch of these reads.
6. **Inspect:** actual source text and hashes establish what was returned. Check failures, `remaining`, `unreadTails` and deferred navigation windows before treating inspection as complete. Use the actual read's hash for an edit. A graph version or ranking score cannot replace it.

If a source hash is stale, refresh navigation and reread rather than dropping the expected hash. If analysis is unavailable or incomplete, disclose that and use permitted bounded local search/read. `repo.status` is a cheap capability diagnostic; it does not start indexing.

Managed standard/review profiles can append invocation-local advisory suffixes after qualifying successful source operations. This is separate from native prompt/stop delivery, restoration, chat isolation and automatic continuations, which still require native-client qualification. Returned or emitted text is not proof of model acknowledgment.

Source: [guest focus/read composition](../src/runtime/guest-bootstrap.ts), [source capture](../src/fovea/source-access.ts), [fact extraction](../src/fovea/core/build.ts), [graph construction](../src/fovea/core/graph.ts), [bounded source reads](../src/providers/local-read-many.ts), and [Navigator capability details](../skills/fabric-exec/references/fovea.md).

## Version-bound edits

[Open version-bound edit flow](images/edit-consistency-flow.svg)

Follow steps 1-3 across the top from left to right, then steps 4-6 across the lower row from right to left.

1. **Read:** obtain source text and the full-file SHA-256 from `local.read` or `local.readMany`. Keep the content hash with the exact source used to choose edit anchors.
2. **Prepare:** send `local.edit` with `path`, `expectedSha256` and either `oldText`/`newText` or an `edits` array. The provider captures the current file, checks the hash, resolves all anchors against that original snapshot and builds the complete diff. Anchors must be unique unless `all` is requested, and edit ranges must be disjoint. Schema validation precedes freezing the canonical request.
3. **Reserve:** the registry reserves write intent and audit capacity. The provider acquires its cross-process intent lock before any approval prompt. Conflicting writes fail before prompting.
4. **Apply policy:** invoke only under `allow` or successful `ask`. The default write policy is `ask`; denial, declined approval or unavailable approval UI blocks publication for this request. Approval and invocation use the same canonical request.
5. **Publish:** revalidate snapshot identities and source content before publishing the prepared bytes. Return whether the file changed and its resulting SHA-256. Drift detected while approval was pending requires a new read and newly prepared edit.
6. **Verify:** inspect the resulting source and run appropriate existing checks. Subsequent actions have their own policy checks. Return evidence and status, including failures or incomplete verification.

This is conflict detection for local file operations, not a multi-action transaction or OS isolation from hostile concurrent writers. A later failure does not undo earlier publication. Inspect source or durable state before retrying after an uncertain result. Shell commands run with host OS authority and are not confined by these file-provider checks.

Source: [local preparation and invocation](../src/providers/local-provider.ts), [exact edit anchors](../src/providers/local-edit.ts), [path and snapshot checks](../src/providers/local-path.ts), [registry reservations](../src/core/action-registry.ts), and [approval policy](../src/kiro/power/approver.ts).

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
