# Astra — lifecycle-only audit

## Scope and provenance

- Required and observed git toplevel: `/home/adam/projects/kiro-fabric`.
- Required and observed HEAD: `d33cbdca33fac6ce301a6da884f06ee5141534da`. Verified before any file inspection and again before reporting; no mismatch.
- Read `AGENTS.md` and `docs/architecture.md`. Ownership baseline: Kiro owns coding tools, conversation, compaction, resume and native subagents; Fabric is the private stdio server exposing exactly three tools. Durable workspace memory/state are not chat history. No Pi project dependency was introduced or assumed.
- Bounded inspection followed the named lifecycle paths, their directly relevant storage/approval/guest-context dependencies and named tests. Actual state implementation: `src/providers/state-provider.ts`, not `src/providers/state.ts`.
- `kiro-cli` was absent from PATH. No live client, network/model invocation, benchmark, delegation, dependency installation, configuration edit, production edit or commit was performed. No build or package script was run; this is an audit report, not a production change.
- The untracked `audits/efficiency-2026-09-05/` directory existed initially. This audit creates only `lifecycle.md`; other reports were not inspected or modified.
- Billing, client restart frequency and production latency are unknown. Test duration is not a performance benchmark or billing evidence.

## Findings

### L1 — Revalidate cancellation immediately at workspace mutation commit

**Priority:** medium. **Confidence:** high for missing check; medium for operational manifestation (static inspection only).

`src/kiro/mcp-server.ts:382-386` prepares a mutation with `extra.signal`, then submits its commit to the serialized lifecycle queue. The queued closure calls `binding.commitMutation` without rechecking cancellation or shutdown. `src/kiro/power/workspace-binding.ts:262-276` checks attachment cancellation around elicitation, but `commitMutation` at line 293 has no signal parameter. Select/detach preparation also has no cancellation check.

The filesystem identity checks remain substantial: attachment approval binds device/inode/ctime and commit revalidates them (`workspace-binding.ts:280-316`). This finding is about the lifetime of the request authorization, not a demonstrated filesystem-identity bypass. Cancellation after preparation need not prevent the later queued binding change. No cross-session approval cache was found.

**Frequency/cost driver:** cancelled binding mutations queued behind other lifecycle operations; frequency unmeasured. **Risk:** a cancelled operation changes the current workspace and may unnecessarily drain/replace a runtime. **Recommendation:** check request cancellation and server closing status inside the serialized mutation closure immediately before commit, retaining all identity and approval checks. **Benefit:** avoided unintended mutation/runtime churn is unmeasured. Named tests passed but do not establish cancellation during this queue interval; no reproduction was added or executed.

### L2 — Memory lock cleanup can silently strand a live namespace

**Priority:** medium. **Confidence:** high (source; fault not injected in this audit).

`src/kiro/memory.ts:211-224` suppresses every lock-release error. Reclamation at lines 165-175 deliberately refuses locks attributed to a live PID; normal acquisition times out after 5 seconds with 10 ms polling (lines 16-17, 195-198). A transient failure removing the owned lock can therefore leave an apparently successful mutation followed by repeated write failures while that process stays alive. There is no pending-cleanup retry comparable to `src/providers/state-provider.ts:283-289,343-345`.

**Frequency/cost driver:** rare filesystem cleanup errors, followed by every mutation to that namespace. Affected calls may consume the configured five-second lock budget; this is a source-derived bound, not measured latency. **Risk:** avoidable persistent write unavailability and retries. **Recommendation:** retain ownership identity for safe cleanup retries and surface cleanup/commit status; do not reclaim live foreign locks or relax serialization. **Benefit:** restored recoverability and avoided polling/retries unmeasured. `storage-failure` tests exercise the state recovery path, not this memory failure path.

### L3 — Memory post-commit interruption lacks an explicit committed acknowledgement

**Priority:** medium. **Confidence:** high (source; boundary failure not injected).

Memory publishes by rename at `src/kiro/memory.ts:475`, then checks the deadline/cancellation callback again at line 654 and in the lock wrapper at lines 206-209. Delete similarly unlinks at line 678 and checks again at line 683. These checks can throw an ordinary error after publication. `src/kiro/memory-provider.ts:61-63` returns these promises without adding a committed marker. By contrast, state explicitly tracks committed revision and throws `StateCommitAcknowledgementError` (`src/providers/state-provider.ts:61-66,163-165`).

