# W6: exact-candidate browser and native Kiro qualification

> **Historical / superseded by Browser Harness removal.** Browser implementation, CLI/provider entry points, bundled skills and execution qualification described below are no longer shipped. This document is retained for provenance (including unrelated verifier/cleanup repair history), not as current setup instructions, available functionality or verification evidence. See [current removal and verification notes](browser-removal.md). Historical paths may no longer exist.


**Post-cleanup prerequisite:** follow the [cleanup repair and containment plan](browser-repair-containment-plan.md) before executing this campaign. Prior offline results do not certify the changed tree, and deleted verification entrypoints must be repaired or reported unavailable. The four-target/mode requirements below remain gates, not automatically satisfied by a lean local check.

Status: **Q0/Q1 implemented and offline-tested; Q2-Q8 remain planned/blocked on prerequisite implementation and operator resources**.
Scope audit: 2026-09-23. This document refines W6 in [the follow-up plan](browser-harness-follow-up-plan.md); it is not a live qualification report or permission to install, authenticate, launch browsers, contact sites, provision hosts, sign, commit or publish.

## 1. Scope correction: W6 is not execution-only

W5 added useful schema-3 packaging and five-gate release contracts. It did not complete remembered browsing, the human challenge window, a complete-bundle Kiro driver, or live evidence collection. A green repository suite is not proof those paths work together.

Source observations at this audit are retained below as rationale. The settings/engine/native-smoke/release-witness findings were repaired by Q0/Q1; W3/W4, broker coverage and live-driver findings remain open.

| Observation | Source witness | Required consequence |
| --- | --- | --- |
| Configure writes settings schema 2 and MCP admission requires it, but the owner constructor accepts only schema 1 | `scripts/browser-operator.mjs`, `src/kiro/mcp-server.ts`, `src/browser/owner.ts` | Repair the end-to-end admission contract before even an ephemeral live run. An in-memory, no-browser constructor probe confirmed `owner settings schema`. Existing owner tests use schema 1. |
| Searches and page reads both create and dispose private contexts per operation | `src/browser/operations.ts`: `openAndEvaluate`, `searchCards` | A persistent user-data directory does not make search cookies/storage survive. W3 remains a prerequisite. |
| Owner consent verification hardcodes Google; configure creates consent using the default engine | `src/browser/owner.ts`, `scripts/browser-operator.mjs` | Carry the actual validated configured engine through consent, profile selection and operation execution. |
| CAPTCHA classification occurs after the context is disposed | `src/browser/operations.ts`: `searchCards` | Transfer the actual target before cleanup if a qualified remembered handoff is supported. |
| Verify returns `manual-control-unavailable` even after evidence checks; no owner-control module exists | `scripts/browser-operator.mjs`, `src/browser/handoff.ts` | W4 is not implemented by the lease registry. Preserve this refusal until an authenticated owner/UI path exists. |
| Broker attaches to one page session, estimates headers, passes `bodyBytes: 0`, and accounts responses on completion | `src/browser/broker.ts` | Prove target/realm coverage and actual enforceable traffic bounds; do not enable manual POST by changing a method allowlist alone. |
| Live isolation driver imports checkout `dist/index.js`, hashes source `component.json`, emits evidence schema 1, and defers redirect/service-worker persistence checks | `scripts/browser-evidence-driver.mjs` | Upgrade the driver and identity model; its current output cannot satisfy W5's schema-2 all-mode witness. |
| The native-acceptance script launches a staged MCP server, accepts elicitation automatically and writes obsolete schema-1 settings | `scripts/run-browser-native-acceptance.mjs` | Treat it only as a stale component smoke harness; repair or retire that role, never relabel it native Kiro qualification. |
| Existing real Kiro wrapper consumes the legacy Agent archive | `scripts/certify-kiro-agent-real.mjs`, `scripts/run-kiro-agent-real-driver.mjs` | Reuse event parsers/lifecycle helpers, not its archive-installation or qualification claims. |
| Browser gate validates a component descriptor hash, policy-object hash, version literal and mode booleans; Kiro checks have no mandatory typed native witness | `scripts/complete-release-promotion.mjs` | Strengthen the evidence producer and consumer together before claiming exact-code and native-approval qualification. |
| Only one historical live record exists, for darwin-arm64 ephemeral | `docs/browser-evidence/darwin-arm64.json` | Preserve it unchanged. Its `manual-challenge-window` pass describes registry exclusion, not an interactive CAPTCHA window. |

