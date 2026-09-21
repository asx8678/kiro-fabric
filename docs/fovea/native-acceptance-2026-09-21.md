# Native acceptance follow-up — 2026-09-21

Kiro CLI **2.22.1**, native Darwin arm64, existing authorized authentication.
This supersedes the earlier *untested* H09–H11 and Escape-only H07 dispositions,
not their retained historical artifacts. **No complete H gate passes; automatic
integration stays disabled; releaseReady stays false.**

## Acceptance ledger

| Area | Actual result | Still required |
| --- | --- | --- |
| Real native approvals | Real built Fabric requested an edit approval. Matched native response: `No handler registered for method: _kiro/mcp/elicitation`. Fixture unchanged. **H10 host-blocked.** | Native handler support, then real human accept/decline exact edit and shell effects, plus workspace revocation. A missing handler is not a decline. |
| Tool visibility | Only `@fabric/fabric_exec` was observed in the real-Fabric TUI probe and a separate unchanged installed standard-profile run. **H11 partial.** | Authoritative complete model-input tool inventory. Observed calls, configured tools and `/tools` are insufficient to prove no hidden tools. |
| Cancellation and queue | Native cancellation acknowledged; submitted queued prompt ran and completed. Original fixture hook survived another **5,517 ms**, beyond the queued turn. **H07 partial.** | Cancellation of all automatic hook/engine work and full queued-user precedence. |
| Session lifecycle | Fresh resumed fixture call previously observed. Native compact, profile swap and clear now have matched responses and fresh marker calls; clear created a new session. **H08 partial.** | Actual Fabric restoration/isolation. Corrected native fixture driver exited 0 with all four checks; actual Fabric restoration/isolation remains unqualified. |
| Controls | Real Fabric `repo.status()`, `repo.settings()` and `repo.focus()` succeeded without changing fixture or bundle bytes. **H09 partial.** | Actual settings changes/reset/reload and all presentation modes, with working native approvals. |
| Automatic integration | Supported session-to-MCP association and intended-model-input acknowledgment remain unavailable. | H01/H02 routing, H04 delivery and the remaining complete lifecycle contracts. No cwd/PID/argument heuristics or private RPC workaround. |
| Retained generation | Not exercised; no new installation/update performed. | Authorized update while a native session retains its generation-matched engine/hooks (H12). |
| Release | Read-only exact preserved Darwin arm64 bundle/archive smoke passed. | Other three native targets, exact-current-commit artifacts, minimum systems, installed/client qualification, production trust/signing and authorized promotion. |
| Optional reference gates | Both uncontrolled cold budgets and both external comparisons executed and failed qualification. | Resolve documented mismatches without weakening coverage, oracle or tolerances. |

## Real Fabric approval evidence

Reproducible opt-in diagnostic:

```sh
node scripts/fovea-approval-probe.mjs --authenticated
# Only from a real human terminal, after native form support exists:
node scripts/fovea-approval-probe.mjs --authenticated --interactive
```

The diagnostic creates only private scratch workspace/profile/data, uses the
actual `dist/kiro-agent-closure/kiro/mcp-entry.js`, and explicitly asks for write,
execute and network approval. It never auto-approves. The normal installed
profile and its policy are not rewritten. `kiro-cli` is declared as an intentional
external executable in `knip.json`, not installed as an npm dependency.

Final native TUI process exited **0**, without timeout, after one Fabric call and
one matched native form (ID **1**). Fabric request/response traces corroborate the
native missing-handler response. `fixture.txt` SHA256 before and after:
`73cc836b87afeb7110eedea254489a0559cfa4a98c06fabb6aa4a46848d27cf9`.
No edit happened; no human acceptance/decline or workspace revocation is claimed.
Evidence: `.tmp/fovea-approval-wYMWdU/{report.json,native-acp.jsonl,build-identity.json}`.
The build identity belongs to that measured closure, not later source builds.