**Frequency/cost driver:** cancellation/deadline crossing the publication boundary. **Risk:** ambiguous retry decisions; replay can repeat work or overwrite another same-workspace writer. Transport loss can always hide an acknowledgement, even after improving provider errors. **Recommendation:** give memory equivalent explicit committed/read-before-retry semantics while keeping cancellation checks and exact approvals. **Benefit:** fewer unnecessary retries and clearer recovery are unmeasured. The passing state post-commit cancellation test validates state only (`tests/storage-failure.test.ts:75`).

### L4 — Process-crash recovery is not power-loss durability proof

**Priority:** low, durability-contract limitation. **Confidence:** high for implementation difference; power-loss outcome unmeasured and filesystem-dependent.

`src/providers/state-provider.ts:246-255` fsyncs the temporary file, then renames it without syncing the containing directory. Memory attempts directory fsync but suppresses failure (`src/kiro/memory.ts:476-483`; delete: 679-682). Atomic visibility and recovery after killing only the MCP process are not equivalent to acknowledgement surviving an OS/storage crash.

**Frequency/cost driver:** acknowledged writes near a host/storage failure, not ordinary compaction. **Risk:** a stronger durability claim than evidence supports. The process regression kills Fabric after successful writes (`tests/mcp-process-lifecycle.test.ts:620`), not during publication or with a lock held. **Recommendation:** explicitly document this durability boundary or strengthen directory-sync/error semantics with committed-but-unconfirmed handling. Do not trade away durability for speed. **Benefit:** stronger recovery assurance, unmeasured; stronger syncing could add cost. No destructive host test was attempted.

### L5 — Requested lifecycle matrix exceeds the existing qualification gate

**Priority:** medium evidence gap, not a demonstrated Kiro defect. **Confidence:** high.

The relevant gate is `scripts/real-client-evidence.mjs:9-10`, which fixes three manual compactions but only **one** automatic compaction. The automatic object is singular in validation (`:276-299`) and the driver (`scripts/run-kiro-agent-real-driver.mjs:1129`). Thus the requested second automatic cycle is not represented. `tests/release-evidence.test.ts:1201` intentionally tests three manual/one automatic.

The gate positively requires same PID/instance/start/generation across compaction and a fresh PID/instance on later resume (`real-client-evidence.mjs:131-141,450-475`). It structurally binds ACP session IDs and unique tool-call IDs (`:550-554`). These are not Fabric task identities: no host-session or task identity is accepted/persisted by the inspected MCP/runtime API. Workspace storage sharing across chats is intentional, not a session isolation defect.

**Frequency/cost driver:** each release qualification and any continuity claim based on it. **Risk:** claiming complete repeated-auto, same-process resume or native-task continuity without observations. **Recommendation:** retain the strict gate and label absent matrix cells unknown; expand evidence only in a separately authorized live qualification. **Benefit:** improved evidentiary confidence only; no measured runtime or billing saving.

## Identity ledger

| Identity | Implementation / evidence | Conclusion |
| --- | --- | --- |
| MCP instance / PID / start / parent | `src/kiro/mcp-server.ts:54-56,335-340`; entry startup promise `src/kiro/mcp-entry.ts:18-22` | Random module-owned instance ID and stable process fields. Repeated calls do not themselves create another transport. Parent PID is not a logical host-session ID. |
| Inner runtime generation | `mcp-server.ts:218-221,276-289` | One cached runtime for verified binding; generation increases on replacement, not ordinary guest execution. Lazily created; `fabric_info` can initialize the first runtime. |
| Guest context | `src/runtime/quickjs-runtime.ts:380-383` | Fresh QuickJS context per execution; distinguish this from a Fabric process restart. Do not pool guest globals across tasks. |
| Workspace identity | `workspace-binding.ts:192-194,228-239`; `src/kiro/power/data-paths.ts:198-200,318-332` | Canonical path + device + inode drives binding/storage identity; display rootId hashes path only. Attachment additionally uses ctime at approval/commit. Persisted identity is validated. |
| Host session | `scripts/real-client-evidence.mjs:302-305,450-475` | ACP gate distinguishes session transitions and later resumed session; not a runtime storage namespace. No live identity observed here. |
| Task / tool-call | `real-client-evidence.mjs:550-554`; `mcp-server.ts:430-478` | ACP tool-call identity and optional trace execId are per-call evidence, not native Kiro task/subagent identity or durable approval. No native-task continuity proof. |

## Lifecycle matrix

