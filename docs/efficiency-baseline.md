# Offline efficiency preparation (C1)

Grounding: [AUD-004](../audits/2026-09-07-native-grounding-review/verification/cards/AUD-004.json) establishes **no comparable economic baseline**; [AUD-031](../audits/2026-09-07-native-grounding-review/verification/cards/AUD-031.json) requires counting **expanded runtime declarations and actual pages**, not the guest template or `references/api.md`. This preparation does not close AUD-004 or claim savings. Existing audit artifacts are unchanged.

## Run without inference

Requires the already installed Node >=24 and dependencies. POSIX `/tmp` is required for probes. Run from the trusted repository checkout; it anchors paths to the script, not the calling directory.

```sh
node scripts/efficiency-baseline.mjs manifest > /tmp/efficiency-before-manifest.json
node scripts/efficiency-baseline.mjs probe > /tmp/efficiency-before-probe.json
pnpm_config_verify_deps_before_run=warn pnpm exec vitest run tests/efficiency-baseline.test.ts
```

`manifest` inventories the checkout and enumerates tasks without importing or running Fabric. Every task measurement is explicitly unrun/null. It also works without `dist/`; absent artifact hashes are null.

`probe` separately checks disposable deterministic Node fixtures and **actual built Fabric help**. It does not run the file tasks through Fabric or a native Kiro client. This deliberately small preparation avoids requiring ripgrep, workspace binding, real approvals, or user profiles. Those runtime/client task cells stay unrun/null; Node helper timings are not Fabric performance.

Only `manifest`, `probe`, and `--help` are accepted, exactly one argument. No command strings, code, URLs, config paths, output paths, arbitrary runtimes or task counts are accepted. Output is JSON on stdout, except `--help`. Exit 0 means all attempted probes passed (or manifest prepared), 1 means a recorded probe failed or identity drifted, 2 means invalid input/setup failed. Preserve failed output; never replace it with a successful retry. A setup failure before a report is available is **missing evidence**, not a zero-cost success.

## Fixed tasks and boundaries

The fixture is 64 UTF-8 files `record-00.txt` through `record-63.txt`, each `record NN\nstatus=before\nend\n`. Its version/hash and task order are recorded. Every invocation starts fresh and cleans up in `finally`.

| Task | Deterministic probe / future client success criterion |
| --- | --- |
| 17 sequential reads | First line of records 00..16, in order, exact results |
| 64 sequential reads | First line of records 00..63, in order, exact results |
| 8 parallel reads | First line of records 00..07, eight concurrent promises, exact ordered results |
| Search → bounded read → edit → verify | Literal `record 07` search, one match; first two lines; unique `status=before` replacement; exact full-file verification and final hash |
| Bounded help | One default `api` page, then complete paging with requested limit 16000; maximum 16 pages / 100000 UTF-16 characters; validate contiguous offsets, termination, expanded local and Fabric declarations, JSON and text page bounds |

Fixture reads load these **small fixed files** with Node and return bounded line slices. Search scans in numeric order and stops at the first match. This is a deterministic fixture oracle, **not an implementation of local.grep, local.edit, approvals, or filesystem race safety**. The fixture helper returned-character sum includes serialized bounded-read strings; search additionally includes returned match indices, edit acknowledgement, and verification summary. Internal file contents are not counted as helper returns. It is not a client payload count. Latency measures one whole probe operation (including validation), excluding fixture creation/cleanup and identity hashing. Each attempted task runs once, without retries. Zero artifact rereads is observed only on completed probes that used no artifact reads; incomplete probes leave it null.

Help uses the existing `createKiroRuntime` / `normalizeFabricConfig` machinery from `dist/index.js`, following the earlier [offline runtime probe](../audits/efficiency-2026-09-05/probe-runtime.mjs), with no workspace binding, MCP/memory/state disabled, and an approver restricted to read-only `fabric.help`. It does not copy the provider paging algorithm as its measurement source: the actual guest calls help and the host validates the returned pages. The page-budget formula is a **regression assertion for this explicitly configured 20000-character nested budget**, not a claim about installed defaults. Help latency includes library import, runtime creation, first compilation, guest calls, and validation. There is one fresh service / one guest execution per invocation, no warm-service sample. OS page-cache and model-cache conditions are unknown.

Expanded declaration characters/UTF-8 bytes/SHA-256, default page text and serialized JSON characters, truncation, next offset, and page count are reported independently. `runtimeProbe.returnedChars` counts `JSON.stringify(result.value).length` for the complete help probe value, **including both the default page and complete pages**; it is neither one help-page size nor MCP projection size. All character counts use UTF-16 code units. No character-to-token conversion is performed. Source and built help can differ: tests compare the source provider with its expanded source declaration, while the CLI measures the currently built artifact and hashes it; it never assumes HEAD matches `dist/`.

## Identity, offline restrictions, unknowns

