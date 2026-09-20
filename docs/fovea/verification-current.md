# Current-source verification supplement — 2026-09-20

## Final serial verification

Current user-requested rerun, 2026-09-20. No product-code change was needed.
The already-running check was allowed to finish; the installer and then the
explicit-reference lifecycle module ran serially with trusted standalone Node
24.20.0 via `PATH="$PWD/.tmp/trusted-node:$PATH"`.

| Check | Actual result | Evidence |
| --- | --- | --- |
| `pnpm run check` | **Exit 0**; **3,026 passed / 24 skipped**, 193 passing files / 2 skipped; **652.49s** test phase. Guidance, typecheck, build, staging, Knip, component certification and SBOM completed. | `.tmp/final-check.log`, `.tmp/vitest-report.json` |
| `pnpm run test:installer` | **Exit 0**; **965 passed / 6 skipped**, 56 passing files / 1 skipped; **243.59s**. Includes real historical-manager migration/recovery. | `.tmp/final-installer.log` |
| Explicit pinned `tests/fovea/reference-lifecycle.test.ts` | **Exit 0**, **15 passed / 0 skipped**, **11.06s**. Own/foreign/mixed/external mutations, denial/cancellation, lost acknowledgments, delivery accounting and registry/guest comparisons executed. | `.tmp/fovea-final-lifecycle.json`, `.tmp/fovea-final-lifecycle.log`, `.tmp/fovea-final-lifecycle.exit` |
| Exact artifacts | Source, built closure and complete generation identities match; current Agent archive and exact 30-package SBOM validate. | `.tmp/fovea-final-artifacts.json` |
| Candidate report | **Exit 1**, `Exact-commit evidence requires no unstaged changes to tracked files`. No candidate certificate emitted. | `.tmp/fovea-final-release-candidate.log` |
| Promotion probe | **Exit 1**, `Production release trust root unavailable: distribution BLOCKED`. No signing/activation attempted. | `.tmp/fovea-final-promotion.log` |
| Packaged hook | **Exit 3**, `host-blocked`, `native-session-rendezvous-unavailable`, `dispatched:false`. This is a fail-closed status, not a delivered model notice. | Direct `node dist/kiro-agent-closure/kiro/fovea-hook.js` probe |

The two aggregate exits were observed as `CHECK_EXIT=0` / `INSTALLER_EXIT=0`
in `/tmp/pi-fabric-shell-9xxOwt/output.log` after process 1593204 finished.
The full-suite JSON is preserved; targeted tests used a different report path.
Its Fovea subset is **327 passed / 16 skipped**: twelve absent-reference cases,
two opt-in uncontrolled upstream cold comparisons, two optional external reports.
The separate lifecycle invocation selected
`FOVEA_HOST_REFERENCE_ROOT="$PWD/.tmp/fovea-host-reference-1PG9Va/repo.git"`
and `FOVEA_REFERENCE_PARSER="$PWD/.tmp/fovea-parser/ast-grep"`.
Both pinned source objects were executed, not merely located:

- Fovea `b594483868d27b7eb37a9b185c59ce812f8a9c01`
- Pi Fabric `2ee51683452dc359702880f408e0b8a4bfcb9646`

This is fixture/component lifecycle evidence, **not native-TUI parity**.
The full-suite pass count must not be rewritten by adding the supplementary run.

### Current generation and finish step

- Source: `efbe53c962d852a01cb26a53665535dcb549d144e7ca3aba0e8185da6b3827d3`.
- Complete Linux x64 generation: `f2e29f265b7bd17ca7bf51fae509c093e334428ada417dd5183825c98440de9e`.
- Agent package: `46d9d7251051060047072722fa9476682a4f67d9019aa4a02e4c5861093fc8a5`.
- Archive SHA-256: `13801df515021340e0d7cdc0d6392a46feef3e56f4d2fa540d412a01dec9b00c`.
- SBOM SHA-256: `d26ca4457c9865588ae131075b58a8f05202c2946153ce4301db78e27b0452aa`.

A fresh final `pnpm run build` follows the ledger update. Its actual exit is
retained in `.tmp/fovea-final-build.exit`, with output in
`.tmp/fovea-final-build.log`; artifact freshness is rechecked afterwards.
Documentation-only changes do not alter captured source inputs.

### Exact remaining work

- **Native Kiro implementation:** the hook is still status-only. Authenticated
  session/rendezvous routing, prompt/turn/hidden delivery, restoration and
  queue-safe continuation are unfinished; the source collector is gated by
  trusted host capability. Existing H01/H02/H08 authentication blockers and
  all other untested gates are unchanged. A login alone does not complete this.
