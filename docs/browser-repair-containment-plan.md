# Cleanup repair and browser containment: implementation plan

> **Historical / superseded by Browser Harness removal.** Browser implementation, CLI/provider entry points, bundled skills and execution qualification described below are no longer shipped. This document is retained for provenance (including unrelated verifier/cleanup repair history), not as current setup instructions, available functionality or verification evidence. See [current removal and verification notes](browser-removal.md). Historical paths may no longer exist.


Status: **P/browser repairs, scoped cleanup retention and local packaging/component checks implemented; full I07/N3-N6 coverage remains incomplete**. The [detailed N3 and N4 wiring plan](browser-n3-n4-implementation-plan.md), sections 11–14, records implementation and current results. Under the user's no-tests instruction, existing case files remain unchanged and no new B01-B10/control cases were written. Keep aggregate wiring blocked until its required coverage is complete. R1 cleanup is guarded but not an atomic hostile-filesystem guarantee; real activation remains unqualified. R2/R4 are partial and R3 is not release-grade verification. C0-C1 remain design work; C2-C3 have not started. Earlier A-series work remains partial/historical. The CDP-only full-containment no-go remains in force. Section 15 preserves earlier command results with explicit corrections below.

This is the current ordering supplement to the [A2/A0 plan](browser-harness-a2-a0-implementation-plan.md), [Q2/Q3 plan](browser-harness-q2-q3-implementation-plan.md), [containment decision record](browser-isolation-design.md) and [W6 qualification plan](browser-harness-w6-implementation-plan.md). It does not grant permission to install, authenticate, change host networking, launch a browser, commit, publish or modify production admission.

## 0. Repair progress in this working tree

Rechecked against the working tree while preparing section 14. Earlier build/probe results below are prior-run evidence, not a rerun of missing suites.

- **R0 — inspection performed; bounded evidence still needed.** Previous path/AST audits reported no missing named imports in the inspected live graph. They did not certify external consumers, computed references or public API compatibility. The three source-install modules were the **selected recovery set**, not the only Git-recoverable files. The absence of staged changes at recovery time proves neither that deleted files had no earlier unstaged edits nor that HEAD contained every deleted byte.
- **R1 — restored/registered, acceptance partial.** `scripts/source-install.mjs`, `scripts/source-bundle-stage.mjs` and `scripts/source-pull-hook.mjs` were restored from HEAD; the frontend is registered in `knip.json`. Import/help/isolated dry-run probes were reported successful. The blind `fs.rmSync(temporary, { recursive: true, force: true })` is gone: staging is now created 0700, identified by dev/ino, and removed only through the guarded `scripts/source-staging-cleanup.mjs`, which retains and reports anything it cannot positively identify (wrong prefix, outside tmpRoot, identity mismatch, symlink, `.git`/worktree/bare-repository metadata, unknown entries, traversal over bound). I01-I09 in `scripts/verification/installer-cases.mjs` previously reported two passing runs, but I07 omits required staging scenarios. The first P repair now marks it partial and returns nonzero; complete behavioral acceptance is not established. Real activation, rollback and post-restart recovery remain unqualified; do not execute activation to fill that gap.
- **R2 — lifecycle/routing production fixes implemented; authority coverage incomplete.** The actual path is `ActionRegistry` → provider callback/operation selection → `BrowserHost.run` → managed session/operation → broker. `BrowserProvider` selects `RECIPE_OPERATIONS`; contained `WebProvider` calls `searchCards`/`readPage` directly through the same host. No operation worker exists. Host cleanup outcomes, returned-wire retirement, confirmed target disposal, late-creation accounting and sticky web routing are repaired with memory-only diagnostics (detailed plan section 12). The B01–B10 regression suite remains absent; diagnostics using private unit authority do not certify receipt/approval ordering, queue-drift coverage or native containment.
- **R3 — command routing repaired; verification incomplete.** `scripts/qualification-unavailable.mjs` exists and named retired suites exit nonzero (previously observed 69). `check:local` currently runs guidance, typecheck, build and Knip only. `scripts/verify-project-references.mjs` and `scripts/verify-offline.mjs` now exist and their package commands are registered, but incomplete installer coverage and the missing browser suite still block aggregate wiring after the first P integrity repairs. CI placeholders intentionally fail; placeholder correctness is not suite completion.
- **R4 — README development guidance corrected; broader reconciliation incomplete.** `README.md` now distinguishes local static/build checks, offline coverage gaps and the unavailable fast/full/release gates, and explains retained task state. `docs/audit.md` and the broader historical docs set remain to reconcile. A prior read-only inventory probe found all **26** component-declared paths present, all **9** skill source hashes matching, and matching upstream commit fields; this remains metadata evidence only, not runtime/native qualification.

**Still blocked/unavailable:** complete installer behavioral acceptance, the missing browser suite, deleted release-grade suites, and fresh native/W6 qualification. Remembered/manual modes and stronger containment claims must not be enabled by this repair. A green static/build-only check is not evidence of those capabilities.

## 1. Delivery boundary and decisions

Deliver two separately reviewable workstreams:

1. **R — repair the baseline:** recover required installer functionality, reconcile command/CI/documentation contracts and add a small, explicit behavioral-verification path. Preserve the user's removal of the bulk test suite and benchmark tooling; do not recreate them wholesale.
2. **C — resolve containment:** specify the required guarantees, compare enforceable mechanisms, make a platform-specific decision and only then implement a private feasibility prototype. A proxy setting alone is not a security boundary.

Default recommendation: restore the three required source-installation modules; introduce a lean, honestly scoped offline verification entrypoint; keep unavailable qualification gates explicitly blocked. Do not resurrect hundreds of tests, remove safety gates merely to make CI green, or continue deleting declarations to satisfy Knip.

Small verification programs are still tests in substance. Their size, effects and acceptance coverage must be explicit; renaming them to “probes” does not replace the lost regression suite or certify its former scope. Implementation of the small replacement verification path must be approved as part of the repair scope. If all behavioral verification is rejected, record the repair as unverified and do not advance safety-sensitive features or release gates.

### Mandatory boundaries

- No more bulk deletion, Git reset/checkout/clean/restore operations, history rewriting, staging or commits. Use read-only Git object inspection followed by reviewed, exact file writes for recovery. Never replace an existing edited file wholesale from HEAD.
- Do not weaken `AGENTS.md`, executable/ownership checks, approval policy, evidence validation or byte limits.
- Do not access Kubernetes, credentials, personal browser profiles, real Kiro homes, production services or unrelated processes.
- Default repair verification is offline and non-installing: no browser, downloads, authentication, shell integration, pull-hook activation or global settings changes.
- Retain task-owned verification artifacts by default. Never delete repositories or uncertain fixtures. Audit cleanup and subprocess effects before running recovered helpers.
- Remembered/manual capabilities remain unavailable. Changed binaries/policy/flags invalidate affected historical evidence; never edit a prior pass record to bless new bytes.

## 2. Source-checked baseline and acceptance ledger

The table below records the **pre-repair baseline**, not the current state. Section 0 records subsequent changes; section 14 defines the remaining implementation and acceptance work. Keep the original ledger IDs for traceability.