Additional honesty requirements:

- `component.json` currently describes the upstream snapshot and `p1-skill-metadata`; hashing it does not hash `owner.ts`, broker, operations, approval routing or their built dependencies.
- A hash of an arbitrary policy object establishes equality, not that the object describes the executed policy. The current release `policyVersion: 1` literal is not compared to actual installed consent semantics.
- Current mode derivation permits deferred `redirect-revalidation-live` and `service-worker-persistence` checks. Persistent/manual qualification must not inherit that ephemeral-only deferral.
- The checked-in isolation design explicitly lacks OS-level containment and documents opaque-response undercounting. Local sink silence cannot prove absence of all external DNS/network traffic. Reconcile contradictory stronger wording rather than claiming an OS sandbox.
- Native Kiro's previously observed elicitation/inventory limitations remain historical blockers until re-probed against an explicitly identified current client. An incomplete `/tools` tag list or model-authored inventory cannot clear them.

## 2. Deliverables and acceptance ledger

Each row is separately tracked as planned, implemented/offline-tested, live-qualified, or blocked. Q0 and the Q1 contract/consumer migration are implemented/offline-tested; no row is live-qualified.

| ID | Deliverable | Acceptance |
| --- | --- | --- |
| Q0 — implemented/offline-tested | Consistent admission and capability reporting | Current schema-3 configure-shaped settings reach an idle owner; legacy/stale settings refuse without launch; engine-bound consent is checked per operation; status/help/provider messages create no unavailable window. |
| Q1 — implemented/offline-tested | Executed-code and policy identity contract | Closure-manifest executable `contentDigest`, browser, flags, effective policy, consent/disclosure, target, engine/recipe scope and evidence bytes invalidate affected admission; release gates require typed containment/installed/native-client roles and the containment bytes embedded in the exact candidate. |
| Q2 | W3 persistent research owner | A consented engine-state marker survives owned browser restart and is absent in readers, other engines, unconsented scopes and ephemeral searches. |
| Q3 | W4 actual human handoff | The same retained target is shown to the human under bounded authority; all model access is excluded; expiry/revocation/finish closes it with acknowledged cleanup. |
| Q4 | Safe native browser evidence driver | All required checks run against identified native code/browser bytes; failures and unavailable checks cannot produce qualified mode flags. |
| Q5 | Exact complete-bundle installation capture | Captured final archive bytes produce verified installed generation/profile/resource bindings with no source fallback. |
| Q6 | Authenticated native Kiro browser capture | Structural native events bind selected agent, exact Fabric call, nested browser operation, intended approval and outcome; authoritative filtering and lifecycle checks pass. |
| Q7 | Browser gate assembler/validator | Requires matching containment, installed and native-client witness roles; rejects smoke, replay, mixed artifacts, missing/duplicate roles and partial modes before producing qualifying gate output. |
| Q8 | Four-target campaign and reviewed handoff | All twelve target/mode cells and all advertised engine/recipe scopes have actual evidence; missing cells block the release policy. |

Dependency order:

```text
Q0 -> Q1 -> Q2 -> Q3 -> Q4 component/native containment evidence
                  Q5/Q6 driver development can proceed offline in parallel
Q4 reviewed code-bound records -> final clean candidate freeze -> Q5 -> Q6
Q5 + Q6 + containment identity -> Q7 -> Q8 independent review
```

Use one coordinator for builds/staging/tests in this checkout. This plan includes prerequisite W3/W4 work; do not report it as already completed W6.

## 3. Q0 — repair admission before expanding live scope

