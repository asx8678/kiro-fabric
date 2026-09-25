# Fovea acceptance report — 2026-09-20

## Current follow-up

[completion-ledger.md](completion-ledger.md) owns the latest eight-item
implementation and verification state. The results below retain their original
revision, platform and scope; they are not fresh counts for the current tree.
Authenticated Darwin arm64 explicit navigation now works. Neither a successful
login nor one explicit tool call qualifies the complete native lifecycle gates.

## Historical claim boundaries (Linux revision)

Native deterministic analysis, persistent hosting, explicit typed queries,
source composition, successful-operation observation, hash-transition provenance,
root residency, settings/rule controls and generation packaging are implemented.
The host-owned post-settlement context collector is implemented and tested behind
a trusted capability; managed profiles do **not** enable it.

**Full native Kiro integration remains incomplete/unqualified.** Native hook
rendezvous, hidden delivery, session restoration and queue-safe continuation
remain unfinished. Source/component, native-TUI parity and release readiness are
separate claims. See [parity-matrix.md](parity-matrix.md) and
[implementation-status.md](implementation-status.md).

## Historical Linux verification and remaining gates

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

## Historical commands and results (conversation-control revision)

These results cover the conversation-control isolation revision, not an earlier
tree. Full and installer suites ran serially with trusted Node 24.20.0.

| Command / probe | Actual result |
| --- | --- |
| `pnpm run check` | Exit 0; **2862 passed, 10 skipped**, 185 passing files / 2 skipped; test phase **546.79s**. Guidance, typecheck, build, dead-code lint, staging, component certification and SBOM passed. |
| `pnpm run test:installer` | Exit 0; **961 passed, 6 skipped**, 55 passing files / 1 skipped; **188.31s**. |
| Fovea subset within that full suite | **173 passed, 2 skipped**, 20 files. Skips require optional external report inputs; direct strict differential tests did execute. |
| Strict pinned differential within full suite | Complete original/native-core sketch, focus, dwell, impact and language map match on the mini fixture at budgets **512 and 16000**. Fixed clock; absolute tolerance 1e-12 / relative 1e-10; no discarded fields or updated goldens. |
| Pinned oracle with freshly acquired exact Pi Fabric object | Exit 0; no prerequisite blockers. Fovea oracle executed with actual ast-grep 0.45.3. Pi Fabric was **archived, not executed**. |
| `FOVEA_REFERENCE_REPORT=<fresh-report> pnpm exec vitest run tests/fovea/reference.test.ts --reporter=default` | **6 passed, 1 skipped**. New oracle report and inventory checked; separate optional exported-native-output case not supplied. Does not replace the two strict differential tests above. |
| Source installation + installed profile MCP probe | Exit 0 in a fresh private external HOME/KIRO_HOME, no shell integration; installed integrity and backend **PASS**. |
| Installed `doctor --json` | Exit 0, healthy; signing/native authentication/tool filtering explicitly unqualified or not tested. |
| Direct public built-host probe | Lazy status, one persistent engine, hash-bound reads, cross-call focus/dwell, immutable replay, revoked-result denial and shutdown passed. |
| `git diff --check` | Passed. |

Current logs: `.tmp/fovea-owner-check.log`, `.tmp/fovea-owner-installer.log`,
`.tmp/fovea-owner-source-install.log` (each corresponding `.exit` is 0),
`.tmp/vitest-report.json`, `.tmp/fovea-owner-installed-probe.json`,
`.tmp/fovea-owner-reference.json`, `.tmp/fovea-owner-doctor.json` and
`.tmp/fovea-built-probe.json`. Final build evidence is recorded in
[qualification.json](qualification.json).

## Repairs and evidence

Session settings and adopted-rule trust were incorrectly shared across all
conversations in one host. New tests reproduced two settings/capacity failures
and a real-parser trust leak before repair. `src/fovea/host.ts` now owns controls
by validated conversation ID + epoch; same-conversation rebinding/roaming retains
them, while independent conversations/new epochs do not inherit them. Persistent
project/global configuration remains intentionally shared. Failed binds release
leases; 128 retained epochs and 32 trusted worktrees per epoch fail explicitly
without evicting live choices. A final trust-cap regression passed in the full
suite. Source approval policy and source mutation behavior are unchanged.