| ID | Current evidence | Required repair/decision | Exit evidence |
| --- | --- | --- | --- |
| R-I | `install.sh` executes a missing source-install frontend for both help and source install | Restore the frontend and its necessary dependency closure | Help/argument probes, import checks and isolated injected frontend behavior; no real install |
| R-D | Historical frontend imports the also-deleted source-bundle-stage and source-pull-hook modules | Recover all three together; inspect imports/exports and cleanup against current code | Each required import exists; exercised branches keep trust and opt-in rules |
| R-C | `.github/workflows/ci.yml` calls a missing installer suite runner for contracts and bundle | Replace the retired test-tree coupling with explicit verification commands and honest coverage | Workflow callers resolve; checks execute assertions and propagate nonzero exits |
| R-P | `package.json` still advertises two missing Fovea qualification drivers | Restore a reviewed supported closure or give an explicit unavailable result | No advertised command ends in an unexplained module-not-found; unavailable is nonzero and non-qualifying |
| R-V | `test`, `test:fast`, `test:built`, `check`, `prepack` and release workflows still assume the deleted suite | Separate lean local verification from release-grade qualification | Missing required coverage remains a release blocker, not an empty passing suite |
| R-A | Cleanup stripped many exports and deleted declaration bodies; static reachability missed shell callers | Audit changed API/dynamic/shell/native paths; restore only demonstrated dependencies | Consumer-by-consumer inventory plus import and behavioral probes |
| R-B | `src/browser/worker-core.ts` retains `RECIPE_OPERATIONS`, but its `WorkerCore` class and worker protocol were removed | Correct claims; decide if a future worker is needed rather than claiming one exists | Runtime, comments, audit and plans agree on the actual in-process path |
| R-E | Plans/audit cite deleted tests, prior passing counts and obsolete entrypoints | Mark historical evidence explicitly and publish a current ledger | Current pass/blocked/not-run results with exact code identity and scope |
| C-M | CDP `Network.loadingFinished` accounting is post-transfer; current code does not bind Chrome's actual peer before emission | Define and evaluate an external enforcement mechanism | Requirement-to-enforcement matrix; no inferred security capability |
| C-G | No new owner-wide coordinator or feasibility driver is present | Build only after an accepted mechanism decision | Controlled fixed-operation report, not production admission |
| C-Q | W6 needs independent containment, installed-byte and native-client witnesses | Preserve the downstream release gates | No mock/smoke or rebuilt candidate reuses qualification |

Previously reported typecheck/lint/build success is narrower than installer, native or behavioral correctness. The pre-cleanup 3,850-test result does not certify this working tree.

## 3. R0 — freeze the repair scope and trace the real consumers

**Dependencies:** none. **Effects:** read-only inspection and private task-owned evidence files only.

1. Record current Git status, staged changes, tracked deletions, untracked files and content hashes of files the repair will touch. Keep this local under a new task-owned directory in `.tmp/`; do not overwrite old reports or stage anything.
2. Inspect HEAD and the index separately. A path in `git ls-files` is not proof that its last working-tree contents were committed. If a deleted file had uncommitted edits, determine whether an exact local copy exists; label reconstruction explicitly if not. Do not promise that every deleted byte is Git-recoverable.
3. Build a bounded consumer manifest covering:
   - `package.json` scripts, bin/exports/files and chained package commands;
   - `install.sh`, shell subprocess arguments and `.github/workflows/` steps;
   - static imports, literal dynamic imports, worker entrypoints and computed paths;
   - `agent-product.json`, packaging allowlists, native binding names and build entrypoints;
   - active documentation commands and policy/evidence references.
4. Classify every missing target as restore, replace, explicitly unavailable or historical reference. Unknown computed paths require manual review, not a zero-reference conclusion.
5. Review the cleanup diff separately from older browser/Fovea work. Do not use a whole-file HEAD restore to undo only one lost export. Pay particular attention to installer APIs, script CLIs, `src/index.ts`, native loaders and public declaration output.
6. For source-declaration cleanup, distinguish “unused export” from “unused declaration.” Review attached JSDoc and exported types as well as runtime imports. Do not repeat the strip-export/delete-until-green loop.

**Exit:** an exact recovery list and consumer manifest, with uncertainty recorded. No product files are changed by R0.

## 4. R1 — recover source installation as one coherent unit

**Dependencies:** R0. **Primary current files:** `install.sh`, `scripts/install-manager.mjs`, `scripts/build-complete-bundle.mjs`, `scripts/install-agent-user.mjs`, `scripts/installer-platform.mjs`, `scripts/installer-home-preparation.mjs`, `scripts/installer-shell-integration.mjs`, `scripts/build-inputs.mjs`, `knip.json`.

**Recovery targets, absent at plan creation:** **scripts/source-install.mjs**, **scripts/source-bundle-stage.mjs**, **scripts/source-pull-hook.mjs**.

1. Read the selected historical blobs and compare their expected imports with current surviving modules. Recover the three missing files using reviewed explicit writes, only while their destinations remain absent. Preserve provenance of the recovered bytes.
2. Reconcile any helper exports removed during cleanup when an actual consumer needs them. Keep internally used declarations intact. Do not re-export everything for lint convenience.
3. Preserve frontend behavior: explicit source opt-in, trusted executable and path checks, declared Node/pnpm prerequisites, build-input drift checks, private staging, artifact leases, manager handoff and accurate late-failure/commit reporting.
4. Preserve shell integration and pull-hook consent as distinct explicit effects. Importing the module, requesting help or rejecting bad arguments must not install, activate hooks, write backups or modify Git configuration. Restore the hook helper's capability, not an active hook in this checkout.
5. Inspect the recovered temporary-directory cleanup and every delegated operation. Prefer retaining generated verification evidence; if production cleanup is required, prove exact ownership and absence of repository metadata before removal. Do not execute the historical recursive cleanup merely because it was previously committed.
6. Register real shell-only entrypoints in Knip so the same false-orphan diagnosis cannot recur. Review build-input/packaging identity coverage deliberately: do not package developer frontends into the agent runtime merely to make them reachable.
7. Add small injected seams only where needed to exercise help, preflight, build selection and manager dispatch without spawning real installation effects. Do not add production bypass environment variables.

**Behavioral checks:** import without invoking main; help and unknown/duplicate arguments; denied prerequisites; valid injected dry-run; source digest changes before activation; changed destination/ancestry; shell/hook opt-in refusal; errors after a reported commit remain honest. Use isolated temporary HOME/KIRO_HOME and count effect calls, not just stdout. Inspect whether a “dry-run” is actually non-mutating before using it.

**Exit:** source-install entrypoints resolve and the scoped checks pass. A real installation has not been performed or certified.

## 5. R2 — audit the surviving product and rebaseline browser claims

**Dependencies:** R0; may run alongside R1 inspection, not alongside conflicting writes/builds.

1. Trace `ActionRegistry` → provider → `BrowserHost` → `RECIPE_OPERATIONS` → operations/session/broker. Confirm approved receipts, policy/mode/scope revalidation, terminal faults, deadlines and revocation still exist in the shipped path.
2. Remove the stale claim that `worker-core.ts` currently dispatches worker frames. Keep the fixed-operation registry; do not recreate a worker merely to match old prose. If the chosen containment architecture later needs a separate worker, specify its IPC and host-only admission as new work with its own checks.
3. Audit removed browser/compiler and Darwin adapter modules against actual consumers and native loading paths. An intentionally removed unused wrapper need not be restored; a runtime loader dependency must be. Record the decision for each, not a blanket restoration.
4. Inspect public symbol and declaration changes from the cleanup. Restore supported API symbols where contracts or real consumers require them; document deliberate compatibility changes instead of silently breaking them.
5. Add representative lean checks for missing/forged/replayed receipt rejection, approval-before-dispatch, post-queue policy drift, terminal final-response failure, cancellation and cleanup ordering. Exercise the live in-process path, not removed worker APIs. These are focused regression checks, not renewed full-suite qualification.

**Exit:** live browser behavior and advertised API/architecture agree. Remembered/manual remain blocked, and no old evidence is requalified.

## 6. R3 — lean behavioral verification and command/CI reconciliation

**Dependencies:** R1/R2 contracts and approved minimal verification scope.

### Proposed small development-only surface

The reference/offline runners below are still proposals. The retirement dispatcher now exists, but does not implement those runners:

- **scripts/verify-project-references.mjs** — consumer-manifest/path/registration audit; no module execution or network.
- **scripts/verify-offline.mjs** — fixed suites (`baseline`, `installer`, `browser`, `all`) with explicit case IDs, bounded fixture processes and JSON results. Use built-in assertions and shared existing helpers where safe; do not rebuild a general testing framework.
- **scripts/qualification-unavailable.mjs** — implemented shared nonzero dispatcher for retained legacy qualification command names whose implementations no longer exist. This is blocking behavior, not replacement coverage.

Keep these out of `agent-product.json` runtime assets and installed model tools. Register intended dev entrypoints in Knip/TypeScript and the audit inventory; include them in relevant source verification identities, not automatically in the shipped runtime closure.

### Required verification semantics

- Missing suite/case, unknown flag, empty selection or zero executed checks is a failure. Denied, failed, skipped, unavailable and passed are separate states; none of the first four means qualified.
- Assert actual outcomes and side effects. One positive plus negative-control path is required where a denial-only run could falsely pass because nothing ran.
- Use one absolute monotonic operation deadline and separate generous fixture spawn budgets. Inspect spawn errors and exit codes explicitly; no swallowed exit statuses, `|| true`, pass-with-no-tests or truncating pipes in gate commands.
- Offline cases use owned synthetic fixtures, local IPC or injected transports. A case requiring a real browser/host configuration is unavailable, not silently attempted.
- Fixtures live in exact new private roots, never in a personal home or repository fixture. Retain outputs by default. No repository cleanup, broad recursive removal or killing by process name. Cancellation can signal only positively owned child incarnations/groups.
- Report schema: check/suite ID, expected contract, outcome, observed facts/counters, source/build identity, elapsed time, cleanup state and evidence location. Fail on any required omitted case. Reports are non-qualifying local evidence, not production browser records.

### Commands and CI policy

1. Define **verify:references**, **verify:offline** and **check:local** in `package.json` only after their targets exist. `check:local` runs guidance, typecheck, fresh build, reference audit, approved offline checks and lint sequentially. Its output must say **local-development verification; not release qualification**.
2. Retire the obsolete Vitest-backed `test:*` contract deliberately. Either give old command names an explicit nonzero retirement diagnostic or map them to a documented lean check only with the changed scope visible. Do not claim the old test suite passed.
3. Keep the release-grade `check`, `prepack`, `release:candidate` and release workflows fail-closed until all required release verification has an approved implemented replacement. A successful `check:local` must not implicitly bypass them. While unavailable, fail with a named missing-coverage reason rather than a missing test directory/module error.
4. For the two missing Fovea commands, preferred initial repair is an explicit **qualification unavailable after suite removal** nonzero result, preserving command names for discoverability. Restoring their full dependency/fixture closure is a separate bounded decision; neither deleting the gate nor printing success is acceptable.
5. Replace the two missing installer-runner invocations in `.github/workflows/ci.yml` with the actual scoped verification entrypoints. Keep native matrix/platform and bundle acceptance requirements explicit. A local synthetic installer check cannot replace native crash recovery, minimum-system or bundle installation qualification; required unavailable coverage continues to block the corresponding release/job result.
6. Audit all other workflows for inherited `check` assumptions. Do not dispatch CI, upload evidence, sign or publish from this repair.
7. Run a fresh staged component-MCP check and packaging validation only after auditing their effects/cleanup and confirming cached prerequisite tools are available. Audit `scripts/certify-kiro-agent.mjs` temporary-root cleanup first. The reported scope remains `component-mcp-only`, authenticated Kiro `NOT TESTED`. Missing prerequisites stop the probe rather than triggering downloads or host changes.

**Exit:** all entrypoints resolve or report intentional unavailability, lean checks have executed real assertions, and release blockers remain visible. “Baseline repaired” does not mean “release certified.”

## 7. R4 — documentation, identity and repair handback

**Dependencies:** R1–R3.

- Reconcile `docs/audit.md`, the five browser plans, containment/configuration/installer/release docs, CLI guidance, package script descriptions and workflow summaries. Label removed tests and pre-cleanup results as historical. Resolve active links/commands; retain useful historical evidence rather than rewriting it to current paths.
- Review exact browser/component/skill inventories after source deletion. `src/browser/component.json`, `src/browser/upstream.json`, `skills/browser-harness/skill-manifest.json` and build manifests must describe actual files and provenance. Historical evidence bytes remain unchanged and inadmissible where identity differs.
- Mechanically confirm no new guest tools, authority constructors, arbitrary proxy/CDP endpoints or qualification overrides were registered. Review `src/index.ts`, provider descriptors, guest bootstrap/types, installed operator API and package exports.
- Review the coherent repair diff. Do not claim a static reference scan covers computed shell/native/import paths; carry explicit manual cases in the consumer manifest.
- Run approved scoped verification, record blocked gates, then finish with a fresh `pnpm run build`. Do not manually wipe `dist/`; audit the build's generated-output cleanup scope first. A build alone is not acceptance.

**R acceptance:** R-I/R-D/R-C/R-P/R-A/R-B/R-E have current scoped evidence; R-V is either implemented with honest coverage or explicitly unavailable at the release boundary. No personal installation, native-browser activity or release claim.

## 8. C0 — define the exact containment contract before choosing a proxy

**Dependencies:** R0; desk analysis can overlap R1–R4. Code/native execution waits for the repair baseline and an accepted design.

Write a requirement-to-enforcement table with an adversary model: untrusted pages, compromised renderer, compromised browser/network process, hostile local same-user process, trusted host broker and trusted OS. State which are in scope. A CDP check in a trusted browser and an external boundary against a compromised browser are different guarantees.

For every requirement name the enforcement component, measurement unit, allocation scope, decision/commit point, revocation boundary, unavoidable in-flight allowance and independent observation method:

| Requirement | Must resolve before selecting a mechanism |
| --- | --- |
| Destination | Which component resolves DNS, rejects all forbidden IPv4/IPv6/mapped/private/reserved addresses, pins the selected address to its actual socket, and prevents direct browser DNS/TCP/UDP alternatives? |
| HTTPS semantics | Who can enforce scheme/origin/path/method/body/cookies/redirects? A CONNECT tunnel sees a destination and opaque TLS, not per-request HTTP semantics. |
| Byte budgets | Distinguish browser plaintext payload, encrypted tunnel bytes forwarded, bytes received into gateway/kernel buffers, and actual network-interface bytes including headers/retransmission. Define outbound and inbound separately. |
| Preventive limit | A gateway can stop forwarding bytes beyond its allocation, but cannot promise the remote peer never sent excess data or that kernel buffers received none. Backpressure and Content-Length are not hard inbound wire ceilings. |
| Shared traffic | HTTP/2 multiplexing/coalescing, connection reuse, speculative activity, DNS and TLS overhead, caches/SWs, compression and streaming need explicit attribution or refusal. |
| Owner lifetime | Containment must precede browser startup and cover every child/realm, idle/background/restored target and control-loss state; not just attached pages. |
| Local data | Denying network bypass is not filesystem containment. Define profile, IPC, keychain, clipboard, local file and ambient descriptor access. Preserve Chrome's sandbox. |
| Authority | One-shot approved operation scope, owner generation, deadline, budget reservation and synchronous revocation; no standing permission for idle profiles. |

A product-wide “hard wire cap” must not be silently redefined as “maximum bytes returned to the model/browser.” If the requirement remains impossible on supported hosts, record **no-go**. Any narrower contract needs explicit product/security approval and a new policy identity before implementation.

## 9. C1 — compare deployable architectures and record a decision

**Dependencies:** C0. **Deliverable:** a new architecture decision section/document linked from `docs/browser-isolation-design.md`. Public-document research is allowed; no host security/network changes.

