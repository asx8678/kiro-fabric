# Fovea completion ledger

**Latest follow-up (2026-09-21):** [native acceptance ledger](native-acceptance-2026-09-21.md).
Real Fabric approval is host-blocked by Kiro's missing form handler; observed
inventory is incomplete. Native cancellation/queued execution and read-only
controls have partial evidence, not automatic qualification. The earlier
implementation/commit checkpoints below retain their original dates and scopes;
the old Escape-only H07 and untested H09–H11 dispositions are superseded.

## Current reference/release closeout

This follow-up diagnoses strict reference identity mismatches without changing
assertions: [reference identity diagnosis](reference-identity-diagnosis.md).
Four current reproducible native blockers are prepared as
[unpublished upstream issue drafts](../upstream-client-issues.md).
The [complete-bundle pipeline](../complete-bundle-release.md) now has distinct
candidate, offline-signing-input, encrypted transport and signed promotion paths;
actual production signing, runner provisioning and native qualification remain pending.
The inherited native acceptance work and these additions passed the final trusted-Node
`pnpm run check`: **3,231 passed / 63 skipped / 0 failed**, 205 passing files /
5 skipped files. All **15 pinned lifecycle cases executed and passed**. Guidance,
both typechecks, fresh build/staging, Knip, component certification and SBOM passed.

- Terminal log/exit: `.tmp/fovea-release-closeout-recheck.log` and
  `.tmp/fovea-release-closeout-recheck.exit`.
- Full report: `.tmp/fovea-release-closeout-recheck-full.json`, SHA-256
  `5098d47f65138f0e83fbb108bb3ad33920cc151f49bc4732526198297eac1420`.
- Initial full run: 3,228 passed / 3 failed / 63 skipped, retained separately in
  `.tmp/fovea-release-closeout-full.json`. Its confirmed 15-second whole-fixture
  crash/replay timeout was replaced with a 60-second **harness-only** budget;
  executable fixture logic and assertions are otherwise byte-identical. The new
  development-only reference diagnostic was added to the exact package-boundary
  exception list; shipped-code prohibitions remain intact.
- The initial cancellation test reported conservative cleanup uncertainty. Its
  underlying census cause was not established. No production cleanup budget or
  cancellation assertion changed: the complete focused modules passed **75 / 3
  skipped**, and the subsequent full run passed it unchanged. Do not call that an
  identified or repaired production defect.
- Independent source reviews checked release trust/privacy/tag boundaries and
  native/reference evidence scope. Public CLI probes confirmed static-root refusal
  before output creation. Documented pnpm argument forwarding was checked directly.

This is local implementation verification, not native Kiro or production release
qualification. GitHub authentication, signer custody and all-four-target native
runner/evidence provisioning remain unavailable; no external issue or release was
published. Automatic Fovea remains disabled.

## Scope

Follow-up to `020d86c37178ab17453d9a03ec6e60318fcda243` on Darwin arm64.
Historical Linux reports are preserved, not counted as current verification.
The earlier installed explicit navigation result in [macos-activation.md](macos-activation.md)
is distinct from automatic native-client and release qualification.

## Acceptance ledger

