# Efficiency tuning and original Pi Fabric comparison — 2026-09-08

## Result and limits

The installed candidate is **more efficient on the measured coding tasks**, not a guarantee of universal quality or instruction compliance. Six identical coding tasks all passed on both the old Fabric controls and the installed candidate:

| Coding-only metric | Retained old Fabric controls | Installed candidate |
| --- | ---: | ---: |
| Task correctness/scope | 6/6 | 6/6 |
| Kiro-reported credits | 1.2570 | 0.8961 |
| Model-visible tool calls | 27 | 15 |
| Compiler failures | 3 | 0 |
| Final-answer characters | 2,410 | 1,626 |
| Raw JSON final answers | 0/6 | 5/6 |
| JSON after stripping an optional outer code fence | 3/6 | 5/6 |
| Total client wall time | 192.48 s | 99.55 s |

Observed reductions: **28.7% reported credits**, **44.4% outer tool calls**, **32.5% final-answer characters**. Characters are not tokens. The control targeted-edit run took **87.06 seconds**, an outlier relative to earlier measurements; do not attribute the entire time reduction to the changes.

**Comparison boundary:** only the first tuning pilot interleaved old/candidate runs. Subsequent candidate regressions reuse those retained controls, not new contemporaneous baseline inference. Fixture and prompt hashes match exactly. All runs requested Auto, but actual routed models/cache categories and settled charges remain unknown. One run per task per phase is not a general reliability or speed qualification.

The installed candidate passed **7/8 task oracles**, not 8/8: all six coding tasks and the direct explanation passed; the complete 160-entry JSON output was correct but used one pure Fabric computation despite an explicit no-tools request. Its parser answer also remained prose instead of requested JSON. These failures remain visible. Steering is not enforcement.

## What the traces showed

The earlier 24-run default-Kiro comparison had seven Fabric compiler failures: guessed read result fields/string methods, `local.search`, and `anchor`/`content` edit arguments. Repeated directory traversal and returning invoice data only to copy it back into another program added avoidable overhead. In all 12 original Fabric runs, assistant-message character totals equaled final-answer lengths: separate progress narration was not the primary observed cost.

Formatting was a previously unmeasured quality dimension. The original fixture validators mostly checked filesystem/test results, not the requested final JSON format. Six of twelve original Fabric answers were JSON after optional fence removal; that does not mean they were raw JSON. This report keeps strict parsing, lenient fence removal and task correctness separate.

## Implemented

- **`src/kiro/mcp-server.ts`:** the model-facing execution description now advertises exact hot local argument/result shapes, including `.text` as a string, `grep`, `oldText`/`newText`, and settled shell result fields. No aliases or alternate runtime paths were added.
- **`scripts/agent-profile.mjs`:** known task paths skip ritual listing/help; unknown workspace layouts still discover paths and never assume a README. Dependent steps may share an execution when intermediate model judgment is unnecessary. General explanations and no-tools requests explicitly avoid workspace inspection.
- **Always-on efficiency steering in the generated prompt:** concise solution/verification/blockers, default <=120 words, exact requested format, complete requested data overriding brevity, and in-guest data pipelines. Failures and required checks must not be hidden to save output.
- **`resources/steering/fabric.md`:** retains nonduplicated generation/installation/host-authority boundaries. Critical efficiency instructions moved into the prompt rather than relying on optional resource activation. This does **not** prove Kiro failed to load the resource; it removes that dependency.
- **`skills/fabric-exec/SKILL.md` and `references/api.md`:** exact executable recipes for complete first lines, discovery/read composition, exact edit/verify, bounded nonzero-command evidence, and guidance against copying records through model context.
- **Regression checks:** Unicode, leading/trailing whitespace and empty first lines; target/decoy separation; exact edits and unchanged decoys; bounded output with honest truncation flags; expected exit 7; denied shell requests still fail; critical rules remain present without optional steering resources.

Read/write/execute/network approval policy, tool inventory, strict workspace binding, readiness barrier, timeout/call/output limits, and native-tool exclusion remain unchanged.

### Prompt cost was not hidden

Standing prompt + steering grew from **2,931 to 3,496 characters**; the hot tool description grew from **226 to 741 characters**. Detailed recipes remain activation-loaded. The standing-text test deliberately changed from an old 25%-reduction assertion to a **3,500-character maximum**, still below the historical 4,049-character baseline. This is an explicit input-cost trade-off, not a claim of reduced prompt tokens. Fewer repair/discovery turns outweighed it on these tasks.

## What we borrowed from original Pi Fabric

Original repository: `/Users/adam2/projects/pi-fabric`, inspected read-only; its working tree remained unchanged.

| Original mechanism | Relevant source | Kiro decision |
| --- | --- | --- |
| Exact examples and return contracts in standing guidance | `src/core/system-guidance.ts` | Apply the same principle: hot local shapes beside the tool; critical delivery rules in the always-on agent prompt. Keep Kiro's `.text` object contract rather than copying Pi's bare-string read return. |
| Bounded batching, sequential dependencies, named payloads, compact evidence, settled test exits | `src/fabric-exec-tool.ts` (`promptGuidelines`) | Adapt to Kiro's local provider and its per-effect approval/serialization rules. |
| Progressive detailed guidance rather than dumping full schemas every turn | `README.md`, `skillsets/typescript/fabric-exec/` | Keep recipes in the skill and use targeted discovery/help only on uncertainty. |
| Canonical argument normalization and catalog repair | `src/providers/pi-tools-provider.ts`, `docs/repairs.md` | **Not ported wholesale.** Pi explicitly does not promote guest typecheck errors into repairs. Our observed mistakes were compiler failures, so a host-side learned alias table would not fix them before execution. |
| Entropy/replay-preservation ratchet | `docs/entropy.md` | Borrow measurement discipline: retain failures, deterministic oracles, identity checks and before/after evidence. No adaptive schema narrowing/quarantine or new entropy API was registered. |
| Speculative calls during model streaming | `docs/speculation.md` | **Not ported.** Pi uses extension `message_update`/tool-delta hooks; Kiro's MCP backend receives completed tool arguments. Equivalent support requires client integration and freshness/approval/compiler-boundary work, not a server-only cache. |