Files: `src/browser/{owner,profile-store}.ts`, `src/kiro/mcp-server.ts`, `scripts/browser-operator.mjs`, `src/providers/{web-provider,browser-provider}.ts`, associated status/disclosure code.

1. Reproduce schema-2 configure -> MCP admission -> owner rejection in a regression test, not just a constructor test.
2. Make the owner consume the current validated settings contract. Preserve legacy readability for status/migration, not silent admission. Do not simply accept both schemas without evidence binding.
3. Test no launch during construction/status and zero effects for wrong target/backend/browser/component/mode or revoked consent.
4. Thread the configured engine explicitly. Validate Google news scope separately from a configured Bing search profile; never borrow another engine's remembered state.
5. Make interruption messages conditional on an actual supported handoff, rather than the current unconditional promise of an available manual window.
6. Test operator reconfiguration/revocation against a running MCP owner, not only next-process startup. No settings change may silently broaden an already-approved operation.

Checks: extend `tests/browser-owner.test.ts`, `tests/browser-operator-cli.test.ts`, `tests/browser-integration.test.ts`, `tests/browser-web-migration.test.ts`; add a focused MCP admission test with fake transport and current settings. A mocked transport here is offline evidence only.

**Implemented/offline-tested:** the positive current-settings operator-to-owner path and negative legacy/engine/code/policy/evidence/browser/flags paths pass without a live browser. Reconfiguration revokes active consent and the owner rechecks it before every new remembered operation. In-flight cancellation remains part of Q2.

## 4. Q1 — define trustworthy identities and versioned witnesses

Files: `src/browser/evidence.mjs`, profile settings/consent, MCP and operator admission, `scripts/complete-release-{promotion,signing-inputs,inputs}.mjs`, build/package validators and tests. A small builtin-only shared qualification-contract module is preferable to importing the entire TypeScript runtime into installer scripts.

### Identity design

Keep distinct:

- `componentHash`: existing descriptor identity, retained for provenance.
- `runtimeCodeDigest`: deterministic path/size/hash inventory of the actual executable closure and dependency bytes used for the browser path, including approval/admission code. Hash a deliberately specified complete code inventory, not only hand-selected browser filenames. Include runtime/native dependency identities; qualify native targets independently.
- `policyHash`: canonical, schema-validated effective policy (numeric budgets, origins/paths/methods, target/realm handling, flags and requested mode), derived from the same policy builder used by execution. No prose value such as “see dist defaults.”
- `consentPolicyVersion` and disclosure digest: use one canonical constant/contract, checked against operator consent and the executed generation.
- Browser executable identity and relevant runtime payload/build identity, Kiro executable identity, host architecture/OS/libc and translation state. A launcher stub or mutable browser dependency must not masquerade as an unchanged browser build.
- Explicit engine/recipe/mode scope: Google/Bing search, Google news and clean readers must not inherit untested scopes.
- Post-freeze identity: exact source commit, archive hash, bundle digest, metadata/SBOM and installed profile/resource hashes.

Avoid a circular digest: code identity excludes qualification records and self-hashing manifests by a fixed reviewed rule, but not executable dependencies. Record a separate source/build provenance identity. Tests must prove adding evidence alone leaves code identity unchanged, while changing any executed dependency does not.

### Schema and validation work

1. Recommended: a new browser evidence schema version for the strengthened identity and mandatory persistence/manual checks; preserve schema-1/2 parsing as historical evidence only under their original claims. Do not reinterpret historical booleans as new proof.
2. Version the browser gate format if adding required typed witness roles; migrate assembler, signing-input validation, promotion, encrypted transport and fixtures together. Keep bundle schema 3 and the four existing gate meanings unchanged. Do not globally replace schema numbers or silently accept old browser gates for new qualification.
3. Operator bindings must carry the new identity fields or explicitly require reconfiguration. Reject unknown modes and schemas. Expose sanitized unavailable reasons, not profile contents/control credentials.
4. Derive qualifications from a complete validated check set. Empty/missing/duplicate checks must never qualify via a helper's default success. Make persistent redirect/background/new-target checks required for persistent/manual modes; keep old ephemeral deferrals explicit.
5. Semantically validate each witness role, not just its hash. A browser gate must reference containment, installed-byte and native-Kiro receipts from one run/candidate identity. Its native approval/filtering booleans are derived from captured observations, not CLI `--passed` inputs.
6. Preserve publisher attestation as independent reviewed authority. Machine validators establish identity, structure and event correlation, not an unforgeable proof that a human observed the UI.

