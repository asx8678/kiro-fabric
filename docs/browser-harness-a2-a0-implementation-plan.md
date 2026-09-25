# A2 owner-wide mediation and native A0 feasibility: implementation plan

> **Historical / superseded by Browser Harness removal.** Browser implementation, CLI/provider entry points, bundled skills and execution qualification described below are no longer shipped. This document is retained for provenance (including unrelated verifier/cleanup repair history), not as current setup instructions, available functionality or verification evidence. See [current removal and verification notes](browser-removal.md). Historical paths may no longer exist.


**Post-cleanup ordering:** follow the [cleanup repair and containment plan](browser-repair-containment-plan.md) before resuming implementation here. Test-suite and worker-dispatch statements below describe the pre-cleanup checkpoint unless explicitly updated. The suite and dispatcher were removed; current behavior must be rebaselined. The CDP-only no-go remains unchanged.

Status: **T1 authority and selected fail-closed T4 accounting hardening are implemented/offline-tested. Full A2 remains blocked: source review establishes an A0 no-go for the current CDP-only backend's preventive wire-byte and actual-peer guarantees. No native experiment was run, and remembered/manual modes remain unavailable.**

This expands A2 and the still-open native A0 gate in the [Q2/Q3 implementation plan](browser-harness-q2-q3-implementation-plan.md). A0's offline lifecycle contracts and A1's ownership cleanup are the starting point, not proof of browser-wide containment. See also the [containment decision record](browser-isolation-design.md) and the [W6 qualification plan](browser-harness-w6-implementation-plan.md).

## 0. Current implementation and stop decision

The safe subset implemented from this plan is deliberately narrower than full A2:

- `ActionRegistry` prepares immutable browser review facts from canonical arguments, includes them in the real approval, and mints an opaque `WeakMap`-backed one-shot receipt only after approval succeeds. Denied approval mints nothing; registry/host completion revokes the receipt.
- Both contained provider paths require that exact receipt. `BrowserHost` consumes it only after queue admission, independently rechecks effective policy, profile mode and remembered caller scope, then issues a deadline-bound operation lease. The pre-cleanup worker dispatcher required a trusted admission dependency; that dispatcher and protocol were subsequently removed. The current in-process path retains `RECIPE_OPERATIONS`; it is not a working worker-frame dispatcher.
- Attached-page operations now require explicit gate and lease objects. Navigation is validation-only; actual paused requests carry complete bounded CDP-visible URL/method/header/body descriptors, redirect hops are revalidated and charged, and any policy/accounting/budget failure terminally faults the lease. Final response accounting is checked before success, and interception remains installed until target/context closure is acknowledged.
- Before cleanup, offline tests covered missing/forged/replayed/mismatched receipts, approval timing, non-browser compatibility, scope/policy/mode drift, worker denial, exact request/redirect charging, malformed accounting, late response failure, revocation and cleanup ordering. Those files were deleted. These results are historical; the repair plan requires current focused behavioral verification.

The full design cannot pass the mandatory A0 gate with the current backend. CDP request metadata is not a preventive TLS/on-wire byte ceiling; `Network.loadingFinished.encodedDataLength` arrives after transfer and does not completely account for opaque/cache/service-worker/streaming cases. Hostname syntax or a separate DNS lookup also cannot bind Chrome's actual connected peer before emission. The current attached-page broker additionally does not prove deny-before-start coverage for startup, restored/background and all nested realms. These are mechanism gaps, not missing test runs.

Accordingly T2's positive owner-wide coordinator, T3's native driver and positive T4 capability work were not used to promote this backend. Building more fake target coordination cannot make the missing wire/peer mechanisms true. The next step is a separately reviewed architecture change that supplies externally enforceable egress/byte controls while preserving the browser behavior requirement, followed by a new exact-candidate native plan. Existing ephemeral behavior retains only its historical declared semantics; changed code requires fresh qualification. No feasibility report, settings or production admission was created.

Pre-cleanup ledger result: M1 and M11 were implemented/offline-tested; M2, M5 and M7–M10 had useful attached-page coverage but remained partial; M3, M4, N1–N4 and full parent P2/P7 were not satisfied. This plan's R1 was previously checked by 253 passing test files (3,850 passing tests; 91 skipped); that result is not certification of the post-cleanup tree. Rebaseline under the repair plan's separately named R0–R4 packages. Native results remain `not-run`.

## 1. Objective and delivery boundary

Implement a host-owned, deny-first mediation lifecycle with revocable operation authority. Build a safe controlled experiment that can decide whether the current backend can enforce the required network contract. Do not start persistent production routing or human handoff merely because the offline coordinator works.

Deliverables:

1. An owner-lifetime target/request coordinator, independent of individual operation lifetimes.
2. Host-derived, non-forgeable operation grants bound to approved input, current owner and trusted scope.
3. Immediate terminal propagation of request/response/accounting failures and race-safe revocation.
4. A fixed-operation, opt-in native feasibility driver with safe supervision, useful positive controls and a non-qualifying report format.
5. Offline acceptance evidence for the implementable P2/P7 contract, with P3/P4 regression coverage.
6. Honest capability/admission/status documentation and an explicit go/no-go/inconclusive architecture decision.