The separate read-only installed-profile probe selected `kiro-fabric`, retained
both standard resources and observed `@fabric/fabric_exec`. Its profile SHA256
remained `c33be92e402cc76f2c4fc3fd45240470f48e10863841d321091a44c44902caf2`.
Evidence: `/private/tmp/fovea-standard-inventory-sgwRsQ/{report.json,native-output.json}`.
No extra client tool was observed **in these runs**; this is not complete-inventory
qualification or a retraction of historical client-injected-tool observations.

## Native lifecycle and controls

```sh
node scripts/fovea-lifecycle-probe.mjs --authenticated
node scripts/fovea-lifecycle-probe.mjs --authenticated --tui-cancel
```

These lifecycle commands use a harmless MCP/hook fixture, **not Fabric**. The
resume mode requires the same authoritative stream session, final probe mode,
clean processes and distinct fresh nonces in nonoverlapping recorder windows.
Replay text cannot satisfy it.

The TUI mode uses native UI input only: Ctrl+S switches to Queue mode; Enter
actually submits the queued prompt; Escape requests cancellation. Recorder
analysis correlates actual request/response IDs and session identity, not merely
key writes. In `.tmp/fovea-lifecycle-FddnQz/`, prompt ID 3 returned `cancelled` at
`1789972066056`; `_kiro/hooks/cancel` was also observed. The queued prompt started
**6 ms** after that response and completed. The delayed hook ended **5,517 ms**
after the cancellation acknowledgment, with no instrumented signal. The probe
exited 0. This establishes surviving fixture hook work, not a blanket claim that
all native cancellation fails or complete automatic-work precedence passes.

Separate UI `/compact`, `/agent swap` and `/clear` probes recorded matched native
responses and four fresh fixture calls. Clear changed session identity. Retained
artifacts: `.tmp/fovea-session-controls-3Dq60v/{report.json,native-acp.jsonl,mcp.jsonl,native-output.json}`.
The final driver exited **0**, with all four checks true: fresh calls, matched
compact response, acknowledged selected profile and a distinct clear-created
session. These are native fixture transitions, not actual Fabric restoration or
isolation proof. Earlier runs had `expect: spawn id exp5 not open` only after
native `Session ended`; the corrected driver handles that specific closed-PTY
case and still rethrows other errors. The earlier failed run remains in
`.tmp/fovea-session-controls-DNIhGm/`, not counted as a pass.

Actual read-only Fabric controls used a validated private Darwin bundle and
`controls.ts`: initial `engineStarts:0`, settings scope `defaults`, successful
source/hash match, then `engineStarts:1` and `automatic:false`. All six checks
passed; process exit 0; bundle and fixture unchanged. Evidence:
`/private/tmp/fovea-explicit-controls-MYbSrn/{report.json,stream.jsonl}`.
Settings mutation, reset and reload were not silently substituted with status.

## Release evidence and provisioning blockers

`scripts/release-native-evidence.mjs TRUSTED_BUNDLE_ROOT EXACT_ARCHIVE [CHECKOUT]`
validates the schema-2 bundle, closure/build-input provenance and exact compressed
archive/member binding; requires a matching native host (no Rosetta claim); runs
pinned tool versions/private Node target/native addon with inherited environment
removed; then revalidates bytes. It never installs, signs or marks releaseReady.
Only explicitly trusted local artifacts may be executed by this smoke tool.

Measured preserved local-source bundle:

- Bundle digest: `6be77db98e9c9ed643934ddefaf6cdac4920a852454ede46e6b7f16375df01bc`.
- Archive: 52,980,087 bytes; SHA256 `d883647813d7f520e1c08a89b68adb7b86e42cc5f9b95b1ebbd27d41d0e1463a`.
- Original source digest: `47d2ec45d8ede0f4c783145f4be596720239d6362e702814c764dc0ad8bb3271`;
  original gitHead `3688e7040d2e4b51b2d3724e5821f151a1e39200`, dirty local-source.
