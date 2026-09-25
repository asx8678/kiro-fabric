# Browser Harness integration, privacy, and remembered-profile implementation plan

> **Historical / superseded by Browser Harness removal.** Browser implementation, CLI/provider entry points, bundled skills and execution qualification described below are no longer shipped. This document is retained for provenance (including unrelated verifier/cleanup repair history), not as current setup instructions, available functionality or verification evidence. See [current removal and verification notes](browser-removal.md). Historical paths may no longer exist.


For the implementation sequence covering the remaining work, use [Browser Harness follow-up implementation plan](browser-harness-follow-up-plan.md). It supplements the requirements below; its tasks are not completion or qualification claims.

## Current follow-up acceptance checks (supersedes earlier completion claims)

W6 scope audit (2026-09-23): see [the exact-candidate implementation plan](browser-harness-w6-implementation-plan.md). Q0 admission and Q1 identity/release contracts are now implemented and offline-tested. Configure, MCP and the owner share current settings schema 3 with explicit engine, closure, policy, consent, flags, browser and evidence-byte identity; schemas 1/2 remain status-readable but cannot authorize execution. W3 persistence and W4 real human control remain prerequisites. No new live qualification is claimed.

- [x] Packaging repair: explicit schema-2 Fovea fixtures; current standalone fixtures contain real JSON resources; unknown schema and missing schema-3 assets fail for separate reasons. `tests/fovea/packaging.test.ts` now passes (63 tests). The earlier claim that these failures were pre-existing at HEAD was unsupported.
- [x] Multi-target delivery: filename-bound records coexist in a complete bundle; malformed/misnamed records and partial packs fail closed; captured pack/evidence bytes are verified on reuse. Covered by `tests/bundle-schema3.test.ts` (16 tests), including synthetic complete-bundle build/reuse/isolated-home installation; these fixtures are not native-platform evidence.
- [ ] A02 delivery: the complete-bundle regression now proves all nine generation-local skills in installed standard/review profiles, empty minimal resources, and retained old resource lists; component tests cover deferred capabilities. Fixed pre-publication profile discovery in `scripts/managed-installation.mjs` by reading IDs from the verified candidate and emitting final-generation URIs; revalidate that prepared profile against the copied candidate before execution to reject transient source-catalog changes. Remaining: the older standalone user installer (`scripts/install-agent-user.mjs`) still copies only the fabric-exec skill tree; it needs a separately ownership-bound browser-resource migration, not unchecked extra copies.
- [ ] A13 implementation and live evidence: remembered searches currently create disposable contexts in `src/browser/operations.ts`; a persistent owner directory alone does not retain their state. Engine-scoped persistence, restart survival and reader separation remain open.
- [ ] A14/A20 manual challenge and Kiro qualification: lease bookkeeping does not prove an interactive challenge window. Require real owner-bound UI, bounded traffic, expiry/cleanup and native client approval evidence.
- [ ] Installer verification: a real-home source dry-run previews preparation only (returns before candidate construction). Attempted with trusted Node: exit 7, recovery-required due to a directory-identity device mismatch without stable-volume evidence. No recovery/activation attempted; preserve the existing installation evidence. Real darwin-arm64 schema-3 bundle build/admission, dev-package validation, private-tool/Navigator smoke, and real-byte isolated-home install/upgrade/rollback independence now pass separately. These probes use a fake Kiro CLI contract, not authenticated native chat.
- [ ] A21 other targets: only the darwin-arm64 ephemeral evidence record currently exists. Synthetic packaging fixtures are not qualification evidence.
- [x] Inherited schema gates: schema 3 now retains Fovea installer presentation, exact parser-version/engine smoke, and the Darwin generation-bound native loader. `tests/fovea/native-source-loader.test.ts` passes 25 tests, including real compiled code for schemas 2/3 and rejection of 1/4. The real installed-byte smoke/independence pair passes (2 files / 2 tests).
- [x] Release tooling: preparation, native/Fovea probes, private input transport, signing-input validation and promotion require schema-3 browser-capable archives. `browser` is the fifth mandatory gate on all four targets. Browser gate schema 2 requires exactly three roles (`containment`, `installed`, `native-client`); containment is current browser-evidence schema 3 bound to closure/component/browser/policy/consent/scope, while installed/native receipts bind the exact candidate and structural observations. Synthetic fixtures are contract-only; no local source staging is release qualification.
- [x] A22 local repository gate: trusted-Node `pnpm run check` completed on 2026-09-23: 249 files passed, 5 skipped; 3,799 tests passed, 91 skipped. Typecheck, fresh build, dead-code lint, component-only MCP certification and agent SBOM also passed. The certification explicitly reports `authenticatedKiro: NOT TESTED`; exact-candidate native Kiro/browser qualification and other-target live evidence remain open under A20/A21 and release policy.

- [x] W6 Q0/Q1 offline slice: configure-shaped settings reach an idle owner; legacy settings and identity drift refuse without launch; configured engine consent is used; interruption messages create no unusable handoff; current policy blocks remembered/manual qualification; typed release witnesses reject missing, duplicate and correctly rehashed false receipts. Focused typecheck plus 10 suites / 71 tests passed. The prior full `pnpm run check` remains historical until rerun after this slice.

Integration-fixture repairs in this follow-up: cold source-bootstrap fixtures now include the builtin-only evidence validator; guidance/installed-resource assertions include the exact browser pack; MCP projection mocks use current privacy defaults; browser tests use the repository-preserving fixture cleanup helper. The restored native smoke exposed and fixed the schema-2-only native loader check rather than bypassing it.



Status: implementation handoff; partially implemented; not security-certified.

Implementation log (slice 1, P0-design + P1-metadata):
- `docs/browser-isolation-design.md` written; `scripts/browser-isolation-probe.mjs` (offline, defaults to fail-closed `BROWSER_ISOLATION_UNAVAILABLE`) added. No backend selected/qualified yet.
- Component snapshot vendored at `skills/browser-harness/vendored/` (never placed under the src tree, keeping reference-only upstream TypeScript out of `tsconfig` compilation): LICENSE, `session.ts`, `wire.ts`, SDK `package.json`, `extension/manifest.json`, all nine original `SKILL.md`.
- Adapted catalog at `skills/browser-harness/{cdp,findata,gmaps,gnews,gsearch,rsearch,ttdl,xsearch,ytdl}/SKILL.md` + `references/{backend,privacy}.md` + `skill-manifest.json` (sha256-pinned sources).
- `src/browser/`: `component.json/upstream.json`, `component.ts`, `isolation.ts` (fail-closed), `compiler-adapter.ts` (fails `BROWSER_ADAPTER_NOT_IMPLEMENTED`), `skills-model.ts` (manifest parse/verify, cursor pagination).
- `src/providers/browser-provider.ts` + `browser-contract.ts` wired through `src/kiro/runtime.ts` (`browserSkillsRoot` option), `src/kiro/mcp-server.ts` (resource-path resolution for installed + checkout layouts), `src/runtime/guest-bootstrap.ts` (`browser` global), `src/runtime/guest-types.ts`, `src/index.ts`.
- All recipes fail closed in `prepareArguments` BEFORE approval (`BROWSER_ISOLATION_UNAVAILABLE` / per-skill blocked reason). No runtime effect, no CLI/daemon invocation exists yet.
- `scripts/build-agent-dev.mjs` copies only `skills/fabric-exec` until the P7 bundle/schema migration.
- Delta vs this plan: no separate config keys yet (P2 pending); extension manifest kept as provenance with relay identity declared unqualified; gsearch/gnews recipes will adapt logic from the vendored `SKILL.md` docs (upstream has no `gnews.ts`/`gsearch.ts` helper sources; extraction code lives in skill docs and shell scripts).
- Verified: `pnpm run typecheck`, targeted vitest (browser-component, web-provider, agent-profile, review-profile, strict-bootstrap, hermetic-stage, installer-cache — 136 tests), dev package staging + `validate-agent-package`, guest end-to-end probe (status/skills/readSkill/runSkill fail-closed via real `fabric_exec` sandbox), `node scripts/browser-isolation-probe.mjs`, fresh `pnpm run build`.

