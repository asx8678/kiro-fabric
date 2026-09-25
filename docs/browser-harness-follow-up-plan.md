# Browser Harness follow-up implementation plan

> **Historical / superseded by Browser Harness removal.** Browser implementation, CLI/provider entry points, bundled skills and execution qualification described below are no longer shipped. This document is retained for provenance (including unrelated verifier/cleanup repair history), not as current setup instructions, available functionality or verification evidence. See [current removal and verification notes](browser-removal.md). Historical paths may no longer exist.


Status: implementation in progress. W5 is implemented and offline-tested; W6 live qualification and W7 final verification remain open. This document is a coding-agent handoff, not authorization to install, recover, publish, or run live browser qualification.

Parent requirements and historical evidence: [Browser Harness integration plan](browser-harness-integration-plan.md). The current follow-up ledger at the top of that document supersedes its earlier completion claims. Preserve the already-passing complete-bundle work; do not restart the integration from scratch.

## 1. Objective and boundaries

Finish the integrated Browser Harness delivery, remembered research profile, human challenge handoff, and release qualification. No separately installed Browser Harness CLI is required by the supported contained path. The legacy installer below is an older **Fabric user installer**, not a plan to ship Browser Harness as a separate product.

Non-goals: CAPTCHA solving/bypass, generated browser history, fingerprint rotation, personal-profile import, account login/Sync, unrestricted CDP, silent engine fallback, automatic retries, additional deferred recipes, changing the default Kiro agent, or publishing a release.

Keep ephemeral browsing as the default. A skill being shipped/discoverable does not mean its capability is enabled. Preserve honest deferred/unavailable responses for unsupported recipes.

## 2. Acceptance ledger and dependency order

| Work item | Parent gates | Required outcome | Dependency |
| --- | --- | --- | --- |
| W0: baseline | A22 | Completed serial check, or exact classified blockers with logs | First |
| W1: qualification/admission guard | A13/A14/A21 | Ephemeral evidence cannot enable unqualified remembered/manual behavior | W0 investigation |
| W2: legacy resource migration | A02 | Ownership-bound browser resources survive install/update/rollback independently of checkout | W0; preserve W1 admission |
| W3: persistent search owner | A11/A13 | Approved engine-scoped state survives browser restart; readers remain separate | W1 |
| W4: real human handoff | A14/A20 | Retained target, authenticated operator control, bounded traffic and acknowledged cleanup | W3 |
| W5: schema-3 release contracts | A21/A22 | Release tooling validates browser-capable artifacts and mode-specific evidence without weakening old gates | W1 evidence contract |
| W6: live qualification | A13/A14/A20/A21 | Exact-candidate browser and native Kiro evidence for each advertised target/mode | W2–W5 |
| W7: final verification | A22 | Completed full check, current artifacts and documented remaining restrictions | Implemented slices; W6 for release claims |
| R1: real-home recovery investigation | Installer prerequisite | Read-only diagnosis and separately approved supported recovery, if provable | Independent; not a prerequisite for disposable-home work |

Recommended coding order: W0 → W1 → W2 → W3 → W4 → W5 → W6 → W7. W5 can be developed after W1 while W2–W4 are in progress, but do not run competing builds/tests in the same checkout. R1 is a separate operator workstream.

Track each item as not-started, implemented/offline-tested, live-qualified, or blocked. Never equate those states. Record command, exit status, source/artifact identity, evidence path, and unsupported targets/modes. A failed baseline is not permission to broaden an unrelated patch: fix/classify failures and retain the release block until the full check completes.

## 3. W0 — establish a trustworthy baseline

### Steps

1. Read current repository instructions and inspect working-tree changes. Preserve all edits/staging. Do not commit without a separate explicit request; never push or publish.
2. Audit build/test cleanup scope. Fixtures containing Git metadata must be retained. Do not execute a helper whose production effects or cleanup can remove a repository.
3. Select an existing trusted standalone Node using the repository's local verification instructions. Inspect the executable/ancestry; do not repair unrelated permissions or weaken validation.
4. Ensure current build outputs exist before typechecking: some tests import `dist`. Do not run a build concurrently with typecheck, tests, staging, or certification.
5. Run trusted-Node `pnpm run check` with one generous outer shell budget, initially 3600 seconds. Keep `fileParallelism: false`; do not change production deadlines or widen test assertions to obtain a pass.
6. Capture the complete log and completed full-suite JSON report before targeted commands can overwrite it. If the outer budget is reached again, identify the active phase and task-owned process state before deciding whether a larger harness budget or a code fix is required. Never call a still-running job complete.
7. Classify failures as product, fixture, prerequisite, or timing-harness problems. Use focused reproductions and direct probes for fixes, then finish a full check.

