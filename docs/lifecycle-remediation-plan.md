# Lifecycle remediation: scope of work and implementation plan

## Status and purpose

**Status: W0-W4 implemented; W5 shared-exclusion implementation and W6-W7
focused safeguards/contracts are implemented and locally verified. W5's full
built activation matrix and broader/native release qualification remain open.
These results are not full behavioral or release certification.**

### Initial implementation evidence

- Added `pnpm run verify:lifecycle`: LC01-LC13, independently registered, with
  retain-only fixtures, source probes and a rebuilt public-API/closure check.
- RPC cancellation now retains predecessor ownership. Close/disposal operations
  are shared and sticky; late-runtime cleanup failure or grace expiry cannot
  masquerade as successful cleanup. The production close grace remains 1000ms.
- Registry, execution service, Kiro runtime and host-session adapter share close
  operations, preserve original cleanup failures, and retain failed ownership.
  Execution draining precedes later cleanup; diagnostics mark retained providers
  unavailable. Session retirement installs ownership before reentrant callbacks.
- **Passed:** 13 lifecycle cases plus 8 runner controls and 6 built-runtime cases;
  source/script typechecks, dead-code lint, guidance/reference checks and a fresh
  build. These 27 cases are focused local coverage, not the deleted full suite.
- Red evidence: LC01/02/03/05/06 and LC07/08/11 exposed pre-fix defects. LC04 and
  LC09 were preservation controls. LC10's initial baseline was blocked by missing
  fixture-only worker exports; a separate runtime probe demonstrated masked
  failure/duplicate artifact cleanup. Do not claim a red LC10 result.
- Read-only Astra RPC review found no blocking defect. Its reentrancy and
  post-grace-rejection coverage gaps were then added to LC06 and passed. Contour
  reviewed the full dirty tree with explicit coverage gaps, not a task-only
  correctness certificate. No live MCP endpoint or installed agent was used.

Retained local reports: `.tmp/verification-reports/lifecycle-vWMshA` and
`.tmp/verification-reports/baseline+runtime-sa7llQ`. The task ledger and baseline
are in `.tmp/lifecycle-remediation-iGfNqj`. These paths are local evidence, not
portable release certification.

### Second batch: W2 MCP handler teardown

`src/kiro/mcp-server.ts` now shares close operations before callbacks can reenter,
retains original failures, and attempts later owned cleanup after earlier failure.
Catalog revocation and cancellation remain immediate; the exact **3000ms** drain
wait is still followed by actual execution settlement, never treated as proof of
physical quiescence. Failed published/unpublished owners remain non-admissible;
close is not silently retried. Late factory/catalog publication failures dispose
owned bindings and runtimes without closing a runtime borrowed from another
session. Failed startup attachment does not close a previously owned host adapter.

LC14-LC18 add **28 handler variants**, using the real registered handlers with
inert external/native boundaries. LC13 additionally exercises the **built public
MCP API**, with intercepted SDK transport and no parser child. The independent
Astra review found a legacy factory-reuse binding leak in the first patch; a
repaired fixture reproduces it on retained pre-guard source and passes after the
factory rejects retired instances before transferring the new binding. The first
reuse fixture omitted explicit selection of the replacement root and is not the
valid red proof. Final evidence is collected in
`.tmp/mcp-teardown-vZmmxJ/final-audit.json`; all fixture roots are retained.

Review follow-ups also cover revocation callback failure/reentry, exact drain
constants, cross-session duplicate-runtime ownership, connect failure after
runtime acquisition, healthy fresh-runtime recovery, and terminal call/list/root
notification routes. Specialized injected-runtime catalog failure and every
successful publication-cancellation recovery schedule are not exhaustively
covered. Native-client lifecycle, real transport failure and full release
qualification remain separate gates. The entrypoint's installer-lock release
failure behavior is outside this handler-only patch.

The planning baseline was rechecked after an architecture audit involving
8 Astra specialists, 4 adversarial follow-ups, and 4 focused in-memory behavioral
checks. Its source, tracked diff and index were unchanged before implementation.
The initial patch used the installed fabric-workflow pattern, pi-fovea navigation,
two narrow Astra implementation/test specialists and an independent RPC reviewer.
Prior audit probes are not a newly run full test suite.

Goal: fix demonstrated lifecycle defects, make the dangerous change boundaries
regression-tested, and improve ownership contracts without weakening approval,
workspace isolation, recovery evidence, or repository-preservation rules.

Confidence meanings:

- **Confirmed:** directly supported by implementation; a reproduced behavior is
  identified separately.
- **Inferred:** a plausible consequence or proposed design, not an observed
  production incident.
- **Unknown:** requires external integration or deployment evidence.

## 1. Findings and priority

P0 means the first safety-remediation block, not a claim of an exploited security
vulnerability. P1 follows that block; P2 is structural improvement.