### Not included

- A3 persistent default-context search routing, separate reader process routing, scoped-consent migration or cross-process consent notification. A2 defines their hooks and refuses missing required authority; it does not mark P1/P5/P6 complete.
- A4/A5 retained challenge targets, operator IPC, manual POST policy, UI control or CAPTCHA handling.
- Personal profile discovery/import, account login, Sync, fake history, fingerprint spoofing or automatic CAPTCHA solving.
- New model-visible CDP, JavaScript, owner, profile, grant or diagnostic execution tools. Do not enable more recipes.
- A new proxy, TLS interception, privileged helper, firewall change, VM or infrastructure deployment. An architecture change requires a separate decision and scope.
- Installation, native Kiro authentication/approval capture, signing, publication or the four-target/twelve-cell W6 release campaign.
- Any live browser or external traffic during normal unit tests, build, preflight or plan-only work. A plan is not authorization to run its native steps.

Existing ephemeral operations must retain their public argument/result contracts, not an unsafe internal path. If the stronger mandatory enforcement cannot support a path, refuse it accurately. Never keep an ungated compatibility fallback to make tests or old evidence pass.

## 2. Verified starting point

Recheck these named symbols against the current worktree before implementation; line numbers will drift.

| Source seam | Current behavior | A2 consequence |
| --- | --- | --- |
| `src/browser/lifecycle.ts`: `BrowserAuthorityCoordinator.issue` | Lease contains an incrementing ID and frozen purpose/engine; it has no approval, scope, generation or budget binding | Extend authority semantics; the ID alone is not a capability |
| `src/browser/host.ts`: `BrowserHost.run` | Acquires a slot, issues a lease, connects a new `ManagedSession`, executes, revokes and settles | Separate owner control from operation cancellation; move grant activation after readiness/revalidation |
| `src/browser/owner.ts`: `host`, launch transaction | Owns process/profile and exposes a transport that operation sessions open; running follows endpoint/supervisor setup | Publish readiness only after coordinator installation; never confuse endpoint availability with containment |
| `src/browser/operations.ts`: `openAndEvaluate` | Creates disposable context/target, optionally attaches a page broker and charges navigation before interception | Require the host operation lease, centralize target registration and remove double charging |
| `src/browser/broker.ts`: `attach`, `detach`, request/response handlers | One attached page, JS API stubs, truncated request URL, estimated headers, zero body, swallowed response overrun; detach assumes Fetch behavior | Replace these assumptions with explicit contracts and terminal failure handling |
| `src/browser/outbound-policy.ts`: `OutboundGate` | Redirect helper is not integrated; hostname syntax is not connected-address protection | Add correlated accounting; keep destination enforcement gaps explicit |
| `src/browser/worker-core.ts`: `WorkerCore.handleFrame`, `RECIPE_OPERATIONS` | Direct worker dispatch does not require a grant; no production `new WorkerCore` caller was found | Require a trusted dispatcher/capability before future wiring; do not add grants to guest frames |
| `src/core/action-registry.ts`: `invoke` | Freezes normalized arguments before approval, awaits `context.approve`, then calls the provider | This is the approved-dispatch boundary; providers cannot manufacture proof just by hashing arguments |
| `src/protocol.ts`: `FabricInvocationContext` | Has cwd, signal and deadline, but no browser approval receipt or trustworthy client-scope field | A host-only authority bridge is required; cwd/PID are not client identity |
| `src/browser/qualification.ts`, `src/browser/evidence.mjs` | Policy says disposable state, attached-page coverage and Fetch-finished accounting; strict schema validates these fields | Revise semantics deliberately, not by flipping capability strings |
| `scripts/browser-evidence-driver.mjs` | Historical schema-1 launch/evidence/cleanup path; no current required intent on old `host.run` calls | Do not run or promote it as the new driver |
| `scripts/run-browser-native-acceptance.mjs` | Component-only staged MCP negative smoke, explicitly no live browser | Keep its purpose; it is not A0 containment evidence |

The broad worktree already contains unrelated and preceding browser work. Preserve it. No resets, cleanup of repository fixtures, local commits without request, or remote publication.

## 3. Non-negotiable design contracts

### 3.1 Three lifetimes, not one

- **Owner lifetime:** exact browser process incarnation/generation, pinned transport/control session, profile lock, target registry, deny-default brokers, global terminal-fault channel and supervisor. Survives normal operation completion, never control loss.
- **Operation lifetime:** immutable admitted authority, one absolute monotonic deadline, operation budgets, abort controller and its own resource leases. Revoked synchronously before asynchronous cleanup or result publication.
- **Target lifetime:** explicit association with one owner generation, context and target/session identity. A target is either installing, denied, bound to an active operation, closing, closed or uncertain. Being known is not authorization.

A2 implements no usable manual/quarantine transfer. It may reserve an internal ownership state for later work, but must close or retire an unsupported retained target rather than report a pending handoff.