### Exit criteria

- A reproducible baseline result exists; the previous 900-second timeout is not described as a passing suite.
- Fixture safety and trusted-Node prerequisites are recorded.
- No live browser, real installation recovery, or unrelated service mutation was performed by this step.

## 4. W1 — make capability claims and admission fail closed

### Files

`src/browser/evidence.mjs`, `src/browser/disclosure.ts`, `src/browser/profile-store.ts`, `src/kiro/mcp-server.ts`, `scripts/browser-operator.mjs`, `scripts/browser-evidence-driver.mjs`, and the related browser evidence/operator/component tests.

### Implementation

1. Define separate evidence requirements for ephemeral browsing, remembered-state use, and a real manual challenge window. Version the evidence contract if its meaning or required fields changes. Preserve valid historical ephemeral interpretation without upgrading it to remembered/manual qualification.
2. Treat the existing `manual-challenge-window` result as evidence of **registry/model-exclusion behavior only**. Retain the historical record and explain its scope; replace/supersede the claimed UI qualification only with a real run. Do not hand-edit a failure/deferred result into a pass.
3. Make `browser configure`, runtime admission, status, help, disclosures and skill availability agree on the selected mode. Reject unqualified remembered/manual use with actionable reasons; do not silently switch profiles or fall back to the external CLI.
4. Bind admission to the qualified target/backend/browser and relevant component/policy identity. A new operator-pinned browser hash alone must not inherit qualification from an unrelated binary. Define how changed builds require requalification.
5. Preserve existing profile data when rejecting old settings. If corrected persistence/disclosure semantics change consent, bump the profile policy revision and require explicit operator re-consent.
6. Keep status read-only: it must not spawn a browser or perform a network readiness probe.

### Checks

Extend `tests/browser-evidence.test.ts`, `tests/browser-operator-cli.test.ts`, `tests/browser-component.test.ts`, and `tests/browser-integration.test.ts` for mode-specific admission, legacy records, stale binary/component/policy identity, preserved data, and zero effects on refusal. Ensure fixtures representing qualified modes cannot enter production through a hidden bypass flag.

**Exit:** unsupported modes remain unavailable while W3/W4 are being built. Live qualification may exercise underlying components through an explicitly reviewed, task-owned driver; it must not add a production admission bypass.

## 5. W2 — migrate the legacy Fabric installer resource contract

### Files

`scripts/install-agent-user.mjs`, `scripts/validate-agent-package.mjs`, `scripts/agent-profile.mjs`, and, if staging layout changes, `scripts/build-agent-dev.mjs`. Keep the complete-generation implementation in `scripts/managed-installation.mjs` compatible.

### Implementation

1. Extend package validation to return a verified resource inventory: fabric-exec, the exact browser pack/catalog/license, and target-named browser evidence. Reject partial packs, unsafe paths, unexpected entries and evidence filename/target mismatches.
2. Design/version the **legacy installation ownership record** independently of bundle schema 3. Record resource hashes, modes and generation association. Historical installation schemas must remain readable under their original guarantees; do not retroactively claim ownership of previously unauthenticated bytes.
3. Prefer immutable generation-bound resource snapshots so active/retained runtimes do not pick up another generation's catalog or evidence. Document the fixed path layout, profile bindings and evidence lookup before coding. Do not solve discovery with source-checkout or current-working-directory fallback.
4. Stage all resource bytes under the existing transaction. Verify them against the validated package and recheck source identity before publication. Prepare profile links for the final owned locations, then verify those links against the actual copied candidate.
5. Extend commit, rollback, health/doctor and uninstall paths together. Refuse existing unowned targets and modifications. Preserve legacy evidence, active generations and durable browser data. Uninstall may remove only positively owned generated artifacts; repository fixtures and unknown paths remain protected.
6. Wire the verified evidence location into runtime discovery without allowing model-selected paths. Resource delivery alone must not enable browsing or invent the operator-control prerequisites of a complete installation.
7. Preserve exact old resource lists on historical paths. Standard/review profiles should include the nine bundled browser skills; minimal remains empty wherever that profile mode is supported.

### Checks

Extend `tests/agent-user-install.test.ts`, `tests/agent-doctor.test.ts`, `tests/hermetic-stage.test.ts`, `tests/review-profile.test.ts`, and `tests/fovea/packaging.test.ts`. Cover:

- Fresh install, idempotent update, old-to-new migration and retained generation behavior.
- Failure injection before/after resource publication and byte-for-byte rollback.
- Missing/changed catalog, license, evidence or secondary skill files; changed-then-restored source observations.
- Symlink/hardlink substitution, unsafe permissions/umask 0002, foreign targets and oversized inventories.
- Uninstall preservation of durable data and refusal to remove unowned resources.
- Actual installed profile URIs and evidence lookup after the task-owned acquisition directory is moved aside. Preserve that acquisition directory if it is a repository; never delete it as a probe.

**Exit:** source-independent legacy delivery works; `tests/bundle-schema3.test.ts` and real complete-bundle smoke/independence remain green. This does not independently qualify browser functionality.

## 6. W3 — implement persistent search ownership and reader separation

Detailed next implementation slice: [Q2/Q3 persistent owner and human handoff plan](browser-harness-q2-q3-implementation-plan.md). It covers W3/W4 together, including lifecycle and containment prerequisites; both remain planned until their acceptance checks are completed.

### Files

`src/browser/owner.ts`, `src/browser/host.ts`, `src/browser/session.ts`, `src/browser/operations.ts`, `src/browser/profile-store.ts`, `src/browser/launcher.ts`, `src/providers/web-provider.ts`, and `src/kiro/mcp-server.ts`.

### Architecture decisions

- Use the dedicated, consented engine profile for remembered searches; continuing to create/dispose private contexts cannot supply durable state.
- Use a separate clean browser owner for page reads and result-link inspection. Do not rely on an incognito tab inside the remembered process to prove profile-global separation.
- The persistent profile and control session belong to the host owner, not the model operation. Persistent state is not persistent network authority.
- Profile identity includes installation/operator scope, engine and policy revision. Cross-workspace sharing requires explicit scope consent; do not infer it from a pooled MCP process. Where trustworthy client association is absent, retain a conservative single-owner lease contract.

### Implementation

1. Replace hardcoded engine assumptions with one validated engine binding from configuration through consent, owner selection and search execution. Reject mismatches rather than choosing another profile.
2. Introduce an internal operation purpose/owner selection contract for ephemeral search, remembered search and ephemeral reading. Keep all owner/profile selectors host-owned; expose no arbitrary profile path or debugger endpoint.
3. Add an owner-managed persistent control session with per-operation, revocable broker grants. Change `BrowserHost.run`/session settlement deliberately: operation cleanup must close operation targets and revoke grants without destroying owner state; owner shutdown must drain both safely.
4. Attach containment before any page can emit traffic, including restored tabs, child targets, popups and new realms. Start from a controlled blank target; prevent unsolicited session restoration or background profile traffic. If containment cannot be maintained for persistent state, stop W3 and keep the mode disabled.
5. Retain only permitted engine state. Document actual retained cookies/storage/cache/history; never fabricate browsing history or promise Chrome stores no ancillary state. Keep cookie values and storage contents out of results, traces and operator status.
6. Enforce exclusive profile locks across processes/generations. Check browser/profile-format compatibility. On failed launch, crash/restart or cancellation, confirm the owned process is gone before releasing its lock; preserve the profile and fail closed if ownership is uncertain.
7. Revalidate consent/settings at operation admission and safe lifecycle boundaries. Revocation cancels remembered work and grants, stops the owned browser, and retains data. Settings changes must not alter an already-approved operation in place.

### Checks and probes

Extend `tests/browser-owner.test.ts`, `tests/browser-profile.test.ts`, `tests/browser-session.test.ts`, `tests/browser-operations.test.ts`, and `tests/browser-integration.test.ts`.

Use a controlled site/state marker in a reviewed live probe: approve state creation, close the owned browser, start a new owner, and verify the marker survives only in the intended remembered scope. A reader owner, another engine, an unconsented workspace and an ephemeral search must not inherit it. Also exercise simultaneous owners, crash/failed-launch cleanup, stale consent, policy changes and profile downgrade refusal.

**Exit:** offline lifecycle tests pass and a real restart-survival/isolation probe passes. If live evidence is unavailable, record implementation-only status and leave production remembered admission disabled.

## 7. W4 — implement a real, bounded human challenge window

### Files and new internal modules