| ID | Priority | Finding and evidence | Required outcome |
| --- | --- | --- | --- |
| F01 | P0 | **Fixed; reproduced before the patch:** queued cancellation detached unsettled predecessor ownership. `src/kiro/mcp-provider.ts`, `KiroMcpProvider.#withServerLease`; LC01-LC06. | Cancellation settles the waiter without opening a parallel lane or losing predecessor shutdown tracking. |
| F02 | P0 | **Core and handler owners fixed under focused coverage:** registry/service/runtime/session fixes are covered by LC07-LC13; outer handler cleanup, startup, admission and publication are covered by LC14-LC18. | Cleanup attempts continue after failure, original errors remain reachable, callers join one operation, and uncertain owners cannot be silently replaced. Broader/native qualification remains open. |
| F03 | P1 | **Confirmed path; component behavior reproduced:** output is retained in the old artifact store, then a workspace transition destroys that store before returning its handle. `src/kiro/mcp-server.ts`, `src/kiro/artifacts.ts`. | No response advertises an already-invalid artifact; transition and delivery status remain truthful. |
| F04 | P1 | **Confirmed exclusion gap:** legacy `.install.lock` and modern `.install-lock` guard the same installation paths. `scripts/install-agent-user.mjs`, `src/installation/installer-lock.mjs`, `scripts/install-transaction.mjs`. | Supported old/new writers mutually exclude one another during fresh install and migration. Mixed-installation corruption is inferred, not reproduced. |
| F05 | P1 | **Confirmed path:** Fovea parent close/restart uses immediate SIGKILL, bypassing graceful engine cleanup. `src/fovea/engine-process.ts`, `src/fovea/engine-entry.ts`, `src/fovea/engine.ts`. | Bounded graceful close with forced fallback, explicit cleanup outcome, and ownership-safe handling of generated residue. Actual retained disk usage was not measured. |
| F06 | P1 | **Confirmed embedding path:** `FoveaEngineProcess.#ensure` does not recheck terminal state after awaiting an existing stop. | No replacement child starts after close or cleanup-uncertain state. Ordinary MCP shutdown has additional drain protection; routine production leakage is not established. |
| F07 | P0 gate | **Confirmed:** the original behavioral suite is absent; primary test/check commands fail closed. Offline registration is now 8 baseline, 9 installer, 6 runtime, 3 quality, 30 lifecycle, 24 locking, 8 safety-boundary and 8 contract cases; installer/release qualification remains incomplete. | Add an explicit lifecycle regression lane, preserve qualification blockers, and restore broader coverage incrementally. |
| F08 | P2 | **Confirmed:** provider inventory drift, name-based dispatch policy, and domain-aware generic interfaces. `agent-product.json`, `src/protocol.ts`, `src/execution-service.ts`. | Reconcile declared capabilities and reduce duplicated policy only behind tests. No authorization bypass is established by the inventory mismatch. |

### Qualifications that must survive implementation and reporting

- The simple registry sequence of active A, cancelled queued B, then C can hit a
  catalog-invalidity guard. The reproduced stronger sequence cancels A while its
  raw operation remains pending, cancels B, then observes successful C dispatch
  before A's raw operation settles. Test the real registry path as well as direct
  provider use; do not remove catalog validation to make a reproducer work.
- Promise settlement and client transport closure do not prove a remote server
  stopped its work. Never promise rollback or exactly-once effects.
- Synchronous close skipping was reproduced with an extension provider; inspected
  built-ins use async close. Real transport leakage is not established merely
  by a rejected mock close.
- The artifact defect was source-traced end to end and checked with real
  projection/rootless-store components, not a live MCP workspace switch.
- Fovea spawn-after-close is reachable through host embedding; normal MCP
  shutdown drains sessions first. Preserve this narrower exposure statement.
- Installer ownership checks catch many races; they do not substitute for a
  shared exclusion protocol. Do not describe hypothetical corruption as observed.

## 2. Scope and exclusions

### In scope

1. Deterministic lifecycle regressions and safe fixtures.
2. MCP queue ownership, cancellation, and close joining.
3. Truthful shutdown failure propagation through runtime/session boundaries.
4. Artifact delivery during workspace replacement.
5. Fovea admission, graceful/forced shutdown, and residue ownership.
6. Cross-generation installation-lock compatibility.
7. Worker/session/approval invariants and relevant CI wiring.
8. Provider inventory and small contract refactors after behavioral fixes.

### Out of scope for this remediation

- Implementing a new actor framework, model loop, mailbox, or persistent RPC
  daemon. Reusable workers and connections are not durable model actors.
- Inventing native Kiro session identity from tool arguments, environment, cwd,
  hook markers, or guessed metadata.
- Replacing persistence with a WAL/database as part of bug fixing.
- Browser reintegration, broad dead-code removal, dependency upgrades, or broad
  module rewrites unrelated to a demonstrated defect.
- Mutating the user's installed agent, contacting real MCP endpoints, publishing
  releases, creating commits without request, or accessing Kubernetes.

## 3. Safety rules and change control

- Preserve all pre-existing work and staging. Capture a baseline before each
  patch batch and compare task-owned changes separately.
- Use inert transports/providers and in-memory process/filesystem mocks first.
  Do not contact live services to reproduce cancellation or installer races.
- Do not execute helpers whose cleanup can delete repositories. Fixture roots
  are retained by default. Never delete `.git` metadata, bare repositories, or
  a parent containing them, including test fixtures.
- Any permitted cleanup must verify exact task ownership, identity, bounds and
  non-repository contents. Unknown or changed identity means retain and report.
- Production deadlines remain unchanged unless a separately justified product
  decision changes them. Harness cold-start budgets are separate and generous.
- No automatic replay of effectful programs or remote tool calls.
- No release of uncertain effect ownership merely to make shutdown appear fast.
- Small, reviewable patch batches; one owner for each shared integration file.
  Do not mix installer migration changes with runtime refactoring.

## 4. Work packages

### W0 — Establish the regression and evidence lane (P0 prerequisite)

**Touchpoints:** `scripts/verification/runner.mjs`,
`scripts/verification/case-contract.mjs`, `scripts/verify-offline.mjs`,
`package.json`, `.github/workflows/ci.yml`, and new focused case modules.

