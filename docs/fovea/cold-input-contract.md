# Cold-core input contracts and independent-parser diagnosis

**Current production follow-up:** [production-cold.md](production-cold.md) records
port 0.1.1 ordered batched extraction, header-17 invalidation and exact production
repeat/reference bytes. Sections below are historical v16 input-contract evidence;
the uncontrolled pristine-upstream gate remains unqualified.

Status: **component evidence, not independent-cold or native-host qualification**.
Contract `fifo-source-exact-parser-tape-v1` is a test dependency adapter in
`tests/fovea/fixtures/cold-inputs.mjs`, not a product change or an upstream patch.
The independent cold gate remains strict, opt-in and unqualified; its recorded
reference-repeat failures are retained in `lifecycle-replay.md`.

## Acceptance ledger

- Archive the exact pinned Fovea commit, hash its source before/after, and verify
  the platform-pinned parser binary. Never modify the upstream checkout.
- Run reference capture, reference repeat and native core as separate processes,
  with fresh in-memory state and the same storage path emptied before each run.
  No parsed facts, graphs, sessions or disclosure state cross this boundary.
- Fix the same clock. Queue only promise-based reads inside the source fixture
  in invocation order; preserve every result byte and error. Other filesystem
  reads remain ordinary. This prevents completion order from changing the rule
  plan, without editing the algorithms. The queue is restored after use.
- Capture actual parser stdout, stderr and numeric status once. Each subsequent
  process consumes that exact raw-byte dependency tape, keyed by parser SHA-256,
  ordered argv, exact rule bytes and exact ordered source-byte identities.
- Only two parser-request adaptations are admitted: a temporary rule filename
  represented by its byte identity, and the native port's explicit `--` operand
  delimiter for known parser forms with non-option operands. Raw original argv
  is retained. Rule IDs, source order, match arrays and output hashes are never
  sorted, remapped or changed.
- Every recorded call must be consumed exactly once by each core process.
  Unknown requests, additional/missing calls, incomplete claims, changed source,
  changed parser, output corruption and fallback after tape rejection fail the
  outer comparison even if the core catches the subprocess failure.
- Bound each tape to 256 calls, 16 MiB per frame and 64 MiB total; serialize only
  quota/publication critical sections, with a finite lock budget. This is a
  private development fixture, not a new production filesystem security boundary.
- Compare complete facts, anchors, nodes, edges/witnesses, graph/generation hashes,
  diagnostics, sketch, and all 17 focus/dwell/impact sequences over 46 files at
  budgets 512 and 16000. Require empty extraction-failure lists and positive
  protocol/navigation coverage. All raw output order remains significant.
- Existing output normalization is scratch-root relocation only. Existing
  numerical tolerances remain absolute 1e-12 and relative 1e-10. No expectations
  are deleted to manufacture agreement.
- Keep the helper out of the production closure and package allowlists. Its
  Knip entry exists only because wrappers dynamically import it in subprocesses.

## Reproduce

Requires the pinned Git object under `../pi-fovea`, a verified private parser at
`.tmp/fovea-parser/ast-grep`, and the normal development tools. Missing reference
prerequisites remain visible skips, never fabricated results.

```sh
PATH="$PWD/.tmp/trusted-node:$PATH" FOVEA_RETAIN_CONTROLLED_REPORT=1 \
  pnpm exec vitest run tests/fovea/reference-differential.test.ts -t 'compares cold cores'
PATH="$PWD/.tmp/trusted-node:$PATH" \
  pnpm exec vitest run tests/fovea/cold-inputs.test.ts
```

Successful retained private scopes contain `family-comparison.json`, three full
core outputs, exact tapes, consumed-call ledgers, and generated drivers. Failed
scopes remain for diagnosis. The comparison records `independentCold: false`,
`qualified: false`, and separately `controlledInputsMatched`; no controlled pass
can become an independent-cold certificate. Raw tapes may contain source text:
only bounded fixture summaries belong in checked-in qualification reports.

## Recorded scoped verification

Latest targeted run: **40 passed / 4 skipped**, five modules
(`.tmp/fovea-controlled-tests.json`). All 13 tape/queue regressions and both
controlled budgets executed. Skips are two independent-cold opt-in gates and two
optional external-report cases, not missing controlled prerequisites.

| Budget | Native differences | Reference-repeat differences | Captured calls per run | Retained comparison |
| --- | ---: | ---: | ---: | --- |
| 512 | 0 | 0 | 25 | `/tmp/fovea-qualification-3caX7Z/family-comparison.json` |
| 16000 | 0 | 0 | 25 | `/tmp/fovea-qualification-GbeQww/family-comparison.json` |