| Request | Implementation / acceptance status |
| --- | --- |
| 1. Native automatic integration | **Blocked/incomplete.** Authenticated Kiro 2.22.1 TUI hooks and one stop-hook continuation MCP call observed. MCP supplies no native session identity to associate with hook `session_id`; actual intended model input is unobserved. A separate TUI probe's hook completed 7,305 ms after Escape input, without observed cancellation acknowledgement or a second prompt hook; cancellation/queue behavior remains unverified. Headless resume preserved chat identity without establishing hook restoration. No cwd/PID/argument rendezvous, private RPC or fabricated delivery. Automatic hooks remain off. |
| 2. Darwin provenance | **Implemented.** Authenticated native journal ABI: descriptor-relative bounded reads, exclusive lock, compare-and-publish, fsync, renameat and identity-checked cleanup. Cross-host origin attribution, cancellation/revocation and adversarial publication tests run on Darwin. Gaps remain explicit; no pathname fallback or stale-lock deletion. |
| 3. Qualification records | **Reconciled.** Current JSON and Markdown distinguish Darwin execution from historical isolated Linux auth failures. Observed protocol subsets are not complete H-gate passes. Regression tests enforce matching machine records. |
| 4. Native packaging | **Implemented.** New Darwin schema-2 bundles require both native assets on every validator host; Agent staging on Darwin requires them too. Rehashed omission, metadata/source/architecture mismatch and corruption are rejected. Linux/pre-Fovea historical contracts remain supported. |
| 5. Persisted identity | **Implemented for new evidence.** APFS volume UUID plus inode replaces device-number authority in schema-2 sidecars; exact dev/ino remains for legacy or unsupported-volume evidence. Real read-only APFS discovery and simulated renumbering/recovery tested. Ambiguous legacy mismatches remain recovery-required without rewriting evidence. Old managers cannot maintain new sidecar schemas; use trusted new management. No reboot or storage-layout changes performed. |
| 6. Skipped coverage | **Pinned lifecycle gap closed.** `pnpm run qualify:fovea:references` rejects missing/wrong pins and any lifecycle skip. Actual run: 23 passed / 2 explicit uncontrolled-cold skips, including 15/15 lifecycle cases. Native generation admission is fixture-substituted; not native Kiro lifecycle proof. The 63 remaining platform/optional exclusions are itemized below, not counted as passes. |
| 7. Cleanup | Removed stale `cc` ignore and redundant qualification-script Knip entry. |
| 8. Review / commit | Independent trust-boundary review completed and its historical-admission finding repaired. Fresh full check passed. The commit checkpoint includes a final fresh build; signing and four-target/native-client gates remain separate. |

## Direct evidence

- Native protocol: `.tmp/fovea-native-contract/final-headless-report.json` and
  `.tmp/fovea-native-contract/final-tui-report.json`. Both owned probe processes
  exited 0 and closed; these use harmless MCP fixtures, not Fabric execution.
- Strict pinned references: `.tmp/fovea-reference-qualification/run-PyYFeE/vitest.json`,
  `inputs.json`, `summary.json`; `.tmp/fovea-completion-references.log` and `.exit`.
  Fovea `b594483868d27b7eb37a9b185c59ce812f8a9c01`, Pi Fabric
  `2ee51683452dc359702880f408e0b8a4bfcb9646`, exact Darwin parser 0.45.3.
- Direct native provenance coverage: `tests/fovea/provenance-native.test.ts`;
  host integration: `tests/fovea/provenance.test.ts` and
  `tests/fovea/reference-lifecycle.test.ts`.
- Recovery coverage: `tests/installer-directory-identity.test.ts` includes actual
  archived `020d86c` manager readers, preservation of schema-1 evidence, wrong
  volume/inode/refused OS evidence, and interrupted transaction/candidate replay.
- Public diagnostics: `fabric.info().fovea`; packaged hook `--status` reports
  disabled capability explicitly, while default invocation emits no model-context
  stdout and exits 3. Managed profiles intentionally register no automatic Fovea hooks.

## Native contract records follow-up

Follow-up to implementation commit `3688e70`; this is a records/test change,
not another install. Initial scoped checks are recorded below, followed by the
final full pre-commit verification; the runtime payload is unchanged.