**Work:**
- Add an explicitly named lifecycle suite with fixed case IDs, worker dispatch,
  independent completeness registration, deadlines, and structured results.
- Port the useful audit probes into maintained assertions of the intended safe
  behavior; a reproduction that asserts the defect is not a passing regression.
- Supply complete mock contracts, including registry result budgets. Attach
  rejection handlers immediately; settle every task-owned deferred operation.
- Use event barriers/fake clocks for ordering, not arbitrary sleeps or retries.
- Audit fixture/subprocess teardown before execution. Retain ambiguous fixtures.
- Record source/build identities; distinguish source checks from built-package
  checks. Add the focused suite to local CI without relabeling it full coverage.

**Acceptance:** empty, omitted, duplicate, timed-out, and partial cases cannot
pass. Regressions demonstrate the relevant old behavior before the fix and pass
with the fix. Fixture retention is tested. Existing release-grade blockers stay
in place until their actual missing coverage has been restored.

### W1 — Repair MCP queue ownership (P0)

**Touchpoints:** `src/kiro/mcp-provider.ts`, `src/async-settlement.ts` only if
required, and registry-level lifecycle tests.

**Work:**
- Keep predecessor ownership reachable until both predecessor settlement and
  the current lease's required settlement conditions are satisfied.
- Separate caller completion, queue-node release, and map-entry retirement.
  A cancelled waiter may return promptly without retiring its predecessor.
- Ensure close snapshots include outstanding predecessor work and that newer
  tails are never removed by older callbacks.
- Preserve catalog revocation, transport snapshots, approvals, and no-replay
  semantics. Do not globally serialize unrelated servers as a shortcut.

**Acceptance:**
1. A active, B queued/cancelled, C later: C does not contact that server early.
2. A cancelled but raw work pending, B queued/cancelled, C later: C remains
   blocked until the required predecessor work settles.
3. Cancellation before queue admission dispatches nothing.
4. Multiple queued cancellations preserve ordering and leave no stale tail.
5. Closing during these schedules cannot overlook A.
6. Another server remains independent; no invocation is automatically replayed.

**Dependency:** W0. **Effort:** medium, because registry catalog counterguards
must remain part of the reproduction rather than being bypassed.

### W2 — Make shutdown truthful, complete and joinable (P0)

**Touchpoints:** `src/core/action-registry.ts`, `src/kiro/mcp-provider.ts`,
`src/execution-service.ts`, `src/kiro/runtime.ts`,
`src/kiro/mcp-server.ts`, `src/kiro/host-session-adapter.ts` as needed.

**Work:**
- Memoize one close operation per owner so concurrent callers join it.
- Convert synchronous provider-close throws to individual rejected operations;
  attempt all providers and propagate aggregated failures after settlement.
- Preserve immediate terminal admission, reservation lifetime and catalogue
  revocation. Do not clear failed owner references just to allow replacement.
- Verify failure propagation through service, runtime, session retirement and
  workspace replacement; retain a non-admissible failed owner when cleanup is
  uncertain. Define how operators distinguish closing, failed and closed.
- Keep timeout, cancellation, failure and successful cleanup distinct. Bounded
  caller waiting must not be reported as proof of physical quiescence.

**Acceptance:** async rejection is observable; a synchronous throwing extension
does not skip another close; every provider is closed at most once; concurrent
callers cannot return ahead of cleanup; a late runtime factory is disposed;
failed retirement cannot grant a replacement owner; no post-close invocation
is admitted. Include a built-in MCP provider with an injected rejecting runtime.

**Dependency:** W0 and W1 for shared MCP ownership semantics. **Effort:** medium.

**Handler batch implemented:** `closeRuntime` delegates to sticky per-runtime
disposal. Client cleanup failure no longer skips abort/drain or runtime cleanup;
failed owners stay retained and cannot be readmitted, including at the same
workspace identity. Session/server close promises are installed before callbacks;
startup, retirement and disposal aggregate original failures. An unpublished
factory or catalog failure is included in its owning retirement's outcome.
A rejected legacy reused runtime or another session's runtime closes only the
new binding, never replays disposal of the prior owner.

LC14-LC18 exercise actual registered handler logic; LC13 verifies the rebuilt
public MCP close behavior and current source identity. This closes the initial
handler skip/masking work, not native-client lifecycle qualification or W4's
internal Fovea shutdown work. Remaining narrow review coverage gaps are recorded
in the second-batch evidence section above.

### W3 — Repair artifact lifetime at workspace transitions (P1)

**Touchpoints:** `src/kiro/mcp-server.ts`, `src/kiro/runtime.ts`,
`src/kiro/artifacts.ts`, `src/kiro/power/artifacts-provider.ts`,
`src/kiro/projection.ts`.

**Design gate resolved by user; W3 implemented and focused verification passed:** retain response
artifacts for the same owner across detach/select/attach and temporary workspace
unavailability. Native host-session epochs have distinct authority; legacy mode
retains only MCP-instance ownership, not native-chat isolation. No guest-selected
owner ID, global readable store, cross-restart recovery or extra workspace grant.

**Scoped design:** a lazy owner-lifetime store provides trusted invocation-context
access for `artifacts.read`/`checkpoint` and host projection writes. The execution
service forwards that host-only capability; the provider must not fall back to
runtime-local storage when owner access denies a read. Standalone runtimes retain
their existing behavior; injected runtimes need no provider replacement or
ownership transfer. Existing response quotas/TTL and tighter checkpoint quotas
remain. Retirement revokes access synchronously and disposes owned data after
draining, with failures retained.

