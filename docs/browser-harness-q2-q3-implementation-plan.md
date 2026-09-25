# Q2/Q3: persistent research browser and real human handoff

> **Historical / superseded by Browser Harness removal.** Browser implementation, CLI/provider entry points, bundled skills and execution qualification described below are no longer shipped. This document is retained for provenance (including unrelated verifier/cleanup repair history), not as current setup instructions, available functionality or verification evidence. See [current removal and verification notes](browser-removal.md). Historical paths may no longer exist.


**Post-cleanup prerequisite:** the [cleanup repair and containment plan](browser-repair-containment-plan.md) now defines the next work. Earlier offline-test results below are historical, and some named test/worker/driver paths were removed. Repair and rebaseline first; then resolve the containment mechanism before A3 or manual UI work. No new mode is admitted by this note.

Status: **A0/A1 lifecycle prerequisites and the A2 invocation-authority/attached-page hardening subset are implemented/offline-tested. Full A2 is stopped by a source-level no-go for CDP-only preventive wire-byte/actual-peer enforcement; A3–A6 remain open and nothing here is live-qualified.**

This is the next coding slice after Q0/Q1 in the [W6 plan](browser-harness-w6-implementation-plan.md), expanding W3/W4 in the [follow-up plan](browser-harness-follow-up-plan.md). The scope audit below is based on the current working tree, not just those earlier plans. Preserve existing uncommitted work.

The [detailed A2/native A0 implementation plan](browser-harness-a2-a0-implementation-plan.md) records the implemented authority/accounting subset and the current stop decision. Its proposed native feasibility report remains non-qualifying and was not implemented or run; source review already demonstrates mandatory mechanism gaps in the current CDP-only candidate.

## 1. Scope decision

Implement **Q2 first, then Q3**, with a mandatory containment/lifecycle prerequisite. This is not a settings toggle or merely replacing the manual-command stub.

Deliverables:

1. A dedicated engine-consented research owner whose permitted browser state survives restart.
2. A separate clean browser owner/process for page reads, with no research profile state.
3. Per-operation, revocable traffic authority; no standing network grant for an idle persistent browser.
4. Safe process/profile ownership, cancellation, active revocation and confirmed cleanup.
5. A retained challenge target, private operator control, bounded human interaction and fresh approval after completion.
6. Coherent provider routing, approvals, qualification identities, installed CLI, documentation and offline tests.
7. Fixed-operation probe seams and a live acceptance checklist for Q4; **not** the entire Q4–Q8 campaign.

The immediate handback is implementation/offline evidence, not production enablement. Remembered/manual production admission stays blocked until the exact code, browser, policy, target and scope have qualifying native evidence. A feature may be implemented while unavailable.

### Explicit exclusions

- No personal browser discovery, attaching to existing personal tabs, importing cookies/history/passwords, account login or Sync.
- No fingerprint spoofing, fake browsing history, automated CAPTCHA solving, repeated requests to provoke a challenge, engine fallback or silent retry.
- No new model-visible CDP/JavaScript/control API; no enabling additional recipes beyond the implemented gsearch/gnews scope.
- No real-home recovery, profile migration/purge, arbitrary cleanup, new daemon product or unrelated fovea/installer refactor.
- No installation, browser launch, live site access, authentication, host provisioning, signing or publication as part of this planning task. Native probes require separately agreed effects and budgets.
- Q5/Q6 installation/native Kiro capture, Q7 assembly and Q8 four-target qualification remain separate milestones. No local commits without an explicit request; no pushes or remote publication.

## 2. Source-verified gaps

