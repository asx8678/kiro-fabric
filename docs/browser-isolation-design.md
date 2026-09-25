# Browser isolation evidence design

> **Historical / superseded by Browser Harness removal.** Browser implementation, CLI/provider entry points, bundled skills and execution qualification described below are no longer shipped. This document is retained for provenance (including unrelated verifier/cleanup repair history), not as current setup instructions, available functionality or verification evidence. See [current removal and verification notes](browser-removal.md). Historical paths may no longer exist.


Status: **schema-3 ephemeral evidence is historical and code-bound; changed runtime code requires fresh qualification. Q0/Q1 admission and A0/A1 lifecycle prerequisites are implemented. A2 invocation authority and attached-page fail-closed accounting are partially implemented/offline-tested, but source review establishes a no-go for the current CDP-only backend as a full preventive wire-byte/actual-peer boundary. Remembered/manual modes remain blocked.** This document is the containment decision record; historical evidence is not transferable to changed code or stronger modes.

The C0 requirement table and the C1 four-candidate architecture decision (including the continuing CDP-only no-go) are in [browser-containment-contract.md](browser-containment-contract.md).

## Requirement

The browser may send the exact approved public operation and the bounded secondary resources needed to render it. It must not have a bypass that reaches arbitrary network destinations or reads private local state. Skill instructions and environment filtering are not controls.

## Candidate architecture

The ideal candidate is a dedicated Kiro-owned Chromium/Chrome runtime whose entire process tree has externally enforced network/file containment. Fabric opens it through a pinned local transport and uses the Browser Harness SDK only as a typed CDP implementation. A managed broker performs the small set of allowed outbound requests according to the approved operation and result policy.

Candidate A is local per-user containment. It is lower overhead but platform-specific. On Linux, package/platform differences may prevent user/network namespace use. On macOS, there is no generally supported unprivileged route that safely forces a GUI Chrome process and all helpers through a typed broker. A merely privileged helper process is not sufficient containment.

Candidate B is a dedicated lightweight VM or other OS container. It can provide a clearer process/network boundary, but it depends on provisioning, platform support and updates that are outside the current bundle. It also changes what Google sees: if page network requests are intercepted and reissued from a host/API client, the network stack may no longer look like the browser. This directly affects the CAPTCHA problem and must be qualified with innocuous searches.

## Decision (P0, slice 5)

Selected for the current application-layer slice: **CDP-native interception in a Fabric-owned browser profile** (`backend = cdp-fetch-broker`), implemented by `src/browser/broker.ts` (Fetch-domain pause/authorize/continue-or-fail), `src/browser/outbound-policy.ts` (per-request policy + budgets), `src/browser/launcher.ts` (verified executable, owned 0700 profile dir, pinned loopback ephemeral debugging port, hardened flags: no sync, no keychain, QUIC disabled, WebRTC non-proxied UDP disabled) and `src/browser/local-transport.ts` (loopback-only WebSocket transport; the only transport in the tree).

Why over VM/OS-containment for v1: it preserves Chrome's real TLS/network fingerprint (the anti-CAPTCHA constraint), it is implementable and testable by this team today on all four targets, and it requires no host-level provisioning. Requests physically originate from Chrome's network stack; interception decides *whether* they may proceed — authority is host-side, bytes are browser-side.

Residual risks accepted and documented (must appear in user-facing docs):
- Containment is application-layer. A compromised renderer, a Chrome zero-day in IPC handling, or channels invisible to the Fetch domain are outside the enforced boundary; launch flags shrink but do not prove absence of those channels.
- No OS-level filesystem second line: the profile-dir model assumes an honest kernel and Chrome build. Filesystem evidence tests (fixture files outside the profile) are required per target regardless.
- `Fetch` interception coverage must be validated per Chrome version in qualification; a version that changes interception semantics without detection is a silent boundary failure — therefore qualification pins browser build identity.

Status remains **unqualified** for a target/mode until a current evidence record exists under `docs/browser-evidence/` and exact-code admission succeeds. Until then that production mode fails closed. The record is evidence, never execution authority.

