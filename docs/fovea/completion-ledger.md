# Fovea completion ledger

## Scope

Follow-up to `020d86c37178ab17453d9a03ec6e60318fcda243` on Darwin arm64.
Historical Linux reports are preserved, not counted as current verification.
The earlier installed explicit navigation result in [macos-activation.md](macos-activation.md)
is distinct from automatic native-client and release qualification.

## Acceptance ledger

| Request | Implementation / acceptance status |
| --- | --- |
| 1. Native automatic integration | **Blocked/incomplete.** Authenticated Kiro 2.22.1 TUI hooks and one stop-hook continuation MCP call observed. MCP supplies no native session identity to associate with hook `session_id`; actual intended model input is unobserved. No cwd/PID/argument rendezvous, private RPC or fabricated delivery. Automatic hooks remain off. |
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

## Full verification

The final `PATH="$PWD/.tmp/trusted-node:$PATH" pnpm run check` completed with
**exit 0: 3,148 passed / 63 skipped / 0 failed**, 198 passing files / 5 skipped,
**1,556.00 seconds** in the serial test phase. It includes guidance, typecheck,
fresh build, staging, full tests, clean Knip, component MCP certification and
30-package SBOM generation. Exact pinned reference environment variables were set;
**all 15 lifecycle cases executed within this full run**, with zero lifecycle skips.

- Final log/exit: `.tmp/fovea-completion-final-check.log` and `.exit`.
- Preserved full report: `.tmp/fovea-completion-final.json`; also
  `.tmp/vitest-report.json`. No focused run overwrites that full report.
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
  `src/fovea/git-executable.ts:5`, and returned hash-bound read windows. Captured
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
