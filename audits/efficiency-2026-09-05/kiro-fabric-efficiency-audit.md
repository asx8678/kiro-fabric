# Kiro-Fabric efficiency audit

Date: 2026-09-05. Scope: commit `d33cbdca33fac6ce301a6da884f06ee5141534da`, initially clean worktree. **Partial, evidence-based audit; required GLM route and live Kiro/billing qualification blocked.** No production modifications or claimed monetary savings.

## Decision

Fabric is demonstrably bounded and reusable in the local workloads tested. There is no evidence that it starts an MCP server per turn, automatically forwards whole conversations to workers, or performs billable inference itself. Its isolated guest, warm compiler, bounded discovery/results and durable workspace design should remain.

The largest **monetary** waste cannot be ranked: no comparable Kiro task billing was available. Confirmed context risk is silently degraded catalog information plus an unnecessary discovery example; confirmed measurement defects are overlapping-span subtraction and character fields labeled bytes. Memory acknowledgement/cleanup and queued workspace cancellation deserve correctness-first follow-up, not speculative savings claims. Compaction/session ownership is coherent in source and local process tests, but real Kiro compaction, conversation retention and resume are unproven here.

## Model routing and audit provenance

Astra established the evidence map before dispatch: context, lifecycle and economics, with at most two workers concurrently, no recursive delegation, one route-recovery retry for each of the first two packets. Scope/validation were separate actual Astra invocations. Parent identity also reports `openai-codex/gpt-6-astra`, thinking `medium`.

The model catalog listed exact `openai-codex/gpt-6-astra` and `zro/glm-5.3`. Invocation syntax was `agents.run/spawn({model: <provider/id>, thinking: "high", recursive: false, ...})`, in the audit harness only. Zro's local model cache maps `high` to `high`, `xhigh` to `max`, and disables unsupported intermediate settings; Astra's store supports low/medium/high/xhigh/max. No Flash/other-provider selector was requested.

**Critical routing discrepancy:** initial GLM launches with extensions disabled failed before inference (`Model "zro/glm-5.3" not found`). Enabling configured provider extensions on the one permitted retry yielded summaries labeled `zro/glm-5.3`, but every terminal assistant response identifies **`openai-codex/gpt-6-astra`**. Economics was stopped upon detecting this discrepancy. The earlier optimistic routing statement was corrected during the audit. The detailed reports are actual Astra work, NOT verified GLM-5.3 findings. No further substitution or route retry was attempted. This is an audit-harness blocker, not a kiro-fabric product defect; root cause remains unresolved without configuration changes. See sanitized response-level evidence in `audits/efficiency-2026-09-05/audit-invocation-metrics.json`.

Independent Astra subsequently reread source/raw evidence, corrected references, ran decisive tests, checked accounting and rejected counterexamples. Its 22 terminal messages independently identify Astra. Model agreement was not used as proof. Preliminary `context.md`/`lifecycle.md` reports retain original hypotheses; this report and `validation.md` supersede their rejected claims.

## Environment and observability

- Product/package: kiro-fabric 0.64.0; Node 24.20.0; pnpm 11.20.0; MCP SDK 1.30.0; QuickJS core 0.32.0. Audit harness: pi-fabric 0.82.8, pi-zro-provider 1.3.10. **Audit tooling is not a product dependency.**
- `kiro-cli --version` failed: executable absent from PATH; no configured `KIRO_CLI_PATH` or `KIRO_HOME`. No active installed Kiro agent/model, account plan, settings or installed-version behavior verified. README's historic qualification-client 2.21.0 is not this environment's observed version.
- Local `.pi/fabric.json` Astra compaction threshold 0.65 concerns the audit harness, not Kiro compaction. Product profile intentionally omits model. No global settings changed; no account/credential files exposed.
- Product traces are opt-in private bounded JSONL (`docs/tracing.md`), with lifecycle IDs, spans, character counts, failures and memory snapshots—not host payloads, model usage or credits. Trace drops/truncation must be treated as incomplete evidence. Existing audit documents are source/history, not current billing observations.
- Fresh `pnpm run build` and `node scripts/build-agent-dev.mjs` staged digest `0d8b999dd2085e68359b7c521f6a8911b4da1583a13935ef95c03fa205214dcb` before parent process tests. Final build is recorded separately. Tracked source remained unchanged.