## A0/A1 offline feasibility result

The first Q2/Q3 slice established contracts and lifecycle prerequisites without launching a browser:

- host-derived search/news/reader intents enter one queue; no operation authority exists before admission, and the immutable lease is revoked before cleanup or host close;
- one monotonic deadline covers queueing, connection, operation and settlement; shutdown rejects queued work, interrupts active sessions and waits for settlement;
- browser launches are generation-fenced transactions. Production children are task-owned detached process groups; a cancelled waiter does not cancel a shared launch, while owner shutdown does;
- remembered locks bind exact owner/browser process incarnations and a random capability. Legacy/ambiguous locks are preserved for recovery, browser descendants block release, and replaced controls are never unlinked;
- stale DevTools endpoint files are removed only after private regular-file verification, and late CDP context/target replies remain cleanup obligations;
- disposable profile deletion follows confirmed process exit and exact bounded ancestry checks. Remembered profile data is never removed by ordinary stop/revoke.

This is offline lifecycle evidence, not browser-wide containment evidence. The stop/go gate is still **no-go for remembered/manual admission** because the current broker attaches to one page session and does not prove deny-before-start coverage for restored targets, OOPIFs, workers/service workers, popups or idle background traffic. Request descriptors and redirect charging are now hardened for that attached page, but connected-address/DNS binding and preventive opaque/streaming/wire-byte enforcement remain unresolved. Therefore the effective policy keeps `operation-disposable-v1`, `ephemeral-context-v1`, `attached-page-v1`, `fetch-finished-v1` and manual control unavailable. An owner-wide target coordinator remains unimplemented and, by itself, would not repair the wire/peer enforcement gaps below.

Native process-tree proof is required independently on darwin-arm64, darwin-x64, linux-arm64 and linux-x64. The implementation uses platform process-incarnation sampling and task-owned groups on Darwin/Linux; unit tests only prove transition/error behavior. The fixed-operation Q4 probe must record startup/idle/restoration/realm/revocation/exit traffic and fail/inconclusive outcomes without a production admission bypass.

## Current A2/A0 decision: CDP-only full contract is a no-go

The current source establishes mandatory enforcement gaps without needing a live experiment:

- `Fetch.requestPaused` can validate and charge the complete bounded CDP-visible request URL/method/header map/body before `Fetch.continueRequest`, but that map is not the browser's complete TLS/on-wire byte stream.
- `Network.loadingFinished.encodedDataLength` is a terminal, post-transfer observation. It can reject a result and block subsequent commits, but it cannot prevent the transfer that exceeded a hard response ceiling. Historical opaque-response observations also show that zero/missing terminal values cannot safely mean zero bytes for every cache, service-worker, opaque, compressed or streaming path.
- `authorizeOutboundUrl` rejects syntactically private/literal destinations, but CDP supplies no pre-commit proof binding the approved hostname to Chrome's actual connected IP across DNS changes and connection reuse.
- The shipped broker is attached-page mediation, not deny-before-start owner-wide coverage for restored/background targets, OOPIFs, popups and worker/service-worker realms.

The authority and accounting work remains useful defense in depth: exact canonical approval now yields an opaque one-shot receipt; host dequeue rechecks policy/mode/scope; providers and worker dispatch fail without authority; complete paused-request metadata, redirects and terminal faults are handled fail-closed for the attached page. These changes do **not** change capability labels or qualify P2/P7.

Decision: do not promote the CDP-only candidate to remembered/manual owner-wide containment, do not create production settings/evidence from offline tests, and do not spend a native run trying to prove mechanisms the source does not possess. A separately reviewed architecture must add externally enforceable egress/actual-peer and preventive byte controls (or explicitly revise the product security requirement) before a new exact-candidate native campaign. The earlier live findings below remain historical observations of the older attached-page candidate, not qualification of this changed code or the stronger contract.

## Live-evidence findings (darwin-arm64 run, 2026-09)