| Current source | Observed behavior | Work required |
| --- | --- | --- |
| `src/browser/operations.ts`, `openAndEvaluate` | Always creates a disposable browser context; closes it before `searchCards` classifies CAPTCHA/consent | Introduce operation target leases; remembered searches use the dedicated persistent profile context. Classify before releasing target ownership. |
| `src/browser/owner.ts`, `host()`; `src/kiro/runtime.ts` | One shared host/browser owner serves both providers; no purpose-bound reader/search routing | Preserve one admission gateway but route readers to a separate clean process/profile. |
| `src/browser/host.ts`, `run/close` | **A2 subset repaired offline:** opaque approved receipts are consumed after dequeue; current policy, profile mode and remembered caller scope are rechecked before a deadline-bound lease; all exits revoke | Owner generation/consent and browser-wide target mediation remain absent; full A2 is blocked by the backend decision. |
| `src/browser/owner.ts`, launch/shutdown | **A1 repaired offline:** generation-fenced launch, caller-independent shared startup, owner cancellation, detached process-group supervision and confirmed cleanup before release/removal | Native process-tree behavior still requires per-target Q4 evidence; active revocation is A3. |
| `src/browser/profile-store.ts`, lock/revoke | **A1 lock repaired:** asynchronous incarnation/capability lock, browser-group binding, exact release and recovery preservation. Revocation still writes durable state only | A3 adds owner notification, bounded reconciliation, immediate grant revocation and acknowledged stop. |
| `src/browser/session.ts` | **A1 repaired for disposable sessions:** timed-out/interrupted creation calls retain bounded ownership tombstones and settle late resources or report uncertainty. No persistent lease transfer exists | A2/A4 distinguish operation/owner/quarantine ownership and retire the owner when a persistent creation outcome is unknown. |
| `src/browser/broker.ts` | Intercepts one attached page; complete bounded CDP-visible request descriptors and terminal fault propagation are enforced, with page-script networking/worker stubs as defense in depth. No browser-wide target admission | Startup/restoration, child targets, workers and service workers remain unproved; remembered/manual mode is refused. |
| `src/browser/broker.ts`, `src/browser/outbound-policy.ts` | Paused-request URL/method/header/body accounting, redirect lineage and terminal operation faults are implemented for the attached page; final encoded response overruns reject success | CDP terminal response measurements are post-transfer and incomplete for the required hard wire cap; actual-peer binding is absent. This is the A0 no-go, not a qualification claim. |
| `docs/browser-isolation-design.md` | Historical evidence documents opaque response undercounting and invisible Fetch channels; old backend name/status wording remains | Treat as historical, not proof of safe persistence. Reconcile current backend naming and claims; do not claim OS containment or a hard wire cap from post-response events. |
| `src/browser/handoff.ts` | File registry only: no target/owner/client binding; read-modify-write transitions; expiry checked on reads | Owner-authoritative state machine, private authenticated IPC, expiry timers and acknowledged cleanup. Registry is a sanitized projection, not authority. |
| `scripts/browser-operator.mjs` | `verify` returns `manual-control-unavailable`; status has no real owner/control view | Implement real begin/finish/abort only after target/control/traffic prerequisites. Keep refusals accurate until then. |
| `src/providers/web-provider.ts`, `src/providers/browser-provider.ts`, `src/browser/worker-core.ts` | Both contained providers require the registry-minted receipt and pass the host lease/gate end to end; worker execution requires a trusted admission dependency. No retained-target handoff exists | Authority bypass is closed for the shipped paths; persistent target/handoff routing remains A3–A5. |
| `src/kiro/power/approver.ts`, `src/browser/disclosure.ts` | Exact approval now includes host-derived operation, engine, policy hash, profile mode and verified caller scope in immutable review identity | Owner generation and consent identity/revision remain future persistent-mode requirements; the model cannot supply or mint these facts. |
| `src/browser/qualification.ts`, `src/browser/evidence.mjs` | Current policy explicitly says disposable persistence, attached-page coverage and no manual control; policy validator has exact fields. `evidenceQualifies` selects profile modes, not a distinct manual qualification | Version new policy semantics deliberately; implement an explicit manual admission predicate. Never treat remembered qualification as manual permission. |
| `src/config.ts`, `src/browser/handoff.ts` | Configuration accepts manual duration up to one hour; registry rejects durations above ten minutes | Define one reviewed range/default across config, CLI, owner, registry, policy identity and tests. Do not widen the production limit to satisfy tests. |
| `src/kiro/mcp-server.ts` | Verified workspace plus associated conversation ID/epoch/runtime generation now populate host-only caller scope; unassociated clients still refuse remembered authority | Durable consent/owner routing and cross-runtime revocation remain A3; MCP PID/cwd/model input never become client identity. |

These are source observations, not new live findings. In particular, comments about Fetch.disable behavior, process groups and full frame coverage must be verified, not accepted as proof.

## 3. Architecture decisions and stop/go gate

### 3.1 Single gateway; distinct execution owners

Keep the provider-facing host as the only dispatch/admission boundary. Add an internal discriminated operation intent with at least purpose (search/news/reader), effective engine where relevant, canonical invocation identity, deadline and trusted caller scope. Providers derive it from the reviewed recipe and admitted configuration; it is not a model argument.

- **Remembered search/news:** use the dedicated, consented engine profile's persistent default context, not `Target.createBrowserContext`. Create a fresh task-owned target per search; close the target after success, retain permitted profile state.
- **Readers:** separate process and user-data directory; disposable contexts per operation. `web.open`, result-link reads and future reader adapters cannot select the research owner even for a search-engine URL.
- **Ephemeral search:** disposable context in a clean owner, with no remembered profile directory or state import.
- **gnews:** binds to Google. A Bing-configured remembered profile cannot execute Google news by silently switching engines; refuse when no admitted Google scope/profile exists. Do not add a multi-engine profile manager in this slice.
- Keep one active operation per remembered profile, independent of configurable clean-reader concurrency. All paths share bounded admission and the same exclusive manual-state barrier.