One operation's cancellation must not close a shared control connection and leave a live unmediated browser. Control loss revokes all operations and invokes the exact A1 supervisor. Failed target cleanup retires the affected owner when safe continuing mediation cannot be confirmed. Keep locks/data on uncertainty.

### 3.2 Grant contents and provenance

Proposed extension of the existing internal lease (names may be refined once in the contract slice):

- Opaque capability checked by registry membership/object identity, not a caller-supplied integer or serialized object.
- Unique invocation identity and digest of the frozen approved arguments plus reviewed browser authority snapshot.
- Owner generation/incarnation, effective profile mode, purpose, fixed operation/recipe and engine where relevant.
- Installation and trustworthy canonical workspace/client association when required by that mode. An explicit admitted ephemeral scope must not be silently promoted to persistent scope.
- Effective policy hash and, where applicable, consent identity/revision.
- Absolute monotonic deadline, revocation epoch and one shared operation budget ledger.
- Required operations equivalent to `assertActive`, `fail`, `revoke` and bounded settlement. Keep these host-only.

The immutable snapshot must be prepared before approval, included in the reviewed authority identity, and sealed only after the real host approval boundary succeeds. Restricted-web exact approval remains mandatory even with blanket network allow. Missing approval/scope does not become `internal-test` or an implicit allow.

Revalidate after dequeue, after shared startup, immediately before activating a grant and at every request continuation boundary. Policy/scope/consent change invalidates the pending grant; it does not rewrite the already-approved snapshot. A3 will supply durable scope migration and revocation notifications. Until then, unsupported persistent scope remains blocked.

Use a per-invocation host context, not mutation of a shared context that concurrent calls could overwrite. Do not serialize receipts into guest values, worker frames, logs or provider results. Synthetic receipts are created only by explicit offline fixture dependencies or the separate fixed native harness, never by a production environment/configuration flag.

### 3.3 Request commit and revocation

Policy checking may await host work. The final check of generation, lease identity, epoch, scope validity and deadline must occur at the actual transport-send boundary for `Fetch.continueRequest`, with no intervening await or uncontrolled send queue. If transport queues commands, epoch validation belongs at queue commit too.

Revocation synchronously marks authority dead and prevents all new commits. Track previously committed/in-flight traffic separately: a command already sent cannot be unsent. Do not describe an abort request as proof that all previously emitted bytes stopped. Acknowledged target/process stop and native observation establish the stop boundary.

A malformed event with no safely addressable request ID is a control fault, not an ignored event. Broker event handlers must consume their async failures and fault the owner/operation; never create an unhandled rejection or swallow uncertainty.

### 3.4 Byte and destination contracts must be honest

Before positive traffic, write down the exact required unit, measurement source, completeness marker and enforcement point for each quantity:

| Quantity | Required treatment |
| --- | --- |
| Request count | One admission charge per actual request attempt; navigation preflight is validation-only |
| Redirects | Track protocol request/hop lineage, revalidate every hop, charge one request plus one redirect per followed hop |
| Outbound bytes | Define request-line/URL, headers (including browser-added cookies/auth), body and encoding semantics; reject unknown measurement, never substitute 1,024/zero |
| Response bytes | Distinguish wire/encoded/decoded/application measurements; correlate incremental and terminal observations without double counting |
| Streaming/opaque/cache/SW/compressed responses | Explicit supported accounting or refusal, never infer zero from missing/zero terminal data |
| Destination | Define public-address rules and binding to Chrome's actual connection across redirects, DNS changes, IPv4/IPv6 and connection reuse |

Diagnostic counting is not preventive enforcement. `Network.loadingFinished` can detect an overrun after transfer; `Network.dataReceived` and Content-Length alone also cannot prove a hard pre-wire ceiling. Separate DNS resolution or post-connection IP reporting does not pin Chrome's actual peer before effects. Do not rename these into `network-wire-v1`.

If the required bound/protection has no enforceable implementation, record an A0 no-go and keep the affected modes unavailable. Offline denial/accounting hardening can still be useful; it must not imply the full P2/P7 native contract is satisfied.

## 4. Acceptance ledger

Every row starts **planned**. Record implementation/offline result and native result separately, with test names/report references. Parent P2/P7 cannot be closed by a passing subset.

