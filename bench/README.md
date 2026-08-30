# bench — DeepSWE-style verification loop

Local, paired before/after benchmark for measuring Fabric's token-efficiency
regressions against plain Pi, built to mirror the methodology and metrics of
github.com/Whamp/kiro-fabric-deepswe-trajectories (issue: "DeepSWE Performance
Trajectories with GPT-5.6-sol:low").

## What it measures

Per (task, config, rep) cell:

- `reward_binary`, `reward_partial` — from the task's `verify.sh`, whose
  checks are derived mechanically from the task's stated acceptance criteria
- `combined_total_tokens`, input/cached/output breakdown, `combined_cost_usd`
  (GPT-5.6 Sol rates: $5/M fresh input, $0.50/M cached input, $30/M output)
- `agent_wall_s`, `turns`, `tool_calls`, `patch_bytes`
- Read-pathology statistics: total reads, whole-file (unbounded) read share,
  tool results over 50 KB. Fabric cells parse `details.trace.operations`, the
  same extraction that reproduces the trajectories repo's published numbers
  (1505 reads / 78.5% whole-file / 79 results over 50 KB).

## Layout

    tasks/<slug>/task.json   repo URL, base ref (extracted from archived sessions), timeouts
    tasks/<slug>/prompt.txt  verbatim DeepSWE user prompt from the archived cell
    tasks/<slug>/verify.sh   acceptance probes -> reward_binary/reward_partial
    tasks/<slug>/mutants.json deterministic acceptance-violating verifier mutations
    tasks/<slug>/mutants/fixture near-conforming, local implementation mutated by the suite
    mutation_verifiers.py    non-model mutation runner and fingerprinted JSON report
    run-cell.sh              one cell: checkout at base ref -> agent -> verifier
    run-matrix.sh            verifier gate, isolated agent dir, task x config x rep loop, analysis
    analyze.py               paired summary (solves, McNemar, token deltas, read pathology)

Configs:

- `baseline` — clean stock pi: `--no-skills --no-extensions`, isolated
  `PI_CODING_AGENT_DIR` with only the `openai-codex` OAuth entry
- `agentless` — a deliberately simple stock-Pi comparator with fixed
  localization, repair, and deterministic task-verification stages (details
  below)
- `fabric-local` — this repo (`-e <repo root>), with shipping defaults
- `fabric-local-disabled`, `fabric-local-gated`, `fabric-local-always` — the
  equal-model selective-prewalk ablation. Each writes an isolated `fabric.json`
  with the named `prewalk.activation` and records decisions, eligible decisions,
  automatic arms, and reason counts alongside the existing token/read metrics.
- `fabric-<version>` — vendored published package (e.g. `kiro-fabric@0.25.6`,
  the version benchmarked in the trajectories repo)

## Verifier mutation gate

Before spending a model call or trusting a local score, run every selected task's
verifier against deterministic, acceptance-violating implementations:

    python3 mutation_verifiers.py \
      --tasks scc-bounded-memory-spilling,superjson-error-stack-serialization \
      --report /tmp/verifier-mutation-report.json

From the repository root, `pnpm run bench:verify-verifiers` runs all local task
suites and writes the ignored report under `bench/.artifacts/`.

A mutant is valid only when its named acceptance check fails and every
non-targeted check passes. The command exits nonzero if a verifier accepts a
mutant, a mutant causes collateral failures, verifier output is malformed, a
fixture cannot be prepared, or a verifier times out. The JSON report records
checks and bounded verifier logs. Its task fingerprint covers the prompt,
verifier, probe, manifest, edits, and fixture, so changing any suite input makes
the report stale.

`run-matrix.sh` and real (non-dry-run) `run-matrix-blinded.sh` run this gate
before credentials are read or cells are launched. They abort closed on any
failure and preserve the trusted report as
`results/<run-id>/verifier-mutation-report.json` (or under `controller/` for a
blinded run). `analyze.py` refuses local results without a current trusted
report. The mutation runner uses only local fixtures and build/test tools; it
makes no agent or model calls. A blinded `--dry-run` remains a zero-side-effect
schedule preview and creates no results to trust, so it does not run the gate.

To add a task, provide a near-conforming fixture and `mutants.json`. The
manifest declares the verifier's complete, duplicate-free `expected_checks`
set; each mutant uses exact, single-match source edits and declares its targeted
`expected_failed_checks`. Trusted report validation requires exact task, mutant,
and check sets plus recomputed summary totals. Keep each mutant focused on one
acceptance violation. Never weaken the non-targeted-check rule merely to make a
mutant pass.

## Run

    ./run-matrix.sh --tasks scc-bounded-memory-spilling \
      --configs baseline,fabric-0.25.6,fabric-local --reps 3 \
      --vendor kiro-fabric@0.25.6 --run-id myrun

Results land in `results/<run-id>/<config>/<task>/rep<N>/` in the same layout
as the trajectories repo; `analysis-summary.json` and the verifier mutation
report are written next to them.

## Official DeepSWE tasks through Pier

`run-deepswe-pier.sh` runs the same paired Pi configurations in the official
Harbor task images and separate verifier environment. Those external Pier
verifiers are not attested by the local mutation suites; Pier rewards must not
be described as mutation-certified unless the corresponding upstream verifier
has its own equivalent gate. Keep sibling checkouts of
`datacurve-ai/deep-swe` and `datacurve-ai/pier`, Docker running, and the
`openai-codex` OAuth entry available in `~/.pi/agent/auth.json`.

    PIER_ENVIRONMENT=modal ./run-deepswe-pier.sh bandit-interprocedural-taint-checks baseline
    PIER_ENVIRONMENT=modal ./run-deepswe-pier.sh bandit-interprocedural-taint-checks fabric-local
    PIER_ENVIRONMENT=modal ./run-deepswe-pier.sh bandit-interprocedural-taint-checks fabric-gated

The matrix runner pins either the original reporter subset or a smaller adversarial cross-language canary, expands independent attempts through Pier, and gives both configurations deterministic resumable job names. Previewing is free; matrices over 24 paid cells require an explicit confirmation.

    PIER_DRY_RUN=1 ./run-deepswe-matrix.sh subsets/deepswe-canary-8.txt both
    PIER_ENVIRONMENT=modal PIER_CONFIRM_FULL_MATRIX=1 ./run-deepswe-matrix.sh subsets/deepswe-canary-8.txt both
    PIER_ENVIRONMENT=modal PIER_CONFIRM_FULL_MATRIX=1 ./run-deepswe-matrix.sh subsets/deepswe-36-v2.txt both

The defaults are three attempts and one concurrent trial. Override them with `PIER_N_ATTEMPTS`, `PIER_N_CONCURRENT`, and a stable `PIER_MATRIX_ID`; rerunning the same ID resumes Pier jobs with matching configs. The canary is 48 cells and the full reporter matrix is 216 cells, so use the canary before commissioning the full rerun.

Compare completed matched jobs and write replayable cell-level JSON with:

    python3 analyze_pier.py results/pier/<baseline-job> results/pier/<fabric-job> --output results/pier/<matrix-id>-comparison.json

The adapter installs Pi inside the task container, uploads only the isolated
OAuth/settings directory, and packs the current Fabric checkout for local runs.
Pier results land under `results/pier/`. In addition to verifier reward, the
trial metadata records fresh/cached/combined and peak context tokens, outer and nested
call mix, failures, same-file edit fragmentation, compactions, bounded versus
whole-file reads, model-visible result volume, results over 50 KB, and selective-prewalk
activation/decision/arm counts. Use `fabric-disabled`, `fabric-gated`, and
`fabric-always` with the same package and task matrix for the ablation. Pass additional `pier run` flags after the config, such as timeout multipliers or dataset sampling flags. For the launcher's standard repetition and concurrency controls, use `PIER_N_ATTEMPTS` and `PIER_N_CONCURRENT`. Modal is recommended on ARM hosts because the official images are amd64. Set `KIRO_FABRIC_PACKAGE` to reuse one already-certified tarball across tasks. Run OAuth-backed cells serially.

Notes:

- Model is pinned to `openai-codex/gpt-5.6-sol` at thinking `low`, matching
  the trajectories benchmark.
- Run cells serially: the codex OAuth token is shared and refresh writes race.
- `results/`, `.cache/`, `.runtime/` (if any) and `vendor/` are git-ignored.