Prefer evolving the existing host/owner facade over adding a second provider stack. Internal owner/session/lease interfaces must not become guest symbols or arbitrary worker-protocol commands.

### 3.2 Persistent state is not persistent authority

The owner holds the CDP control session, profile lock, target registry, grant registry and timers. Operations borrow revocable leases and receive only the fixed adapter facilities they need. Normal grants bind to the exact approved payload, owner generation, caller/workspace, engine, recipe, policy/consent identity and absolute deadline.

Default is deny, including before the first operation and between operations. Close/revoke a grant before reporting completion, cancellation or interruption. Never disable interception on a retained/live target to implement idleness; explicitly deny/drain paused work and confirm target closure or safe quarantine.

Cancellation of one operation must not tear down a shared control wire while leaving its browser unmediated. Loss of owner control instead fails all leases and invokes the supervisor. Unknown late creation replies remain cleanup obligations; they are not erased by promise cancellation.

### 3.3 Scope and consent

First supported sharing scope: one installation + engine + explicitly consented canonical workspace, with a conservative single trustworthy client-owner lease. Cross-workspace sharing is excluded. Multiple clients without reliable intended-client association are refused, not pooled.

Add scope to a versioned consent record and reconfigure flow; old consent cannot imply the new scope. Durable data may survive a session, but operation grants and handoffs may not. Profile reuse by a later supported session requires matching scope and fresh operation authority. If existing workspace-binding facilities cannot supply a trustworthy canonical scope, stop remembered/manual admission rather than inventing one from a PID, cwd guess or model input.

Revocation preserves durable profile data. Reconfiguration invalidates old grants/settings and requests owner stop; it must not return an implication that live work stopped unless acknowledged. Incomplete cleanup is visible and blocks reuse.

### 3.4 Containment feasibility is a dependency, not a follow-up

Before implementing a positive persistent production path, design/test the deny-before-start and all-realms strategy:

- Root-level auto-attach with paused new targets, recursive attachment where required, explicit handling of existing/restored targets, OOPIFs, workers/service workers, popups and downloads.
- Disable/reject unsupported realms and protocols rather than relying solely on stubs in one JavaScript world. Default-context persistence must not revive an old service worker with ambient authority.
- Account for traffic before CDP attaches, while idle, after disconnect and during exit. Launch flags alone are not a proof.
- Establish DNS/connected-address protection, including re-resolution and redirects. A hostname syntax check or a separate DNS lookup does not pin Chrome's actual destination. Use controlled sinks, never real private/admin/metadata/cluster services.
- Define request/header/body/response byte semantics precisely. If actual wire bounds, browser-generated cookies/headers or opaque/compressed/streaming responses cannot be enforced with the chosen backend, report that limitation and stop the claimed capability.
- Do not set `browser-realms-v1` or `network-wire-v1` merely because a mock emitted those observations. Their native proofs remain required by Q4.

**Decision gate A0:** if CDP-only containment cannot enforce the required lifecycle/network contract, keep the modes blocked and present a separate architecture decision (for example, externally enforced egress). Do not quietly introduce a broad proxy, TLS interception, privileged service, VM or weaker policy as part of this slice. Such changes affect deployment and browser behavior and need a separately reviewed scope.

### 3.5 Native UI and control threat model

Current launch arguments are already headed. Preserve the *same* owned target for manual interaction; do not relaunch a second browser, copy a challenge URL or repeat the query. Native window visibility/focus and display availability still require per-platform proof; unsupported UI fails clearly.

Private IPC authenticates an installation/operator process and prevents accidental/stale/foreign control. A 0700 directory, token or TTY is **not** an OS boundary against arbitrary same-user code and is not proof a human acted. Protect control material from model-visible providers and qualification artifacts; audit generic local-tool access before claiming model exclusion. If the supported client exposes unrestricted equivalent authority, report that limitation/blocker rather than claiming human-only enforcement. The real human observation remains a Q6 qualification requirement.

## 4. Acceptance ledger

Rows P3 and P4 are **implemented/offline-tested for A0/A1**. P6's per-invocation authority subset and P7's attached-page request/accounting subset are partially implemented/offline-tested; neither parent row is complete. Every live-evidence column remains open. Record implementation and live qualification separately, with test/probe names and exact identity references.

