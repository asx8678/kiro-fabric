# Browser containment contract and architecture decision (C0/C1)

> **Historical / superseded by Browser Harness removal.** Browser implementation, CLI/provider entry points, bundled skills and execution qualification described below are no longer shipped. This document is retained for provenance (including unrelated verifier/cleanup repair history), not as current setup instructions, available functionality or verification evidence. See [current removal and verification notes](browser-removal.md). Historical paths may no longer exist.


Status: **design-only containment decision deliverable. No host security, network, firewall, CA, helper or VM change is made or authorized here. No candidate is qualified; `qualification: false`. This document specifies requirements (C0) and compares architectures (C1); it does not implement, prototype or admit any backend, and it grants no production capability.**

This document is the C0/C1 output of the [cleanup repair and browser containment plan](browser-repair-containment-plan.md), sections 8, 9 and N5. It is a sibling of the [browser isolation decision record](browser-isolation-design.md) and does not rewrite it. Native feasibility requires a separately authorized experiment (C3); a desk decision here is never qualification.

## 1. Purpose and scope

The product requirement is that the browser may send the exact approved public operation and the bounded secondary resources needed to render it, and must not have a bypass that reaches arbitrary network destinations or reads private local state. Skill instructions and environment filtering are not controls.

C0 below defines what would have to be true, in measurable terms, for any backend to claim that requirement. C1 compares four deployable architecture families against those requirements on the four native targets. Section 4 records the explicit decision and the conditions that would change it.

### 1.1 Adversary model and trust assumptions

| Actor | Treatment | Required guarantee if in scope |
| --- | --- | --- |
| Hostile page content (untrusted HTML/JS) | In scope | No destination, byte or local-state bypass through page APIs, realms or network features |
| Compromised renderer (Chrome sandbox escape inside the renderer) | In scope for egress and local reads | Containment must not depend on cooperating page-level code |
| Compromised browser/network process | In scope only where an external boundary is claimed | Egress is enforced outside the browser process; a CDP check inside a trusted browser is insufficient |
| Hostile local same-user process | In scope for control-file and ownership integrity | Owner/generation binding and revocation must not be spoofable by a same-user peer |
| Trusted host broker / Fabric host | Trusted | Host-side authority, budgets and revocation are binding |
| Trusted OS kernel + trusted Chrome build | Trusted | The boundary is only as strong as the kernel and the pinned browser build |

A check performed by the browser on itself (the current CDP backend) is a **trusted-browser-layer** control. It is a different guarantee from an **external boundary** against a compromised browser. No requirement in this document may be satisfied by conflating the two.

## 2. C0 — requirement-to-enforcement contract

Each requirement names the enforcement component that would have to resolve it, the measurement unit, the allocation scope, the decision/commit point, the revocation boundary, the unavoidable in-flight allowance, and an independent observation method that does not rely on the enforcing component's own log.

**Byte units used below (must never be silently relabeled):**

- **P** — plaintext application payload bytes visible to an HTTP-level component (decrypted body/metadata).
- **F** — encrypted tunnel bytes forwarded by a gateway.
- **K** — bytes received into kernel/gateway buffers.
- **I** — actual interface bytes, including headers and retransmission.
- Outbound and inbound are tracked separately. A "hard wire cap" is an **I** cap and must not be redefined as a **P** or "returned to model" cap.

