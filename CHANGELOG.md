# Changelog

## 0.63.0 — 2026-08-24

### Release A — install/doctor/uninstall MVP + MCP adapter

Shipped Kiro lifecycle and adapter foundations across `src/kiro/mcp-entry.ts`, `src/kiro/runtime.ts`, `src/kiro/host.ts`, `src/kiro/profile.ts`, `src/kiro/projection.ts`, `src/kiro/install.ts`, `src/kiro/doctor.ts`, `src/kiro/uninstall.ts`, `src/kiro/managed.ts`, and `src/kiro/cli.ts`.

- Added the packed MCP entrypoint and fail-closed Kiro host/runtime for the single exposed tool `fabric_exec`.
- Added project-scoped install, non-billable doctor, and hash-owned uninstall flows.
- Documented the lifecycle in `docs/kiro/installer.md` and the packed/real certification gate in `docs/kiro/release-a.md`.
- Fake/full verification record: `docs/kiro/baseline.md`, `tests/kiro-mcp-adapter.test.ts`, `tests/kiro-installer.test.ts`, `tests/kiro-doctor.test.ts`, `tests/kiro-uninstaller.test.ts`.
- Certification commands:
  - `pnpm certify:release-a`
  - `KIRO_FABRIC_RELEASE_A_REAL=1 pnpm certify:release-a:real`

### Release B — session-resident Kiro worker + real multi-turn cert gate

Shipped the resident ACP worker path in `src/kiro/acp-worker.ts`, `src/kiro/acp-process.ts`, `src/kiro/run-profile.ts`, `src/kiro/run-scope.ts`, and `src/kiro/home.ts`, with the bounded JSON-RPC/process supervisor in `src/kiro/supervisor.ts`.

- Kept one ACP process and one Kiro session resident across bounded follow-up turns.
- Resumed persisted sessions through `session/load` on the Kiro path.
- Preserved fail-closed approval, usage-unavailable, and no-`--trust-all-tools` constraints.
- Defined the real certification gate in `docs/kiro/release-b.md` and `scripts/certify-release-b-real.mjs`.
- Fake/full verification record: `docs/kiro/baseline.md`, `tests/kiro-worker.test.ts`.
- Certification command:
  - `KIRO_FABRIC_RELEASE_B_REAL=1 KIRO_FABRIC_RELEASE_B_BILLABLE_ALLOWED=1 pnpm certify:release-b:real`

### Release C — durability: supervisor v2 state epoch fencing, crash/rollback rehearsal

Shipped durability and residency hardening across `src/residency/host.ts`, `src/residency/client.ts`, `src/residency/protocol.ts`, `src/components/supervisor.ts`, and the acceptance ADR `docs/kiro/adr-durability-residency.md`.

- Added supervisor/residency epoch fencing and stale-owner rejection.
- Preserved durable Kiro actor resume and mailbox deduplication semantics.
- Added rollback/downgrade fail-closed handling without mutating newer persisted state.
- Captured the rehearsal gate in `docs/kiro/release-c.md` and `scripts/rehearse-release-crash.mjs`.
- Fake/full verification record: `docs/kiro/baseline.md`, `tests/reliability-crash-single-owner.test.ts`, `tests/reliability-no-duplicate-mailbox.test.ts`, `tests/reliability-session-resume.test.ts`, `tests/reliability-rollback.test.ts`.
- Rehearsal commands:
  - `REHEARSER_REAL=1 pnpm rehearse:release-c`
  - `pnpm exec vitest run tests/reliability-crash-single-owner.test.ts`
  - `pnpm exec vitest run tests/reliability-no-duplicate-mailbox.test.ts`
  - `pnpm exec vitest run tests/reliability-session-resume.test.ts`
  - `pnpm exec vitest run tests/reliability-rollback.test.ts`

### Release D — parity: semantic handoff, prewalk evidence, memory, topology, qualification diagnostics, release-d gate

Shipped Kiro parity surfaces in `src/kiro/handoff.ts`, `src/kiro/prewalk.ts`, `src/kiro/memory.ts`, `src/kiro/topology.ts`, `src/kiro/diagnostics.ts`, with qualification docs in `docs/kiro/parity-qualification.md` and gate docs/scripts in `docs/kiro/release-d.md` and `scripts/certify-release-d-real.mjs`.

- Qualified semantic handoff at fidelity `semantic`, never native transcript fidelity.
- Persisted bounded prewalk evidence and surfaced qualification diagnostics.
- Added namespace-confined Kiro memory and topology publication without private-session reads.
- Kept unsupported parity explicitly unavailable.
- Fake/full verification record: `docs/kiro/baseline.md`, `tests/kiro-release-d.test.ts`, `tests/fixtures/kiro/fake-kiro-worker.mjs`.
- Certification command:
  - `KIRO_FABRIC_RELEASE_D_REAL=1 pnpm certify:release-d:real`
