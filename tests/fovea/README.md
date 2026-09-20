# Fovea tests

Native source/process/provider/configuration/provenance/distribution tests live
in this directory and run under the repository's serial Vitest policy. The
historical initial full-suite report records 136 passing Fovea tests and two
skipped optional externally supplied report cases (17 files). The initial
lifecycle follow-up passed 180 Fovea tests with the same two optional skips in
21 files; see `docs/fovea/lifecycle-replay.md`. The original differential at 512 and 16000 tokens shares oracle-warmed fact
storage: it verifies operation/cache compatibility, not independent cold
extraction. Controlled-input cold-core tests now add exact fact/graph comparison,
without claiming independent parser reproducibility; see below.

- `tests/fovea/reference-lifecycle.test.ts`: exact upstream extension + Pi Fabric
  capture catalog/wrapper/provider, fixture event runner, and comparison with
  approved native registry/guest persistence, real write/edit publication, all
  four provenance origins, cancellation and lost-ack behavior. See
  `docs/fovea/lifecycle-replay.md` for prerequisites, commands and limitations.
  Set `FOVEA_HOST_REFERENCE_ROOT` to a Git store containing the pinned commit;
  absent references produce visible skips, not rewritten oracle output.
- `tests/fovea/reference-differential.test.ts`: original pinned Fovea versus
  native core on identical private fixtures; fixed clock and declared tolerance.
  Two additional cold-family cases are **opt-in unresolved qualification gates**,
  not passing coverage. Run `FOVEA_COLD_FAMILY_PROBE=1` with the test module to
  reproduce strict failures and private reports. Both reference self-comparison
  and native comparison currently differ in ordering/generation; no fields or
  tolerances were weakened. The default run visibly skips these two cases.
  Two separately named default cases compare cold cores with FIFO source-read
  scheduling and exact captured parser bytes. Both reference and native start
  with empty storage; no extracted facts are shared. These are **controlled-input
  component tests**, not independent-cold qualification. See
  `docs/fovea/cold-input-contract.md`; set `FOVEA_RETAIN_CONTROLLED_REPORT=1` to
  retain private success reports/tapes (failures are always retained).
  Two further default cases independently execute the pinned parser under an
  explicit single-rule/one-thread schedule, with FIFO reads and fresh core stores.
  Reference repeats must be byte-identical before normalization. No parser output
  is replayed; this schedule is still component evidence, not production batching
  or independent-cold qualification.
- `tests/fovea/cold-inputs.test.ts`: exact request/output tape identity, safe
  operand-delimiter adaptation, corruption/quota/missing-call rejection and
  source-read queue error recovery; live schedule order/bytes, subprocess receipts,
  errors, temporary-file cleanup and unsupported-input rejection. No output
  sorting or rule-ID remapping.
- `tests/fovea/engine-review.test.ts`: source races, cancellation, rule trust,
  A/B/A ownership and prepare-versus-acknowledge synchronization.
- `tests/fovea/provenance.test.ts`: exact committed transitions, private shared
  journal, foreign/mixed/unattributed changes and conservative gaps.
- `tests/fovea/config-project.test.ts`: approved exact-root overrides and strict
  private publication/precedence/revisions.
- `tests/fovea/host-process.test.ts`: real built engine and fault-process cleanup.
- `tests/fovea/guest-focus-read.test.ts` / `tests/fovea/guest-grep.test.ts`:
  checked QuickJS composition through ordinary registry authority.
- `tests/fovea/packaging.test.ts`: parser pins, strict assets and generation policy.
- `tests/installed-independence.test.ts`: actual installed profile/parser after
  acquisition removal; fake Kiro contract, not native-client qualification.

Core numerical tests preserve the pinned algorithms. Dynamic reference-driver
imports explain the retained upstream core export surface in Knip. Do not erase
missing edges/warnings, adjust tolerances or manufacture oracle output to pass.
Harness spawn allowances stay separate from exact production deadlines.
See `docs/fovea/acceptance.md` and `docs/fovea/parity-matrix.json` for scope/gates.