| ID | Required behavior | Smallest offline evidence | Separate live evidence |
| --- | --- | --- | --- |
| P1 | Research search uses persistent context; reader/ephemeral operations use a different owner/profile | Routing table and CDP ownership assertions across both providers | Nonsecret state marker survives browser restart and is absent in excluded scopes |
| P2 | No grant at startup/idle/after revoke; all realms mediated or denied | Ordered fake-CDP events, paused requests, late targets, control-loss cases | Sink-side startup/restoration/worker/idle/exit traffic observations |
| P3 — implemented/offline-tested | Queue, launch, active operation and cleanup have bounded cancellation/deadline behavior | Fake timers, deferred launch, connect/abort races, close with full queue | Controlled cancellation/crash and process-tree exit |
| P4 — implemented/offline-tested | Lock lasts until confirmed browser-tree exit; uncertain ownership preserves data | PID reuse, signaled exit, stale endpoint, old-generation callback and replaced lock cases | Competing owners and killed controller/browser, no unsafe reuse/orphan |
| P5 | Revocation stops running/queued work without deleting state | IPC notification plus lost-notification/reconciliation cases | Revoke during controlled traffic; no subsequent admitted traffic |
| P6 — partial authority subset | Scope/engine/mode/policy are reviewed and rechecked; owner generation/consent are still absent | Forgery/replay/args/policy/mode/scope/approval-timing tests | Wrong-chat denial and fresh approval in native Kiro, later Q6 |
| P7 — partial attached-page subset | Complete bounded CDP-visible requests and redirects fault correctly; preventive wire/opaque/streaming guarantees are absent | Descriptor/body/header/redirect/final-response cases; no navigation double charge | Allowed and denied sink counts/byte observations; currently blocked by A0 no-go |
| H1 | Challenge classified before cleanup; exactly one owner keeps the same target | Transfer acknowledgment and every race/failure ordering | Same visible target before/after operator begin |
| H2 | Stale, replayed, foreign and concurrent control requests cannot gain authority | Private IPC framing/authentication/ancestry/state tests | Installed owner/operator association, later Q5/Q6 |
| H3 | Pending/manual state excludes all affected model execution, including queued work | web.search/open, runSkill and internal dispatcher negative cases | No model operations/traffic while human controls the target |
| H4 | Manual grant has its own reviewed endpoints, methods, budgets and expiry | Normal grants cannot POST; absent/manual-unqualified policy refuses | Controlled form first; separately approved real provider flow |
| H5 | Finish/abort/expiry/revocation/disconnect closes target before final success; retry is new work | Owner timers without polling, cleanup-failure and lost-ACK tests | Target closure, preserved state and fresh native approval |
| C1 | Correct status/help/skills and strict installed assets; no new model control tool | CLI, metadata, symbol/asset inventory and package tests | Generation-local operator API in installed qualification |
| C2 | Old/mismatched/synthetic evidence cannot enable new modes | Admission/policy/tamper/manual-mode predicate tests | Exact-candidate Q4–Q8 evidence; not this offline handback |

## 5. Implementation sequence

### A0 — contract and feasibility spike — **contracts implemented/offline-tested; native stop/go gate open**

Files: `src/browser/host.ts`, `src/browser/owner.ts`, `src/browser/session.ts`, `src/browser/broker.ts`, `src/browser/outbound-policy.ts`, `src/browser/qualification.ts`, `docs/browser-isolation-design.md`.

1. Write internal intent/lease/owner-state contracts and state-transition tests before changing provider routing.
2. Build an injectable target/grant coordinator with no default network authority. Keep the existing ephemeral path working.
3. Establish cancellation domains, a monotonic deadline abstraction, cleanup acknowledgment semantics and terminal fault propagation.
4. Specify byte accounting, browser-wide coverage and process ownership support per native target. Identify what cannot be established offline.
5. Add a fixed-operation controlled probe design for Q4. No production bypass flag, model-selectable test origin or MCP control entrypoint.
6. Obtain a separate approved component experiment if feasibility requires real Chrome. An inconclusive result blocks enablement and is retained, not turned into a pass.

**Exit:** reviewed implementable contracts and passing negative/offline tests, or a clear architecture blocker. Do not implement Q3 on top of an unreviewed positive path.

### A1 — launch, lock and shutdown correctness — **implemented/offline-tested**

Files: `src/browser/owner.ts`, `src/browser/launcher.ts`, `src/browser/profile-store.ts`, `src/browser/session.ts`, `src/browser/host.ts`.

- Make launch a transaction: acquire scoped lock, validate browser bytes and profile ancestry, establish fresh owned launch/endpoint identity, spawn, install containment, then publish availability. Record the child immediately on spawn so partial endpoint discovery is still supervised.
- Use a genuinely task-owned process group/supervisor where supported; never signal the ambient MCP group or unrelated descendants. Account for detached browser helpers. Process creation/start identity and generation nonce must accompany PIDs.
- Reject stale DevToolsActivePort data; endpoint freshness must bind to the current launch. Do not attach to a merely responsive old loopback endpoint.
- Join a shared launch safely: one cancelled waiter does not accidentally orphan launch or invalidate other leases. Owner shutdown/revocation cancels the launch itself and awaits its outcome.
- Track child exit events and signal exits, not only `exitCode === null`. Old generation callbacks cannot clear a newer child/endpoint.
- Stop sequence: deny admission, reject queue, revoke grants, abort active work, settle/close targets and control, request owned browser termination, wait, escalate only on the exact owned process tree, confirm exit, then release lock. Preserve lock/recovery evidence and profile on uncertainty.
- Replace synchronous lock polling with asynchronous bounded wait. Reuse/factor applicable incarnation/identity patterns from `src/installation/installer-lock.mjs` only after checking their contract; do not transplant installer transaction state or weaken its tests.
- Lock release verifies the lock instance/nonce before removal. Dead controller is not proof its browser is dead. Legacy/ambiguous stale locks fail closed with a recovery diagnostic.
- Cleanup uses bounded repository-preserving semantics consistent with `tests/fixture-cleanup.mjs`; shipped runtime must not import test files. Never remove remembered data during ordinary stop/revoke. Delete disposable data only after ownership and exit are proven.

