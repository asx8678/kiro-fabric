# Kiro release status

> Historical v2 status snapshot. The current supported tuple and open v3
> qualification gates are tracked in
> [capabilities-2.20.1-v3.md](capabilities-2.20.1-v3.md).

This was the single source of truth for the v2 release. `shipped` means code is in-repo and verification is the fake/non-billable test coverage plus full repository check history already recorded in the release docs and `docs/kiro/baseline.md`. Real-gate results below were observed on 2026-08-24 with `kiro-cli 2.19.1`, Node `v24.19.0`, and pnpm `11.20.0`.

| Release | Scope | Code status | Verification status | Real gate status | Primary shipped files | Real gate command |
|---|---|---|---|---|---|---|
| A | installing/doctor/uninstall MVP + MCP adapter | shipped | fake-tests + full check | passed: doctor 11/11, zero model turns | `src/kiro/mcp-entry.ts`, `src/kiro/runtime.ts`, `src/kiro/host.ts`, `src/kiro/profile.ts`, `src/kiro/projection.ts`, `src/kiro/install.ts`, `src/kiro/doctor.ts`, `src/kiro/uninstall.ts`, `src/kiro/managed.ts`, `src/kiro/cli.ts`, `docs/kiro/installer.md`, `docs/kiro/release-a.md` | `KIRO_FABRIC_RELEASE_A_REAL=1 pnpm certify:release-a:real` |
| B | session-resident Kiro worker + real multi-turn cert gate | shipped | fake-tests + full check | passed: same-process second prompt + process-restart `session/load` with retained isolated `KIRO_HOME` | `src/kiro/acp-worker.ts`, `src/kiro/acp-process.ts`, `src/kiro/run-profile.ts`, `src/kiro/run-scope.ts`, `src/kiro/home.ts`, `src/kiro/supervisor.ts`, `docs/kiro/release-b.md`, `scripts/certify-release-b-real.mjs` | `KIRO_FABRIC_RELEASE_B_REAL=1 KIRO_FABRIC_RELEASE_B_BILLABLE_ALLOWED=1 pnpm certify:release-b:real` |
| C | durability: supervisor v2 state epoch fencing, crash/rollback rehearsal | shipped | fake-tests + full check | passed: all four non-billable rehearsal checks | `src/residency/host.ts`, `src/residency/client.ts`, `src/residency/protocol.ts`, `src/components/supervisor.ts`, `docs/kiro/adr-durability-residency.md`, `docs/kiro/release-c.md`, `scripts/rehearse-release-crash.mjs` | `REHEARSER_REAL=1 pnpm rehearse:release-c` |
| D | parity: semantic handoff, explicit prewalk unavailability, memory, topology, qualification diagnostics, release-d gate | shipped | fake-tests + full check | passed: non-billable packed parity probe | `src/kiro/handoff.ts`, `src/kiro/prewalk.ts`, `src/kiro/memory.ts`, `src/kiro/topology.ts`, `src/kiro/diagnostics.ts`, `docs/kiro/parity-qualification.md`, `docs/kiro/release-d.md`, `scripts/certify-release-d-real.mjs` | `KIRO_FABRIC_RELEASE_D_REAL=1 pnpm certify:release-d:real` |

## Verification source pointers

- Release A: `docs/kiro/release-a.md`, `tests/kiro-mcp-adapter.test.ts`, `tests/kiro-installer.test.ts`, `tests/kiro-doctor.test.ts`, `tests/kiro-uninstaller.test.ts`
- Release B: `docs/kiro/release-b.md`, `tests/kiro-worker.test.ts`, `scripts/spike-kiro.mjs`
- Release C: `docs/kiro/release-c.md`, `tests/reliability-crash-single-owner.test.ts`, `tests/reliability-no-duplicate-mailbox.test.ts`, `tests/reliability-session-resume.test.ts`, `tests/reliability-rollback.test.ts`
- Release D: `docs/kiro/release-d.md`, `docs/kiro/parity-qualification.md`, `tests/kiro-release-d.test.ts`

## Dependency bump advisory

- Pi packages are currently pinned to `0.84.2` while upstream `pi-fabric` is on `0.84.3`; any bump to `0.84.3` should be deliberate, not automatic.
- Before taking that bump, import the upstream actor host-event `session_compact_failed` handling fix (`ff1578f`) and its test (`4a9ccae`).
- Also import the upstream capture `ExtensionRunner` identity fix (`5bbfbe7`).
- If a config written by a newer build is loaded, Kiro now accepts it forward-compatibly, matching upstream `24a8846`.
