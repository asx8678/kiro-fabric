# System audit remediation

Scope: eight verified findings in the repository-wide audit. Preserve pre-existing continuity/archive and installer-TUI edits. No installs, remote writes, history rewrites, repository cleanup, or changes to native-client qualification claims. No WAL migration or general architecture rewrite.

## Acceptance ledger

| Finding | Implementation boundary | Required regression / acceptance | Status |
| --- | --- | --- | --- |
| F1 Git write escape | Fovea revision validation and Git argument construction | Option-shaped/invalid bases rejected before diff; verified commit IDs only in ranges; external symlink target unchanged; valid bases work; public impact remains read-only | Verified |
| F2 restore escape | Configuration backup inventory and descriptor-pinned destination effects | Exact bounded inventory; every mkdir/write/link/chmod/rollback anchored to captured parent identity; malformed/escaped/raced restores rejected; exact valid modes/content retained | Verified |
| F5 memory reclaim race | Memory lock acquisition/recovery | Identity-bound exclusive reclaim; deterministic concurrent recovery preserves live successor lock and quota/CAS serialization; retain ambiguous evidence | Verified |
| F4 cancellation | Worker interrupt channel, result classification, retirement | CPU-bound guest sees abort promptly; no success after abort; cancellation backstop and awaited cleanup; capacity recovers; deadline remains distinct | Verified |
| F6 reload recovery | Fovea process lifecycle | Healthy reloads do not consume crash budget; real failures remain bounded; explicit reload recovers budget without masking uncertain cleanup | Verified |
| F7 impact completeness | Git untracked discovery and impact seeding | Nested untracked source files become default seeds; subprocess/output bounds remain enforced | Verified |
| F8 JSON CLI output | Source build subprocess streams | Verbose+JSON cache-miss path emits exactly one JSON stdout result; progress goes to stderr; normal/failure behavior preserved | Verified |
| F3 release isolation | Fresh untracked generation output and native candidate workflow | No tracked output mutation; strict clean-source/exact-byte provenance and generation-local evidence; host native artifacts match target; dirty source still rejected | Verified |

## Sequence and ownership

Main handles F1, F6, F7, F8 and integration. Disjoint workers handle F2, F5, F4 and F3; shared edits and generated-output changes are coordinated centrally. Verify security fixes first, then concurrency/lifecycle fixes, CLI/impact correctness, and release integration.

## Validation

Trace the relevant production call paths before editing. Add focused regressions and direct behavioral probes. Audit test/helper effects; use repository-preserving fixture cleanup and retain Git fixtures. Run targeted serial suites, typecheck, structural patch review and public-registration/configuration checks. Escalate testing where cross-cutting changes justify it. Finish the integrated change with a fresh `pnpm run build`. Do not claim cross-platform CI or live Kiro qualification from local tests.

## Verification results

**Historical:** these counts come from Vitest suites that were later removed with
the deleted test suite; they are not current evidence. Current local commands are
`pnpm run check:local`, `pnpm run verify:references` and
`pnpm run verify:offline baseline|installer`. The former `test:built`
escalation below references a retired dispatcher that now fails closed.

- Final integrated eight-finding suites: 239 passed, 2 platform-skipped.
- Descriptor-pinned restore/helper suites: 149 passed; dependent staging/archive/boundary suites: 81 passed, 2 platform-skipped.
- Source JSON and isolated release suites: 30 passed; real host closure/native output was built outside tracked `dist/` and left shared reachability evidence unchanged.
- TypeScript and script typecheck passed. Structural review reported no blocking findings; independent runtime/concurrency review found no blockers. The first security review's restore TOCTOU/mode findings and shared reachability finding were fixed and regressed rather than accepted as residuals.
- A full serial `test:built` escalation ran for the configured 20-minute external bound without a reported test failure, but timed out before suite completion; it is not counted as a full-suite pass. (Historical: `pnpm run test:built` is now a retirement dispatcher under `scripts/qualification-unavailable.mjs` and exits nonzero.)
- A fresh production build completed immediately before handoff.

Residual qualification limits: Linux/macOS-x64 candidate jobs and live authenticated Kiro CLI qualification were not executed locally. Abandoned memory recovery claims deliberately require operator intervention; pre-fix binaries do not participate in the new claim protocol.
