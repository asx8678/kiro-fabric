# Fovea parity matrix

Pinned reference: monotykamary/pi-fovea@b594483868d27b7eb37a9b185c59ce812f8a9c01.
A representative fixture pass is not complete-family qualification. Blocked rows never count as passed.
Machine-readable exact reference/target/test mapping: `docs/fovea/parity-matrix.json`.

| ID | Family | Target | Executable evidence | Status |
| --- | --- | --- | --- | --- |
| F01 | sketch | `src/fovea/core/ops.ts`, `src/fovea/core/render.ts` | `tests/fovea/reference-differential.test.ts`, `tests/fovea/engine.test.ts` | implemented-unverified |
| F02 | focus | `src/fovea/core/ops.ts` | `tests/fovea/reference-differential.test.ts`, `tests/fovea/engine.test.ts`, `tests/fovea/engine-languages.test.ts` | implemented-unverified |
| F03 | filters/evidence | `src/fovea/core/ops.ts`, `src/fovea/core/graph.ts` | `tests/fovea/engine.test.ts`, `tests/fovea/engine-review.test.ts` | implemented-unverified |
| F04 | disclosure/dwell | `src/fovea/core/session.ts`, `src/fovea/engine.ts` | `tests/fovea/engine.test.ts`, `tests/fovea/engine-review.test.ts`, `tests/fovea/host-process.test.ts` | implemented-unverified |
| F05 | impact | `src/fovea/core/ops.ts`, `src/fovea/core/git.ts` | `tests/fovea/reference-differential.test.ts`, `tests/fovea/engine-review.test.ts` | implemented-unverified |
| F06 | co-change | `src/fovea/core/cochange.ts` | `tests/fovea/reference-differential.test.ts`, `tests/fovea/engine-review.test.ts` | implemented-unverified |
| F07 | numerics | `src/fovea/core/heat.ts`, `src/fovea/core/bend.ts`, `src/fovea/core/basins.ts` | `tests/fovea/core-heat.test.ts`, `tests/fovea/core-conserved-heat.test.ts`, `tests/fovea/core-basins.test.ts` | verified |
| F08 | grep | `src/runtime/guest-bootstrap.ts`, `src/providers/repo-contract.ts` | `tests/fovea/guest-grep.test.ts`, `tests/fovea/engine-review.test.ts` | intentional-divergence |
| F09 | results/reads | `src/fovea/result-store.ts` | `tests/fovea/guest-focus-read.test.ts`, `tests/fovea/host-boundaries.test.ts` | implemented-unverified |
| F10 | coverage | `src/fovea/core/discover.ts`, `src/fovea/core/extract.ts`, `src/fovea/core/join.ts`, `src/fovea/core/build.ts` | `tests/fovea/engine.test.ts`, `tests/fovea/engine-review.test.ts`, `tests/fovea/engine-languages.test.ts` | implemented-unverified |
| F11 | attention | `src/fovea/observations.ts`, `src/fovea/host.ts` | `tests/fovea/observations.test.ts`, `tests/fovea/engine-review.test.ts` | implemented-unverified |
| F12 | sync | `src/fovea/core/sync.ts`, `src/fovea/engine.ts` | `tests/fovea/engine.test.ts`, `tests/fovea/engine-review.test.ts` | implemented-unverified |
| F13 | sync-escalation | `src/fovea/core/sync.ts`, `src/fovea/delivery.ts` | `tests/fovea/engine-review.test.ts` | implemented-unverified |
| F14 | provenance | `src/fovea/observations.ts`, `src/fovea/delivery.ts`, `src/fovea/provenance-journal.ts` | `tests/fovea/observations.test.ts`, `tests/fovea/provenance.test.ts` | implemented-unverified |
| F15 | multi-root | `src/fovea/root-leases.ts`, `src/fovea/engine.ts` | `tests/fovea/engine-review.test.ts`, `tests/fovea/host-boundaries.test.ts`, `tests/fovea/provenance.test.ts` | implemented-unverified |
| F16 | lifecycle/restoration | `src/fovea/engine.ts`, `src/kiro/fovea-hook.ts` | `tests/fovea/host-process.test.ts`, `tests/fovea/capability.test.ts` | implemented-unverified; native restoration unfinished |
| F17 | config/controls | `src/fovea/config.ts`, `src/fovea/host.ts` | `tests/fovea/host-boundaries.test.ts`, `tests/fovea/config-project.test.ts`, `tests/fovea/host-process.test.ts` | implemented-unverified |
| F18 | anchors/rules | `src/fovea/core/anchors.ts`, `src/fovea/core/discover.ts`, `src/fovea/host.ts` | `tests/fovea/engine-review.test.ts`, `tests/fovea/engine-languages.test.ts`, `tests/fovea/host-boundaries.test.ts`, `tests/fovea/host-process.test.ts` | implemented-unverified |
| F19 | protocols | `src/fovea/core/protocols.ts`, `src/fovea/core/join.ts` | `tests/fovea/engine-languages.test.ts` | implemented-unverified |
| F20 | status/controls | `src/fovea/host.ts`, `src/fovea/engine-process.ts` | `tests/fovea/host-boundaries.test.ts`, `tests/fovea/host-process.test.ts` | implemented-unverified |
| F21 | delivery | `src/kiro/fovea-context.ts`, `src/fovea/delivery.ts`, `src/kiro/fovea-hook.ts` | `tests/fovea/context-delivery.test.ts`, `tests/fovea/mcp-context.test.ts`, `tests/fovea/capability.test.ts` | implemented-unverified; native hook/continuation unfinished |
| F22 | distribution | `build-toolchain.json`, `scripts/build-complete-bundle.mjs`, `src/installation/bundle-contract.mjs` | `tests/fovea/packaging.test.ts`, `tests/installed-independence.test.ts`, `tests/installer-smoke-bundle-acceptance.test.ts` | implemented-unverified |

