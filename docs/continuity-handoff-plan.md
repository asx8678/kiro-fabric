# Explicit handoff and managed-rotation foundation

Status: implemented for review. This is a staged, opt-in foundation, not a replacement for Kiro's compactor.

The subsequent code review found correctness, durability and resource-bound gaps; all nine findings (R1–R9) are implemented with regressions that fail on the prior behavior. The remediation handoff plan (archived in Git history) carries the implementation record, verification evidence and the remaining live/platform gates.

## Scope

1. Keep native compaction unchanged. Expose an explicit, bounded `continuity.handoff` packet for a selected durable task, with revision/hash/workspace binding and a copy/paste fresh-session prompt. It does not create a session or replay work.
2. Add a no-inference ACP preflight and a bounded injectable capability probe. Distinguish synthetic transport evidence from the installed Kiro build. Request the v3 engine explicitly: ACP defaults may select v2.
3. Add a private, bounded original-event archive and rotation journal. Persistence is logically append-only through a CAS-protected API; atomic document replacement is not physical WORM storage. No automatic conversation recording, eviction, or shared global daemon.
4. Test repeated transitions, restart recovery and separate logical conversations offline. Durable intent must precede submission; an interrupted acknowledgement blocks replay.
5. Keep automatic managed rotation unavailable until exact-client qualification passes. No installer flag, native settings rewrite, or implicit fallback may bypass the gates.

## Acceptance ledger

| Gate | Required evidence |
| --- | --- |
| Handoff | Checked direct/dynamic API calls; read approval; disabled/unbound rejection; exact source revision/hash; protected objective/constraints/checks; bounded UTF-8 and serialized envelope; fresh-runtime explicit recovery. |
| ACP | Distinct new sessions; actual agent/mode evidence; exact continuation submission; correlated permission denial and terminal cancellation; bounded timeout/output; no automatic replay. |
| Archive | Stable ordered original events; hash chain; idempotent append; CAS conflicts; identity isolation; quota/corruption rejection without dropping earlier records. |
| Journal | Persist intent and submission identity before effects; reject stale epochs/physical IDs; restart during ambiguous submission blocks; repeated transitions derive from originals. |
| Native release | Exact Kiro build/engine/agent, real repeated rotations, crash recovery, concurrent conversations, Fabric/Fovea transport binding and permission behavior. Synthetic passes are not native qualification. |

## Boundaries

Native compaction remains under Kiro's ownership. This work does not disable it, intercept `/compact`, rewrite native session files, or install/update an agent profile. Strict deterministic managed rotation additionally requires witnessed native auto-compaction suppression, or a supported alternative enforcement contract; a saved setting is not that evidence.

A packet is historical data, not executable tool history or proof that the filesystem is unchanged. The receiving session must explicitly verify its workspace, read the selected task and revalidate relevant sources before effects. A task checkpoint is not a full conversation archive. Conversation-only and uncheckpointed information remains outside continuity coverage.

Raw archive inputs can be sensitive. Only explicitly admitted host records belong in the private archive; user-selected IDs are not authorization tokens. The prototype does not claim protection from an authorized same-user shell. Fovea authorization leases and source-derived caches must not be blindly carried into another physical session.

Live authenticated qualification requires a separately authorized, enforced inference budget and private fixtures. No such inference is part of this first implementation pass. Build/test success alone cannot enable managed rotation.
