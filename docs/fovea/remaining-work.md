# Fovea remaining-work execution plan (all five items)

Owner-selected scope, 2026-09-20.

## Execution outcome

| Item | Current result |
| --- | --- |
| 1 | **Implemented/tested**: bounded production read publication, deterministic lossless batched parser order, cache header 17. Both budgets and repeats match scheduled reference bytes. [Contract](production-cold.md). |
| 2 | **Attempted/environment-blocked**: isolated auth bootstrap fails before native events; H01/H02/H08 blocked, others untested. Native automatic profiles remain off. |
| 3 | **Partial implementation, not production Darwin support**: shared policy, Darwin ABI adapter and actual async POSIX/N-API binding source implemented; 82 neutral + 27 compiled Linux tests. Authenticated generation-local loading/packaging, manifest/architecture binding and Darwin provenance still unfinished; native macOS testing environment-blocked. [Details](platform-source.md). |
| 4 | **Implemented/qualified on Linux components**: actual pinned installed manager, schema 1→2 source handoff, concurrent backends, exact-profile rollback, new data preservation and SIGKILL recovery. Four tests run in full and installer suites; native CI registry/history prerequisite added. [Details](historical-manager-migration.md). |
| 5 | **Local path exercised; release blocked**: Agent archive, SBOMs, fresh source install and offline doctor pass. Candidate report refuses dirty tracked tree; promotion refuses missing production trust root. No commit/signing/auth workaround. |

Final evidence: [remaining-verification.md](remaining-verification.md) and
`qualification.json#remainingWorkVerification`. Original requirements below
remain the acceptance contract, not a declaration that all gates are complete.


## Execution outcome

The current acceptance ledger and exact test/exit evidence are in
[verification-current.md](verification-current.md). Items 1 and 4 have passing
scoped implementations/qualification. Item 2 is authentication-blocked with
unexercised gates left untested. Item 3 includes a real compiled POSIX binding,
but trusted Darwin loading/packaging and native platform/provenance support are
still unfinished. Item 5 validates local archive/SBOM bytes; clean-commit,
production signing, CI and native-client gates prevent release readiness.
The task is not represented as complete native integration.

## Original execution requirements

Execute these in order. Items 1, 3, 4 are credential-free and must be
implemented and tested. Items 2 and 5 are gated: implement every independent
part, then record the exact remaining blocker — do not create/change auth,
signing keys, or fetch unsigned releases, and do not claim parity from mocks
or ACP.

## 1. Production-batched cold extraction (credential-free)

- Make production-batched (multi-file/parallel) cold extraction deterministic
  and bounded, matching the controlled-scheduling results
  (`tests/fovea/cold-inputs.test.ts`, `docs/fovea/cold-input-contract.md`).
- Preserve file/byte/CPU/process limits and coverage-gap honesty.
- Add regression tests; do not weaken assertions or widen production timeouts.
- Verify the reference-repeat byte-identity property under the batched path.

## 2. Native Kiro H01-H12 (gated: isolated authentication)

- Attempt the real isolated probe with `scripts/fovea-capability-probe.mjs --native`.
- If isolated authentication is unavailable, record per-gate
  `environment-blocked` with the exact failure and evidence path; leave
  unexercised gates `untested`.
- Implement any native routing/delivery/restoration/continuation that is
  possible from observed supported events (no invented RPC, no fabricated
  model-input delivery). Keep managed/native profiles fail-closed.
- Native TUI acceptance/decline remains separate from headless evidence.

## 3. macOS scope-safe source adapter (credential-free code; native test gated)

- Implement a Darwin-scoped source enumeration/capture adapter that preserves
  repository-relative identity, permissions, exclusions, and bounded I/O, with
  the same SHA-256 snapshot binding as Linux.
- Unit-test the platform-neutral logic on Linux; mark native macOS execution
  `environment-blocked` (no macOS host here).
- Do not claim macOS readiness from parser pins or cross-platform fixtures.

## 4. Historical-manager cross-schema migration (credential-free)

- Extend qualification for a real old-manager -> schema 2 handoff and
  cross-schema rollback, beyond `tests/managed-installation.test.ts` and
  `tests/installed-bundle-history.test.ts`.
- Verify old and new generations coexist, rollback needs no deletion of newer
  user data, and no new fields are written into old schemas.
- Preserve transactional recovery evidence.

## 5. Release qualification (gated: signing/CI)

- Run the release-candidate path that is possible locally
  (`pnpm run agent:archive`, `release:candidate` report, SBOM, doctor).
- Record production signing/CI/public-bundle as an exact external blocker
  (`build-toolchain.json` currently states production BLOCKED). Do not
  manufacture keys or declare release readiness because source install works.

## Final

- Fresh `pnpm run build`; full `pnpm run check` and `pnpm run test:installer`
  with trusted Node; update `docs/fovea/{implementation-status,parity-matrix,qualification,acceptance}.md`.
- Report honestly: source completion, component tests, native-TUI parity, and
  public release readiness are separate claims.
