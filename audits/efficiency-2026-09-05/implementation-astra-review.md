# Independent Astra implementation review — 2026-09-05

## Verdict: BLOCKING fixes required

Verified repository top-level `/home/adam/projects/kiro-fabric` and HEAD `d33cbdca33fac6ce301a6da884f06ee5141534da`. This reviews the **uncommitted implementation against that HEAD**, not a purported implementation commit. Read `AGENTS.md`, `implementation-ledger.md`, actual production/test diffs and relevant unchanged call paths. Did not read the whole original audit. No production edits, installs, global configuration, commits, delegation, model calls, builds or staging by this reviewer. Review artifacts alone were written. Parent-generated `dist/` changes appeared during its check; they are not reviewer edits or independent source evidence.

### Evidence actually obtained

- Independently ran `pnpm exec vitest run --no-cache tests/memory-recovery.test.ts tests/approval-projection.test.ts tests/info-catalog.test.ts tests/trace-analyze.test.ts tests/execution-admission.test.ts tests/workspace-binding.test.ts`: **6 files, 49 tests passed**, exit 0. See `review-source-tests.log`.
- Independently evaluated actual source in memory, using TypeScript `transpileModule` only in memory, mocked SDK/filesystem/binding dependencies, and synthetic trace records. No emitted build artifacts, real transport, model/provider calls or adversarial exploitation. Reproducible program: `review-unit-program.log`; results: `review-unit-results.log`, exit 0. This verifies local branches, not SDK wire behavior or real platform filesystem support.
- Separate actual projection-unit assertion: `review-ack-projection.log`.
- Read parent's `implementation-check.log`: typecheck, fresh build and staging completed; **292 passed / 1 failed**, missing audit inventory entry for `tests/memory-recovery.test.ts`. Check stopped before later chained dead-code/certification/SBOM steps; do not report the entire check as passed.
- `git diff --check` passed. Reviewed source/test SHA-256 snapshot: `review-source-hashes.log`.
- Transparency: initial exploratory `review-in-memory.log` stopped at a **reviewer assertion mistake**, assuming an exact-boundary refs/risk representation could not degrade to refs. Corrected assertion explicitly selects the refs representation; final independent boundary test passes. This initial failure is not a product defect.

## Blocking findings / precise acceptance repairs

### R1 — F04: actual handler still misses projection telemetry and listener cleanup on configuration failure

**Source:** `src/kiro/mcp-server.ts:469`, `createKiroMcpServer` / `CallToolRequestSchema` handler. `loadFabricConfig(data.configFile)` runs after `extra.signal.addEventListener` but before the main `try/finally`. `loadFabricConfig` legitimately throws on malformed/private-file/read errors (`src/config.ts:296–340`).

**Independently tested:** with the actual server handler and SDK/config/filesystem mocks, startup succeeds, then a valid `fabric_exec` encounters a config error. It rejects instead of returning a bounded tool error, emits **zero** `exec.projection` records, and registers **one** abort listener while removing **zero**. Source request marker is emitted, but the new analyzer counts that request as zero attempts.

**Required:** bring fallible exec setup and listener/timer lifetime under the bounded error/projection/finally boundary. Add actual-handler source tests proving exactly one metadata-only `exec.projection` on config failure and every supported early-error/normal/failure path. Do not merely test `projectFabricExecutionText` or synthesize analyzer records. Assert execution ID correlation, exact returned-text UTF-16/UTF-8 counts, five-field allowlist, no source/payload/result/log/error-message secrets in trace events, and listener/timer cleanup.

### R2 — F06 and F04: server commit-boundary regression coverage remains absent

**Source:** `src/kiro/mcp-server.ts:398–405` does now check `closing` and the request signal immediately before `binding.commitMutation`. Code review supports this placement: no await between guard and commit; existing identity checks/attach elicitation/runtime drain remain intact.

**Gap:** no added test invokes this actual handler with a prepared mutation waiting behind the lifecycle queue. `tests/workspace-binding.test.ts` tests binding methods (and an installation helper); it does not exercise the server queue or cancelled mutations. Existing `tests/mcp-process-lifecycle.test.ts` uses staged artifacts and tests lifecycle/process/workspace switching, not this cancellation commit boundary. Passing it is not acceptance evidence for this fix.