| Acceptance check | Result / evidence |
| --- | --- |
| Mirror all 12 current gates and preserve historical Linux auth evidence | `qualification.json#gates` equals `parity-matrix.json#hostGates`; Markdown uses the same dispositions. `tests/fovea/qualification-records.test.ts` enforces consistency and no full gate passes. |
| Record positive mechanisms without promoting automatic integration | Native-TUI hooks and Stop → actual continuation MCP call observed; one request per session is a **fixture bound**, not a client guarantee. H03/H05/H06 are partial; H04 actual prompt input remains unqualified. |
| Record real blockers without inferring unsupported topology | H01/H02 lack supported session-to-MCP identity on observed transports. Two started processes/one initialized process do not establish concurrent-session pooling. |
| Record cancellation and resume honestly | H07 is **unqualified**, not host-blocked: hook ended 7,305 ms after PTY Escape input, with no logged instrumented signal. No acknowledged session/cancel event or second UserPromptSubmit was observed; cancellation/queue contract unverified. Fresh source AbortControllers support a wiring concern only. H08 headless resume preserved chat identity and completed a fixture call on distinct MCP instance `fe190816-e5a0-41d0-be62-72ec04eb943b` (initial TUI: `fcab2cb8-07fb-4998-9d9b-f28bcc4624fc`); generic `kiro 0.0.0` and absent session metadata do not establish session association. TUI replay is not new-hook evidence or hook/Fabric restoration. |
| Preserve fail-closed production behavior | Public `fabric.info().fovea` remains automatic-off, association-unavailable and model-input-unacknowledged; embedder post-tool visibility is separate. Default hook stdout stays empty; `--status` is diagnostic-only; no automatic Fovea hooks are registered. |
| Preserve unrelated state and evidence | No runtime source, profile, live-home, partition or mount changes in this follow-up. Prior full-suite reports and the residual 63-skip inventory below are unchanged. |

Additional raw artifacts: `.tmp/fovea-native-VEArYZ/{report.json,hooks.jsonl,mcp.jsonl,resume-headless.jsonl}`
and `.tmp/fovea-cancel-wgPbJV/{timeline.jsonl,driver.exp,hook.mjs,native-tui.raw}`.
`currentNativeProtocol.followup` in both machine records retains exact cancellation
timestamps and the limits of routing, continuation and resume evidence. Scratch
artifacts are local evidence references, not dependencies of portable unit tests.
H09–H12 remain untested; no H01–H12 gate is passed. See
[host-capability-probes.md](host-capability-probes.md) for the surface split.

Records follow-up verification: **45 passed / 0 failed / 0 skipped** across the
five complete qualification-records, capability, native-status, context-delivery
and native-probe modules. Both TypeScript checks passed. Reports:
`.tmp/fovea-native-records-tests.json`, `.tmp/fovea-native-records-tests.log`,
`.tmp/fovea-native-records-typecheck.log`.
The direct artifact probe passed, matching the timestamps, actual continuation
and resumed tool result to the raw logs and checking that unrelated machine
records are unchanged: `.tmp/fovea-native-records-probe.json`. It also verifies
and hashes the preserved prior full-suite report and lists its 63 skips; that
suite was **not rerun at that initial checkpoint**. Final build and packaged
hook-probe outputs use `.tmp/fovea-native-records-build.log` and
`.tmp/fovea-native-records-built-probe.json` respectively. No new live Kiro
qualification or install is implied.

H07 evidence caveat correction: **7 passed / 0 failed / 0 skipped** in the
complete `tests/fovea/qualification-records.test.ts` module; both TypeScript
checks passed. The regression now requires `unqualified`, no host blocker,
unobserved session/cancel acknowledgement and second UserPromptSubmit, and
unverified cancellation/queue contracts in both machine records. Reports:
`.tmp/fovea-h07-caveat-tests.json`, `.tmp/fovea-h07-caveat-tests.log`,
`.tmp/fovea-h07-caveat-typecheck.log`. Fresh build and raw-evidence/packaged-hook
probe artifact paths: `.tmp/fovea-h07-caveat-build.log` and
`.tmp/fovea-h07-caveat-probe.json`. No full-suite rerun or new live cancellation
qualification is claimed by this correction.

H08 final evidence reconciliation: **46 passed / 0 failed / 0 skipped** across
all five complete records/capability/native-status/context-delivery/native-probe
modules (including eight records tests). Both TypeScript checks and
`git diff --check` passed. The added regression distinguishes the resumed native
chat ID from the new MCP instance, retains generic client metadata and absent
session association, and refuses to count TUI replay as new-hook evidence.
Reports: `.tmp/fovea-h08-final-tests.json`, `.tmp/fovea-h08-final-tests.log`,
`.tmp/fovea-h08-final-typecheck.log`. Final fresh build and independent
raw-evidence/packaged-hook probe artifacts: `.tmp/fovea-h08-final-build.log` and
`.tmp/fovea-h08-final-probe.json` (runner: `.tmp/fovea-h08-final-probe.mjs`).
The probe checks mirrored records, preserved historical data, raw resumed MCP
initialization/call metadata, fail-closed profiles and packaged hook behavior.
At this H08 checkpoint no full-suite rerun, new native lifecycle qualification or
live-home change was claimed. The subsequent full check is recorded separately.

