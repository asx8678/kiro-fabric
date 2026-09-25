# Navigator implementation status ledger

Updated 2026-09-20. **Implemented components; full native integration remains
unqualified/incomplete at explicit host/platform gates.** This is not a claim
of complete parity or public-release readiness.

## Current follow-up

[completion-ledger.md](completion-ledger.md) owns the latest eight-item
implementation and verification state. The results below retain their original
revision, platform and scope; they are not fresh counts for the current tree.
Authenticated Darwin arm64 explicit navigation now works. Neither a successful
login nor one explicit tool call qualifies the complete native lifecycle gates.

## macOS explicit analysis activated

The later [macOS activation report](macos-activation.md) supersedes the Darwin
source-loading/packaging blocker for explicit read-only navigation: generation-
verified native binding, installed Fabric 0.65.0, and a real Kiro 2.22.1 source
match on Darwin arm64. It does **not** promote native H-gates, Darwin provenance,
four-target release qualification, or the historical Linux test counts below.

## Historical verification and remaining gates

See [verification-current.md](verification-current.md#final-serial-verification)
for the latest complete rerun: `pnpm run check` **exit 0**, **3,026 passed /
24 skipped**; serial installer suite **exit 0**, **965 passed / 6 skipped**.
The full run lacked the retained Pi Fabric reference setting, so 12 lifecycle
cases were skipped there. A separate explicit-reference run then passed
**15/15 with zero skips**, including all 12 previously skipped cases. Counts
are kept separate, not relabeled as one fully qualified suite. No product-code
fixes were needed. The earlier 3,028/12 check and its lint repair below are
historical, not the exit evidence for this rerun.

The POSIX native binding source now exists and runs in Linux fixtures, but
trusted Darwin loading/packaging, native macOS execution and provenance support
remain unfinished. Four historical-manager cases close the scoped migration
qualification gap. Local archive/SBOM validation passes; candidate generation
still refuses the dirty tracked tree, and production signing/CI/native-client
qualification remain blocked. The sections below retain earlier evidence scopes.

## Historical verification — remaining-work revision

See [remaining-verification.md](remaining-verification.md) for current results:
**3,028 passed / 12 skipped** in the complete suite; **965 passed / 6 skipped**
in serial installer acceptance (including the newly registered genuine
historical migration). The full `check` invocation stopped **after green tests**
at an undeclared fixture compiler in Knip; `cc` was declared and typecheck,
Knip, certification and both SBOM stages passed on resumption. No claim of a
second whole-suite run or original `check` exit 0 is made.

Fresh disposable source installation and installed doctor passed; a direct built
public-host probe verified exact source hashes, lazy/persistent engine ownership,
dwell, replay and revocation. Agent archive succeeded. Candidate reporting
refuses this uncommitted tree; promotion separately refuses the absent production
trust root. These refusals were not bypassed.

Darwin adapter **and actual POSIX/N-API source** are implemented, with **109**
neutral/Linux-native regression cases. Generation-local authenticated loading,
manifest/architecture binding, native packaging and Darwin provenance remain
implementation work; macOS execution is environment-blocked. Production Darwin
stays unavailable. Full native Kiro integration and public release remain
**incomplete/unqualified**.

## Historical remaining-work follow-up

- **Production cold batching:** implemented and tested, port 0.1.1/core cache
  header 17. Real native multi-file/multi-rule runs repeat byte-for-byte and match
  the independently scheduled pinned reference at budgets 512 and 16000.
  See [production-cold.md](production-cold.md); prior v16 cold/tape/warm-cache
  claims below are historical and retain their original scope.
- **Native Kiro:** fresh isolated probe still hits `isolated-auth-unavailable`;
  H01/H02/H08 environment-blocked, other gates untested. Evidence:
  `.tmp/fovea-remaining-native.json`. No automatic native behavior was enabled.
- **Historical manager:** four real schema-1 → schema-2 handoff/rollback/recovery
  tests implemented; [historical-manager-migration.md](historical-manager-migration.md).
  Old management cannot inspect a retained schema-2 generation after rollback;
  use trusted new management code, without deleting newer user data.
- **Platform and final release verification:** current work/results are tracked
  in the remaining-work note (archived in Git history). No macOS, signed public-release,
  native-TUI or complete-parity qualification is implied by source tests.

## Baseline / authority

Target `1dd4df19aac5e3ab4e404a4b43a133e59da6488a`, package 0.65.0; initially
clean. Pinned Fovea `b594483868d27b7eb37a9b185c59ce812f8a9c01` (0.29.2).
Kiro CLI 2.22.0, Node 24.20.0, Linux x64. No unrelated work was reset; no
commits, credentials changes or live-home activation occurred.

## Implementation

| Phase | Current scope / outcome |
| --- | --- |
| 0 | Baseline, machine-readable parity matrix, bounded capability prerequisites and isolated pinned reference harness implemented. Native capability gates remain unqualified. |
| 1 | Faithful owned core; exact SHA-256 snapshots; private parser/Git; numerical/corpus tests and strict 512/16000-budget differential passed. Full reference lifecycle corpus not certified. |
| 2 | Persistent host above workspace runtimes, supervised child, epoch leases, cancellation, typed native repo registry/facade, immutable results and exact source composition. |
| 3 | Actual successful-access/committed-transition observer independent of continuity/tracing; transient hybrid grep; replayable results, gap-safe accounting. |
| 4 | Core sync, private committed-transition journal, own/foreign/mixed/unattributed origins, trusted delivery acknowledgment, 32-root/two-hot-root retention and project controls. Native hook/projection/continuation/restoration remain inactive, not replaced by mocks. |
| 5 | Closed schema-2 complete generation with engine/hook/parser/rules/resources/notices/SBOM; historical schema validation retained; real disposable installed analysis, update/rollback/retirement passed. Real archived schema-1 manager handoff, runtime coexistence, cross-schema rollback and interrupted activation now have four passing cases; old-manager maintenance after schema-2 retention remains unsupported. |
| 6 | Full test phase and installer acceptance passed; the check's Knip failure was repaired and lint/certification/SBOM resumed successfully. Native TUI, multi-platform source access and repeated task-effectiveness qualification remain outstanding. |

## Follow-up implementation / acceptance ledger

The verification owner inspected the actual executor changes and continued
implementation rather than treating the inherited passing summary as completion.
The requested on-disk `KIRO_FABRIC_FOVEA_IMPLEMENTATION.md` was not present;
the complete brief supplied in the user request remains the requirements source.

- Added `src/kiro/fovea-context.ts`: host-owned post-settlement collection,
  complete serialized output budgeting, shared channel claims, cancellation/
  revocation at transport publication, and emitted-versus-acknowledged accounting.
- Connected the collector in `src/kiro/mcp-server.ts` behind **host-only qualified
  analysis/visible-delivery capability**. Managed/native profiles remain off;
  this is implemented source/component behavior, not qualified native delivery.
- Fixed stable sync notice replay, pending notice retention across clean reverts,
  older-acknowledgment baseline safety, scoped notice counts, and 128-token sync
  configuration. No source-effect or approval policy was relaxed.
- Added closed bounded coverage schemas and matching checked guest types.
  Omitted/truncated coverage fields remain unknown, not zero; no new completeness
  claim. `tests/fovea/coverage-contract.test.ts` exercises actual engine packets.
- Native probe now attempts real isolated chat/listing, with conditional resume/
  concurrency branches. Actual Kiro 2.22.0 failed authentication bootstrap before
  native JSON events. H01/H02/H08 are environment-blocked; unexercised gates are
  untested. See `docs/fovea/native-probe-report.json`.

Follow-up checks already run: targeted host/delivery/engine regressions **54/54**;
built MCP collector **2/2**; coverage **7/7**; capability harness **21/21**;
complete typecheck passed; fresh intermediate build passed. The initial built
MCP fixture lacked its local-provider `rg` prerequisite; supplying the fixture's
normal PATH fixed both cases, without changing production parser authority.
Fresh full check/installer/installed evidence is recorded below.

## Final verification owner — conversation control isolation

Read-only inspection found session settings and adopted-rule trust were still
host-wide even though graph/focus state was conversation-owned. New regressions
reproduced cross-conversation leakage before the fix (two boundary failures and
one real-parser/built-child trust failure). `src/fovea/host.ts` now retains these
controls by validated conversation ID + epoch, with 128-epoch/32-worktree limits.
Same-conversation roaming/rebinding retains controls; independent conversations
and new epochs do not inherit them. Persistent project/global settings remain
shared intentionally. Rejected bindings release their leases.

The affected boundary/process/config/delivery/provenance modules passed **57/57**
after the repair. The additional trust-cap regression passed in the fresh full
check: **2862 passed / 10 skipped**, 185 passing files, **546.79s** test phase.
Separate serial installer acceptance: **961 passed / 6 skipped**, **188.31s**.
The Fovea subset in that full report is **173 passed / 2 skipped**, 20 files.
Both strict pinned differential budgets executed successfully.

Fresh source installation in an external disposable HOME/KIRO_HOME and exact
installed-profile MCP analysis passed. Installed generation:
`4d96d38d6707bb81c2137b7597c50649db78fd0958d5e3359d9e32fa1f0b44c1`;
source digest: `997c9f034121a6a39ab4f06ef9c886eea1b9134df11686c06b7a8490824eb1d3`.
Doctor reports healthy while explicitly retaining signing/native-client gates.
Direct built probe: **140.53ms cold / 7.85ms warm**, **159125504 bytes host RSS**,
one tiny fixture, one engine; no effectiveness or distribution claim.

The exact Pi Fabric reference object was fetched credential-free into a new
private development Git store, without modifying sibling checkouts. A fresh
oracle run has no prerequisite blockers; Fovea executed, Pi Fabric was archived
but not executed. Its missing-object blocker is resolved; full lifecycle replay
is remaining verification work. Optional fresh oracle-report assertions:
**6 passed / 1 skipped**. See `acceptance.md` and `qualification.json` for current
commands, final build evidence, scopes and exact remaining gates. Earlier
installed digests and check counts below are historical, not this revision.

## Latest qualification (prior follow-up tree)

- Full `pnpm run check`: **2858 passed / 10 skipped**, 185 passing files; typecheck, build, dead-code lint, staging, certification and SBOM all passed.
- Separate serial `pnpm run test:installer`: **961 passed / 6 skipped**, 55 passing files.
- Actual `install.sh --source` in a fresh external private HOME/KIRO_HOME: **passed**, no shell integration or live-home mutation. Checkout-local home was correctly rejected first.
- Exact installed profile command, args and bound environment: **passed** direct MCP probe with private parser, hash-bound reads, zero-start status, one engine and focus/dwell continuity across guest executions. See [installed-probe-report.json](installed-probe-report.json). Generation: `f0ef99b87aca84c55e7647737ff610b8c0b99d76ee3468f711830a6ce4f6cb9c`; source digest: `db956aea3a8194bb487b800eec0a235e41cb821d229a71214540147f13cabe75`. Candidate-only smoke initially rejected the installed data binding; harness corrected, production protection preserved.
- Fresh built probe: cold **140.99 ms**, warm **6.83 ms**, RSS **158892032 bytes**, one tiny fixture only; not a latency distribution or effectiveness claim. Replay and revocation passed.
- Further source fixes: bounded built-in rules inventory and retained deferred hash-bound read windows. The overflow regression supplies synthetic hints without changing pinned upstream selection.

**Not full-native completion:** managed profiles intentionally leave automatic
analysis/delivery off. Native prompt/turn hook rendezvous, hidden model delivery,
restoration and queue-safe continuation are unfinished/unqualified. Isolated
Kiro chat failed authentication bootstrap; unexercised UI gates are untested,
not demonstrated incompatibilities. No login, credential inspection, active
profile change, native fallback claim, or fabricated qualification occurred.

## Inherited verification (before follow-up edits)

- `pnpm run check`: exit 0; **2825 passed, 10 skipped**, 182 passed files / 2 skipped;
  test phase **561.86s**. Typecheck/build/guidance/Knip/certification/SBOM passed.
- `pnpm run test:installer`: exit 0; **961 passed, 6 skipped**, 55 passed files / 1 skipped;
  **187.92s**.
- Fovea subset: **136 passed, 2 optional external-report tests skipped**, 17 files.
- Strict pinned differential passed at 512 and 16000 estimated-token budgets.
- Direct public built-host probe passed lazy startup, persistent focus/dwell,
  exact source hash, immutable replay, revocation and shutdown.
- Native capability harness ran new CLI help/version only. H01-H12 blocked/
  unqualified, **not proven unavailable and not passed**.
- Four ast-grep artifact pins verified, only Linux x64 executed; source access is
  Linux-only. No native model-token savings or full-task quality claim.

Final source regression repaired a child-reaping race without changing the
1500ms cleanup/200ms census bounds. The subsequent complete check passed;
installer acceptance also passed when run separately after the combined wrapper
reached its orchestration deadline. Current exact exits and logs are in `.tmp/`.

## Independent user-requested full-check / installer rerun

The current tree was rechecked serially without product-code edits:
`pnpm run check` completed with **2862 passed / 10 skipped** (**550.29s**),
including guidance/typecheck/build/Knip/component certification/SBOM;
`pnpm run test:installer` exited **0**, **961 passed / 6 skipped** (**185.34s**).
Both used `PATH="$PWD/.tmp/trusted-node:$PATH"` (standalone Node 24.20.0).
Fresh retained evidence: `.tmp/vitest-report.json` and
`.tmp/fovea-reverify-installer-kAfXez.log`; details in
[verification-current.md](verification-current.md). No fixes were needed.
Native-client, non-Linux source access and historical-manager qualification
remain separate unfinished work, not passing results of these suites.

## Remaining gates / handoff

See `docs/fovea/acceptance.md` for installed digest/size, measured tradeoffs,
commands, fixes and exact blockers. Primary gaps: qualified native routing and
delivery/continuation/restoration, macOS scope-safe source adapter, complete
pinned lifecycle/history evidence, historical-manager cross-schema migration,
public signing/platform/native-client/task-effectiveness qualification.

No disabled mandatory feature is counted as a pass. Representative component
coverage is not a full-family parity certificate. The packaged hook is a
status-only fail-closed entry, not an implemented native transport.

## Pinned lifecycle follow-up

Added `scripts/fovea-lifecycle-harness.mjs` and
`tests/fovea/reference-lifecycle.test.ts`. Both exact reference commits now
**execute**: original Fovea extension/listeners and Pi Fabric capture
catalog/wrapper/provider, driven by an explicitly synthetic runner/read tool.
The trace contains 18 assertions, 50 events and 14 checkpoints; the approved
native host/registry/guest comparison passes shared invariants. See
[lifecycle-replay.md](lifecycle-replay.md) for commands, acceptance checks and
omissions. This supersedes the earlier archived-only Pi Fabric status for this
component surface, not for the real Pi UI or native Kiro lifecycle.

Pinned compaction retains focus/baseline while persisting roots; resume/tree
restoration clears focus/baseline and preserves graph caches. We do not invent
native lifecycle events to claim parity. H01–H12 remain unchanged; managed
automatic behavior stays off. No product behavior or credentials changed.

Current scoped verification: **180 Fovea tests passed / 2 optional report cases
skipped**, 21 files; both pinned differential budgets and all seven new lifecycle
cases executed. The initial combined run found one package-boundary failure:
the new development harness needed the existing oracle's narrow exception.
The repair also prohibits Pi host imports/environment settings in every emitted
runtime JS file. Boundary rerun: **10/10 passed**. Typecheck, Knip, staged build
and standalone replay passed. Reports: `.tmp/fovea-lifecycle-tests.json`,
`.tmp/fovea-lifecycle-boundary-tests.json`; retained direct trace:
`/tmp/fovea-qualification-sqBNE6/lifecycle-report.json`.
No full-check or installer rerun is claimed for this development-only change;
the earlier full-suite report was not overwritten.

## Next queue (owner-selected)

Source implementation and qualification both remain. Priority:

1. Native host integration: H01/H02/H08 are environment-blocked by the isolated Kiro authentication attempt; H03–H07/H09–H12 remain untested. Hook routing, delivery, restoration and continuation still need implementation as well as qualification. Use authenticated client access only within the authorized test scope; do not create/change auth or fabricate evidence.
2. Mutation/provenance and continuation-request replay now execute at the fixture/component surface (see below). Real Pi host behavior and independent cold-family parity remain open. Cold reference self-comparison is nondeterministic; do not promote warm-cache compatibility to cold extraction parity. Credential-free component tests cannot close Kiro gates.
3. Cross-schema historical-manager migration: extend qualification to a real old-manager -> schema 2 handoff if a gap remains beyond tests/managed-installation.test.ts and tests/installed-bundle-history.test.ts.
4. Non-Linux (macOS) scope-safe source adapter + native platform qualification; descriptor-relative capture is currently Linux-only.
5. Release qualification (signing/CI bundle) - separate gate.

## Mutation replay and cold-family follow-up

The pinned trace now has **144 events / 14 checkpoints / 47 assertions** and
seven actual mutation verdicts. `tests/fovea/reference-lifecycle.test.ts` passes
**15/15**: original hooks/capture pipeline plus native approved QuickJS
write/edit publication, exact shared-journal origins, denied/failed/cancelled
operations, stable outbox claims, transport cancellation and lost acknowledgments.
The native lost-ack case intentionally preserves current-session ownership where
the pinned failed-result hook leaves it unattributed. Continuation requests are
not model execution; automatic native behavior remains off.

Scoped verification: **47 passing Fovea tests / 2 explicitly unqualified cold
cases skipped**, six modules; corrected package-boundary rerun **10/10**;
typecheck and Knip passed. No product source or boundary exemption was changed.
See `lifecycle-replay.md` for reports, reproduction and final build evidence.

**Newly exposed qualification gap, not repaired or counted as passing:** the
opt-in independent cold-family corpus (46 files, 17 queries, budgets 512/16000)
failed strict comparison twice. Pinned-reference repeats also differ. Async
source completion changes parser file/rule order, and match ordering changes
facts/edges/generation hashes. Positive protocol/navigation checks pass, but
full cold extraction parity remains unqualified. The older two green differential
cases reuse oracle-warmed facts; their evidence is warm-operation/cache
compatibility only. A speculative parser tape could not preserve exact rule
inputs and was removed, not loosened into a green test. The strict cold gate
remains opt-in and visibly skipped by default, with raw failure evidence retained.

Full native integration is still **incomplete/unqualified**. No credentials,
active profiles, native H gates, full-check/installer counts or historical
full-suite reports were changed.

## Controlled cold-core follow-up

A separate FIFO-source/read + exact-parser-byte dependency contract now tests
cold reference, reference-repeat and native cores with storage cleared between
processes. No parsed facts or graphs cross that boundary. Both 512/16000-budget
comparisons pass on the 46-file, 17-query fixture with zero native or reference
repeat differences. The private parser tape retains rule/source identity,
stdout/stderr and exit status; missing/extra/corrupt inputs fail closed. Tests
cover its narrowly declared temporary-rule-path/`--` delimiter adaptations,
resource bounds and failed source-read recovery. No core algorithm changed.

This is **controlled-input component evidence**, not independent cold extraction
or a native-host certificate. The untouched strict independent-cold cases remain
opt-in/unqualified. No sorting, remapping or numerical tolerance change was used.
See `cold-input-contract.md` for the acceptance ledger and evidence scope.
H01–H12 and full native integration remain incomplete/unqualified.

Scoped tests: **40 passed / 4 skipped**, five files; 13 new tape/queue regressions,
both controlled budgets, both warm-fact budgets, package exclusion and guidance
inventory executed. Typecheck/Knip passed. Separate strict independent-cold
recheck: **2 failed**, with both pinned-reference repeats also differing. No
failure was hidden as a controlled pass. Commands, exact private evidence and
build log are in `cold-input-contract.md` and `qualification.json`. No full-check
or installer rerun is claimed for this development-only follow-up.

## Post-handoff cold-contract verification

Selected the retained pinned Pi Fabric store explicitly, rather than counting
missing-prerequisite lifecycle skips as passes. Complete Fovea and package-boundary
modules: **213 passed / 4 skipped**, 23 files, **53.76s**;
`.tmp/fovea-posthandoff-verification.json`. All 15 lifecycle and 13 new tape/queue
cases executed; both controlled 512/16000-budget comparisons matched every field.
The four skips are two opt-in independent-cold and two optional external-report
cases. Typecheck and Knip passed; no product-code fix was needed.

Re-ran the strict independent-cold gate separately: **2 failed**, exit **1**;
`.tmp/fovea-posthandoff-independent-cold.json`. Native/reference-repeat difference
counts were **154/263** (512) and **221/192** (16000). This is the existing
unqualified nondeterministic cold-input boundary, not a controlled-test success
or evidence that all native differences are harmless. Assertions and numerical
tolerances remain unchanged. Exact commands/retained paths are in
`docs/fovea/cold-input-contract.md`.

Full repository/installer checks were not rerun for this scoped follow-up and
`.tmp/vitest-report.json` was not overwritten. Native routing/delivery/restoration,
macOS source support, historical-manager qualification, and release/task-efficacy
gates remain unfinished. No credentials, live home, reference checkout or
production algorithm was modified.

## Independent-parser scheduling diagnosis and regression

Isolated pinned ast-grep multi-rule nondeterminism even with `--threads 1`,
beyond async source-read completion. Added a **development-only** single-rule
schedule with FIFO reads: reference, reference-repeat and native all execute
real parser subprocesses, starting from fresh stores. No parser tape or warmed
facts are shared. Both 512/16000-budget comparisons now match all fields; the
reference outputs are byte-identical before normalization. Each process executes
25 requests / 260 parser launches, not a production performance recommendation.
Ten new boundary regressions preserve exact rule/output bytes, ordering, errors,
receipts, quotas and cleanup, and fail closed on unsupported inputs.

Final scoped verification: **225 passed / 4 skipped**, 23 Fovea/package modules,
67.75s (`.tmp/fovea-scheduled-verification.json`). All 15 pinned lifecycle cases
executed. Four skips remain the two unresolved opt-in cold gates and two optional
external reports. Typecheck/Knip passed; build evidence is in
`.tmp/fovea-scheduled-build.log`. No full-check/installer rerun is claimed.

This establishes independent parser execution **under a controlled input
schedule**, not the unchanged production-batched independent-cold gate. That
gate was reproduced with two failures before the repair and remains
failed-unqualified. No engine, ranking, parser pin, production timeout or
tolerance changed. Exact fields, causal probe, raw-output hashes and acceptance
ledger: `cold-input-contract.md`. Native H01-H12/full integration remain
incomplete/unqualified.

## Scoped post-handoff cold-parser verification

Re-read the schedule adapter and differential call sites; the real parser is
invoked independently, raw reference stdout equality is asserted, and the
adapter remains outside production imports/closure. No product-code fix needed.
Full differential, adapter and package-boundary modules: **39 passed / 2 skipped**
(three files, **31.00s**, exit 0), with exact reference/parser prerequisites
selected. Both scheduled budgets matched. The two skips remain the unresolved
opt-in uncontrolled cold gate, not a passing production-cold claim.

Fresh typecheck and Knip passed. Evidence:
`.tmp/fovea-cold-review-verification.json`,
`.tmp/fovea-cold-review-verification.log`,
`.tmp/fovea-cold-review-typecheck.log`, `.tmp/fovea-cold-review-knip.log`.
Final `pnpm run build` output is retained in `.tmp/fovea-cold-review-build.log`.
No full repository/installer rerun for this scoped verification; the prior full
report is preserved. See `cold-input-contract.md` for the exact command and
unchanged production-batched/native qualification boundaries.