## Actual request and ownership path

`user → Kiro system/profile + inherited resources + native tool schemas/history/summary → native tool OR fabric MCP tool → private Node stdio MCP server → verified workspace/cached runtime → isolated compiler worker → fresh QuickJS guest → ActionRegistry approval/schema/budget checks → artifact/memory/state/configured MCP provider → projection → MCP tool result → Kiro's next model request`.

Source map: `scripts/agent-profile.mjs:13–58`; `src/kiro/mcp-entry.ts`; `src/kiro/mcp-server.ts:createKiroMcpServer`; `src/kiro/runtime.ts:createKiroRuntime`; `src/execution-service.ts:FabricExecutionService`; `src/runtime/quickjs-runtime.ts`; `src/core/action-registry.ts`.

Exactly `fabric_info`, `fabric_workspace`, `fabric_exec` are outer tools. Native read/write/shell/web/todo/subagent work stays with Kiro; Fabric cannot invoke native tools. Downstream federation uses mcporter and configured transports, not assumed LLM subprocesses. Old private `power` names/salts are compatibility details: evolution to the native custom Agent is documented, not an accidental duplicate framework.

Kiro owns conversation, summary generation, logical session IDs and resume. Fabric owns process-local runtime and intentional workspace-durable memory/state. Same-workspace concurrent chats may share durable state by design; different verified workspaces remain separated. Never mirror the entire chat or treat historical approval text as authorization.

### Identity/lifecycle matrix

| Boundary | Identity/state expectation and observed evidence | Qualification |
|---|---|---|
| Ordinary turns/repeated exec | MCP PID + random instance + startup time stable; one cached runtime. Fresh guest per exec is NOT restart. Tests assert identity equality; library probe used one runtime for eight executions. | Local process/library, not Kiro turns |
| Manual/automatic compaction | Kiro generates summary. Gate requires three manual and one natural automatic cycle, unchanged MCP identity/generation, conversation-only fact recall and exact durable sentinel effects. | Synthetic gate tests only; no live compaction, pre/post tokens, cost or rereads |
| Same-process resume | No Fabric conversation-resume handler; unchanged transport/binding should retain runtime. | Host support unverified |
| New-process resume | New MCP instance/PID/start, initial generation; durable workspace memory/state restored, old artifacts unavailable. | Local crash/restart storage verified; actual Kiro `--resume-id`/summary restoration blocked |
| Explicit new session | Logical chat ID alone says nothing about process restart; workspace state not chat-scoped. | Host behavior unknown |
| MCP crash/restart | SIGKILL-after-commit recovery, continued writes, shutdown and orphan prevention tested. | Real local subprocess tests; not kill-during-publication or power-loss proof |
| Workspace switch | Verified identity (canonical path/device/inode), drain old runtime, generation 1→2 without new MCP instance; isolated A/B sentinels. | Local process tests; queued cancellation caveat F06 |
| Concurrent sessions | Two local MCP processes share one workspace safely; competing state revisions serialize. Different workspace data separated. | Local processes, not two authenticated Kiro chats |
| Cancellation | Linked signals/deadlines; drain before replacement, process shutdown watchdog. No automatic inference retry here. | Local tests; arbitrary remote side-effect quiescence not guaranteed |
| TTL expiry | Artifacts read/write sweep, explicit unavailable/expired response. Runtime loss invalidates transient IDs; root cache freshness verified separately. | Local tests; not durable transcript recovery |

MCP instance identity includes PID **and** instance/start to avoid PID reuse mistakes. Runtime generation is per MCP cached workspace runtime; guest exec/trace IDs are per call. Host ACP session/tool-call identities exist in real-client evidence, not Fabric storage namespaces or worker/task ownership. Actual Kiro session/worker/task IDs were unavailable; local process tests assert identities but do not retain a public per-event PID inventory. No independent startup counter was measured outside fixture trace assertions.

