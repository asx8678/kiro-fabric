# ADR: Durability owner and Kiro residency

- Status: Accepted
- Date: 2026-08-24
- Rationale: Release B already landed a session-resident Kiro ACP worker (`src/kiro/acp-worker.ts`). To avoid violating implementation-plan decision 5 (`docs/kiro/implementation-plan.md`) we must keep exactly one durable owner and make the new worker subordinate to it, not a second owner.

## 1. Context / problem

Fabric already has one durable ownership path: the per-project resident host in `src/residency/host.ts`, with on-disk ownership and command records defined in `src/residency/protocol.ts`. That host already owns:

- durable agent and actor lifecycle
- mailbox-style delivery and completion fan-out
- per-project locks / ownership files (`owner.json`, `host.lock`)
- restart recovery for interrupted requests
- integration with `AgentManager` (`src/agents/manager.ts`)

At the same time, the Kiro path now has a session-resident worker loop in `src/kiro/acp-worker.ts`:

- one ACP process
- one `session/new` or `session/load`
- bounded resident next-turn handling through `steer.jsonl`
- self-settle on idle
- explicit indeterminate handling on cancel / stop

This creates competing durable-owner pressure:

1. the existing resident host (`src/residency/host.ts`)
2. the historical global `fabricd` vision in `docs/kiro/architecture-plan.md`
3. any attempt to treat the new session-resident Kiro worker as durable ownership

`docs/kiro/implementation-plan.md` section 1, decision 5, is explicit: a second durable owner cannot be introduced safely. `docs/kiro/baseline.md` also records that the resident host already owns durable agents/actors, locks, recovery, and queued delivery. Therefore Phase 6 must choose one owner and make every other process subordinate.

## 2. Decision

We will **generalize and rename the existing per-project resident host into a host-neutral per-project supervisor**. We will **not** introduce a separate global `fabricd` daemon for Release C.

Decision details:

- The durable owner is a **single per-project supervisor** derived from `src/residency/host.ts`.
- The supervisor remains keyed by the canonical project root / root identity, not by user session.
- Kiro next-turn residency stays **out-of-process in the current ACP worker shape** (`src/kiro/acp-worker.ts`); it is **not** the durable owner.
- The worker is a leased child process owned by the supervisor, exactly like other agent workers launched through `AgentManager` (`src/agents/manager.ts`).
- The historical `fabricd` design in `docs/kiro/architecture-plan.md` is superseded here where it conflicts: if a future global daemon is ever desired, it must be a later replacement of the supervisor, not an additional owner.

Why this option:

- It reuses the ownership model already shipped in `src/residency/host.ts` instead of creating a second one.
- It matches the current Kiro install/runtime shape, which is already project-bound (`src/kiro/install.ts`, `src/kiro/managed.ts`).
- It matches the current Kiro worker shape, which is session-resident but self-settling, not a long-lived system daemon (`src/kiro/acp-worker.ts`).
- It avoids cross-project trust, auth, and routing complexity that a global daemon would add before Release C gates are met.

## 3. Consequences

### What stays in the Kiro worker

The Kiro ACP worker remains responsible for:

- ACP process spawn and teardown
- ACP capability negotiation
- `session/new` / `session/load`
- turn streaming and normalization
- bounded resident next-turn queue handling
- tool-permission fail-closed behavior
- per-run transcript / audit files
- self-settle after bounded idle

### What moves to / stays with the supervisor

The supervisor owns:

- the only durable claim on a project
- durable actor and background-agent records
- run adoption after crash / restart
- mailbox queues and delivery cursors
- host-session leases and heartbeats
- approval records and decision isolation
- trust derivation from canonical project state
- process inventory and child fencing
- restart recovery and indeterminate marking

### What commits durably

The supervisor, not the worker, durably commits:

- ownership epoch / fencing token
- actor metadata, including runner kind and `runnerSessionId`
- queued mailbox items and delivery ACK state
- host-session lease state
- approval records and final decisions
- execution state transitions (`accepted`, `running`, `completed`, `failed`, `stopped`, `timed_out`, `indeterminate`)

The worker may append logs and status snapshots, but those are subordinate artifacts until the supervisor commits the durable state transition.

## 4. Versioning / state

Version policy:

- Fabric config continues on the implementation-plan path: runner support is gated through **config v4**, not a new config v2 (`docs/kiro/implementation-plan.md`).
- The existing resident-host format in `src/residency/protocol.ts` (`RESIDENT_HOST_FORMAT = 1`) becomes the **legacy read path**.
- The generalized supervisor introduces a new persisted **supervisor state format v2**.
- The supervisor transport protocol is versioned separately with **major/minor negotiation**.

Migration policy:

- A v2 supervisor may read v1 residency state and migrate it atomically per project.
- Migration occurs only after exclusive ownership is fenced.
- Migration writes a new format marker before any new mutable work is accepted.
- If migration cannot complete, startup fails closed and leaves prior state untouched.

Downgrade policy:

- Older binaries must reject newer persisted state without mutation.
- No downgrade path may guess, coerce, or partially reinterpret newer state.
- Rollback uses drain-and-stop, binary replacement, then explicit state compatibility check.
- `src/kiro/managed.ts` manifest/version rules remain independent and unchanged unless their own format is bumped.

## 5. Ownership and fencing

There is exactly one durable owner per project.

Rules:

- Ownership is established by an atomic claim with an epoch token; PID alone is not sufficient.
- Every child worker, approval, mailbox delivery, and actor mutation is tagged with the current owner epoch.
- On restart, a new supervisor instance must either prove the prior owner is dead or refuse takeover.
- Any stale worker response from an earlier epoch is discarded.

Delivery / effect fencing:

- Mailbox items get stable delivery IDs.
- Supervisor claims a delivery before dispatch.
- The durable record distinguishes:
  - queued
  - claimed
  - effect-started
  - effect-acked
  - indeterminate
- Crash before claim: item remains queued.
- Crash after claim but before effect-started commit: item is reclaimable.
- Crash after effect-started but before effect-acked: item becomes indeterminate and is never replayed automatically.
- Crash after effect-acked: item is not redelivered.

Crash-injection must cover at least:

- before claim write
- after claim write
- before ACP/session effect
- after ACP/session effect but before durable ACK

Trust:

- Trust is server-derived from canonical project root and local trust policy.
- Never accept a client-pushed `trusted: true` bit.
- Session identity, trust, and canonical root are assigned by the supervisor.

## 6. Process / transport

The generalized supervisor exposes a local IPC transport with these requirements:

- bounded framed messages
- strict schemas
- `hello` handshake with major/minor version ranges
- feature negotiation
- server-issued client/session identity
- stable error codes
- explicit `drain` / `stop`
- process-group reaping
- Unix sockets on macOS/Linux and named pipes on Windows

The worker transport remains subordinate:

- supervisor ↔ worker may continue to use file/status/steer artifacts where already present
- any new control channel must still be bounded and versioned
- stdout/stderr from child processes are never treated as trusted protocol unless explicitly framed

Cancellation / stop rules:

- supervisor stop first drains or marks indeterminate
- worker cancellation kills the ACP process group
- orphaned children are reaped by the owning supervisor epoch

## 7. Queued delivery and leases

Kiro Main has no reliable shutdown hook on the validated tuple (`docs/kiro/capabilities-2.19.1.md`), so queued delivery must be lease-based.

Decision:

- Kiro Main sessions register a lease with heartbeat.
- Lease expiry, not client self-report, determines liveness loss.
- If no live lease exists, Main-bound deliveries remain queued.
- Hook delivery is opportunistic only; it is never the source of truth.

Delivery idempotency:

- Deliveries are scoped by **clientId + payload hash + target session/actor**.
- Redelivery to the same client lease must not duplicate mailbox effects.
- Reconnect with a new lease may resume from the last ACK cursor only.

Kiro resident turns:

- The session-resident worker may keep one ACP session warm for bounded next-turn work.
- Lease expiry or supervisor stop ends that residency.
- The worker is not permitted to outlive supervisor ownership.

## 8. Approval isolation

Approvals are isolated per supervisor-issued session.

Rules:

- every approval record is bound to one session identity and one execution
- approvals expire automatically
- session end cancels unresolved approvals
- late approval decisions after cancel / expiry are ignored
- decisions are idempotent and race-tested
- approval scope cannot bleed across sessions, including two Kiro Main sessions for the same project

Current Kiro constraint:

- On Kiro 2.19.1, MCP elicitation is absent (`docs/kiro/capabilities-2.19.1.md`), so approval-requiring actions remain fail-closed for Kiro Main.
- The isolation model still matters for Pi, CLI, future Kiro versions, and durable records.

## 9. Rollout gate

**No Release C durability code ships until all of the following pass:**

1. exactly one durable owner remains after crash / restart
2. no duplicate mailbox delivery occurs
3. Kiro actor resume works through ACP `session/load`
4. Pi residency migration / coexistence passes
5. old/new incompatible supervisor, client, and state combinations fail closed without mutation
6. rollback rehearsal succeeds
7. stale-epoch worker responses are discarded
8. queued Main delivery survives lease expiry and reconnect
9. trust is derived server-side only
10. crash-injection passes before/after claim and before/after effect

This is the explicit exit gate required before any Release C merge.

## 10. Open questions / deferred

Deferred, not blockers to this ADR:

- exact rename and file layout for `src/residency/*` when generalized into supervisor modules
- whether supervisor IPC to foreground clients should replace the existing request/response file queues immediately or in a second step
- whether Pi and Kiro should share one identical delivery record format from day one or migrate in two stages
- whether future Kiro versions restore safe approval elicitation, allowing Kiro Main approvals beyond fail-closed denial
- whether a later global daemon is still desirable after per-project supervisor hardening

Biggest open question:

- **Do we preserve the current file-queue control plane for the first supervisor cut, or introduce the socket/pipe protocol at the same time?** The ADR decides ownership now; transport cutover can remain staged as long as it preserves single-owner fencing and fail-closed compatibility.