Serialize response artifacts after the deferred transition to avoid consuming
their lifetime while runtime cleanup waits. Only successful guest execution can
commit; output-storage failure cannot roll back a committed transition. Responses
separately report execution, transition and delivery, always `retryProgram:false`.
Validate advertised handles at publication; unavailable evidence is explicit.

Implementation touchpoints also include the host-only context in `src/protocol.ts`
and forwarding in `src/execution-service.ts`, plus a focused artifact-owner module.
No Fovea engine, installer, generic cleanup or unrelated protocol refactor is in
scope. Detailed checks/evidence: `.tmp/artifact-lifetime-RQDVht/acceptance.md`.

**Acceptance:** overflow plus each transition type has a truthful response and,
if retention is promised, a retrievable handle. Test store-write failure,
transition failure, cancellation, expiry, retirement, unavailable workspace,
foreign-owner reads, and recovery/checkpoint handles. Exercise the real MCP
handler, not only the projection helper. Never replay the guest program.

**Verified implementation:** `src/kiro/artifact-owner.ts` owns lazy, bounded
response/checkpoint storage. Host-only `FabricArtifactAccess` travels through the
execution service to the existing provider; neither injected providers nor
standalone runtime ownership is replaced. `runtime.ts` and `projection.ts` needed
no W3 edits. A failed write retains partial-file identities and uncertain
file-descriptor close errors, blocks further response-file acquisition, and
cannot falsely report successful retirement. Serialized transition diagnostics
fit their reserved output budget. W6 tightens direct workspace replacement:
revoke/drain happens before committing a changed binding, and failed pre-commit
cleanup reports `committed:false` with sticky failed ownership. Same-root no-ops
still revalidate directory identity. Post-commit delivery failure remains a
committed transition, never an invitation to replay the program.

**Passing coverage:** LC19-LC23 contain 47 source-handler/store variants; LC24
uses the rebuilt public MCP API, real compiler/QuickJS and real provider bridge
for overflow, checkpoints, receipts and unavailable-workspace reads. The complete
LC01-LC24 lane plus 8 runner controls and 6 built-runtime cases passed: 38 cases,
zero failed/partial/unavailable. Typecheck, dead-code lint, guidance/reference
checks, `git diff --check` and a fresh build passed. Independent read-only review
found two medium issues; both were reproduced/repaired, coverage gaps were added,
and the follow-up found no new blocking issue. Native analysis/transport remain
inert fixture boundaries; this does not qualify native chat or full release.

Evidence: `.tmp/verification-reports/baseline+runtime+lifecycle-HVpNoC`,
`.tmp/artifact-lifetime-RQDVht/acceptance.md` and `final-audit.json` in that task
directory. The original valid built red is
`.tmp/artifact-built-proof-gINMCX/report.json`; the earlier inline-output fixture
failure is not counted as product-defect evidence. All unrelated content/modes
and staging were preserved against the 745-entry starting inventory.

**Dependencies:** W0, W2, and the artifact access decision. **Effort:** medium/high.

### W4 — Harden Fovea lifecycle without broad deletion (P1)

**Touchpoints:** `src/fovea/engine-process.ts`, `src/fovea/engine-entry.ts`,
`src/fovea/host.ts`, `src/fovea/engine.ts`, new `src/fovea/scratch-owner.ts`,
`src/fovea/core/context.ts` and `src/fovea/core/temp-storage.ts`. Scheduler and
protocol behavior are regression-tested without an unrelated rewrite.

**Implementation:** completed under the focused source/built coverage below.
Independent review found five concrete gaps; all were repaired and a focused
read-only follow-up found no additional actionable defect. Existing core
housekeeping needed the host-only cleanup capability to avoid bypassing the new
owner. Four safe intercepted counterexamples changed from red to green; sync's
compound-error behavior and prior-failure latching have persistent controls.

**Work:**
- Recheck closed/unavailable state after lifecycle awaits and immediately before
  spawning or publishing a replacement. Audit restart alongside ensure/close.
- Land ownership-checked, repository-preserving engine cleanup before enabling
  new graceful-close paths. Existing recursive removal must not simply be
  exercised more often by wiring a previously bypassed shutdown handler.
- Separate graceful idle close/restart from forced failure/cancellation cleanup.
  Allocate graceful and forced stages within the existing total cleanup budget;
  do not extend the production bound to make tests pass.
- Preserve generation/correlation checks, synchronous lease revocation, crash
  budget and cleanup-uncertainty latches.
- Make generated scratch ownership explicit. Bound and verify any reclamation;
  retain suspicious, repository-containing, or uninspectable contents. Do not
  add a broad abandoned-instance sweeper over user storage.
- Treat IPC handshake startup and lazy parser initialization as different
  cancellation phases with separate observable outcomes.

**Acceptance:** close-during-stop cannot fork a replacement; reload remains
serialized; queued cancellation releases admission; stale/unsolicited replies
cannot affect another generation; graceful cleanup completes when cooperative;
forced fallback remains bounded and reports uncertainty. Repeated-query and
selective-retirement tests distinguish preserved graph state from retired state.
Use mocked children first; any process tests use owned children only.

**Verification:** LC25-LC30 register 60 W4 variants: 24 cleanup/maintenance,
25 mocked process/scheduler/cancellation, 7 source engine and 4 built/entry
controls. Repository and uncertain-tree regressions fence deletion attempts,
including if the implementation regresses. Native-child probes use only owned
children, explicit spawn-error assertions and a separate 15s harness budget;
production deadlines remain exact.