Compaction retention assertions currently qualify random conversation-only facts and exact calls, not the full requested ledger of constraints, decisions, failed approaches, unresolved work, pending calls and approvals. No repeated real summary-drift/cache-loss/recovery trajectory was measured. **Do not select a universal compaction threshold from this audit.**

## Baseline and accounting

Primary metric: **total comparable cost across all attempts / successfully completed comparable tasks**, alongside success rate and latency. Eligible end-to-end Kiro tasks here: 0; ratio **undefined**. Local assertion successes are not substituted into that denominator. Tokens and credits remain separate; no token→credit conversion, subscription multiplier, subscription allocation, price substitution or balance-delta estimate.

| Measurement | Result / limitation |
|---|---|
| Product Kiro credits, model tokens, payload/cache/reasoning, retries, compaction charges | Unknown, not zero; no host telemetry/account attribution |
| Zro token usage/provider spend | No verified Zro inference; billed spend unknown, not inferred zero from failed launch summaries |
| Other verified charges | None reconciled; unknown charges not excluded |
| Audit child overhead | 64 terminal assistant messages across seven launches; 251,073 input + 1,643,392 cacheRead + 0 cacheWrite + 25,574 output = 1,920,039 normalized total tokens. Reasoning 3,634 is already within output. |
| Audit cost | Harness estimate 5.142445 nominal USD, **not billed spend**. Includes stopped economics terminal messages and validation; excludes parent usage and any unseen in-flight/cancelled remote charges. Two pre-inference failures included as attempts. |

Preserve raw per-message usage: this harness reports uncached input separately from cacheRead; the observed equality above was checked on every terminal record. Do not apply that convention to raw Kiro/Zro payloads without verifying their semantics. Deduplicate only terminal assistant `message_end` events by run/offset/response identity; do not sum streaming updates, turn aggregates, tool messages and cumulative run counters again. Cost fields reflect local model-price tables (different cache rates with extension loading), not invoices. Original provider response usage/HTTP billing headers, delayed billing, account plan and unrelated account activity are unavailable. Therefore pricing sources used: **none**; local price metadata is explicitly non-authoritative. No paid task pilot or sweep ran. No applicable monetary cap was established from available product configuration; no cap was invented. Audit invocations were limited by the specified packet/concurrency/retry structure, not treated as free.

Audit inefficiency is itself visible: broad initial tool discovery produced a truncated ~118k-character result; leaf reports grew to ~15k characters each; model metadata was initially trusted too early; tool-shape/regex errors and three fixture-failure runs added local overhead. Parent inference cost is unavailable, so total audit cost is incomplete. These are not Fabric-product runtime measurements.

### Reproducible local workloads

Acceptance assertions were recorded before parent validation in `audits/efficiency-2026-09-05/acceptance.md`.

- Fresh build/stage, 14 targeted suites: **131/131 passed**, 15.26 s suite wall time. `local-tests.log`; exact command in acceptance/build evidence. Includes projection, strict API, catalog, approvals, admission/compiler/deadlines, tracing, storage, workspace and process/evidence gates.
- Independent Astra: six decisive suites **48 passed**, plus local MCP reuse/concurrency/restart **3 passed/7 skipped** (intentional selector); `validation-tests.log`, `validation-process-tests.log`.
- `node audits/efficiency-2026-09-05/probe-runtime.mjs`: fresh built library runtime, no Kiro/model/network. One cold request **352.506 ms**; five ordered warm requests **10.513–20.189 ms**; then one intentional unavailable-artifact failure **8.464 ms**, successful recovery **13.366 ms**. All assertions passed after correcting the fixture. One 120,000-character artifact exposes a default 12,000-character page, reduced inside guest to a 36-character JSON decision. This demonstrates bounded pagination/composition and retained runtime usability, NOT provider tokens saved. No randomized order or fresh-service comparator; warm observations correlated, dispersion descriptive only.
- Probe mistakes retained in metrics: two un-narrowed JsonValue compilation failures (one rerun to capture diagnostics), then incorrect full-artifact-length assertion. They are audit overhead, not product regressions. Final eight-call trajectory includes its intentional failure, not just cheapest success.
- `node audits/efficiency-2026-09-05/probe-analyzer.mjs`: synthetic matched baseline/candidate fixture, one sample each: overlapping parent self-time **−40→20 µs** (expected20), disjoint **50→50** (expected50), child beyond parent **70→90** (expected90). UTF-16 JSON string length4 vs UTF-8 bytes6 exposes unit error. Candidate exists only under audit directory. It combines interval accounting and text labeling, so no independent economic or performance effect is attributed to either. Missing/invalid timestamps still require production design; candidate is NOT merge-ready. Independent Astra reproduced these results.
- Long real chat with ≥2 compactions, new-host resume, interrupted checkpoint with host transport loss, native delegation failure/retry without duplicate completed work: **unperformed/blocked**. Synthetic compaction fixtures and local state failure tests do not satisfy these real workloads.