Checks: `tests/browser-evidence.test.ts`, `tests/browser-profile.test.ts`, `tests/bundle-schema3.test.ts`, `tests/release-complete.test.ts`, `tests/complete-release-inputs.test.ts`; add contract tests for code-only identity and typed witness role validation. Include changed code with unchanged descriptor, wrong flags/engine/policy/consent, reordered/missing receipts, wrong browser build, false derived claims and policy-object drift.

**Implemented/offline-tested contract:** browser-evidence schema 3 and settings schema 3 are current; evidence schemas 1/2 remain historical only. Runtime identity uses the closure manifest's executable `contentDigest` rather than its evidence-bearing build-input provenance, avoiding a qualification cycle while still covering every app/dependency byte. Installed operator commands load a dedicated generation-local API entrypoint. Admitted browser policy, engine and exact recipe scope are pinned across workspace runtime recreation. Runtime execution derives its outbound gate from the hashed effective policy. Operator/MCP/release consumers and synthetic contract fixtures are migrated. Release gate schema 2 requires containment, installed and native-client roles and rejects missing/duplicate or correctly rehashed false receipts. The live schema-3 producer/assembler remains Q4/Q7; synthetic fixtures are not authority.

## 5. Q2 — finish W3 persistence and containment lifecycle

Next coding slice: [Q2/Q3 scoped implementation plan](browser-harness-q2-q3-implementation-plan.md). It expands Q2/Q3 into source-verified prerequisites, ordered A0–A6 work packages, an acceptance ledger and separate native proof gates. Start with containment feasibility and process/profile lifecycle correctness; the existence of that plan does not mark Q2/Q3 implemented.

Follow the full W3 design in the parent plan. Modify `owner.ts`, `host.ts`, `session.ts`, `operations.ts`, `profile-store.ts`, `launcher.ts`, broker and provider/MCP wiring.

- Use a dedicated engine-consented persistent search owner. Keep page/result-link readers in a separate clean owner/process; sharing incognito tabs inside the persistent process is not the reader-separation proof.
- Keep a persistent control session, but issue revocable per-operation traffic grants. Idle state has no ambient browsing grant. Cover restored/new targets, frames, workers, service workers, popups and startup/shutdown before claiming persistence safe.
- Retain allowed state honestly; document Chrome ancillary state and sharing scope. Never seed fake history, import personal cookies or enable login/Sync.
- Hold the profile lock until owned process-tree exit is confirmed. Repair launch failure, deadline/cancel races, crash/relaunch and forced-kill cleanup; do not release the lock or delete profile bytes while process ownership is uncertain.
- Revocation stops existing work and future admission; it preserves durable profile data. Cross-generation owners cannot concurrently open it. Do not infer native chat ownership from an MCP PID.

Live proof on an approved controlled site: create a nonsecret marker, stop the owner, prove PID/instance change, restart and verify retained state. Verify absence in each excluded scope. Exercise revocation, crash and competing owners. No personal browser inspection is needed.

Checks: browser owner/profile/session/operations/integration suites plus controlled persistence probe. If application-layer containment cannot safely cover persistent background traffic, keep remembered/manual modes blocked and return for an architecture decision; do not weaken the gate.

## 6. Q3 — finish W4 real manual challenge control

Follow the W4 lifecycle in the parent plan. Add a private browser owner-control module (proposed) and corresponding tests; wire it into host/owner/handoff/operator CLI without a guest-visible control API.

