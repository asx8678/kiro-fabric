# Fabric diagrams: text versions

These descriptions contain the technical content of the README diagrams as selectable, reflowable text. Each section follows the same reading order as its image.

[Back to README](../README.md)

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
2. **Overlap independent I/O.** The default execution-wide limit is eight simultaneous host calls. A shared queue covers `parallel` and direct `Promise.all`, so excess work waits. The host-call ceiling is 64, while the default audit budget admits at most 31 audited calls. Dependent operations stay sequential; conflicting writes can be rejected.
3. **Reduce data in code.** Intermediate results stay inside the guest unless returned or printed. Code can filter and combine them, returning only the fields the model needs.
4. **Reuse the compiler.** Each service retains at most one warm idle compiler worker. Its idle expiry is 30 seconds, and it is recycled after 250 uses. The compiler reuses stable declarations, but every new program is checked and gets a fresh guest context.

Actions can be discovered on demand using `tools.search` and `tools.describe`. Configured MCP discovery still follows approval policy. Compilation, validation, and bookkeeping add cost. The repository has no comparable end-to-end benchmark establishing speed, token, or billed-cost savings. See [efficiency measurement scope](efficiency-baseline.md).

## Permissions

[Open permissions diagram](images/approval-boundary.svg)

1. **Fix the exact request.** Resolve the descriptor, prepare arguments, validate their input schema, then freeze the canonical request. Approval and invocation use that same request.
2. **Reserve before prompting.** Calculate affected resources and reserve write intent, audit capacity, and provider-owned locks. Reject conflicting writes before opening approval prompts.
3. **Apply policy.** Allow invokes the action. Ask invokes it only after approval. Deny returns a failure without invoking it.

Default risk policy:

- Read, write, execute, and network: allow without confirmation.
- Explicit per-risk `ask` or `deny` configuration overrides these defaults.

Execute allows all shell commands without confirmation, including commands that modify files or access the network. These effects are not blocked by the separate write/network provider policies.

Interactive budgets admit at most **16 attempts** and **two simultaneous waits** per execution. Silent allow/deny decisions consume neither counter. Decline or cancellation still consumes an admitted attempt.

The default audit budget is 64,000 bytes per execution. Each audited registry call reserves 2,048 bytes, admitting at most **31 audited calls**. The separate host-call ceiling is 64; all budgets apply together. A batch of 64 audited calls needs at least 131,072 audit bytes as well as sufficient other budgets.

An approved shell command runs with host OS authority. A later failure does not undo earlier effects. Inspect current files or durable state before retrying.

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