**Required source-only SDK-mock/in-memory tests:** each of select, attach and detach prepared before queueing, cancellation after preparation but before commit, then release the queue and assert commit not called / binding unchanged / no mutation-induced runtime replacement. Include approved attach, shutdown winning the serialized boundary, a non-cancelled control, and retained identity/approval/drain semantics. Explicitly define/test close-request versus close-commit ordering. Add the projection matrix from R1, including normal success, execution failure, retained overflow and retention failure after guest success. These must be repository regression tests, not only this review's exploratory assertions.

### R3 — F05/F07: directory sync is now mandatory despite unchanged durability contract

**Source:** `src/kiro/memory.ts:543–548` (`writeJsonAtomic`) and `:755–756` (`delete`). The diff removes the previous best-effort directory open/fsync handling. Every otherwise successful mutation on a platform/filesystem without that directory-sync operation now rejects after publication.

**Independently tested:** synthetic filesystem returns `EINVAL` only for directory fsync; actual `writeJsonAtomic` publishes and then throws. Existing memory recovery test confirms public `set` wraps a directory-sync failure as committed. That wrapper is truthful, but does not make an unsupported operation an acceptable new default failure. Windows directory opening and unsupported-filesystem behavior were **not run live**.

**Required:** preserve documented atomic publication/process-restart persistence defaults (`docs/configuration.md:19`), without requiring a new power-loss guarantee. Deliberately handle unsupported directory open/sync behavior for both set and delete; retain truthful acknowledgement/cause semantics for errors that must propagate. Test supported success, unsupported open/fsync, real failures, publication visibility, lock cleanup and same-instance recovery. Do not blanket-weaken ownership or approval checks.

### R4 — F05: metadata failure during lock initialization can still strand ownership

**Source:** `src/kiro/memory.ts:182–183,198–216`, `withNamespaceMutationLock`.

**Independently tested with a synthetic filesystem:**

1. mkdir succeeds, following lstat throws transient `EIO`: directory remains, **no pending identity retained**, only the metadata error reaches the caller. Acquisition never enters the owned cleanup region. The directory may eventually be stale-reclaimed, but this operation silently leaves cleanup debt and immediate callers can time out.
2. exclusive owner open succeeds, owner-fd fstat throws transient `EIO`: initialization raises an AggregateError and retains only the directory identity. After removing the injected fault, the same instance refuses the owner as foreign because `identity.owner` was never established. Recovery cannot make progress through its pending cleanup path while that owner remains.
3. Positive control: owner write failure **after successful fstat** correctly removes its partial owner without a token and leaves no pending lock. The optional-token change fixes that specific case.

**Required:** extend safe initialization/ownership acquisition recovery across metadata failures, keeping the descriptor/identity evidence needed for safe retry where possible. If ownership cannot be proven, fail closed and explicitly report unresolved cleanup/recovery state; do not delete an unidentified lock or substitute pathname-only ownership. Add initialization tests covering mkdir/lstat, owner open/fstat/write/close, partial initialization, cause preservation and same-instance recovery after transient faults. Current `tests/memory-recovery.test.ts` has no initialization-fault tests.

### R5 — F03/F04: new request counters do not faithfully describe caller outcomes or incomplete traces

**Source:** `scripts/analyze-trace.mjs:107–118,200–204`; documentation and `tests/trace-analyze.test.ts` currently encode end-status precedence.

**Actual analyzer counterexamples, recorded in `review-unit-results.log`:**

- Guest `exec.end.status=succeeded` followed by `exec.projection.isError=true` gives one attempt, **zero failures**, status succeeded, no failure anomaly. Projection can fail after successful guest execution when artifact retention fails. `projectionIsError` is preserved, but the aggregate labelled as request outcomes misses this failure.
- An observed `exec.start` with no outcome gives one attempt and **zero failures**, without an unknown-outcome count.
- An end-only failed execution gives **zero attempts / zero failures**, although the execution view and anomaly say failed.
- `tool.fabric_exec` plus a drop marker gives **zero attempts / zero failures**, although a caller request is explicitly observed. A drop anomaly alone does not identify aggregate coverage or prevent misleading zero totals.

**Required:** retain original execution-status/result fields for compatibility, but represent request outcomes independently from guest outcomes. Count observed request IDs without double counting available request/start/end/projection evidence. Provide unknown-outcome/coverage information and clearly mark observed/lower-bound totals under drops/truncation rather than implying complete measurements. Tests must include successful guest + failed projection, missing outcome, end-only legacy data, request-marker-only data, ring drops/file caps and true known zeros. Do not turn missing projection fields into inferred result sizes.

