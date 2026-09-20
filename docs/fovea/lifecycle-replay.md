# Pinned component lifecycle replay

Scope: **credential-free development evidence, not full native qualification**.
`qualifiedNative` is always false. H01–H12 and F16's overall status are unchanged.

## What executes

`scripts/fovea-lifecycle-harness.mjs` archives exact Git objects into a private
scratch directory; it never resets or changes sibling working trees:

- Fovea `b594483868d27b7eb37a9b185c59ce812f8a9c01`: original `src/index.ts`,
  listeners, session/root/sync state and graph tools.
- Pi Fabric `2ee51683452dc359702880f408e0b8a4bfcb9646`: original
  `CapturedToolCatalog`, capture wrapper and `CapturedToolsProvider`.
- Platform-pinned ast-grep 0.45.3: exact size, SHA-256 and version checked before
  use. The binary is not taken from PATH or downloaded by this harness.

`tests/fovea/fixtures/lifecycle-driver.mjs` supplies a **fixture event runner,
branch store and read/write/edit tools**. It captures 144 events, 14 state
checkpoints, 47 assertions and seven mutation verdicts. Original reference code is not rewritten, source inventories are
checked before/after, and the report includes driver SHA-256, compiled reference
source hashes and actual Node/esbuild/TypeBox versions. Compiled sources include
lazy modules; this list is not line-by-line runtime coverage. Development
esbuild/TypeBox come from this checkout, not an installation of the full Pi host.
Code splitting preserves lazy UI imports so this trace does not need a Pi TUI.

Only scratch fixtures are accessed. HOME, KIRO_HOME and Pi agent storage are
private, the clock advances deterministically across bounded sweep intervals,
subprocess output/time are bounded, and JSON/error
reports are mode 0600. No login, native chat, network acquisition, source build
hook, profile activation or live conversation is involved. Private scratch
reports are intentionally retained for inspection; remove only their printed
scratch directory after review. Harness setup is not an OS sandbox for arbitrary
untrusted code; these are explicitly trusted pinned development references.

## Acceptance ledger

| Check | Evidence |
| --- | --- |
| Idle start and clean turn do not index cwd | no graph, root entry, baseline or message |
| Denied and failed access do not enroll | read counter plus root/baseline/graph state |
| Pre-dispatch cancellation emits no events | unchanged trace length |
| Captured tool lifecycle ordering | start, preflight, optional update, result, end; failed result/end flagged |
| Provider preserves text/details and result middleware | returned read, Fovea packet and a fixture middleware patch |
| Successful access enrolls in pinned Fovea | one root and sync baseline |
| Ordinary turn retains focus | exact focus snapshot and unchanged graph generation |
| Dwell widens without rebuilding | increasing diffusion time, same graph generation |
| Compaction persists roots without resetting focus | appended branch entry, equal focus, existing baseline |
| Resume clears focus/baseline but retains cached graph | state checkpoint followed by silent rebaseline |
| Empty/restored branch does not infer roots from cwd | branch-local root entries, focus reset and baseline checks |
| Reset/shutdown clear focus and baselines | reset clears roots too; cached graph is not treated as enrollment |
| Native shared invariants | real `FoveaHost`, local/repo registry, approved QuickJS calls and built child |
| Missing prerequisites fail closed | private environment-blocked report, no trace; malformed CLI arguments rejected |

The native comparison tests denied/failed/successful reads, zero-start status,
focus/dwell across disposable guests, immutable result replay, explicit epoch
isolation and reset. Native successful reads establish attention **without**
automatically starting analysis: that capability remains off by design pending
qualification. Explicit host epoch changes are not Kiro session event evidence.

## Reproduce

Use Git stores already containing the commits above (a bare store is supported),
the checkout's development dependencies and admitted parser. No fetching or
installing happens implicitly:

```sh
node scripts/fovea-lifecycle-harness.mjs \
  --reference ../pi-fovea \
  --host-reference /absolute/path/to/pinned-pi-fabric.git \
  --parser .tmp/fovea-parser/ast-grep

FOVEA_HOST_REFERENCE_ROOT=/absolute/path/to/pinned-pi-fabric.git \
  pnpm exec vitest run tests/fovea/reference-lifecycle.test.ts
```

The optional `FOVEA_REFERENCE_ROOT` and `FOVEA_REFERENCE_PARSER` variables select
the other two test prerequisites. Tests visibly skip real-reference cases if
a required object or parser is absent. A present but mismatched parser fails;
it is not silently substituted. CLI exits: 0 executed, 3 prerequisites blocked,
1 trace/build/integrity failed, 2 invalid arguments/unhandled setup failure.
Run `pnpm run build` before native-child tests after product source changes.

## Historical initial lifecycle verification