## Full verification

The final trusted-Node `pnpm run check` completed with **exit 0: 3,153 passed /
63 skipped / 0 failed**, 198 passing files / 5 skipped, **1,328.78 seconds** in
the serial test phase. Guidance, both TypeScript checks, fresh build, staging,
Knip, component MCP certification and 30-package SBOM generation all passed.
The three explicit reference/parser environment variables were set and their
exact pins validated before this run. All **15 lifecycle cases passed without
skips**; differential coverage was **8 passed / 2 uncontrolled-cold skips**.
The remaining 63 excluded cases match the prior full report exactly; they are
not passes or native-client qualification.

- Full log/exit: `.tmp/fovea-final-records-check-final.log` and
  `.tmp/fovea-final-records-check-final.exit`.
- Preserved full report: `.tmp/fovea-final-records-full.json`, SHA-256
  `01fb0cefb85627af089573ffe87943f3eb1a5ca3684c30520e43de6d9c0ac971`.
- Mechanically asserted summary: `.tmp/fovea-final-records-verification.json`.
- Initial final-check attempt: **3,132 passed / 83 skipped / 1 failed**;
  `.tmp/fovea-final-records-check.log` and
  `.tmp/fovea-final-records-full-initial.json`. It omitted the pinned-reference
  environment. Its sole failure was a Markdown citation whose line suffix was
  interpreted as part of a filename. The citation was corrected without changing
  the path validator; both complete affected modules passed **18/18** in
  `.tmp/fovea-final-records-repair.json` before the successful full rerun.
- Post-ledger complete-module check: `.tmp/fovea-final-records-final-modules.json`.
  Final fresh build: `.tmp/fovea-final-records-finish-build.log` and `.exit`.
- Built/installed closure integrity and fresh hook behavior:
  `.tmp/fovea-final-records-installed-probe.json`. Source, dist and installed
  build-input digests agree; default/unknown hook invocations emit no stdout,
  while `--status` returns automatic-off diagnostics. Retained actual Fabric
  stream evidence was rechecked, **not** replaced by a new native session.
- Clean-commit candidate report target: `.tmp/fovea-final-records-candidate.json`;
  no production signing, four-target or native-client release pass is implied.

No runtime source, installed profile, live-home or storage-layout changes were
made in this records follow-up. Historical reports remain preserved. H07 stays
unqualified; resumed chat identity is not supported session-to-MCP association.

## Prior implementation verification

The final `PATH="$PWD/.tmp/trusted-node:$PATH" pnpm run check` completed with
**exit 0: 3,148 passed / 63 skipped / 0 failed**, 198 passing files / 5 skipped,
**1,556.00 seconds** in the serial test phase. It includes guidance, typecheck,
fresh build, staging, full tests, clean Knip, component MCP certification and
30-package SBOM generation. Exact pinned reference environment variables were set;
**all 15 lifecycle cases executed within this full run**, with zero lifecycle skips.

- Final log/exit: `.tmp/fovea-completion-final-check.log` and `.exit`.
- Preserved implementation full report: `.tmp/fovea-completion-final.json`.
  The mutable `.tmp/vitest-report.json` now belongs to the final records check
  above; neither historical report is overwritten by focused runs.
- Initial full run: **exit 1, 3,134 passed / 11 failed / 63 skipped**;
  `.tmp/fovea-completion-check.log`, `.tmp/fovea-completion-initial.json`.
  Nine staging failures came from incomplete Darwin fixtures; two archived-manager
  tests expected the old error instead of the intended schema-2 sidecar refusal.
- Repair suite: **136 passed / 0 skipped**, 11 files;
  `.tmp/fovea-completion-repairs.json`. Original assertions about unchanged controls
  and evidence remain intact; exact new refusal and schema assertions were added.