Each tape is 330869 bytes; exact evidence SHA-256 values are in
`qualification.json`. Typecheck and Knip passed. Final build command:
`pnpm run build`, log `.tmp/fovea-controlled-build.log`. No full-check or installer
rerun is claimed for this development-only change; historical reports are intact.

The separate opt-in **independent-cold recheck still failed both cases** (exit 1):
512 budget: 193 native / 170 reference-repeat differences; 16000 budget:
268 native / 159 reference-repeat differences. These were strict equality failures
after positive coverage and clean extraction assertions, not missing prerequisites.
See `.tmp/fovea-independent-cold-recheck.json` and `qualification.json` for the
retained raw evidence. Those failures are not counted among the passes above.

## What this does not prove

The parser runs once, not independently for each core. A FIFO dependency adapter
changes scheduling, not production behavior. Therefore these tests establish
cold-core agreement *given identical parser/source-read inputs*, not autonomous
cold extraction determinism, all supported symbol kinds, full history parity,
Kiro hook delivery, model acknowledgment, real UI behavior or task effectiveness.
Warm-fact tests, controlled cold-core tests and unmodified independent-cold tests
remain separately named and reported. H01–H12 and full-native status do not change.

## Prerequisite-aware verification after handoff

The default-environment Fovea run returned **191 passed / 16 skipped**. Twelve
lifecycle cases were skipped because the sibling host checkout lacked the
required object; this was not passing lifecycle evidence. Selecting the retained
bare store executes those cases without fetching or changing either checkout:

```sh
PATH="$PWD/.tmp/trusted-node:$PATH" \
FOVEA_HOST_REFERENCE_ROOT="$PWD/.tmp/fovea-host-reference-1PG9Va/repo.git" \
FOVEA_REFERENCE_PARSER="$PWD/.tmp/fovea-parser/ast-grep" \
FOVEA_RETAIN_CONTROLLED_REPORT=1 \
pnpm exec vitest run tests/fovea tests/package-boundary.test.ts \
  --reporter=default --reporter=json \
  --outputFile=.tmp/fovea-posthandoff-verification.json
```

Result: **213 passed / 4 skipped**, 23 modules, **53.76s**. All 15 lifecycle
cases and all 13 tape/queue regressions executed. The four skips are the two
opt-in independent-cold cases and two optional external-report cases. Typecheck
and Knip also passed. Reviewed the helper's differential callers, complete
packet comparisons, captured-call consumption checks, and production-closure
exclusion. No product-code change or relaxed comparison was needed.

Both controlled budgets passed with zero native and reference-repeat differences
and 25 captured parser calls each. Retained comparisons:

- 512: `/tmp/fovea-qualification-B1egPp/family-comparison.json`
- 16000: `/tmp/fovea-qualification-i7HkkI/family-comparison.json`

The separate `FOVEA_COLD_FAMILY_PROBE=1` run, using the same test module with
`-t UNQUALIFIED`, exited **1**: **2 failed / 4 excluded by test filter**.
Retained strict failures:

| Budget | Native differences | Reference-repeat differences | Evidence |
| --- | ---: | ---: | --- |
| 512 | 154 | 263 | `/tmp/fovea-qualification-Xaec5X/family-comparison.json` |
| 16000 | 221 | 192 | `/tmp/fovea-qualification-EiEyU6/family-comparison.json` |

Report: `.tmp/fovea-posthandoff-independent-cold.json`; log:
`.tmp/fovea-posthandoff-independent-cold.log`. Both failed at strict equality
after clean extraction and positive family coverage assertions. The reference
repeat differs in raw `server/App.kt` call ordering, among other recorded paths.
This reproduces the existing independent-cold qualification gap; it does not
prove every native difference is harmless or justify sorting away evidence.
The independent gate remains unchanged and failed, not repaired by the controlled
pass. No full-check/installer rerun or native-TUI qualification is claimed.

## Required scoped fix: independent cold comparison nondeterminism

Observed evidence `.tmp/fovea-posthandoff-independent-cold.json`: both budgets
fail, **including reference-vs-reference self-comparison**. This shows that the
whole reference pipeline is nondeterministic, not that the port is correct or
that the harness alone is defective. External parser ordering is an input too.

Required work (scoped to the fixture/harness):

1. Run the cold comparison twice against the SAME pinned reference and diff the
   two outputs field-by-field; record the exact differing fields.
2. Identify the nondeterministic input (result ordering, clock/time, temp paths,
   concurrency, or parser version) and make it deterministic in the fixture /
   harness only.
3. Add a regression asserting two same-reference runs are byte-identical.
4. Do NOT weaken assertions, widen production timeouts, or change engine ranking.
5. If, once the harness is deterministic, a genuine native-vs-reference
   divergence remains, record it as a real parity failure rather than masking it.