## Platform, migration and release follow-up

- Darwin arm64 source loading/packaging is implemented and installed: a real
  authenticated Kiro 2.22.1 `repo.focus()` returned source and callers. The earlier
  Linux-only/no-macOS-host claims are historical, not current blockers. See
  [macos-activation.md](macos-activation.md) and the current
  [completion ledger](completion-ledger.md). Native H-gates are separate.
- F22 now also has four real archived historical-manager schema-1 → schema-2
  handoff/rollback/recovery cases, registered in installer acceptance. This
  qualifies the trusted source path, not old-manager maintenance with a newer
  retained schema or public signed update. See
  [historical-manager-migration.md](historical-manager-migration.md).
- Local archive/SBOM validation and release scanner regressions pass; candidate
  reporting refuses the dirty tracked tree. Production trust/signing,
  four-target exact-bundle CI and native Kiro acceptance remain separate gates.
  No F/H row is promoted to complete parity. Exact counts and exit evidence:
  [verification-current.md](verification-current.md).

## Current native protocol observations

Authenticated Kiro 2.22.1 TUI hooks and a subsequent stop-hook continuation MCP
call were observed; headless emitted no hooks. Neither MCP surface supplies a
native chat/session identity, so supported hook-to-host routing remains missing.
No intended-model-input acknowledgment was observed. The table below separates
**partial observations and blockers from complete gate qualification**. No H gate
is passed: the demonstrated continuation bound belongs to the fixture, and a
separate native probe observed hook completion after Escape input, not an
acknowledged cancellation or accepted queued prompt.
Details: [host-capability-probes.md](host-capability-probes.md).

Darwin descriptor-safe provenance and all 15 pinned lifecycle component cases
now pass without skips; fixture generation admission is not installed/native-Kiro
session qualification. See [completion-ledger.md](completion-ledger.md).

## Native client gates

| ID | Gate | Status |
| --- | --- | --- |
| H01 | same session and MCP instance across multiple turns | host-blocked: observed MCP initialize/calls/environment lack supported native session identity; cross-turn association unqualified |
| H02 | concurrent session-to-host mapping and ambiguity rejection | host-blocked: required session identity unavailable; concurrent mapping and ambiguity rejection not exercised (pooling across sessions is not established) |
| H03 | readiness, authorized binding and first-hook ordering | partial: native-TUI SessionStart then UserPromptSubmit observed; real engine readiness and authorized binding unqualified |
| H04 | prompt marker delivered to intended model turn | unqualified: actual prompt-marker input unobserved; following a Stop reason is not prompt-delivery proof |
| H05 | post-tool marker delivered without changing result or error | partial: native-TUI success/error PreToolUse/PostToolUse and tool_response observed; real Fabric preservation and next-step delivery unqualified |
| H06 | stop marker causes bounded continuation, not merely hook firing | partial: mechanism demonstrated on native-TUI by a real third MCP fixture call; one-shot bound belongs to the fixture, not a verified client contract |
| H07 | cancel stops automatic work and queued user input wins | unqualified: hook completed 7,305 ms after PTY Escape input; no acknowledged session/cancel event or second UserPromptSubmit observed. Cancellation/queue contract unverified, not a proven host failure |
| H08 | new/resume/clear/compact/profile-swap signals or safe recovery | partial: headless resume preserved chat identity and completed a fixture call on a distinct MCP instance still lacking native session metadata; TUI replay is not new-hook evidence; hook/Fabric restoration and clear/compact/profile-swap unqualified |
| H09 | visible/model-only/disabled and status/settings/reset/reload | untested |
| H10 | accepted/declined exact effects and workspace revocation | untested |
| H11 | authoritative complete model-visible tool inventory | untested |
| H12 | old session retains generation-matched engine and hooks | untested |