## Context inventory and area verdicts

Static method: Node UTF-16 `.length` and `Buffer.byteLength(...,"utf8")`, **no tokenizer** and no estimated billing tokens. `AGENT_PROMPT`: 1,567 chars/1,569 bytes; skill full file: 3,103/3,105 (body2,691/2,693); three tool descriptions591 chars. Prompt+full skill4,670 chars is an inventory sum, not observed context. Do not add body/full-file/config serialization rows together. Host system/native schemas, inherited steering/AGENTS/skills, bootstrap and active Strict envelope sizes are unknown; product exposes a strict checked envelope, not the audit harness's Strict instructions.

- **Prompt/discovery:** modest stable shipped prompt, some repeated routing advice. Health requested once near startup, not rearmed per turn/compaction. Info returns broad metadata and an action catalog; repeated info doesn't restart runtime. No evidence justifies removing verification. Catalog truncation needs honest disclosure.
- **Output/retrieval:** bounded head/tail output, recoverable paginated TTL artifacts, failure progress excluding arguments/results and warning against blind replay. Native file/log sizes and workers forwarding transcripts are Kiro-owned/unobserved. Application artifact pagination is already efficient.
- **Caches:** static prompt stable; health contains variable lifecycle/trace facts, but actual host prefix order/cache hits unknown. Compiler retains at most one idle worker30s, retires after250 uses; checker cache bounded4. MCP snapshot stat-key cache includes ctime/config/executable and recomputed environment digest (`src/kiro/mcp-provider.ts:745–768`); approval/use re-resolves path and rejects drift. `mcp.call` rediscovery verifies current schema intentionally. Don't replace freshness/permission checks with an eternal schema cache. Application cache hits ≠ provider billing discounts.
- **Execution:** admission4, provider concurrency8, calls64, approval/payload/audit limits; immediate excess rejection, no hidden execution queue. Bounded guest host-call queue is a different layer. No built-in model sweep/delegation/retry economics in product path. Polling observed in memory locking is local I/O, not inference; Kiro native retries/polling remain unknown.
- **Durability:** atomic publication/private files/version checks, explicit state postcommit acknowledgement, workspace concurrency and process restart tests are strengths. Memory has narrower error-reporting/cleanup semantics. Documented power-loss exclusion is not a defect.

## Findings register

Benefits below are conditional avoided work unless explicitly synthetic-measured; **no measured financial savings**. Confidence applies to source/test evidence, not frequency.

