# Fabric vs default Kiro V3 — Auto comparison, 2026-09-08

## Verdict

**Fabric was more credit-efficient on this suite, but not faster overall.** Both agents passed all 12 scored task instances. Fabric used **35.7% fewer Kiro-reported credits**, while taking **8.0% longer** end to end. This is a scoped comparison of the two workflows on Auto, not proof of general superiority or identical underlying model routing.

| Scored metric | Default Kiro V3 | Fabric V3 |
| --- | ---: | ---: |
| Correct task instances | 12/12 | 12/12 |
| Reported credits, all scored attempts | 4.1385 | 2.6598 |
| Reported credits per correct task | 0.3449 | 0.2216 |
| Total client wall time | 249.3 s | 269.3 s |
| Mean client wall time per task | 20.8 s | 22.4 s |
| Model-visible tool calls | 135 | 57 |
| Expected nonzero-command error events | 4 | 4 |
| Additional compiler-error events | 0 | 7 |

Fabric used fewer reported credits in **11 of 12 matched pairs**, and was faster in **6 of 12**. Its 57.8% reduction in model-visible tool calls is not a reduction in equivalent host operations: Fabric can batch many provider calls inside one execution.

## Per-task results

Means over two runs per agent; all task rows passed twice on both agents. Positive time change means Fabric was slower. Small differences, especially targeted-edit credits, are not evidence of a repeatable advantage.

| Task | Default credits | Fabric credits | Fabric credit reduction | Default time | Fabric time | Fabric time change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Read first lines from 24 files | 0.3431 | 0.2120 | 38.2% | 19.50 s | 21.21 s | +8.8% |
| Find and edit one config among 48 decoys | 0.2831 | 0.2774 | 2.0% | 18.17 s | 29.48 s | +62.2% |
| Fix duration parser | 0.3484 | 0.2433 | 30.2% | 23.92 s | 26.66 s | +11.4% |
| Rename API across three source files | 0.3085 | 0.1440 | 53.3% | 20.14 s | 16.88 s | −16.2% |
| Extract diagnostic from noisy, intentionally failing command | 0.1601 | 0.0526 | 67.2% | 9.44 s | 8.29 s | −12.2% |
| Join 24 invoice files with signed payments/refunds | 0.6260 | 0.4006 | 36.0% | 33.47 s | 32.15 s | −4.0% |

## Experimental design and fairness

- **24 scored live sessions:** six task families × two rounds × two agents.
- Both used `kiro-cli chat --v3 --model auto --no-interactive --require-mcp-startup --trust-all-tools --output-format stream-json`.
- Default used `--mode default` with observed mode `vibe`. Fabric used `--agent kiro-fabric` with observed mode `kiro-fabric`. Auto was observed in the configuration events for every scored session.
- Both received the exact same task prompt and initial file contents within each pair. Prompt and fixture SHA-256 equality was mechanically checked.
- Order alternated across task families, and reversed for each family's second round. Each run had a fresh session and fresh workspace; no conversation resume or manual warm-up.
- Default retained its stock native tool interface. Scored native sessions did not call Fabric. Fabric retained the exact `@fabric/fabric_exec` model-facing interface and readiness fix.
- Explicit session auto-approval was applied to both agents to avoid comparing allowed Fabric operations against rejected native writes/shell commands. No global trust policy was intentionally changed. The fixtures contained no adversarial instructions; network, delegation, package installation and persistent memory use were prohibited in the shared prompt. Shell remains host-authority, not an OS sandbox.
- No source/profile/prompt tuning occurred during the scored suite. The frozen harness hash, installed profile hash and Fabric configuration hash remained unchanged. The installed KAS identity was also checked before each run.
- All validators were deterministic local checks, not a second paid AI reviewer. Fixture/oracle self-tests included known-correct solutions and negative scope-mutation tests before paid execution.
- There were no scored harness retries, cancellations, missing usage summaries, malformed client records or agent/model identity failures. Model recovery attempts inside a turn were retained and charged.

## What correctness meant

1. **Read24:** exact complete first-line strings in filename order, including fixture-dependent hashes and Unicode; input files unchanged.
2. **Targeted edit:** select the actual JSON id, not a description mentioning the same id; Unicode/spaced path; only retryLimit changes to 7, all other values and files preserved.
3. **Duration bug:** milliseconds conversion, case/whitespace handling and invalid inputs; supplied tests plus held-out contract cases; only the implementation file may change.
4. **Rename API:** existing behavior tests pass, new public symbol is callable, old symbol/identifier is absent from implementation and callers; tests and configuration stay unchanged.
5. **Nonzero output:** exact exit code 7 and diagnostic values from a command with 450 noisy lines; command request observed, no edits. Both agents handled this without a follow-up tool call.
6. **Invoice join:** exact per-customer integer-cent totals accounting for duplicate/signed payments, refunds, cancelled invoices and zero-floor balances; only summary.json added.

Final file snapshots deliberately ignored Kiro's own `.kiro` metadata and Python `__pycache__`. They do not prove absence of transient files removed before validation or out-of-workspace side effects. These are correctness checks for the controlled tasks, not security certification.

## Why Fabric was slower on some tasks

Seven avoidable Fabric compiler failures were observed:

- Four across the two read24 runs: treating `LocalReadResult` as a string or guessing `.lines` / `.content` instead of `.text`.
- Two targeted-edit failures: inventing `local.search` instead of `local.grep`.
- One targeted-edit failure: guessing `anchor`/`content` rather than `oldText`/`newText` for edit.

The compiler rejected those calls before provider effects. Auto recovered and completed every task, but the extra turns substantially increased targeted-edit latency. The other four Fabric error events were intentional shell nonzero exits, matching four expected native nonzero events; they are not extra task failures.

**Next tuning candidate:** concise exact examples for `local.read(...).text` (a string, not an array), `local.grep`, and `local.edit({path,oldText,newText})`, followed by the same regression oracles. Do not promote a guidance change solely because it compiles: an earlier pilot produced semantically wrong first-line results despite successful compilation. No tuning was applied in this comparison.

## Calibration problem, retained rather than hidden

The first four runs used headless defaults without explicit session trust. Native reads worked, but native write/shell calls were rejected as “The user rejected this tool call,” while Fabric's installed inner policy allowed the requested operations. That was an approval mismatch, not a Code Mode quality advantage.

Those four runs were removed from the scored cohort **as a whole** and retained as calibration. Two subsequent approval probes confirmed that an exact tool-name list permitted native editing but still rejected shell execution; standard `--trust-all-tools` permitted the harmless command. A new harness/plan version then restarted all task pairs with that flag on both arms. Original failures and their reported charges were not erased or treated as zero-cost successes.

## Credit ledger

| Boundary | Kiro-reported credits |
| --- | ---: |
| Scored comparison: 24 sessions | 6.7983 |
| Calibration: four initial runs and two approval probes | 1.5264 |
| **This comparison request, including calibration** | **8.3247** |

Prior pilot/fix work reported approximately 0.47 credits, so observed conversation-wide spending is approximately **8.79 credits**, below the user's 15-credit allowance. This is **not** a query of the remaining account balance or settled debit. The earlier TUI pilot had rounded displays and a harness-affected follow-up, so its exact billing remains unknown.

The scored runner used a 10-credit reported-usage stopping rule with a 1-credit reserve before a new run, a manual-review threshold above 1 credit for a single turn, a 150-second per-run timeout and a 40-tool-call ceiling. These are local stopping controls, not a provider-enforced monetary cap. No additional paid runs were started after all 24 scored tasks completed.

## Identity and limitations

- CLI 2.21.1, KAS bundle SHA-256 `7e102d154413a7b92ed1abae0ab32d5761debfefdff4d626075e20d63f9da0cb`, macOS ARM64.
- Installed Fabric generation: `944750594b95db4e8b35d3a1fe080478bb502ff6eca81b95b7719539d3b1ddb1`.
- Installed profile SHA-256: `1136e967c49d0b3dc038c28fe9d76436daa6c7cbe85226cc830ded39de5926ae`.
- Frozen scored-harness SHA-256: `12ba3e67c875a1f8b5057ee8f78baf774015640cd18b731422edd70c4297f143`.
- Auto may route differently for different prompts/tool inventories. Actual underlying model/revision and provider cache categories were not exposed. This compares the requested **Auto workflows**, not an isolated same-model causal effect.
- Two rounds over six small synthetic task families do not establish broad reliability, statistical quality equivalence, or superiority on large real repositories.
- Fresh sessions are not necessarily cold provider/OS caches. Counterbalancing reduces simple order bias but does not eliminate cache/model/service noise.
- Credit ratios use observed turn summaries; settled monetary charges and missing token/cache categories remain unknown. No character-to-token conversion was used.
- ACP raw-output size was recorded only as a client-event envelope measurement, not as equivalent model-visible tokens. It is not used for the headline conclusion.
- This does not qualify interactive elicitation, compaction/resume, hostile workloads, cross-platform behavior or long-running tasks.

## Evidence and reproducibility

Machine-readable aggregate, per-run metrics, fixture/prompt identities and verification checks: [auto-comparison-2026-09-08.json](auto-comparison-2026-09-08.json).

Private raw evidence, complete fixture generator/oracles, prompts, command arguments, initial task specification and final files:

- Scored: `/tmp/kiro-fabric-auto-ab-v2-20260908/`
- Calibration: `/tmp/kiro-fabric-auto-ab-20260908/`

Each scored run retains `client.jsonl`, stderr, command.json, prompt.txt, workspace files, result JSON and correlated Fabric traces where applicable. The existing `scripts/analyze-trace.mjs` analyzed all 24 captured Fabric process trace files successfully; coverage was `complete-observed-records`, with **57 actual execution attempts**, agreeing with the client count. Startup-only discovery-probe processes are retained and are not counted as extra executions.

`audit-results.mjs` independently verifies pair hashes, order reversal, model/agent identities, completed validators, trace analyzer results, unchanged harness/profile/configuration and spending arithmetic. No new product benchmarking command or unattended paid CI job was registered.

**Acceptance:** requested Auto comparison completed; all scored tasks validated; budget evidence retained; no product tuning during measurement. Final fresh build required by the repository is recorded at `/tmp/kiro-fabric-auto-ab-v2-20260908/final-build.log`.