| ID | Concrete check | Smallest evidence | Parent mapping |
| --- | --- | --- | --- |
| M1 | Forged/missing/stale/mismatched grants refuse before target creation or request continuation | Authority/provider/registry unit tests | P2, prerequisites for P6 |
| M2 | Dequeued work rechecks reviewed scope/policy/consent and original deadline | Deferred queue/startup tests | P2/P3 |
| M3 | Root/nested/restored targets remain denied until supported mediation is acknowledged | Ordered multi-session fake CDP | P2 |
| M4 | Every realm is mediated or explicitly refused; no URL-based grant inheritance | Target-type matrix and controlled native observations | P2 |
| M5 | Revocation wins over pending async decisions; stale-generation events cannot act | Send-order and epoch-race probes | P2/P3 |
| M6 | Owner control loss revokes all leases; operation cancellation preserves shared denial | Fake transport and exact supervisor regression tests | P2/P3/P4 |
| M7 | Initial request is charged once; redirect count/method/budget rules are exact | Redirect lineage and event-order tests | P7 |
| M8 | Missing/unknown/oversized request or response accounting refuses or terminally faults current work | Body/header/stream/cache/opaque/compression fixtures | P7 |
| M9 | Last-response budget failure cannot return success; bounded response settlement precedes result | No-next-request, late-event and fault-vs-result tests | P7 |
| M10 | Interception remains active until target closure/owner termination is acknowledged | Detach/close failure ordering plus native Fetch shutdown experiment | P2/P4 |
| M11 | Production registry, both providers and worker seam cannot select fixture authority | Public symbol/schema and negative dispatch tests | C1/P2 |
| M12 | Synthetic/old/mismatched/feasibility reports cannot qualify runtime admission | Evidence/admission/operator tamper tests | C2 |
| N1 | Preflight is non-launching; driver rejects unsupported host, paths, identities and budgets | CLI/module/cleanup tests with fake launchers | C1/P4 |
| N2 | Native observations have positive controls and detect startup/idle/realm/stop leaks | Authorized native feasibility report | A0; supports later Q4 |
| N3 | Hard-byte/destination guarantees have a mechanism and observation coverage, or explicit no-go/inconclusive | Measurement design plus controlled probe | A0/P7 |
| N4 | Driver retains artifacts/uncertain ownership and cannot become a production bypass | Subprocess failure matrix, inventory and admission checks | P4/C2 |
| R1 | Existing queue/launch/lock/late-creation cleanup contracts remain intact | Browser lifecycle/owner/profile/session/cleanup suites | P3/P4 |

## 5. Ordered implementation work packages

### T0 — Freeze contracts and feasibility claims

**Dependencies:** none. **Effects:** source/doc review only.

1. Re-trace registry approval → provider → host queue → owner launch → target → broker → result/settlement. Identify every use of `BrowserHost.run`, `RECIPE_OPERATIONS`, `readPage`, `RequestBroker` and worker dispatch.
2. Update the containment decision record with a per-channel mechanism table: pre-attach startup; existing/restored pages; nested/OOPIF; dedicated/shared/service workers; popups; downloads; WebSocket/WebTransport/WebRTC/other non-Fetch traffic; idle; control loss; shutdown. Each row is enforced, denied, unsupported or unproven, with its evidence requirement.
3. Define the exact byte/destination table in section 3.4. Known source-level impossibilities can establish no-go without running a browser. Do not require a risky experiment to rediscover a demonstrated limitation.
4. Agree the host-only authority bridge and review-material snapshot. Do not widen this into a generic authorization-framework refactor.
5. Write failing negative tests and inventory the exact gaps before replacing behavior.

**Files:** existing parent/design docs; `tests/browser-lifecycle.test.ts`, `tests/browser-broker.test.ts`, `tests/browser-worker-core.test.ts`.

**Exit:** reviewed contracts and a list of falsifiable probe claims. If a mandatory guarantee is impossible, stop positive-path work and prepare an architecture decision; continue only useful deny-first hardening with the blocker explicit.

### T1 — Approved invocation authority and deny-first grant lifecycle

**Dependencies:** T0. **Effects:** offline code/tests only.

1. Extend `BrowserOperationIntent`/`BrowserOperationLease` and `BrowserAuthorityCoordinator`; require immutable admitted bindings, opaque membership checks, synchronous revocation/terminal failure and deadline enforcement. Budget state belongs to a grant, not to an individual attached frame.
2. Add a small internal authority module, proposed `src/browser/invocation-authority.ts`. It prepares the browser snapshot before approval and seals a receipt after approval. Separate preparation from the ability to mint an approved receipt; adapters do not get the latter.
3. Integrate at the frozen-canonical-args and successful-approval boundaries in `src/core/action-registry.ts`, with a host-only optional context facility in `src/protocol.ts`. Restrict activation to resolved browser-emitting actions; non-browser providers retain their contract. Build a fresh context per invocation, never mutate the shared context.
4. Wire trusted runtime/workspace/client facts from `src/kiro/runtime.ts` and `src/kiro/mcp-server.ts`; extend review material through `src/kiro/power/approver.ts` and `src/browser/disclosure.ts` where necessary. Preserve denial for unassociated clients. Do not derive trusted client scope from cwd, PID, a model field or a request ID alone.
5. Both browser providers pass the sealed authority to `BrowserHost.run`. Providers may derive operation intent but cannot certify approval. Verify canonical engine/recipe agreement, including Google-only gnews. Direct adapter tests must explicitly construct test authority.
6. Reject queued work when the snapshot no longer matches; do not repeat prompts, silently normalize again, downgrade modes or fallback engines. Activate only against a current ready owner generation.
7. Make recipe/worker execution require an admitted host operation context. `WorkerCore` accepts a trusted fixed-operation dispatch dependency or refuses execution without it; the wire protocol gains no authority fields, arbitrary CDP or configuration overrides.

