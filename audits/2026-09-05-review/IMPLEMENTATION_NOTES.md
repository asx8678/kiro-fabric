# Recommended follow-up implementation

## Scope and outcome

Implemented narrow fixes; no database, VM replacement, new infrastructure, public storage migration or weakened qualification gate. Pre-existing dirty work was preserved: all original files outside the named implementation scope match the 193-file baseline. Shared user-dirty files were edited with exact anchors. Generated `dist/` was deliberately rebuilt as required. No staging, commits, publication, live authentication or user-home installation occurred.

The user also requested validation of Sol's output. Project participant discovery found no active participant named Sol, and no separate branch/files were supplied. These results cover this checkout's implementation, not unseen work elsewhere.

## Acceptance ledger

| Check | Result / evidence |
|---|---|
| State/artifact operation-owned cleanup | Passed synthetic write, permissions, sync and post-close fault tests; old state and unrelated artifacts preserved; failed new artifact does not enter quota accounting. `tests/storage-failure.test.ts`. |
| State commit outcomes | Permissions/file sync precede rename; post-commit cancellation and lock cleanup report the committed revision; pre-commit cancellation/rename failures preserve old data; read/CAS reconciliation tested. |
| Transient lock recovery | Same provider retains inode/device cleanup responsibility and retries before acquisition; subsequent write succeeds once the fault clears. Existing lock-replacement tests exercise identity-preserving cleanup. No automatic removal of another process's lock. |
| Independent compiler ownership | Service-owned bounded pools; active/idle handles tracked; at most one warm idle compiler; timeout/error/use-cap retirement; actual reused-worker isolation plus controlled delayed-termination tests. `tests/compiler-ownership.test.ts`, `tests/compiler-isolation.test.ts`. |
| Execution admission and shutdown | `executor.maxConcurrentExecutions` defaults to 4, normalized 1–64; immediate rejection, no queue. Slot spans compiler/guest/approval lifetime. Service close cancels/drains admitted execution results before registry teardown. Real guest success/cancel/timeout/provider-error/approval-error/close paths tested. `tests/execution-admission.test.ts`, `tests/configuration.test.ts`. |
| MCP pagination | Actual in-memory SDK client/server verifies second-page discovery/describe/call, empty cursor and filtering; cursor cycles/size, page count, cumulative tools/JSON, cancellation and shared monotonic budget tested. Existing federation suite covers approval and lease/cancellation behavior. `tests/mcp-pagination.test.ts`, `tests/mcp-federation.test.ts`. |
| Routine trace errors | Closed `approval_failed`/`provider_failed` categories replace arbitrary exception strings. Benign marker remains in execution failure responses but not routine traces. Low-level custom tracer events are explicitly not advertised as a secret sanitizer. `tests/tracing.test.ts`. |
| Qualified-byte promotion | Workflow validates the qualified archive/SBOM against the fresh stage/closure and exact qualification. `--assets` writes the captured validated snapshots, not a recompression or second input-path read. Actual package archive/SBOM validation, alternate compression, stage/SBOM mismatches and snapshot writes are tested. `tests/release-artifacts.test.ts`, `tests/release-evidence.test.ts`. |
| Product workflow comparison | Plan complete in `PRODUCT_VALIDATION.md`; authenticated execution BLOCKED because no `kiro-cli` was found on PATH. No client path or isolated authentication supplied. Existing exact-final-commit gate remains mandatory. |
| Repository integration | All new script/test inventory entries in `docs/audit.md`; compatibility aliases preserved; configuration/public built imports validated. Full `pnpm run check` passed 276 tests/29 files, typecheck, build, dead-code lint, staging, hermetic MCP certification and SBOM. |
| Built behavior | `implementation-runtime-probe.mjs` imports `dist/index.js` and asserts public admission config, warm compiler isolation, guest state effects, reopen persistence and CAS extension. Passed. |
| Final build | Fresh `pnpm run build` handoff result is recorded in `evidence/implementation-final-build.json`; source-build assertions and closure generation are included. |

## Validation chronology

1. Initial typecheck found a numeric deadline passed to the object-shaped settlement helper. Corrected to signal checking plus the provider's monotonic remaining-budget method.
2. Initial targeted validation: typecheck + 77 tests in seven files passed.
3. First full check: 257 tests passed, one failed because new test files were missing from `docs/audit.md`. Inventory corrected; no test weakened. Log: `evidence/implementation-check.log`.
4. Independent read-only reviewer identified guest-shutdown settlement and retained lock-cleanup ownership gaps. Both were addressed; lifecycle and release artifact integration coverage was expanded. Compiler worker tests now include delayed termination, real reuse and use-cap/error retirement.
5. Expanded targeted run: 74 passed, one failed only because the expected JSON-budget error regex omitted the actual `bounded JSON contract` wording. Replaced with the precise contract string; the cumulative-budget behavior had rejected correctly.
6. Final full `pnpm run check`: **276 tests, 29 files, all passed**. Typecheck, build, lint, hermetic certification and SBOM all passed. Log: `evidence/implementation-check-final.log`. Certification is `component-mcp-only`, not authenticated Kiro evidence.
7. Direct built-library probe passed: `evidence/implementation-runtime-probe.json` (recipe alongside it).
8. Baseline preservation check passed: `evidence/implementation-preservation.json`; original files outside the implementation allowlist are byte-for-byte unchanged. `git diff --check` passed.

Commands used from repository root: `pnpm run typecheck`; targeted `pnpm exec vitest run <named files above>`; `pnpm run check` (300s budget); `node audits/2026-09-05-review/evidence/implementation-runtime-probe.mjs` (30s); `python3 audits/2026-09-05-review/evidence/implementation-preservation.py` (15s); final `pnpm run build` (120s). No dependency updates/install command or external advisory scan was needed during implementation.

## Boundaries and unresolved work

- Authenticated real-client/PTY/compaction/resume validation and native-MCP-only product comparison were not run. No release-ready assertion on this dirty working tree; final clean-commit qualification remains required.
- CI promotion's validation and snapshot-writing functions are exercised locally with real generated archives; the hosted GitHub workflow/publication was not executed.
- Admission is per service, not a process-wide cap across arbitrary numbers of services. Embedders must bound service creation. Limits are safety ceilings, not benchmark-derived capacity claims.
- Execution settlement does not prove arbitrary downstream side effects ceased after cancellation. Existing server lease/quiescence behavior remains in place.
- Filesystem failures are synthetic. The close-failure fixture closes the descriptor before throwing; it is not an OS-level proof for every kernel close-error behavior. Failed cleanup on an unavailable filesystem remains an explicit error. Atomic rename/file sync are not a promise of power-loss or network-filesystem durability.
- No complete security audit, comprehensive secret scan or platform-wide benchmark was performed. Original audit evidence remains historical and is not rewritten as post-fix proof.