Tests: extend `tests/browser-owner.test.ts`, `tests/browser-profile.test.ts`, `tests/browser-launcher.test.ts`, `tests/browser-session.test.ts`, `tests/browser-integration.test.ts`. Repair the fake-child seam so failures/delayed termination and signal exit are real test cases, not always-successful kills.

**Exit:** P3/P4 offline checks pass with no live browser and no unsafe fixture teardown.

### A2 — owner-wide mediation and scoped grants — **authority/attached-page subset implemented; full stage stopped by A0 no-go**

The listed owner-wide positive path is not complete. Invocation receipts, dequeue revalidation, mandatory leases/gates and attached-page accounting were implemented as fail-closed hardening. Root target coordination and full P2/P7 were intentionally not promoted after source review established missing preventive wire-byte and actual-peer mechanisms.

Implemented subset files also include `src/browser/invocation-authority.ts`, `src/browser/lifecycle.ts`, `src/browser/host.ts`, `src/core/action-registry.ts`, `src/protocol.ts`, both contained providers, `src/browser/worker-core.ts`, trusted Kiro context/approval seams, broker/operations/outbound policy and their focused tests. The planned owner-wide path would additionally require owner/session/target-coordinator work.

- Implement deny-first target registration and containment attachment before releasing paused target execution. Unknown target types close or block the owner; restored/service-worker/background activity cannot inherit a previous operation grant.
- Give every target/realm a grant association and revoke it synchronously before asynchronous cleanup. No target-based default allow and no authority from an untrusted URL/redirect.
- Keep interception through quarantine/idle; verify actual Fetch shutdown semantics. Pending request decisions cannot continue after grant revocation, even if an earlier asynchronous policy check returned allow.
- Account for full request descriptors; reject truncated/unknown URL/body/header data rather than slicing the input used for policy. Redact only diagnostics. Track redirect chains and cumulative budgets without double-charging initial navigation and its corresponding request.
- Budget failure immediately faults/revokes the operation, including when the final response is the last event and there is no later request. Explicitly handle unmeasurable response paths; do not silently count zero.
- Bind grants to canonical approval/config scope and a single absolute deadline including queue wait. Confirm there is no raw WorkerCore production path without a required grant.

Tests: extend `tests/browser-broker.test.ts`, `tests/browser-disclosure.test.ts`, `tests/browser-session.test.ts`, `tests/browser-operations.test.ts`, `tests/browser-worker-core.test.ts`. Include out-of-order events, generation rollover, detach failure, queued post-revoke decisions, HTTP redirects, hidden-body GET, streaming/opaque responses and newly attached realms.

**Exit not met:** partial P6/P7 defense-in-depth checks pass, but full P2/P7 cannot pass on the current CDP-only candidate. Backend limitations are explicit blockers, not capability flags.

### A3 — Q2 persistent search and reader separation

Files: `src/browser/operations.ts`, `src/browser/host.ts`, `src/browser/owner.ts`, `src/browser/profile-store.ts`, `src/browser/admission.ts`, `src/browser/worker-core.ts`, `src/providers/web-provider.ts`, `src/providers/browser-provider.ts`, `src/kiro/runtime.ts`, `src/kiro/mcp-server.ts`, `src/kiro/power/approver.ts`.

1. Route every adapter using the internal intent table in section 3.1. Keep public result shapes and canonical query normalization stable.
2. Use persistent default-context target leases for remembered searches. Keep ephemeral context cleanup unchanged in semantics. Successful search closes the target and leaves only permitted durable engine state.
3. Scope profile consent and owner selection to installation/engine/workspace; reject ambiguity. Declare actual retained Chrome ancillary state (not just cookies). Do not promise a cookie-only or storage-only profile if Chrome retains more.
4. Bind state-mode and sharing disclosure to immutable reviewed operation context. Reject changes between approval and dispatch; no profile/engine downgrade or automatic fallback.
5. Add private revocation notification and bounded owner reconciliation. Before each grant/request decision, reject invalid scope/consent/config; use an owner timer as a fallback for lost events. Document the revocation convergence bound and acknowledge cleanup separately from durable revocation recording.
6. Propagate workspace/session retirement and MCP shutdown into the gateway. Do not share a consented profile across recreated runtimes by accident.
7. Leave challenge behavior fail-closed with target closure until A4/A5 are complete and manual qualification is admitted.

