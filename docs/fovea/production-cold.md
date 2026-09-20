# Production-batched cold extraction (port 0.1.1)

This supersedes the **production batching** gap in the historical
[cold-input contract](cold-input-contract.md), not its uncontrolled-upstream
qualification failure or any native Kiro gate.

## Implemented contract

- `src/fovea/core/asyncutil.ts` prepares at most 32 source reads in parallel,
  settles the complete window on failure/cancellation, then publishes in source
  enumeration order. It never retains the whole repository's source text.
- `src/fovea/core/build.ts` uses ordered publication for fact insertion, dirty
  lists, generated-source decisions and the existing text-cache budget.
- `src/fovea/core/astgrep.ts` retains multi-rule/multi-file subprocess batching,
  existing process/output/time limits and honest extraction-failure reporting.
  Matches publish by declared rule, declared source, start line/column, outer
  before inner expression at the same start, then captured-value tie-break.
  Capture object keys are deterministic. No match, duplicate, edge or witness
  is removed. Structured outlines retain declared source order.
- Core cache header **17** invalidates header 16 rather than treating old
  scheduling-dependent facts as a deterministic cold result. Public IPC and
  user configuration formats are unchanged. Provenance port version is 0.1.1.

This is an **intentional determinism improvement over pinned upstream**, not an
output-normalizer patch. The pristine upstream source is still archived, hashed
before/after, and never edited. Numerical tolerances remain 1e-12 / 1e-10.

## Executable evidence

`tests/fovea/reference-differential.test.ts` runs two fresh native production
processes without FIFO adapters, parser wrappers, tapes or warmed facts. Each
uses the real pinned batched parser. They are compared to two independently
executed pinned references using the documented one-rule/one-thread input
schedule. Complete facts, graphs, witnesses, generations, diagnostics and all
17 query sequences over 46 files are compared at budgets 512 and 16000.
Both reference repeats and native repeats are byte-identical; native/reference
bytes also match. Nothing is sorted or discarded in the result normalizer.

Retained successful reports (39 passed / 2 deliberately unqualified probes
skipped across differential, dependency-adapter and initial batching modules):

- 512: `/tmp/fovea-qualification-bh28r1/family-comparison.json`; all four raw
  output hashes `09bc4c16eb6923b56d0a2ea851810e08aec0690429a2e194583c13c821b15f54`.
- 16000: `/tmp/fovea-qualification-27eF5T/family-comparison.json`; all four raw
  output hashes `d9371c26905b400bdf5db6186774d827ae41f66f6942b77f35f26e8ce529ba6d`.
- `.tmp/fovea-production-second.log`; subsequent expanded batching/cache tests:
  `.tmp/fovea-batching-regressions.log`; typecheck:
  `.tmp/fovea-remaining-typecheck.log`.

`tests/fovea/production-batching.test.ts` additionally tests bounded read windows,
reverse completion, synchronous preparation failure, cancellation, invalid
limits, real 161-file/multi-rule/four-repeat batching, overlapping duplicate
rules, and rejection/re-extraction of header-16 caches.

The older warmed-fact comparison now explicitly **transcodes only the fixture
cache header** from 16 to 17, preserving every fact byte. It proves operations
on recorded facts, not production cache compatibility. The tape comparison now
records exact **scheduled** parser bytes (`fifo-source-rule-order-parser-tape-v2`),
then replays them unchanged. The original raw-byte adapter remains tested, but
arbitrary scheduling-dependent tapes are no longer claimed to equal v17 order.
This input-contract change is explicit; strict output assertions remain intact.

```sh
PATH="$PWD/.tmp/trusted-node:$PATH" FOVEA_RETAIN_CONTROLLED_REPORT=1 \
  pnpm exec vitest run tests/fovea/production-batching.test.ts \
  tests/fovea/reference-differential.test.ts tests/fovea/cold-inputs.test.ts
```

## Limits of the claim

The unmodified upstream reference remains nondeterministic under uncontrolled
batching (`FOVEA_COLD_FAMILY_PROBE=1`), so that comparison remains failed/unqualified,
not a passed default-suite case. Fixture repeatability is not universal corpus,
performance-distribution, task-effectiveness or native-host certification.
No production timeout, subprocess cap, approval rule, parser authority or
managed/native automatic capability was relaxed.