**Primary files:** lifecycle/host; new internal authority module; protocol/action-registry; providers; Kiro authority/context/disclosure seams above.

**Tests:** M1/M2/M5/M11; browser lifecycle/worker/disclosure/approval-projection tests; add `tests/browser-invocation-authority.test.ts` for per-call receipt provenance, concurrent calls, denied/cancelled approval, argument/policy mutation, wrong owner/scope and forged ID cases. Expand registry/MCP tests only for the new bridge.

**Exit:** no production adapter can execute from purpose/engine alone. Unsupported persistent scope still refuses; P6 remains open until A3 and native Kiro evidence.

### T2 — Owner control session and deny-first target coordinator

**Dependencies:** T1. **Effects:** offline implementation and fake transports. This stage is not production persistent enablement.

Proposed future module name: **src/browser/target-coordinator.ts**. Add a future **tests/browser-target-coordinator.test.ts**; extend `tests/browser-fake-chromium.ts` to model multiple flattened sessions and delayed replies.

1. Move the long-lived control session under the owner runtime generation. Install its listener before discovery/auto-attach commands; publish host readiness only after the chosen containment setup acknowledges. Do not issue an active network grant merely because launch succeeded.
2. Register root, context, target, parent target and session associations explicitly. Key identities with owner generation; handle duplicate, late, out-of-order and missing events. Bound registry/tombstone/pending-decision sizes and fault on overflow.
3. Install supported root auto-attach with paused new targets, recursively configure nested sessions where required and reconcile existing targets without a discovery gap. Specify handling for events arriving before the corresponding create/attach reply. Existing unpaused/restored targets that cannot be safely contained force refusal/retirement.
4. Sequence each supported attachment: observe paused → register denied → install request mediation and required domain settings → bind an explicit host-created operation association → recheck authority → acknowledge permitted resume. No inferred authorization from URL, opener alone or ambient current operation.
5. A child realm may use an operation only through validated parent/context lineage and explicit coordinator policy. The operation's shared budgets/deadline still apply. Unknown/orphan/background/service-worker targets remain denied and close, or fault the owner when denial is unprovable.
6. Keep JS networking stubs, if useful, as defense in depth only. Document channels they cannot cover. Do not claim that auto-attach or all-frame script injection blocks pre-attachment or browser-process traffic.
7. Refactor `ManagedSession` resource ownership so operations settle only their own resources; owner control survives. Preserve A1 late-creation tombstones and generation fencing. No `session.interrupt()` of the shared control channel for ordinary cancellation.
8. Result/abort path: revoke grant → fail/drain pending requests → close owned targets/contexts and confirm → release operation slot. Remove broker listeners only after closure is proved. Uncertain close/detach invokes owner retirement; no optimistic success.
9. Control loss, failed interception setup, missing child identity or fatal broker failure: revoke all grants, reject queued work, invoke the existing exact process supervisor, await exit, preserve locks/profile on uncertainty. Do not add a second kill/cleanup implementation.

**Other files:** owner/host/session/broker/operations; process-supervisor only if a demonstrated integration defect requires it.

**Tests:** M3–M6/M10/R1. Cover operation A cancellation while B/idle denial remains controlled, partial attach, stale generation, late target creation, registry limits, context disposal failure and process-exit races.

**Exit:** deny-first coordination works through fakes and existing clean operation semantics are preserved or accurately blocked. Native startup/realm/destination claims remain unresolved.

### T3 — Safe native A0 driver and offline driver acceptance

**Dependencies:** T0 contracts and T2 production seams. **Effects:** build driver and test with fakes; do not launch Chrome.

Proposed files:

- **scripts/browser-feasibility-driver.mjs**: proposed manual-only strict CLI/preflight/report orchestration.
- **src/browser/feasibility-entry.ts**: proposed private build entry exposing only the fixed experiment operations needed by this driver; not exported by `src/index.ts`, operator API, MCP or guest bootstrap.
- **src/browser/feasibility-report.mjs**: proposed strict non-qualifying report validator, reusable by driver tests without running the CLI.
- **tests/browser-feasibility-driver.test.ts**: proposed CLI, report, effects and failure tests.

Keep the entry in a development-only build path outside production `runtimeAssets`. Use the existing build tooling to bundle a fresh private entry and closure under an identified `.tmp/browser-feasibility/<run-id>/` directory, without runtime source fallback. Bind every experiment dependency and fixture in the report digest. If an entry must ship later, that is a separately reviewed manifest/validator change, not an implicit addition here.