| Candidate | Useful properties | Unresolved limits / decision gates |
| --- | --- | --- |
| Forward/CONNECT gateway + OS-enforced browser confinement | Gateway selects actual remote peer; can cap forwarded encrypted stream bytes; may preserve end-to-end browser TLS | Cannot inspect encrypted HTTP path/method/body. Multiplexing/grant attribution, browser-to-gateway trust and process confinement require proof. Hard ingress wire cap remains a separate issue. |
| TLS-terminating policy gateway + OS confinement | Can inspect and enforce HTTP-level semantics and application forwarding limits | Alters TLS/network behavior, requires a distinct trust/secret boundary, can break browser features and cannot by itself prevent excess inbound interface bytes. No global certificate installation. |
| Dedicated local VM / isolated browser environment with controlled egress | Potentially stronger process/filesystem/routing ownership | Provisioning, display/manual UX, updates, resources, privileges and native target support are new dependencies. A VM alone does not solve encrypted request policy or exact wire-budget semantics. |
| Keep current CDP-only backend | No new provisioning; preserves current browser network stack | Retains the demonstrated no-go for stronger guarantees. Cannot unlock A3/manual modes by relabeling existing checks. |

Evaluate each candidate on darwin-arm64, darwin-x64, linux-arm64 and linux-x64. Record exact supported OS versions, browser availability, required entitlements/privileges, deployment ownership, updates, resource cost and safe shutdown. Linux user/network namespace availability and macOS process/network controls are **unknown until verified**, not promises of a universal unprivileged solution. Do not disable system protections or rely on undocumented flags alone.

For TLS-preserving candidates, explicitly decide how HTTP-level restrictions compose with the external boundary and which component must remain trusted. If the required threat model excludes trusting Chrome for request semantics, an opaque tunnel plus CDP is insufficient.

Assess ordinary browser usability and CAPTCHA incidence separately from containment. Preserve real browser behavior where possible; do not promise a normal TLS fingerprint means no CAPTCHA. No fingerprint spoofing, imported personal state, fake history or automated CAPTCHA solving.

**Decision outcomes:** accepted for development on named targets; rejected/no-go; or inconclusive with named prerequisites. Select one backend only after this review. If no candidate satisfies all mandatory requirements, keep blocked and present the product tradeoff rather than coding around it.

## 10. C2 — private feasibility prototype and offline acceptance

**Dependencies:** R4 + accepted C1 decision. **Effects:** local source/build and fake transports only. Do not register a production backend yet.

Possible new file names, to be finalized after C1: **src/browser/egress-policy.ts**, **src/browser/egress-gateway.ts**, **src/browser/confinement.ts**, **src/browser/target-coordinator.ts**, **src/browser/feasibility-entry.ts**, **scripts/browser-feasibility-driver.mjs**. These are proposals, not existing modules or an instruction to create empty abstractions.

1. Define a deny-first owner lifecycle: created → boundary prepared → gateway ready → browser spawned → control/realm mediation ready → admitted; faults → revoked → stopping → stopped/uncertain. Never publish readiness when only a debugging endpoint exists.
2. Keep gateway credentials/grants host-side and bind them to the actual owned process/transport. A loopback listener or bearer token available to page JavaScript is not sufficient process attribution. No guest-visible authority or arbitrary connection API.
3. Reserve budgets atomically before forwarding/committing authorized work; share budgets across realms; refund only provably uncommitted reservations. Latch faults and stop new grants/traffic on expiry, policy drift, disconnect or owner-generation change. Report in-flight effects separately from new commits.
4. Prevent direct DNS/TCP/UDP/QUIC/WebRTC and local-proxy bypass before browser spawn, with the chosen platform mechanism. Chrome flags supplement enforcement; they do not replace it. Unknown/unsupported channels fail closed.
5. Reuse `src/browser/process-supervisor.ts` and ownership/profile seams where their contract fits. Shutdown must preserve lock/profile evidence on uncertainty; no shared-control loss followed by permissive continued execution.
6. Driver defaults to non-launching preflight. Import/help/preflight cannot spawn a browser, connect to a debugging port or create production settings. Unknown flags/manifests refuse. Real execution requires a separate explicit allow-execute mode and reviewed manifest.
7. Use a strict non-qualifying report type with exact code/browser/OS/flags/policy/fixture/observer identities, case outcomes, counters/units, coverage gaps and cleanup state. Do not feed it into schema-3 production evidence. Reports cannot be converted to qualification by editing a flag.
8. Add small deterministic checks for receipt forgery/replay, revoked grants, queue and deadline races, DNS/address binding decisions, size limits, background/unknown targets, lifecycle cancellation and report validation. Independently verify report rejection at production admission/operator boundaries.

**Exit:** offline contracts pass, preflight demonstrably has zero browser/network effects, and a reviewed native experiment manifest can be produced. Production modes remain blocked.

## 11. C3 — separately authorized native go/no-go experiment

**Dependencies:** C2; explicit owner approval of exact host, browser, mechanism, endpoints, resource limits and retained artifacts. This plan is not that authorization.

Start with one real supported native target; do not interpret a local result as macOS/Linux or four-target qualification. Use a new disposable research profile and task-owned controlled fixtures. No real Kiro authentication or remembered personal state is required for this component experiment.

Required cases:

1. **Positive control:** a benign fixture renders through the allowed channel; independent sink evidence confirms actual traffic and expected browser identity.
2. **Before first effect:** observe startup/child/restored/background traffic and prove denied paths cannot emit before confinement readiness.
3. **Bypass matrix:** browser-owned TCP, UDP, DNS, QUIC, WebSocket/WebTransport, WebRTC, workers/SWs, nested frames, speculative requests and alternate local routes are enforced or explicitly unsupported. No unexplained blind spots counted as passes.
4. **Destination matrix:** owned canaries for address changes/rebinding, IPv4/IPv6/mapped forms, redirect/reuse/coalescing. Never probe actual cloud metadata, private services, admin endpoints or Kubernetes.
5. **Byte matrix:** oversize declared/undeclared/chunked/compressed/streaming/opaque/cache responses, concurrent realms and cancellation. Report actual units and buffers/in-flight allowance from C0; do not call forwarding counts interface-wire counts.
6. **Lifecycle matrix:** kill/disconnect the owned browser, gateway or control channel; expire/revoke a grant; interrupt cleanup; prove deny-before-restart and record uncertain resources instead of deleting them.
7. **Usability:** separately approved innocuous searches and manual observation of ordinary browser behavior. A challenge is an interruption, not permission for retries, account login or a solver.

Use independent observations with known coverage and positive controls; the broker's own decision log is not independent proof of no bypass. If adequate observation requires privilege or unavailable facilities, stop as inconclusive and request separate authorization. Do not install a firewall rule/helper/CA/VM or run packet capture implicitly.

**Go-for-development:** every mandatory invariant has both a mechanism and passing observations for the exact candidate. **No-go:** a required invariant is contradicted or unenforceable. **Inconclusive/not-run:** insufficient facilities, control failure or missing authorization. Only the first allows the matching A2 implementation slice to proceed; none is W6 release qualification.

## 12. Downstream implementation order

After C3 supports the selected design, complete the remaining A2 mediation/accounting work and reverify it before expanding modes:

| Stage | Scope and exit boundary |
| --- | --- |
| A2 completion | Owner-wide target/control coordination, admission-before-resume, operation-bound accounting/revocation across all supported realms; both provider paths use the same host authority. No permissive fallback. |
| A3 / Q2 | Engine/workspace/installation-scoped remembered search owner, clean separate reader process, durable consent plus active revocation notification/reconciliation. Prove state separation, not just setting persistence. |
| A4–A5 / Q3 | Owner-retained challenge target, private operator IPC, actual bounded visible human control, model exclusion, acknowledged finish/expiry/revocation cleanup and new approval before retry. |
| A6 | Policy/schema/identity migration, skills/disclosures/operator status, exact installed resources and capability reporting. Unsupported target/mode combinations remain unavailable. |
| W6 Q4–Q8 | Safe native containment evidence, exact installed archive capture, authenticated Kiro call/approval/filtering evidence, role-bound validation, then four targets × three modes and independent review. |