Tests: extend `tests/browser-owner.test.ts`, `tests/browser-web-migration.test.ts`, `tests/browser-integration.test.ts`, `tests/browser-admission.test.ts`, `tests/browser-disclosure.test.ts`, `tests/approval-projection.test.ts`. Add focused owner-routing/MCP-scope coverage if existing suites cannot express it. Fake state retention demonstrates routing only, never native persistence.

**Exit:** P1/P5/P6 offline checks pass; clean readers have demonstrably different process/profile ownership. Q2 is implemented/offline-tested, still not live-qualified.

### A4 — Q3 retained target and owner-authoritative handoff

Files: `src/browser/operations.ts`, `src/browser/handoff.ts`, `src/browser/host.ts`, `src/browser/session.ts`, `src/browser/owner.ts`.

Proposed new internal module: **src/browser/owner-control.ts**. Proposed focused test: **tests/browser-owner-control.test.ts**. These paths do not yet exist; add them to the audit inventory when implemented.

State contract:

```text
idle -> searching -> idle                         (ordinary success)
                 -> quarantining -> pending      (eligible challenge)
pending -> manual -> closing -> consumed
pending/manual -> closing -> expired | aborted | revoked
any live state -> cleanup-uncertain               (unconfirmed containment/exit)
```

- Classify interruption inside the target lease, before `openAndEvaluate` cleanup. Only eligible CAPTCHA/consent in an admitted remembered scope may transfer; 429, unexpected redirect and ephemeral challenges close normally.
- Revoke original traffic authority, install/confirm deny quarantine and transfer ownership atomically before publishing a handoff ID. If any step fails, close/retire with uncertainty recorded; do not publish a usable handoff.
- One pending/active handoff per profile in v1, with a bounded installation-wide total. Refuse capacity exhaustion; never evict a live target by dropping its registry row.
- Pending itself blocks new research work. For the first implementation, conservatively block all gateway browser execution while pending/manual/closing; status/skill documentation remain readable. Relaxation for an independent reader owner is a later separately tested change.
- Bind internal handoff state to installation, owner incarnation/generation, profile/engine, canonical workspace/intended client, consent revision, runtime/policy identity and retained target. Model output contains only sanitized kind, opaque request ID, expiry and operator guidance; no CDP IDs, cookies, tokens, endpoints or challenge form contents.
- Owner timers enforce pending expiry and manual expiry even if nobody reads status. Shutdown, revocation and caller retirement invalidate authority. Timers use monotonic durations; persisted wall timestamps are reporting/recovery data, not clock-change authority extensions.
- Implement versioned private IPC: verified private ancestry/files, bounded socket path, mutually checked owner/operator installation identity, fresh nonce/challenge, replay protection, bounded frames/connections/time and strict verbs. No arbitrary URLs, JavaScript, CDP commands, paths or environment overrides.
- Owner serializes state transitions. A versioned file registry can expose sanitized status only; historical registry-only records never regain authority. Restart never resurrects pending/manual leases.
- Idempotency handles a lost acknowledgment for the *same authenticated request* without renewing its deadline; a different concurrent/replayed begin cannot acquire or extend a lease.

**Exit:** H1/H2/H3 offline cases pass, including late target replies, expiry without reads, stale sockets/PID reuse, oversized framing, foreign scope and model entry-point bypass attempts.

### A5 — Q3 manual policy and actual operator flow

Files: `src/browser/outbound-policy.ts`, `src/browser/broker.ts`, `src/browser/qualification.ts`, `src/browser/evidence.mjs`, `src/browser/operator-api-entry.ts`, `scripts/browser-operator.mjs`, `scripts/installer-cli-contract.mjs`, `scripts/install-manager.mjs`.