Reports record Git HEAD (null if unavailable), actual source-tree file hashes, package/lock/build-configuration hashes, installed dependency package-manifest hashes, `dist/index.js`/chunks/runtime inventories, harness hash, fixture hash, Node version/component versions/executable path/platform/architecture, requested config and its hash. The help probe additionally records the effective normalized runtime config and hash. Its private MCP config path is deliberately absent on disk and varies per run, so the exact effective hash varies too: compare the values with that disposable path mapped to `<temporary>/absent-mcp.json`, rather than ignoring other config differences. Dependency package manifests identify installed versions; they are **not a full dependency-content attestation**. Git HEAD alone does not identify a dirty tree. `sourceMatchesBuild` stays null. Probe inventories are rechecked after cleanup; drift yields exit 1. Stable endpoint inventories are not an atomic snapshot or proof against mid-run changes; coordinate with Main to avoid concurrent rebuilds.

The CLI never launches Kiro, authenticates, installs, accesses network APIs, loads installed profiles or changes defaults. It does not read/write user settings or the real user HOME outside the anchored checkout/dependency tree. Probe environment is replaced with private HOME/TMPDIR, fixed `/usr/bin:/bin` PATH and locale before dynamically importing Fabric, then restored. No local/shell provider is bound. Only fixed `/usr/bin/git rev-parse` is spawned for identity, without a shell, global Git configuration, or fsmonitor. Temp paths ignore ambient TMPDIR. It writes only a newly created private `/tmp` tree; stdout redirection is the operator's responsibility. Normal trusted Node startup/module loading still applies: this is not an OS sandbox for a hostile checkout, modified dependency, or malicious Node preload. Do not execute it with untrusted `NODE_OPTIONS` or loader flags. Inventories are bounded and reject symlinks/special files in the inventoried trees.

Measured fields live only in the named `fixtureProbe` or `runtimeProbe` boundary: result/assertions, monotonic latency, returned characters, attempted probe count, retries, artifact rereads. Unsupported/unrun fields are null, including **all** `clientMeasurement` fields, installed profile, model/client/account identity, input/output and billable cached/uncached tokens, credits, billed cost, and cost per successful comparable task. Comparable end-to-end task attempts/successes are genuinely zero, not inferred from fixture successes.

## Before/after workflow

1. Ask Main to coordinate fresh builds; this CLI never builds or modifies `dist/`. Retain the before manifest and probe output, including failures, outside the source tree. Record any setup errors too.
2. Make one separately authorized candidate change. Rebuild under Main's coordination, then run the same commands into `efficiency-after-manifest.json` and `efficiency-after-probe.json`.
3. Require matching harness/task/fixture/requested-config identities, Node/dependency conditions, intended source/build differences only, stable inventories, and identical task success assertions. Explain every config difference. If the harness changes, rerun both sides with the same harness. Do not compare an unrun/null cell to zero.
4. Compare fixture result hashes and help expanded/page sizes at their named boundaries. Latencies are noisy single offline observations, not savings or a cold/warm inference benchmark. Repeat only with a predeclared sample/order policy and retain every failed attempt. There is no percentage-savings calculation or economic acceptance gate in C1.

For later **observed** Fabric traces, reuse `node scripts/analyze-trace.mjs <trace.jsonl> --json` and [tracing semantics](tracing.md): preserve projection versus value versus bridge counts and incomplete coverage. Do not invent traces, infer client counts from helper results, or treat an absent projection as zero. No second trace analyzer is introduced here.

## C2: separately authorized live comparison, not enabled here

Before running any native-versus-Fabric inference, require explicit operator authorization, a **hard numeric spend cap with currency/account scope**, and enforcement/stop conditions covering errors, retries, validation, compaction and delayed billing. A plan or manifest is not authorization. If spend cannot be bounded/enforced, do not start.

Record exact requested and returned provider/model/revision, supported reasoning/output limits, Kiro executable/version/client/session, account/plan/pricing date/currency (nonsecret identifiers only), active native/Fabric profile and configuration hashes, source/build hashes, task/fixture version, approval policy, and request/task/attempt IDs. Fix comparable success/quality assertions before running, use disposable files, randomize/counterbalance order within the cap, and distinguish cold client/runtime/prompt cache from repeated warm conditions and OS caches. Do not change installed default profiles for this experiment.

Retain **all** attempts (failed, cancelled, retried and setup/routing failures), latency, actual client-visible returned chars, artifact rereads, success/quality evidence, original observed billable cached/uncached input and output usage categories, credits and settled monetary charges with request correlation. Cache categories, billing and client events missing from evidence remain null; do not substitute published prices or estimated tokens. Separate validator/audit spend and subscription allocation from comparable marginal task cost. Report cost per successful task as **total comparable cost of all attempts / successful comparable tasks**, only when cost coverage is complete and successes are nonzero; otherwise null. A single pilot cannot establish reliable savings or quality equivalence.

## Registered repository commands

`package.json` registers `efficiency:manifest` and `efficiency:probe`:

```sh
pnpm_config_verify_deps_before_run=warn pnpm run efficiency:manifest
pnpm_config_verify_deps_before_run=warn pnpm run efficiency:probe
```

pnpm 11 can otherwise auto-install before running scripts if dependency state differs; the direct `node` commands above avoid that wrapper entirely. Neither command builds or performs paid inference. Coordinate a fresh build separately before a built-runtime comparison.