The combined baseline/runtime/lifecycle run passed 43 of 44 cases. LC30 exposed
a removable test-observer bug, not a widened production deadline: generation
shutdown removed the harness's listeners. The harness now observes actual owned
child emissions without replacing process/IPC behavior. The affected LC29/LC30
module then passed (7 + 4 variants). Thus 44 distinct focused cases passed across
these runs; **the original combined report remains a failed report**, not a
retroactively green full-suite claim. Source/script typecheck, dead-code,
reference and guidance checks passed; fresh builds and direct built probes
verify the shipped paths. Local evidence is retained in
`.tmp/verification-reports/baseline+runtime+lifecycle-HutFmc`,
`.tmp/fovea-built-proof-20HdRf`, and `.tmp/fovea-lifecycle-M0KrIC`.

Independent review's five findings were repaired; focused follow-up found no
additional actionable defect. Contour remains advisory: the host's publication
checks are intentional, tiny native/mocked fixture helpers stay independent,
and unrelated prior-work findings were not rewritten. Graph tests use inert
parser/source boundaries; real built-child tests deliberately reject parser
bytes before execution. This is not native parser, external-client, full-suite
or release qualification. Same-UID filesystem races are not kernel-contained.

**Dependencies:** W0; align close semantics with W2. **Effort:** medium/high.

### W5 — Unify installer exclusion compatibly (P1, separate patch series)

**Touchpoints:** `scripts/install-agent-user.mjs`,
`src/installation/installer-lock.mjs`, `scripts/managed-installation.mjs`,
`scripts/install-transaction.mjs`, staging/package validation and lock fixtures.

**Compatibility decision (implemented; focused local verification):** retain
both reviewed legacy staged install/uninstall and modern mutation entrypoints for
installation formats they already understand. Updated writers must exclude both
historical lock families. Two untouched historical writers using different
protocols cannot be retrofitted and have no cross-family concurrency guarantee.
Compatibility is defined by the reviewed behavior, not an invented release range.

Use a fixed, fail-fast legacy-gate then modern-lock acquisition order. Preserve
the modern wire formats and recovery protocol. PID-only, partial or foreign legacy
records never confer automatic reclamation authority; conservative retention can
require operator recovery after a crash. Do not yield the legacy gate while an
unresolved transaction, candidate or failed rollback makes the handoff unsafe.
Modern-only recovery remains supported when no ambiguous legacy obstruction exists.
No installation mutation may occur after yielding the legacy gate.

DeepSeek V4.1 Flash implements this batch; GPT-6 Astra independently verifies the
result. W6 regression modules may be prepared independently, but shared runtime
production changes and W7 integration remain separately owned checkpoints.

**Work:**
- Design a compatibility bridge that excludes supported writers using either
  existing lock protocol, with a single documented acquisition order.
- Do not merely rename a lock or assume a presence check closes the race.
- Keep incarnation, canonical-root, inode, nonce, stale-owner and quarantine
  checks. Ambiguous legacy recovery fails closed and preserves evidence.
- Preserve profile/launcher/release-state publication followed by owner manifest
  last, as well as commit-time control/hash checks and historical admission.
- Only consider retiring a legacy mutation entrypoint after the support decision;
  do not remove compatibility or historical evidence as incidental cleanup.

**Acceptance:** deterministic absent/legacy/modern installation matrices show
mutual exclusion, including a paused legacy writer across modern activation;
there is no deadlock between supported lock orders. Crash/recovery, inode swap,
PID reuse, partial controls and unknown ownership retain or reject safely.
Start with an in-memory filesystem/process model; do not mutate the installed
agent to prove this fix.

**Verified implementation (DeepSeek V4.1; independent Astra review):**
`acquireInstallationExclusion` holds both locks across the protected interval;
maintained legacy/managed writers, shell/profile mutators and backend admission
use it. Release tracks inode/root ownership and physical removal separately from
durability. Foreign owner bytes/inodes and ambiguous controls are preserved;
failed rollback or unresolved journal/candidate evidence retains the legacy gate.
Late retention and reentrant release cannot report both retained and released.

LK01-LK24 pass: real locks/callers, real paused historical child, source-backed
filesystem/process models, root/gate/incarnation swaps, modern-only recovery and
portable staged helper closure. The immutable pre-W5 text fixture is hash-pinned;
its loader documents import-resolution and executable-trust seams. No maintained
test depends on this session's ignored evidence files. Astra independently
rechecked the corrected fault schedules and found no remaining concrete blocker.

**Remaining acceptance gate:** LK19 exercises the updated legacy writer and
managed **rollback admission**, plus historical refusal of a managed owner. It
does **not** run full `installCompleteGeneration` activation with a real complete
bundle. Shared `mutate()` exclusion is source-traced, not a substitute for that
built activation matrix, native-platform or historical-release qualification.
Do not mark the original full W5 acceptance statement complete yet.

**Dependencies:** W0 and compatibility decision. **Effort:** high.

### W6 — Guard the remaining dangerous boundaries (P1)

Add focused invariants before structural edits:

| Boundary | Required regression |
| --- | --- |
| Prepare/approve/dispatch | Approved arguments equal executed canonical arguments; mutation during approval cannot redirect effects. |
| Local effects | Queue failure prevents later effects even when caught; failed cleanup never implies rollback. |
| Workspace replacement | Abort and revoke before replacement; changed identity prevents commit; old cursors cannot transfer authority. |
| Worker reuse | Fresh guest state, matching execution IDs, late-reply rejection, bounded idle disposal, cancellation and fault replacement. |
| Session/turn ownership | Same-workspace sessions have distinct ephemeral ownership; foreign/stale request IDs and receipts fail closed. |
| Delivery | Emission is not model acknowledgement; receipt failure cannot silently advance the baseline. |
| Persistence | Revision conflicts, lock loss, publication vs durability, and post-publication failure remain distinguishable. |
| Packaging | Public exports, worker entrypoints, product inventory, closure reachability and built/source identity are mechanically checked. |

Do not turn these into promises about external Kiro lifecycle behavior. Such
claims need an authenticated bridge and actual client event evidence.

**Verified implementation:** SB01-SB08 cover all eight local boundaries through
real source handlers, workers/guest execution, retained state bytes, isolated
sessions and real IPC with an inert engine. Direct workspace mutation drains
before binding commit; same-root inode replacement is rejected. Unexpected held
state-lock loss blocks subsequent effects, including initialization failure after
inode reuse. Removed the unnecessary cross-acquisition release cache instead of
retaining recyclable identity as authority. Committed state, durability and lock
cleanup remain distinct acknowledgement facts.

Astra verified the strengthened admission/receipt assertions with four rejected
mutants, independently verified workspace/cancellation/state behavior, and
rejected a restored stale-cache mutant. The old "confirmed release retry" label
was removed because it described ordinary writes, not that branch. Temporary
runner budgets now derive from actual case declarations; the maintained lane
passed at its own unchanged bounds. SB08 checks the fresh build, not a pending
or stale-build success label. Native client receipts and Navigator semantic
baseline advancement remain external qualification gates.

**Dependencies:** W0; land relevant cases with each fixing patch. **Effort:** high
across several small batches, not one rewrite.

### W7 — Reduce contract drift and structural coupling (P2)

**Touchpoints:** `agent-product.json`, `docs/agent-product.schema.json`,
`src/kiro/runtime.ts`, `src/protocol.ts`, `src/core/action-registry.ts`,
`src/execution-service.ts`, relevant validators and configuration documentation.

**Work:**
- Define supported versus currently mounted providers and reconcile inventories
  with registration. Account for product-file hash validation and historical
  schemas; the inventory is not currently a runtime authorization list.
- Prefer explicit provider requirements/effect contracts over new name-based
  exceptions, retaining existing fail-closed fallback until equivalence is tested.
- Extract narrow observation/bootstrap interfaces only where they remove actual
  coupling. Type-only bidirectional references are not a proven runtime cycle.
- Consider storage scalability separately after measuring whole-document costs;
  do not introduce a WAL as part of lifecycle correctness fixes.

**Acceptance:** each relevant provider registration and configuration entry is
mechanically checked; unavailable-provider restrictions and public declarations
remain compatible unless an explicit versioned change is approved.

**Verified implementation:** `src/kiro/provider-inventory.ts` documents the exact
10 supported names and requirements when registered; runtime availability and
registry authorization remain separate authorities. Six providers now declare
explicit requirements while fail-closed built-in fallback is preserved, including
the absent-repo empty fallback. Public symbols/declarations are additive.
`agent-product.json` and its pinned schema/hash were deliberately unchanged.

CT01-CT08 check inventory/registration, enablement/binding gates, unavailable and
unknown providers/configuration, historical product-hash admission, and semantic
source/built type imports. Documentation no longer presents inventory metadata as
permission. No speculative generic-interface rewrite or WAL was introduced.

`pnpm run verify:remediation` registers LK01-LK24, SB01-SB08 and CT01-CT08 in the
independent completeness contract and local-only CI lane. **40/40 passed**, plus
**47/47** adjacent baseline/runtime/quality/lifecycle cases after a fresh build.
Typechecking, dead-code lint and reference checks passed. Reports are retained at
`.tmp/verification-reports/locking+boundaries+contracts-9BinbT` and
`.tmp/verification-reports/baseline+runtime+quality+lifecycle-XqH7Qv`; independent
Astra reports and the task baseline/ledger are under `.tmp/w5-w7-KFgyWY`.
These paths are local evidence, not portable release certification.

**Dependencies:** W1-W6 coverage for touched behavior. **Effort:** medium.

## 5. Execution sequence and parallel ownership

1. W0: safe fixtures, explicit lifecycle lane, failing regressions.
2. W1: RPC queue fix and exact regression proof.
3. W2: shutdown propagation/joining and cross-layer admission checks.
4. W3 and W4: artifact lifetime and Fovea lifecycle, with separate file owners;
   serialize edits to shared MCP server/runtime integration.
5. W5: installer compatibility in an independent patch series after its decision.
   Design work can occur earlier; do not mix its integration with runtime edits.
6. W6: complete cross-cutting invariants as each boundary becomes testable.
7. W7: targeted structural improvements, not prerequisite rewrites.
8. Restore and qualify broader behavioral coverage before removing release gates.

Use narrow implementer/verifier roles if fanning out: one runtime/RPC owner,
one analysis-process owner, one installer owner, and one independent verifier.
A single integrator owns shared suite registration, package scripts and CI.
Do not send the entire remediation assignment to every agent or concurrently edit
shared files. Unrelated passing checks need not be repeated unless affected.

## 6. Verification and completion gates

For each implementation batch:

1. Record exact source findings, applicable invariants and a failing regression.
2. Trace callers and teardown consumers before editing; inspect blast radius.
3. Apply the smallest complete fix, including required public/configuration/test
   registrations. Review counterevidence, not just the success path.