Additional F04/F11/F16 evidence: `tests/fovea/reference-lifecycle.test.ts`
executes both pinned references through a fixture runner and compares shared
native host/registry/guest invariants. See `docs/fovea/lifecycle-replay.md`.
Compaction persists roots without resetting focus; resume/tree reset focus and
baselines. The follow-up executes mutation hooks, all four origins and
continuation requests, then compares real native local publications/outbox claims.
Actual model continuation and real Pi/Kiro UI remain unqualified. These rows
remain implemented-unverified; no H gate changes.

Independent cold-family comparison is an explicit failing opt-in gate in
`tests/fovea/reference-differential.test.ts`: even the unchanged reference
self-comparison differs in parser/async-read ordering and generation hashes.
The original green differential shared oracle-warmed facts (v17 now requires
an explicitly labeled fixture-only header transcode). Neither those
passes nor the two default-skipped cold cases certify independent extraction.
Two additional default cases now compare cold cores under FIFO source reads and
exact parser-byte replay, with no warmed facts or output sorting. This narrows
the gap to uncontrolled inputs; it does not close it. See
`cold-input-contract.md`. Two more default cases now execute the pinned parser
independently under a single-rule/one-thread schedule, retaining FIFO reads. Both
budgets match, with byte-identical reference repeats and no parser replay. This
also remains controlled-schedule component evidence; original production-batched
independent gates remain failed-unqualified. Feature/H statuses remain unchanged.

## Production batching follow-up (port 0.1.1)

`tests/fovea/production-batching.test.ts` and the additional strict differential
cases now verify **real native batched cold extraction**, without fixture source
queues or parser wrappers. Bounded ordered source publication and lossless
rule/source/position publication match the independently scheduled reference at
both budgets; all four complete output byte streams match per budget. Core
cache header 17 invalidates old scheduling-dependent facts. See
[production-cold.md](production-cold.md) for exact reports and input-contract
changes. This intentional determinism improvement closes the scoped production
batching task, not the uncontrolled pristine-reference or native-host gates.

## Platform and distribution follow-up

F09/F10 include shared descriptor policy and the generation-verified Darwin
native binding. Actual Darwin arm64 compilation, installed loading and explicit
analysis passed; historical Linux-only counts do not describe the current scope.
There is no pathname or `/dev/fd` fallback. Cross-session provenance and native
lifecycle evidence are tracked separately in [completion-ledger.md](completion-ledger.md).

F22 additionally executes `tests/fovea/historical-manager-migration.test.ts`,
registered in the dedicated installer/native bundle suite. Four actual
historical schema-1 → schema-2 admission/rollback/recovery tests pass; old-manager
maintenance after rollback remains incompatible with a retained schema-2 bundle.
Use trusted new management code without deleting new data. Signing/native-client
release gates remain unchanged. Current verification: [remaining-verification.md](remaining-verification.md).

Exact capability blockers: `docs/fovea/qualification.json`.
Separate claims: deterministic analysis, host lifecycle, functional controls,
native UI presentation, installed packaging, and task effectiveness.
No complete-parity or model-token saving claim is made.

Historical follow-up: source collector/default-off MCP probes passed, but no native delivery gate passed. H01/H02/H08 hit isolated authentication failure in the Linux harness. The current authenticated Darwin observations supersede that prerequisite blocker: H01/H02 lack supported session-to-MCP association and H08 has partial resume-identity evidence. The historical Linux report remains unchanged; explicit navigation does not qualify these gates. New bounded coverage and retained-read/rule inventory tests are listed in the machine-readable matrix. `ackClean` is an upstream UI-only notification (pinned index.ts), not model context; its native UI counterpart remains unqualified.
