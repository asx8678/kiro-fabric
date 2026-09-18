# Single-agent evidence and efficiency

## Scope and acceptance ledger

Extend the existing opt-in continuity store; do not replace Kiro compaction, add agents/model calls, change installed settings, or access private Kiro transcripts. Preserve existing v1/v2 tasks, approvals, bounded output, workspace isolation, revision CAS, and idempotent checkpoint publication.

| Check | Implementation / required evidence |
| --- | --- |
| Durable check/evidence links | Append versioned, caller-declared acceptance checks referencing retained host receipts; reject forged/missing references. Preserve selected review claims and their origin/scope, not a semantic certification. |
| Relevant bounded task view | Objective/constraints first; unresolved checks and failures before routine successes; explicit omission ranges and exact expansion. No recursive model summarization or per-turn injection. |
| Freshness | Recheck bounded, linked workspace source hashes using existing safe reads. Changed/missing/unbound evidence cannot establish a current passing check. No claim of whole-repository coverage. |
| Narrow recall | Explicit task selector; deterministic lexical/structural filters; small snippets, stable revision/hash pagination and exact expansion. No database/index dependency until profiling warrants it. |
| Failure evidence | Explicit opt-in bounded command failure excerpts; disclose truncation. Never equate successful transport with a passing command or replay a command to retrieve output. |
| Efficient workflow | Existing readMany/readEvidence and bounded Promise.all; sequential dependent effects; milestone checkpointing and concise returns. No speculative argument coercion. |
| Offline qualification | Existing continuity regressions plus stale/missing evidence, recovery, omissions, hostile content, budgets, checked guest registration and built-runtime probes. Extend the existing efficiency harness. |
| Client compatibility | Keep the single outer fabric_exec tool and fail-closed approvals. Live Kiro 2.22 approval/decline, result spilling and resume checks require a separately authorized numeric spend cap; offline tests cannot establish delivery or credit savings. |
| Handoff | Typecheck, targeted tests, built-runtime behavior, guidance consistency and a fresh pnpm run build. No installation or default-profile changes. |

## Measurement policy

Compare correctness and recovery assertions before output sizes. Report serialized characters/bytes at the measured boundary, not invented token or credit savings. Keep all failed attempts. Actual cost per successful task needs complete observed billing across all attempts and a capped, authorized live comparison. Local deterministic helpers use no inference, but context they return still contributes to subsequent Kiro input usage.
