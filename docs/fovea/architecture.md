# Native Navigator architecture

Current implementation, not a full native-parity claim.

## Lifetime and execution paths

The persistent MCP server in `src/kiro/mcp-server.ts` owns one `FoveaHost`
above replaceable workspace runtimes. A provider borrows a revocable binding.
Closing a guest or provider never owns engine shutdown. The host lazily starts
one persistent generation-bound child (`src/fovea/engine-entry.ts`); status,
settings and descriptor registration do not scan or start the parser.

Explicit calls flow through the existing registry, approval, audit, workspace
and settlement checks. `repo.focusRead` calls ordinary approved `local.readMany`;
`repo.grep` preserves native output separately from transient graph hints.
No new model-facing MCP graph tools or Pi runtime dependencies are introduced.

`src/fovea/core/context.ts` supplies instance-owned algorithm caches and
conversation-owned state. Default and named focuses remain separate; transient
augmentation cannot replace a user's dwell focus. Results are immutable,
bounded and replayable via authenticated cursors, unlike semantic widening.

### Shutdown and generated scratch

Close revokes admission synchronously and shares one sticky completion. Ensure,
restart and reload recheck revocation after waits; callbacks belong to one child
generation. Cancelled queued work releases capacity without dispatch. Shutdown
drains active work and per-root maintenance; selective conversation/epoch
retirement leaves other conversations and reusable graph state intact.

An idle child gets at most 500ms for graceful shutdown **inside** the unchanged
1500ms process-group cleanup budget. Its correlated acknowledgement follows
successful engine cleanup and is flushed before exit; the supervisor still
proves the whole group is gone. Failure/cancellation uses forced cleanup instead.
The existing 250ms cancellation and 5000ms IPC handshake ceilings are unchanged;
IPC startup and lazy parser initialization remain distinct phases.

`src/fovea/scratch-owner.ts` owns exclusively allocated private engine/snapshot
namespaces. Bounded preflight checks ownership, privacy, identity and contents;
disposal uses captured regular-file unlink and **empty** directory removal, never
recursive removal. Git metadata (including files/links), bare repositories,
unknown content, links, changed identities and inspection failures are retained.
Existing engine housekeeping uses the same owner through a host-only context
capability; cache policies and active-file protection remain in place. Missing
cleanup authority cannot fall back to raw asynchronous unlink. These checks are
not a kernel sandbox against hostile same-UID filesystem races.

`repo.status.cleanup` distinguishes graceful/forced/uncertain process cleanup
from scratch removal/retention; `retainedScratchGenerations` counts stopped
generations without acknowledged scratch removal. Current cleanup uncertainty
is reported separately in `cleanup`. A confirmed killed process group is **not** evidence that
its scratch was reclaimed. No abandoned-generation sweeper is added. Explicit
ownership-cleanup failure or uncertain group cleanup stays latched, even if a
later cleanup attempt succeeds; replacement is blocked rather than silently
regranting authority. Primary and cleanup errors remain observable together.

## Authority

Only verified host workspace identities issue leases. Opaque root IDs select
that lease, not arbitrary paths. Leases check device/inode/canonical identity
at dispatch and publication. Detached roots cannot retrieve results or continue
analysis. Graph filters are not source-access boundaries: approved analysis
covers the whole verified root subject to exclusions and explicit coverage.

The native conversation identity is currently MCP-host-local. Kiro session
routing, restoration and compaction association are not qualified and must not
be inferred from cwd, a guest string or a cached directory.

The supervisor transfers remaining durations, bounds IPC frames and queues,
propagates cancellation, reaps child process groups and limits crash recovery.
Graph state stays in the child; strict JSON projection and complete packet
budgets apply before anything crosses to QuickJS.

## Source and evidence

`src/fovea/source-access.ts` enumerates and reads through held directory
file descriptors on Linux, rejecting symlink/hardlink/special-file escapes.
Only eligible bounded source bytes enter a private snapshot. SHA-256 windows
refer to the exact parsed bytes. Stat-only freshness is not trusted. Other
platforms currently fail closed; shipped parser artifacts are not proof that
scope-safe analysis works there.

Parser bytes/version are validated from the admitted generation; no PATH,
package manager or download fallback. Git uses an explicitly verified binary,
sanitized environment and bounded read-only commands. Failed Git coverage is
not a clean-worktree assertion.

Session configuration overlays and adopted-rule trust are owned by explicit
conversation ID **and epoch**, independently of physical-root graph residency.
They survive authorized provider rebinding in that conversation, not a new/cleared
conversation. Persistent project/global profiles remain intentionally shared.
Control retention is capped at 128 conversation epochs and 32 adopted worktrees
per epoch. Capacity rejection releases the attempted lease without evicting a
live conversation. Retained controls never authorize a root.

Rules are separately trusted by exact content hash. Publish declarative rules
through ordinary local writes, then approve `repo.adoptRules`. Rule inspection
alone never trusts project content or grants executable/extra-root authority.

## Observation and delivery

`src/fovea/observations.ts` captures bounded ordered trusted host events,
independent of tracing. Actual successful reads/searches establish
attention; local publication supplies exact before/after mutation identities.
An observer exception marks a gap without changing an already committed effect.
`src/fovea/provenance-journal.ts` shares only bounded validated transitions and
hashed origins per physical worktree; focus/results/permissions remain private.
Own/foreign/mixed/unattributed classification requires an exact baseline-to-current
hash chain. Missing journals/events remain gaps, never fabricated authorship.
Root metadata is a 32-entry LRU with two hot graphs; eviction expires focus and
re-entry establishes a new observation baseline.

The engine preserves the reference synchronization algorithm. Important sync
preparations do not charge notification memory as delivered. A host-private
preparation token can commit that memory only after real delivery evidence.
The outbox distinguishes preparation, emission and uncertainty; nested success
is never acknowledgment. Explicit `repo.sync` currently prepares notices only.

`src/kiro/fovea-context.ts` implements an execution-owned post-settlement
collector and bounded transport ledger. It never parses guest code, holds source
locks, replaces return/error/recovery data, or labels a handler return as delivery.
The shared outbox serializes channel claims, retains notices across clean
reconciliation, and suppresses late advisories on cancellation/revocation.
Transport write completion means emitted, not acknowledged. Foreign-only notices
wait for a prompt; hidden/disabled configuration never becomes visible output.

Only the same-call context (`KIRO_FABRIC_FOVEA_CALL_CONTEXT=1`) is wired to
visible output; there is no post-tool collector or native hook. Authenticated
native rendezvous, model-only output, restoration and queue-safe continuation
remain unfinished. The isolated native CLI probe is authentication-blocked; other
unexercised gates are untested, not proven host limitations. No invented RPC,
idle restart, or Pi UI parity claim. Minimal mode gains no automatic execution.

## Storage and recovery

Mutable configuration and instance snapshots live below the private Fabric data
root, outside immutable generations. `fovea.v1.json` does not alter the older
Fabric config schema. Private result handles expire with ownership/epoch and
engine incarnation. Cache/session metadata is never an authorization grant.

Update adopts host, engine, parser, rules and notices together; old hosts keep
exact generation paths. Config reload restarts only the same-generation engine;
new code requires product update and a new session. Historical schema validation
is explicit, not an allowlist widened to accept arbitrary tools.

The pinned core's exported API remains a Knip entry surface because the isolated
reference driver imports it dynamically and upstream compatibility tests depend
on it. This does not exempt runtime host modules from dead-code lint.