- **Darwin implementation:** native binding source exists and runs in Linux
  fixtures; trusted generation-local loading/packaging and Darwin provenance
  still need implementation. Production `sourcePlatform()` rejects non-Linux.
  Real macOS qualification also needs a macOS host.
- **Release:** clean exact-commit identity, production signing/trust, native
  platform/client qualification and task-effectiveness evidence remain open.
  Neither source installation nor these passing checks authorizes publication.

No commits, live-home activation, credentials/signing changes or permission
bypasses. The checks below are historical runs with their original scopes.

## Historical remaining-work retry evidence

This section supersedes the historical counts/digests below. Full native Kiro
integration and public release are still **incomplete/unqualified**.

### Acceptance ledger

| Item | Current result |
| --- | --- |
| Production cold batching | Port 0.1.1/cache header 17; real native batched cold runs and repeats match independently scheduled pinned references at 512/16000 budgets. Nine batching and eight differential cases passed; two uncontrolled-reference cases stay skipped/unqualified. See [production-cold.md](production-cold.md). |
| Native H01–H12 | Latest isolated attempt `.tmp/fovea-remaining-native.json`: H01/H02/H08 environment-blocked by `isolated-auth-unavailable`; all other gates untested. Native routing/delivery/restoration/continuation still need observed supported events and implementation. No credentials changed or automatic capability enabled. |
| macOS source adapter | Shared policy, Darwin contract and real C/N-API source implemented. 109 source-platform cases passed on Linux (including 27 compiled-binding cases). Trusted Darwin loading/packaging, native macOS execution and provenance writer remain unfinished; production Darwin stays fail-closed. See [platform-source.md](platform-source.md). |
| Historical migration | Four real archived schema-1 manager → schema-2 migration/rollback/recovery cases passed, including simultaneous retained runtimes and preserved user data. Also registered in installer bundle acceptance. Old management cannot inspect retained schema 2; use trusted new management code. See [historical-manager-migration.md](historical-manager-migration.md). |
| Local release artifacts | Current archive, exact package digest and 30-package SBOM validate, including complete vendored Fovea provenance. Candidate import scanner repaired to parse syntax instead of Git string literals. Candidate now reaches the genuine dirty-tracked-tree gate; no candidate report or release readiness is claimed. |

### Checks actually completed

- `pnpm run check`: full test phase **3,028 passed / 12 skipped**, 192 passing
  files / 2 skipped, **683.40s**. The command then exited **1** at Knip's
  undeclared fixture compiler `cc`. This is **not** an exit-0 monolithic check.
  `knip.json` now declares that external test prerequisite. The unchanged passing
  suite was not rerun; repaired Knip → component certification → SBOM stages
  completed with exit **0** (`.tmp/fovea-retry-check-tail.log` and `.exit`).
  Guidance/typecheck/build/staging had passed before the full suite.
- Full report: `.tmp/vitest-report.json`; complete check log/exit:
  `.tmp/fovea-remaining-check.log` and `.tmp/fovea-remaining-check.exit`.
  Fovea subset: **339 passed / 4 skipped**, 27 files. All **15 pinned lifecycle**
  cases executed using `.tmp/fovea-host-reference-1PG9Va/repo.git` and the pinned
  parser. Four Fovea skips are two uncontrolled cold probes and two optional
  external reports, not missing lifecycle prerequisites.
- Separate installer suite after the completed full test phase: **965 passed /
  6 skipped**, 56 passing files / 1 skipped, **267.20s**, exit **0**.
  `.tmp/fovea-retry-installer.log` and `.tmp/fovea-retry-installer.exit`.
- Initial two repairs (installed port-version pin and missing audit entries):
  **23/23 passed**, `.tmp/fovea-retry-targeted.json`. Actual installed MCP
  analysis, doctor, archive removal, retained generations and rollback execute
  in the independence fixture; its Kiro launcher is a fixture, not native UI.
- Subsequent release-only scanner repair: **58/58 passed** across packed-import,
  package-boundary, release-workflow and release-artifact tests,
  `.tmp/fovea-retry-release-tests.json`. Static imports, re-exports, side-effect
  imports and literal dynamic imports still reject absent files. Full typecheck
  and Knip passed again. These release-only edits postdate the full suite and do
  not change `captureBuildInputs()` or installed runtime bytes.