Preserve the non-circular freeze sequence: qualify code-bound containment, freeze final package bytes, capture installed/native-client evidence outside the bundle, then validate matching roles. No evidence record is silently transferred to rebuilt/recompressed artifacts. Hosts, installation, authentication, model spend, signing and publication remain separately authorized; this agent must not push or publish remote code/refs.

## 13. Execution checklist and handback format

```text
R0 scope/consumer audit
  ├─ R1 source-installer recovery ─────────────┐
  └─ R2 product/API/browser rebaseline ──────┤
                                            R3 lean verification + CI/command truth
                                             ↓
                                            R4 reviewed repair handback
C0 exact security/byte contract → C1 design decision
  ├─ no-go/inconclusive → stop; keep unavailable
  └─ accepted + R4 → C2 private prototype/offline checks
                       ↓ separately authorized native manifest
                      C3 go/no-go
                       ├─ no-go/inconclusive → stop
                       └─ go → A2 completion → A3 → A4/A5 → A6 → W6
```

Before each effectful verification, audit executable paths, subprocess behavior and cleanup. Use the trusted Node runtime described in `AGENTS.md`; do not alter unrelated permissions. Run dependent builds/staging/checks sequentially. Set one sufficient suite timeout, inspect actual exits and preserve full bounded reports; a still-running message is not success.

Existing commands usable at their stated scope after their effects are audited:

```sh
pnpm run guidance:check
pnpm run typecheck
pnpm run lint:dead
pnpm run build
```

`pnpm run check` currently runs the static/build-only `check:local` and then exits nonzero at the release-grade retirement dispatcher. This proves blocking, not qualification. R3 and section 14 define the remaining verification work. Do not add positive qualification records or remove gates to make it exit zero. Finish every change with a fresh build; report whether narrower behavioral checks, installer acceptance, native feasibility and release qualification actually ran.

Each handback must list: exact files changed/recovered, recovery provenance and missing evidence, ledger IDs covered, executed checks with actual outcomes, intentional unavailable commands/gates, code/browser/policy identity changes, retained artifacts, no-go/inconclusive reasons, and the next authorized action. No percentage-complete estimate substitutes for these gates.

**Next implementation task:** complete N0–N2 below as one bounded offline-verification slice, then N3–N4. C0–C1 desk work (N5) can run independently; C2/C3 cannot skip acceptance and authorization gates.

## 14. Next implementation batches — acceptance before containment

This section supersedes the earlier handback's suggestion that only documentation remained before containment. It is an implementation specification, **not a claim that these batches are implemented**. The current request is planning only. When implementation resumes, the lean checks below are part of the defined repair scope, not a restoration of the deleted full suite. Real installations, native experiments and host changes still need separate authorization.

### Acceptance ledger for this slice

| ID | Deliverable | Passing evidence / stop condition |
| --- | --- | --- |
| N0 | Audited effects and durable consumer inventory | Exact touched-file/source identities; no unsafe helper execution; uncertain cleanup retained |
| N1 | Lean runner plus reference audit | Required case registration, positive and negative controls, correct process exits, missing-case failure |
| N2 | Restored installer contracts | Real parser/frontend exercised with injected effect counters; no install, hooks, build or download |
| N3 | Browser authority regression slice | Real registry/providers/host over fake transport; no browser or network; no authority in guest/public exports |
| N4 | Docs/CI/manifests reconciled | Active commands correct, historical evidence separated, inventory checks pass, release gates remain blocked |
| N5 | C0–C1 contract and architecture decision | Explicit requirement-to-mechanism matrix for four native targets; accepted/no-go/inconclusive, never inferred qualification |
| N6 | Conditional C2/C3 campaign | Only after accepted design and repaired baseline; separate native authorization and independently observed outcomes |

### N0 — effects audit and reproducible scope (first)

**Files:** `scripts/source-install.mjs`, `scripts/source-bundle-stage.mjs`, `scripts/source-pull-hook.mjs`, their existing imported installation helpers, `.github/workflows/ci.yml`, and `scripts/certify-kiro-agent.mjs` if staging/certification is proposed.

1. Save a bounded local report in a **new**, private task-owned directory under `.tmp/`: HEAD/index identities, touched-file hashes, tracked/untracked/deleted status, actual consumer edges and uncertainty. Preserve prior reports. Do not stage, commit or recover other files speculatively.
2. Separate shell entrypoints, literal imports and manual computed-path cases. Record why each former missing caller was recovered or retired; do not equate an AST pass with external API compatibility.
3. Audit the entire reachable effect chain before executing a case. The recovered frontend still has `fs.rmSync(temporary, { recursive: true, force: true })`; the certifier and CI also contain recursive cleanup. Historical origin is not a safety proof.
4. Default verification fixtures to retention. Before any real cleanup, require exact owned root/entry identities, no-follow traversal, bounded inspection, and preservation of `.git` directory/file/link, bare repositories and uninspectable contents. Preserve ambiguous artifacts and report their paths. Do not blindly import a browser cleanup helper into the installer or restore the whole removed fixture library.
5. For source activation, prefer an explicit retained-staging outcome until deletion can be proven safe. Preserve accurate `committed`, `operationCompleted` and `recoveryRequired` reporting on post-activation failure; do not convert successful activation into “nothing changed,” or hide cleanup failure behind success. Any production cleanup change is narrowly reviewed and independently checked.
6. Do not dispatch CI while its task-root cleanup is unaudited. In particular, a root holding a copied/moved checkout or unknown `.tmp/` contents cannot be recursively deleted on the assumption that a CI runner is disposable.

**Exit:** safe effect budget for each planned case; no real source activation, hook write, certifier, browser launch or global modification. N0 review precedes introducing any new execution path.

### N1 — implement one small offline verification entrypoint

**Implemented and verified (N1):** `scripts/verification/runner.mjs`, `scripts/verification/baseline-cases.mjs`, `scripts/verify-project-references.mjs`, `scripts/verify-offline.mjs` and `scripts/verification/installer-cases.mjs` now exist, and both `verify:references` and `verify:offline` are registered. `scripts/verification/browser-cases.mjs` is still missing, so `verify:offline all` fails closed with that explicit problem. Do not recreate a general test framework or the old test tree. Existing `scripts/qualification-unavailable.mjs` remains the release blocker.

**Runner contract:**

- CLI: `node scripts/verify-offline.mjs [baseline|installer|browser|all] [--json]`; default `all`. Fixed selectors only, no arbitrary module path/command argument. Help is non-executing. Unknown/duplicate flags, unknown suite, empty registry, zero cases or omitted required case fail nonzero.
- Use `node:assert/strict`. Fixed case IDs drive both execution and reporting. Run serially; independent agent code inspection may be parallel, fixture effects/builds may not race.
- Every case has an effect budget and explicit deadline; allow generous harness spawn time without widening the production deadline. Reject spawn errors and signals explicitly. No automatic repeated retries around failed assertions.
- JSON reports include schema version, `qualification: false`, suite/case IDs, required/executed counts, statuses, assertion facts/counters, code/fixture identity, elapsed time and retained artifact paths. Keep stdout machine-readable under `--json`; stderr is diagnostic. Zero exit requires every required selected assertion to pass. A skipped/unavailable required case is nonzero, not a pass.
- Create private canonical fixture roots with fresh isolated HOME/KIRO_HOME/TMPDIR and no inherited browser endpoint/authentication variables. Never inspect credentials, run the real Kiro client, initialize a repository unnecessarily, or touch the actual installed home. Retain roots by default.
- Bundle the TypeScript **fixture entry graph** into a fresh private `.tmp/` output using the already-installed esbuild when needed. This resolves production `.js`-specifier/`.ts`-source imports without adding a runtime loader dependency or changing public source imports. Fail if dependencies are unavailable; no downloads. Avoid importing `dist/index.js` as a shortcut to test internals.
- Baseline runner controls must demonstrate one passing assertion, one intentional assertion failure that becomes nonzero, rejection of unknown/empty suites, and propagation of a controlled child exit/signal. These controls cannot satisfy installer/browser cases.