Initial scoped run: **180 passed / 2 skipped**, 21 Fovea modules. Both skips are
optional external-report cases, not lifecycle cases; all seven new lifecycle
tests executed. Package-boundary rerun: **10 passed**. Typecheck, Knip, fresh
build/staging and direct CLI replay passed. The initial combined run's only
failure was the new development harness needing the existing narrow oracle
exception. The repaired boundary test additionally scans all built runtime JS
for forbidden Pi host dependencies/configuration. This is not a full-check or
installer rerun; `.tmp/vitest-report.json` retains the previous full-suite run.

Test artifacts: `.tmp/fovea-lifecycle-tests.json` (contains the initial boundary
failure as well as passing Fovea modules),
`.tmp/fovea-lifecycle-boundary-tests.json` (successful repaired module).
Retained direct trace: `/tmp/fovea-qualification-sqBNE6/lifecycle-report.json`.
Runner bring-up corrected TypeBox metadata lookup and preserved lazy UI chunks;
reference source and production code were not patched to satisfy the trace.

## Independent scoped verification

Re-ran the complete lifecycle and package-boundary modules with trusted Node:

```sh
PATH="$PWD/.tmp/trusted-node:$PATH" \
FOVEA_HOST_REFERENCE_ROOT="$PWD/.tmp/fovea-host-reference-1PG9Va/repo.git" \
pnpm exec vitest run tests/fovea/reference-lifecycle.test.ts \
  tests/package-boundary.test.ts --reporter=default --reporter=json \
  --outputFile=.tmp/fovea-lifecycle-verify.json
```

**17 passed, zero skipped**, two modules. All seven lifecycle cases executed;
the earlier missing-object blocker is not applicable to this retained bare store.
Standalone CLI replay also exited 0 with `status: executed`, no blockers and
`qualifiedNative: false`. Trace: `/tmp/fovea-qualification-auHehC/lifecycle-report.json`.
Verified both pinned commits and the private parser identity from that report.
No product-code repair was needed. The previous full-suite report remains
separate; this scoped run did not overwrite `.tmp/vitest-report.json`.

## Follow-up prerequisite-aware verification

The direct default-environment run returned **13 passed / 4 skipped**: the
reference-dependent block could not find the exact Pi Fabric object in the
sibling checkout. Selecting the retained bare store (without fetching, resetting
or modifying either reference) ran all cases:

```sh
PATH="$PWD/.tmp/trusted-node:$PATH" \
FOVEA_HOST_REFERENCE_ROOT="$PWD/.tmp/fovea-host-reference-1PG9Va/repo.git" \
pnpm exec vitest run tests/fovea/reference-lifecycle.test.ts \
  tests/package-boundary.test.ts --reporter=default --reporter=json \
  --outputFile=.tmp/fovea-lifecycle-current-verification.json
```

Result: **17 passed, zero skipped**, two modules, **6.34s** total. No product-code
changes were needed. Reviewed the archive helper, fixture aliases, native
host/registry/guest comparison and narrow development-only package exceptions.

The standalone harness also executed successfully with the same Git stores and
`.tmp/fovea-parser/ast-grep`. Its private mode-0600 report is
`/tmp/fovea-qualification-916458/lifecycle-report.json`: **50 events, 14 checkpoints,
18 assertions**, no blockers, both exact reference commits and parser SHA-256
confirmed. `qualifiedNative` remains **false**. These are scoped results, not a
new full-check or installer-suite run; the earlier `.tmp/vitest-report.json`
was not overwritten.

## Mutation / provenance replay follow-up

**Implemented and executed at the component surface**, not native Kiro UI.
The 15 lifecycle tests now cover:

| Check | Actual evidence |
| --- | --- |
| Denied/failed write | pinned root/journal state; native registry produces no access/commit or enrollment |
| Commit then enclosing guest failure | actual pinned inner call and native QuickJS local write retain exact transition |
| Own / foreign / mixed / unattributed | seven pinned verdicts; two native hosts sharing private journal, real local write/edit and uninstrumented external bytes |
| Origin comparison | exact provenance map and added/removed route IDs, not just notice text |
| Pending user input | pinned queue mirror suppresses triggerTurn and requests nextTurn; **not native queue evidence** |
| Cancellation | async pinned pre-publication abort; revoked sync retains baseline; native approval abort and pre-transport advisory cancellation |
| Replay/delivery | native stable notice ID, shared exclusive claims, foreign-only next-prompt claim, emission does not acknowledge/advance baseline |
| Lost acknowledgment | native provider publishes exact prepared hashes before verification fails; pinned failed result loses ownership |

Intentional difference: pinned lost-ack drift is `unattributed`, whereas native
commit-boundary observation retains `current-session` attribution. Native tests
force a real verification failure by replacing the published inode with identical
bytes; no observer transition is fabricated. Native automatic continuation stays
false. Pinned `sendMessage` is recorded as a **request**, never execution of a
model continuation. All original lifecycle assertions remain.

