# State-store WAL design (pre-implementation spec)

Status: sanctioned long-term project, deliberately not started. This document
is the executable specification for the state-store scalability work
originally scoped out by the continuity remediation plan (round-12; archived in Git history). It
exists so a future implementer does not have to rediscover constraints that
the current fault matrix already pins.

## Problem

Every `state.set`/`state.delete` mutation rewrites the entire `state.json`
document under the state flock, and every `state.get`/`state.list` call
reparses it. The continuity conversation archive and rotation journal append
by rewriting their whole documents as well. Cost per operation is
O(document), so cost per task grows with total retained records -- the top
architectural weak spot of the 2026-09 audit round.

## Non-negotiable semantics (historically pinned by tests)

The fault matrix in `tests/state-durability.test.ts`, the state boundary
regressions, and the tamper suites historically pinned these behaviors; those
Vitest files were removed with the test suite and are no longer runnable. Any
WAL must preserve every one of them:

- **CAS revisions** -- `expectedRevision` compare-and-swap per key, and the
  document-level revisions consumed by the rotation journal.
- **Atomic publication** -- tmp-file + rename; a reader never observes a
  partial document.
- **Committed vs acknowledged** -- publication (rename) is *committed*; the
  directory fsync after it is *acknowledged*. A crash between the two must
  surface through recovery exactly as committed-not-acknowledged.
- **Lock protocol** -- flock ownership, stale-lock reclaim with failure
  transparency (a reclaim attempt that itself fails never masks the
  original error).
- **Fail-closed corruption posture** -- detected tamper/corruption refuses
  to rewrite or self-repair; evidence is preserved.
- **Quotas reject, never evict** -- over-quota operations fail; retained
  records are never silently dropped.
- **Ownership, private modes and workspace binding** -- unchanged.
- **Layout compatibility for tests** -- 14 test files (56 references) read
  or write `state.json` directly (tamper injection, rotation fixtures,
  archive fixtures). The snapshot format must stay readable by those
  suites, or they must be migrated in the same change -- never both
  formats half-supported.

## Design: snapshot + forward journal

Keep `state.json` as the canonical compacted snapshot, byte-format
unchanged. Add a sibling forward journal `state.json.wal`:

- **Record** (one JSONL line):
  `{"v":1,"seq":N,"op":"set"|"delete","key":K,"revision":R,"value":V}`
  (`value` omitted for delete). `seq` is a per-file monotone counter; the
  snapshot records the `walSeq` watermark it was compacted through.
- **Mutation under the existing flock**: check CAS against the effective
  current value (snapshot + replayed tail), append the record, fsync the
  journal file = *published*. Then compact per policy, write
  `state.json.tmp`, rename, fsync the directory = *acknowledged*.
- **Compaction policy**: compact when the journal holds >= 32 records or
  >= 64 KiB, or when the caller explicitly requests durability (handoff and
  checkpoint paths). Compaction rewrites the snapshot through the existing
  tmp+rename+dir-fsync path, then recreates the journal empty.
- **Read path**: parse the snapshot, replay journal records with
  `seq > walSeq`. With the default write-through policy the journal is
  always empty after each op, so reads are exactly today's behavior.

### Recovery

Recovery = snapshot + replay. A torn final line (crash during append) is
expected crash evidence, not tamper: replay stops at the last integral
record. Any other integrity failure -- checksum mismatch mid-journal, a
truncated line followed by more data, a `seq` regression -- fails closed,
matching today's posture. The torn-tail/mid-log distinction is a heuristic
convenience only; when in doubt, refuse.

### CAS and concurrency

All checks and appends happen under the same flock, so the CAS read is
race-free by construction. Cross-process writers serialize exactly as
today. Multi-host coordination is an explicit non-goal.

## Rollout

1. **Phase 1 -- opt-in flag** `KIRO_FABRIC_STATE_WAL=1` (environment or
   profile). Default remains snapshot-only; every existing suite runs
   unchanged. New dedicated suites cover: replay after crash, torn tail,
   mid-log corruption (fail closed), CAS across compaction, quota
   interaction, stale-lock reclaim while a journal exists, and the
   committed/acknowledged witnesses replayed through a journal.
2. **Phase 2 -- append-first default** once the full serial suite is green
   in both modes and per-append fsync latency is measured. For tiny stores
   (the common case today) snapshot-only may remain faster; the flag stays
   available so the default flip is reversible.
3. **Phase 3 -- same pattern for the archive and journal documents**
   (`src/continuity/conversation-archive.ts`,
   `src/continuity/rotation-journal.ts`), as a separate migration with its
   own fixture updates.

## Scope estimate and risks

~400-600 lines of source plus 15-20 new tests. Risks, in order:

1. Per-append fsync latency on slow disks -- measure before Phase 2.
2. Interaction with committed/acknowledged witnesses -- the fault matrix
   must be extended, not relaxed, to cover the journal.
3. Test-fixture migration -- the 14-file coupling above; snapshot format
   stability is what keeps this optional rather than forced.

Nothing in this document changes current behavior. Implementation starts
only as its own project with its own round of the full serial suite.