| ID / status / severity | Layer/owner; exact source | Reproduction/trace; root cause; frequency driver | Proposed change; correctness/latency risk | Benefit; confidence; validation |
|---|---|---|---|---|
| F01 confirmed / medium | Fabric discovery; `src/kiro/info-catalog.ts:3–23`, skill:20–25 | Catalog boundary tests pass while showing digest removal then prefix-only refs without completeness marker; scale-dependent | Add bounded total/returned/completeness/representation metadata and targeted recovery; maintain digest validation. API-shape compatibility risk | Fewer false completeness assumptions/retries, unmeasured; high; Astra code+local |
| F02 confirmed / low | Fabric guidance; `skills/fabric-exec/SKILL.md:20–25` | Example always lists actions just to return count although memory.get needs none; copied-example frequency unknown | Remove unnecessary list/count, qualify info catalog promise. Do not remove necessary downstream describe | One nested enumeration avoided per copied execution, not a top-level request or known token saving; high; code+local inventory |
| F03 confirmed / medium | Fabric telemetry; `scripts/analyze-trace.mjs:72–73,199`; `src/trace/tracer.ts:97–113` | Synthetic overlap subtracts child durations twice; chars labeled B | Union clipped intervals with invalid/missing timing marked unknown; relabel chars. Test serial/overlap/malformed. Candidate incomplete | Correct −40 to20µs fixture attribution and units, not faster runtime; high; independently synthetic-tested |
| F04 confirmed limit / medium | Fabric/Kiro observability; `src/execution-service.ts:283`, `src/kiro/mcp-server.ts:476–483`, docs/tracing | exec.end measures result value before projection; failures can report0 despite error text. Host billing absent | Add separately named visible UTF-16/UTF8 fields and explicit coverage metadata; privacy/storage overhead risk | Trustworthy denominator/attribution, savings unknown; high source; code reviewed |
| F05 plausible but unmeasured / medium | Fabric memory; `src/kiro/memory.ts:165–175,211–224` | Suppressed release failure with live owner metadata may strand namespace; fault not reproduced | Exact-owned pending cleanup retry + explicit acknowledgement; never remove foreign live locks. Concurrency risk | Avoid up-to5s acquisition waits/repeated failed writes when triggered; source bound only; medium-high; Astra code-only |
| F06 plausible but unmeasured / medium | Fabric workspace; `src/kiro/mcp-server.ts:396–401` | Prepared mutation queues without cancellation/closing recheck at commit; no churn trace | Recheck at serialized commit without weakening identity/approval/drain. Cancellation semantics risk | Avoid unintended binding/runtime churn, unmeasured; medium; Astra code-only, not bypass proof |
| F07 confirmed source asymmetry / medium | Fabric memory; `src/kiro/memory.ts:475,655–656,677–683`; state-provider:59–65,163–165 | Memory post-publication interruption lacks state's explicit committed acknowledgement; state tests don't prove memory | Explicit committed/read-before-retry result and reconciliation tests; transport loss still ambiguous | Fewer unsafe blind retries/overwrites, unmeasured; high source; Astra code-only |
| F08 plausible but unmeasured / low | Kiro/Fabric prompt; profile:13–23; skill:10–20 | Repeated routing prose, broad startup info, per-list schema conversion; loading frequency unknown | Measure effective payload and recovery before shortening; optional status detail only if fewer net calls | Unknown net context/cache/cost effect; low economic confidence; source only |
| B01 blocked / high audit validity | Audit harness routing; response-level metrics | Requested Zro metadata differs from actual Astra; stopped economics | Fix route verification outside product; do not silently rerun/substitute | Avoid wrong-route audit spend; cause unproven; terminal logs confirmed |
| B02 blocked / high qualification | Kiro/provider; real-client-evidence/driver | No installed client, payload/credits/account or live compaction evidence | Bounded authenticated exact-commit qualification with explicit spend cap | No savings claim; high confidence in evidence gap |
| R01 rejected | Projection/artifacts/config | min output1,000 > fixed hint209–212; reads default12k/max16k, pagination exists | Keep recovery behavior; small custom budgets may still require slicing | No default inaccessible-hint or whole-artifact spill loop; Astra code/local counterexamples |
| R02 rejected | Lifecycle documentation/gate | Three manual+one automatic satisfies ≥2 total structurally; config docs already disclaim power loss | Keep caveats; live full constraint-retention still required | No missing second-auto requirement or missing disclaimer defect; Astra source |

## Limits and next decision

This audit does not establish global optimality, unchanged model quality under prompt shortening, monetary payback, provider-cache savings, installed Kiro threshold behavior, live session continuity or complete crash-durability. Supporting worker hypotheses were not silently promoted into confirmed findings. No production candidate merged; isolated analyzer copy needs timestamp handling and separate regression gates. Prioritize correctness/measurement and honest discovery before prompt compression. See `kiro-fabric-efficiency-plan.md` and machine-readable metrics for gates, overhead and missing values.