Modify `src/browser/operations.ts`, `src/browser/handoff.ts`, `src/browser/host.ts`, `src/browser/session.ts`, `src/browser/owner.ts`, `src/browser/broker.ts`, `src/browser/outbound-policy.ts`, `scripts/browser-operator.mjs`, and the provider/CLI wiring as necessary.

Proposed new internal module under `src/browser/`: **owner-control.ts**. Add a matching focused test under `tests/` when implementing it. This is an owner-only control surface, not a guest/public CDP API.

### Lifecycle contract

```text
approved search
  -> classify challenge while the owned target still exists
  -> revoke search grant and pause/deny network activity
  -> acknowledge transfer to one bounded quarantined owner target
  -> return sanitized interruption + opaque handoff ID
  -> operator validates identity, sees disclosure and explicitly approves
  -> bounded manual lease + bring the owned target to the foreground
  -> finish / abort / expiry / revocation / owner death
  -> revoke authority, close target, acknowledge cleanup, retain allowed state
  -> consumed handoff; a retry needs a new approved search
```

If transfer or cleanup cannot be acknowledged, fail closed and report uncertainty. Do not leave an uncontrolled target or report successful cleanup. Ephemeral interruptions close normally and do not silently become persistent handoffs.

### Implementation

1. Move CAPTCHA/consent classification before `openAndEvaluate` disposes its context. Transfer target/session ownership before releasing the operation reservation; no original query grant survives completion. Bound pending targets and their lifetime even before the operator acts.
2. Bind handoffs to the actual owner instance/process generation, installation, profile, engine and immutable policy/consent revision. A null profile ID must not accidentally authorize another profile's target. Handoff IDs identify requests; they are not credentials.
3. Implement a private local control channel with verified private ancestry, authenticated operator/owner identity, bounded framing and deadlines, replay protection and strict verbs. Reject stale endpoints/PID reuse, foreign or symlinked paths, expired IDs and competing owners. Do not expose tokens, control endpoints or general commands in model output.
4. Extend `browser verify` with an unambiguous bounded begin/finish/abort flow. Update `scripts/installer-cli-contract.mjs`, manager dispatch, help, JSON output and installed-launcher tests together if grammar changes. No arbitrary trailing shell arguments.
5. Before beginning, show the exact additional disclosure and obtain real operator consent. Bring forward only the quarantined owned target. If the tab/token has expired or the owner is gone, refuse and request a fresh approved search; do not open another browser or reissue the query.
6. Give manual traffic a separate reviewed policy: exact required challenge origins/path rules, narrowly permitted methods/body sizes, redirect/request/byte budgets and deadline. Ordinary public operations remain GET/HEAD-only. Current broker accounting uses a header estimate and zero body bytes; implement bounded request/body accounting before permitting challenge POST traffic, without logging form contents.
7. Enforce lease exclusion at owner admission, not only the `web.search` provider check. Already-running, queued and alternative model browser operations must not read/evaluate/click/type/capture or acquire the same profile. Keep containment active while the human interacts; block unrelated navigation, popups, downloads, login and unreviewed endpoints.
8. Use an owner-driven expiry timer and idempotent cleanup, not expiry evaluated only on the next registry read. Serialize cross-process transitions. Owner shutdown/revocation aborts the lease; operator disconnect behavior must be documented and bounded. Preserve profile bytes, not pending authority.

### Checks and probes

Extend `tests/browser-handoff.test.ts`, `tests/browser-operator-cli.test.ts`, `tests/browser-broker.test.ts`, `tests/browser-session.test.ts`, and `tests/browser-integration.test.ts`; add focused owner-control tests. Cover replay/foreign-client denial, simultaneous verify requests, model exclusion through every entry point, expiry without another request, cancellation, crash, policy changes, unsafe endpoints, oversized traffic and failed cleanup.

Run a controlled human-interaction fixture first, then a separately operator-approved real provider challenge when available. A missing real challenge is not a pass. Required evidence shows the actual visible target, human action, bounded traffic, no model control, target closure and fresh approval before retry. Never capture sensitive form values or solve the challenge automatically.

**Exit:** real UI/traffic/lifecycle evidence replaces the registry-only claim. Unsupported provider flows stay unavailable; do not widen normal browsing to make them pass.

## 8. W5 — migrate release contracts to browser-capable bundles

### Files

`scripts/prepare-complete-release.mjs`, `scripts/complete-release-signing-inputs.mjs`, `scripts/complete-release-promotion.mjs`, `scripts/release-native-evidence.mjs`, `scripts/fovea-controls-probe.mjs`, `scripts/generate-bundle-sbom.mjs`, and their shared input/evidence validators as required.