1. Audit and reuse the A1 owner/supervisor/owned-cleanup seams; historical script cleanup is not an acceptable template. Record ownership immediately after spawn, including endpoint timeout and partial-launch failure.
2. Define a strict CLI with `--preflight --manifest=<path>` and a separate explicit `--run --manifest=<path>` action. No implicit run on missing flags/import, generic JS/URL execution, environment bypass or ordinary package-test hook. These are proposed commands until implemented.
3. The immutable operator manifest declares native target/browser, private output/profile root, exact synthetic fixture identities, approved observation methods, case IDs and per-case/total limits for wall time, requests, bytes and process count. Validate positive bounded safe integers; missing budgets refuse, never choose unlimited defaults. No model budget or Kiro authentication is needed.
4. Preflight validates paths/ownership, executable identity, target equality, display requirements if applicable, fixture/observer readiness metadata and capacity. It must not launch the browser, bind/connect to sites, install, change network settings or silently repair permissions. Report any prerequisites that require separate setup.
5. Start authorized sinks/observers before any browser exists. Fixed harness-only authority may address exactly the manifest fixtures, including a denied-destination canary. This exception is unavailable to production factories, schemas and settings; production policy remains unchanged. Report the fixture-policy delta explicitly.
6. Use shared production coordination/mediation/supervision code, not a parallel broker. Do not synthesize schema-3 operator evidence to get through production admission. The private entry supplies bounded experiment authority directly to lower-level seams and remains unusable as a production enablement route.
7. Capture exact identity before launch and verify it has not drifted after the run. Use unique run/profile IDs; all timestamps, case outcomes and errors are bounded/sanitized. No profile contents, cookies, tokens, raw bodies, CDP URLs or personal identifiers in shareable output.
8. Require positive controls proving fixture reachability and observation. Attribute their traffic separately from denial windows. A zero canary count alone cannot establish absence of traffic to unrelated destinations.
9. Preserve the run directory, profile, partial report and cleanup evidence by default, including on success. Never use raw recursive cleanup. Stop only positively identified task-owned processes; if stopping cannot be confirmed, report uncertainty and preserve recovery controls.
10. Use bounded atomic result writes under verified private ancestry. Failure to write the final report must still leave bounded partial evidence and trigger owned-process settlement. No test helper that deletes repositories.

**Offline exit:** N1/N4 and M12 pass without real browser/network effects. Driver import/preflight tests assert zero launch/connect calls; denied unknown flags, symlinked/replaced paths, mid-run identity changes, observer failures, signal interruption, spawn errors and cleanup uncertainty are exercised.

### G0 — Separately authorized native A0 stop/go experiment

**Dependencies:** T3 offline acceptance plus an explicit operator-approved manifest, available native browser and approved fixture/observation setup. If authorization/setup is absent, stop here with the driver ready and results `not-run`.

Use one exact native host first. Do not infer support for other targets. The initial cases can disprove feasibility quickly; a failure can stop further traffic while cleanup/evidence collection still completes.

| Case | Required observation/decision |
| --- | --- |
| G0-01 controls | An allowed synthetic request is seen with expected identity/count/bytes; the denial observer detects a separately permitted positive-control emission |
| G0-02 cold start | Observe the complete interval before CDP attachment and before any grant, not only a snapshot after readiness |
| G0-03 warm restore | Using only task-owned nonsecret fixture state, restart and observe restored targets/service-worker/background attempts without authority |
| G0-04 realm matrix | Exercise page/subframes/OOPIF/popups/dedicated/shared/service workers and supported non-Fetch channels; unsupported attempts must be denied or force refusal |
| G0-05 idle/revoke | Trigger delayed work while idle and revoke during a pending policy decision/in-flight request; distinguish no-new-commit from acknowledged stop |
| G0-06 redirects/destination | Controlled redirect chains and DNS/peer changes reach only approved sinks; no real private, metadata, admin or cluster endpoints |
| G0-07 byte semantics | Controlled body/header/cookie, unknown-length, opaque, cache/SW, compressed and streaming cases compare claimed enforcement to independently observed bytes |
| G0-08 teardown/control loss | Observe outstanding Fetch handling, target closure, connection loss, owner/browser failure and exact process-tree settlement; do not assume Fetch.disable semantics |

Fixtures need reviewed HTTPS/DNS/certificate arrangements consistent with the claim. Do not disable certificate verification globally, alter system trust/DNS/firewalls or provision services implicitly. If comprehensive unprivileged observation is unavailable, report the affected claim inconclusive; do not invoke privileged capture without separate authorization. Sink observations must disclose their coverage boundaries and unobservable traffic/classes.

Decision rules:

- **No-go:** witnessed unmediated traffic, missing preventive destination/byte enforcement, unsafe ownership, or another mandatory-contract failure. Retain artifacts, keep modes blocked and propose a separate architecture decision. Do not fix by widening destinations, adding retries or weakening budgets.
- **Inconclusive:** absent/broken positive control, inadequate observation coverage, unavailable case/fixture or ambiguous lifecycle evidence. Treated as blocked, not partial qualification.
- **Go-for-development:** every mandatory case for this exact experiment has both an enforceable mechanism and adequate passing observations. Allows continuation of the relevant implementation work only. It is not release qualification, production admission or cross-target evidence.

If a finding requires a policy/code/flags change, the previous report remains about the old candidate. Rebuild and rerun affected cases under new authorization/budgets; retain failed records. No “passing after edit” mutation of historical reports.

### T4 — Complete scoped request/budget mediation

