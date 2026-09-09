# Kiro default vs Fabric Code Mode — TinyShop bug-lab comparison, 2026-09-09

## Outcome

A completed, order-balanced comparison of the **default Kiro agent** and **Kiro Fabric Code Mode** on identical seeded tasks: eight single-bug projects, one all-bugs project, and five legacy steering cases, each run twice per agent (54 planned attempts, all executed). Both arms used the same `auto` model selection, identical prompts, fresh disposable workspaces and the same frozen Fabric bundle snapshot. Results are descriptive, not causal proof.

**Repair quality:** Fabric repaired **18/18** bug tasks through independent public + held-out checks; native repaired **17/18** (its all-bugs round-0 attempt failed the held-out tests after consuming 1.406 credits).

**Reported credits (comparable attempts):** Fabric **5.426** vs native **11.150** — Fabric used **48.7%** of native's credits. Per successful repair: **0.226 vs 0.432** (47.7% fewer). On the 24-file batched-read task Fabric used **19.9%** of native's credits (1 tool call vs 25–26).

**Latency:** medians were similar (18.7s vs 18.1s), but native's p90 was 42.4s vs Fabric's 27.4s; the long tail came from native's many sequential tool calls.

**Strict JSON-only compliance:** Fabric **8/26**, native **2/26**. Both agents frequently added explanatory prose despite explicit no-commentary instructions; those attempts remain strict failures. Repair quality is reported separately and never relabeled.

| Metric | Fabric Code Mode | Kiro default |
| --- | ---: | ---: |
| Comparable attempts | 26 | 26 |
| Strict JSON passes | 8 | 2 |
| Independent bug repairs | 18/18 | 17/18 |
| Bug-task credits | 4.071 | 7.351 |
| Credits per repair | 0.226 | 0.432 |
| Total comparable credits | 5.426 | 11.150 |
| Median / p90 seconds | 18.7 / 27.4 | 18.1 / 42.4 |
| Outer tool calls | 113 | 265 |

Per-case credit ratios (Fabric/native, both rounds): bug-money 0.51, bug-page 0.63, bug-config 0.65, bug-cache 0.53, bug-inventory 0.59, bug-retry 0.63, bug-csv 0.70, bug-batch 0.69, read24 0.20, parser 0.51, multi-edit 0.26, invoice 0.43, bug-checkout 0.43.

## Charge and safety accounting

Authorized budget: 25 credits working / 29 absolute. Known receipt spend across **every** paid attempt (three diagnostic pilots, the 54-attempt matrix, one quota-rejected attempt, one stress stop): **19.618 credits**, plus **one unknown-charge attempt** whose turn produced no usage receipt (quota rejection mid-run). The total is deliberately not estimated beyond that. No retries of failed attempts; every failure is retained and charged to its agent.

The series stopped once automatically: the native all-bugs round-0 attempt exceeded the preregistered 0.8-credit single-run bound (1.406 credits) and failed independent tests. Per the documented protocol, a separate continuation raised the bound to 2 for the remaining multi-bug stress attempts only; all rows and the stop are preserved unchanged. A second stop occurred when the account hit its monthly request limit; after the operator explicitly re-logged in and reauthorized, a declared continuation (`runIndices`) completed the remaining ten runs as a separate stratum.

## Diagnostic pilots (excluded from the matrix)

Three earlier paid pilots (10 attempts, 2.880 credits — all retained in the ledger) were excluded from comparative statistics because the default agent's shell and file-edit calls were being rejected: the current Kiro CLI v3 requires **both** tool trust (`fs_read,fs_write,str_replace,execute_bash,shell`) **and** a separate workspace-scoped shell permission policy. The corrected configuration creates a temporary `HOME/.kiro/workspace-roots/<workspace-hash>/permissions.json` per disposable workspace, records its identity in the attempt row, and removes it after the trial; global permission rules and the default agent stay untouched. The pilots remain genuine setup-confound evidence, not agent-quality data.

## Reproduction and evidence

- Machine-readable aggregates: [agent-comparison-2026-09-09.json](agent-comparison-2026-09-09.json).
- Methodology, runnable example projects and Code Mode recipes: [docs/agent-comparison.md](../docs/agent-comparison.md).
- Private complete evidence: `/private/tmp/kiro-fabric-agent-comparison-20260909` — plans, prompts, raw ACP streams, before/after filesystem inventories, usage receipts, per-attempt rows and frozen harness snapshots for every series (`live`, `v2`…`v6`, `final-report`).
- Offline oracle qualification: `node scripts/agent-comparison.mjs selftest` (36 fixture checks, no inference).

## Limitations

- Single machine, single day, two repetitions; order was rotated and reversed but OS/prompt caches and backend load were not controlled.
- Credits are client-reported usage, not provider-enforced billing; settled monetary cost, token counts and actual `auto`-routed models remain unknown.
- Two native attempts had optional shell loop commands denied by the fixture policy; their charges and outcomes are retained. No headline claim rests on batched-read savings from a denied call.
- Strict JSON failures reflect prompt compliance, not correctness; independent repair checks are the quality dimension.