| Boundary | Expected Fabric behavior / local evidence | Missing evidence |
| --- | --- | --- |
| Ordinary calls | Cached MCP/runtime; repeated identity equality asserted in process rebind test (`tests/mcp-process-lifecycle.test.ts:423`). Fresh guest each exec. | Real Kiro ordinary-turn process contract. |
| Manual compaction twice | Gate requires three manual cycles, unchanged MCP and generation, distinct conversation-only facts and exact post-cycle calls. | No live compaction executed. Local validator tests are synthetic fixtures, not observed compaction. |
| Automatic compaction twice | Gate covers one natural-pressure cycle; no setting mutation allowed. | Second automatic cycle absent; first also not live-verified here. |
| Same-process resume | If transport/binding remains, cache persists; Fabric has no resume handler or conversation restoration API. | No decisive same-process host-resume qualification identified. |
| New-process resume | Gate requires new MCP identity, generation 1, restored durable sentinels and unavailable prior artifact. Independent-runtime/process tests support durable stores. | Authenticated `--resume-id` and restored Kiro conversation/summary not observed. |
| New session | Durable workspace data intentionally shared; no Fabric chat/task namespace. MCP restart depends on host behavior. | Actual Kiro session-to-process behavior unknown. |
| MCP crash | Passing local SIGKILL-after-commit test restores exact memory/state in new PID/instance and continues writing. | Kill during lock/publication, OS crash and power loss not covered by that test. |
| Workspace switch | Passing process test drains a pending approval and changes generation 1 → 2 without replacing MCP identity; A/B durable sentinels stay separate. | Real Kiro roots notification behavior; queued mutation cancellation (L1). |
| Concurrent workspaces/chats | A/B isolation plus two concurrent MCP PIDs sharing one workspace, both memory writers and competing state revision, tested locally. | Two live Kiro sessions and native task identities not observed. |
| Cancellation / teardown | Executions receive linked cancellation; service aborts and awaits execution closure. EOF, signals, abnormal stdin and abrupt parent death tests pass, including real local stdio descendant. | Not comprehensive proof that all provider cancellations quiesce; no live Kiro cancellation. |
| Artifact TTL / runtime loss | `src/kiro/artifacts.ts:100-117`: read/write sweep, idle TTL, explicit `artifact is unavailable or expired`; process-local map never imports another process's files. TTL/read and separate-store behavior tested. | Real resume missing-artifact result remains gate-only. TTL is artifact expiry, not durable memory/state expiry. |
| Roots TTL / transient miss | `workspace-context.ts:67,99-100`: 30-second healthy cache; failures preserve roots but are marked stale, retried on subsequent calls. Server blocks client-root execution and drains unverifiable runtime (`mcp-server.ts:253-263`). | Production roots-failure frequency/latency unknown. Repeated failures may cost repeated discovery (2-second RPC timeout), but do not justify trusting stale roots. |

Shutdown detail: inner drain waits for actual settlement after its initial bounded wait (`mcp-server.ts:231-239`), preserving isolation instead of running old/new runtimes concurrently. Process entry supplies the outer 8-second shutdown watchdog (`mcp-entry.ts:6,59-71`). A queued workspace switch is not itself protected by that process-exit watchdog. No recommendation here weakens quiescence, cancellation, approval or workspace verification.

Schema recovery detail: state validates exact schema/version, revision and entry bounds (`state-provider.ts:193-229`); memory validates ownership/version/scope/value bounds (`memory.ts:424-450`). Malformed persistence fails closed rather than silently becoming empty state. Missing state returns an empty document; missing memory returns null/provider `found:false`. Compatible workspace migration uses staging and identity validation (`data-paths.ts:287-315`), not import of old transient artifacts or approvals. Corruption repair beyond these checks was not tested or inferred.

## Tests actually run

```sh
pnpm exec vitest run tests/mcp-process-lifecycle.test.ts tests/workspace-binding.test.ts tests/artifacts-state.test.ts tests/storage-failure.test.ts tests/release-evidence.test.ts --no-cache
```

Result: **5 files passed, 69 tests passed**, duration **7.45 s** (tests 6.00 s), Vitest v4.1.11. No extra test files, package-script build, install or real driver invocation.

Important provenance limitation: `tests/mcp-process-lifecycle.test.ts:18-19,32` launches the pre-existing `.tmp/kiro-fabric-agent/runtime/kiro/mcp-entry.js`, not freshly compiled source. That staged bundle existed and the suite passed, but this audit did not establish its exact-commit build provenance or rebuild it. The other four selected suites import source/helpers. Hence distinguish source findings, local staged-process behavior, synthetic evidence-validator checks, and **unperformed live Kiro qualification**. All proposed efficiency/recovery benefits remain unmeasured; billing remains unknown.
