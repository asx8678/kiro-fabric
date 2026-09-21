# Deterministic compaction: scope and implementation plan

**Status: implementation started — Track A declaration checkpoints and explicit host-observed capture are implemented, disabled by default.**

Current slice: strict records, deterministic rendering, private durable CAS storage, eight checked `continuity.*` actions, execution-local receipts, and focused tests. See [current behavior and limits](configuration.md#deterministic-task-recovery-opt-in). This covers P1–P3 and the reachable P4/P5 wiring, not automatic recovery or Track B. `captureCurrentExecution` records a settled host prefix; it does not replace `/compact`. The rest of this document retains qualification gates; component tests do not qualify Kiro compaction.

First-slice explicit handoff and managed-rotation foundation (`continuity.handoff`, read-only ACP preflight and capability probe, private original-event archive and crash-safe rotation journal): see [continuity-handoff-plan.md](continuity-handoff-plan.md). Offline fixtures do not pass the live gates; automatic managed rotation stays unavailable.

Repository baseline: `7846af7`, `kiro-fabric` 0.64.0. Host revalidation against **Kiro CLI 2.22.1** and public docs (2026-09-21): hook triggers remain Prompt Submit, Stop, Session Start/Agent Spawn, Pre/Post Tool Use, and file/spec events — there is still **no PreCompact / session_before_compact replacement-summary callback**. ACP `_kiro.dev/compaction/status` remains a progress notification, not a summary-injection API. Pi Fabric (`04871f59493670bf2b1960df0d8f5fcd93978b0f`) still owns LLM-free conversation compaction through `session_before_compact`. Track A in this repo is the reachable equivalent; Track B stays blocked. Client docs are not authenticated end-to-end qualification.

## 1. Decision and deliverables

There are two different products, not two names for the same feature:

| Track | Deliverable | What it does not establish |
| --- | --- | --- |
| **A — deterministic continuity (recommended first release)** | Explicit, durable task checkpoints and reproducible recovery summaries from admitted facts and selected host-observed operation receipts. Works through the existing `fabric_exec` tool. | Does not replace Kiro's summary, remove messages from context, eliminate native compaction inference, or guarantee automatic recovery. |
| **B — native deterministic compaction (host-gated)** | Replace the active conversation prefix with a deterministic summary and a closure-safe recent tail, without a summarization model call. | Cannot be delivered merely by adding an MCP provider or a prompt hook. Requires a verified host context-replacement contract. |

Approve the target at **P0** before runtime implementation. Track A is a useful compatible increment, **not completion of a requirement to replace `/compact` or automatic compaction**. If only Track B is acceptable, stop at its host-capability gate instead of silently shipping A as a substitute.

The recommended sequence is: agree the contract, implement A as opt-in, qualify it, and reuse its pure projection core if B becomes supportable. A separate ACP launcher is an alternative product scope, not a hidden fallback in the installed agent.

## 2. Observed baseline and gaps

| Evidence | Consequence for the work |
| --- | --- |
| [Architecture](architecture.md#session-and-process-lifecycle) assigns conversation history, compaction and resume to Kiro. | Preserve this ownership statement until an actual host adapter is qualified. |
| [Runtime registration](../src/kiro/runtime.ts) exposes coding, memory, state and other providers, but no compaction control. | A new provider needs real registration, discovery and checked guest integration; a standalone renderer is not an integrated feature. |
| [FabricCallAudit](../src/core/action-registry.ts) records refs, outcomes and bounded diagnostics, not original arguments/result bodies. | Existing audits cannot reconstruct Pi-style file/evidence history unchanged. Add a narrow typed observation path, not bulk audit logging. |
| [Execution service](../src/execution-service.ts) already owns per-execution admission, settlement, deadlines and audits. | Capture a bounded execution-local receipt prefix here; do not infer actions from guest source or returned prose. |
| [MCP server](../src/kiro/mcp-server.ts) creates trace execution IDs conditionally on tracing. | Continuity identities must be host-issued independently of debug tracing. An execution ID is not a Kiro chat ID. |
| [StateProvider](../src/providers/state-provider.ts) supplies bounded, locked, compare-and-set persistence and committed-but-unacknowledged errors. | Reuse these storage semantics in a private continuity store rather than build another journal engine initially. |
| [Workspace data paths](../src/kiro/power/data-paths.ts) bind storage to verified workspace identity. | Never select state by guessed cwd, most-recent chat, or a caller-supplied filesystem root. |
| [First-prompt hook](../src/kiro/first-prompt-hook.ts) injects startup guidance once. | It is not an after-compaction hook. Do not extend it into an unverified compaction detector. |
| [Turn-contract analysis](turn-contracts.md#why-common-shortcuts-are-insufficient) documents that the inspected Stop-hook input did not include a final answer/transcript. | A Stop hook cannot be assumed to provide complete source history or an idle context-replacement boundary. |
| [Artifacts](../src/kiro/power/artifacts-provider.ts) have explicit ephemeral checkpoint handles. | Keep `artifacts.checkpoint` unchanged; its TTL/process-local data is not durable continuity storage. |

The public [hook reference](https://kiro.dev/docs/hooks/) describes event actions, and [command stdout](https://kiro.dev/docs/hooks/actions/) adds context. The documented [ACP compaction status](https://kiro.dev/docs/cli/acp/) is a notification. The installed v3 TUI delegates compact requests to `_kiro/session/compact`, forwarding an optional `value`; this is **not evidence that `value` accepts a replacement summary**. No supported replacement-summary callback has been verified. Do not generalize this finding into a claim about every undocumented Kiro internal or future version.

## 3. Track A scope

### Included

- A dependency-light deterministic projection core over versioned typed records.
- Explicit task creation and checkpoint publication, with normal write approval.
- Caller-declared objectives, constraints, decisions, open checks and next steps, labelled as declarations.
- Optional capture of the current execution's closed prefix of host-observed operations at checkpoint time.
- Durable, workspace-bound task storage; mandatory revision checks for updates/deletion.
- Bounded recovery, metadata listing and exact expansion of **admitted records**.
- Checked guest APIs, discovery, disabled-mode behavior, documentation and hermetic lifecycle tests.

### Excluded from this release

- Replacing or triggering Kiro `/compact`, changing `chat.disableAutoCompaction`, or claiming reclaimed context tokens.
- Automatic full-conversation logging, private Kiro session-file parsing or rewriting, or importing arbitrary transcripts.
- Automatic checkpoint publication on every tool call, exception, Stop hook or process shutdown.
- Automatic selection of the newest task, automatic chat/branch association, or cross-chat restoration based on cwd alone.
- Injecting a full checkpoint on every prompt/tool response. Repeated additive injection is not compaction and can increase context use.
- Copying the complete Pi extension, its memory database, token estimator, branch hooks, thresholds, agents or mesh into Kiro Fabric.
- A second model-visible tool, native-tool fallback, weakened approval boundaries, or changed top-level `fabric_exec` fields.
- Semantic proof that a task is correct, source-losslessness for unrecorded work, or a tamper-proof store against arbitrary same-user host commands.

**Loss contract:** deterministic recovery is lossless only for the selected, admitted bounded records retained in the store. Projections are lossy views with omission addresses. Uncheckpointed executions, conversation-only constraints, full tool output, thinking, and deleted records are not recoverable through this feature. The last saved checkpoint cannot prove that later effects did not happen.

## 4. Recommended architecture

```text
explicit declarations       host execution-local receipts (optional)
          \                         /
           strict validation and provenance separation
                              |
               approved checkpoint + revision CAS
                              |
       private workspace/task store of original typed records
                              |
              pure project -> bound -> render
                              |
        continuity.read / continuity.expand via fabric_exec
```

### Identity and provenance

- Use the verified workspace identity plus an opaque host-generated task ID. Task IDs are selectors, not secret authorization tokens or Kiro session IDs.
- Different tasks in the same workspace remain separate. Deliberate sharing of one task is possible, with revision conflicts rather than last-writer-wins overwrites.
- Every admitted record has a schema version, stable record ID, persisted sequence and provenance (`declared` or `host-observed`). Persist any source timestamp once; never generate timestamps, IDs or filesystem observations while rendering.
- Guest input cannot populate `host-observed` fields. A model-supplied statement that a test passed remains declared, even if it resembles a receipt.
- Preserve operation status, dispatch state, and effect certainty separately. A committed mutation with failed acknowledgement is not an uncommitted failure. A failed/cancelled shell is not rollback.
- A successful settled tool call is not necessarily a successful command: inspect typed exit status for `local.shell`/`probe.run`, including `settle:true`. Do not parse output text to invent test counts or commit IDs.
- Receipts represent historical observations, not current filesystem truth. Revalidation is a new approved operation, not a side effect of rendering an old checkpoint.

### Capture boundary

Maintain a bounded in-memory observation buffer per execution only when continuity is enabled. Assign operation order at host admission and finalize receipts after invocation and cleanup settle. Project through an allowlist of provider-specific fields: operation identity, trusted outcome, workspace-relative paths, available source hashes, numeric exit status, commit acknowledgement and effect uncertainty. Do not persist code, payloads, file bodies, raw shell command text, arbitrary arguments, raw errors or downstream MCP contents by default.

An explicit checkpoint can request `captureCurrentExecution`. It freezes a well-defined sequence prefix and rejects capture if an earlier selected operation is still in flight. Exclude the checkpoint's own call and all later operations. No promise of whole-execution coverage is made if more work follows the checkpoint. Expose the captured-through watermark and omissions/unsupported-operation counts. Deduplicate repeated capture of the same host execution/operation identity; never merge separate executions merely because their arguments or labels look alike.

A capture bookkeeping limit or failure must not turn a completed provider mutation into an apparent rollback. Mark capture coverage incomplete; reject a purported complete checkpoint or publish an explicitly incomplete one according to the P0 contract. The recommended default is to reject capture publication on internal recorder failure, while preserving ordinary provider results and the prior durable checkpoint. Do not replay effects to repair capture.

There is no implicit persistence of this buffer. Persistence occurs only through the approved checkpoint action. If an execution dies before publication, recovery reports only the last committed checkpoint and unknown subsequent work. Continuous crash-durable operation journaling is a separate scope with its own authorization and start/terminal-record protocol.

### Storage reuse

Use a provider-owned storage adapter around a **separate private StateProvider instance** under the verified project's continuity directory. Do not register that instance as public `state`, and do not store trusted receipts in arbitrary guest-writable `state`/`memory` keys. Reuse the existing owned-file, locking, atomic publication, deadline and post-commit acknowledgement behavior. Preserve existing public state behavior.

A task value holds the original typed records and checkpoint publication metadata. Appends require the exact observed revision; validate a read/modify/write against that revision at commit. Do not assume revisions are contiguous per task: the existing state backend uses document-level revision numbering. Reject malformed/unknown schemas and exhausted quotas without resetting the store or deleting source records. If implementing byte quotas requires a storage change, enforce them inside the existing mutation lock and regression-test all state users.

Record a checkpoint request identifier and canonical request identity to resolve uncertain publication. Reuse identifies the already committed publication or conflicts on changed content; it never authorizes rerunning prior tool effects or silently capturing a different invocation. Read before retrying after cancellation or a lost acknowledgement.

Retain original admitted records until explicit approved deletion or quota rejection; do not reclaim space by replacing them with rendered summaries. Hashes bind references to a revision/snapshot and detect mismatches; they are not cryptographic attestations against an actor with authorized host filesystem access.

### Projection and output

- Fixed section order: objective, constraints/decisions, observed operations, unresolved work, next steps, coverage/source pointers.
- Fixed schema/projector versions, code-unit ordering (not locale-dependent sorting), canonical serialization and Unicode-safe UTF-8 limits.
- Same persisted records, projection version and limits produce identical bytes. Model-selected declarations and nondeterministic executions are inputs, not deterministic processes.
- Recompute from original records, never a previous rendered summary. Treat quoted declarations/results as data, not higher-priority instructions.
- Use deterministic earliest/latest sampling where a collection exceeds its section budget. Preserve omission counts and record ranges; never silently discard coverage metadata to fit.
- Distinguish a later successful retry of an exact operation from semantic resolution of an open task check. Where retry identity is needed, retain a host-computed canonical identity digest, not raw command/argument bodies; refs or labels alone cannot resolve a failure. Unsupported identities remain unresolved. Explicit check-resolution declarations do not become host-verified correctness.
- Expansion reads exact admitted typed records, not arbitrary files or raw pre-compaction conversation. Refuse stale revision/hash pointers rather than following a different source silently.
- Do not copy Pi's 32 KiB summary, 20K-token tail or 65% occupancy ceiling into A: the MCP layer has no authoritative model-context budget and is not selecting a raw conversation cut.

## 5. Proposed API and configuration

The six names below are registered for the first declaration-only increment; the table describes the broader target contract. In particular, optional current-execution receipt capture is **not yet available**. Consult the [implemented contract](configuration.md#deterministic-task-recovery-opt-in) before use. Keep schema, registration, guest declarations and runtime dispatch mechanically aligned as remaining phases land.

| Action | Risk | Contract |
| --- | --- | --- |
| `continuity.create` | write | Create a task from bounded explicit objective/constraints; return opaque task ID and revision. |
| `continuity.checkpoint` | write | Publish bounded typed declarations and optionally the current execution's closed receipt prefix. Require task ID, expected revision and publication request ID. Return revision, content hash and coverage. |
| `continuity.read` | read | Render a selected task deterministically; optionally require the expected current revision. Return summary, hash, limits and coverage. No task execution or context replacement. |
| `continuity.list` | read | Bounded task metadata and explicit completeness information, not values. Caller/user chooses a task; no automatic newest-task selection. |
| `continuity.expand` | read | Page admitted record ranges using task ID, expected revision and snapshot hash. Changed/deleted sources produce explicit stale/not-found results. |
| `continuity.delete` | write | Delete a selected task only through existing write approval and expected-revision validation. |

The plain `continuity` guest facade remains behind `fabric_exec`; do not add an outer MCP endpoint or a `compact.request` alias that suggests host control. Keep `code`, `payloads`, `resultFormat`, and `timeoutMs` as the complete outer request key set.

Proposed conservative limits, to lock down in P0 and test at byte boundaries:

| Setting/bound | Initial proposal |
| --- | --- |
| `continuity.enabled` | `false`; explicit operator opt-in |
| `maxTasks` | 32 per verified workspace |
| `maxTaskBytes` | 128 KiB for each complete serialized task value |
| `maxTotalBytes` | 4 MiB for the complete continuity store, including envelope overhead |
| `maxSummaryBytes` | 8 KiB rendered summary; hard supported maximum 16 KiB |
| Record/receipt/string/depth limits | Finite independent limits, finalized alongside the schema; no unbounded nested JSON |

All replies must also fit the existing serialized nested-result and visible-output allowances, including escaped JSON, pointers and mandatory coverage fields. Paginate expansion; reject an impossibly small budget rather than silently cutting the recovery footer. No automatic eviction of source facts to keep accepting writes.

Disabled mode creates no continuity store or recorder, performs no extra writes, and reports the provider unavailable. Adding optional configuration must preserve existing config files and fail closed for unsupported values/versions; update file-key allowlists as well as runtime defaults/normalization. Disabling collection leaves existing data untouched; deletion is an explicit operation. An uninstall/retention policy must not accidentally erase it.

## 6. Work breakdown and file-level changes

New paths in this section are planned files, not existing modules. Keep implementation dependency-light; port the useful algorithmic rules, not the Pi runtime. Preserve applicable MIT notices if implementation text is copied from Pi Fabric.

| Phase | Deliverables and primary files | Exit gate |
| --- | --- | --- |
| **P0 — contract and target** | Approve A vs B; freeze loss model, provenance, capture completeness, schema/bounds, publication idempotency and data retention. Confirm supported-host findings against the intended Kiro release. | Written target decision. If B-only and no replacement contract is demonstrated, stop with a specific dependency/blocker. |
| **P1 — pure core** | New `src/continuity/records.ts`, `projection.ts`, `render.ts`; synthetic raw-record fixtures. Strict input guards, canonical encoding, sampling, hashes and expansion pointers. | Determinism, bounded Unicode, poison-summary exclusion and truthful coverage tests pass. No host imports or model/network calls. |
| **P2 — durable task store** | New `src/continuity/store.ts`; reuse `src/providers/state-provider.ts` / `owned-file.ts`; extend verified paths in `src/kiro/power/data-paths.ts`. | CAS, concurrent writers, restart, corruption, quota and committed-but-unacknowledged tests pass without regressions to public state. |
| **P3 — typed execution receipts** | New `src/continuity/execution.ts`; narrow host-only context in `src/protocol.ts`; integrate at `src/core/action-registry.ts` and `src/execution-service.ts`. | Capture works with tracing off, respects settled-prefix boundaries, cannot accept guest-forged observations and never changes provider effects/results on observer failure. |
| **P4 — usable provider** | New `src/providers/continuity-provider.ts` and `continuity-contract.ts`; wire `src/config.ts`, `src/kiro/runtime.ts`, `src/kiro/mcp-server.ts`, `src/runtime/guest-types.ts`, `src/runtime/guest-bootstrap.ts`. | Every proposed action is discoverable, schema-validated and callable through checked guest code; unavailable when disabled/unbound; normal approvals remain authoritative. |
| **P5 — recovery UX and qualification** | Update `skills/fabric-exec/references/api.md`, `recipes.md`, `workflow.md`, `docs/configuration.md`, `architecture.md`, `audit.md` and a short README link. Regenerate `src/kiro/generated-guidance.ts` using the build, not hand edits. Extend hermetic lifecycle coverage and, only with authorization, release qualification. | Built-package create/checkpoint/read/expand/delete and new-process recovery pass; docs distinguish A from native compaction. Live claims remain gated. |

Dependencies: `P0 -> P1 -> P2`; P3 follows the P1 record contract and can proceed independently of the P2 store. P4 joins P2/P3. P5 requires P4. Each implementation slice finishes with targeted tests and a fresh build; no phase is declared complete from build success alone.

**Expected review surface:** execution settlement/approvals, protocol types, guest declarations/bootstrap, configuration, workspace data paths, runtime lifecycle and output budgets. The prospective graph also points to compiler-cache, catalog and MCP-provider regressions: inspect these neighbors, but do not refactor them merely because they are adjacent. `src/kiro/info-catalog.ts` should need tests for the extra descriptors, not a new discovery framework.

Do not change `scripts/agent-profile.mjs`, the first-prompt hook, or the outer exec contract to manufacture automatic recovery in A. Add a minimal guidance reference only if it is required and covered by the existing prompt-size/contract tests. No mandatory per-turn health-check or checkpoint ritual.

## 7. Acceptance ledger and verification

| ID | Required evidence |
| --- | --- |
| A1 — deterministic bytes | Repeated renders of identical stored input, including different process clocks/timezones, produce identical summary/hash. 100 checkpoint/render cycles preserve sampled original facts without consuming rendered summaries. |
| A2 — honest loss/bounds | Unicode, escaped JSON, oversized collections and tiny output limits respect complete-envelope bounds; omitted ranges/counts remain addressable. Unrecorded conversation is never described as retained. |
| A3 — provenance | Forged guest `verified`/`host-observed` fields are rejected. Provider errors, denied/not-dispatched calls, nonzero settled exits, partial effects and commit acknowledgements stay distinct. |
| A4 — capture closure | Parallel/delayed operations cannot be split into fabricated completed receipts. The selected prefix is settled and excludes the checkpoint itself/later work. Disabled tracing does not disable identity or capture. |
| A5 — durable publication | Two processes updating one revision produce one winner and one explicit conflict. Kill/restart and acknowledgement-loss probes recover exact committed data without replaying tools. |
| A6 — identity and source integrity | Separate workspace identities/tasks cannot collide. No guessed chat or newest-task selection. Stale revision/hash, unknown schema, corrupt file, symlink/hardlink and unsafe ownership fail closed. |
| A7 — retention/privacy | Quotas include storage/envelope overhead and fail before publication. No raw code, payloads, arbitrary tool bodies or raw diagnostic errors in automatic receipts/traces. Explicitly supplied facts remain potentially sensitive. |
| A8 — public reachability | Six action descriptors, risk classes, guest types/facade, registry wiring and configuration allowlists agree. Checked TypeScript direct calls and dynamic `tools.call` both work. Exactly one outer model tool remains. |
| A9 — opt-in compatibility | Disabled mode has no recorder/store writes; existing memory/state/artifact semantics and outer exec keys remain unchanged. Approval denial, cancellation and workspace changes preserve their existing guarantees. |
| A10 — end-to-end recovery | Checkpoint selected facts in one MCP process; terminate it; start a different process with the same verified workspace; explicitly read the same task and expand exact records. Wrong workspace/task selection is rejected or requires explicit selection. |
| A11 — host claim separation | Component tests never claim native compaction interception, same-PID survival through Kiro compaction or automatic reinjection. Those require exact-client evidence. |
| A12 — shipped artifact | A fresh `pnpm run build` and a direct built-runtime/provider probe succeed. Before committing, `pnpm run check` succeeds using trusted Node where installer checks require it. |

Planned focused suites: `tests/continuity-core.test.ts`, `continuity-store.test.ts`, `continuity-execution.test.ts`, `continuity-provider.test.ts`, and `continuity-lifecycle.test.ts`. Select the relevant suite per implementation slice; do not repeatedly rerun unchanged passing suites.

Existing regression suites to select when their paths change:

- Storage: `tests/state-reliability.test.ts`, `storage-failure.test.ts`, `owned-file.test.ts`, `workspace-binding.test.ts`.
- Capture/policy: `tests/action-registry.test.ts`, `execution-admission.test.ts`, `local-effect-queue.test.ts`, `structured-recovery.test.ts`, `approval-quotas.test.ts`.
- Integration: `tests/configuration.test.ts`, `strict-bootstrap.test.ts`, `fabric-exec-contract.test.ts`, `info-catalog.test.ts`, `compiler-cache.test.ts`, `guidance.test.ts`, `mcp-process-lifecycle.test.ts`.
- Output and package: `tests/result-budget.test.ts`, `mcp-projection.test.ts`, `package-boundary.test.ts`; run the built-package direct probe after the final build.

Example verification sequence after implementation (the planned test files do not exist yet):

```sh
pnpm exec vitest run tests/continuity-core.test.ts tests/continuity-store.test.ts
pnpm exec vitest run tests/continuity-execution.test.ts tests/continuity-provider.test.ts tests/continuity-lifecycle.test.ts
pnpm run typecheck
pnpm run build
# Run the built-runtime continuity probe added in P5.
# Before committing, use trusted Node as documented in AGENTS.md:
pnpm run check
```

Authenticated Kiro checks require separate explicit authorization, an enforceable numeric inference/spend budget and stop conditions. Do not borrow/copy normal credentials into fixtures. Extend `scripts/run-kiro-agent-real-driver.mjs` and `scripts/real-client-evidence.mjs` only when qualifying actual host behavior. A fact deliberately stored in continuity tool data must **not** satisfy the existing conversation-only fact retention gate; report the two forms of evidence separately. No authenticated Kiro inference was run for this plan.

## 8. Track B: requirements before native implementation

A native adapter is viable only after a supported, version-qualified host contract demonstrates all of the following:

1. Authoritative session/branch identity and an ordered raw active-path event source, including retained history across repeated compactions.
2. A safe boundary after relevant work settles, plus cancellation and in-flight-compaction coordination; a generic Stop event alone is insufficient.
3. The ability to provide the replacement summary **and** kept-history boundary, suppressing the native model summarizer for manual and automatic compaction.
4. Atomic persistence/reload of that checkpoint and the source references. No rewriting of private Kiro files while the host owns them.
5. Context usage, model window and response-reserve information sufficient for a conservative budget. Fixed system/tool overhead, estimator uncertainty and overflow recovery must be tested.
6. A closure-safe tail in both call/result directions, with compact-all or explicit refusal when no safe cut fits. Repeated compaction must not replay old summaries alongside the new one.
7. Exact-release lifecycle and resume tests, including repeated manual cycles and a natural automatic cycle, proving the selected engine was used without a summarization inference call.

Then implement a Kiro host adapter over the shared pure core, add a real `compact` control surface only if the host can honor it, and provide a safe rollback/default-engine path. Track B additionally requires a source-retention/privacy policy for actual conversation history; A's selected task records cannot substitute for that source.

**Stop/go gate:** if these capabilities cannot be demonstrated, record the missing host API and stop B. Do not claim support from a TUI parameter, a hook's context injection, a notification, synthetic tests, or undocumented binary behavior. Do not patch installed Kiro binaries or widen Fabric authority to fake support.

### ACP launcher alternative (separate approval required)

A launcher/proxy can potentially create fresh Kiro sessions seeded with deterministic checkpoints. That is **session rollover**, not same-session native compaction. Scope must separately cover:

- Capture/provenance for the complete relevant event stream and durable logical-to-physical session mapping.
- Explicit initialization, resume, forks, queued prompts, tool settlement, cancellation and crash recovery.
- Permissions, selected agent/model, workspace identity and MCP process lifecycle across rollover.
- Verified control of native automatic summarization; intercepting a manual ACP command does not intercept internally triggered compaction during a long autonomous turn.
- Opt-in deployment, upgrade compatibility, cleanup and rollback of the launcher, without changing ordinary Kiro settings globally.

The current same-PID continuity contract may no longer hold. Revisit that product contract explicitly; do not disable the existing qualification gate just to make this alternative pass. Do not promise native-compaction cost savings until both automatic-path control and context replacement are demonstrated.

## 9. Effort, risks and implementation start gate

Track A is a **medium, cross-cutting change**, roughly six reviewable slices above, not a drop-in copy of Pi's renderer. A provisional planning allowance is 2–3 engineer-weeks including failure/lifecycle tests and review, excluding externally authorized live qualification. Re-estimate after P0/P1, especially if storage reuse needs a shared primitive extraction. This is not a delivery commitment.

Track B has an unresolved host dependency and should not be estimated as a bounded implementation until its capability spike passes. The ACP alternative is materially larger than A and needs its own design review.

Primary risks and controls:

- **Scope substitution:** keep A and B acceptance criteria separate and obtain the target decision first.
- **False certainty:** declared facts, observed effects, historical freshness and incomplete coverage stay explicit.
- **Storage growth/source loss:** hard quotas and approved deletion, never summary-of-summary reclamation.
- **Capture races/partial effects:** closed-prefix snapshot, CAS publication, committed-state acknowledgement and read-before-retry.
- **Cross-chat leakage:** verified workspace plus explicit task selection; no inferred chat identity. Workspace sharing is not per-chat access control.
- **Context bloat:** bounded on-demand reads, not repeated automatic full-summary injection.
- **Privacy/prompt injection:** narrow receipt allowlists, private storage, user-controlled declarations labelled as data, and no raw trace expansion.
- **Unverifiable live claims:** preserve authenticated release gates, inference budgets and source-separated evidence.

Implementation may start when the operator approves the target, opt-in/default behavior, admitted data/retention policy and P0 API contract. This plan authorizes no runtime changes, installed-host modifications or authenticated inference by itself.