4. Run the new targeted suite and relevant existing runtime/component checks.
   Audit their cleanup first. Inspect every nonzero result before retrying.
5. Run typecheck and relevant static/reference/dead-code checks. Keep expected
   unavailable full qualification separate from unexpected failures.
6. Run a fresh `pnpm run build` after the final change. Built-output checks must
   identify the actual rebuilt library/closure, not stale installed bytes.
7. Verify preservation of unrelated edits/staging and report remaining gaps.

`pnpm run verify:lifecycle` now runs the registered LC01-LC30 suite. Run a fresh
build first: LC13, LC24 and LC30 deliberately reject closures built from stale
lifecycle, artifact or Fovea source. The package command, CLI selector, independent completeness contract,
dead-code entrypoint and local-development CI step are registered and checked.
Existing useful entrypoints include `pnpm run typecheck`, `pnpm run lint:dead`,
`pnpm run guidance:check`, `pnpm run verify:references`, and
`node scripts/verify-offline.mjs runtime quality` after their safety audit/build.
They are not substitutes for the missing full behavioral suite.

Installer I07 is now restored and passing. Full release qualification remains\nblocked on the remaining historical/crash, packaging and external-client\nresponsibilities; local activation success does not close those gates.
Do not make `pnpm test`, `pnpm run check`, or packaging green by silently routing
them to only the small lifecycle suite. No commit or push is part of this plan.

## 7. Acceptance ledger

Checked items have scoped evidence; section 9 records the latest runs. Unchecked items remain open.

- [x] Safe lifecycle suite registered with completeness and fixture guards.
- [x] Cancelled RPC waiters retain unsettled predecessor ownership.
- [x] Same-server and different-server scheduling tests pass.
- [x] Core registry/service/runtime/session shutdown propagates failure and is joinable.
- [x] Cover outer-handler teardown, startup/publication failures and failed-owner admission with real-handler regressions.
- [x] Workspace transitions never return already-invalid artifact handles.
- [x] Artifact lifetime, expiry and owner access policy are specified and tested.
- [x] Fovea cannot spawn after terminal close/uncertain cleanup.
- [x] Scoped direct-engine graceful/forced shutdown checks meet unchanged production bounds.
- [x] Generated residue handling verifies ownership and preserves repositories.
- [x] Updated legacy/modern writers share exclusion; scoped fault/recovery checks pass.
- [x] Current built ACT-01..08 matrix and both nested-workspace smoke modes (local helper-generation evidence).
- [ ] Native/historical, crash/recovery and full installer/release qualification.
- [x] Eight local worker, session, approval, storage, delivery and packaging boundaries have maintained regressions.
- [x] Provider inventory is reconciled; public/configuration entries are mechanically verified.
- [x] Relevant source and rebuilt-output probes pass; unrelated work is preserved.
- [x] Remaining full-suite and native-client qualification gaps are explicit.

## 8. Decisions needed before gated implementation

1. **Artifact access — resolved and implemented in W3:** retain response artifacts
   for the same owner across workspace transitions, with unchanged bounds,
   explicit access checks, synchronous retirement and no cross-owner fallback.
2. **Installer support — conservative policy selected for W5:** preserve both
   reviewed writer protocols for their understood formats; updated writers use
   both gates. No old-vs-old cross-family guarantee and no PID-only legacy reclaim.
   See W5 for safe-handoff and operator-recovery limitations.
3. **Cleanup recovery:** which failures require process restart, and which allow
   a narrowly authenticated recovery operation without regranting unsafe work?
4. **Future actors:** keep model ownership in Kiro or add a distinct actor host?
   This is a separate feature decision and must not delay W0-W2 bug fixes.

W5's compatibility implementation, the eight W6 local boundary checks/fixes and
W7 contract consistency are implemented and independently reviewed. The local
complete-bundle activation matrix and I07 now pass. Remaining qualification work
includes the full broader/crash/platform responsibilities and authenticated native
client/receipt evidence. Do not remove the existing release blockers on the basis
of these focused results. W4 still defaults to sticky failure and owning-host
restart; no automatic cleanup-recovery/regrant API was added.

## 9. Qualification results and remaining gates

The deleted behavioral suite is being restored in audited batches, not replaced
by a small green lane. Earlier core/lifecycle, local-tool, installer artifact and
portable Fovea coverage remains separate from these newly completed runs.

### Verified local results (2026-09-24)

| Check | Result | Meaning |
| --- | --- | --- |
| Maintained I07 | Passed | Real synthetic staging, bounded identity/metadata preservation and controlled drift rejection. |
| ACT-01..08 | 8/8 | Real current complete-bundle activation, legacy migration, A/B rollback, exclusion, retained fences and backend failure diagnostic. |
| Nested-workspace smoke | Both modes passed | Real schema-2 backend under external and ignored in-repository temporary roots; each workspace has its own Git boundary. |
| FN01–FN07 | 7/7 | Current JS with independently admitted current-C/native artifacts; all seven recorded C identities match. |
| Additional portable installer subset | 155/155 in ten files | 121 passing-first checks plus 34 after two precise test-oracle ports; no pending results. |
| Activation admission controls | 13/13 | Exact generated-loader syntax/exports and bounded pointer decisions; four syntax-only subprocesses, no installer/candidate execution. |

Astra independently reviewed the repairs and actual activation, semantic, smoke
and portable receipts. An earlier seven-case FN run used older native bytes; it
is retained as mixed-C evidence, **not added again** to the current-C result.
Matching source hashes are not independent compiler reproducibility or native
client/model-input provenance.