- Final fresh build evidence: `.tmp/fovea-retry-final-build.log`; source/closure/
  bundle identity and documentation inventory are checked again before handoff.

### Current identities and release refusal

- Source: `efbe53c962d852a01cb26a53665535dcb549d144e7ca3aba0e8185da6b3827d3`.
- Linux x64 complete generation:
  `f2e29f265b7bd17ca7bf51fae509c093e334428ada417dd5183825c98440de9e`.
- Component package:
  `46d9d7251051060047072722fa9476682a4f67d9019aa4a02e4c5861093fc8a5`.
- Agent archive SHA-256:
  `13801df515021340e0d7cdc0d6392a46feef3e56f4d2fa540d412a01dec9b00c`.
- SBOM file SHA-256:
  `d26ca4457c9865588ae131075b58a8f05202c2946153ce4301db78e27b0452aa`.
- Direct artifact validation: `.tmp/fovea-retry-artifacts.json`; archive:
  `.tmp/fovea-retry-archive.log`.
- `node scripts/release-candidate-report.mjs` now exits **1** with
  `Exact-commit evidence requires no unstaged changes to tracked files`.
  `.tmp/fovea-retry-release-candidate.log` and `.exit`. Work was neither reset
  nor committed to bypass this requirement. Separate promotion probes still
  reject unavailable production trust before reading artifacts. Production
  signing, four-target exact-bundle CI and authenticated/native-TUI qualification
  remain outstanding even after a future clean commit.

No live-home activation, login, signing-key creation, commit, push or publication.
The interrupted `.tmp/fovea-retry-check.log` has no successful completion and is
not used as qualification evidence.

## Historical conversation-control verification — 2026-09-20

This supplement records an independent verification continuation. It does not
replace the implementation owner's [ledger](implementation-status.md), and is
**not a claim of full native integration, complete parity, or release readiness**.
No product source was changed during this continuation.

## Independent serial rerun requested by the user

Fresh verification on 2026-09-20; no product-code fixes or live-home activation:

- `PATH="$PWD/.tmp/trusted-node:$PATH" pnpm run check` completed guidance,
  typecheck, build, staging, full tests, Knip, component certification and SBOM.
  **2,862 passed / 10 skipped**, 185 passing files / 2 skipped, **550.29s** test
  phase (local start 16:51:23). The retained `.tmp/vitest-report.json` independently
  reports `success: true`, zero failed tests and 187 files; this is the new run,
  not the earlier 546.79s result below.
- `PATH="$PWD/.tmp/trusted-node:$PATH" pnpm run test:installer` completed
  separately and serially with actual exit **0**: **961 passed / 6 skipped**,
  55 passing files / 1 skipped, **185.34s**. Complete retained log:
  `.tmp/fovea-reverify-installer-kAfXez.log`. The command preserved the installer
  process exit status rather than the exit of a log-tail pipeline.
- `git diff --check` passed. The full check's SBOM contains 30 packages and
  component package digest
  `dd2de042791799947672ea5f00c510f2b968c70e07c829cbbf064dca066c9a0f`.
  Component MCP certification still explicitly reports authenticated Kiro
  **NOT TESTED**; none of the native capability gates is promoted by this rerun.
- Verification-only documentation is outside `captureBuildInputs()`; the
  recorded closure still has source digest
  `997c9f034121a6a39ab4f06ef9c886eea1b9134df11686c06b7a8490824eb1d3`.

## Exact tree and artifacts

- Base revision: `1dd4df19aac5e3ab4e404a4b43a133e59da6488a`; working tree is uncommitted.
- Captured source digest: `997c9f034121a6a39ab4f06ef9c886eea1b9134df11686c06b7a8490824eb1d3`.
- Complete Linux x64 generation: `4d96d38d6707bb81c2137b7597c50649db78fd0958d5e3359d9e32fa1f0b44c1`.
- Bundle: `.tmp/kiro-fabric-bundle-linux-x64-4d96d38d6707bb81c2137b7597c50649db78fd0958d5e3359d9e32fa1f0b44c1/`; complete bytes: **201,572,672**.
- Current `captureBuildInputs()` digest was mechanically compared with both
  the built closure's `buildInputs.digest` and the bundle's `sourceDigest`: equal.
- ast-grep **0.45.3**, SHA-256 `7a5ab30160186184c0bf8bffc87da4af25123c183964cd98c11b0b354137db0a`.
  The unrelated PATH parser is **0.45.2** and was not used as runtime authority.

## Commands and current evidence