| ID | Requirement | Enforcement component (required) | Measurement unit | Allocation scope | Decision / commit point | Revocation boundary | Unavoidable in-flight allowance | Independent observation method |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C0-1 Destination | Resolve DNS, reject all forbidden IPv4/IPv6/mapped/private/reserved addresses, pin the selected address to the actual socket, and prevent direct browser DNS/TCP/UDP alternatives | External egress gateway owning DNS + connect, plus OS confinement of the browser process tree | Hostname + resolved address compiled to the actual connected peer (peer IP/port) | Per connection/peer, per operation, owner generation | Before the browser has a default route; accept only after the selected peer is pinned | Close connection and latch fault on peer change, DNS rebinding, address reuse or generation change | One connection's already-transmitted bytes before teardown (bounded by OS/connection state, not a semantic guarantee) | Gateway-external packet/connection recorder plus owned TCP/DNS canaries with known coverage |
| C0-2 HTTPS semantics | Enforce scheme/origin/path/method/body/cookie/redirect policy | TLS-terminating policy gateway, or composition of an opaque tunnel with a defined trusted-browser CDP layer | HTTP request/response metadata (P) | Per request/redirect, per operation | Before the request is forwarded (opaque tunnel: only destination is committed) | Deny subsequent requests and tear down on policy drift/expiry | A request already committed to the wire; opaquely encrypted semantics are not enforceable | Deterministic policy decision record independently cross-checked by a fake-wire replay and server-side request log |
| C0-3 Byte budgets | Enforce outbound and inbound budgets with distinct units | External gateway for F/K/I; browser-side CDP accounting remains only defense in depth | P / F / K / I, outbound and inbound separately | Per operation, shared across all realms and concurrent connections | Reservation is atomic before forwarding/committing | Latch on breach; no new commits; report in-flight separately from new commits | Kernel-buffered and in-flight bytes below the allocation before the limit takes effect | Interface counter external to the gateway plus an independent broker/accounting ledger reconciled against it |
| C0-4 Preventive limit | Stop bytes beyond allocation before they are sent or accepted | External gateway with backpressure/teardown | I and K | Per connection and per operation | At allocation exhaustion | Immediate teardown of the overflowing connection | Bytes already in kernel buffers or already transmitted by the remote peer cannot be un-sent | Packet capture/counter outside the enforcement path; positive control proving the cap is observable |
| C0-5 Shared traffic | Attribute HTTP/2 multiplexing/coalescing, connection reuse, speculative activity, DNS/TLS overhead, caches/service workers, compression and streaming | External gateway for connection accounting; target coordinator for realm attribution | Per-stream and per-operation shares of P/F/K/I | Operation-wide, with explicit per-realm sub-allocations or refusal | Per stream/request admission; reuse requires re-attribution | Revoke the whole owner on unattributable multiplexed traffic | Concurrent in-flight streams at revocation time | Fake-wire realm ledger plus external per-connection byte counts; mismatch fails closed |
| C0-6 Owner lifetime | Containment precedes browser startup and covers every child/realm, idle/background/restored target, popup, worker/service worker and control-loss state | Deny-before-start OS confinement plus owner-wide target coordinator | Process/realm coverage set (every child PID + realm ID) | Owner generation, whole process tree | Before spawn; resume only after mediation ready | Generation change or control loss revokes all realms and stops new traffic | Traffic during the spawn-to-readiness window must be zero; any observed traffic is a failure, not an allowance | Process-incarnation sampling on all four targets plus external sink proving zero pre-readiness traffic |
| C0-7 Local data | Deny filesystem/IPC/keychain/clipboard/local-file/ambient-descriptor access outside the owned profile; preserve Chrome's sandbox | OS confinement (namespace/jail/VM) plus owned profile with verified ownership/modes | Read/write access decisions per path/descriptor | Owned profile dir (0700) and explicitly allowed fixtures only | Before file open; profile created before launch | Delete/restore only after confirmed process exit and exact bounded ancestry checks | None; a local read is either permitted or it is not | Fixture canary files outside the profile; independent process-tree and file-access probes per target |
| C0-8 Authority | One-shot approved operation scope, owner generation, deadline, budget reservation and synchronous revocation; no standing permission | Host-side authority service, external to the browser and guest | Authority is a scope+generation+deadline+reservation tuple (opaque one-shot receipt) | Per operation; never per idle profile | Dequeue rechecks policy/mode/scope; providers/worker dispatch fail without authority | Synchronous revocation on expiry, policy drift, generation change or disconnect | An operation already executing may complete bounded, observable work before it stops | Fake-wire authority ledger plus a guest export scan proving no authority is reachable from page/guest code |

**Contract note:** a product-wide "hard wire cap" must not be quietly redefined as a maximum returned to the model. If the inbound **I** ceiling in C0-3/C0-4 is impossible on supported hosts, the outcome is **no-go** for that claim, or an explicitly product/security-approved narrower contract with a new policy identity before any implementation.

## 3. C1 — candidate architecture comparison

Four families are compared. "Targets" means darwin-arm64, darwin-x64, linux-arm64 and linux-x64. All host-support statements below are **unverified** unless a source or a cited experiment establishes them; none may be inferred across platforms or from an emulator.

### 3.1 Property vs limits

| Candidate | Useful properties | Unresolved limits / decision gates |
| --- | --- | --- |
| (a) Forward/CONNECT gateway + OS-enforced browser confinement | Gateway selects the actual remote peer (C0-1) and can cap forwarded encrypted stream bytes (C0-3 F); may preserve end-to-end browser TLS/fingerprint | Cannot inspect encrypted HTTP path/method/body (C0-2) unless composed with a trusted-browser CDP layer; multiplexing/grant attribution (C0-5), browser-to-gateway trust and process confinement (C0-6/7) require proof; hard ingress **I** cap (C0-4) remains a separate problem |
| (b) TLS-terminating policy gateway + OS confinement | Can inspect and enforce HTTP-level semantics (C0-2) and application forwarding limits | Alters TLS/network behavior and introduces a distinct trust/secret boundary; can break browser features and CAPTCHA behavior; cannot by itself prevent excess inbound interface bytes (C0-4); requires a local CA / global-certificate handling that is explicitly not authorized here |
| (c) Dedicated local VM / isolated environment with controlled egress | Stronger process/filesystem/routing ownership (C0-6/7); clear boundary (C0-1) | Provisioning, display/manual UX, updates, resources and privileges are new dependencies; per-target support is unverified; a VM alone does not solve encrypted-request policy (C0-2) or exact wire-budget semantics (C0-3/4) |
| (d) Keep current CDP-only backend | No new provisioning; preserves the current browser network stack and real TLS fingerprint | Retains the demonstrated no-go for stronger wire-byte/actual-peer guarantees; cannot enforce C0-1/C0-4 against a compromised browser; cannot unlock A2 owner-wide or remembered/manual modes by relabeling existing checks |

