# Trusted host session adapter

## Status and scope

`KiroHostSessionAdapter` is a **local TypeScript embedding contract**, not a new
Kiro RPC, metadata convention, hook rendezvous, or declaration of native support.
The managed MCP entry and generated profiles do not construct it. Recorded Kiro
2.22.1 evidence still lacks a supported native session/epoch/turn association and
intended-model-input acknowledgment; see [the upstream session request](upstream-session-report.md).

The current native CLI therefore retains the documented MCP-instance-local
behavior and warning. This change does **not** make native `/clear` a reliable
Fabric boundary until a supported trusted bridge actually calls retirement.
Native compaction remains enabled and unchanged.

## Embedding obligations

Pass an instance as `createKiroMcpServer({ hostSessions, ... })` only from trusted
host code which already owns the native association. There is no environment,
profile, guest namespace, or `repo.*` option for this.

1. `openSession({ conversationId, conversationEpoch, workspaceContext })` creates
   an opaque handle. IDs/epochs must be authenticated host facts, not model input,
   cwd, parent processes, hook files, or guessed `_meta`. The workspace provider
   must belong to that session. Native scopes never use the global launch fallback.
2. `beginTurn(session)` returns an opaque turn handle; replacing a turn cancels
   its owned work and pending delivery claims. Keep the same session across
   compact/resume only when a supported host contract explicitly authorizes it.
   Otherwise retire it and start fresh navigation; do not replay old handles.
3. `associateRequest(requestId, turn)` must precede that actual MCP request.
   The server consumes the association synchronously before selecting a workspace
   or runtime. Missing, ambiguous, copied, stale, or consumed handles fail closed.
   Host request IDs must be unique for outstanding transport requests. Tool
   arguments and MCP metadata never manufacture authority.
4. `retireSession(session)` is the host's clear/new/end boundary. It synchronously
   aborts the session and revokes Fovea leases/catalogs, then joins effect draining
   and selective private engine cleanup. Await completion; cleanup failures are
   surfaced and retain their capacity reservation. Do not regrant a retired epoch.
5. `endTurn(turn)` cancels that turn without discarding its conversation's durable
   host association. It never starts a continuation or drains another owner's work.

One adapter attaches to one MCP server. Admission is bounded: 32 live/retiring
sessions, 64 associated requests and 64 pending receipt records. Each session has
its own workspace binding, runtime/catalog authority, observers and analysis
leases. Graph caches remain shared, but focus/results/settings/rule trust do not.
`prepareRuntime` must return distinct runtimes; a shared injected runtime is refused.
Owner liveness is checked before creating a lease and again before publishing the
runtime/catalog, including after asynchronous creation or teardown.

## Retirement versus reset/reload

`FoveaHost.retireConversation(id, epoch)` is a host-only lifecycle operation,
not an action registered with the guest. It releases private controls and state
across every root, including roots whose borrowed providers were already closed.
It does not remove deliberately shared project/global configuration. Retirement
has reserved bounded scheduler admission and does not start an idle parser. An
in-progress worker stop is joined before reporting completion; uncertain cleanup
remains a failure, even after the child reference has been cleared.

Borrowed-client `close()` still supports workspace-provider replacement without
forgetting the same conversation's settings and rule trust. `repo.reset()` still
resets a conversation/root's navigation, not its entire lifetime.

`repo.reload()` is explicitly **process-wide**: it restarts the shared
same-generation engine and invalidates all engine navigation and retained results.
It is not used for chat clear. Existing process containment remains intact: an
active parser cancellation may terminate that shared worker and invalidate other
sessions' graph-bound handles. Those sessions must focus again; settings and
ownership are never inherited. Idle selective retirement does not restart it.

## Visible delivery and receipts

The existing `foveaPostToolContext` host capability remains a separate opt-in.
With a host session adapter, the same outbox claim is bound to the captured turn.
Collection still requires allowed read authority, an already authorized root,
visible sync configuration, settled source effects and the remaining output/time
budget. Same-call transient context remains independent and is not acknowledged
as a semantic-sync baseline.

A transport write records emission only. The trusted bridge may call
`acknowledgeModelInput(turn, noticeId)` **only after observing that exact notice in
that exact intended model input**. Early, duplicate, foreign and stale receipts
cannot advance the semantic baseline. Receipt processing is bounded and is not
automatically retried on uncertainty, including synchronous callback failures.
Concurrent/reentrant receipts share one pending callback; ownership is rechecked
before that callback runs. Unacknowledged notices are not declared
processed; turn retirement does not invent a receipt or automatic continuation.

If cancellation or retirement intervenes before transport publication, only the
advisory suffix is suppressed. The original tool outcome and recovery metadata
are preserved. A receipt after uncertain transport is stronger evidence than the
write result, but must still match the exact live owner and turn.

There is no native before-prompt hook bridge, hidden delivery, idle restart,
continuation scheduler, or queued-input protocol in this change. Those features
remain off pending their separate supported host contracts and native gates.

## Parser and approval boundaries

Managed parser admission is unchanged: complete generation, exact digest/version
and platform adapter; no PATH/download fallback. Historical schema-1 generations
remain valid rollback targets without Fovea analysis.

Legacy MCP form elicitation keeps its existing explicit affirmative/fail-closed
behavior. The new multi-session embedding path does not send unassociated forms
into a potentially different native chat: `ask` fails closed until intended-chat
approval routing is separately implemented and qualified. Do not change policies
to `allow` merely to bypass that missing host capability.

## Verification boundaries

**Focused verification:** the adapter, source/built retirement, MCP routing,
worker supervisor and native-status modules passed under trusted Node: 48 tests
passed across six files, with two Linux-only supervisor cases skipped on macOS.
This includes failure-latching, approval association, synchronous/reentrant
receipt callbacks, queued receipt revocation and runtime admission/publication
races. The built tests exercised the admitted parser and actual stdio MCP with a
synthetic trusted bridge. These results are not native Kiro qualification.

Full repository verification on 2026-09-22: `pnpm run check` passed under trusted
Node after correcting fixture typing, the projection mock's retirement contract
and missing audit-inventory entries. The serial suite passed 3,606 tests with 91
skipped (229 files passed, six skipped); typecheck, dead-code lint, component MCP
certification and Agent SBOM generation also passed. Skipped/platform-specific
checks and authenticated native Kiro behavior are not certified by this run.

- `tests/fovea/host-session-adapter.test.ts`: opaque ownership, request/receipt
  bounds, turn revocation, emission versus acknowledgment, unchanged base outcomes.
- `tests/fovea/session-retirement.test.ts`: synchronous revocation, all-root
  retirement, shared configuration, parser-free cleanup and admission bounds.
- `tests/fovea/mcp-session-adapter.test.ts`: MCP handler through real runtime and
  execution service; only graph worker and external MCP transport are substituted.
- `tests/fovea/session-retirement-built.test.ts`: built engine/private IPC with an
  admitted complete-generation parser, actual stdio MCP with a synthetic trusted
  bridge, and more than 128 focus/retirement cycles without a worker restart.
- `tests/fovea/host-process.test.ts`: explicit retirement confirmation, joined
  worker cleanup, failure latching, cancellation and process-group containment.
- `tests/fovea/native-status.test.ts`: honest native capability/status reporting.

These are component checks, not native Kiro qualification. Native session routing,
intended-input delivery and real human approval accept/decline/cancel remain
separate release blockers. Do not claim them from these fixtures or a passing build.