The verification owner had already started the serial checks; this continuation
inspected their exact exit files, logs and full-suite JSON instead of starting
a competing suite. These counts apply to the source digest above, not a previous
conversation's estimate.

| Check | Result / artifact |
| --- | --- |
| `pnpm run check` | Exit **0**; **2,862 passed, 10 skipped**, 185 files passed / 2 skipped; 546.79s test phase. `.tmp/fovea-owner-check.log`, `.tmp/fovea-owner-check.exit`, `.tmp/vitest-report.json`. Typecheck, build, guidance, Knip, component certification and SBOM passed. |
| `pnpm run test:installer` | Exit **0**; **961 passed, 6 skipped**, 55 files passed / 1 skipped; 188.31s. `.tmp/fovea-owner-installer.log`, `.tmp/fovea-owner-installer.exit`. |
| Fovea subset in the full JSON report | **173 passed, 2 skipped**, 20 files; optional external-report cases remain skipped. |
| Fresh `bash ./install.sh --source --kiro-home "$TEST_HOME/.kiro" --yes --non-interactive --no-shell-integration` | Exit **0**, verified current generation reused and activated only in a new private external HOME/KIRO_HOME. `.tmp/fovea-current-source-install.log`, `.tmp/fovea-current-source-install.exit`. |
| `node .tmp/fovea-current-installed.mjs` | Exit **0**; actual installed profile command, args, environment and private parser. [Sanitized report](installed-composition-probe.json); `.tmp/fovea-current-installed-probe.log`, `.tmp/fovea-current-installed-probe.exit`. |
| Source/closure/bundle identity assertion and `git diff --check` | Passed. |

The independent installed probe adds exact `repo.focusRead` → `local.readMany`
SHA-256 verification, generic registry `tools.call({ref:"repo.status",args:{}})`
parity, and immutable `repo.result` replay to status-with-zero-engine-starts,
focus/dwell continuity across independent guest executions, one persistent
engine, and bounded shutdown. It drives actual installed MCP, **not a native
Kiro model or TUI**. It uses minimal PATH and performs no login or live-home
activation. The private probe driver/report are retained under `.tmp/`.

The post-settlement collector and conversation/epoch settings/rule-isolation
repair are present in the current source and covered by the full check. Managed
profiles still do not enable automatic Fovea delivery. The packaged hook remains
a status-only fail-closed entry; its diagnostic is not host-capability evidence.

## Reference update and remaining work

The earlier missing Pi Fabric object diagnosis is historical. An isolated
reference checkout now contains `2ee51683452dc359702880f408e0b8a4bfcb9646`, and the
fresh reference report `/tmp/fovea-qualification-uGuIzO/reference-report.json`
reports `hostReferenceStatus: "archived-not-executed"`, with no acquisition
blockers. The sibling checkout was not reset. **Archival is not lifecycle replay.**
The pinned Fovea analysis comparison passed its mini-fixture at 512/16000 budgets;
all-language/history/lifecycle parity has not been certified.

Still unfinished/unqualified:

- Native authenticated session/host/hook routing, prompt/post-tool/turn delivery,
  restoration/compaction, hidden presentation and queue-safe continuation.
  Isolated headless chat hit authentication bootstrap failure before JSON events;
  H01/H02/H08 are environment-blocked, the other unexercised gates are untested.
- Safe non-Linux source-capture implementation and native platform qualification;
  parser artifact hashes alone are insufficient. New Linux x64 parser requires
  glibc >=2.34.
- Complete pinned lifecycle/history corpus, old-manager cross-schema migration,
  production signing, and repeated controlled task-effectiveness measurements.

The owner's current `.tmp/fovea-built-probe.json` measured **140.53ms cold /
7.85ms warm** and **159,125,504 bytes host RSS**, with one engine start, on one
tiny synthetic fixture. Exact source validation still performs bounded reads;
warm graph reuse is not zero I/O. The parser adds **52,360,880 bytes** to the
Linux x64 generation. These are observations and footprint tradeoffs, not
latency distributions, child-memory bounds or production guarantees.

No model-token savings, correctness improvement, complete-family parity or
public release is claimed. No commits, pushes,
publication, credential changes, permission weakening or live-home installation
were performed.

Final `pnpm run build` **passed** (exit 0): `.tmp/fovea-current-final-build.log`
and `.tmp/fovea-current-final-build.exit`. Fresh closure: **89 files,
15,509,305 bytes, 129 source modules**. Source/closure/bundle equality and all
recorded exit files were checked again after the build.