**Additional inherited limitation, not a new regression:** memory summary still uses `?? 0` for missing usage. Two `{usage:{}}` snapshots produce zero heap delta/max. Either extend the unknown-metadata treatment or explicitly scope the documentation/acceptance claim; do not claim all analyzer metadata is now unknown-safe.

### R6 — F07 end-to-end committed acknowledgement is not established at the caller boundary

**Source-reviewed path:** `KiroMemoryCommitAcknowledgementError` correctly wraps published failures at the binding. `KiroMemoryProvider.invoke` forwards this, and `ActionRegistry.invoke` retains the message in audit errors. However, `src/runtime/quickjs-runtime.ts:613–628` prefers generic cancellation/deadline text, and `src/kiro/projection.ts` `failureProgress` reports only ref/outcome, not a committed acknowledgement from the audit.

**Independently tested component counterexample:** supply the actual projection with an aborted result and a completed `memory.set` audit carrying the explicit committed/read-before-retry message. Caller text contains generic cancellation and a generic inspect-state warning, but **no explicit committed acknowledgement** (`review-ack-projection.log`). This is not a full runtime fault-injection test; that missing coverage is material.

**Required:** add a safe end-to-end SOURCE fixture for post-publication cleanup failure and post-publication cancellation/deadline, through provider/registry/execution/projection. Preserve truthful, bounded caller-facing committed/read-before-retry information when known without copying arbitrary audit errors/secrets into telemetry. Keep cancellation fail-closed; do not resume cancelled work or claim a pre-publication/no-op commit. If the intended guarantee is binding-only, narrow the acceptance/documentation explicitly rather than mark caller-visible F07 complete.

### R7 — repository acceptance check remains red

Parent log independently inspected: `tests/package-boundary.test.ts` requires `docs/audit.md` inventory coverage for new `tests/memory-recovery.test.ts`. Add it and inventory any new regression test files. Parent must rerun `pnpm run check` and final fresh build after repairs. Earlier successful build/stage does not certify repaired source.

## What passes / scope qualifications

| Finding | Review result |
|---|---|
| F01/F02 bounded catalog | Code-reviewed and source-tested: combined `{actions,catalog}` UTF-8 envelope, total/returned/completeness, three degradation forms, independent recovery hints. Independent exact refs boundary is **19,794 ref characters → 20,000 envelope bytes**; one extra character excludes that first ref. Fresh input descriptor digest is reflected on the next call; no new descriptor cache. |
| F01/F02 skill | Unnecessary list/count example removed; direct `memory.get` is on the actual guest API. Recovery guidance retained; downstream example still uses `mcp.describe` and `expectedDescriptorDigest`. No approval/isolation weakening or Pi dependency observed. Skill example itself was code-reviewed, not run live. |
| F03 timing/units | Independently rerun union tests pass: serial/overlap/nested/clipped children; finite start+duration endpoint; malformed timing unknown/anomaly/Chrome exclusion. Existing `resultChars` compatibility and explicit legacy alias retained. UTF-16 chars versus UTF-8 bytes labels corrected. Known/unknown bridge sizes work for present records. R5 limits completeness/outcome claims. |
| F04 projection helper/service | Source tests pass Unicode, diagnostics/logs, overflow/retention flags and legacy/new result-value fields. New server event object is a metadata-only allowlist by code review. Exactly-once/privacy handler coverage and early config path remain blocking. |
| F05/F07 memory | Existing 9 recovery tests pass: pre/post commit, cleanup/cause, no-op, replacement refusal, same-instance cleanup retry and concurrent writes. Optional token safely handles tested partial-write initialization. R3/R4/R6 prevent end-to-end acceptance. |
| F06 workspace | Guard placement code-reviewed positively; actual queued handler cancellation/shutdown not regression-tested. Not accepted solely on lifecycle tests. |
| F08 | **Gated / intentionally not implemented**: no schema caching or prompt compression without host evidence. No reason to add a Pi dependency or weaken required instructions/health/isolation. |
| B01 | Parent owns response-log verification of every Sol model route. No model calls or independent route certification by this reviewer. |
| B02 | **Live Kiro/billing unavailable and unperformed**. No live efficiency, billed-token, dollar-savings, quality or threshold claims. |

No fixes implemented by this reviewer. Parent should send the above repairs to Sol and request independent re-verification of the resulting source/test diff.