Astra's counterexamples led to bounded I07 snapshots, independently anchored
semantic admission, corrected activation child completion/retention, and two
final integration fixes: maintained legacy exports are no longer appended twice;
present invalid pointers (including dangling links) cannot silently become cache
misses. Pointer captures are bounded, owned and no-follow. The pinned historical
fixture bytes and production executable-trust rules remain unchanged; the
historical writer harness still has its explicitly documented trust/import seams.

The independent activation contract requires all eight IDs. ACT-04 retains lock
checks; ACT-08 reaches genuine backend initialization/inventory before injecting
only a response-observation fault. An explicitly staged base uses both
`KIRO_FABRIC_ACTIVATION_BASE` and `KIRO_FABRIC_ACTIVATION_TASK_ROOT`, forwarded only
to activation workers. Current captured inputs, native target and tool pins are
still required. Use `node scripts/verify-offline.mjs activation --json`; direct
unsupervised matrix execution refuses. The existing invalid shared pointer was
preserved; successful private staging does **not** certify the public publisher
or repair that pointer.

Maintained non-executing admission regressions:

```sh
node scripts/verification/activation-admission-probe.mjs /absolute/private/fixture-output
```

The CLI recovery port requires the exact journal-synced interruption, planned
owner/candidate bindings, validated generation and live legacy gate. Each repeated
CLI refusal must preserve the bounded home inventory, journal and representative
data independently, without a backup or client. Historical upgrade tests likewise
preserve controls and both generations after interruption. These are **fenced
preservation, not recovery success**; no PID/nonce-only takeover was introduced.
The TUI port changes only the exact obsolete Fovea display expectation to Navigator.

Receipts are retained under `.tmp/qualification-vbsUbs/` and
`.tmp/verification-reports/` (activation `activation-QJWBNl`, current-native
semantics `semantic-baseline-do8amg`). Activation/semantic/smoke repositories are
retained. The portable Vitest subset retains reports/environments but uses its
audited non-repository fixture teardown; it is not a retain-all test mode.

### Still open — do not promote local results

- Forced detached-Navigator settlement and production smoke forced-close certainty.
- Native client/model-input delivery, complete tool filtering and interactive approval qualification.
- Linux/cross-platform evidence; five existing Linux source-retention checks are pending on Darwin, not passes.
- Remaining crash/recovery, untouched historical, packaging/cache and full release responsibilities.
- Configuration-backup cleanup is repaired in section 10. Other legacy/historical transitive cleanup remains held; safe fixture teardown alone does not guard production effects.
- Public shared-pointer/publisher qualification; invalid existing evidence must not be hidden, replaced or used as runnable authority.

The primary full-suite, installer/release and native-client gates remain
fail-closed. See [offline semantic admission](fovea/host-capability-probes.md#offline-semantic-admission-not-native-qualification)
for the three independent trust inputs. No commit, push, live-client auth or
Kubernetes access is part of this work.

## 10. Next batch — configuration-backup preservation

Implemented the scoped backup cleanup repair:

- Creation never prunes older snapshots or removes a failed copy. All repository
  metadata and unknown/partial evidence remain; storage can grow beyond 20.
- The top-level manifest name is reserved before copying. Its bounded contents
  are published exclusively after payload sync, without replacement rename,
  temporary-file unlink or rollback. The intended manifest hash and exact tree
  are checked before successful return.
- Failures retain the original cause and report the attempted path with
  `configurationBackup.status: "unverified"`. Write and close failures are
  aggregated. Human/JSON projection does not fabricate activation success or
  label uncertain evidence as a successful prior backup.
- Listing uses the same exact schema-1 verifier as restore, with same-home
  binding, no-follow reads and explicit aggregate limits. Exhaustion throws,
  not an incomplete list. Content-complete bytes after a failed sync may still
  validate later; this is not crash-durability or independent-authenticity proof.
- Restore's publication body and larger per-backup budget remain unchanged.

Local evidence: **21 dedicated preservation/publication checks and 93 selected
compatibility checks passed**. Eleven original controls first failed under
throwing deletion recorders; no destructive baseline effect was allowed. Later
selected runs add seven publication and three resource controls without counting
previously passed deselections as new tests. Compatibility includes real pinned
Node restore, legacy-v1 positive admission, malformed list/restore refusal,
filesystem identity/mode guards and preserved clock-rollback snapshots.

A separate unmocked API probe passed creation, listing, real pinned restore,
source/backup repository preservation, malformed-sibling refusal and occupied
restore refusal. All new test/probe roots are retained. Fault-injection entries
are displaced into fresh evidence roots rather than deleted. The former actual
socket test is explicitly classification-only now, not socket lifecycle evidence.

Astra independently reviewed the source/effect boundary. The two standalone/
bundled-manager CLI test cases were excluded (not passed); historical installer
cleanup, detached settlement, Linux/client/release and public-publisher gates
remain open. Listing's 256 MiB cap has direct exhaustion coverage; support for a
single valid larger backup is established by unchanged create/restore budgets,
not a new large-payload execution certificate.

Evidence: `.tmp/backup-safety-dZnyVp/`, including `astra-review.md`, retained test
receipts and the direct API probe. The section 9 ACT/FN receipts predate these
production changes and are **not fresh qualification of the changed build**.
See [installer backup policy](installer.md#pre-mutation-configuration-backup)
for storage-growth and listing-limit implications.
