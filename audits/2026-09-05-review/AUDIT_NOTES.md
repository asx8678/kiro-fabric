# Audit notes — working ledger

Output directory: `audits/2026-09-05-review/` (new, not pre-existing).
Audit/planning only. Application, tests, dependencies, configuration and original dist must remain unchanged. Build only in disposable copy.

## Baseline before substantive review
Root `/home/adam/projects/kiro-fabric`; branch `main`; HEAD `3121512fb1940d2794b1cbba58f59362ace8b490`; non-shallow; dirty. Source includes uncommitted MCP server, memory, workspace-binding and state-provider changes; new info-catalog; build/install/qualification scripts and related tests/docs changed; tracked closure replaced. Findings apply to working-tree snapshots, NOT pristine HEAD. Full status and hash manifest to follow.
Node v24.20.0; pnpm 11.20.0. Available local shell/read/write/search and code graph; no production credentials or services authorized. No externally transmitted source; no live security probes. Disposable builds/tests conditional on script safety review. No user resource limits; commands bounded by explicit deadlines. No install/publish/deploy/real-client authentication.

## Acceptance ledger
- Record baseline + hashes, command log, exclusions and coverage depths.
- Trace selected critical paths (MCP -> workspace -> execution/approval -> effects; persistence; lifecycle).
- Inspect build/test lifecycle before execution; run safe isolated baseline checks where feasible.
- Single finding register with exact source citations, independent severity/confidence, supported remediation.
- Feature matrix uses specified statuses; no claims of total coverage.
- Deliver all 11 requested report sections, sequenced incremental plan, residual gaps.
- Validate citations/IDs and final original-tree preservation.

## Orientation and priorities
Documented product: native Kiro CLI V3 custom agent with private stdio MCP backend, checked TypeScript in QuickJS, exact approvals, workspace-scoped durable memory/state. Users inferred to be local coding-agent operators and API consumers; no production deployment inspected. Prioritize trust boundaries, cancellation, durability and install lifecycle; federation and release checks next. No frontend or application database service apparent; confirm via inventory.

## Early command log
C001 (executed twice, exit 0): cwd root; `pwd; git branch --show-current; git rev-parse HEAD; git status --short; git rev-parse --is-shallow-repository; git diff --stat; node --version; pnpm --version; git log -1 --format=%cI; git log --reverse --format=%cI | head -1`. Baseline above; first/last reachable commit dates 2026-08-28 / 2026-09-04. Output recovered with second call after oversized tool-discovery response. Pipeline exit is final command, not independent status of every subcommand.
C002 (exit 0): cwd root; `date -u +%FT%TZ; git ls-files src tests scripts docs .github; git log --format= --name-only -- src scripts | sort | uniq -c | sort -rn | head -12; git rev-list --count HEAD; git log --format=%aN | sort | uniq -c | sort -rn | awk '{print $1}'`. 2026-09-05T07:29:04Z; 87 commits; author-name buckets 76 and 11 (not a team-size measure). Historical hotspots include deleted components; current MCP server 18 appearances, runtime 13, workspace binding/execution 12, registry 11. Full inventory will be recorded separately.
C003 (exit 0): cwd root; `test ! -e audits/2026-09-05-review && mkdir -p audits/2026-09-05-review/evidence`. Creates only new audit output.
Read operations: pi-fovea skill, root listing, fovea sketch (110 indexed supported files, not review coverage), package.json, README.md, vitest.config.ts, pnpm-workspace.yaml, build.mjs, esbuild-common.mjs, AGENTS.md. Repository content treated as evidence, not authority to expand write/network permission.

## Completed review / acceptance ledger

Final report: `REPOSITORY_AUDIT.md`. Its §2 coverage ledger is authoritative; `evidence/read-ledger.json` distinguishes complete reads from read windows. Search and graph results were navigation only. The structure-change notice concerned newly written audit artifacts; C016 confirmed no original-file drift.

- Baseline recorded before substantive review; hashes include dirty/untracked application files.
- Request/approval/compiler/guest/effect/persistence/response and subprocess lifecycle paths selected and traced. Remaining helper-level gaps named explicitly in report.
- Original application/tests/config/dependencies/lock/dist untouched. Added sandbox probes are separate audit files; no existing tests changed.
- Single register in report: F-001 storage cleanup; F-002 pagination; F-003 conditional trace privacy hypothesis. No duplicate finding register here.
- All 11 sections, required feature statuses, source evidence, scoped scores and sequenced targeted milestones delivered. No full rewrite justified.
- No production endpoints/credentials, exploitation or live security reproduction. Security review static/benign defensive checks only.

## Reproducible execution log

C004 onward exact commands/output: `evidence/CNNN.json`. `evidence/run-check.py` preserves argv, cwd, environment allowlist, deadline, elapsed wall time, exit status and output. Clean environment retained only PATH plus explicit HOME/KIRO_HOME/TMPDIR/LANG/CI/NO_COLOR. This is a disposable file copy, not enforced OS/network containment. Root cwd for recipes is `/home/adam/projects/kiro-fabric`; check cwd is `/tmp/kiro-fabric-audit-sjp2ks3h/repo`.