**Dependencies:** T1/T2; a supporting G0 decision for positive paths. Pure fail-closed fixes/tests may proceed earlier with the no-go/inconclusive blocker still explicit.

1. Make `OutboundRequestDescriptor` completeness explicit. Validate full untruncated URL/method/headers/body information. Overlong inputs reject; only the diagnostic projection is shortened/redacted. Normal grants allow GET/HEAD only, with positively established empty body; `hasPostData`, post-data entries and contradictory/missing metadata cannot count as empty.
2. Replace default header/body estimates with the agreed measurement contract. Browser-added headers, cookies, protocol serialization/compression and unobservable bytes must not be claimed covered by summing a CDP header map. Where enforcement is absent, refuse the stronger capability.
3. Make navigation preflight validation-only. Associate actual paused requests with owner/session/network IDs and redirect-hop lineage. Use bounded maps; handle out-of-order extra-info, duplicate events, reused IDs, 3xx chains, 307/308 method preservation, client-side navigations and exhaustion. Redirect continuation consumes exactly one request and one redirect charge; client navigation is not automatically a redirect.
4. Aggregate counts/bytes across every admitted realm on the same operation lease. Missing lineage/completeness or counter overflow fails closed. Validation/charging is atomic with the request decision so duplicate events cannot continue twice.
5. Create a single latched terminal-fault channel from broker/gate to lease/host. On fault, synchronously revoke and abort work, fail pending requests, close targets and await cleanup. Catch failures explicitly, never swallow response overruns. Preserve the primary fault and cleanup uncertainty in bounded diagnostics.
6. Track request/response lifecycle through success, redirect, cache, SW, failure, cancellation and disconnect. Distinguish valid zero-length responses (e.g. proven HEAD/204) from unmeasurable opaque responses. Use the native-reviewed measurement semantics; do not double-count incremental and terminal totals.
7. Before publishing a successful operation result, finish or cancel/drain outstanding resource work under the same deadline and verify final accounting and absence of a terminal fault. A late/final response can still reject success. Never wait indefinitely for a streaming response.
8. Remove reliance on `Fetch.disable` for denial. Keep interception and listeners until closure is acknowledged; explicitly fail paused requests, await bounded decisions, then release only closed resources. Unconfirmed control/closure retires the owner.
9. Update both provider paths and fixed worker operations end to end. No optional `gate`/lease path in a shipped operation; existing public library signatures that would permit bypass must require authority or fail closed. Document intentional signature changes, do not retain a permissive overload.

**Primary files:** broker/outbound-policy/operations/host/session/worker-core; providers and coordinator as needed.

**Tests:** M7–M10 and all earlier M rows. Extend existing broker/operations suites; add a focused accounting suite if needed. Test UTF-8/full URL bounds, hidden-body GET/HEAD, malformed length/NaN/infinity/overflow, concurrent realm totals, final-response overrun with no later request, endless streams, response-before-Fetch, post-revoke decision and fault-vs-extraction races.

**Exit:** P2/P7 offline acceptance passes for the declared supported behavior; unresolved native/enforcement gaps still prevent full contract completion and mode enablement.

### T5 — Identities, integration inventory and final review

**Dependencies:** accompanies T1–T4; finalize at handback, including blocked handbacks.

1. Revise effective policy semantics deliberately. Use a new nested policy schema/version if fields/units change; update exact-field validators, hash consumers and fixtures together. Outer schema-3 evidence need not change unless its own shape changes. Preserve old records as historical; never silently reinterpret their byte units or authority guarantees.
2. Do not label the code `browser-realms-v1` or `network-wire-v1` from fake events or partial native observations. Separate implemented mechanism, qualified candidate and currently admitted state. Remembered persistence/reader separation/manual control stay unavailable in this slice regardless of a feasibility pass.
3. Reject `kind: browser-feasibility-report` at all production evidence/admission/operator entry points. Also test a correctly rehashed synthetic/mismatched record, not only corrupted JSON. A report boolean is not an authentication or qualification mechanism.
4. Update `docs/audit.md`, containment docs and the parent plan only for implemented ledger rows. Update disclosure/skills/manifest hashes only if their documented semantics actually change. Do not edit upstream vendor source for this work.
5. Register new dev entries in explicit build-input/provenance and Knip inventories as appropriate, without adding them to production `agent-product.json` runtime assets. Mechanically confirm `src/index.ts`, operator API, guest bootstrap/types, provider descriptors and worker message schemas expose no new authority/probe controls.
6. Review the completed coherent patch with source witnesses; distinguish observed implementation from intended guarantees. Check cancellation/ownership and authority provenance, not only the happy path.

**Exit:** M11/M12/N4/R1; clear implemented-but-disabled status and an explicit next step. No production settings or qualification records are created by this package.

## 6. Non-qualifying report contract

Proposed report schema is independent of production evidence schema 3:

- `schemaVersion: 1`, `kind: "browser-feasibility-report"`, `releaseQualification: false`.
- Run ID, exact native target, bounded start/end times and overall decision: `go-for-development`, `no-go`, `inconclusive` or `not-run`.
- Exact built runtime/closure and driver/fixture hashes, browser bytes/version, flags, backend/policy identity, manifest digest and observation-method identity. Record the dirty-source/build provenance; Git HEAD alone is insufficient.
- Fixed case IDs with `pass`, `fail`, `inconclusive` or `not-run`, bounded counters, measurement units, observation coverage and sanitized reasons. Missing required cases cannot imply success; no free-form status that the validator treats as a pass.
- Separate positive-control and denial windows, per-case/total consumed budgets and known blind spots. Report fixture-policy deviations from production.
- Cleanup outcome (`confirmed` or `uncertain`) and private recovery-artifact references. Never include credentials/control endpoints or dump a profile into the report.

The strict report validator checks identities/shape/derived decision, rejects unknown fields and reports required-case omissions. It does not create operator settings or convert the document to a qualification record. Q4–Q8 retain their own exact-candidate evidence requirements. Bound report size and artifact reads; do not publish these local reports automatically.

## 7. Verification plan and execution safety

### Per-package checks

| Package | Smallest verification before advancing |
| --- | --- |
| T0/T1 | Typecheck; lifecycle/authority/worker/disclosure/approval tests; direct receipt forgery and post-dequeue mutation probes |
| T2 | Coordinator/session/owner/lifecycle/profile/cleanup tests; ordered fake-CDP capture proves install-before-resume, revoke-before-cleanup and no-continue-after-revoke |
| T3 | Driver/report/preflight/cleanup tests with fake launch; direct CLI preflight/import probe establishes no browser/network effects |
| G0 | Only the separately authorized fixed native cases; no default test command executes them |
| T4 | Broker/accounting/operations/provider integration tests plus affected R1 tests; direct final-response-overrun and shared-budget probes |
| T5 | Admission/evidence/component/guidance/configuration/asset/approval coverage selected by changed files; public-symbol and fixture-entry inventory |

Existing focused commands (add proposed test filenames only after creating them):

```sh
pnpm run typecheck
pnpm exec vitest run tests/browser-lifecycle.test.ts tests/browser-worker-core.test.ts tests/browser-disclosure.test.ts tests/approval-projection.test.ts
pnpm exec vitest run tests/browser-session.test.ts tests/browser-owner.test.ts tests/browser-profile.test.ts tests/browser-cleanup.test.ts tests/browser-launcher.test.ts
pnpm exec vitest run tests/browser-broker.test.ts tests/browser-operations.test.ts tests/browser-integration.test.ts tests/browser-web-migration.test.ts
pnpm exec vitest run tests/browser-admission.test.ts tests/browser-evidence.test.ts tests/browser-component.test.ts tests/browser-operator-cli.test.ts
```

Use trusted Node as documented in `AGENTS.md`. Preserve production deadlines and give spawn-only harness budgets at least 3–5x the production bound with explicit spawn-error assertions. Inspect nonzero exits; repair the cause rather than rerunning unchanged checks. Never add real-browser tests to these commands.

Before a completed cross-cutting A2 implementation handback, audit subprocess/cleanup effects and run the serial `pnpm run check` under trusted Node with one sufficient outer timeout, preserving the full log/report. No concurrent builds/staging/suites. The full-check requirement belongs to runtime implementation, not writing this plan. Escalate focused failures as necessary and record blockers honestly; a targeted report is not the full-suite report.

Always finish changes with a fresh `pnpm run build`. The build regenerates `dist/`; first verify its exact cleanup scope contains only intended generated non-repository artifacts, and do not erase unexpected files/repositories. A build alone is not behavioral verification. Inspect final diffs and do not stage/commit/push merely to satisfy a checkpoint.

### Planning-document acceptance (this change)

- Plan is linked from the Q2/Q3 parent and all local Markdown links resolve.
- Every work package has dependencies, files/seams, effects, tests and an exit condition.
- Native execution is separately authorized; the default offline path stops at G0 when unavailable.
- No runtime, public API, configuration or qualification claim is changed by writing the plan.
- Fresh build succeeds; no live/browser/install/authentication probe is run.

## 8. Implementation order and handback

```text
T0 contract/mechanism review
  ├─ proven mandatory limitation → no-go decision; optional deny-first hardening only
  └─ T1 authority bridge → T2 owner coordinator → T3 private driver/offline tests
                                                 ↓
                                  explicit authorization + G0 native gate
                                    ├─ no-go/inconclusive/not-run → remain blocked
                                    └─ go-for-development → T4 full mediation
T5 identity/inventory/review accompanies every changed semantic and every handback
```

Request native authorization only after supplying the proposed host/browser, exact manifest, fixture/observer requirements, side effects, resource limits and retained artifact paths. Do not ask for personal browser data or Kiro login for this component experiment.

Each handback lists completed ledger rows and exact test/build outcomes, uncompleted requirements, native decision/coverage, implemented-but-disabled behavior, retained recovery data and the next authorized step. Completion of A2 is not completion of Q2/Q3 or W6. Persistent routing (A3), human control (A4/A5) and exact-candidate qualification remain separate work.