1. Classify interruption while the actual target exists. Revoke normal traffic, quarantine/transfer the target with an acknowledgment, then release operation ownership. Bound the pending-target count and lifetime.
2. Bind the handoff to owner generation, installation, engine/profile, consent/policy/code identity and intended client where such association is trustworthy. Otherwise refuse ambiguous clients.
3. Implement bounded private local IPC with owner/operator authentication, replay protection, strict framing/verbs and verified private ancestry. A displayed handoff ID is not a credential.
4. Implement begin/finish/abort with exact disclosure and real operator consent; bring forward only the quarantined target. No new query/navigation or personal-browser discovery as fallback.
5. Define provider-specific manual rules for endpoints, paths, methods and actual body/header/request/response budgets. Unknown/unmeasurable bodies fail closed; never log form values. Ordinary operations remain GET/HEAD-only. Validate network behavior with sink-side observations, not only broker decision logs.
6. Freeze all model access to that profile through every entry point, including queued work and `browser.runSkill`. Owner-driven expiry/revocation closes the target even if no later command arrives.
7. Acknowledge cleanup before consuming the handoff/releasing the lock. A resumed search is a new operation with a new exact-payload approval. No automatic CAPTCHA solving, retry, fingerprint rotation or artificial browsing history.

Update CLI grammar/dispatch/help/JSON, guest capability descriptions and bundled skills coherently. Existing `manual-control-unavailable` stays until these paths exist and their mode is qualified.

Checks: handoff/operator/broker/session/integration suites and new owner-control tests. Cover stale endpoints, PID reuse, cross-profile/client replay, concurrent begin, oversized payload, operator disconnect, timeout without polling, owner death, revocation and uncertain cleanup.

**Live acceptance:** first a controlled human-interaction fixture, then a separately approved real provider challenge when naturally available. Controlled UI success does not prove a real provider flow; an absent challenge is inconclusive, never a reason to trigger CAPTCHAs with repeated requests.

## 7. Q4 — build safe native containment evidence collection

Refactor `scripts/browser-evidence-driver.mjs` into an import-safe tested library plus opt-in CLI. Proposed companions are a browser qualification contract module and a dedicated evidence-driver test; their final paths are not yet assigned.

Required changes:

- Read explicit immutable candidate-code/closure identity, browser, native target, requested modes/scopes, reviewed fixture origins and create-only output directory. No default overwrite of the target-specific JSON record under `docs/browser-evidence/`.
- Validate executable ownership/identity before even `--version`; bind browser/driver/code/flags before and after. Use trusted Node, strict arguments, bounded output/time and a cleanup supervisor with signal handling.
- Do not mix checkout `dist/index.js` and a different installed closure. Define one reviewed fixed-operation component-test entry if a code-only prequalification path is needed; it must not be exposed through MCP, a model-selected path or a production bypass environment flag. Account for any shipped entry in product/build inventories and tests.
- Cover startup/idle/exit, public rendering, denied local/private/metadata access, redirects, method/body limits, response accounting (including opaque responses), new targets/realms, cancellation/crash and no-orphan behavior. Exercise DNS/private-address protection with controlled fixtures; never contact real metadata/admin/cluster endpoints or read credentials.
- Compare observable broker decisions with controlled sink counts. Distinguish application-layer restrictions from an OS sandbox; reconcile `docs/browser-isolation-design.md` backend naming and unsupported stronger claims.
- Add real Q2/Q3 checks. Keep legacy registry-only evidence separately labeled, never counted as manual UI qualification.
- Record search usability separately from containment: useful results, captcha, consent, 429, extraction failure and unavailable modes are different outcomes. One approved attempt is not permission for automated retries or engine fallback.
- Stop/reap every task-owned child before cleanup. Preserve uncertain profiles, logs and failed runs. Reuse/factor the repository-preserving bounded cleanup semantics of `tests/fixture-cleanup.mjs`; no unchecked recursive removal in live helpers and no dependence on test-only files in shipped runtime.
- Produce explicit pass/fail/inconclusive/not-run results plus sanitized witness digests and failure category. Only fully observed validated modes become qualified. No manufactured success after a catastrophic path.