**Reference audit contract:** parse package scripts and literal JS/TS import/export targets; explicitly cover `install.sh`, workflow commands, build entrypoints and manifests. Use TypeScript's existing resolution rules, not a basename-only grep. Classify dynamic/unresolved external/native paths and known blocked qualifications explicitly. Use synthetic fixtures to prove missing targets/registrations cause failure. No import/evaluation of arbitrary scripts during this scan.

**Registration:** add `verify:references` and `verify:offline` only when targets exist. `tsconfig.scripts.json` already covers `scripts/**/*.mjs`; keep JS/JSDoc, not TypeScript syntax in `.mjs`. Register shell-only/dev entrypoints in `knip.json` where necessary. Nothing new enters installed `agent-product.json` entries/assets, guest namespaces or package exports.

**Exit:** runner and reference checks execute real assertions, report omissions as failures, and have bounded retained evidence. These are local-development tests, not qualification.

### N2 — complete R1 behavioral acceptance without installing

**Files:** recovered three source modules plus the N1 installer case file. Use existing seams first. If needed, introduce a narrowly scoped internal frontend factory/dependency object; production `runSourceInstaller` binds real dependencies and the CLI never accepts replacement dependencies or override environment flags. Do not export the factory through `src/index.ts` or the installed operator API.

| Case ID | Exercise | Required observation |
| --- | --- | --- |
| I01 | Import, direct help and `install.sh --help` | Expected output/exit; no installation, subprocess build, hook or shell write; fixture state unchanged |
| I02 | Missing/duplicate `--source`, duplicate hook flag, unknown argument, source + archive/version | Real parser returns usage failure; zero build/manager-activation calls |
| I03 | Noninteractive missing consent, unsupported Node/platform, failed prerequisite | Denial before mutation; existing trust rules remain load-bearing |
| I04 | Valid isolated dry-run | Real frontend/manager preview path; no activation/build/client probe/backup/permission or shell mutation; assert before/after filesystem state, not stdout alone |
| I05 | Valid reusable bundle vs cache miss | Reuse skips build; miss invokes only injected pinned-pnpm/build/package dependencies in the expected order; lease covers final bundle consumption |
| I06 | Source digest or HEAD changes during reuse/build | Activation counter remains zero; artifacts retained and conflict reported |
| I07 | Staging roots overlap, destination exists/changes, input grows/hash changes | Refusal with no write through replacement paths; bounded staging preserves incomplete evidence; use valid synthetic inputs, not real runtime installation. **Executed:** three refusals (non-canonical target, relative target, invalid source) with no output created. **Not executed:** overlap, existing destination and mid-copy drift, which would need a schema-3 synthetic bundle indistinguishable from real admission evidence; recorded in the case's own `coverageGaps` |
| I08 | Hook/shell disabled, rejected foreign hook, post-operation hook/lease/cleanup failure | No real Git-config/hook/shell mutation; injected success/failure counters; committed state remains truthful after a late failure. **Executed:** real `configurePullHook` against retained fixture repositories (non-repository refusal, foreign-hook preservation, 0700 hook creation and idempotence, `hooksPath` refusal) plus injected late-failure truthfulness and preview-failure stop |
| I09 | Guarded staging cleanup | Only a positively identified staging root is removed; wrong prefix, outside `tmpRoot`, identity mismatch, symlink, `.git`/worktree and bare-repository metadata are retained with a reason; repository metadata is never deleted |

Use positive controls for reuse, staging and injected manager handoff so a uniformly denying/broken frontend cannot pass. For `stageSourceBundle`, exercise the actual validator/copy contract using the smallest valid synthetic bundle; do not relax minimum sizes/schema/signatures in production or download binaries to construct it. If realistic fixture requirements exceed the approved resource bound, report that case unavailable and keep R1 acceptance partial rather than using an invalid fixture that fails too early.

Pull-hook path/permission checks should use ordinary directories/files and injected command observations where possible. If a Git fixture is unavoidable, preserve it permanently; no cleanup may delete repository metadata.

**Exit:** I01–I09 pass at their stated scopes with side-effect counts and retained artifacts, and the suite is re-runnable against retained fixtures. Real installation, crash recovery and native bundle acceptance remain unqualified. The internal dependency seam is `runSourceInstaller(args, overrides)`; the CLI and `install.sh` never pass overrides and unknown override keys are rejected.

### N3 — complete the R2 authority regression slice

**Files:** `src/core/action-registry.ts`; `src/providers/browser-provider.ts`, `src/providers/web-provider.ts`; `src/browser/invocation-authority.ts`, `host.ts`, `lifecycle.ts`, `session.ts`, `broker.ts`, `worker-core.ts`; N1 browser cases. Read the existing constructors before adding seams: `BrowserHost` already accepts a `BrowserTransportProvider`, and both providers accept a host.

Use a deterministic **in-memory fake CDP transport**, not a real loopback browser. Exercise real registry/provider/host code. Do not weaken production qualification to reach it: keep test injection internal, preserve a separate check that ordinary production construction remains unavailable without matching evidence, and never create a positive production evidence file.

| Case ID | Required invariant |
| --- | --- |
| B01 | Positive approved fixed operation reaches the fake transport; approval is bound to canonical args; one approved dispatch, not a denial-only test |
| B02 | Missing, copied/forged or structurally similar receipt cannot open a transport or execute an operation |
| B03 | Approval denied, cancelled or still pending produces zero operation effects; non-browser registry calls retain their existing behavior |
| B04 | Replayed receipt, wrong action/recipe/engine or changed canonical args fail before operation effects |
| B05 | Hold one operation to queue another; mutate policy, mode or caller authorization epoch before dequeue; queued operation is denied with no transport effects |
| B06 | Lease expiry/revocation prevents a new broker commit; a terminal fault racing the final result wins over apparent success |
| B07 | Queue cancellation and host close deny queued work, interrupt active work, revoke before settlement and distinguish confirmed vs uncertain cleanup |
| B08 | Late target/context replies remain settlement obligations; no successful drain is reported while owned resources remain unresolved |
| B09 | Exercise both contained WebProvider callbacks and BrowserProvider recipe dispatch; neither can bypass host authority or silently fall back to a standalone/personal browser |
| B10 | Public/guest/config surfaces gain no receipt minting, arbitrary CDP endpoint, raw JS evaluation, trust override or positive qualification record |

Import host-private minting helpers only in internal fixtures where needed for unit-level cases; that is not evidence of real approval ordering. At least B01/B03 and both provider routes must use real `ActionRegistry` approval flow. Mechanically inspect `src/index.ts`, guest bootstrap/types, provider descriptors and installed operator exports in B10.

**Exit:** B01–B10 pass with connection/dispatch/commit/cleanup counters. Label results “in-process authority and lifecycle,” not “owner-wide network containment.” No recreated worker protocol merely to match old plans.

### N4 — close R3/R4: commands, CI, documentation and identity

**Dependencies:** N1–N3 for claims of behavioral completion. Documentation inspection may run earlier.