- Five native probes passed; not a current clean-commit or production artifact.
- Report: `.tmp/release-native-evidence-darwin-arm64-final.json`; unsigned data-only
  SBOM descriptor: `.tmp/release-native-evidence-sbom.json`.

Darwin x64 and Linux arm64/x64 exact complete-bundle runs are not established by
this local smoke. Configured CI runner labels are not availability evidence.
GitHub CLI had no authenticated access; unauthenticated REST returned 404, which
proves unavailable visibility, not absent runners/artifacts.

The reviewed static Ed25519 production public trust root is empty. Bootstrap
correctly refuses with `Production release trust root unavailable: distribution
BLOCKED`. Public-root provisioning alone is insufficient: production native
qualification/promotion remains blocked, and the existing release workflow
publishes legacy Agent assets, not a completed complete-bundle promotion pipeline.
Maintainers must authorize/provision signer custody and public-root pinning,
four real native runners and retained exact-byte evidence. No keys were generated
or retrieved, no workflows dispatched, no signing/publication/install performed.

## Reference qualification and reporting repair

Pinned Fovea: `b594483868d27b7eb37a9b185c59ce812f8a9c01`.
Pinned host: `2ee51683452dc359702880f408e0b8a4bfcb9646`.
Darwin parser SHA256: `5651f0c6dcbbf2f7813297f9eb8f6ba00fb4ee2d81410a8138ac6151416f31ad`.

Actual uncontrolled cold comparison differences at budgets 512/16000: **204/289**;
reference self-repeat differences: **262/211**. Independently produced external
comparisons had **8 differences at each budget**. Each opt-in gate exited 1;
source/fixture inventories were unchanged. Evidence:
`.tmp/fovea-remaining-zOddTE/{summary.json,differences-512.json,differences-16000.json}`.
These fail-unqualified observations do not invalidate the separately scoped
controlled/production-deterministic successes or become successes themselves.

`tests/fovea/reference-differential.test.ts` now writes an initially unqualified
report and only publishes success **after all** coverage, inventory, comparison
and exact-byte assertions pass. Previously equal empty discoveries could write
a premature qualified report before a later assertion failed. Direct negative
control: both empty-discovery cases intentionally failed, had zero differences,
and retained `qualified:false` (`.tmp/fovea-empty-guard-NGs9I6/`). No tolerance,
production deadline or upstream oracle was changed.

## Verification scope

**62 distinct targeted tests passed**, no skips, across five modules after the
required audit-inventory registration was repaired:

- Approval/lifecycle/release: **42 passed** (15/16/11), recorded in
  `.tmp/fovea-next-final-tests.json`.
- Latest synchronized records: **10 passed**, `.tmp/fovea-next-records-final.json`.
- Corrected complete package-boundary module: **10 passed**,
  `.tmp/fovea-next-boundary-repair.json`.

The initial five-module report retains its **61 passed / 1 failed** missing-audit
result; only the affected module was rerun after repair. Counts above are scoped
final results, not a fabricated single green full-suite report. Strict source and
script typechecks, dead-code lint and `git diff --check` passed
(`.tmp/fovea-next-final-static.log`). Final summarizers replayed the real native
artifacts successfully, and the installed `fabric.info()` completed with actual
`fovea.nativeHooks.automatic:false` and `modelInputAcknowledged:false`
(`.tmp/fovea-final-behavior.json`).

Fresh handback build: `pnpm run build`, log `.tmp/fovea-next-final-build.log` and
exit record `.tmp/fovea-next-final-build.exit`. This is **not** a full-suite or
release-certification rerun. Historical full-suite reports remain unchanged.

Scratch reports are local evidence references, not portable-test dependencies.
No live profile/config changes, disk partition/mount changes, commit or push were
performed. Ordinary native sessions and owned fixture/evidence files were created.
