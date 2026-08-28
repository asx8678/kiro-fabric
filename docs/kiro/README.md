# Kiro integration records

This directory preserves the planning and implementation evidence from the Kiro
integration workspaces.

## Which document is authoritative?

| Document | Role | Status |
|---|---|---|
| [capabilities-2.20.1-v3.md](capabilities-2.20.1-v3.md) | Current Kiro 2.20.1/v3 contract, feature review, migration decisions, and efficient-use guidance | Authenticated non-billable gates passed; model-turn gate pending |
| [baseline.md](baseline.md) | Implementation notebook, verification results, and PR-by-PR notes | Best record of work actually completed |
| [capabilities-2.19.1.md](capabilities-2.19.1.md) | Results of the Kiro 2.19.1 capability spike and resulting fail-closed decisions | Implemented evidence |
| [installer.md](installer.md) | Install, doctor, and uninstall behavior | Current v3 user documentation |
| [release-a.md](release-a.md) | Packed and real non-billable Release-A certification | Historical v2 gate |
| [release-b.md](release-b.md) | Explicitly billable, double-opt-in real multi-turn/resume certification | Release-B gate; not run by default |
| [adr-durability-residency.md](adr-durability-residency.md) | Single-owner supervisor decision, fencing, migration, and rollback requirements | Accepted prerequisite for Release C |
| [release-c.md](release-c.md) | Crash, mailbox-idempotency, durable-resume, and rollback rehearsals | Current non-billable Release-C gate |
| [implementation-plan.md](implementation-plan.md) | Validated phase/release plan that refined the original architecture | Planning record; unchecked work is not proof of completion |
| [architecture-plan.md](architecture-plan.md) | Original architecture, contracts, phase descriptions, risks, and decision log template | Historical vision; superseded where the validated plan or implementation evidence differs |

Use the implementation and verification records to determine current behavior.
The plans explain intent and preserve deferred steps, but some proposed names,
PR boundaries, daemon choices, and version assumptions changed during delivery.

## Imported source inventory

The two code worktrees below contained the same relevant working files when this
record was imported:

- `/Users/adam2/projects/kirofabric/kiro-fabric`
- `/Users/adam2/projects/kiro-fabric`

Their Kiro-specific source, tests, scripts, and four implementation documents
were already present in this workspace. The only non-transient planning records
that existed outside those worktrees were copied as follows:

- `/Users/adam2/projects/kirofabric/plan(20260824-075704).md` →
  `architecture-plan.md`
- `/Users/adam2/projects/kirofabric/kiro-cli-implementation-plan.md` →
  `implementation-plan.md`

The copies are byte-for-byte snapshots. They intentionally retain original path
references and unchecked task lists for provenance.

Transient `.pi` state, `.DS_Store`, Git metadata, dependencies, and build output
were not imported as project documentation.