1. Extend `check:local` to guidance → typecheck → fresh build → reference checks → all approved offline cases → lint. Keep its non-release disclaimer. Do not map `check`, `prepack`, `release:candidate` or Fovea qualification commands to local success.
2. Add a **separate local-development CI job** for these actual checks, or explicitly distinct steps before required blockers. Native installer/bundle/macOS acceptance placeholders remain nonzero until their own coverage is implemented. Keep the four native matrix targets. A new green local job must not replace a required release/native check or alter branch/release protection. Do not use `continue-on-error`, `|| true`, pass-with-no-tests or skip-based success.
3. Test gate propagation without rerunning long builds: execute the actual package-script expression in a private fixture with an inert local-check command returning controlled codes. Local success must reach the retirement dispatcher and return 69; local failure must remain nonzero. Also directly exercise dispatcher IDs, missing/unknown IDs and malformed selections. These are blocker checks, not coverage of retired suites.
4. Reconcile `README.md` development instructions; `docs/audit.md`; `docs/installer.md`, `release.md`, `complete-bundle-release.md`, `linux-validation.md`, `configuration.md`; relevant `docs/fovea/` qualification guidance; browser plans; `docs/browser-isolation-design.md`; and adapted skill references. Inventory current commands against `package.json`, distinguish callable-but-unavailable from missing, and link to the coverage ledger.
5. In `docs/audit.md`, clearly segregate historical/deleted test evidence from current implementation and current executed checks. Preserve the historical facts rather than deleting them or relabeling old passes. Correct outstanding `WorkerCore`/worker-protocol claims in active architecture text; keep explicit future proposals labelled future. Do not claim older A-series work never existed.
6. Do not weaken `AGENTS.md` to permit committing without `check`. Explain in regular development docs that `check` currently blocks release/commit readiness; no commit is requested in this batch. Historical full-suite timing/count claims remain historical.
7. Reuse `parseSkillManifest` and `verifySkillSources` for the nine-skill catalog. Check all 26 component entries, upstream commit/version/license agreement, safe declared paths and fixed-recipe mapping; add missing-file/hash/duplicate/mapping negative controls on copied fixtures. `enabled: true` in instruction metadata is not runtime admission. Never edit vendored bytes/hashes or historical evidence merely to make a check green.
8. Audit actual `agent-product.json`/closure asset lists and runtime-code versus evidence digest handling in `scripts/build-inputs.mjs` and `src/browser/qualification.ts`. A successful source inventory probe does not establish installed-package integrity. Keep new dev runners out of installed runtime assets. Do not bless rebuilt bytes using old positive evidence.
9. Stage and run component-only MCP/package checks only after auditing their cleanup/subprocesses and confirming prerequisites are already local. No downloads, real Kiro home/client/authentication or model spend. If prerequisites/effects are unresolved, report these gates explicitly unavailable; do not call full R3/R4 acceptance complete.

**Exit:** active documentation matches real commands, actual scoped checks are wired locally/CI, exact metadata/registration assertions pass, and missing native/release coverage still blocks. Record component-only results separately from authenticated Kiro evidence. Finish with a fresh build after all edits.

### N5 — C0–C1 design work, allowed alongside offline repair

**Deliverable:** update `docs/browser-isolation-design.md` with a versioned threat/byte contract and a decision table. No gateway implementation, browser launch, CA/helper/VM install or host-network change in this batch.

1. For each adversary (hostile page, compromised renderer, compromised browser/network process, malicious same-user peer), state trust assumptions and which guarantees are required. Separately define network, filesystem, profile and operator-control boundaries.
2. Specify outbound and inbound budget units and commit points. Distinguish request payload bytes, decrypted application bytes, forwarded encrypted tunnel bytes, kernel-received bytes and interface traffic (headers/retransmission). Assign connection/handshake overhead, redirects, concurrent realms, cache/SW, compression, streaming and H2 coalescing/reuse. State in-flight allowances explicitly; do not change the production limit to make an experiment pass.
3. Name who resolves DNS, selects/pins the actual socket peer, blocks all alternate TCP/UDP/DNS/QUIC/WebRTC routes before startup and revokes owner-wide traffic. An opaque CONNECT tunnel cannot enforce encrypted URL path/method/body; CDP is only part of the trusted-browser layer, not an external compromised-browser boundary.
4. Compare (a) TLS-preserving gateway + externally enforced OS containment, (b) TLS-terminating gateway + OS containment, (c) dedicated local VM with controlled egress, and (d) retain CDP-only/no-go. A gateway can cap bytes **forwarded** but cannot guarantee a peer never sends excess inbound network bytes. A VM does not solve that semantic limit either.
5. Evaluate exactly **darwin-arm64, darwin-x64, linux-arm64, linux-x64**. `xhigh` is a reviewer setting, not an architecture. Record minimum systems, executable provenance, documented enforcement primitive, privileges/entitlements, update owner, resources, visible/manual UX and independent observation facilities. Unknown host support stays unknown; no cross-platform inference or emulator result is native proof.
6. Preserve the product goal: bundled library runtime and skills through Fabric's fixed provider boundary, not a new standalone daemon/CLI dependency. Include binary/helper provisioning in the decision rather than hiding it behind a proxy setting. Normal browser behavior/CAPTCHA usability is separate from security; no spoofing, personal-profile import or automated challenge solver.
7. Record an explicit decision per target: **accepted for prototype**, **no-go**, or **inconclusive**, with requirement IDs and evidence gaps. Recommend the least complex candidate satisfying every mandatory requirement; do not preselect a gateway because it is easy to prototype. If mandatory hard-wire/HTTPS guarantees conflict with the threat model/usability constraints, stop and request an explicit product-contract decision.

**Exit:** source-backed feasibility argument and independent review, not qualification. Native proof is still required even after a desk decision says prototype-go.

### N6 — conditional C2/C3 and later work

Only after N0–N4 acceptance at their declared scope and an accepted N5 design: implement the **private, non-admitting** C2 prototype described in section 10. Default import/help/preflight must have zero browser/network effects. Its report is non-qualifying and rejected by production evidence loaders.

Then obtain separate authorization for the exact C3 host/browser/profile, owned fixture endpoints, resource bounds, observation privileges and retained artifacts. Test positive reachability, denied bypasses before startup, actual peers, exact chosen byte units, realm/lifecycle coverage, failure/revocation and cleanup. Insufficient independent observation is inconclusive, never pass. Stop on any mandatory failed invariant.

Only successful exact-target feasibility permits the corresponding A2 completion. A3 remembered mode, A4/A5 manual handoff, A6 identity migration and W6 qualification remain downstream, not tasks to overlap speculatively. No publishing, committing, authentication, personal-profile access or cluster access is authorized here.

### Work allocation and review checkpoints

- **Owner/Main:** N0 effect audit, installer production seams, merged-file conflict handling, all builds/check execution and final ledger.
- **DeepSeek lane 1 (optional):** implement N1 reference audit/runner in explicitly assigned new files after the contract is frozen; no changes to production gates.
- **DeepSeek lane 2 (optional):** prepare N3 fixture cases using existing fake-transport injection; no production evidence/qualification changes. N2 installer case work can be a separate bounded lane.
- **Documentation/design lane:** inventory N4 drift and draft N5 desk analysis read-only or in an explicitly assigned document. No overlap writes to `package.json`, CI, manifests or the central ledger.
- **Astra xhigh reviewer:** independent checkpoint after N1–N3 and again at the N5 decision. Require file/case evidence, false-positive controls, cleanup/authority risks, public-surface review, and accurate status claims. A model review is advisory; run the checks it recommends and retain results.
- No parallel full builds, staging or fixture suites. No worktree deletion, broad cleanup or restoration of unrelated deleted tests. Preserve each agent's scoped result; Main verifies claims before marking ledger items passed.

### Verification and handback sequence