The fixture advances its clock beyond the pinned 20-second non-Git sweep before
unhinted mutations; this does not widen production deadlines or introduce sleeps.
Async cancellation yields once before abort so the captured caller has installed
listeners. Exploratory synchronous self-abort exposed a pinned unhandled-rejection
edge; that separate race is **not qualified** by the async cancellation test.

### Scoped verification

- Lifecycle module: **15 passed, zero skipped**, including seven new native
  mutation/delivery comparisons and one pinned mutation trace check.
- Six affected Fovea modules: **47 passed / 2 skipped**. The two skips are the
  explicit **unqualified cold-family cases**, not missing lifecycle prerequisites.
- Package boundary: **10 passed** on the corrected rerun. The initial combined
  run failed one check because the cold probe unnecessarily specified a Pi
  configuration variable. Removed that variable; the existing private HOME is
  sufficient. No runtime boundary exemption was broadened.
- Typecheck, Knip and fresh `pnpm run build` passed. Build log:
  `.tmp/fovea-mutation-build.log`.
- Reports: `.tmp/fovea-mutation-verification.json` (initial boundary failure),
  `.tmp/fovea-mutation-boundary.json` (repair), and
  `.tmp/fovea-mutation-lifecycle-tests.json` (15 lifecycle passes).
- Direct executed trace: `/tmp/fovea-qualification-kOWHWr/lifecycle-report.json`:
  **144 events, 14 checkpoints, 47 assertions**, no blockers, native qualification
  false. No full-check/installer rerun or replacement of `.tmp/vitest-report.json`.

### Cold supported-family qualification — attempted, not passed

`tests/fovea/reference-differential.test.ts` adds a strict opt-in cold probe:
46 files (unchanged pinned mini corpus plus 11 inert unusual-language fixtures),
17 fresh focus/dwell/impact sequences at both 512 and 16000 budgets, complete
facts/graph including edge witnesses, discovery/extraction diagnostics and exact
rendered outputs. The parser's platform-pinned SHA-256 is checked. Shared storage
is emptied between reference, reference-repeat and native processes; no warmed
facts cross this boundary. Only scratch-root relocation is normalized. Numerical
tolerances remain absolute 1e-12 / relative 1e-10.

```sh
PATH="$PWD/.tmp/trusted-node:$PATH" FOVEA_COLD_FAMILY_PROBE=1 \
  pnpm exec vitest run tests/fovea/reference-differential.test.ts -t UNQUALIFIED
```

Actual run: **two failures**, not a parity certificate. Reports:

| Budget | Native comparison differences | Reference repeat differences | Private evidence |
| --- | ---: | ---: | --- |
| 512 | 158 | 184 | `/tmp/fovea-qualification-586yTX/family-comparison.json` |
| 16000 | 263 | 219 | `/tmp/fovea-qualification-0kwUcR/family-comparison.json` |

The unchanged reference itself varies: asynchronous source hashing appends dirty
files in completion order, affecting language/rule IDs and file batching; parser
match order also varies. Raw facts, edge order and graph/version hashes differ.
A parser-transcript experiment rejected the nonidentical rule inputs; it was
removed rather than adding remapping/sorting to manufacture parity. Full positive
protocol/fixture assertions did execute before the strict equality failures.
These include GraphQL, protobuf/gRPC, tRPC/oRPC/Hono, literal channel joins and
C/C++/Lua/PHP/Swift/Scala/Haskell/Bash/JavaScript/Bend fixture navigation; they do
not claim every unusual language yielded a function symbol.

The original two green differential tests share the oracle's persisted facts;
those prove warm-fact operation compatibility, **not cold-parser reproducibility**.
The new opt-in tests keep the unresolved cold gate reproducible and visibly
skipped in ordinary runs. Removing fields, loosening numeric tolerance, or
silently passing an expected failure is not an acceptable repair. The next step
was a separate input-ordering contract; that follow-up is now implemented in
`tests/fovea/fixtures/cold-inputs.mjs` and default cold-core comparison cases.
See `cold-input-contract.md` for the exact FIFO/read and raw parser-tape rules.
No extracted facts are shared, but parser bytes are deliberately replayed, so
this is controlled-input core agreement, **not independent-cold qualification**.
The original strict gate and its failures remain unchanged.

## Remaining scope

Real Pi ExtensionRunner/TUI and builtin PiToolsProvider dispatch, synchronous
self-abort, code reload, a separate fork event, and full cold-family/history parity
remain unqualified. Native Kiro hook routing, model visibility/acknowledgment,
restoration, queued-input precedence and actual bounded continuation still require
implementation/authorized client qualification. H01–H12 and overall F16 status
are unchanged. No model-token saving or full-native completion claim follows.