### 3.2 Per-target evaluation (four targets)

Each cell is a desk status: candidate is not qualified by this document. Statuses: **gate** = worth a separately authorized prototype/evaluation if C2 is ever approved; **unknown** = host support unverified, no universal unprivileged claim; **no-go** = cannot satisfy the mandatory contract as analyzed.

| Candidate \ target | darwin-arm64 | darwin-x64 | linux-arm64 | linux-x64 |
| --- | --- | --- | --- | --- |
| (a) CONNECT + OS confinement | unknown (open gate) | unknown (open gate) | unknown (open gate) | unknown (open gate) |
| (b) TLS-terminating + OS confinement | unknown (open gate) | unknown (open gate) | unknown (open gate) | unknown (open gate) |
| (c) Dedicated local VM | unknown (open gate) | unknown (open gate) | unknown (open gate) | unknown (open gate) |
| (d) CDP-only backend | no-go for wire-byte/actual-peer | no-go for wire-byte/actual-peer | no-go for wire-byte/actual-peer | no-go for wire-byte/actual-peer |

## 4. Decision record

**Decision:** the current CDP-only backend remains a **NO-GO** for stronger wire-byte and actual-peer guarantees. It is not promoted to remembered/manual owner-wide containment, and no offline test may create production settings or evidence for it. This restates and extends the decision already recorded in [browser-isolation-design.md](browser-isolation-design.md); it does not relabel existing checks.

### 4.1 What this decision unlocks

- Nothing at the production level. No backend, mode, setting or evidence record is enabled by this document.
- Continued defense-in-depth work on exact canonical approval, opaque one-shot receipts, fail-closed attached-page accounting, redirect/terminal-fault handling, lifecycle and cleanup uncertainty reporting.
- A permitted, separately authorized **C2 private prototype** and, only after that and explicit owner authorization, a **C3 native go/no-go experiment** for one candidate on one named target.
- A source-backed desk argument that future native work should measure actual peers and true **I**/**K** wire units rather than forwarding counts.

### 4.2 What this decision does NOT unlock and must not be relabeled as

- It does not unlock remembered/manual modes, owner-wide denial-before-start coverage, or any claim that the browser cannot reach arbitrary destinations.
- It does not relabel application-layer CDP checks, launch flags, `Fetch` interception, `Network.setBlockedURLs` or injected containment scripts as an external boundary against a compromised browser.
- It does not convert forwarding counts into interface-wire counts, opaque CDP `encodedDataLength` into true bytes, or attached-page coverage into owner-wide coverage.
- It does not transfer historical `schema-3` evidence to changed code, changed flags or a stronger mode.

### 4.3 What would change this decision

1. **A satisfying mechanism.** An architecture that externally enforces C0-1 (actual peer), C0-4 (preventive **I**/K limit) and C0-6 (deny-before-start) while preserving the required browser behavior, demonstrated on the exact target by an independently observed C3 experiment with positive controls.
2. **A revised product contract.** An explicit product/security decision to accept a narrower, honestly named guarantee (for example, "application-layer policy on a trusted browser, no external-browser guarantee"), with a new policy identity and user-facing disclosure.
3. **Enforceable HTTP semantics.** For opaque-TLS candidates, a defined composition with the trusted-browser CDP layer, or a separately authorized TLS-terminating design that resolves the CA/secret-boundary and usability concerns — with the CAPTCHA/usability question assessed separately and without spoofing or challenge solving.
4. **Unambiguous host support.** Documented, target-specific enforcement primitives (no undocumented flags alone) and independent observation facilities on darwin-arm64, darwin-x64, linux-arm64 and linux-x64.

Absent all of these, the blocked state stands. If no candidate satisfies every mandatory requirement, the correct outcome is to keep the capability blocked and present the product tradeoff, not to code around it.

## 5. Honesty and non-claims

- This is **design work only**. No host security, firewall, network, CA, helper or VM change has been made or is authorized by this document.
- No candidate is accepted, prototyped or qualified. `qualification: false`.
- Native process-tree and interface-byte proof is still required on every target; unit tests and desk analysis cannot substitute.
- Normal browser behavior and CAPTCHA incidence are separate from security and are not promised by any candidate.
- Historical evidence remains historical and is not transferable to changed bytes or stronger modes.

## 6. References

- [Browser isolation evidence design](browser-isolation-design.md) — the containment decision record and evidence contract.
- [Cleanup repair and browser containment plan](browser-repair-containment-plan.md) — sections 8 (C0), 9 (C1), 10 (C2), 11 (C3), 12 (downstream) and N5.
- [N3/N4 authority and wiring plan](browser-n3-n4-implementation-plan.md) — in-process authority/lifecycle scope and the no-tests constraint.
- [W6 qualification plan](browser-harness-w6-implementation-plan.md) — downstream release gates.