1. Before edits: save the scoped manifest and audit the execution/cleanup paths. Ensure owned build outputs contain no repository metadata or unknown user data before invoking build cleanup.
2. Check only changed behavior first: N1 runner/reference negative controls → N2 installer cases → N3 authority cases → N4 wiring/metadata/gate checks. Include real process exit, signal and side-effect counters; never hide status with a trailing `echo` or a truncating pipeline.
3. Then run guidance, full script/source typecheck, lint and the updated local sequence, serially where build artifacts are shared. Use `pi.bash(..., settle=True)` and inspect `ok`, `exitCode`, and output. A still-running notice is not a pass. Keep full reports in unique task-owned retained roots and return compact evidence.
4. Run independently scoped component-only checks only after their effects are cleared. Native/browser/installed-client/release gates stay not-run or unavailable unless separately executed under their own authorization.
5. Review the coherent patch, address findings, validate active docs/links and package/guest registrations, then finish with `pnpm run build`. Do not run commits or publishing commands.
6. Hand back each N-ID as passed/failed/partial/not-run with case IDs, exact code identities, retained artifacts, intentional exit-69 blockers and the next authorized step. Do not call R1/R2/R3 complete solely because import/help, placeholders, typecheck or build passed.

## 15. Repair slice S1 evidence — prior N0-N2 runs and subsequent corrections

The following table records earlier local runs, not a fresh rerun or proof of complete N0-N2 acceptance. N3 planning subsequently reproduced three runner false-greens and found incomplete I07 coverage plus inaccurate HEAD/effects claims. See the [prerequisite findings and acceptance ledger](browser-n3-n4-implementation-plan.md#2-findings-that-change-the-implementation-order). This is not qualification and not native/browser acceptance.

### New and changed files

| File | Role |
| --- | --- |
| `scripts/verification/runner.mjs` | Serial suite runner: fixed case IDs, bounded spawn helper with explicit spawn-error/signal/timeout reporting, retained fixture and report roots, required-case completeness, `qualification: false` reports |
| `scripts/verification/baseline-cases.mjs` | BASE-01..BASE-08 non-vacuity controls for the runner itself |
| `scripts/verification/installer-cases.mjs` | I01-I09 installer behavioral acceptance with injected effects |
| `scripts/verification/n0-audit.mjs` | Reproducible N0 effects/consumer report under `.tmp/verification-n0/` |
| `scripts/verify-offline.mjs` | `verify:offline` CLI: `baseline\|installer\|browser\|all`, `--json`, fixed selectors only |
| `scripts/verify-project-references.mjs` | `verify:references` read-only audit (package scripts, workflows, `install.sh`, knip entries, AST-resolved imports, qualification IDs) plus its own clean/broken synthetic controls |
| `scripts/source-staging-cleanup.mjs` | Production guarded staging removal (`STAGING_PREFIX`, `identifyStagingRoot`, `removeSourceActivationStaging`) |
| `scripts/source-install.mjs` | Internal validated dependency seam `runSourceInstaller(args, overrides)`; guarded staging cleanup replaces the blind recursive delete |
| `package.json`, `knip.json` | `verify:references` and `verify:offline` registered; dev entrypoints registered for dead-code lint |

### Verification actually executed

| Check | Command | Result |
| --- | --- | --- |
| Baseline controls | `node scripts/verify-offline.mjs baseline` | exit 0, BASE-01..BASE-08 passed |
| Installer acceptance | `node scripts/verify-offline.mjs installer` | exit 0, I01-I09 passed, repeated twice from retained fixtures |
| Reference audit | `node scripts/verify-project-references.mjs` | exit 0 — 41 scripts, 40 script file targets, 22 workflow file targets, 1331 literal specifiers resolved, 8 qualification IDs registered, 0 findings |
| Reference self-test | `node scripts/verify-project-references.mjs --self-test=missing-target` | exit 0, clean fixture stayed clean and every expected finding kind was detected |
| N0 audit | `node scripts/verification/n0-audit.mjs --json` | exit 0 — 3 targets, 11 imported helpers, 182 effect sites, 12 consumers, 5 documented uncertainties |
| Types | `pnpm run typecheck` | clean |
| Dead code | `pnpm run lint:dead` | clean |
| Build | `pnpm run build` | closure rebuilt (100 files, 163 source modules) |
| Aggregate honesty | `node scripts/verify-offline.mjs all` | exit 1 with `suite browser registered zero cases: scripts/verification/browser-cases.mjs is missing` |

### Scope actually covered

- Installer: help (module and `install.sh --source --help`), six usage refusals, consent/prerequisite denials, isolated dry-run, bundle reuse versus cache miss ordering, source drift, failed build, three staging refusals, hook preflight/foreign-hook preservation/hook idempotence/`hooksPath` refusal, late-activation-failure truthfulness, and guarded cleanup retention.
- Build/activation effects were injected and no live installation/activation, live hook/shell change, download or client probe is established by these cases. Correction: I08 does initialize retained fixture repositories, write/remove fixture hook files, invoke the real hook writer and change fixture Git configuration. I09 performs scoped cleanup of task-owned non-repository staging. The earlier blanket “no hook write” claim was inaccurate.

### Remaining gaps (must not be read as passing)

- I07 does not exercise overlapping roots, an existing destination or mid-copy digest drift; its returned `coverageGaps` falsely produced PASS at S1 and now produce PARTIAL/nonzero after the first P repair. The earlier claim that these checks necessarily require schema-3 browser evidence was incorrect: the shared bundle validator accepts schemas 1/2/3 and only applies browser evidence validation to schema 3. Investigate a valid non-browser fixture; until required behavior is covered, I07 is partial and aggregate completion must stay blocked.
- Scoped cleanup repairs now cover local helper roots, generated outputs, private/authenticated workflow teardown and explicit repository rejection at cache capture/GC's pre-removal boundary (detailed plan sections 13–14). Real local pinned-cache rematerialization, Agent staging/reuse, schema-3 bundle staging/reuse and component-only MCP certification were exercised without downloads, authentication, installed Kiro or a browser. No GC apply ran. Auth/private state is retained and blocks qualifying output/release uploads until a verified private-state disposition contract exists. These local checks do not establish native qualification or a hostile-filesystem sandbox.
- `verify:offline all` deliberately fails while the browser suite is missing. Honest `check:local` wiring additionally requires the runner-integrity fixes and completed inherited installer coverage, not merely adding a browser module.
- N3 production lifecycle/routing repairs now exist with memory-only diagnostics (detailed plan section 12); the B01–B10 suite remains absent under the no-tests instruction. N4 aggregate wiring, N5 (C0-C1 decision) and N6 (conditional native work) remain incomplete/blocked.
- At S1 handback, docs drift was inventoried read-only at `.tmp/verification-n4/docs-drift.md` (588 rows: 163 registered, 406 historical, 10 retired-placeholder, 9 unregistered), without active-doc corrections. The local retention slice now corrects README development commands and marks removed Vitest/timing results historical. The broader N4 docs set remains incomplete.
- Correction: direct read-only `git cat-file -e HEAD:<path>` succeeds for all three recovered modules. N0's former `git()` helper called `.trimEnd()` on ignored/null stdout and caught that error as false. The first P repair fixes this and distinguishes unknown/error from absence; a fresh N0 report confirms all three targets are in HEAD. HEAD membership does not establish whether earlier unstaged bytes were recovered.
- At planning time, a failed case with empty `requiredIds`, a 30 ms async case declaring a 1 ms deadline, and a required case returning nonempty `coverageGaps` each returned `ok: true`. The first P repair adds independent ID contracts, bounded process supervision/discovery and partial-coverage failure. Current unchanged cases: baseline 8/8 passed; installer 8 passed plus I07 partial, exit 1. `all` still exits 1 for the missing browser suite. Typecheck, dead-code lint and reference audit pass. Evidence and remaining scope: [section 11 of the detailed plan](browser-n3-n4-implementation-plan.md#11-first-p-repair-implemented--no-tests-written).