Earlier repairs covered execution-owned context collection, emitted-versus-
acknowledged accounting, notice replay/reverts, closed coverage schemas, bounded
built-in rule inventory and retained deferred hash-bound read windows. Earlier
installer testing also repaired leader reaping before descendant census without
changing the 1500ms cleanup or 200ms census production bounds. Historical results
remain labeled in the implementation ledger; they are not current certification.

## Packaged / installed evidence

- Complete Linux x64 source bundle and installed generation:
  `4d96d38d6707bb81c2137b7597c50649db78fd0958d5e3359d9e32fa1f0b44c1`.
- Source digest:
  `997c9f034121a6a39ab4f06ef9c886eea1b9134df11686c06b7a8490824eb1d3`.
- Uncompressed bundle: **201,572,672 bytes**. Agent runtime closure:
  **89 files, 15,509,305 bytes**, 129 captured source modules.
- Private ast-grep **0.45.3**, SHA-256
  `7a5ab30160186184c0bf8bffc87da4af25123c183964cd98c11b0b354137db0a`.
- Four platform artifact/member pins were verified during implementation;
  **only Linux x64 was executed**. New x64 generations require glibc >=2.34;
  historical schema floor is unchanged.
- Fresh actual `install.sh --source --kiro-home <disposable> --yes
  --non-interactive --no-shell-integration` passed. The direct MCP probe used the
  installed profile's exact command, arguments and bound data/environment,
  private tools with `/usr/bin:/bin` PATH, hash-bound focus, zero-start status,
  one engine, cross-execution dwell and bounded shutdown. See
  [installed-probe-report.json](installed-probe-report.json).
- Installer fixtures exercise archive removal, multiple projects, update,
  retained generations, rollback and retirement with real MCP runtimes and a
  fixture Kiro launcher. These are **not authenticated native-client evidence**.
- Engine, hook, rules, skills, notices and vendored SBOM provenance are packaged
  together. No Pi runtime, global parser/npm package or runtime download is needed.

## Measured tradeoffs and limits

A fresh one-file built probe measured **140.53ms cold / 7.85ms warm**, one engine
start and **159,125,504 bytes host RSS**. This is one synthetic observation, not
a distribution, child-memory bound, billed-token measurement or task-quality
comparison. Exact content validation rereads bounded eligible source to detect
same-stat changes; warm graphs do not imply zero filesystem I/O.

Bounds include 32 retained root metadata entries, two hot graph roots, 128 journal
transitions / 48KB per worktree, bounded immutable results, 128 retained control
epochs per host and 32 adopted worktrees per epoch. Exhaustion is explicit.
Eviction establishes a fresh baseline/expired navigation, not invented history.

## Exact remaining work and blockers

1. **Native host integration:** H01/H02/H08 are environment-blocked by the actual
   isolated Kiro 2.22.0 authentication-bootstrap failure before any JSON event.
   H03-H07/H09-H12 and native TUI/ACP remain untested, not demonstrated client
   incompatibilities. Native hook/session mapping, intended model-input delivery,
   hidden presentation, restoration, cancellation/queued-input precedence and
   continuation need implementations grounded in observed supported events. The
   packaged hook is status-only; automatic managed profiles stay off. The source
   collector's synthetic capability tests cannot grant native qualification.
2. **Platform source support:** shared policy, Darwin contract and C/N-API binding
   source are implemented and tested on Linux. Trusted Darwin loader/packaging,
   real macOS qualification and the platform-safe provenance writer remain
   unfinished; production stays Linux-only. See [platform-source.md](platform-source.md).
3. **Reference lifecycle/full-family evidence:** all 15 pinned fixture lifecycle
   cases now execute and pass. Production-batched native cold extraction matches
   independently scheduled reference repeats at both budgets. Uncontrolled
   pristine-reference repeatability still fails; full corpus, real Pi/Kiro host
   behavior and task effectiveness are not certified by these fixtures.
4. **Release/effectiveness:** four real historical-manager handoff/rollback/
   recovery cases now qualify the trusted source migration path, not transparent
   old-manager self-update. Local archive/SBOM checks pass. Candidate reporting
   refuses the dirty tracked tree; public signing, four-target exact-bundle CI,
   authenticated native Kiro acceptance and repeated controlled coding-task
   effectiveness remain separate gates.

No commit, push, publication, credential/signing change, permission bypass or
activation in the user's live Kiro home was performed.
