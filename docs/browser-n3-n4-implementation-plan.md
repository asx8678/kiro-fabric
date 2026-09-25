# N3 browser authority and N4 local-check wiring: implementation plan

> **Historical / superseded by Browser Harness removal.** Browser implementation, CLI/provider entry points, bundled skills and execution qualification described below are no longer shipped. This document is retained for provenance (including unrelated verifier/cleanup repair history), not as current setup instructions, available functionality or verification evidence. See [current removal and verification notes](browser-removal.md). Historical paths may no longer exist.


Status: **P/browser repairs, scoped cleanup retention and local packaging/component checks implemented; full I/H/B/S/W coverage remains incomplete**. See sections 11–14 for evidence. This refines steps 4–5 of [the repair plan](browser-repair-containment-plan.md#n3--complete-the-r2-authority-regression-slice). The user subsequently instructed **do not write any tests**: existing case files remain byte-for-byte unchanged, and no planned new cases/controls were added. Earlier S1 pass counts remain historical, not certification of complete N0–N2 coverage.

## 1. Objective and hard boundary

Implement B01–B10 using the real registry, providers, host, operations, broker and session over an **in-memory fake CDP wire**. Then wire the approved offline checks into `check:local` and a separate local-development CI lane. The result proves **in-process authority and lifecycle**, not native/browser/owner-wide network containment, installed-package integrity or authenticated Kiro behavior.

No real browser, loopback server, browser endpoint, DNS/network request, installation, activation, live hook/shell change, external browser CLI, native containment experiment, download, positive production evidence, commit or push. Do not remove retained repositories. Keep `check`, `prepack`, release and native qualification gates fail-closed. Do not change production budgets or weaken admission to make fixtures pass.

## 2. Findings that change the implementation order

### Confirmed by harmless direct probes

At planning time, `scripts/verification/runner.mjs` behaved as follows (the first repair slice in section 11 corrects these false-greens):

- Returns `ok: true` for a failed case when `requiredIds` is empty.
- Returns a passing result for an async case taking 30 ms with `deadlineMs: 1`.
- Returns a passing result for a required case returning nonempty `coverageGaps`.

These were in-memory probes of `runSuite`, with no fixture writes, children or browser effects. They demonstrate runner weaknesses, not completed regression tests. `verify-offline.mjs` also defaults a missing required-ID export to `[]`; removing a case and its suite-local required ID can evade the present completeness check.

Read-only `git cat-file -e HEAD:<path>` succeeded for all three recovered modules: `scripts/source-install.mjs`, `scripts/source-bundle-stage.mjs`, `scripts/source-pull-hook.mjs`. The N0 helper calls `.trimEnd()` on ignored/null stdout and catches that error as absence. Correct the report before using it as recovery evidence; HEAD membership still does not establish the pre-deletion unstaged contents.

### Source-grounded gaps to reproduce before fixing

This table records the pre-repair findings. Section 12 repairs host settlement, connect/abort ownership, target disposal and sticky contained routing; the broader coverage/admission gates remain incomplete.

| Area | Current source behavior | Required response |
| --- | --- | --- |
| Host settlement | `host.ts` registers resolve-only completion markers; `activeDone()` runs even when session cleanup rejects | B07 must distinguish work completion from confirmed cleanup; propagate uncertainty through `close()` |
| Connect/abort race | `session.ts` checks abort after `provider.open()` but before owning the returned wire | B07 must return a wire concurrently with cancellation and assert it is closed |
| Target disposal | `closeTarget()` discards ownership without inspecting CDP `success` | B08 must withhold confirmation for `success: false`, missing success, error and no reply |
| Contained routing | `web-provider.ts` selects host/executable using current `host.available`; a dual-configured provider can switch to CLI after close | B09 must prove sticky contained routing, including post-close and approval-time races |
| Caller epoch | Dequeue compares remembered-mode receipt scope with supplied `opts.scope`, not a live authorization-service lookup | B05 proves that comparison; do not claim general live epoch revocation or ephemeral-scope enforcement |
| I07 completeness | Three early refusals pass while overlap/existing destination/drift are reported as gaps | Complete missing staging behavior or keep I07 and aggregate non-success |
| Fixture effects | I08 actually writes fixture hooks/config; predictable roots and overlay-only environments can inherit ambient state | Correct claims; isolate all subprocesses and report every retained root |
| CI safety | Scoped local/generated/private trees now retain state; private disposition remains nonqualifying and blocks release uploads (sections 13–14) | Do not infer native qualification, hostile-filesystem containment or permission to enable the incomplete aggregate lane |

For I07, `src/installation/bundle-contract.mjs` accepts schemas 1/2/3; browser evidence validation is conditional on schema 3. Therefore the previous claim that staging tests necessarily require counterfeit browser qualification is unsupported. A valid non-browser schema-1 fixture is the first option to investigate, not fabricated schema-3 evidence.

## 3. Acceptance ledger

| Gate | Evidence required before marking complete |
| --- | --- |
| P — runner integrity | Independent fixed case contract; omission/duplicate/empty/partial/unavailable/error/hang controls fail; a valid positive control passes |
| I — inherited installer scope | I01–I09 meet their declared invariants, especially I07; exact side effects and retained paths are reported; no implicit skipped coverage |
| H — browser harness | Fresh isolated worker; source-only bundled graph; deterministic fake replies and independent resource/commit ledger; no live browser/network/CLI |
| B — browser authority | Every B01–B10 subcase below runs and passes; negative cases have a corresponding live positive control |
| S — surface/admission | Mechanical source and built export/guest/schema checks; no new authority exposure; ordinary production admission remains unavailable without matching evidence |
| W — local wiring | Exact package-script order and independent local CI lane; reference audit and all required offline cases execute; release propagation controls remain nonzero |
| D — handback | Current versus historical scope separated; actual commands/exits/report paths recorded; fresh final build |

Any required partial/unavailable/failed case blocks the corresponding gate. Do not reduce a required manifest, count a documented defect as a passing regression, or describe this wiring subset as completion of all N4 packaging/metadata work.

## 4. Work package P: repair the verifier before extending it

**Files:** `scripts/verification/runner.mjs`, `baseline-cases.mjs`, `scripts/verify-offline.mjs`; add `scripts/verification/case-contract.mjs` (fixed declarative suite IDs) and a small worker entry only if needed.

1. Keep an independent exact case contract: BASE-01..BASE-08 plus explicitly registered new controls, I01..I09, B01..B10. The loader validates the case list and suite export against that contract. Reject missing/empty/duplicate/unknown IDs, missing functions, malformed records and unknown selectors before effects. Add controls deleting a case from both suite-owned lists. No optional failed case may accidentally leave aggregate success.
2. Make required subcase coverage machine-readable. Validate it against expected subcase IDs, not an arbitrary facts object. Required `coverageGaps`, partial, unavailable, timeout, import error, invalid child JSON or omitted result mean non-success. Distinguish registered, attempted, completed, passed and unavailable counts.
3. Enforce the entire case deadline from a supervising process, outside the case event loop. A `Promise.race` alone cannot stop synchronous hangs or late effects. Use fixed case dispatch, not arbitrary user paths/commands; bound child output and terminate/reap only the case-owned process. Cases must not leave descendants or do uncontrolled work. Preserve fixtures on failure/timeout. Keep a separate generous cold-start/harness budget, at least 3–5x production bounds, without widening production timeouts.
4. Add fail controls for a never-resolving promise, synchronous stall, late completion, nonzero child exit, signal, spawn error, invalid report, unavailable case and partial coverage. Assert exit/error/signal before parsing stdout in BASE-07 and all ignored I08 Git results. Help plus malformed selections must not silently succeed.
5. Allocate fresh private canonical fixture/report roots per run; validate ownership, modes and symlink-free ancestry before effects. Reject unknown/reused roots rather than deleting them. Allowlist child environments: private HOME/TMPDIR/KIRO_HOME/XDG/cache paths, required tool PATH only; no inherited `NODE_OPTIONS`, Git override/config variables, credentials or browser endpoints. Do not merely overlay `process.env` for real helper subprocesses. Report external retained KIRO_HOME roots too.
6. Hash the actual fixture and exercised production graph, not only case wrappers. Capture the esbuild input graph and bundle digest; detect input changes across the run. A missing/unreadable required identity is failure, not filtered out. Audit traversal bounds/unresolved imports must be explicit gaps, never silent completeness.
7. Repair N0 HEAD detection using process status separately from stdout. Add known-present, known-absent and Git-error controls; report unknown separately from absent/clean. Replace stale cleanup assertions with current source locations. Keep N0 descriptive, not a qualification certificate.

**Exit:** the new positive control passes, each intentional failure produces a nonzero/failed report, no retained repositories are cleaned up, and the old three false-green probes no longer pass.

## 5. Work package I: close inherited blockers to `all`

**Files:** `scripts/verification/installer-cases.mjs`, N0 audit; `scripts/source-bundle-stage.mjs` only if a narrow behavior seam is necessary.

- Complete I07 with a bounded valid non-browser bundle fixture: successful copy/digest equality, source/output overlap in both directions, existing destination preserved, replaced parent/destination refusal, input growth/hash drift, incomplete private output retained. Audit fixture construction and pinned-directory helpers before execution. Never execute fixture binaries or install/stage into a live home.
- Prefer real schema-1 validation/copy behavior. If tool pins/size prerequisites make that impractical, isolate the snapshot-copy primitive behind an internal validated-input boundary and test it plus separate real validation negatives. Do not add a config/environment validation bypass. Document the narrower evidence explicitly; if the declared invariant remains unproved, I07 stays unavailable and `all` stays blocked.
- Preserve fixture repositories and hooks; do not erase them after a run. The prior tests included real fixture-local hook writes/config changes, but no live installation hook change. Future reports and effects labels must say exactly that. If no fixture hook mutation is allowed for a run, mark that coverage unavailable rather than claim the stub is equivalent.
- Retain the staging cleanup helper's stated limitation: it requires private, quiescent staging and is not an atomic hostile-filesystem guarantee. Do not infer general cleanup safety from I09.

This prerequisite can proceed in parallel with browser fixture development, but must finish before aggregate wiring is declared complete.

## 6. Work package H: minimal browser fixture architecture

**New files:**

- `scripts/verification/browser-cases.mjs`: fixed B01–B10 adapters, expected subcase IDs, build/worker invocation, output assertions and identity capture.
- `scripts/verification/browser-fixture.ts`: real source imports, fixed scenario dispatcher, controllable approval, fake wire and counters. Split a `browser-fake-transport.ts` only if it materially improves readability.

Use existing esbuild as a dev dependency to build one retained ESM source graph. All authority mint/assert/consume paths must use the same module instance: `invocation-authority.ts` stores authority in a module-local WeakMap. Do not mix `dist/index.js` with source-private authority imports. Typecheck fixture code explicitly (a dedicated verification tsconfig if needed); do not ship fixture code or widen public exports. Compile once per run; run cases serially in fresh bounded workers.

### Real execution path

`ActionRegistry.invoke` → prepare/validate/freeze canonical args → `approve(action, argsCopy, review)` → host-private mint → actual provider invocation → `BrowserHost.run` queue/dequeue/consume → `ManagedSession` → fixed operation and `RequestBroker` → fake `BrowserWire.send` → confirmed disposal.

Construct `new BrowserHost(effectiveConfig, fakeTransport)` and inject the same host into the real `WebProvider` and `BrowserProvider`. Use fixture-local `enabledRecipes: ["gsearch", "gnews"]` and matching `qualificationScope` through existing trusted construction options. These are not qualification evidence, and must never be written into installed configuration/evidence. The provider fixture reads/verifies the real bundled skill pack. Separately test that default construction and real admission without matching schema-3 evidence stay unavailable.

Implement only protocol messages actually needed: context/target creation, attach, Page/Network/Fetch setup, navigation, lifecycle event, paused request, completion, fixed extraction, target/context disposal and close/error events. Correlate IDs and session IDs; fail on unknown methods and unexpected duplicate calls. `Runtime.evaluate` returns canned extraction JSON; **never evaluate the supplied expression**. Use deferred gates to hold/release replies rather than timing-dependent sleeps. Event emission must wait for the relevant listeners/setup.

Record per invocation: approval entered/resolved/denied, provider dispatch, operation entry, transport opens, sent methods, `Fetch.continueRequest` commits **at wire.send**, acknowledgements, cleanup attempts/confirmations, wire close, late creations, and an independent ledger of live contexts/targets. A gate's charged bytes or broker decision recorded after a reply is not a commit counter. Session ownership reset alone is not proof of disposal.

Harness workers may use fixed synthetic HTTPS URLs as strings; no resolver/socket/HTTP/client/launcher/owner calls occur. Any execution traps cover only the audited fixture paths, not OS-wide containment. Do not import launcher/owner modules merely to exercise status/help effects.

## 7. Work package B: exact B01–B10 matrix

| ID | Scenario and required assertions |
| --- | --- |
| B01 | Real registry-approved `web.search` reaches real operation and broker. Review ref, descriptor digest, canonical argument digest, engine/purpose/policy/profile/scope agree. Mutate the callback's args copy and verify unchanged dispatch. Exactly one approved operation, one open, positive continue commit, expected result and confirmed cleanup. |
| B02 | Missing, spread-copied, JSON-cloned and structurally forged receipts fail through provider and direct-host unit paths. Zero opens and operation frames per denied invocation. Private minting is allowed only for fixture unit setup, never as proof of approval ordering. |
| B03 | Denied, still-pending and aborted approval have zero operation effects. The registry deliberately awaits approval settlement; abort the pending invocation, explicitly settle its approval promise, then assert denial and no mint/dispatch. Include an approved non-browser action through the same registry to prove unchanged ordinary behavior. |
| B04 | Replay consumed/revoked receipt; wrong action/ref, recipe, purpose, engine and changed canonical args. Assert rejection before new effects. Exercise provider assertion and host consumption separately; pair failures with a matching valid receipt so a dead harness cannot pass. |
| B05 | With one host slot, hold operation A and deterministically queue B. Independently change policy budget, profile mode and remembered-mode supplied scope epoch before A releases. A may have effects; B adds zero opens/commits. Restore/recreate config between subcases. This proves dequeue revalidation against the supplied scope, not live session revocation. If a broader epoch requirement is intended, keep it explicitly unavailable pending a trusted live-scope design; no test-only bypass. |
| B06 | Real broker/session/coordinator lease: expired lease, explicit revocation and terminal failure stop new continuation at the final send guard. Inject revocation immediately at that boundary, not just before a whole operation. A terminal broker fault racing a resolved extraction must defeat apparent host success; cleanup remains permitted. |
| B07 | Queue cancellation, active cancellation, host close during open and during work. No queued opening after close; close is idempotent; lease is revoked before settlement. Deferred open returning a wire after abort cannot leak it. Confirmed cleanup permits drain; unconfirmed cleanup rejects operation **and host close**. Call host.close explicitly: registry.close is not sufficient for these providers. |
| B08 | Delay create-context and create-target replies beyond interruption/timeout; deliver during settlement and verify each late resource is disposed. Withhold replies/cleanup acknowledgements or return failed target closure and require `SessionCleanupError`. Unknown/duplicate replies cannot fabricate ownership or drain. Use the fake's independent ledger, not only `ownedResourceCount`. |
| B09 | Real registry routes: `web.search`, `web.open`, `browser.runSkill` gsearch and gnews; exercise configured engine scope. Confirm both WebProvider callbacks and `RECIPE_OPERATIONS` dispatch. Missing authority, host closure and host loss during approval cannot switch to an external executable. Use an inert, audited executable sentinel where constructor validation requires a dual-configured negative control; external CLI effects must stay zero. Never launch browser-harness-js. |
| B10 | Mechanically inspect source/built package exports, guest bootstrap/types, provider descriptors, strict config parser and operator exports. No new minting, raw-JS/CDP guest action, endpoint/trust flag, fixture entry or positive evidence. Assert production admission negatives and historical schema rejection; inventory existing host-only exports instead of claiming they do not exist. |

### Expected narrowly scoped production changes

The subsequent no-tests instruction supersedes the original test-first sequence. Section 12 implements the following repairs using transient memory-only diagnostics, without adding B07/B08/B09 test files:

- `src/browser/host.ts`: carry cleanup outcomes through active-settlement bookkeeping; distinguish normal operation failure with confirmed disposal from cleanup uncertainty; repeated close must preserve the same outcome. Avoid unhandled rejection promises.
- `src/browser/session.ts`: close a returned but unadopted wire on abort/retirement; validate target-close acknowledgement; keep uncertainty in the returned error rather than pretending an emptied local set means disposal succeeded.
- `src/providers/web-provider.ts`: pin the selected backend when constructing a contained provider, and keep authority preparation/assertion/routing on that path after close. Preserve deliberately configured legacy-only behavior separately; no broad legacy migration in this slice. Do not introduce an `allowUnqualified` option.
- Touch registry, lifecycle, broker or operations only for an observed required-case failure; preserve approval reservation/settlement ordering and exact production deadlines.

B10 is baseline-aware: the package already exports trusted-host `BrowserHost` and `WebSocketTransportProvider`, and historical schema-1 records already contain positive-looking status. Required outcome is **no new exposure/admission**, not silently removing old APIs or rewriting historical evidence. Validate config with its strict file parser, not just normalization.

## 8. Work package W: step-5 wiring, only after P/I/H/B/S

1. Register actual files in dev tooling/Knip/typecheck as needed; do not include them in `agent-product.json`, installed assets or package exports. Verify registrations mechanically.
2. Set `check:local` to: disclaimer → `guidance:check` → `typecheck` → fresh `build` → `verify:references` → `verify:offline all` → `lint:dead`, using failure-preserving chaining. Browser suite existence is necessary but insufficient: no required suite/subcase may remain partial or unavailable.
3. Add a separately named local-development CI job with explicit non-release scope. Do not rename, remove or soften existing required native/release jobs or their four-target matrix. No `continue-on-error`, `|| true`, skip-based success or branch-protection changes.
4. Do not run the existing home-sentinel/EXIT cleanup paths unchanged. Either repair them to retain unfamiliar/repository-bearing roots with checked task ownership, or use a fresh isolated local-job wrapper that retains all roots. Never move the entire `.tmp` tree under a cleanup trap. Audit child cleanup chains before running them.
5. Add package-expression controls in a private fixture: actual `check` expression with an inert local command returning 0 must reach the retirement dispatcher and exit 69; a nonzero local command must propagate failure and not reach the release step. Verify `prepack` and `release:candidate` still chain to `check`. Exercise known/missing/unknown dispatcher IDs and malformed selections without running staging/archive/install code.
6. Correct README development commands and the current repair/audit status. Distinguish callable-but-unavailable test commands from missing files, and current offline checks from deleted historical tests. Keep `AGENTS.md` safety and commit/check requirements unchanged.
7. Full N4 also includes skill/component negative controls, upstream/license/26-entry/9-skill consistency, runtime/evidence identity and installed component-only checks. Track those separately under canonical N4; this command-wiring slice alone cannot mark all R3/R4 or installed integrity complete. No native/model-authenticated checks are implied.

## 9. Implementation and verification sequence

1. P: runner contract/deadlines/isolation/identity controls; N0 corrections.
2. In parallel, I: finish inherited installer gaps; H: build deterministic browser harness.
3. B01–B04 and B09 positive provider traversal first, so later denials cannot pass vacuously.
4. B05–B08 races and narrowly scoped production repairs; then B09 no-fallback negatives.
5. B10 source/built/admission boundary checks and independent review checkpoint.
6. Run browser cases, then repeat from a fresh retained root; run baseline and installer checks after their changes; run `verify:references` plus its negative control; typecheck and dead-code lint.
7. Only once all required coverage is green: W wiring and gate propagation tests; run the actual `check:local` once. Inspect failures, repair and rerun affected checks rather than repeating unchanged long passing checks.
8. Finish with **`pnpm run build` after the last edit**. Inspect the exact generated output scope for repositories/symlinks and preserve pre-existing work before any build cleanup. No build success substitutes for the behavioral ledger.

Use the trusted standalone Node where executable-ancestry checks require it. Keep `fileParallelism` off. Bound long suites with one shell timeout; inspect exit status, signal/spawn error and parsed report. Count expected-negative probe success separately from production acceptance.

### Safe parallel ownership

- Main/integrator: runner/CLI/contracts, package/CI wiring, production host/session/provider fixes and central ledger.
- Browser fixture lane: only the new browser fixture/case files against the agreed worker/report contract.
- Installer lane: I07 fixture and precise effect/isolation reporting; coordinate runner interfaces first.
- Read-only reviewer: case completeness, cleanup/outcome propagation, public surfaces and release blockers.

Do not let parallel workers edit shared package/CI/source files independently. No worktree creation is needed; no repository teardown is authorized.

## 10. Required handback

List changed paths, each executed command and real exit, required IDs/subcases and counts, report and retained fixture paths, source/bundle identity, cleanup/CLI/network effect observations, and any remaining gaps. Label results **local development; in-process authority/lifecycle; qualification: false**. State explicitly that no real browser/native containment or installed Kiro verification ran. If I07, a browser subcase, cleanup safety or release coverage remains unavailable, keep the corresponding gate blocked and say so.

## 11. First P repair implemented — no tests written

This is an implementation-only prerequisite slice, not completion of P's planned new control/subcase coverage or N3/N4. Existing `baseline-cases.mjs` and `installer-cases.mjs` hashes were checked before and after and are unchanged. The existing inline self-test bodies in the CLI were retained unchanged.

### Implemented

- `scripts/verification/case-contract.mjs`: independent BASE-01..BASE-08, I01..I09 and B01..B10 case-ID contracts; malformed, omitted, duplicate or empty required sets cannot pass; nonempty `coverageGaps` and non-passing reported status are non-success.
- `scripts/verification/runner.mjs`: fresh owned private fixture/report roots, no overwrite/following existing report files, allowlisted external HOME/KIRO_HOME/TMPDIR/cache environments, retained environment paths, bounded source identity capture and accurate unavailable/partial reporting.
- `scripts/verification/case-process.mjs` and `case-worker.mjs`: infrastructure only, no test definitions. Suite imports/factories and individual existing cases run behind process deadlines. Nested invocations inherit the outer case's process group via an identity-checked fd rather than detach out of ownership. Whole-worker execution has a separate fixed 2-second settlement budget; uncertain cleanup cannot report success or hang indefinitely waiting for pipes.
- `scripts/verify-offline.mjs`: supervised discovery, structured import/infrastructure failures, malformed selections rejected even with `--help`, cancellation stops subsequent suites, identity drift invalidates individual suite artifacts as well as the aggregate. Reports remain non-qualifying.
- `scripts/verification/n0-audit.mjs`: corrected HEAD membership, unknown/error Git states, current cleanup description and explicit incomplete heuristic traversal scope. It does not certify absence of effects or historical unstaged-byte recovery.
- Package/release/CI wiring is unchanged. No browser production behavior, admission configuration, fixture case, public export or installed asset entry was changed in this slice.

### Executed evidence

| Check | Actual result |
| --- | --- |
| `pnpm run typecheck` | Passed |
| `pnpm run lint:dead` | Passed |
| Existing `verify-offline.mjs baseline installer` under trusted Node | 17 existing cases: 16 passed, I07 partial; exit 1 as required |
| Existing baseline subset in that run | BASE-01..BASE-08: 8/8 passed |
| Existing installer subset in that run | 8 passed, I07 partial; its old coverage gap no longer yields a false-green aggregate |
| Direct completeness probes | Empty required list rejected; removing BASE-01 from both suite lists rejected against independent contract |
| Existing BASE-01 and BASE-06 invoked with 50 ms supervisor budgets | Both timed out, SIGKILL, owned process-group cleanup confirmed; returned in approximately 64–65 ms |
| `verify-offline.mjs --help not-a-suite --json` | Structured selection failure, exit 2 |
| `verify-offline.mjs all` | Missing browser suite remains a named blocker, exit 1 |
| `node scripts/verify-project-references.mjs` | Passed; 43 scripts, 265 scanned source files, 1363 literal specifiers, zero findings |
| Corrected N0 audit in a fresh retained output directory | Report generated; all three recovered targets are in HEAD; `scope.complete: false` and uncertainties remain explicit |

Retained main reports: `.tmp/verification-reports/baseline+installer-qaMwCD/`; aggregate-blocker report: `.tmp/verification-reports/all-XYxc9c/`; N0 report: `.tmp/n0-audit-repair.FYiHnT/n0-audit.json`. Case reports and discovery records enumerate their external retained environment roots. No fixture repository was deleted. Existing I08 executed fixture-local hook/config writes; no live hook or installation mutation occurred. No real browser, network/native containment experiment or installed/authenticated Kiro verification ran.

Read-only review found and prompted fixes to nested ownership, settlement, cancellation and source-drift reporting. The subsequent review found no further high-impact blocker in those fixes; parent-side import discovery was then moved behind the supervisor too. Structural review of the larger pre-existing working tree remained partial and is not correctness certification.

**Remaining after section 14:** I07 staging coverage, planned new per-subcase manifests/controls (not added under the no-tests instruction), full B01–B10 evidence, wider CI cleanup safety and N4 wiring. Do not wire `check:local` to `all` or claim full P/N3/N4 completion.

## 12. Browser production repairs — no tests written

### Implemented scope

Only three production files changed in this slice:

- `src/browser/host.ts`: active completion markers carry fulfilled cleanup outcomes. `close()` rejects on uncertain cleanup, including failures from already-completed operations, while ordinary work failure with confirmed cleanup still permits a successful drain. Unexpected settlement errors are normalized to cleanup uncertainty. Repeated close preserves the same promise/outcome; no rejected bookkeeping promises were introduced.
- `src/browser/session.ts`: returned-but-unadopted wires close on abort/retirement; connect is exactly-once even while opening. Settlement freezes ordinary work and tracks pending creations before taking ownership snapshots. Outstanding opens must settle within the existing cleanup budget or remain explicitly uncertain. Wire-close exceptions are not swallowed. Target ownership is released only on `success === true`, and repeated settlement retains its result. Confirmed context disposal covers its late target replies and unanswered target-creation obligations, but never unrelated creations.
- `src/providers/web-provider.ts`: constructor-time backend selection governs authority preparation, assertion and both search/open routes. Contained providers cannot switch to the external executable after host closure or between review and dispatch. Intentionally legacy-selected providers remain legacy if a transport is registered later.

No changes to the registry/receipt contract, production timeout constants, public exports, guest APIs, configuration schema, browser admission, runtime registrations, package/CI/release wiring or installed component entries. The independent review confirmed owner shutdown already propagates host-close uncertainty; no owner/lifecycle patch was needed. No new fixture/test files, controls or browser case registrations were created; the existing baseline/installer case files are unchanged.

### Acceptance ledger and actual evidence

| Check | Result and boundary |
| --- | --- |
| Before-edit memory diagnostics | Reproduced all four defects: aborted open closed zero wires; false target acknowledgement removed ownership; host close resolved after cleanup failure; post-close web dispatch attempted CLI fallback (intercepted before execution) |
| Initial repaired-source diagnostics | 22 scenarios passed: abort/retirement, positive/false/missing/error/no-reply target acknowledgements, completed/active/queued host cleanup, pending/late creations, missing authority/post-close routing, preserved legacy selection and real contained operation callbacks |
| Review refinements on final source | 7 focused scenarios passed: open completion/close exception/unresolved-open deadline, concurrent exactly-once connect, confirmed context disposal before/after interruption, and unrelated creation uncertainty retained |
| Final provider/host diagnostics | 7 scenarios passed: Google search, Bing search, page read, failed page disposal rejecting both invocation and host close, default no-transport refusal, missing policy/scope refusals. Successful operations left zero fake resources. All four provider paths retained authority checks after close; CLI dispatch attempts were zero |
| `pnpm run typecheck` and `pnpm run lint:dead` | Passed after the last production edit |
| `node scripts/verify-project-references.mjs` | Passed: 265 source files, 1363 literal specifiers, zero findings |
| `node scripts/verify-offline.mjs all` | Expected exit 1: browser suite still missing; report retained at `.tmp/verification-reports/all-zNOj0M/` |
| Source boundary identities | 14 pre/post SHA-256 identities unchanged, covering public/guest/operator exports, strict config parser, authority/admission, runtime registration, package/product/CI and both existing case files |

Diagnostics were one-shot `node --input-type=module -e` invocations using esbuild `write: false` and a memory-only fake wire with an independent live-resource ledger. Fixed extraction JSON was returned without executing page expressions. Private authority minting was used only for unit setup: these results **do not establish registry approval ordering or full B01–B10 coverage**. No browser, socket/DNS/network request, external browser CLI, live installation/hook change, native containment experiment or installed/authenticated Kiro verification ran. No generated qualification evidence was written.

The initial 22-scenario run preceded the two review refinements; the two subsequent 7-scenario runs cover those refinements and final integration. They are development diagnostics, not a saved regression suite or release qualification. The two read-only reviews prompted the late-open/context-accounting fixes. The broader structural review included pre-existing working-tree changes and remained explicitly incomplete.

Preserved originals: `.tmp/browser-production-before.MAwvXo/`. Final production SHA-256 identities:

- `host.ts`: `7ee25cc0a1bafb129213fbaa6bc3b2116585ba78b915d3b683761ffc6f2488a4`
- `session.ts`: `6dc0ef09433d291a08955f85859d050786ebaeaf4e51414d6f9c6efb1b12d340`
- `web-provider.ts`: `43b2e9674a6f7dc4be41afb635606cf698f000eca652e1e480f35ced9ca190a3`

**Still blocked:** full P/I/H/B/S coverage, I07 staging coverage, B01–B10 registration/authority evidence, wider CI cleanup safety and N4 aggregate wiring. `check:local` remains unchanged; `check` still reaches the nonzero release-unavailable dispatcher. No remembered/manual mode or production admission was enabled. Finish this slice with a fresh `pnpm run build` after the ledger edits, preserving the inspected pre-build output; report its actual result in the handback.

## 13. Local cleanup retention and development guidance — no tests written

### Implemented scope

This bounded repair **retains task trees instead of attempting recursive removal**. Retention is deliberate on success as well as failure; it does not certify arbitrary child behavior or an atomic filesystem boundary.

- `.github/workflows/ci.yml`: removed both recursive EXIT traps. Installer-contract and installer-bundle task roots are announced immediately and retained, including the first build's moved `.tmp` tree. The four-target matrix, unavailable-suite failures, reproducibility comparison and required steps are unchanged.
- `scripts/assert-kiro-home-unchanged.mjs`: reports the root immediately after allocation, retains it on every outcome, and keeps both home snapshots, mutation refusal, spawn-error handling and child exit propagation.
- `scripts/certify-kiro-agent.mjs`: retains/reports its local root; child TERM/KILL/shutdown and stdout certification JSON remain unchanged. No new certifier assertions or test scenarios were added.
- `scripts/build-complete-bundle.mjs`: retains unpublished acquisition and bundle staging roots. Existing validated publication/reuse/rename behavior and captured-inode single-file archive cleanup remain unchanged.
- `scripts/build-private-tools.mjs`, `scripts/installer-ci-cache.mjs`, `scripts/build-agent-dev.mjs`: also retain their separate download, rematerialization and Agent staging scratch roots. Otherwise outer retention would not protect these nested trees. Successful publication may rename a staging root; logs therefore say `retain-if-unpublished`, not that its original pathname necessarily remains.
- `README.md`: replaces obsolete runnable-Vitest/full-suite claims with the actual local checks, explicit unavailable commands and blocked aggregate/release gates. Documents stderr paths, disk accumulation, private-state handling and the limited cleanup scope.

No new source/test files, helper exports, package registrations, test cases or qualification bypasses were added. Seven recursive-removal sites across six scripts, plus two shell traps, were removed. Node helpers emit `[fabric:task-root]` path/policy records to stderr before setup or child effects, without task contents. Task trees are not automatically pruned or uploaded.

### Actual evidence

| Check | Result |
| --- | --- |
| Direct real home-wrapper probes | Success (0), child failure (37), HOME mutation with Git/worktree/bare markers (1), snapshot failure (1), child signal (1), spawn error (1): every root retained; unknown files and symlinks preserved; external marker unchanged |
| CI block diagnostics | Both changed shell blocks pass `bash -n`; actual unavailable contract block exits 69 and retains its root; bundle **allocation prefix only** plus an injected exit 37 retains its root. No native build or workflow was dispatched |
| Real tool-acquisition failure path | One fetch attempt intercepted before network access; injected failure propagates; separate scratch containing a `.git` marker and unknown file remains intact; destination stays empty |
| `pnpm run typecheck`, `pnpm run lint:dead` | Passed after all script edits |
| `pnpm run verify:offline baseline --help` | Documented pnpm argument syntax resolves and exits 0 without executing cases |
| `node scripts/verify-project-references.mjs` | Passed: 43 scripts, 265 source files, 1363 literal specifiers, zero findings |
| Mechanical surface/gate checks | Six scripts' exported names unchanged; CI diff limited to two retention sites; component child-shutdown block unchanged; package, verifier, unavailable dispatcher and both case-file hashes unchanged |
| Read-only patch review | No blocking findings in the compared patch; broader working-tree structural review remains partial, not certification |
| `node scripts/verify-offline.mjs all --json` | Expected exit 1 for missing browser suite; report retained at `.tmp/verification-reports/all-yb2NRl/` |
| `node scripts/qualification-unavailable.mjs release-grade-suite` | Expected exit 69; release qualification remains unavailable |

These were one-shot inline diagnostics; no tests were written. Preserved originals: `.tmp/cleanup-retention-before.VpYo46/`. Home/CI diagnostic roots: `.tmp/cleanup-retention-probe-HagBOT/`. Acquisition diagnostic root: `.tmp/tool-retention-probe-BW0UCn/`. Preserve all of them, especially repository-marked state. No real download, browser, installed client, authentication, installation, native qualification or remote workflow ran. Complete bundle publication, cache rematerialization, Agent staging and component certification were inspected but not executed in this slice.

### Remaining safety and qualification work

- Generated-output deletion in `scripts/build.mjs` and `scripts/build-kiro-closure.mjs` still requires exact-scope repository/symlink inspection and pre-build preservation. Cache GC and other deletion paths are not certified by this repair.
- Protected authenticated/release teardown is **not changed**: `.github/workflows/kiro-agent-real.yml`, `scripts/certify-kiro-agent-real.mjs`, coding-fixture cleanup in `scripts/run-kiro-agent-real-driver.mjs`, `.github/workflows/complete-release.yml` and extraction scratch in `scripts/complete-release-promotion.mjs`. These need a separate privacy-aware retention/cleanup contract. `qualification-failure.mjs` currently normalizes successful auth cleanup to `removed`; a naive retention substitution would misreport the outcome. Do not run or upload those private trees to fill this gap.
- Full P/I/H/B/S coverage, I07, B01–B10 and N4 aggregate wiring remain incomplete. `check:local`, `check`, `prepack` and release command wiring are unchanged and remain non-qualifying/fail-closed as applicable. A fresh final build is required after these documentation edits; report its actual result in the handback.

## 14. Remaining scoped cleanup repair and local end-to-end checks

This section supersedes section 13's outstanding generated/private cleanup and unexecuted local packaging items. The **no-tests instruction remains in force**: no tests or saved verification cases were added/modified, and incomplete aggregate/release gates were not bypassed.

### Production changes

- `scripts/prepare-generated-output.mjs` is a shared build helper imported by `scripts/build.mjs` and `scripts/build-kiro-closure.mjs`. It admits only `dist` and `dist/kiro-agent-closure`, bounds inspection at 20,000 entries/64 levels, refuses Git/worktree/bare metadata, links, special entries and unsafe ownership/modes, and rechecks metadata before preserving the previous output in private `.tmp/generated-output-*/output`. It then creates fresh output. Unknown regular-file bytes are retained, not erased. Explicit closure `--outdir` still refuses existing paths. The helper is automatically captured by the existing build-input import graph; no package registration changes are needed.
- `scripts/installer-artifacts.mjs` explicitly refuses repository metadata in `treeMetadata`, which covers initial capture, revalidation and `removeCapturedArtifact` before its first unlink. A valid receipt/hash is not permission to erase a repository. Existing bounds, descriptor-anchored effects, no-follow checks, inventory validation, leases and GC opt-in remain unchanged. **No GC apply was run.**
- `scripts/certify-kiro-agent-real.mjs` preserves its entire private root, detects root-identity uncertainty, and reports `retained`/`unverified`, never `removed`. Qualifying-output creation is explicitly blocked while this retention policy applies. Existing raw-transcript publication rejection and owned-process shutdown remain intact.
- `scripts/run-kiro-agent-real-driver.mjs` retains its coding fixture in the private wrapper root instead of recursively deleting it while a client is running. The fixture content/scenarios and process-shutdown implementation are unchanged; no real driver/client was invoked.
- `scripts/qualification-failure.mjs` records exact cleanup outcomes; private retention/uncertainty rejects rather than returning success. Original action failures remain primary. Its real `initialize`/`finalize` CLI replaces broken workflow imports (a private recorder and a missing finalizer). Finalization bounded-reads only diagnostic files, validates a strict schema, and writes separate `.sanitized.json` copies; originals are preserved. Missing, malformed, oversized, linked or unsafe diagnostics remain nonqualifying. Process status `failed`, `pending` or `unverified` cannot finalize successfully even with a contradictory `completed` reason. No raw paths, arbitrary errors, transcripts or private-tree contents enter those copies.
- `.github/workflows/kiro-agent-real.yml` retains its private work root, uses the real CLI and uploads only sanitized diagnostic copies. Retained/unverified private state fails the finalization step and blocks qualifying-asset upload.
- `scripts/complete-release-promotion.mjs` retains inspection scratch populated only from the already signature-checked archive bytes; it does not copy private witness trees into that scratch or release assets. Existing signature, witness, inventory and exact-byte checks remain unchanged. `.github/workflows/complete-release.yml` retains private inputs and explicitly fails its disposal gate before asset upload/publication. **Neither workflow was dispatched.** A verified privacy-aware disposition contract is still required to unblock them.

Retention is not a hostile-concurrent-filesystem sandbox. It consumes disk space; retained repositories and unknown trees must not be pruned. No broad permission changes, credentials, authentication, remote publication or installation were used.

### Acceptance ledger and actual evidence

| Check | Result |
| --- | --- |
| Generated-output inline diagnostics | 15 passed: fresh/repeated output, closure-only output, previous-byte preservation, scope/depth bounds, Git/worktree/bare/nested metadata, symlinks, hardlinks and unsafe permissions; helper present in captured build inputs |
| Private-diagnostic inline diagnostics | 23 passed: exact outcomes, original timeout preservation, cleanup despite reporting failure, real CLI dispatch, sanitized copies, missing/malformed/oversized/link reports, unexpected root links and contradictory process statuses |
| Real pinned-cache rematerialization | 3 checks passed using existing darwin-arm64 pins: 9 files copied/independently verified; existing destination refused; interrupted copy retains Git-marked scratch; source unchanged, no download |
| Repository-safe cache boundary | 6 passed: directory/worktree/link/bare/nested repository refusal during capture and pre-removal assertion, plus valid capture; no deletion/GC apply invoked |
| Real local Agent staging/reuse | Fresh 140-file generation independently validated; second call reused the same digest; previous pointer evidence preserved |
| Real local complete-bundle staging/reuse | Fresh schema-3 darwin-arm64 generation independently validated; second call reused it; network callback remained unused; `archive:false`, no installation |
| Existing component MCP certifier | Passed all 18 reported checks, including form decline and bounded shutdown; `scope: component-mcp-only`, authenticated Kiro explicitly NOT TESTED; component root retained |
| Static checks | Typecheck, dead-code lint and reference audit passed. Final source changes require the final rebuild/revalidation recorded in the handback |
| Mechanical surface/gate checks | Existing exports in seven touched scripts unchanged; new build helper imported by both producers; package/case/verifier/unavailable-gate hashes unchanged; process shutdown and transcript guard unchanged; three changed workflow shell blocks parse; private release block actually exits 1 |
| Reviews | Generated-output review found no blocker. Private review found one finalizer process-status bug, fixed and directly probed. Follow-up cache/finalizer review found no remaining defect in that narrow scope |

These are development diagnostics and local packaging/component results, **not** native/browser/release qualification. Originals: `.tmp/remaining-cleanup-before.324TOj/`. Diagnostic roots (retain all):

- `.tmp/generated-retention-probe-xFgFU6/`
- `.tmp/private-retention-probe-IDWPlp/`
- `.tmp/cache-retention-probe-0faeJf/`
- `.tmp/cache-repository-probe-rcrejR/`
- `.tmp/local-packaging-probe-XTRY6h/` (initial packaging report, previous pointer evidence and component report)

The initial local packaging/component run preceded the final cache metadata guard. After documentation is complete, rebuild and revalidate local packaging/component behavior against the final source; preserve the initial results and record fresh identities in a separate retained report. The mandatory final build now preserves prior `dist` automatically rather than relying on a manual pre-build deletion audit.

### Still blocked — not silently implemented by diagnostics

- I07's missing staging scenarios, B01–B10 and the remaining P/I/H/B/S verification cases require adding/updating verification cases, which the no-tests instruction prohibits. Their existing files remain unchanged; `all` and N4 aggregate wiring therefore remain blocked.
- A verified private-state disposition and privacy-safe success-evidence contract are still needed for authenticated qualification/release. Retention is an intentional failure gate, not successful cleanup or permission to upload private roots.
- Installed Kiro/browser/native containment verification, remembered/manual mode qualification, broader docs reconciliation and any other unreviewed cleanup surfaces are not certified. No production admission was enabled.
