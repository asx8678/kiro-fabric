# Independent Astra validation

Exact toplevel `/home/adam/projects/kiro-fabric` and HEAD `d33cbdca33fac6ce301a6da884f06ee5141534da` matched. Read `AGENTS.md`, both findings reports, acceptance, probe, source and raw fixtures. Environment reports `openai-codex/gpt-6-astra`; terminal metadata remains authoritative. This is bounded validation, not another repository audit. No production/config edits, installs, delegation, network/model calls or paid pilot. Parent owns final build.

## Bounded findings

| Status | Exact evidence | Independent result / grade |
|---|---|---|
| Accepted | `scripts/agent-profile.mjs:13` (`AGENT_PROMPT`); `skills/fabric-exec/SKILL.md:20–25` | S recomputed prompt 1,567 chars, skill 3,103; nested discovery is unnecessary in that example, not another top-level round trip. Client exposure/savings unknown. **Code/local**. |
| Accepted | `src/kiro/info-catalog.ts:3–23`; `src/kiro/mcp-server.ts:355–376`; `src/kernel/fabric-exec-contract.ts:56–57` | T confirms catalog-only 20,000-byte cap and silent degradation; not complete schemas or bounded whole health. Serialization repeats; this does not disprove downstream caches. **Code/local**. |
| Rejected | `src/config.ts:229`; `src/kiro/projection.ts:65–67,100`; `src/kiro/artifacts.ts:77` | Tiny-hint failure is unreachable through normal configuration: minimum 1,000 versus fixed-ID hints 209–212 chars (S). **Code/local**. |
| Rejected | `src/kiro/power/artifacts-provider.ts:20–23`; `src/kiro/artifacts.ts:100–112` | Default read is 12,000, hard cap 16,000, with pagination; default output budget 50,000. No default whole-artifact spill loop. Smaller budgets can still need explicit slicing. **Code**. |
| Plausible | `src/kiro/mcp-server.ts:396–401`; `src/kiro/power/workspace-binding.ts:257–324` | Queued mutation lacks cancellation/closing recheck; approval identity is revalidated. Not measured churn or demonstrated bypass. Corrects report’s server lines 382–386. **Code only**. |
| Accepted / plausible consequence | `src/kiro/memory.ts:165–175,211–224` | Release errors suppressed; failure retaining owner metadata can strand a live-PID lock. If owner metadata was removed, stale reclamation differs. No fault reproduction. **Code only**. |
| Accepted | `src/kiro/memory.ts:475,655–656,677–683`; `src/providers/state-provider.ts:59–65,163–165` | Memory can reject after publication without state’s committed acknowledgement. T validates state recovery, not this memory failure. **Code/local distinction**. |
| Rejected | `docs/configuration.md:19`; `scripts/real-client-evidence.mjs:9–10,239–243,276–299` | Power-loss disclaimer already exists. Three manual plus one automatic meets ≥2 total structurally; second automatic was not required. Neither proves live retention. **Code**. |
| Accepted | `scripts/analyze-trace.mjs:72–73,199`; `src/execution-service.ts:50–52`; `src/trace/tracer.ts:97–113` | A reproduces overlap −40→20µs, serial 50→50, outside-parent 70→90; raw `trace-*.jsonl:1–4` use start `monoUs`, not emission `ts`. UTF-16 chars are mislabeled B. **Synthetic/code**, not savings. |
| Blocked production candidate | `audits/efficiency-2026-09-05/analyze-trace-candidate.mjs:72–80` | S: missing/invalid timestamps silently report 100µs, no anomaly. Require explicit finite timestamp/duration validation and unknown/rejection handling before production. Union/clipping is correct for valid intervals. **Synthetic**. |
| Accepted constraints | `src/kiro/mcp-server.ts:231–263`; `src/runtime/quickjs-runtime.ts:380–382`; `tests/mcp-process-lifecycle.test.ts:280,440,577` | Preserve approvals, fresh guests, fail-closed stale roots, drain-before-replacement and durable workspace separation/sharing. T/P pass. **Code/local staged-process**, not live Kiro. |

## Accounting and route

M verifies 42 unique terminal assistant responses: `170394 input + 786176 cacheRead + 0 cacheWrite + 16147 output = 972717 totalTokens`; reasoning 1,787 is already within output. Aggregates reconcile without adding streaming/tool/aggregate events. All routes are Astra. Two initial launches have zero inference; retries ran Astra; economics stopped. Required **GLM detailed phase BLOCKED**—no GLM findings.

Estimated cost 3.007089 covers only supplied prior invocations, excluding this validation/parent. Harness cache rates differ: 0.50 versus 1.00/million across extension-loading routes. These are model-price estimates, **not provider-billed spend**. Billing/client usage/credits/pricing remain null; cost/success undefined. `kiro-cli` absent; live qualification blocked. Parent-reported narrowing/120,000-versus-12,000 fixture failures are probe overhead, not product defects.

## Reproduction

All outputs below are audit-local:

- T: `pnpm exec vitest run tests/{info-catalog,approval-projection,artifacts-state,storage-failure,workspace-binding,trace-analyze}.test.ts --no-cache` → **6 suites/48 passed**, `validation-tests.log`.
- P: `pnpm exec vitest run tests/mcp-process-lifecycle.test.ts --no-cache -t 'rebinds one MCP|shares one durable|restores exact durable'` → **3 passed/7 skipped**, `validation-process-tests.log`.
- A/S/M: `node --input-type=module < audits/efficiency-2026-09-05/validation-{probe,source,accounting}-command.log` (run each separately) → all exit 0. A runs original probe unchanged through filename redirection; candidate stays in memory. JSON/log evidence retained. Parent’s `local-tests.log`: 14 suites/131 passed, not independently rerun wholesale.