### Implementation

1. Audit every schema-2-only branch in this execution path; distinguish bundle schema, installation ownership schema, evidence schema and release metadata schema. Do not replace all occurrences of the number 2.
2. Admit supported schema-3 artifacts while preserving parser/native-loader/Fovea checks, target compatibility floors, exact archive inventory, source provenance, hashes and signature binding. Preserve schema-2 historical validation where required; reject unknown schemas and downgraded browser-pack smuggling.
3. Extend/version qualification checks to bind browser target/backend/build identity, selected modes, containment, remembered isolation and human/Kiro approvals to the exact candidate. Old generic client or ephemeral evidence must not satisfy new browser/manual gates. Review the four existing release gates before adding fields; preserve their current meaning and raw witness binding.
4. Update signing-input collection, promotion validation and SBOM assertions coherently. Mutated evidence, wrong targets, mixed builds, partial packs and missing witnesses must fail before signing/promotion preparation.
5. Keep live records outside build feedback loops: browser containment records bind the browser/component/policy identity; post-build release witnesses bind the immutable final bundle/archive digest. Do not insert a bundle's own post-build qualification into itself and then claim its old digest is still qualified.
6. Update `docs/complete-bundle-release.md`, `docs/installer.md`, and `docs/linux-validation.md` with the actual capability matrix and remaining restrictions.

### Checks

Extend `tests/complete-release-inputs.test.ts`, `tests/complete-release-workflow.test.ts`, `tests/release-complete.test.ts`, `tests/release-native-evidence.test.ts`, `tests/release-capture-boundaries.test.ts`, and `tests/bundle-schema3.test.ts`. Use test keys/synthetic witnesses only for contract tests, explicitly labeled non-qualification. Never retrieve production signing credentials as part of development.

**Implementation status (2026-09-23): implemented/offline-tested.** Complete-release preparation, native/Fovea probes and signing/promotion require bundle schema 3. `browser` is a fifth mandatory gate for every target. Browser gate schema 2 now requires typed containment, installed and native-client roles. Its containment receipt is browser-evidence schema 3, bound to exact closure/component/browser/effective-policy/consent/scope identity; installed/native receipts bind the same archive/runtime/host and structural observation digests. Private input transport carries the gate and receipts. Synthetic four-target fixtures are explicitly non-live contract evidence. Eleven focused release suites (150 tests) passed, followed by trusted-Node `pnpm run check`: 249 files passed, 5 skipped; 3,799 tests passed, 91 skipped, with typecheck, build, dead-code lint, component-only MCP certification and agent SBOM successful. The certification reports `authenticatedKiro: NOT TESTED`; W6 exact-candidate live qualification remains required.

**Exit:** schema-3 preparation and negative validation tests pass. Distribution remains blocked until exact-candidate live qualification and required independent operator review. This plan does not authorize signing, remote updates, release publication or Git pushes.

## 9. W6 — run separate browser, installed-byte and native Kiro qualification

Detailed scope and implementation sequence: [W6 exact-candidate implementation plan](browser-harness-w6-implementation-plan.md). Q0 admission and Q1 identity/release contracts are implemented and offline-tested: current schema-3 settings are engine/code/policy/consent/flags/browser/evidence bound, historical settings fail closed, and release gates require three typed roles. Remembered search still uses disposable contexts and real manual owner control is unavailable, so finish W3/W4 before the live campaign. The former native-acceptance script is now a no-browser, fail-closed component MCP smoke with explicit `authenticatedKiro: false`; it is not native Kiro evidence.

