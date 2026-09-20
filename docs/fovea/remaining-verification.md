# Remaining-work verification — 2026-09-20

## Current result

Production-batched cold determinism and genuine historical-manager migration
are implemented and verified on Linux x64. Shared source policy, Darwin adapter
and real asynchronous POSIX/N-API source are implemented and Linux-probed.
**Full native integration remains incomplete**: Darwin generation-local native
loading/packaging and provenance, authenticated Kiro lifecycle/delivery, native
platform qualification and public signing are not completed by these tests.

No unrelated changes were reset; no commit, credentials/signing changes, live
home activation or production authority/timeout relaxation occurred.

## Acceptance evidence

| Check | Observed result |
| --- | --- |
| `pnpm run check` | Guidance/typecheck/build/staging passed. Full test phase **3,028 passed / 12 skipped**, **192 passing files / 2 skipped**, **683.40s**. Invocation then exited **1** at Knip's undeclared fixture-only `cc` binary. |
| Repair and resumed tail | Declared the native-test compiler in `knip.json`; whole-project typecheck, Knip, component certification, Agent SBOM and bundle SBOM passed, exit **0**. Production does not discover/execute a compiler. Unchanged passing full tests were not rerun. |
| Fovea within full suite | **339 passed / 4 skipped**, 27 files. Skips: two opt-in uncontrolled upstream cold comparisons and two optional report inputs. Pinned lifecycle/reference cases and all new source/native/migration cases executed. |
| Installer/CI registration regressions | **29 passed**, two files; historical migration enrolled in bundle suite, exact old Git history available in native CI. |
| `pnpm run test:installer` (serial) | Exit **0**, **965 passed / 6 skipped**, **56 passing files / 1 skipped**, **266.54s**. Includes all four historical-manager cases. |
| Source installation | Actual shell `install.sh --source --yes --non-interactive --no-shell-integration --json` in fresh external private HOME/KIRO_HOME passed. Disposable home removed after assertions. |
| Installed launcher `doctor --json` | Exit **0**, healthy; signing and unauthenticated external services remain warnings/not tested. Offline doctor is not native delivery evidence. |
| Direct emitted public-host/engine probe | Exact captured source SHA-256, zero-start status, one persistent engine, focus/dwell, immutable replay, lease revocation and shutdown passed; automatic native behavior remains false. |
| Agent archive and SBOMs | Passed on fresh staged artifacts. Exact candidate artifact validation passed through to the clean-tree requirement. |
| Final package-boundary/import regressions | **20 passed**, two files. Newly visible package-import changes were preserved and tested separately; the earlier full-suite report was not relabeled or overwritten. |
| Fresh final `pnpm run build` and complete archive restaging | Exit **0**; emitted source identity and complete generation are unchanged from the verified full-suite artifacts. |
| Candidate report | Exit **1**: `Exact-commit evidence requires no unstaged changes to tracked files`. No commit/reset or invented candidate certificate. |
| Promotion requirement | Exit **1**: `Production release trust root unavailable: distribution BLOCKED`. No key creation or unsigned-release bypass. |

All suites ran serially with trusted standalone Node via
`PATH="$PWD/.tmp/trusted-node:$PATH"`, `umask 022`. The full run selected the
retained exact Pi Fabric reference store so lifecycle tests actually executed:
`FOVEA_HOST_REFERENCE_ROOT="$PWD/.tmp/fovea-host-reference-1PG9Va/repo.git"`.

Primary retained evidence:

- `.tmp/fovea-remaining-check.log`, `.tmp/fovea-remaining-full-suite.json`
- `.tmp/fovea-remaining-registration.log`, `.tmp/fovea-remaining-check-tail.log`
- `.tmp/fovea-remaining-final-typecheck.log`, `.tmp/fovea-remaining-installer.log`
- `.tmp/fovea-remaining-source-install.log`, `.tmp/fovea-remaining-doctor.json`
- `.tmp/fovea-remaining-built-probe.json`, `.tmp/fovea-remaining-archive.log`
- `.tmp/fovea-remaining-release-candidate.log`, `.tmp/fovea-remaining-promotion.log`
- `qualification.json#remainingWorkVerification` (fresh final-build status/log)

Earlier full-suite numbers elsewhere in the ledger are historical revisions,
not this run. The initial check failure and repaired tail remain explicit.

## Exact artifact identities

- Complete Linux x64 generation:
  `f2e29f265b7bd17ca7bf51fae509c093e334428ada417dd5183825c98440de9e`.
- Source digest:
  `efbe53c962d852a01cb26a53665535dcb549d144e7ca3aba0e8185da6b3827d3`.
- Uncompressed bundle: **201,579,943 bytes**.
- Agent package digest:
  `46d9d7251051060047072722fa9476682a4f67d9019aa4a02e4c5861093fc8a5`.
- Agent archive: **2,875,677 bytes**, SHA-256
  `13801df515021340e0d7cdc0d6392a46feef3e56f4d2fa540d412a01dec9b00c`.

## Remaining boundaries

1. **Production cold extraction**: the real native batched path matches the
   independently scheduled pristine reference and repeats exactly at both
   budgets. This is an intentional determinism improvement, cache header 17,
   port 0.1.1. The uncontrolled pristine reference still has its separate
   failed/unqualified repeatability gate. See [production-cold.md](production-cold.md).
2. **Native Kiro**: fresh isolated Kiro 2.22.0 chat exits 1 with
   `Failed to open browser for authentication.` / `error: Failed to open URL`,
   before native JSON events. H01/H02/H08 environment-blocked; all other gates
   untested. No auth was accessed/created/changed. Current sanitized report:
   [native-probe-report.json](native-probe-report.json).
3. **Darwin**: actual C binding source and 27 compiled Linux-native tests plus
   82 neutral policy tests are present, not merely a mock contract. Authenticated
   fixed generation-local loading, manifest/hash/architecture binding, native
   artifact packaging and Darwin provenance remain implementation work. Real
   macOS execution is environment-blocked. [Platform contract](platform-source.md).
4. **Migration**: real old manager safely refuses schema 2; trusted new source
   migrates/recovers; old and new backends coexist; rollback preserves exact
   profiles and newer settings. Old management cannot inspect retained schema 2
   after rollback. Use trusted new management code, not deletion of new data.
5. **Release**: clean exact-commit candidate identity, production trust/signing,
   four-target native exact-artifact CI, native tool filtering/approval and task
   effectiveness remain separate gates. Source installation is not publication.