Implementation log (slice 2, P3 canonical disclosure/outbound policy/restricted-web):
- `src/browser/disclosure.ts`: single canonicalization service (`prepareSearchArguments`, `prepareOpenArguments`, `normalizeHttpUrl`), fixed `SEARCH_DESTINATIONS`/`NEWS_DESTINATION`, `buildSearchReview`/`buildOpenReview` exact-review text, `BROWSER_DISCLOSURE_REVISION`. `WebProvider.prepareArguments` now delegates here with byte-identical error semantics (web suites unchanged and green).
- `src/browser/outbound-policy.ts`: `OutboundDestinationPolicy` (fixed vs public-https), conservative hostname classifier (blocks IP literals, private/CGNAT/benchmark/multicast ranges, single-label and .local/.internal/... names; IPv6 literals blocked in v1), `OutboundGate` with per-operation request/redirect/outbound/response budgets; closed gates reject everything including response accounting. DNS/connected-address pinning remains for the broker slice; test sink needs a host-injected fixture backend rather than a production loopback allowance.
- Config: new `privacy { mode: standard|restricted-web }` and `browser { profileMode, enabledRecipes, budget/queue limits }` sections; strict validation (bad enums, unknown recipes and — per plan — any recipe without an implemented adapter are rejected at normalize/file-load time; `IMPLEMENTED_BROWSER_RECIPES` is currently empty).
- `KiroPowerFabricApprover` takes `options.privacyMode`; in restricted-web, `web.search`/`web.open`/`browser.runSkill` require an exact-payload prompt even under `network:"allow"` (deny still short-circuits); review text gains an explicit restricted disclosure note. `KiroPowerApprover`/elicitation path unchanged.
- Runtime: under restricted-web an enabled legacy `web` block is refused with a migration reason rather than executed; verified in `tools.providers()` output.
- `browser.runSkill` preparation now canonicalizes gsearch/gnews arguments through `disclosure.ts` before the isolation gate; privacy-guard rejection precedes the isolation check; both fail before any approval prompt (probed: 0 approval requests).
- Manifest: gsearch/gnews marked runnable (adapters' argument pipeline exists; dispatch still fails closed at the isolation gate).
- Verified: typecheck; new `tests/browser-disclosure.test.ts` (canonicalization parity with web semantics, gate budgets/closed-state, hostname classifier, restricted forcing incl. allow/deny interplay, config validation); guest-level probe through `dist` in restricted mode (web unavailable with migration reason; runSkill fails at isolation with zero approval prompts; sensitive input rejected earlier than isolation).

Implementation log (slice 3, P4 host/session/operations skeleton):
- `src/browser/transport.ts` (pinned `BrowserWire`/`BrowserTransportProvider` seam; no discovery possible), `src/browser/session.ts` (`ManagedSession`: exactly-once connect, explicit-sessionId routing only, per-call deadlines, ownership recorded per pending call's method, NO auto-reconnect/replay — a dead wire fails pending calls once and subsequent calls reject without sending), `src/browser/operations.ts` (`readPage`: create context → target → attach INSIDE protected scope → enable/lifecycle/navigate/evaluate, fixed extraction template with JSON-injected params, confirmed context disposal, disposal failure surfaced as `SessionCleanupError`), `src/browser/host.ts` (transport-gated admission: `BROWSER_ISOLATION_UNAVAILABLE` without a registered transport; FIFO semaphore, bounded queue → `BROWSER_BUSY`, queue/run cancellation, mandatory settle before slot release), `src/browser/worker-protocol.ts` (versioned bounded frames; readPage op only).
- `BrowserProviderOptions.host`: shared host slot for the MCP owner; default transport-less host keeps `runSkill` failing closed through the real admission path (verified in-guest).
- Review caught two real defects pre-commit: ownership was keyed off response frames (which carry no method — contexts would have leaked), and CDP calls originally had no deadline (a silent browser hang would never settle). Both fixed with regression tests.
- `pnpm run lint:dead` findings resolved (unexported internals, `probe:browser-isolation` npm script).
- Verified: typecheck; knip clean; fresh build; 4 browser suites (32 tests) plus web/approval regressions; dev package PKG_OK revalidation; guest probe: allow-mode runSkill reaches host admission and fails closed; xsearch rejected at guest type-check; bad recipe args rejected at recipe schema; 0 approval requests on all failing paths.

Implementation log (slice 4, P4 remainder — interruption, worker core, search adapters):
- `ManagedSession.interrupt()`: rejects in-flight calls and gates new work while keeping the wire OPEN so `forCleanup` disposal can still confirm teardown; `BrowserHost.run` wires the caller's AbortSignal to `interrupt()`; settle() closes the wire last.
- `WorkerCore` (`src/browser/worker-core.ts`): owns the fixed operation registry (`readPage`, `search`, `news`) with arg-shape validation backstopped by the worker protocol; single-op concurrency (`BROWSER_BUSY` on overlap); cancel → interrupt + `cancelled` reply on settle; shutdown → settle + `bye` + non-zero return code from `handleFrame`; provider delegates its recipe dispatch map to this same registry so in-process and (future) child-process paths cannot diverge.
- Search adapters (`searchCards` in `operations.ts`): fixed extraction templates (`/*fabric-search-extract-v1*/`, `/*fabric-news-extract-v1*/`; anchor+h3 / anchor+div[role=heading] cards, adapted from the vendored docs), host-side post-processing drops engine-owned links by base domain, dedupes by URL, caps scanned cards at 50 and applies the caller limit; result shapes match §8.4 (`{source,query,results}`; news adds sourceName/publishedText).
- `OutboundGate` wired into operations: top-level navigation is authorized before any CDP frame is emitted (verified: vetoed run sends zero frames); per-request subresource accounting remains with the broker (P0/P5).
- Runtime accepts `browserHost` injection (`KiroRuntimeOptions.browserHost`) — used by tests now and by the MCP owner when a P0-qualified transport exists; engine flows from `web.searchEngine`.
- Shared fake CDP peer extracted to `tests/browser-fake-chromium.ts` (marker-aware Runtime.evaluate).
- Verified: typecheck; knip clean; fresh build; 96 tests across 9 files (session lifecycle, host admission, interruption, protocol fuzzing, disclosure, gate, search/news adapters, component metadata, guest-path integration incl. denial-before-dispatch).

Implementation log (slice 5, P0 backend selection + offline-verifiable containment machinery):
- Decision recorded in `docs/browser-isolation-design.md`: `cdp-interception-v1` — Fetch-domain interception over a Fabric-owned profile, chosen over VM/OS sandboxing for v1 (preserves Chrome's real network fingerprint, no provisioning dependency); residual renderer/zero-day/Fetch-coverage risks documented, pinned to browser build identity.
- `src/browser/broker.ts` (`RequestBroker`): attaches Fetch interception per page session; every requestPaused is authorized against `OutboundGate` (method/URL/budget) → `continueRequest` or fail-closed `failRequest`; `Network.loadingFinished` feeds response-byte accounting; detach disables interception before context disposal.
- `src/browser/launcher.ts` (`buildLaunchPlan`): verified executable (regular file, no symlink, single link, root/user-owned, not group/other-writable), owned profile dir created 0700 / unsafe-existing refused (never repaired), ephemeral loopback debugging port via bounds-checked DevToolsActivePort, reviewed hardened flag set (`--disable-sync`, `--disable-quic`, no keychain, WebRTC non-proxied UDP off, loopback-only debugging address).
- `src/browser/local-transport.ts` (`WebSocketTransportProvider`): the only transport in-tree; loopback-only ws:// URLs enforced at construction; abort-before-open; factory injection for tests.
- Operations wire a `RequestBroker` automatically whenever a gate is present, so gated recipes (search/news) get full per-request interception, not just top-level.
- Tests: 3 broker suites (per-request continue/fail incl. POST and off-origin, budget-driven fail-closed mid-interception where top-level nav consumes a slot, response accounting), 7 launcher/transport suites (incl. umask-safe writable-executable rejection, DevToolsActivePort validation, remote/wss refusal, pre-open abort).
- NOT done (exit criteria for P0): live evidence record per target (deny/allow matrix with real Chrome build, sink logging, private-file fixtures, benign public render, crash-cancel-shutdown cleanliness, manual-challenge window feasibility). No production component registers a transport; default remains fail-closed.

Implementation log (slice 6, P5 web facade migration and typed interruptions):
- `searchCards` templates now return `{href, consent, captcha, cards}` page metadata; `classifySearchPage` maps consent walls, `/sorry/` CAPTCHA paths and off-origin redirects to typed `SearchInterruptedError`s before results are trusted; HTTP 429 on the main document maps to a rate-limit category via the broker's Network-domain observation. Extraction fidelity against real engine HTML remains live-qualification work (P8), pinned behind the same evidence gate as containment.
- `WebProvider` gained the contained backend: when the shared host has a transport, `web.search`/`web.open` execute via `searchCards`/`readPage` with a per-call `OutboundGate` (fixed engine origin for search; public-https for open) and identical `WebSearchOutput`/`WebOpenOutput` shapes and `WEB_SEARCH_*` error categories; the legacy external-CLI path is untouched and remains the only option in standard mode without a host.
- One `BrowserHost` instance is now shared by `web` and `browser` providers in `createKiroRuntime` (single admission queue; serialization verified); restricted-web admits `web` only through the contained backend.
- Parity/interruption/shape/concurrency suites: `tests/browser-web-migration.test.ts` (8 tests). Verified full set: typecheck, knip, build, 202 tests across 15 files, dev package PKG_OK.

Implementation log (slice 7, P0a live evidence driver):
- Deliverables: the strict record schema/validation module (now `src/browser/evidence.mjs`, importable from dist, scripts and tests), `scripts/browser-evidence-driver.mjs` (manual live driver: fresh 0700 temp profile, TCP+UDP loopback sink canaries bound before Chrome spawn, real Chrome via the reviewed launcher plan, pinned WebSocket transport, one ManagedSession, per-check fresh browser contexts with `RequestBroker` + check-scoped `OutboundGate`, in-page probe battery with path-keyed deny/allow correlation, production `readPage` render, request/response budget exhaustion, cancellation, SIGKILL crash + orphan sweep, SIGTERM shutdown, second-instance startup re-check), broker decision-log ring buffer (redacted origin+path, no query/headers/cookies), record-aware `browser-isolation-probe`, `tests/browser-evidence.test.ts`.
- One record file per target lives under `docs/browser-evidence/` (named by target); status `qualified-ephemeral` requires every required check to pass, with deferrable items (`manual-challenge-window` P6, `redirect-revalidation-live` needs a controlled https origin, `service-worker-persistence` dies with the disposed context) explicitly recorded. The record is evidence only: runtime transport registration stays fail-closed until the P7 admission wiring and operator approval.
- Live run performed on darwin-arm64 (Chrome 153.0.8010.53): **all 29 required checks pass, 3 deferrable items deferred** — record checked in at `docs/browser-evidence/darwin-arm64.json`, probe reports `qualified-ephemeral` for that target and fails closed for the other three.

Implementation log (slice 8, P6 remembered profiles and CAPTCHA/consent handoff):
- `src/browser/profile-store.ts`: owned layout under `<dataRoot>/browser/` (profiles/ownership+consent, locks/, audit/), 0700/0600 umask-safe modes, integrity-bound consent revisions (installationId, engine, policy version, disclosure hash), exclusive cross-process pid-bound locks with bounded wait and stale takeover, revocation that preserves state (never auto-deletes), bounded cookie-free audit, tamper-evident operator settings. Exported through the public API for the operator CLI.
- `src/browser/handoff.ts`: bounded pending registry (≤8, short-lived opaque ids), exactly-one manual lease per handoff bounded by `maxManualHandoffMs`, cross-process file storage (no daemon), profile-scoped matching with conservative engine-level blocking for unscoped model callers. `WebProvider` records handoffs on typed captcha/consent interruptions in remembered-research mode (instructions in the error, id is never a credential) and refuses all model work for the engine while a lease is active — before any browser effect (live-verified: zero canary traffic).
- Operator CLI through the shipped manager: bounded `browser status|configure|verify <id>` grammar (no arbitrary positionals), `scripts/browser-operator.mjs` operating on the installed generation's dist API, configure requires a qualified evidence record + structural binary validation + explicit mode + `--yes` consent and records settings/consent/profile; verify grants then finishes leases; unknown/expired ids fail closed. Registered in the manager command registry; contract tests extended.
- Evidence re-run: `manual-challenge-window` now PASSES live (interruption → handoff → lease → model refused with zero traffic → finish → release). Honest search qualification recorded: the fresh-profile contained browser receives Google's bot treatment (`/sorry/` captcha on one run, HTTP 429 on another); the typed classification surfaces it without retry or fallback. `SEARCH_DESTINATIONS` gained `challengePrefixes` (Google `/sorry/`) so challenge pages render for the operator window yet classify as typed interruptions first.
- Suites: `tests/browser-profile.test.ts`, `tests/browser-handoff.test.ts`, `tests/browser-operator-cli.test.ts` (16 tests).

Implementation log (slice 9, P7 functional delivery + admission flip):
- The dev package ships the browser pack: `build-agent-dev.mjs` stages `skills/browser-harness`, `docs/browser-evidence`, and a standalone copy of the evidence validator (from `src/browser/evidence.mjs`, staged inside the package's scripts directory); `docs/browser-evidence` is a build-input root (record changes invalidate builds); `validate-agent-package.mjs` enforces the pack's exact shape (manifest, 9 skills, license) and requires every shipped evidence record to validate. Fixture roots without the pack stay valid; the pack without records is rejected.
- `agent-profile.mjs`: the nine browser `skill://` resources derive from each generation's own manifest (deterministic order; minimal stays empty; retained older generations reproduce their original list).
- `src/browser/owner.ts` (`ManagedBrowserOwner`): lazy single-instance spawn on first contained operation, live binary sha256 pin at every launch, remembered-mode consent + exclusive lock held for the owner's lifetime, ephemeral instance dirs under the data root removed on clean shutdown, SIGTERM/SIGKILL shutdown, best-effort orphan kill on process exit. The MCP owner (`mcp-server.ts`) constructs it only when the operator settings, a valid `qualified-ephemeral` record for the current target, and the pinned binary all agree (traced `browser.admission`); every workspace runtime shares its host; shutdown is wired into the server close chain.
- Verified: 26 suites / 307 tests, knip, build, dev package staging + validation.

Implementation log (slice 10, P8 native acceptance down-payment):
- `scripts/run-browser-native-acceptance.mjs`: raw stdio MCP client against the staged dev agent (the same entry the Kiro client launches). Live evidence on darwin-arm64: (1) without settings, `web` is unavailable and nothing dispatches; the approval gate denies any network action whose client lacks elicitation ("This action was not dispatched"); (2) with `browser configure`-equivalent settings + the staged evidence record + the pinned binary, `web` becomes available, the approval form is elicited, and an approved `web.search` spawns Chrome under the MCP owner and returns the typed `WEB_SEARCH_RATE_LIMITED` interruption — the complete admission → approval → spawn → containment → typed-outcome pipeline, live.
- Remaining for full P8: interactive kiro-client qualification (real approval UX and stream-event inspection through `chat --v3`), remembered-state restart survival, live runs on the other three targets, ledger A01–A22 completion, and the full `pnpm run check` release gate.

Implementation log (slice 11, P7 bundle-contract schema 3):
- `src/installation/bundle-contract.mjs`: schema 3 admitted across `compatibilityFor`/`checkCompatibility`/`checkToolPins` (browser-capable bundles inherit the schema-2 parser pin and Linux glibc floor); browser resources (the browser-harness skill tree and the `docs/browser-evidence` directory) are illegal below schema 3; schema-3 manifests require the manifest, license, and the target-matched evidence record; `createBundleManifest` takes an explicit `schema` (never inferred); `validateBundle` validates every shipped record *semantically* (via `src/browser/evidence.mjs`) in addition to byte-binding by inventory hash.
- `scripts/build-complete-bundle.mjs`: complete bundles stage the pack and evidence records when present (fixture roots keep building schema 1/2) and declare schema explicitly.
- `src/browser/component.json` + `upstream.json` now ship inside the closure (`browser/`), join `vendoredComponents` (provenance drift-checked at closure build), and flow into the SPDX SBOM; `agent-product.json` lists all 13 pack resources and `scripts/validate-agent-package.mjs` checks them by three-era product hash.
- `docs/audit.md` registers all 25 new browser-side files; `docs/configuration.md` documents the operator-enablement contract.
- Coverage: `tests/bundle-schema3.test.ts` (round-trip, smuggle rejection, missing-evidence rejection, ast-grep requirement, platform parity) + full regression battery: 30 suites / 435 tests green.
- The run changed production code (findings recorded in the design doc): (1) WebSocket/WebTransport handshakes bypass Fetch interception entirely — `RequestBroker.attach` now injects a reviewed `fabric-containment-v1` script into every frame (before page scripts) neutralizing `WebSocket`, `WebTransport` and the worker realms that would carry their own sockets; the TCP canary confirmed zero direct connections afterwards. (2) Response-byte overruns never denied later requests — `OutboundGate.#authorize` now enforces recorded response bytes on every subsequent request/navigation (unit-tested + live-verified). (3) Opaque `no-cors` responses report `encodedDataLength` 0 (accounting stays a documented proxy); evidence probes use same-origin fetches. (4) Mixed-content and credentialed-URL refusals happen client-side below interception — recorded honestly as containment, nothing reached the wire. (5) Real Chrome binaries are hardlinked and can be group-writable — `validateBrowserExecutable` keeps structural checks (absolute path, no symlink, regular file, ownership, executable) and binds identity to the recorded sha256 instead of link count/mode.
- Runtime transport registration is still fail-closed everywhere: the record is evidence, not authority; the MCP owner may register a transport for a qualified target only after the P7 admission wiring (bundle/profile binding of the record) and explicit operator approval.

This document supersedes the earlier proposal to run upstream CLI/REPL snippets in a compatibility worker. The user's additional privacy requirement changes that design: bundle the SDK and skills, but expose only reviewed operations behind approved, enforced outbound-data controls. Do not implement arbitrary JavaScript execution or fingerprint generation as part of this work.

## 1. Product goal and boundaries

The user wants Browser Harness JS to be part of Kiro Fabric, not a separately installed CLI. Kiro must discover the skills, understand how to invoke them through `fabric_exec`, and request approval for the information sent outside the machine. Public web search must remain useful. A separate, opt-in remembered research profile should reduce repeated new-visitor/consent interruptions without copying the user's personal Chrome profile.

Required first release:

- Bundle the reviewed upstream SDK, provenance, all nine adapted skill entry points, and their necessary reference resources.
- Keep existing `web.search` and `web.open` result shapes. Add a small native `browser.*` discovery/recipe surface.
- Enable reviewed public search and news recipes; clearly distinguish installed skills from executable capabilities.
- Require approval of the exact normalized query/URL and the applicable disclosure policy. No blanket browser-use approval, silent engine fallback, or model-selected bypass.
- Implement an enforced restricted-tools mode, with public browsing as the deliberately mediated network capability. Other uncontrolled execution paths must not defeat it.
- Support strict ephemeral browsing and opt-in remembered research state, with different, honest privacy disclosures.
- Detect CAPTCHA/consent interruptions and offer an operator-controlled manual handoff. Do not claim CAPTCHA-free operation.
- Deliver reproducible packaging, retained-generation compatibility, targeted security tests, and actual installed Kiro evidence.

Not in the first release:

- Raw `browser.exec`, model-supplied JavaScript, arbitrary CDP calls, an HTTP `/eval` endpoint, or an upstream shell-script runner.
- Personal browser auto-discovery, personal profile cloning, cookie/password/history import, Chrome Sync, or authenticated personal-account automation.
- Fingerprint spoofing/generation, fake browsing history, automated CAPTCHA solving, stealth plugins, proxy rotation, or repeated challenge retries.
- Uploads, recording, media downloads, ffmpeg provisioning, and model-visible screenshot attachments. Those need separate effect and output contracts.
- A guarantee about Kiro's model-provider traffic, host operating-system telemetry outside the managed process tree, a malicious same-user administrator, or an already compromised OS.
- Publishing a release or making unrelated machine/network changes. Any provisioning work needs a separate permitted operator decision.
- Git pushes, repository deletion and Kubernetes access are forbidden by the standing owner rules, not merely deferred until approval. This plan and its operator setup flow do not override those prohibitions.

A search necessarily discloses its query and protocol/browser metadata to the destination. Remembered mode additionally discloses permitted site cookies/state. Ephemeral mode is not automatically cookie-free: sites may establish cookies during that single operation. The promise is bounded, approved disclosure and enforced separation from local/private data, not zero Internet traffic or anonymity.

## 2. Baseline to re-check before coding

Repository: `/Users/adam2/projects/kiro-fabric`.

Upstream source: `/Users/adam2/projects/browser-harness-js`.

Reviewed upstream Git revision: `3377f8f495701ce6acf1cc58942ae36b803b0200`.

The SDK's current package reports version `0.13.0`. Use the commit and content hashes as identity; the package version alone is insufficient. Preserve the upstream repository rather than moving/removing it.

The working tree already contains unrelated edits, including shared profile, MCP, packaging, guidance, Fovea, and generated closure files. Before every phase, inspect status and the specific files being changed. Merge with those edits. Never reset, clean, restore, remove worktrees, overwrite unrelated work, or stage/commit automatically.

Confirmed seams and hazards:

| Existing surface | Observed behaviour / required consequence |
| --- | --- |
| `src/providers/web-provider.ts` | Uses an external executable, recognizes some sensitive inputs, limits query length to 500, and returns structured web results. Replace the installed execution boundary, not the public result shape. |
| `src/providers/web-privacy.ts` | Explicitly defense in depth, not semantic DLP. Confidential prose and code fragments can pass. Keep human review and do not advertise complete secret detection. |
| `src/providers/web-snippets.ts` | Creates/disposes a private browser context per call. An existing Chrome profile's cookies do not enter that context. Remembered search requires a deliberate separate path. |
| `src/kiro/power/approver.ts` | Exact web arguments are previewed, but the generic `allow` branch returns before prompting. Restricted-mode approval must not accidentally take that early return. |
| `src/config.ts` | Defaults are read/execute allow, write/network ask; web is disabled. Generic shell authority is not confined by the network approval setting. |
| `src/core/action-registry.ts` | Preparation and canonical validation precede reservation, approval, invocation, and cleanup. Preserve this ordering and the immutable approved snapshot. |
| `src/protocol.ts` | Provider requirements support settlement/workspace binding; reservations can span approval and cleanup. Use those seams rather than independent untracked jobs. |
| `src/runtime/guest-bootstrap.ts`, `src/runtime/guest-types.ts` | Runtime namespaces and checked-TypeScript declarations are explicit. A provider registration alone does not create a usable `browser` global. |
| `src/kiro/runtime.ts`, `src/kiro/mcp-server.ts` | Workspace runtimes are replaceable. A long-lived browser owner must live above them and lend bounded clients, not be disposed with every workspace runtime. |
| `scripts/agent-profile.mjs` | Standard/review resources currently bind the Fabric skill; minimal has no resources. Add generation-aware browser skill entries without changing minimal semantics. |
| `scripts/managed-installation.mjs`, `scripts/launch-profile.mjs` | Profiles are regenerated and compared exactly. Unconditionally adding new resources would invalidate older retained generations. |
| `src/installation/bundle-contract.mjs` | Schemas 1/2 and resource paths are strict. Schema 2 also carries Fovea/parser/native-asset requirements. Browser delivery needs an explicit compatible contract extension. |
| `agent-product.json`, `scripts/validate-agent-package.mjs` | Worker/resource inventories and the skills root are tightly validated. Update product schemas, builders and validators together. |
| `scripts/build-kiro-closure.mjs` | The closure declares runtime assets and vendored components. A standalone executable copied beside it is not sufficient integration. |
| Upstream `skills/browser-harness/vendored/skills/cdp/sdk/session.ts` | No-argument connect discovers browsers/extensions. `_call()` can reconnect through no-argument `connect()`. Pinning only the initial connection is not sufficient. `autoAllow` defaults on and must be disabled/removed in the managed path. |
| Upstream recipe scripts | Some contain self-install fallbacks. A prior synthetic probe of the actual `gnews` script showed attachment occurs before its cleanup `try/finally`. Do not execute these scripts unchanged. |

Refresh line numbers and signatures instead of assuming this plan is a patch against an unchanged checkout. Earlier mock/profile test results are evidence of the baseline only, not certification of the future implementation.

## 3. Acceptance ledger

Keep this ledger updated with test/probe names and current evidence. Leave unchecked until demonstrated.

- [ ] A01: A pinned SDK/skill snapshot, license, file inventory and reviewed adaptations reproduce deterministically without runtime downloads.
- [ ] A02: All nine adapted skills are in standard/review installed resources; minimal remains empty; deferred skills report unavailable honestly.
- [ ] A03: Checked guest types, runtime globals, registry discovery, exports and help all agree on the native API.
- [ ] A04: The installed path works with the external harness absent and never invokes its daemon, setup script, or shell fallback.
- [ ] A05: Query/URL normalization, schema checks and local DLP precede approval and all browser/network effects.
- [ ] A06: Approval binds destination, payload, mode, recipe/component/policy revisions and resource budgets; any change requires a new approval.
- [ ] A07: Denial, missing elicitation, timeout, malformed policy, stale grant and unavailable isolation fail closed; no background request is emitted.
- [ ] A08: Restricted mode blocks alternative unmediated execution/MCP/hook paths, including indirect calls and nested dispatch.
- [ ] A09: Navigation, redirects and page-generated requests pass the outbound mediator; direct TCP/UDP/DNS and other bypasses are contained by the selected backend.
- [ ] A10: Private/local/metadata destinations, rebinding, alternate IP encodings, unauthorized methods/bodies/headers and unapproved destinations are rejected.
- [ ] A11: Fresh contexts cannot inherit personal or remembered-profile state; result-page reads cannot borrow search-profile cookies.
- [ ] A12: Remembered state requires explicit operator consent; no personal profile import, login/Sync, fingerprint spoofing or model access to cookie values exists.
- [ ] A13: Approved research state survives owned browser restart when enabled, remains scoped to its engine/owner, and cannot be concurrently opened by two owners.
- [ ] A14: CAPTCHA/consent returns a typed interruption; manual handoff is bounded and operator-controlled; the model cannot solve it or silently retry.
- [ ] A15: Reconnect stays pinned to the owned endpoint and never retries an uncertain effect or discovers another browser.
- [ ] A16: Cancellation/timeout/shutdown settles workers, listeners, targets and grants; cleanup uncertainty is reported honestly.
- [ ] A17: Documentation reading is bounded, revision-bound and manifest-only; traversal, links, stale cursors and arbitrary filesystem reads fail.
- [ ] A18: No secrets, raw cookies, rejected inputs, private paths or response bodies leak through errors, tracing, diagnostics or support artifacts.
- [ ] A19: Legacy owned generations remain valid; new incomplete/tampered generations fail; upgrade/profile publication remains transactional.
- [ ] A20: Native Kiro actually selects the skills, executes `fabric_exec` and the intended nested actions, and displays actionable approvals/interruption messages.
- [ ] A21: Each advertised platform/backend has its own qualification evidence; unavailable platforms fail closed instead of claiming parity.
- [ ] A22: Relevant tests, package validation, typecheck and a final fresh build pass; failures and unverified gates are reported separately.

## 4. Non-negotiable security invariants

### 4.1 Data separation

Only a typed, reviewed operation specification may enter the browser worker. No arbitrary source string, environment map, filesystem path, profile directory, CDP method, executable, HTTP header map or request body may come from the guest.

The browser/worker cannot read the workspace, user home, Kiro credentials, ordinary browser profiles, SSH/cloud credentials, or arbitrary host files. Give it only its immutable code/runtime necessities and its explicitly owned browser storage. The privileged broker must not expose filesystem/import/process functions to the guest or page.

Site content, search results, URLs, cookies and challenge pages are untrusted data. They cannot authorize another request, extend an allowlist, change an approval, trigger shell code, or become instructions to the host. Disable unreviewed background components and recordings; do not fetch rrweb, extensions or helper binaries at runtime.

Anything passed into page JavaScript may be observable by that page. In particular, a caller-supplied CSS selector is not automatically private merely because it is not in the URL. In restricted mode initially allow only reviewed selectors; reject unsupported custom selectors clearly rather than silently replacing them. Preserve the existing argument shape where possible and document this policy restriction.

### 4.2 Exact approval versus policy-approved secondary traffic

The exact query or top-level URL must be shown before it is sent. Also disclose profile mode, cookie behaviour, destination/recipe, and bounded classes of secondary requests needed to render the page.

Do not claim every subsequent HTTP byte was individually previewed if the operator approved a resource policy. Approval authorizes the exact top-level payload plus a specific, immutable subordinate-request policy. That policy must constrain actual headers, bodies, URLs and origins, not merely the first navigation or a hostname list.

All payload transformations happen before approval. Do not silently redact, change engine, append a private identifier, replace a URL, increase a budget or switch mode afterwards. A new operation needs a new canonical snapshot and approval.

A known-secret filter is not a declassification oracle. Never call an external model/service to classify supposedly private queries. Unknown confidential prose can only be deliberately authorized through review; do not promise that a test suite can prove all human-approved prose is public.

### 4.3 Capability containment

Browser-only filtering cannot establish an agent-wide guarantee while `local.shell`, `probe.run`, arbitrary stdio MCP or other executable hooks can access the network. Introduce an explicit restricted-tools policy and enforce it in trusted admission/dispatch, not only in prompts or descriptors.

Preserve ordinary existing policy values on disk. Restricted mode adds a capability restriction; an existing `execute: allow` or `network: allow` does not override it. Denials remain authoritative. Do not automatically turn restricted mode on for existing installations without explaining the impact on coding commands.

For first release, block unmediated arbitrary execution rather than claiming to contain it with environment filtering. Allow offline read/write capabilities only after reviewing their real subprocess/effect paths. Unknown providers/actions default to unavailable in restricted mode. Any future contained build/package-manager facility is a separate extension of this policy.

## 5. Phase 0: choose and prove the containment backend

This is the critical-path feasibility gate. Do not replace it with a promise to add a proxy later.

Deliver `docs/browser-isolation-design.md` describing the selected backend, supported targets, threat boundary, residual disclosures, provisioning requirements, ownership checks and failure behaviour. Add an offline feasibility probe and its evidence format before enabling a production browser.

Evaluate at least these approaches:

1. A browser with no direct network access, controlled through a private pipe/channel, whose intercepted HTTP requests are issued by a strict broker and fulfilled back into the browser. Unsupported protocols remain blocked by the OS boundary. Prove navigation/rendering still works; do not assume CDP covers every network path.
2. A separately contained browser/process tree whose only network route is an enforcing gateway. A CONNECT-only HTTPS proxy cannot inspect payloads and is insufficient by itself. If TLS termination is needed, scope trust material to the owned environment; never modify the user's global trust store silently, and retain upstream certificate validation.

Select the smallest approach that actually passes the probes on the initial platform. Do not implement both production backends by default. SDK changes for a private pipe transport are legitimate if the selected design needs them.

Reissuing requests through Node or terminating TLS can change the network fingerprint compared with direct Chrome traffic, even when the page sees ordinary Chromium. Explicitly qualify that trade-off with the intended search provider; a mock HTML page cannot establish Google usability. If the required controls make the intended provider unusable, report that product blocker and request a deliberate alternative-provider/design decision, not fingerprint spoofing, repeated retries or weaker controls.

Required feasibility demonstrations:

- Containment is active before the browser or its helpers start; startup, idle, crash and shutdown cannot bypass it.
- No direct IPv4/IPv6 TCP, UDP/QUIC, DNS, WebSocket/WebRTC, service-worker or helper-process bypass reaches an unauthorized destination.
- Browser-internal control IPC is distinguishable from denied page access to loopback/private networks. The guest cannot choose that control endpoint.
- The broker verifies actual request content and resolved destinations, not only an HTTP CONNECT host or a page's final URL.
- An ordinary public search can render under the chosen policy, including necessary scripts/resources, without allowing arbitrary uploads or personal state.
- A visible, manual challenge window can work without temporarily disabling containment or allowing arbitrary navigation.
- The backend cannot read private host files; compromise of a renderer does not expose the workspace/profile of the normal browser.
- Browser executable/runtime identity and policy versions can be checked without accepting a guest-selected binary or command.

Use synthetic offline pages/sinks first. Real search qualification must be operator-approved, use innocuous queries, and record only sanitized evidence. Do not inspect personal profiles to obtain fixtures.

Current product targets are `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`. Start with the operator's actual target, then qualify each advertised target independently. If a VM or additional runtime is necessary, obtain a separate provisioning decision and account for distribution, updates, resource use and signing. Do not assume Docker, privileged firewall access, a browser download, or an installed isolation tool.

If no backend can satisfy the boundary on a target, report `BROWSER_ISOLATION_UNAVAILABLE` and keep runtime actions disabled there. Metadata/docs may still ship. Do not downgrade to the user's browser or pretend that a child process/proxy flag is a sandbox.

## 6. Planned module and ownership layout

New paths are proposals; rename only with corresponding updates to this handoff, API checks and tests.

```text
src/browser/
  component.json                 # immutable integration identity and source/patch hashes
  upstream.json                  # origin, commit, SDK version and provenance
  UPSTREAM-LICENSE.txt
  vendor/                        # selected pinned source/reference snapshot; never .git
  patches/                       # deterministic, reviewed upstream adaptations
  contract.ts                    # typed operation/result/error contracts
  config.ts                      # strict browser policy validation and defaults
  skill-pack.ts                  # manifest-bound documentation/catalog reads
  recipes.ts                     # fixed operation registry, not executable path lookup
  host.ts                        # process/profile owner, leases, reservations, shutdown
  client.ts                      # borrowed, host-issued session/workspace capability
  worker-entry.ts                # trusted fixed-operation worker entrypoint
  worker-protocol.ts             # bounded versioned IPC and operation identity
  session-adapter.ts             # pinned managed transport; no auto-discovery/eval
  profile-store.ts               # owned profile metadata, consent and exclusive locks
  disclosure.ts                  # canonical request and approval review material
  outbound-policy.ts             # per-request policy, limits, destination checks
  broker.ts                      # sole mediated external request authority
  isolation.ts                   # backend interface and verified readiness
  isolation/                     # only the selected, qualified backend(s)
  errors.ts                      # stable, non-sensitive failure mapping

src/providers/browser-provider.ts
skills/browser-harness/<id>/SKILL.md
skills/browser-harness/<id>/references/...
```

Adapt existing surfaces rather than forking the whole execution stack:

- `src/providers/web-provider.ts`, `web-snippets.ts`, `web-privacy.ts`.
- `src/kiro/runtime.ts`, `src/kiro/mcp-server.ts`, `src/kiro/managed-generation.ts`.
- `src/kiro/power/approver.ts`, `src/core/action-registry.ts`, `src/execution-service.ts`, `src/protocol.ts` where required for trusted policy/review/settlement.
- `src/config.ts`, `src/runtime/guest-bootstrap.ts`, `src/runtime/guest-types.ts`, `src/index.ts`.
- `agent-product.json`, `docs/agent-product.schema.json`, build/product schemas and manifests.
- The build, profile, validation, installer and documentation files listed in section 14.

Do not move unrelated Fovea/continuity code or redesign generic provider discovery to implement this feature.

### Ownership model

`BrowserHost` is created by the long-lived Kiro MCP owner after managed-generation/data-root admission. Construction must not launch a browser or contact anything. It lends `BrowserBoundClient` instances to replaceable workspace runtimes.

Bind clients to authenticated host/session ownership, the verified workspace identity where applicable, and an immutable effective policy revision. Never infer a native chat identity from model arguments or a pooled MCP process. Without a qualified native session identity, serialize to one active operator-owned lease and report that limitation.

A workspace/runtime close revokes its client and settles its work; it does not close a browser borrowed by another legitimate client. Host shutdown revokes grants, stops new work and closes only task-owned processes/resources. A remembered profile must never be open concurrently in two owners, processes or generations.

Use provider `requirements.settlement = true` for effectful browser/web execution. Use reservations spanning approval through cleanup and host-owned serialization; do not rely on the local-effect queue, which does not automatically serialize browser calls.

## 7. Vendor the component and define the skill pack

1. Confirm the upstream revision and inspect upstream instructions/license. Preserve both repositories and all existing changes.
2. Inventory the SDK's actual imports, helper dependencies, dynamic assets, generated protocol definitions, runtime effects and tests. Exclude `.git`, `node_modules`, recordings, profiles, caches and machine-local state.
3. Preserve original source provenance. Record every adapted file and content hash; use deterministic patches or a documented generated adaptation process, not undocumented edits to copied code.
4. Prefer the upstream generated CDP bindings and reviewed session logic. Do not rewrite hundreds of methods or register each one as a Fabric action.
5. Remove/disable auto-discovery, extension relay selection, automatic prompt dismissal, implicit reconnect/retry, recording injection and runtime fetching in the managed path. Keep unused raw upstream scripts as provenance/reference only if needed; do not ship them as invocable commands.
6. Compile the selected SDK into the installed closure using private Node; no global install, `npx`, external harness CLI, per-user daemon or runtime setup script.
7. Create a canonical skill-pack manifest with sorted IDs, entry points, logical document paths, byte/hash identities, prerequisites, recipe availability and integration revision. Verify it at build and runtime admission.
8. Validate text encoding, size limits, duplicate/case-folded paths, traversal and links. No arbitrary directory traversal via a skill name or document argument.

Canonical catalog IDs:

| ID | First-release behaviour |
| --- | --- |
| `cdp` | Adapted Fabric browser guide and reference material; no raw CDP runner. |
| `gsearch` | Reviewed public-search adapter using the configured web engine; clearly disclose any adaptation from the upstream Google-only recipe. |
| `gnews` | Reviewed Google News adapter with its own declared origin/resource policy. No silent fallback from another engine to Google News. |
| `findata` | Installed/documented; unavailable until its endpoint/argument/response paths are qualified. |
| `gmaps` | Installed/documented; unavailable initially; addresses and routes need explicit disclosure treatment. |
| `rsearch` | Installed/documented; unavailable initially; logged-out behaviour must be qualified before enabling. |
| `xsearch` | Installed/documented; unavailable in v1 because authenticated-session use is excluded. |
| `ytdl` | Installed/documented; unavailable in v1 because recording/download/dependency contracts are excluded. |
| `ttdl` | Installed/documented; unavailable in v1 for the same reason. |

Use namespaced skill frontmatter names such as `fabric-browser-gnews` to avoid confusion with standalone skills installed elsewhere; retain the canonical short IDs in `browser.skills`. Descriptions must advertise the actual available capability, privacy mode and prerequisites.

Publish Fabric-adapted instructions and resource links. Do not expose original setup/CLI examples as the recommended runtime path. If raw upstream examples are retained as reference, label them non-executable in restricted Fabric and supply the supported alternative. Build-time link checks must ensure every published reference resolves inside the verified pack.

## 8. Configuration and native API contracts

### 8.1 Proposed configuration

Use explicit security configuration rather than overloading guidance modes. The following is a proposed contract, not currently supported configuration:

```json
{
  "privacy": { "mode": "restricted-web" },
  "web": {
    "enabled": true,
    "searchEngine": "google",
    "searchTimeoutMs": 45000,
    "openTimeoutMs": 45000
  },
  "browser": {
    "profileMode": "ephemeral",
    "enabledRecipes": ["gsearch", "gnews"],
    "maxConcurrentOperations": 1,
    "maxQueuedOperations": 4,
    "maxRequestsPerOperation": 128,
    "maxOutboundBytesPerOperation": 524288,
    "maxResponseBytesPerOperation": 10485760,
    "maxRedirects": 3,
    "maxManualHandoffMs": 300000
  }
}
```

Decisions:

- `privacy.mode` is `standard` or `restricted-web`. Existing installations retain their stored configuration and ordinary non-browser behaviour until the operator explicitly opts in. An existing enabled legacy web configuration may need explicit migration before web calls work again; document that compatibility boundary. New managed browsing under this plan requires restricted-web mode; do not route standard mode to an uncontained fallback.
- Keep `web.enabled` as the v1 public-browsing activation gate for both web facades and the two executable recipes. Avoid a second ambiguous browser-enabled flag. Metadata and docs do not require browsing to be enabled.
- `browser.profileMode` is `ephemeral` or `remembered-research`; changing the string is not sufficient consent to create/use persistent state. Require the host-owned consent record described below.
- Security fields reject invalid types, unknown values and malformed explicit configuration rather than falling back to a permissive default. Update file-key allowlists, normalization, types, documentation and tests together.
- The selected isolation backend is verified host configuration, not a guest path/command. Do not add a guest-visible `isolation: false` escape hatch.
- Numeric values above are initial engineering ceilings to qualify, not promises that every Google flow fits them. Use lower per-request/body/header limits within those totals. Defaults may change only with explicit fixture and benign live evidence; do not widen security limits merely to make a failing test pass.
- Preserve existing explicit denials. Restricted mode requires exact outbound approval even if the generic network policy is allow. If elicitation is unavailable, fail rather than quietly running.
- Reject attempts to enable an unimplemented/deferred recipe. A manifest entry is not an execution permission.
- Do not silently use `web.command`. Treat an explicitly customized legacy command as a migration issue. Explain how to select the bundled backend without executing or rewriting that command.

Assess public compatibility exports (`BrowserHarnessExecutable`, resolver/verifier functions and constructor options in `src/index.ts`). Retain clearly deprecated library compatibility only if it is unreachable from the installed restricted path; otherwise make a documented versioned API change. Do not leave an automatic fallback to preserve a legacy signature.

### 8.2 Native operations

Implement these exact logical actions; final type declarations must match descriptors and runtime behaviour:

| Action | Raw arguments | Result / risk |
| --- | --- | --- |
| `browser.status` | Empty object | Bounded cached capability/config/readiness summary; read-only, no browser start, profile scan or network probe. |
| `browser.skills` | Optional cursor and bounded page size | Catalog entries with ID, description, revision, document index, runnable flag and explicit blocked reason; read-only. |
| `browser.readSkill` | `skill`, optional manifest-listed `document`, optional cursor, bounded `maxChars` | `{skill, document, revision, sha256, text, nextCursor?, truncated}`; read-only. |
| `browser.runSkill` | Discriminated union of `{skill:"gsearch", args:{query,limit?}}` and `{skill:"gnews", args:{query,limit?}}` | Structured recipe output, network effect and any applicable durable-state effect. No arbitrary ID-to-file dispatch. |
| `web.search` | Existing query/limit shape | Existing `WebSearchOutput`; same engine, approval, policy and browser service as gsearch. |
| `web.open` | Existing URL/wait/output shape, subject to restricted-selector policy | Existing `WebOpenOutput`; always an ephemeral result-reading context in v1. |

Do not register `browser.exec`, arbitrary navigation headers/body options, `setCookies`, profile paths, debugging ports, generic `evaluate`, or a guest-controlled setup/reset command.

Use discriminated types for runnable recipes, not `args: any`. Return JSON-compatible objects; empty result arrays must remain `[]`, not disappear through upstream CLI stdout conventions. Bound every result field, including news source/time metadata. Distinguish an actual empty result from CAPTCHA, unsupported schema or extraction failure.

Documentation cursors must bind component revision, skill ID, document identity and position; reject stale/mismatched cursors. Slice text on valid character boundaries and fit the nested-result envelope. Do not expose arbitrary file reads or depend on workspace allowlist expansion. Use existing bootstrap/help mechanisms when an unavailable workspace cannot mount the provider; never bypass workspace policy for effectful calls merely to make help readable.

Status should report, without secrets: installed component revision, effective mode, engine/recipe availability, containment qualification, profile consent state, active/queued work counts and sanitized unavailable reasons. It must not expose cookies, personal paths, raw endpoint URLs or a fake session/chat ownership claim.

### 8.3 Mechanical registration checklist

- Add the `BrowserProvider` and borrowed client injection in `src/kiro/runtime.ts`.
- Add the frozen `browser` global in `src/runtime/guest-bootstrap.ts`.
- Add matching checked types in `src/runtime/guest-types.ts` and intended public exports in `src/index.ts`.
- Update product provider/runtime-asset inventories and schemas, without adding model-visible MCP tools beyond the existing Fabric exposure.
- Update the MCP execution description, canonical Fabric API/recipe guidance and help navigation. Regenerate `src/kiro/generated-guidance.ts` through its generator; do not hand-edit generated text.
- Verify direct guest calls and `tools.call`/`fabric.call` discovery paths reach identical policy enforcement.
- Do not require a synthetic "skill was read" receipt as an authorization mechanism. Native skill loading and provider document reads are different paths; neither proves comprehension or grants execution permission.

### 8.4 Examples and failure contract

These are proposed checked-TypeScript guest calls, each intended as a separate `fabric_exec` execution. They are acceptance examples, not permission to issue a live search during offline development:

```ts
return await browser.status();
```

```ts
return await browser.readSkill({skill: "gnews", document: "SKILL.md", maxChars: 4000});
```

```ts
return await web.search({query: "Node.js public release notes", limit: 3});
```

```ts
return await browser.runSkill({skill: "gnews", args: {query: "Chromium public release notes", limit: 3}});
```

Give news a separate explicit output type rather than forcing it into the Google/Bing web source union. Proposed result: `{source:"google-news", query, results:[{title,url,sourceName?,publishedText?,snippet?}]}`. Bound every string and validate every result URL. `publishedText` is source-provided display text, not an invented verified timestamp. Public web results retain their existing types.

Define stable sanitized failure codes for disabled browsing, required privacy mode, unavailable isolation, component mismatch, unsupported legacy command, unavailable recipe, missing profile consent, busy profile, changed policy, denied request, exceeded limit and uncertain cleanup. Suggested prefix: `BROWSER_`; preserve the established `WEB_SEARCH_CAPTCHA` and `WEB_SEARCH_CONSENT` categories at the existing web facade.

Attach the existing Fabric failure metadata using its actual enum/schema contract. Before-dispatch denial has no emission; an interrupted/failed operation after requests were sent must not claim `effectOutcome: none`. Never mark uncertain requests automatically retryable. Human-handoff metadata identifies a bounded interruption, not a completed successful search. Add tests for error projection as well as internal exceptions so the native client sees the right category and no raw private diagnostics.

## 9. Canonical disclosure and outbound enforcement

### 9.1 Preparation and approval transaction

Implement a single canonicalization/disclosure service shared by both web facades and recipe adapters.

1. Validate raw arguments with `additionalProperties: false`; reject caller-supplied review/policy/endpoint/grant fields.
2. Normalize public query/URL once, bound it, apply local sensitive-input checks, and choose the host-configured engine and fixed recipe.
3. Construct a prepared request with exact payload, component/recipe/policy revisions, profile mode, approved state class, destination/resource policy and budgets. Separate raw and prepared schemas; registry validation currently checks the prepared arguments.
4. Build exact review material from that prepared snapshot. Include any page-visible selector/options and remembered-state effects. Never truncate away meaningful outbound text; if the review cannot fit safely, reject and ask for a smaller request.
5. Reserve the relevant profile/operation slot without starting Chrome or transmitting anything. Revalidate policy/consent identity at the reservation boundary.
6. Evaluate all applicable policies. Durable remembered-state use may require write authorization in addition to network authorization. An allow in one category cannot override a deny in another. One combined prompt is acceptable only if it explicitly binds all effects.
7. Obtain the existing host-mediated approval and charge its quotas/deadline. Restricted-mode exact review must not fall through the generic `allow` early return.
8. After approval, verify that the immutable request and current pinned policy/consent still match. Otherwise fail with no dispatch and request a new approval.
9. Mint a host-only one-operation broker grant. Do not serialize credentials, cookie values or reusable network authority into guest-visible arguments/results.
10. Dispatch the typed operation; settle it and its cleanup before releasing the reservation. Revoke the grant on completion, cancellation, owner retirement or policy change.

Do not call `WebProvider.prepareArguments` a second time after approval in a way that changes the request or rejects host-derived fields unpredictably. Give raw preparation and prepared-request validation distinct responsibilities. Review identity must reflect the actual dispatched specification.

Alias delegation must not create an unapproved side channel or duplicate prompts unnecessarily. Call a shared trusted service after the appropriate canonical approval, not a raw shell script or a nested alternate provider with a weaker policy.

### 9.2 Broker requirements

The broker accepts only active host-issued grants and requests attributable to the owned operation/session/target. It must enforce:

- Scheme, destination host, port, path/query rules, method, headers, body size/content class, redirect depth, request count and cumulative outbound bytes.
- Public-network resolution and the actual connected address. Reject loopback, private, link-local, multicast, unspecified, IPv4-mapped IPv6 and cloud-metadata targets as applicable; protect against DNS rebinding and redirect changes. Reject credentialed URLs and non-web schemes. Initial restricted production browsing is HTTPS-only; do not silently upgrade an HTTP URL after approval.
- No page-selected proxy, authentication material, client certificate, arbitrary cookie injection, local-file upload or headers derived from the model/workspace.
- No copied personal cookies. Ephemeral site cookies can be limited to the operation; remembered cookies follow the dedicated profile policy. Bound them and keep values host-side.
- Minimal outbound referrer/header policy. Do not leak a previous result URL, private hostname, local path or whole query to an unrelated origin through Referer or a background request.
- A fixed set of reviewed recipe resources. A returned page/script cannot grow the allowlist. Do not automatically learn or approve unknown domains from traffic observations.
- Blocking of popups, downloads, unsupported schemes/protocols and service-worker/background paths unless explicitly required by a reviewed operation policy.
- No auto retry after an emission may have occurred. Resolve redirects through the mediator; checking `finalUrl` after navigation is not a preventive control.
- Bounded response sizes/decompression and parsing as a separate resource control. Output truncation is not an outbound-data limit.

A GET request or an allowed hostname can still carry exfiltrated data. Test paths, query parameters, headers and bodies, including requests to an otherwise allowed origin. CDP interception/flags are defense in depth; the selected containment backend must stop bypasses the interceptor cannot observe.

Keep normal search/resource policy separate from the bounded manual-challenge policy. POST is denied for ordinary v1 public operations unless a narrowly reviewed operation explicitly requires it; challenge responses may need narrowly scoped POST bodies under the human lease. Do not broaden all browsing because one challenge needs a different endpoint/method.

## 10. Managed SDK, worker and lifecycle

### 10.1 Worker boundary

Use private inherited IPC where possible, with versioned discriminated messages, maximum frame sizes, monotonically scoped operation IDs and explicit cancellation/terminal acknowledgements. Do not expose an HTTP eval server, inherited privileged environment or reusable browser credentials to the guest.

Inputs contain only reviewed operation data and host-issued identity. Reject unknown message types, raw source, extra fields, stale/duplicate IDs, mismatched revisions and messages for retired clients. Validate outputs before publishing them to Fabric. Ignore/reject late results from a replaced worker and revoke its grants.

Allowlist the worker environment. Exclude credentials, proxy variables, `NODE_OPTIONS`, `BASH_ENV`, recording preferences and user-selected CDP/CLI endpoints. Use the verified runtime Node and selected browser/backend paths. An environment scrub is not the containment boundary.

### 10.2 Managed session adaptations

- Supply only an explicit, host-verified owned endpoint or private transport. Never call upstream no-argument discovery in managed mode.
- Set/remove automatic prompt approval. In particular, `autoAllow: false` must persist across every connection path; no osascript/Return injection into another browser.
- Patch `_call()` reconnect behaviour: fail an interrupted operation; never auto-discover, silently switch transport, or replay an uncertain command. A later approved operation may reconnect only through the same validated owner/endpoint policy.
- Replacing a wire must reject old pending calls, unsubscribe listeners and clear stale target/session mappings. Test `close()` while connecting and reconnect after a drop.
- Route every page-domain call with an explicit session ID. Never use the mutable active-target global to implement concurrent recipes.
- Do not start extension hubs, recordings, helper downloads or unused transports as import side effects.
- When a new backend requires a pipe adapter, reuse the generated CDP surface and add a narrow transport seam rather than exposing raw transport selection to the model.

### 10.3 State machine and cleanup

Implement explicit states such as idle, reserved, awaiting-approval, starting, running, interrupted, cancelling, settling, closed/uncertain. Document legal transitions and who owns each resource.

Record ownership as soon as a browser/context/target/session is created. Put attachment inside the protected cleanup scope; do not reproduce the upstream gnews attach-before-finally leak. Check abort/deadline after every awaited creation so late-created resources are also reclaimed.

Wait for confirmed disposal/close within bounded cleanup headroom. Fire-and-forget close requests do not prove cleanup. If cleanup cannot be confirmed, mark the lease uncertain, revoke network grants and prevent reuse. Never report rollback of a search already sent.

Close only owned contexts/tabs/processes. Never close the user's unrelated browser or kill processes by browser name. Do not remove a remembered profile during ordinary cancellation/shutdown. Profile state may have changed before a failure; preserve it and disclose uncertainty rather than automatically restoring or cloning it.

Start with one active operation per persistent profile and a small bounded queue. Metadata reads do not take an execution slot. Reservations, approval waits and shutdown must not deadlock each other. Cross-process profile locks must use verified ownership/identity; a PID number or stale file alone is not sufficient permission to kill a process or steal a lock.

## 11. Ephemeral and remembered profiles

### 11.1 Ephemeral path

Create a fresh isolated context in a dedicated managed browser whose baseline contains no personal state. Dispose the context after the operation. Do not open these contexts inside the remembered Google profile if that can expose profile-global credentials, extensions or other state; use a separate clean browser owner where necessary.

Both ordinary `web.open` and result-link inspection use this path even when search is remembered. Keep the existing private-context failure behaviour: unavailable isolation never falls back to the default profile.

### 11.2 Remembered research path

Use a profile store beneath the verified Fabric data root, outside immutable runtime generations. Logical layout:

```text
<dataRoot>/browser/
  profiles/<opaque-profile-id>/
    ownership.json
    consent.json
    chrome-user-data/
  locks/
  audit/
```

These are proposed owned paths, not permission to inspect/copy any existing Chrome directory. A profile is scoped to an operator/installation and search engine/policy; workspace/client grants are scoped separately. Sharing an engine's remembered state across workspaces must be explicitly disclosed and authorized, never inferred from a pooled process. Otherwise require a separate profile per authorized scope.

Requirements:

- Directories/control files have private ownership and restrictive permissions. Reuse existing verified-path/atomic-publication patterns; test umask 0002. Do not broadly chmod/chown unrelated directories.
- No profile import, default-profile fallback, account login or Sync. Block account-login/Sync routes not required by the reviewed public/challenge flow.
- Persist only state produced by the dedicated research environment; restrict which cookies/storage can be used for outbound requests. Do not make impossible promises that Chrome stores literally nothing else internally. Minimize and document all retained data, including local search history/cache if present.
- Cookie values, DOM storage dumps and profile files are never exposed through `browser.status`, `readSkill`, raw CDP, shell fallback or diagnostics.
- Stored consent identifies installation/profile scope, engine, profile-policy version, cookie/linkability disclosure, time and an integrity-bound consent revision. Browser data-policy changes invalidate old consent where its meaning changes.
- A setting or model statement cannot forge consent. Profile creation/authorization is an operator setup action, separate from per-query approval.
- A live profile lock is exclusive across processes and runtime generations. Browser-version/profile-format compatibility is checked; never concurrently open or downgrade a profile in an older browser to make an upgrade work.
- Revocation disables further remembered operations and revokes grants. Stop the owned browser safely; preserve state for an explicit scoped cleanup decision. Do not auto-delete profile data, backups or unknown paths.

### 11.3 Operator setup interface

Add an operator-only setup path through the installed launcher/manager, not a guest shell recipe. Proposed commands for the implementation to add and document:

```text
kiro-fabric browser status
kiro-fabric browser configure
kiro-fabric browser verify <opaque-handoff-id>
```

`configure` explains restricted-tools consequences, validates the qualified backend/browser, selects ephemeral versus remembered mode, and obtains any persistent-state consent. It must not fetch/install a browser or change system trust/network settings without a separately approved provisioning step. Headless configuration cannot pretend interactive consent occurred; use a deliberately reviewed operator input contract or fail with instructions.

Wire these commands through `scripts/installer-cli-contract.mjs` (currently a single-command parser), `scripts/install-manager.mjs`, and the verified installed launcher generated by `completeGenerationLauncher` in `scripts/managed-installation.mjs`. Add an explicit bounded subcommand grammar, help/JSON output, confirmation rules, dispatcher and package inclusion. Do not pass arbitrary trailing arguments to a shell. Test unknown/nested subcommands and verify the actual installed launcher, not only an imported handler.

The manager must reach a live handoff owner through a private authenticated control channel with verified installation/process identity. A guest-visible handoff ID alone is not a credential. If the owner has exited, the handoff expires; do not discover an unrelated daemon or browser. Operator status may use that local control channel but must not start a browser or perform an external readiness probe.

Changing effective privacy policy while operations run must revoke/restart at safe boundaries, not mutate an approved request in flight. Do not republish unrelated global Kiro settings or change the default agent.

### 11.4 No fingerprint generator

Use the real selected Chrome/Chromium engine and ordinary stable platform characteristics. Do not generate browser history, rotate fingerprints or claim a stable profile prevents CAPTCHA. Retained state can reduce repeated new-visitor checks, but request rate, IP reputation, browser signals and provider behaviour still matter. Remembered mode makes requests more linkable; document that explicitly.

## 12. CAPTCHA/consent handoff

Preserve stable programmatic interruption categories, including existing `WEB_SEARCH_CAPTCHA` / `WEB_SEARCH_CONSENT` compatibility where callers rely on them. Use internal structured errors rather than parsing raw upstream diagnostics.

A public operation encountering a challenge must stop extraction and return an actionable, sanitized interruption. Do not solve, click through consent, auto-switch engine/profile, repeatedly retry, or count it as an empty result.

For remembered mode, support this sequence:

1. Record a bounded pending interruption tied to the owner/profile/policy and a short-lived opaque handoff ID. If retaining the owned challenge tab, explicitly transfer it from the operation to a host-owned quarantine lease: no network grant, no model control, at most one retained target, and a bounded expiry. Acknowledge that ownership transfer before releasing the operation reservation. Otherwise close the target normally. No active network grant survives ordinary operation completion.
2. Return instructions for the operator command, without a debugger URL, cookies or reusable authorization token in model output. The ID identifies a request; it is not sufficient authority to control a browser.
3. `browser verify` validates operator/installation ownership, expiry and profile lock, shows the additional challenge traffic/state disclosure, and obtains human authorization for a bounded manual lease.
4. Reopen/activate only the owned challenge view if still valid; otherwise explain that a fresh approved search is needed. Do not promise that an old CAPTCHA token or tab can always be resumed.
5. While the human lease is active, model commands cannot click/type/evaluate/record/read the page or create another task in that profile. The broker permits only the reviewed challenge policy. If the required flow exceeds it, stop and report the restriction.
6. On finish/abort/expiry, revoke manual network authority, settle resources and retain only permitted profile state. Do not store form values, credentials, screenshots or page recordings.
7. The user explicitly requests a retry. Prepare and approve a new search; do not reuse the first operation's grant or automatically re-emit its query.

In ephemeral mode, interruption is still supported as a clear result, but do not silently persist its state or switch to remembered mode. An operator may explicitly configure remembered mode and then approve a new operation.

A handoff is not a detached model-owned background job. Its lifecycle and bounded permission are operator-owned, visible in status, and survive only according to a documented owner/expiry contract. Expiry, revocation or owner shutdown must close a quarantined target and acknowledge cleanup; the persistent profile itself is retained. Quarantine prevents another operation from taking that target/profile until it is safely released. Do not infer authority from the native chat title/session metadata.

## 13. Reviewed public recipes and web migration

Implement typed adapters using the upstream's reviewed extraction logic, not upstream Bash/CLI execution. Initial adapters are public search, public-page extraction and news search.

For each adapter:

- Declare raw/prepared/result schemas, exact destination policy, limits, mode support and capability requirements.
- Separate navigation/transport from extraction. Use fixed reviewed extraction code; no model-supplied JavaScript. Avoid module-level mutable session/global variables.
- Validate output types, source/engine identity, titles, URLs and metadata. Handle array emptiness explicitly.
- Surface consent/CAPTCHA/redirect/extraction failures without echoing raw page content, arguments or cookies.
- Put the entire target lifetime, including attach failures, under awaited cleanup.
- Reject unsupported profiles, origins and redirects before they produce an unauthorized request.
- Observe rate limits/Retry-After where applicable and bound queues. Do not issue repeated automatic requests in response to a challenge.

Refactor installed `WebProvider` execution to use `BrowserBoundClient`; remove executable resolution/spawn from that path. Keep `WebSearchOutput`, `WebOpenOutput`, engine selection and documented timeouts. Apply and test the restricted-selector/HTTPS policy changes explicitly; do not disguise them as backward-compatible unrestricted behaviour.

`browser.runSkill({skill:"gsearch", ...})` and `web.search` share the same backend and effective policy. `gnews` has its own explicitly disclosed Google News policy, not a silent engine fallback. Do not let direct alias invocation bypass profile consent, admission, limits or approval.

For deferred skills, ship useful prerequisites/limitations and a deterministic unavailable result. Later enablement requires a separate reviewed recipe contract and the same ledger, not just adding a script path to a map.

## 14. Packaging, installation, upgrades and documentation

### 14.1 Product and closure

Update together:

- `agent-product.json` and `docs/agent-product.schema.json`: browser worker/runtime asset, provider inventory and exact adapted skill resources.
- `scripts/build.mjs` and `scripts/build-kiro-closure.mjs`: compiled worker, immutable component/skill inventory, required runtime assets and vendored notices. Include Browser Harness in closure provenance/SBOM records.
- `scripts/build-inputs.mjs` and build/package policy checks: all source/patch/resource inputs that affect browser output must invalidate stale evidence.
- `scripts/build-agent-dev.mjs`, `scripts/validate-agent-package.mjs`: exact browser skill subtree validation, no ignored extra executable files, no accidental execution of reference scripts.
- `scripts/build-complete-bundle.mjs`, SBOM generators, archive validators and release evidence: identical content/identity across development and complete products.

Do not fetch upstream or build a global CLI at installation/startup. Preserve private Node/executable trust checks. A bundled SDK does not mean Chromium or a VM is already bundled: document the selected browser/backend prerequisite and any separately approved provisioning work. Do not increase archive ceilings blindly to accommodate a whole browser.

### 14.2 Bundle contract versioning

Use a new browser-capable bundle schema (proposed schema 3) with explicit required browser assets/resources. Keep historical schemas 1/2 validation bound to recorded ownership. Do not weaken exact-field or path checks to `resources/skills/**` without a verified inventory contract.

Implementation checklist for `src/installation/bundle-contract.mjs` and its consumers:

- Extend schema admission, required app/resources, manifest creation and reconstruction consistently. Do not infer schema solely from the presence of `ast-grep`; validation must reconstruct the incoming generation's explicit schema.
- Preserve schema-2 parser/Fovea requirements and Darwin native-asset checks in schema 3. Audit every `schema === 2` branch, including compatibility, tool pins and native source validation, rather than blindly changing one enum.
- Preserve the measured Linux parser compatibility floor; browser/backend requirements need their own verified platform descriptor if stricter.
- Keep schema-1/2 resource contracts historical; schema-3 browser resources must not be accepted as an unchecked optional appendage in an older manifest.
- Require the worker, component/provenance/license, skill index, all nine entry points and referenced resources. Missing/partial/tampered components fail new admission.
- Retain canonical sorted inventory, digest checks, ownership/modes, bounded sizes, no symlink/hardlink ambiguity, and case/path collision rejection.
- Update runtime admission in `src/kiro/managed-generation.ts`, installer contracts, manifest tooling, SBOM/certification and fixtures that enumerate schemas or runtime assets.
- Keep installation-owner record versions distinct from bundle schema numbers; do not bump unrelated journals merely because the bundle schema changes.

If current parallel work has already allocated schema 3, select a non-conflicting version and document it before editing. Do not rewrite pinned historical fixtures to make the new validator pass.

### 14.3 Generation-aware profiles

Update `scripts/agent-profile.mjs`, `scripts/managed-installation.mjs`, `scripts/launch-profile.mjs`, relevant user/development installers and validators to receive a verified generation's browser resource inventory.

- Standard/review profiles append the nine generation-bound `skill://` entries in deterministic order.
- Minimal keeps empty resources and existing minimal hook behaviour.
- An older retained generation reconstructs its old resource list, not the current source tree's browser pack.
- A tampered/missing manifest must never be treated as "old generation, omit browser". Historical behaviour is derived from verified ownership/schema evidence only.
- Existing active/resumed profiles remain reproducible. Publication/upgrade failures preserve owner journals/backups; do not rewrite older generations in place.
- Review all hooks and inherited capability surfaces when restricted mode is selected. Disable unqualified executable hooks rather than letting them bypass the network restriction.

Document browser skill selection and short native-call examples in canonical Fabric guidance. Avoid loading the full generated SDK/CDP reference into every prompt. Keep detailed docs on demand and mechanically validate resource links.

Required user-facing documents include configuration, installation/prerequisites, privacy/security boundaries, remembered-state consent, manual verification, supported platforms, migration from `web.command`, and unavailable/deferred skills. State clearly that no personal Chrome folder is copied and no fingerprint/CAPTCHA bypass is promised.

## 15. Test plan and direct probes

Audit all fixture creation/cleanup before execution. Use `tests/fixture-cleanup.mjs`; preserve any fixture containing Git metadata, bare layouts or uncertain contents. Do not invoke helpers that remove repositories. Use synthetic credentials/profiles/pages; never real user secrets, accounts or browser cookies.

Suggested new test files (names may be split for size):

- `tests/browser-component.test.ts`: pinned source/patch/license/skill inventory, deterministic output, tamper/missing assets and forbidden runtime modules.
- `browser-skill-pack.test.ts` (proposed): all IDs, metadata, paging, Unicode, stale cursors, symlinks, traversal, case collisions, missing references and bounded results.
- `browser-provider.test.ts` (proposed): typed descriptors, raw/prepared schemas, direct/indirect dispatch equivalence, aliases, unavailable recipes and no CLI fallback.
- `tests/browser-disclosure.test.ts`: exact canonical review, normalization, known-secret rejection, unsupported selectors, stale policy/profile identity, no effect before approval and composite policy denial.
- `browser-outbound.test.ts` (proposed): grant identity/expiry/revocation, byte/request accounting, method/body/header/path restrictions, redirect and resolver checks.
- `browser-isolation.test.ts` (proposed): selected-backend contract and fail-closed behaviour; clearly separate real containment tests from mock broker tests.
- `tests/browser-session.test.ts`: pinned reconnect, no auto-discovery/autoAllow, old pending call rejection, explicit sessions and no uncertain replay.
- `browser-host.test.ts` (proposed): queues/reservations, close during approval/start/attach, timeout/late creation, worker loss, cancellation and confirmed cleanup.
- `tests/browser-profile.test.ts`: empty/default isolation, explicit remembered consent, cookie scoping, no cross-workspace/engine bleed, ownership/modes, locks and restart compatibility.
- `tests/browser-handoff.test.ts`: CAPTCHA/consent classification, no auto solve/retry/fallback, operator identity/expiry, restricted manual window, fresh approval on retry.
- `browser-native-kiro.test.ts` or an opt-in evidence driver (implemented as `scripts/run-browser-native-acceptance.mjs`): installed skill routing, native tool exposure, actual approvals and interruption delivery.

Extend current tests rather than replacing them:

- `tests/web-provider.test.ts`, `tests/web-snippets.test.ts`.
- `tests/agent-profile.test.ts`, `tests/review-profile.test.ts`, `tests/launch-profile.test.ts`.
- `tests/approval-projection.test.ts`, `tests/approval-quotas.test.ts` and relevant registry/execution/bootstrap tests.
- `tests/bundle-contract.test.ts`, `tests/bundle-sbom-artifacts.test.ts`, `tests/installed-bundle-history.test.ts`, archive/staging/installer publication tests.
- Current type/config/product/closure/guidance tests discovered at implementation time.

### 15.1 Mandatory adversarial cases

1. Known synthetic keys/tokens/email-like sensitive input are rejected before spawning or sending. Unknown confidential prose is not falsely claimed to be machine-detectable; exact review still precedes disclosure.
2. Hidden/extra raw fields attempt to supply code, review text, cookies, a profile path, an endpoint, a command or higher budgets; reject all.
3. Change query, engine, profile mode, recipe version, consent or policy after review; no dispatch under the old approval.
4. Missing/declined/timed-out approval, `network: deny`, durable-state deny, and generic `allow` combinations do not bypass restricted mode.
5. A page attempts fetch/XHR/beacon/form/image/CSS/popup/redirect/WebSocket/service-worker/WebRTC/DNS exfiltration, including to an otherwise allowed host. Capture actual outbound attempts and enforce the relevant path/parameter/body policy.
6. A destination resolves/rebinds/redirects to forbidden IPv4/IPv6/private/metadata space. No real connection is made in production-policy tests. Test sinks require a host-injected fixture backend, never a production loopback allow switch.
7. An attempted shell/probe/MCP/hook bypass is denied before subprocess/server startup under restricted mode.
8. A browser drop triggers upstream reconnect logic; it cannot discover the personal browser, auto-approve a prompt or replay the search.
9. Attach fails after target creation; cleanup is awaited and late resources cannot escape. Repeat at each lifecycle await boundary.
10. Old worker results, expired grants, duplicate IDs and cross-owner/profile requests are rejected without publishing stale success.
11. A fresh context receives no remembered cookie; a remembered search uses only its approved state; an unrelated result page receives none of that state.
12. Two processes attempt the same remembered profile; one obtains verified exclusive ownership, the other fails/waits within bounds without killing or stealing unrelated resources.
13. Logs/errors/status/docs/results are scanned for synthetic private sentinels and raw cookies. Rejected values and raw failure bodies must not appear.
14. Schema-1/2 owned fixtures still validate; a new browser-capable generation missing any required resource fails; upgrades do not rewrite retained profile resources.

### 15.2 Timing and side-effect evidence

Keep production deadlines exact. Cold-start test spawn budgets should be at least 3–5 times the production bound, assert spawn errors explicitly, and use at most one ETIMEDOUT retry for a cold-start probe without changing assertions. Do not make tests green by widening production timeouts.

A passing mock only proves the mocked contract. Do not call a broker unit test OS containment evidence, a build skill-routing evidence, or a headless read probe interactive-approval evidence.

### 15.3 Native Kiro acceptance

Use the installed launcher with explicit home/workspace binding, not a globally installed external harness. Audit any existing real-driver helper before reuse; some broad release probes may have unrelated effects.

Follow the known launch form: chat options go after `chat`, for example:

```sh
KIRO_HOME="${KIRO_HOME:-$HOME/.kiro}" KIRO_FABRIC_LAUNCH_WORKSPACE="$(pwd -P)" \
  kiro-cli chat --v3 --agent kiro-fabric --output-format stream-json --require-mcp-startup \
  'List the bundled browser skills through fabric_exec. Do not browse or use native tools.'
```

Then, with operator-approved benign public queries and the qualified backend:

- A search request selects the intended skill/API without CLI setup instructions.
- A news request selects the reviewed gnews recipe, not raw shell/CDP code.
- A denied request emits no traffic, including browser startup/background traffic.
- An approved request shows the exact payload and produces structured results through the actual nested Fabric call.
- A CAPTCHA interruption is actionable; a manual handoff does not grant model control or cause automatic retry.
- Remembered state survives an owned browser restart without copying a personal profile; ephemeral result reads remain isolated.
- A request for a deferred skill explains the restriction rather than inventing success or switching to native tools.
- Standard/review/minimal profile behaviour matches the declared resource contract.

Inspect stream/tool events for the selected agent, actual `@fabric/fabric_exec` call and nested result. Do not infer success from the assistant's prose, doctor output, token counts, READY prompts or an ambient native tool. Interactive approval and full model-visible tool filtering remain distinct gates.

## 16. Suggested implementation slices and dependency order

This is the authoritative execution order; preceding numbered sections group the design by concern. Treat slices as reviewable patches, not instructions to create commits without permission.

1. **P0 containment/design gate (section 5):** ADR, threat model, backend probe, platform matrix, approved disclosure classes. Blocks enabling runtime browsing.
2. **P1 component/catalog (section 7):** pinned snapshot, adaptation ledger, skill pack, component validation. Can proceed in parallel with P0; metadata only.
3. **P2 policy/API skeleton (sections 4, 8):** strict config, typed browser namespace, provider/catalog/help, fail-closed unavailability and explicit legacy migration. No live browser yet.
4. **P3 disclosure/broker (section 9):** canonical approval and grants, restricted dispatch gate, offline outbound policy tests. No production enabling before real containment is qualified.
5. **P4 host/session (sections 6, 10):** selected backend, fixed-operation worker, pinned transport, ownership, cancellation/cleanup. Pair with the minimum search adapter from P5 to prove one approved ephemeral search end to end.
6. **P5 web/news adapters (section 13):** shared web facade, gsearch/gnews, structured results, rate limits, private result reads, no CLI fallback.
7. **P6 remembered profile/handoff (sections 11, 12):** operator configuration, consent, durable profile locks, challenge state machine and manual lease. Preserve ephemeral default.
8. **P7 delivery migration (section 14):** complete/development bundle schema, generation-aware profiles, product/closure/SBOM and older-generation regressions. Build integration should be exercised throughout, not left entirely until the end.
9. **P8 native qualification (sections 15, 17):** actual skill routing, approval UX, capture of permitted/blocked traffic, platform evidence, documentation and final build.

Do not enable every recipe before the public-search vertical slice proves the boundary. Do not implement a fake backend that reports ready because its interface methods exist. Do not spend this work porting all CDP methods or adding an image pipeline.

## 17. Verification commands and handback discipline

Use the smallest passing checks covering each slice, escalating for shared config/registry/installer risk. Inspect failures and change the implementation or explain the blocker; do not repeatedly rerun unchanged passing checks as evidence of progress.

Typical targeted commands, after the named files exist and fixtures are audited:

```sh
pnpm run typecheck
pnpm exec vitest run tests/browser-broker.test.ts tests/browser-disclosure.test.ts tests/browser-evidence.test.ts
pnpm exec vitest run tests/browser-owner.test.ts tests/browser-session.test.ts tests/browser-profile.test.ts tests/browser-handoff.test.ts
pnpm exec vitest run tests/web-provider.test.ts tests/web-snippets.test.ts tests/agent-profile.test.ts tests/review-profile.test.ts tests/launch-profile.test.ts
pnpm run build
```

For package/installer changes, run the relevant staged/bundle/history/validation suites and SBOM checks too. A completed full suite is required for release qualification; targeted runs overwrite `.tmp/vitest-report.json` and do not certify the full suite. Keep `fileParallelism` off.

Before an explicitly requested commit, run `pnpm run check` as required by `AGENTS.md`; inspect what its current staging/build scripts do first. Do not stage source changes, commit or push merely because this plan mentions the command. Installer acceptance may require the already installed trusted private Node rather than group-writable Homebrew ancestry. Discover the current trusted executable and follow the local instructions; do not weaken ownership checks or broaden permission changes.

Every implemented change ends with a fresh `pnpm run build` because installed Kiro loads `dist/`. Audit build cleanup scope first: this checkout's build removes generated `dist/`; never run it if that tree unexpectedly contains a repository or unrelated data. Preserve any test fixture with Git metadata instead of pruning it.

When running tests/probes through Fabric, use settled shell results for possible nonzero exits and inspect `ok`, `output`, and `exitCode`. Apply an explicit shell timeout to long suites and report live/pending processes accurately. No external service is needed for offline validation.

Handback must state:

- Which A01–A22 gates passed, with exact current commands/results and evidence locations.
- Which symbols/config/profile/bundle entries were mechanically verified.
- Which operations are enabled versus only documented.
- Whether containment was actually tested on each advertised platform.
- Whether real Kiro routing, interactive approval and manual challenge flow were tested separately.
- Remaining blockers/risks, unsupported platforms and required operator setup.
- Any regenerated artifacts and preserved unrelated edits.

## 18. Stop conditions and decisions requiring operator input

Stop and report rather than weakening the design when:

- No available backend can enforce outbound mediation and private-file separation on the target.
- Normal search/challenge functionality requires broader disclosure than the approved policy. Present the exact additional data/destination/effect needed; do not silently add it.
- Browser/VM provisioning, system trust/network changes, personal account access or profile import is proposed. These are not authorized by this plan.
- Existing user edits conflict with the implementation or historical package/profile evidence cannot be preserved safely.
- Cleanup would remove a repository, unknown path, retained profile or unrelated process.
- A native Kiro limitation prevents truthful ownership, approval or skill delivery. Record the limitation; do not invent session affinity or certify assistant prose as tool evidence.

The intended result is a useful integrated research browser with explicit, bounded disclosure. It is not an anti-detection product, an unrestricted browser shell, or a claim that web search can transmit no data.