- Add a distinct reviewed manual policy, not a switch that lets ordinary search grants POST. It binds engine/recipe/challenge kind, exact allowed origins/path rules/methods, destination/redirect checks, aggregate request/body/header/response budgets, target scope and deadline.
- Ship no permissive provider defaults. Endpoint requirements are established in controlled fixtures, then separately reviewed real-provider observations. Unknown provider endpoints/forms or unmeasurable bodies refuse; do not add a wildcard to make a CAPTCHA work.
- Extend manual admission explicitly: require manual qualification, remembered qualification, the manual policy identity, matching engine/recipe scope, live owner/target and current consent. Fix or supplement the profile-mode helper so an unknown/manual mode cannot inherit the remembered result.
- Proposed CLI grammar: `kiro-fabric browser verify <handoff-id>` starts a foreground interactive controller. It validates ownership, shows the exact disclosure and requests explicit local operator confirmation, begins the manual lease, foregrounds only that target, and waits for Finish or Abort. Its live connection is the lease controller; disconnect/Ctrl-C aborts with bounded owner cleanup. Do not provide a detached ambient lease.
- Public status remains non-launching. Non-interactive/JSON/`--yes` verification cannot silently grant human authority; return an actionable refusal. Internal begin/finish/abort protocol verbs remain distinct even if one CLI command drives them. No auto-clicking or auto-submission.
- During manual mode the host performs only fixed containment/lifecycle actions; no model reads, evaluation, screenshots, input or task dispatch against the profile. Human navigation outside the reviewed policy is denied.
- Finish means the operator ended the window, not a claim that a CAPTCHA was solved. Revoke manual grant, drain/deny paused traffic, close target with acknowledgment, then consume the handoff. An uncertain close keeps the profile blocked and reports failure. Retry requires a new exact-payload search approval and newly admitted grant.

Tests: extend `tests/browser-handoff.test.ts`, `tests/browser-operator-cli.test.ts`, `tests/installer-cli-contract.test.ts`, `tests/browser-broker.test.ts`, `tests/browser-integration.test.ts`; use private IPC tests for disconnect/lost ACK/replay. Do not fabricate a real human acceptance from a mock.

**Exit:** H4/H5 offline checks pass with coherent installed CLI semantics. Native visibility and provider-specific usability remain unqualified.

### A6 — identities, disclosures and installed integration

Files: `src/config.ts`, `src/browser/profile-store.ts`, `src/browser/disclosure.ts`, `src/browser/qualification.ts`, `src/browser/evidence.mjs`, `src/browser/admission.ts`, provider status/help, `agent-product.json`, `docs/agent-product.schema.json`, build/package validators and adapted skill documents.

- Introduce versioned policy semantics for new owner/grant/manual rules (proposed policy schema 2) and scoped consent (proposed consent schema 2). Keep strict unknown-field rejection. If an outer evidence/settings shape changes, version it explicitly; otherwise retain outer schema 3 with versioned nested semantics and unchanged strict identity matching. Never rewrite historical live records as current.
- Reconcile the manual duration range to a single reviewed bounded contract: proposed 30,000–600,000 ms, default 300,000 ms. Reject or explicitly require reconfiguration for older longer values; do not silently reinterpret identity-bound settings. Keep pending timeout, manual timeout, IPC timeout and cleanup timeout separate.
- Include manual policy, caller sharing semantics, lease limits and actual containment/accounting capabilities in the effective policy identity consumed by both execution and evidence. Change capability labels only when implemented; successful native evidence remains a separate condition.
- Update exact approval disclosure, persistent-state disclosure/policy revision and status independently for implemented vs qualified vs currently available. State retention may reduce repeat challenges but guarantees no CAPTCHA outcome.
- Update `docs/configuration.md`, `docs/installer.md`, `docs/browser-isolation-design.md`, `skills/browser-harness/references/privacy.md`, adapted search/news/CDP docs and `skills/browser-harness/skill-manifest.json` hashes. Preserve vendored upstream sources.
- Reuse the generation-local operator entrypoint. Internal modules imported into that closure need no new public asset by default. If adding an executable entry/probe, declare and validate it in build/runtime assets, Knip and `docs/audit.md`; no source fallback or temporary script in shipped commands.
- Mechanically verify provider/guest/worker registries expose no owner-control, profile-token or raw CDP capability. Public search/page result shapes remain compatible; handoff metadata is sanitized and consistent across web and recipe errors.

Tests: browser admission/evidence/component/operator suites, configuration/disclosure/guidance, schema-3 bundle and package boundary tests. Add migration and correctly rehashed-but-wrong manual policy/scope fixtures. Historical evidence must remain historical.

**Exit:** C1/C2 offline checks pass. Update the parent plan rows to implemented/offline-tested only for acceptance rows actually covered.

## 6. Live proof and Q4 handoff (separate authorization)

Do not build a self-qualification environment flag. A reviewed fixed-operation component driver may exercise the underlying owners with explicit operator authority; production MCP still uses normal admission.

Request explicit native host/browser/display, private output directory, controlled fixture origins, allowed request/model/time budgets and human availability. No real secrets or personal browser data are needed.