The driver (`scripts/browser-evidence-driver.mjs`) produced findings that changed the implementation — this is the record of why the code is shaped as it is:

1. **WebSocket/WebTransport handshakes are invisible to Fetch-domain interception** (and `Network.setBlockedURLs` does not stop them either): a page could open `ws://` directly to loopback — the TCP sink observed the connection. Mitigation shipped in `RequestBroker.attach`: a reviewed containment script (`fabric-containment-v1`) is injected with `Page.addScriptToEvaluateOnNewDocument` into every frame before any page script runs, neutralizing `WebSocket`, `WebTransport`, and the worker realms (`Worker`, `SharedWorker`, `navigator.serviceWorker`) that would otherwise carry their own unstubbed sockets. Verified live: the API throws before any handshake, the TCP canary observes zero connections.
2. **Response-byte budgets were not enforced against subsequent requests**: overruns were only recorded after the fact. `OutboundGate` now denies every later request once recorded response bytes exceed the cap (unit-tested; verified live with an 8 KiB cap and a fetch loop).
3. **Opaque (`no-cors`) responses report `encodedDataLength` 0** on this build, so subresource accounting undercounts cross-origin opaque traffic. Same-origin/default-mode and document responses report real encoded lengths. Accounting remains a proxy (encoded vs. decoded), documented as such; evidence probes use same-origin fetches.
4. **Client-side refusal layers below interception are containment, not gaps**: `http://` fetch/XHR from an https page is blocked as mixed content (loopback `http://` is auto-upgraded to `https://` and then denied by the gate), and credentialed URLs are refused by the browser before any request. Both are recorded in the evidence record with the layer named; nothing reaches the wire.
5. **Browser binary trust rules refined**: real-world Chrome ships hardlinked binaries (`nlink` 2) and this machine's install is group-writable (0775). `validateBrowserExecutable` keeps absolute-path/no-symlink/regular-file/ownership/executable checks but no longer rejects hardlinks or group-writable modes; identity binds to the recorded `sha256` (a swapped binary fails the hash check at admission) and the record stores mode/nlink.
6. WebRTC with `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`: an in-page `RTCPeerConnection` with a loopback ICE candidate produced zero UDP datagrams at the canary.
7. Mid-operation `SIGKILL` produces a single honest failure: the operation fails once, post-crash calls reject without reconnect, and settlement reports `BROWSER_CLEANUP_UNCERTAIN` rather than pretending teardown was confirmed.

## Evidence record contract

A backend can become enabled only with a checked-in target-specific record containing:

- platform, architecture and backend identity; browser/binary hash and profile ownership;
- proof the browser has no default route except the typed controlled channel before startup;
- packet/request evidence for denied direct TCP, UDP, DNS, WebSocket/WebRTC and private/loopback/metadata destinations;
- redirect, method/body/header/path and request/response byte budget tests;
- private file/workspace and ordinary browser profile read tests;
- ordinary benign public page render tests;
- startup, crash, cancellation and shutdown tests proving grants and tasks settle;
- a visible manual challenge test in remembered mode;
- a signed-looking deterministic record of the *implementation* plus whether provider-specific search still works. "Implementation works" does not imply Google usability.

The record is additional evidence, not execution authority. Bind its exact bytes to bundle/profile admission; do not let a guest write or redact it.

## Manual follow-up procedure

A human operator may run a disposable offline experiment and record its result. Existing unit tests and the default development environment must not perform this:

1. prepare a temporary owned browser profile and network sink outside every repository;
2. start the candidate containment backend before launching Chromium;
3. run the deny/allow matrix using synthetic pages and packet/broker logs;
4. stop the entire process tree and confirm no orphan remains;
5. store only redacted results and target/platform evidence; delete no repository or user profile.

Until that evidence exists for a target, `browser.status()` and any provider description must report `BROWSER_ISOLATION_UNAVAILABLE`. The runtime must fail closed rather than silently use the personal browser/path or an unqualified fallback.
