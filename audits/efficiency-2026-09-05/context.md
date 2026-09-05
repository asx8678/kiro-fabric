# Astra context-efficiency audit

## Provenance and boundaries

Verified before reading project content: `git rev-parse --show-toplevel` was `/home/adam/projects/kiro-fabric`, and HEAD was exactly `d33cbdca33fac6ce301a6da884f06ee5141534da`. Read `AGENTS.md` and `docs/architecture.md`. Initial status already contained an untracked `audits/efficiency-2026-09-05/` directory; no other reports were read or changed.

Audit scope: `scripts/agent-profile.mjs`, `skills/fabric-exec/SKILL.md`, `src/kiro/mcp-server.ts` declarations/response construction, `src/kiro/info-catalog.ts`, `src/kiro/projection.ts`, `src/kernel/fabric-exec-contract.ts`, and the four requested tests. No lifecycle implementation or cost analyzer investigation. No production/global configuration edits, dependency installs, commits, delegation, network/model calls, or live benchmarks. Only this report was written deliberately. No package-script build: this is an audit, not a production change.

Architecture baseline: native Kiro owns coding tools, web, todos and subagents. One private stdio Fabric server exposes exactly three tools. Durable workspace memory/state is distinct from transient overflow artifacts. No Pi project dependency is assumed or proposed. The provider-registration route diagnostic is context only, not evidence about this application's efficiency.

## Static character/byte ledger

Measured locally with Node using string `.length`, Unicode iteration, and `Buffer.byteLength(..., 'utf8')`. Characters below are UTF-16 code units; Unicode code-point counts equal them for these particular strings. No token or billing conversion. Source strings are not an observed Kiro assembled prompt.

| Surface | Characters | UTF-8 bytes | Interpretation |
|---|---:|---:|---|
| `AGENT_PROMPT`, profile:13–23 | 1,567 | 1,569 | Always-on profile prompt candidate |
| Prompt opening paragraph | 112 | 112 | Stable identity prefix |
| Prompt health/workspace paragraph | 250 | 250 | Startup instructions |
| Prompt history/durability paragraph | 486 | 488 | Important ownership/recovery constraints |
| Prompt native/Fabric routing paragraph | 456 | 456 | Routing and bounded composition |
| Prompt failure/verification paragraph | 255 | 255 | Safety/verification constraints |
| Full skill file | 3,103 | 3,105 | Registered skill resource; actual loading cadence unknown |
| Skill frontmatter through closing `---` | 412 | 412 | Metadata; not assumed fully injected |
| Remaining skill text, including leading newlines | 2,691 | 2,693 | Potential loaded body |
| Prompt + full skill, no separator | 4,670 | 4,674 | Inventory sum, NOT measured per-turn context |
| `fabric_info` description | 76 | 76 | MCP declaration |
| `fabric_workspace` description | 230 | 230 | MCP declaration |
| `fabric_exec` description | 285 | 285 | MCP declaration |
| Three descriptions combined | 591 | 591 | Excludes schemas, annotations and wire framing |
| Exec schema declaration SOURCE, contract:21–37 | 828 | 828 | Explicitly not serialized schema size |
| Skill `tools.list()` example, including fences | 171 | 171 | Broad discovery example |
| Overflow hint fixture, budget 500 and test artifact ID | 208 | 208 | 41.6% of that fixture's visible budget, not a default-budget claim |
| Generated profile compact JSON fixture | 2,395 | 2,397 | Configuration, NOT prompt; includes prompt already counted above |
| Fixture resource URI array JSON | 48 | 48 | URI reference, not resource content |

Fixture options are exactly the existing profile-test paths: `/runtime/node`, `/install/runtime`, `/install/data`, `/install/skills/fabric-exec/SKILL.md`; no steering. Paragraph totals exclude four two-newline separators. The hint fixture uses `ka_` followed by 48 `a` characters, as in projection tests.

Deliberate unknowns: full serialized three-tool schema envelope (workspace schema is imported outside this scope), actual tool serialization by Kiro, Kiro system/native-tool messages, optional steering contents, inherited user/project resources, metadata-vs-body skill loading, and linked API reference loading. Do not add overlapping ledger rows to estimate context. No global files were inspected to fill those gaps.

## Per-layer findings

### 1. Prompt/resources: bounded explicit surface, measurable overlap; optimize cautiously

Evidence: profile:13–23, 41–49; skill:10–20, 46–48; server:52, 313–315.