Acceptance: offline parser/timeout/cleanup/tamper tests, then separately approved native component runs. A dry-run validates inputs and states intended effects without browser launch, network or installation.

## 8. Q5/Q6 — exact installed bytes and real Kiro

### Complete-bundle driver, not a legacy archive relabel

Add a dedicated opt-in browser/Kiro qualification script and receipt validator/tests (proposed; final script path is not yet assigned). Reuse safe archive capture, native identity, failure-report and ACP/event parsers from existing helpers. Keep `certify-kiro-agent.mjs` component-only; its `authenticatedKiro: NOT TESTED` remains correct.

Repair `run-browser-native-acceptance.mjs` only as an explicit component MCP smoke harness: current settings, real assertions and safe cleanup. Its auto-accepted forms cannot satisfy native accept/decline checks. Do not add the real live driver to default `pnpm run check`.

### Installed-byte requirements

1. Capture final archive/sidecars once, verify expected identity and native compatibility, extract safely, and record installed manifest/private tools/profile/skill-resource identities.
2. Use a disposable explicitly owned HOME, KIRO_HOME and workspace with **real Kiro**, not a fake version/CLI contract. Authentication is separate, supported and operator-approved; do not copy ordinary credentials/home/profile contents.
3. Respect the release installer signature boundary. The production trust root is currently absent. Signed final metadata and a separately authorized signer/root provisioning step are prerequisites for a release-provenance installation through the supported public path. Do not pass fabricated `releaseMetadata`, rewrite release provenance to source, or add an unsigned-install flag.
4. Trusted local-source installation rehearsals may run after separate authorization, but remain rehearsal receipts and cannot set exact release-installation checks to true.
5. Verify all nine standard/review skill resources and intentionally empty minimal resources. Test actual discovery/readSkill/selection and supported gsearch/gnews dispatch, with unsupported recipes still unavailable.
6. Remove acquisition/source dependence by using an unrelated cwd and excluding checkout paths; a positively owned acquisition directory may be moved aside and retained. Never delete a repository as an independence test.

### Native Kiro requirements

- Record actual Kiro help/version/binary identity and selected-agent events. On supported clients use `kiro-cli chat --v3 --agent kiro-fabric ...`, with chat options after `chat`; fail clearly on unsupported grammar.
- Require actual `@fabric/fabric_exec` call/completion and nested browser action identity, not assistant prose or a raw MCP result.
- Set restrictive browser configuration and explicit network approval (`ask`); display the exact normalized query/URL, state mode and disclosure. Capture real human accept **and** decline with request/response IDs, intended session and call identity. A denied request must have no dispatch/traffic; approval alone is not operation completion.
- Separately test intended-chat association or conservatively reject unassociated forms. Wrong agent, native fallback, auto-approved forms and pooled-process guesses fail.
- Obtain authoritative complete model-visible tool inventory showing the intended Fabric-only exposure. The `/tools` picker and initial MCP token count are insufficient. If current Kiro cannot expose/enforce this, report a client blocker rather than silently expanding the supported tool set.
- Exercise clean readers, selected search/recipe paths, interruption presentation, actual human handoff, explicit fresh reapproval, cancellation, workspace revocation, resume and shutdown. No authority or stale handoff survives a session boundary without the documented ownership contract.
- Reuse the existing generic client gate for its edit/shell/compaction requirements; browser receipts supplement, not replace, that gate.

Suggested coverage: a new browser/Kiro qualification test, `tests/qualification-driver-capture.test.ts`, `tests/qualification-failure-acceptance.test.ts`, `tests/release-evidence.test.ts`, `tests/installed-independence.test.ts`. Negative recorded-event fixtures must include absent/foreign/replayed call IDs, wrong chat, forged model prose, truncated frames, mismatched output, implicit approval, extra native tools and cleanup failure. Fixture transcripts are never real authentication evidence.