1. Audit `scripts/browser-evidence-driver.mjs` and `scripts/run-browser-native-acceptance.mjs` effects before use. They are opt-in live tools, not ordinary unit tests. Obtain operator approval for browser execution and any public requests.
2. Requalify corrected ephemeral/remembered/manual behavior on each advertised target: darwin-arm64, darwin-x64, linux-arm64, linux-x64. Use real native hosts and record OS/libc, Kiro, browser binary, flags and code/policy identity. Synthetic fixtures do not replace unavailable hosts.
3. Complete deferred containment checks needed by persistent operation, including controlled HTTPS redirect revalidation and restored/background state. Demonstrate that service-worker/new-target paths cannot bypass policy; supporting service workers is not required if disabling them remains the reviewed design.
4. Distinguish containment from usability. A correctly reported CAPTCHA/HTTP 429 passes interruption handling, not useful search. Record successful search, blocked search, provider restrictions and unsupported modes separately. Do not retry aggressively or claim CAPTCHA-free use.
5. Build/freeze the candidate, then perform installed-byte independence and native Kiro checks against that exact artifact. Use a disposable explicitly owned Kiro home/workspace with supported authentication setup; never copy credentials or personal browser profiles from the real home.
6. Verify real `kiro-cli chat --v3 --agent kiro-fabric ...` routing with chat options after `chat`. Inspect selected-agent and `@fabric/fabric_exec` events plus nested browser calls. Raw MCP auto-approval drivers, startup token counts, doctor output and assistant prose are not native UI evidence.
7. Exercise skill selection, accepted/declined browser approval, authoritative model-visible tool filtering, CAPTCHA/consent presentation, manual handoff, explicit reapproval, cancellation, workspace revocation, resume and shutdown. Do not infer native session affinity from a pooled MCP process.
8. Store sanitized witnesses with artifact identity and per-target/per-mode results. Keep private traces private. Unsupported targets/modes remain fail-closed; if the release policy requires all four targets, missing a target blocks promotion rather than silently reducing the gate.

**Exit:** A13/A14/A20/A21 are marked live-qualified only for modes/targets with actual evidence. Real-home recovery is not required to run isolated qualification.

## 10. W7 — final checks and handback

Run the smallest tests for each slice while developing. Before final handback/release qualification:

1. Confirm all new internal/public symbols, imports, exports, guest types, configuration entries, CLI registrations, profile resources and build/package inventories mechanically. Avoid adding a model-visible handoff-control API.
2. Run trusted-Node `pnpm run check` to completion, serially, after the latest implementation changes. Preserve its full report before any focused run. Re-run only what changed during iteration, but obtain one final completed full gate.
3. Verify real staged-bundle smoke and isolated-home installation with current bytes, not an earlier build. Keep component-only certification distinct from authenticated Kiro certification.
4. Rebuild with `pnpm run build` before handing changes back. If a rebuild changes qualified artifact bytes, invalidate that artifact's old qualification and regenerate the affected witnesses; do not reuse a stale digest.
5. Update the parent acceptance ledger with exact current evidence, implemented versus enabled behavior, remaining blocks, generated artifacts and preserved edits. No inherited test counts or implied full-suite pass.

Suggested focused suites are listed within W1–W5. Audit their cleanup before execution. Apply one outer timeout in seconds to long suites; inspect settled tool results (`ok`, `output`, `exitCode`) and live-process notices. Keep production timing bounds exact and cold-start fixture budgets separate.

## 11. R1 — real-home recovery: independent, gated workstream

Saved evidence: the previous source dry-run returned exit 7 because of a directory-identity device mismatch without stable-volume evidence. Its output is not proof of a corrupted installation or permission to repair identity metadata. A dry-run also returns before candidate construction and cannot certify installation.

1. With explicit operator authorization, inspect only the relevant ownership/transaction records and filesystem identity read-only. Do not read cluster credentials, browser profile contents or authentication material.
2. Trace the refusing record through `scripts/installer-directory-identity.mjs`, `scripts/install-transaction.mjs`, and `scripts/managed-installation.mjs`. Distinguish legacy dev/inode evidence from stable-volume-bound evidence.
3. If prior evidence cannot prove directory continuity, keep the refusal. A matching inode alone or a newly observed volume UUID must not be retroactively substituted into an old record.
4. Reproduce any proposed product defect with disposable fixtures in `tests/installer-directory-identity.test.ts`; implement a correction only if it preserves the ownership proof. Never relax the check to unblock this home.
5. Present a separate supported recovery procedure, affected paths, expected mutations and evidence-preservation strategy for approval. No journal/backup deletion, identity editing, profile overwrite or recovery execution is authorized by this plan. If continuity cannot be proved, stop and report that no safe automatic recovery is established.
6. Only after separately approved recovery succeeds, rerun the real-home source dry-run. Treat actual activation as another explicit operation, not a consequence of planning or a successful preview.

## 12. Stop conditions

Stop rather than weakening controls if persistence permits unmediated background traffic, a human challenge requires unreviewed endpoints/effects, native Kiro cannot prove correct approval routing, a target/browser build lacks qualification, ownership cannot be authenticated, cleanup threatens repositories/unknown data, or historical installation evidence cannot be preserved.

The intended outcome is integrated, useful and explicitly consented research browsing—not anti-detection tooling or a claim that the browser transmits no information.