The profile explicitly registers one skill and optional steering, disables Powers and inherited MCP JSON, and declares native Kiro tools plus Fabric. Those switches do not establish that all Kiro-inherited instructions/resources are absent. Prompt, skill and exec description repeat native-tool ownership, bounded composition and compact-return advice. The local strings are stable across generated profiles; executable/data paths live in configuration rather than the prompt. Optional steering and actual Kiro assembly can change surrounding content and prefix ordering.

Frequency/cost driver: whenever these resources/descriptions are loaded or replayed. Always-on prompt size is known statically; skill load frequency and total assembled context are not. Risk: removing apparently redundant ownership/failure guidance can worsen routing or safety. Candidate: consolidate only explanatory wording while retaining tool-boundary, approvals, isolation, workspace binding, durability and verification requirements. Benefit: overlap inventory measured; behavioral, latency and financial benefit unmeasured. Confidence: high on source, low on actual client exposure.

### 2. Health/discovery: startup overhead is explicit, not proven excessive

Evidence: profile:15; server:310–315, 322–376.

The prompt asks for health near session start regardless of whether the task will need Fabric, followed by workspace inspection/verification. `fabric_info` accepts no arguments and returns limits, workspace, provider status, tracing, lifecycle, interpreter, action catalog and native ownership together. It is not a minimal health-only response. Each healthy info response calls `current.registry.list()` and constructs this aggregate; the scoped handler has no memoized response or caller-selectable detail level. List-tools reconstructs its declarations and serializes the exec schema each time. Both handlers invoke workspace synchronization; its implementation was intentionally not investigated.

Frequency/cost driver: requested startup health call, later repeated health calls, and client tool-list requests; observed frequencies are unknown. Risk: suppressing verification or caching stale workspace/approval facts would weaken required constraints. Candidate: preserve startup verification and consider a compact status plus explicitly requested bounded discovery, only after matched local/client trials show a net improvement rather than an extra round trip. No measured savings. Confidence: high on construction, unknown downstream registry-list cost.

### 3. Catalog/schema hydration: compact hints, but silent degradation contradicts skill

Evidence: info-catalog:3–23; skill:20–26, 35–44; server:355, 360–376; contract:21–37, 56–57.

`fabricInfoActions` caps only the serialized action array at **20,000 UTF-8 bytes**. It degrades from ref/risk/digest objects to ref/risk objects, then a fitting prefix of bare refs. There is no representation/completeness flag, total count, omitted count or continuation. An oversized first ref can yield an empty list despite later entries. This is locally covered by tests, not a demonstrated production occurrence. The complete health response has no aggregate bound in this construction; provider metadata and other fields sit outside the catalog cap.

The skill says info “already returns the digest-bound action catalog” and avoids a discovery-only round trip, yet its next example calls broad `tools.list()` and returns only the count alongside one memory call. This is not actually a discovery-only *top-level* execution: the example composes discovery and use. Nevertheless the list result is unnecessary to the shown `memory.get` operation and models unconditional nested discovery. Info descriptors are refs/risk/digests, not full input schemas, even in the richest form; info cannot replace all schema hydration. The downstream `mcp.describe` example correctly obtains a current digest before calling and must not be removed for apparent efficiency.

Frequency/cost driver: unnecessary nested enumeration when copying the example; digest loss/truncation only when catalogs cross byte thresholds. Risks: mistaken completeness/digest assumptions, missed capabilities and retries. Candidate: correct the example and qualify catalog guidance; expose bounded completeness metadata and targeted discovery without weakening digest validation. Measured: exact static example size and existing boundary-test outcomes. Unmeasured: current catalog size, hydration count, registry/provider latency, task success, any savings. Confidence: high.

**Cache distinction:** the schema helper performs JSON serialize/parse on each invocation; it does not cache the serialized static schema. No response-cache layer appears in the scoped declarations/health construction. This does NOT prove registry/provider schema caches are absent: those implementations are out of scope. Application descriptor/schema reuse must obey workspace/configuration/transport/digest freshness and approvals. Model-provider prompt-prefix caching is a different mechanism; stable source text is merely a precondition, not evidence of cache eligibility, hits, discounted billing or reduced latency. No such telemetry was obtained.

### 4. Output/errors/evidence: good visible bounds; retrieval and low-budget hazards remain

Evidence: projection:5–20, 28–49, 52–67, 76–112; server:57–62, 476–484; skill:46–48.

Successful output uses configured `maxOutputChars`; failures use the smaller of that and 20,000. The skill documents a 50,000-character default. These are UTF-16 character limits, NOT UTF-8 byte limits. JSON formatting, diagnostics and logs share the same projection budget. Head/tail truncation avoids splitting surrogate pairs. Adapter errors limit messages to 800 characters and issues to eight at 200 each; JSON escaping/framing still adds bytes. This is not a fixed-size byte envelope.