- Independent review found that strict new native requirements must not apply to
  already-owned pre-native Darwin schema-2 generations. Installed-only historical
  verification now permits absence of both assets, while every declared asset and
  owner-recorded manifest hash remains binding. New admission and native loading
  remain strict. Three upgrade/recovery/tamper cases passed; independent follow-up
  review confirmed the finding closed without a new blocking issue.
- Finish-build log: `.tmp/fovea-completion-final-build.log` and `.exit`.
  Exact-commit candidate reporting is run after the commit; its report, if emitted,
  is `.tmp/fovea-completion-candidate.json`, not a release-readiness certificate.

### Residual 63 skips

| Scope | Count | Reason |
| --- | ---: | --- |
| Fovea `source-platform.test.ts` | 25 | Linux proc backend / Darwin-contract-on-Linux fixtures, not actual Darwin certification |
| Fovea `engine.test.ts`, `engine-review.test.ts`, `engine-languages.test.ts` | 18 | Linux-only source/engine fixture paths |
| Fovea `coverage-contract.test.ts`, `host-process.test.ts`, `mcp-context.test.ts` | 6 | Linux-only built/context fixture paths |
| Fovea `source-platform-native.test.ts` | 2 | Linux descriptor enumeration / worker-finalizer probes |
| Fovea `reference-differential.test.ts` | 2 | Explicit uncontrolled-cold opt-in qualification, still unqualified |
| Fovea `reference.test.ts` | 2 | Optional external oracle/native-output reports absent |
| Installer transaction/lock/boundary tests | 6 | Platform-specific syscall/recovery or unsupported-capability branches |
| `review-runtime-controls.test.ts` | 2 | Optional Helm and PowerShell executables unavailable |

These exclusions are not converted into passing assertions. Actual Darwin native
source, journal, installed-loading and pinned lifecycle tests provide their own
scoped evidence; they do not prove every Linux-only or native-client gate.

## Installed verification

The authorized `.kiro` source update completed with **exit 0**, `activated`,
`dataPreserved:true`, `recoveryRequired:false`. Shell integration was not changed;
previous generations and configuration backup were retained.

- Generation: `560326fe36292348477344be47979f3bec398bd3ff2bc949a530a6a0ffeef0b0`.
- Source digest: `47d2ec45d8ede0f4c783145f4be596720239d6362e702814c764dc0ad8bb3271`.
- Backup: `~/.kiro/kiro-fabric/backups/20260920T224517Z-1b7bf458f9d51ec9`.
- Installer: `.tmp/fovea-completion-install.json`; offline doctor is **healthy**,
  `.tmp/fovea-completion-doctor.json`.
- Fresh authenticated Kiro session `sess_78ba092b-6680-4c47-932d-290824e1dc4e`
  selected `kiro-fabric` and made one actual `@fabric/fabric_exec` call, with no
  fallback calls. `repo.focus()` returned `status:"ok"`, matched
  `src/fovea/git-executable.ts` (line 5), and returned hash-bound read windows. Captured
  **514 source files / 6,002,484 bytes**, with source budget not capped.
- Stream: `.tmp/fovea-completion-kiro.jsonl`; mechanically asserted summary:
  `.tmp/fovea-completion-installed-evidence.json`. The model's final prose
  incorrectly said no match, conflating disabled automatic hooks with explicit
  navigation. The actual tool result above, not that prose, is the evidence.

Start a new Kiro session to use this generation:

```sh
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" start
```

Existing sessions can retain their original generation. Explicit Fovea navigation
is available; automatic hooks remain disabled for the contract reasons above.

## Remaining external gates

- Supported native session-to-MCP routing, intended-turn model-input acknowledgment,
  cancellation/queued-input precedence, restoration and retained-generation
  semantics; H01–H12 remain unqualified. TUI hook firing alone is not integration.
- Actual native approval accept/decline/revoke and complete model-visible tool
  inventory; successful explicit reads or component MCP certification do not suffice.
- Uncontrolled pristine-reference cold repeatability and optional external oracle
  outputs; fixture comparisons do not qualify those gates.
- Production signing/trust root and four-target exact-bundle CI. No keys,
  credentials, permission checks, disk partitions, mounts or approval policies changed.