## Diagnosed: independently executed parser under a rule-order schedule

The scoped repair adds `fifo-source-rule-order-live-parser-v1` to the existing
helper and differential tests. It changes **test input scheduling only**. The
unmodified production-style independent gate above is retained, not renamed,
skipped additionally, relaxed, or replaced by this new pass.

### Fresh failure and causal evidence

The unchanged gate was rerun before the repair (exit 1, two failures):
`.tmp/fovea-cold-diagnosis-before.json`. At budget 512 it had **217 native / 209
reference-repeat differences**; at 16000, **260 / 264**. Retained reports:

- `/tmp/fovea-qualification-mzVxRp/family-comparison.json` (512)
- `/tmp/fovea-qualification-o3URdS/family-comparison.json` (16000)

Exact differing paths include `$.facts.server/App.kt.calls.0.callee`,
`$.facts.server/App.kt.calls.1.line`, `$.facts.server/hono.ts.calls.0.callee`,
`$.graph.edges`, and `$.queries.*.focus.details.generation`. For the 16000
reference runs, Kotlin callees were respectively
`[respond, respond, get, call.respond, post, call.respond]` and
`[get, call.respond, post, call.respond, respond, respond]`.
The full field-by-field lists remain in the reports; no field was deleted.

A minimal probe removed the graph and all asynchronous source reads: identical
Kotlin bytes, identical two-rule bytes, same working directory, same pinned
ast-grep 0.45.3 executable. Eight direct launches showed both rule-group orders.
`--threads 1` did **not** stabilize multi-rule output. Running each rule separately
preserved rule-group order. Raw parser JSON can still differ in metavariable
object-key order; no output rewriting is used to hide that. The pinned core's
own reader consumes these maps, and complete **core output bytes** are the new
repeatability assertion, not raw parser JSON bytes.

Probe: `.tmp/fovea-cold-parser-diagnosis.mjs`; raw results and summary:
`/tmp/fovea-qualification-ZvOUxk/diagnosis.json`. Recorded raw-byte variants for
eight launches each: batch **6**, one-thread batch **4**, one-rule schedule **4**.
These counts are diagnostic observations, not probabilistic test expectations.
The other identified input race remains the upstream `loadFacts` read-completion
order (`dirty.push` and fact insertion after each async read), controlled by the
existing FIFO source-read adapter. Clock, parser hash and source bytes were
already pinned; neither parser-version drift nor a numerical tolerance change
explains this run.

### New executable contract

- Fresh reference, reference-repeat and native processes; facts/storage cleared
  before each. Each process launches the actual pinned parser independently.
  No taped parser output, cached fact, or graph is shared across these runs.
- Keep FIFO source-read completion. Split only the reference-generated JSON rule
  documents at their declared document separators. Preserve exact document bytes,
  IDs, constraints, source arguments and document order. Do not accept arbitrary
  YAML, duplicate IDs, severity overrides or invalid UTF-8.
- Run each scan document with one parser thread; concatenate its **unmodified**
  stdout/stderr in document order. No matches, facts, nodes, edges, warning fields,
  or output arrays are sorted/remapped. Raw parser key order is not canonicalized.
- Keep scan errors/status and stop later rules on failure. Bound rule/call counts,
  output and child/total harness deadlines. Ledger counts actual subprocesses;
  rejected or unsettled requests fail outside the core's fallback path.
- Compare all 46-file / 17-query family facts/graphs/operations at both budgets
  with existing tolerance (1e-12 absolute / 1e-10 relative). Additionally require
  the two reference program stdout strings to be byte-identical **before** root
  normalization. Record their SHA-256 identities. Recheck source inventories.
- Require identical request fingerprints for all three processes. Ledger sorting
  is only for correlating request identities, never for changing parser/core output.
- Keep `qualified:false`, `independentCold:false`, and zero replayed calls in
  reports. The new evidence means independent parser execution **under a
  controlled schedule**, not default production batching determinism or full parity.

Initial full changed-module run: **29 passed / 2 skipped**, 26.55s; the skips
remain the original opt-in uncontrolled gates. It includes 10 new schedule
boundary cases and two new family-budget cases. Both scheduled budgets had zero
native/reference-repeat differences. Each process handled **25 requests / 260
real parser launches**. This expensive test schedule is not a production tuning
recommendation. Reports: `.tmp/fovea-scheduled-regressions.json`,
`/tmp/fovea-qualification-3F8NXq/family-comparison.json` (512),
`/tmp/fovea-qualification-JUIzeg/family-comparison.json` (16000).
Final all-Fovea/package verification: **225 passed / 4 skipped**, 23 files,
**67.75s**, `.tmp/fovea-scheduled-verification.json`. All 15 pinned lifecycle and
23 tape/queue/schedule boundary cases executed. Skips: two original opt-in cold
gates and two optional external reports. Both scheduled budgets had zero
native/reference-repeat differences, **raw reference stdout byte equality**, and
25 requests / 260 actual parser subprocesses per process:

| Budget | Retained report | SHA-256 of each of reference / repeat / native stdout |
| --- | --- | --- |
| 512 | `/tmp/fovea-qualification-86PWXE/family-comparison.json` | `c1844768b80b2f6b01be424920163e667360de2587fed09adf101424a8b55222` |
| 16000 | `/tmp/fovea-qualification-vMNQNB/family-comparison.json` | `b8c84e31a1956e753110218932fd6acc452be3e7f87e8fe45e25dca3f100333c` |

```sh
PATH="$PWD/.tmp/trusted-node:$PATH" \
  FOVEA_HOST_REFERENCE_ROOT="$PWD/.tmp/fovea-host-reference-1PG9Va/repo.git" \
  FOVEA_RETAIN_CONTROLLED_REPORT=1 \
  pnpm exec vitest run tests/fovea tests/package-boundary.test.ts \
    --reporter=default --reporter=json \
    --outputFile=.tmp/fovea-scheduled-verification.json
```

Typecheck and Knip passed. Final build log: `.tmp/fovea-scheduled-build.log`.
Full repository/installer checks were not rerun; the historical full-suite report
was not overwritten. The original failing cold gate was reproduced before the
repair; no new post-repair production-batched qualification is claimed.

Reproduce (no credentials, no upstream edits or runtime downloads):

```sh
PATH="$PWD/.tmp/trusted-node:$PATH" FOVEA_RETAIN_CONTROLLED_REPORT=1 \
  pnpm exec vitest run tests/fovea/reference-differential.test.ts \
    tests/fovea/cold-inputs.test.ts
```

All adapter exports remain in `tests/fovea/fixtures/cold-inputs.mjs`, already
excluded from installed closure/package reachability. No public provider, runtime
permission, production deadline, parser pin, or core ranking algorithm changed.
Uncontrolled independent cold extraction remains an explicit qualification gap;
closing it would require a separately reviewed production/upstream determinism
change, not hiding it behind this schedule. Native Kiro H01-H12 are unaffected.

## Scoped verification after the independent-parser handoff

Read the adapter and all differential callers, checked that the raw reference
stdout assertion uses unnormalized output, and confirmed both `src/` and
`scripts/` have no imports of the test-only scheduling adapter. The package
boundary module also verifies its exclusion from the shipped closure. No product
code, comparison tolerance, production parser arguments, or deadline changed.

Fresh complete-module verification (trusted Node 24.20.0, serial tests):

```sh
PATH="$PWD/.tmp/trusted-node:$PATH" \
  FOVEA_HOST_REFERENCE_ROOT="$PWD/.tmp/fovea-host-reference-1PG9Va/repo.git" \
  FOVEA_REFERENCE_ROOT="$PWD/../pi-fovea" \
  FOVEA_REFERENCE_PARSER="$PWD/.tmp/fovea-parser/ast-grep" \
  FOVEA_RETAIN_CONTROLLED_REPORT=1 \
  pnpm exec vitest run tests/fovea/reference-differential.test.ts \
    tests/fovea/cold-inputs.test.ts tests/package-boundary.test.ts \
    --reporter=default --reporter=json \
    --outputFile=.tmp/fovea-cold-review-verification.json
```

Result: **39 passed / 2 skipped**, three files, **31.00s**, exit 0. Both scheduled
budgets (512 and 16000), both taped-input budgets, both warmed-fact budgets, all
23 adapter regressions and all ten package-boundary tests executed. The two
skips are the unchanged opt-in production-batched independent-cold gates, not
missing references or evidence of a cold-parity pass.

`pnpm run typecheck` and `pnpm run lint:dead` passed. `git diff --check` passed
before recording this entry. Current reports/logs:
`.tmp/fovea-cold-review-verification.json`,
`.tmp/fovea-cold-review-verification.log`,
`.tmp/fovea-cold-review-typecheck.log`, and `.tmp/fovea-cold-review-knip.log`.
Final artifact refresh uses `pnpm run build`, with output retained in
`.tmp/fovea-cold-review-build.log`. Full repository/installer suites were not
rerun for this scoped verification; `.tmp/vitest-report.json` remains intact.
Neither the previously failing uncontrolled cold gate nor native Kiro H01-H12
is newly qualified by this run.