On overflow, the complete **constructed projection** is written to an artifact, then an explicit `artifacts.read` hint is prioritized. If storage fails, the response is bounded and becomes an error rather than silently reporting success. For a budget no larger than the hint, `truncateWithHint` returns only a prefix of the hint, potentially losing the artifact ID or usable read instruction. Although the projection object separately holds `artifactId`, the MCP response forwards only `projection.text` and error status, so that field cannot independently rescue retrieval. Reachability under allowed real configuration budgets was not established; this is a conditional finding, not a demonstrated default defect.

The retrieval hint requests the entire artifact. Returning a still-oversized read result can spill again; skill guidance to filter/aggregate/slice inside the guest mitigates this, but the hint does not demonstrate bounded retrieval. Artifact provider implementation and actual returned read shape are out of scope, so a realized repeat-spill loop is unmeasured.

Failure progress retains at most eight completed-call refs, capped at 512 characters, plus totals and an inspect-before-retry warning. Raw arguments/results and incomplete calls are intentionally excluded; writing the projection to an artifact cannot recover omitted evidence. This is appropriate context/privacy minimization, not a full execution journal. Overflow artifacts are transient per architecture, not restart-safe workspace records. Do not promise durable recovery from an artifact ID or persist secrets/whole conversations to compensate.

Frequency/cost driver: large results/logs/errors, explicit pretty JSON, repeated retrieval, and exceptionally small configured output limits. Risk: inaccessible evidence, duplicated effects on blind retry, or treating transient artifacts as durable. Candidate: bounded, decision-relevant retrieval guidance and ensuring a usable recovery reference/warning survives every supported budget, without reducing safety evidence. Measured: static hint size and local projection assertions. No measured task-level, latency or billing benefit. Confidence: high on projection branches, medium/conditional on retrieval consequences.

### 5. Execution contract: reject permissive normalization as an efficiency shortcut

Evidence: contract:21–57; skill:10, 46; contract tests.

The canonical envelope has only code, payloads, resultFormat and timeoutMs. It copies valid-key records without repairing encoded maps or altering code, and rejects aliases/unknown keys. Normalization diagnostics are currently always empty. Keeping this strict interface avoids competing invocation dialects; weakening it or relaxing guest isolation/approval/digest checks is not an approved optimization. Schema serialization is repeated application work, but its significance is unmeasured and likely requires measurement before prioritization. Confidence: high on contract; no savings claim.

## Useful rejected hypotheses

- “Fabric exposes native coding/subagent tools or needs a Pi dependency”: contradicted by profile, tool declarations and architecture.
- “The entire health response is capped at 20 kB”: false; only the action list has that bound.
- “Info always supplies complete digest-bound schemas”: false; no full schemas, and digest/ref information can degrade silently.
- “The skill example adds a whole discovery-only MCP round trip”: not as written; discovery is nested in a useful execution, though still unnecessary for its demonstrated result.
- “Repeated health implies another process” or “fresh guest isolation is waste to remove”: architecture explicitly distinguishes these; lifecycle was not audited.
- “Stable strings prove provider-cache savings”: unsupported. Application caching, provider caching and billing are distinct; billing is unknown.
- “Overflow loses everything silently”: normally false; artifact-backed head/tail projection and explicit retention-failure errors exist. Conversely, “artifact means fully durable evidence” is also false.
- “Passing these tests proves Kiro behavior or savings”: false. No real Kiro invocation, matched trials, live benchmark or authenticated client proof occurred; `kiro-cli` is unavailable on PATH per task context.

## Validation actually run

`pnpm exec vitest run tests/agent-profile.test.ts tests/info-catalog.test.ts tests/approval-projection.test.ts tests/fabric-exec-contract.test.ts`

Result: **4 files passed, 24 tests passed**, Vitest v4.1.11, reported duration 1.33 s (tests 152 ms). This is a local regression run, not an efficiency benchmark or Kiro proof. Tests cover profile resources/ownership/timeouts; catalog degradation and UTF-8 boundaries; approval fail-closed/redaction plus projection bounds/progress/artifact failure/surrogates; canonical envelope and strict guest module/API rejection. They do not establish total health size, production resource loading, full schema hydration/cache behavior, transient artifact retrieval across restarts, or real billing. No test files were added or edited. No matched before/after trials were performed, and no savings are claimed.