No Pi code, config, installed skills or settings were modified. No Astra delegation was needed.

## Per-task measurements

Retained controls versus the installed always-on-guidance candidate, same task/fixture hashes:

| Task | Credits old → installed | Calls old → installed | Seconds old → installed |
| --- | ---: | ---: | ---: |
| 24 complete first lines | 0.2081 → 0.0937 | 4 → 1 | 23.25 → 11.76 |
| Targeted config edit | 0.2487 → 0.0802 | 7 → 2 | 87.06 → 12.12 |
| Duration parser fix + held-out tests | 0.2469 → 0.2139 | 6 → 5 | 27.15 → 24.39 |
| Public API rename + caller tests | 0.1442 → 0.1261 | 4 → 3 | 16.62 → 15.16 |
| Intentional exit-7 diagnostic | 0.0526 → 0.0524 | 1 → 1 | 8.46 → 8.79 |
| Invoice/payment/refund join | 0.3565 → 0.3298 | 5 → 3 | 29.94 → 27.34 |

The tiny command case is essentially unchanged, not meaningful evidence of a savings advantage. Invoice/data pipelines and parser discovery still have room for improvement; instructions did not eliminate every round trip. A prior candidate's invoice run was **more expensive** than the retained baseline, and remains in the machine-readable evidence.

## All experiment phases, including failures

| Phase | Runs | Task oracles passed | Reported credits | Notes |
| --- | ---: | ---: | ---: | --- |
| Interleaved old/candidate pilot | 16 | 13/16 | 2.5174 | Old failed both no-tool probes. Candidate failed general explanation, unnecessarily inspecting the empty workspace and asking for code. |
| Routing-corrected candidate regression | 8 | 8/8 | 1.1212 | Both dialogue cases used zero tools; parser still not JSON and several outputs had fences. |
| Always-on-guidance candidate regression, installed | 8 | 7/8 | 1.0819 | General explanation: 58 words, zero calls. All 160 JSON entries preserved, but one forbidden-by-request pure computation call. Five of six coding finals are raw JSON. |
| **Total this tuning work** | **32** | **28/32** | **4.7205** | **24/24 coding task instances passed** across all phases. |

A previous spoken/commentary summary called the routing candidate “final”; the later user request to inspect original Pi Fabric led to the separate always-on-guidance phase. None of the earlier evidence or charges was replaced.

The long-output no-tool violation was `Array.from(...); return JSON.stringify(entries);` inside Fabric, with no local provider/workspace operation. That is still a real extra outer call and a task-constraint failure. The parser final prose is separately recorded as format noncompliance, even though its implementation and tests passed. The harness's stricter field-name heuristic also marked a rename response false where the user did not specify that JSON key; the report uses raw JSON parsing and the original symbol/behavior oracle instead of treating that heuristic as an authoritative schema.

## Budget, verification and evidence

- Tuning work: **4.7205 reported credits**.
- Approximate conversation-wide observed total, including previous comparison/calibration/pilot work: **13.51 credits**, below the 15-credit allowance. Prior pilot displays were partly rounded; this is not settled billing or a remaining-balance query.
- Local stopping rules: first pilot 3.5 reported credits; each subsequent regression 2 credits; 1-credit reserve before new runs, review above 0.8 credits per run, 150-second/40-call limits. No provider-enforced monetary cap was available. No more paid calls were started after the installed-candidate cohort completed.
- Typecheck passed. **64 guidance/bootstrap tests and 62 installation/bundle tests passed** on the final code paths. Existing README discovery, unsupported-argument rejection, workspace, approval and installation contracts were preserved.
- All captured Fabric trace analyses passed with `complete-observed-records` coverage. Original prompt/fixture hashes match across every compared task. No malformed client records, safety stops, missing usage rows or agent/model mismatches occurred.
- Installed generation: `fca62aa2aaf0107aa7dd54c096447bebda9cd70fbd6b9de3bc92a02724d5a384`. Managed updater used; profile/permissions/configuration identities were mechanically checked. Start a **new Kiro conversation** to adopt it.
- Final fresh build log: `/tmp/kiro-fabric-efficiency-inline-20260908/final-build.log`.

Machine-readable evidence: [efficiency-tuning-2026-09-08.json](efficiency-tuning-2026-09-08.json).

Private frozen plans, harnesses, fixture generators, oracles, profiles, raw client streams, traces and outputs:

1. `/tmp/kiro-fabric-efficiency-tuning-20260908/`
2. `/tmp/kiro-fabric-efficiency-final-20260908/`
3. `/tmp/kiro-fabric-efficiency-inline-20260908/`

Further work should target deterministic data round-tripping and broader held-out tasks before adding framework machinery. A bounded recipe/help entry and atomic multi-anchor edit support are candidates for a separately specified change, not implemented features or promised credit savings. Hard JSON/no-tool guarantees require client/runtime enforcement beyond soft steering.