## 9. Q7 — evidence assembly and privacy

Add an offline browser gate assembler after the schemas are settled (proposed; final script path is not yet assigned). It must consume observations, not generate success booleans from requested checks.

- Require containment, installed and native-Kiro receipts with exactly matched target/code/browser/policy/scope and final archive/bundle identity. Bind driver version/digest and unique run IDs; reject mixed attempts and cross-target substitutions.
- Native receipts must anchor sanitized events to specific bounded recording intervals, request/session/tool-call IDs and input/result/frame digests. Validate semantic outcomes through the same parser used by the driver.
- Emit `TARGET/browser.json` only after all mandatory checks pass. Failures use a distinct non-qualification diagnostic artifact. Keep partial-cell progress visible without producing a promotable gate.
- Keep hash-named sanitized JSON witnesses compatible with bounded private transport. Raw ACP/TUI captures, auth state and profile data remain outside transport/repository/public assets. Do not hash-and-publish sensitive low-entropy form contents as purported redaction.
- Review/redact before sharing. Hash bindings must refer to the exact reviewed exported bytes; retain a private provenance link if sanitization changes the capture. Fail on secrets/paths/headers/cookies/control credentials in shareable fields.
- Validate all four targets before writing signing requests. Missing targets/modes, wrong policy/runtime/flags, untrusted host, synthetic witness source and incomplete native inventory block promotion. Contract test keys stay in explicit test seams only.

Tests: extend complete-release signing/promotion/transport suites with correctly rehashed but semantically wrong witnesses, missing native receipt, schema downgrade, duplicate roles, archive drift, replayed approvals, privacy violations and output-exists behavior. Add assembler tests with explicit non-live fixture provenance and no production success path from those fixtures.

## 10. Q8 — operator campaign and non-circular freeze sequence

### Minimum target/mode matrix

| Native host | Ephemeral | Remembered research | Manual challenge | Native Kiro |
| --- | --- | --- | --- | --- |
| darwin-arm64 | Historical record only; current candidate pending | Implementation + live pending | Implementation + live pending | Pending |
| darwin-x64 | Pending | Pending | Pending | Pending |
| linux-arm64 | Pending | Pending | Pending | Pending |
| linux-x64 | Pending | Pending | Pending | Pending |

Twelve cells is the minimum, not twelve identical smoke invocations. Record advertised engine/recipe scope and browser/Kiro/OS versions within each cell. Native GUI/display access is needed for human UI cases. Verify a supported native browser is actually available on Linux ARM64; do not substitute emulation or an x64 record. Hosted runner labels prove nothing. Minimum-system gates remain separate from ordinary current-OS runs.

### Required operator decisions before live execution

- Explicit hosts/owners and native GUI access, trusted Node/browser/Kiro builds and compatible systems.
- Approved controlled HTTPS fixture endpoints (redirects/state markers/manual form) and innocuous public search queries; no private/admin/cluster endpoints.
- Explicit browser/profile creation, isolated installation and authentication permission; human availability for approvals and challenges. Set request/model-use/time budgets.
- Private evidence storage/retention and independent reviewer; no automatic upload of raw data.
- A reviewed clean commit after code/tests are ready. The current tree is dirty; a coding agent must not commit it without a separate request.
- Production public-root/signing custody before release candidate freeze and release-provenance installation. This task does not provision keys, sign, update remotes or publish.

### Sequence that avoids self-qualification

