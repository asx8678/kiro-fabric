# Release C certification

> Historical v2 durability evidence. The v3 session migration boundary is
> documented in [capabilities-2.20.1-v3.md](capabilities-2.20.1-v3.md).

Release C is the durability and residency gate for the per-project supervisor /
single-owner design: crash-safe ownership, no duplicate mailbox delivery,
durable Kiro actor resume through ACP `session/load`, and fail-closed rollback /
downgrade rejection without mutating newer persisted state.

It is the documentation gate for the accepted ADR in
`docs/kiro/adr-durability-residency.md`. Release C covers the ADR rollout-gate
claims that must be proven before durability code ships:

- exactly one durable owner remains after crash / restart
- no duplicate mailbox delivery occurs
- Kiro actor resume works through ACP `session/load`
- incompatible old/new persisted state combinations fail closed without mutation
- rollback rehearsal succeeds

## Supported tuple

- Node `>=24`
- `kiro-cli 2.19.1`
- `--agent-engine v2`
- Non-billable fixtures / rehearsals only

## Rehearsal protocol

Every Release-C gate reruns the same four rehearsals.

1. **Crash / restart single owner**
   - Proves one durable owner survives a crash/restart boundary.
   - Exercises the single-owner supervisor claim from the ADR.
2. **No duplicate mailbox delivery**
   - Proves claimed mailbox work is not replayed as a duplicate effect.
   - Covers the delivery fencing / idempotency requirements.
3. **Durable Kiro resume via ACP `session/load`**
   - Proves a durable Kiro actor keeps its persisted `runnerSessionId` and
     resumes through `session/load`, not `session/new`.
4. **Rollback / downgrade rejection without mutation**
   - Proves newer persisted residency state is rejected fail-closed by an older
     reader and that incompatible reads do not rewrite bytes on disk.

## Gate commands

The aggregate gate is explicit opt-in but remains non-billable and uses only the
fake Kiro ACP fixture in throwaway directories:

```bash
REHEARSER_REAL=1 pnpm rehearse:release-c
```

Without `REHEARSER_REAL=1`, it exits nonzero before starting any rehearsal. It
also refuses to run when `KIRO_PHASE0_BILLABLE=1` is set.

Run individual rehearsals during development:

```bash
pnpm exec vitest run tests/reliability-crash-single-owner.test.ts
pnpm exec vitest run tests/reliability-no-duplicate-mailbox.test.ts
pnpm exec vitest run tests/reliability-session-resume.test.ts
pnpm exec vitest run tests/reliability-rollback.test.ts
```

## ADR exit-criteria mapping

| Rehearsal | ADR exit criteria satisfied |
|---|---|
| `tests/reliability-crash-single-owner.test.ts` | 1. exactly one durable owner remains after crash / restart |
| `tests/reliability-no-duplicate-mailbox.test.ts` | 2. no duplicate mailbox delivery occurs |
| `tests/reliability-session-resume.test.ts` | 3. Kiro actor resume works through ACP `session/load` |
| `tests/reliability-rollback.test.ts` | 5. old/new incompatible supervisor, client, and state combinations fail closed without mutation; 6. rollback rehearsal succeeds |
| `scripts/rehearse-release-crash.mjs` / `pnpm rehearse:release-c` | Aggregates all four non-billable rehearsal gates |

## Release-C scope

Release C does **not** relax existing fail-closed behavior. Approval denial,
cancellation hardening, usage-unavailable handling, and non-billable-only gate
behavior remain unchanged. The point of this gate is to prove durability and
residency safety on the supported tuple before broader rollout.