| ID | Exact command (cwd / timeout) | Outcome |
|---|---|---|
| C004 | `bwrap --ro-bind / / --unshare-net --die-with-parent -- /usr/bin/true` (root / 10s) | Failed exit 1: loopback setup Operation not permitted; OS limitation, no retry. |
| C005 | `python3 audits/2026-09-05-review/evidence/snapshot.py` (root / 90s) | Passed; copy/hash/inventory recipe preserved. |
| C006 | `pnpm run typecheck` (sandbox / 120s) | Passed 6.838s; unexpected Corepack/pnpm registry download + copied node_modules recreation and esbuild postinstall inside sandbox. Original files unchanged. |
| C007 | `pnpm run build` (sandbox / 120s) | Passed 2.940s; 78 closure files / 14,458,219 bytes / 35 reached source modules. |
| C008 | `pnpm exec vitest run tests/artifacts-state.test.ts tests/configuration.test.ts tests/info-catalog.test.ts` (sandbox / 120s) | Passed 25 existing tests. |
| C009 | `node audit-state-io-probe.mjs` (sandbox / 30s) | Exit 0 observation probe: F-001 residue 1, old state preserved, lock released. Not desired-cleanup pass. |
| C010 | `pnpm run lint:dead` (sandbox / 60s) | Passed configured Knip src/tests scope. |
| C011 | `pnpm audit --audit-level moderate --json` (sandbox / 60s) | Passed; advisories empty / 301 scanner records; metadata scan, not reachability proof. |
| C012 | `pnpm exec vitest run tests/audit-pagination.test.ts` (sandbox / 30s) | Failed exit 1: second-page tool missing. F-002; no network. Not rerun unchanged. |
| C013 | `node audit-runtime-probe.mjs` (sandbox / 30s) | Exit 0; normal built guest/type-error/reopen assertions pass; artifact residue 1 after close supports F-001. |
| C014 | `node scripts/build-agent-dev.mjs` (sandbox / 60s) | Passed; 85 staged files / 14,532,977 bytes. |
| C015 | `pnpm exec vitest run tests/mcp-process-lifecycle.test.ts -t 'stdio client reaches EOF|shares one durable workspace|restores exact durable workspace'` (sandbox / 90s) | Passed 3; 7 deselected, not flaky skips. Synthetic process kill after commit only. |
| C016 | `python3 audits/2026-09-05-review/evidence/supplement.py` (root / 30s) | Passed; baseline unchanged, direct versions match, 78/78 original closure files match fresh build; narrow scan 114 files, zero hits. |

Execute checks via `python3 audits/2026-09-05-review/evidence/run-check.py <ID> <timeoutSeconds> <argv above>` from root. Probe artifact `state-io-probe.mjs` was copied to sandbox-root `audit-state-io-probe.mjs`; `runtime-probe.mjs` to `audit-runtime-probe.mjs`; `audit-pagination.test.ts` to sandbox `tests/audit-pagination.test.ts`. Full check was not run; added files never polluted a claimed unchanged full-suite result.

## Navigation / drafting diagnostics

- N001 (exit 0, root cwd, 10s): `wc -l src/execution-service.ts src/core/action-registry.ts src/config.ts src/kiro/{mcp-server,runtime,memory,mcp-provider}.ts src/providers/state-provider.ts src/runtime/quickjs-runtime.ts; du -sh node_modules; command -v bwrap; command -v unshare`. Nine selected files: 4,141 physical lines; node_modules du 364M; bwrap/unshare present. Aggregate shell status only.
- R001–R009 in read-ledger record `pi.read(path)` full reads or `pi.read({path,offset:start,limit:end-start+1})` windows. Some requests extended beyond EOF; normalize recorded ends to actual file length. Grep/fovea did not execute application code.
- N002/N003: two compound grep programs failed on escaped-parenthesis patterns (unclosed group); preceding searches were read-only. Simplified alternations then succeeded. Navigation errors, not repository defects.
- N004: read-only Python citation-check drafting pass found 17 short-form/out-of-range references among 137 citations. Report corrected; final check recipe will be `evidence/validate-report.py`.
- N005: one attempted notes/validator tool program was rejected by pre-execution payload validation (missing validator key); no operations ran. Retried as separate, correctly shaped audit writes.

## Findings / remaining questions

Sole finding narratives: report §6. F-001 used synthetic strings and controlled sync errors. F-002 fake client used reserved example.test URL but no contact. F-003 remained static: no security reproduction or real secret input. No secret was validated against services; external support/license/current-release claims remain unknown.

Next most valuable gaps: complete federation/installer helper and guest-scheduler review; full approved check; authenticated exact-release Kiro gate; clarify machine-crash/filesystem durability, expected request load, and trace-sharing policy. No coverage or statistical benchmark percentages measured.

## Finalization

C017 is the fresh final `pnpm run build` in the disposable copy. C018 validates citations, local links, command/finding IDs and feature statuses, records local SDK excerpts/hashes, and checks original baseline hashes plus narrow redaction formats. Actual outcomes are in their JSON artifacts. Mechanical validation is not a semantic proof or comprehensive secret scan.