1. Finish Q0–Q3 and all driver/validator work; run offline tests. Reconcile capability/docs/skill disclosures. Obtain separately approved native **component** runs against fixed code closures with explicit driver authority, not a production MCP admission bypass.
2. Independently review code-bound per-target containment records, including persistence/manual results. Preserve historical records; publish new reviewed inputs only through an approved source change. No candidate archive digest appears in its own embedded containment record.
3. After authorized review/commit, build clean native final candidates containing those records. Recompute runtime identity; if it differs from the prequalified code, stop and requalify. Evidence-only additions must not change the defined code identity; executable/policy changes must.
4. Freeze exact archive/manifest/SBOM bytes per target at the same final commit. If release install needs metadata signatures, obtain them in the separate approved custody process now; this is not final qualification signing or publication.
5. Run installed-byte and authenticated native Kiro qualification against those unchanged final artifacts through normal production admission and operator consent. Record all final-archive witnesses **outside** the bundle. Do not inject a pass record after installation or modify/recompress the qualified archive.
6. Assemble and independently review the four browser gates together with the other four gate families. Only then may a separately authorized signer attest to complete qualification. Transport/promotion/publication remain separate, gated operations.
7. Any code/browser/policy/flags/client/config identity change invalidates the affected evidence. Never transfer a passed receipt to a rebuilt archive by editing its digest. Interrupted/unavailable targets remain blocked, not silently removed from release scope.

Workflow work is local definition/testing only: review `.github/workflows/complete-bundle-candidate.yml` and related tests, update pending summaries to include browser qualification, and optionally add manual-only private native campaign hooks. Do not dispatch workflows, provision remote hosts or upload evidence in this planning task. Human interactive checks are not automatic hosted CI passes.

## 11. Verification and implementation handoff

Next implementation slice: **Q2 persistent engine owner and reader separation, then Q3 authenticated human control**. Do not launch a four-host campaign first. The former native-acceptance driver has been retired to a no-browser fail-closed component MCP smoke and remains nonqualification evidence.

Smallest useful offline checks per slice:

```sh
# Q0/Q1, after implementing the corresponding changes
pnpm exec vitest run tests/browser-owner.test.ts tests/browser-operator-cli.test.ts tests/browser-integration.test.ts tests/browser-evidence.test.ts tests/browser-profile.test.ts
# Q2/Q3: add new owner-control/MCP admission tests when created
pnpm exec vitest run tests/browser-operations.test.ts tests/browser-session.test.ts tests/browser-broker.test.ts tests/browser-handoff.test.ts tests/browser-web-migration.test.ts
# Q7
pnpm exec vitest run tests/release-complete.test.ts tests/complete-release-inputs.test.ts tests/bundle-schema3.test.ts tests/release-native-evidence.test.ts
```

Use trusted Node as documented in `AGENTS.md`. Run new driver/parser tests without live access by default. Audit cleanup before running helpers. Keep production bounds exact; use generous harness-only spawn limits and assert spawn errors. Never run concurrent suites/builds in this checkout.

Before freezing a candidate, run `pnpm run check` to completion, preserve the full log/JSON report, then finish handback with `pnpm run build`. The prior W5 check (249 passing files, 3,799 passing tests) is historical baseline evidence, not certification of future Q0–Q8 code. Full-check duration exceeded twenty minutes; give the next serial run an explicit sufficient outer timeout and inspect its actual completion/exit status rather than treating a still-running notice as success.

Mechanically verify new symbols/imports, script commands, CLI grammar, guest declarations, product/runtime assets, package validators, audit inventory and all profile modes. Proposed scripts/modules in this document do not exist merely because they are named here. Do not expose qualification/handoff controls as new model tools.

Final handback must list: exact commit/candidate identities; implemented vs enabled vs live-qualified behavior; every target/mode/engine result; real search usability; native-client blockers; preserved failed/partial-run evidence; skipped tests; signature/provisioning prerequisites. `authenticatedKiro: NOT TESTED` in component certification must not be edited to PASS—real-client evidence is a separate result.

## 12. Stop conditions

Stop for unmediated persistent/manual traffic, unenforceable claimed byte bounds, unsafe cleanup/uncertain process ownership, unreviewed challenge endpoints, unavailable native browser/GUI/host, missing real human observations, incomplete Kiro inventory or approval association, identity drift, absent signer prerequisites, or uncertain installation ownership. Preserve fail-closed behavior and explain the blocker. Real-home recovery, new recipes, arbitrary CDP/model JavaScript, CAPTCHA bypass, provisioning and publication are outside this scope.