1. **Containment feasibility first:** approved controlled sinks observe startup, idle, restored targets, workers, redirects, response accounting, revocation and stop. Test blocked private-destination behavior using owned fixtures, not actual services.
2. **Persistence:** set a nonsecret marker with an approved controlled operation; stop and prove old browser-tree exit; restart with a new instance/process identity; observe retained marker. Prove absence in clean readers, ephemeral operations, other engines and unconsented scopes. Distinguish durable cookies/local storage from session-only state.
3. **Lifecycle:** compete for the same profile; crash/revoke/cancel at launch and mid-operation; verify no unsafe lock release or orphan. Preserve uncertain runs and data.
4. **Controlled manual interaction:** retain the actual target, record its identity privately, obtain operator begin, perform a simple synthetic human form action, observe bounded traffic and model exclusion, then confirm closure and fresh approval requirement.
5. **Real provider challenge:** only if separately approved and naturally encountered; no repeated searches to trigger one. Missing challenge is inconclusive. Controlled UI success cannot qualify a real Google/Bing flow.
6. **Q4–Q8 continuation:** record pass/fail/inconclusive/not-run with exact code/browser/flags/policy/consent/target/scope identities. Later installed/native Kiro receipts prove actual tool routing, intended-chat approvals and complete tool inventory. No raw form data, profile contents, auth state or control material in shareable evidence.

Start with an available approved native host; that does not certify the other three targets. All twelve target/mode cells and advertised engine/recipe scopes remain the W6 release gate. Q2/Q3 code changes invalidate affected earlier code-bound evidence.

## 7. Verification and safe execution instructions for the implementing agent

Use one coordinator; no concurrent builds/staging/suites in this checkout. Audit every new helper's subprocess and cleanup effects before executing it. Retain repository fixtures. Use trusted Node per `AGENTS.md`; never repair unrelated permissions or widen production timeouts to satisfy a slow test.

### Smallest checks by slice

- A0–A2: owner/profile/launcher/session/broker/operations/integration suites; direct fake-CDP ordering and failure probes.
- A3: routing plus browser web migration, admission, worker and approval disclosure tests; negative caller/engine/scope matrix.
- A4–A5: handoff/private control/CLI/config tests; direct bounded local IPC probes with no browser/network-to-sites and actual out-of-process race cases. Use explicit test-only capability fixtures, not production success flags.
- A6: policy/evidence tamper, schema/bundle/installed asset and documentation/guidance checks. Audit newly created modules/tests in `docs/audit.md`.

Existing focused command examples (add new test filenames only after creating them):

```sh
pnpm exec vitest run tests/browser-owner.test.ts tests/browser-profile.test.ts tests/browser-launcher.test.ts tests/browser-session.test.ts tests/browser-broker.test.ts tests/browser-operations.test.ts
pnpm exec vitest run tests/browser-integration.test.ts tests/browser-web-migration.test.ts tests/browser-admission.test.ts tests/browser-worker-core.test.ts tests/browser-disclosure.test.ts tests/approval-projection.test.ts
pnpm exec vitest run tests/browser-handoff.test.ts tests/browser-operator-cli.test.ts tests/installer-cli-contract.test.ts tests/configuration.test.ts
pnpm exec vitest run tests/browser-evidence.test.ts tests/browser-component.test.ts tests/bundle-schema3.test.ts tests/guidance.test.ts
```

Run these at appropriate checkpoints, not repeatedly after unchanged passing slices. Rebuild/stage before tests that require built artifacts. Inspect nonzero exits and iterate. A build alone is not behavioral verification.

Before final implementation handback, run the full serial `pnpm run check` with a sufficient outer timeout, trusted Node and preserved full log/report. The earlier Q0/Q1 full run had failures subsequently repaired in targeted suites; it is not a fresh clean full-check result for Q2/Q3. Do not substitute those historical counts for the new result. Finish with a fresh `pnpm run build` so the installed development verification sees current dist output.

Use explicit spawn-error assertions and generous harness-only cold-start budgets; keep production deadlines exact. A targeted run that overwrites the Vitest report is not suite-wide timing evidence. No live qualification runs belong in the default test command.

Final handback must list: completed ledger rows, exact test/build outcomes, implemented-but-disabled capabilities, architecture/live blockers, preserved data/recovery artifacts and the next separately authorized probe. Never say simply “Q2/Q3 done” when only mocks passed.

## 8. Recommended next action

A0/A1 and the safe A2 authority/attached-page hardening subset are complete offline. The enforceability review reached the plan's stop condition: the current CDP-only backend has no preventive hard response-wire ceiling and no pre-commit binding to Chrome's actual connected peer, while owner-wide realm coverage is also absent. No native experiment was run because it cannot prove mechanisms the source does not implement. Keep every persistent/manual capability blocked and treat historical schema-3 evidence as non-transferable to this changed code.

The next work is a separately scoped architecture decision, not A3 or UI work. Evaluate an externally enforceable egress/byte boundary (or explicitly revise the product security requirement), including deployment, browser-fingerprint/CAPTCHA impact, exact supported targets and safe migration. Only an accepted design should receive a new owner-coordinator/native-driver implementation and exact-candidate qualification plan. Do not make `browser verify` return success, create synthetic qualification, or resume persistent routing on the current candidate.
