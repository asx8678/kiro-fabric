# Human approvals, session isolation and automatic integration

Follow-up to [native controls closeout](native-controls-closeout.md).
**Not finished native integration.** Explicit navigation is separate from these
contracts. No automatic hook, routing heuristic or permission bypass is enabled.

## Acceptance ledger

1. **Human decisions:** six fresh private cases (controls/rules/modes, each accept
   and decline), exact session/tool/typed form response and reviewed arguments,
   expected effects or unchanged state, same bundle, no replay. Preserve each
   checkpoint and stop at the first blocked case. No automated responses.
2. **Native isolation:** require exact fresh calls and matched clear acknowledgment;
   compare the pre-clear seed focus with the new native chat's default dwell.
   A retained exact ID is a failed case (exit 3), not a successful isolation test.
   Missing/mismatched evidence never qualifies isolation. Supported native
   session/epoch/request ownership is needed for a real fix.
3. **Automatic integration:** reobserve actual hooks/MCP metadata, keep all native
   gates unqualified and hooks off, expose ownership limitations in `fabric.info()`.
   Hook stdout/continuation is not intended-turn model input acknowledgment.
4. **Verification:** targeted typed/generated-program, evidence anti-replay,
   matrix/CLI, public status and delivery-boundary regressions; native behavioral
   diagnostics and a fresh build. The publication checkpoint below records the
   required full check for the authorized commit/push. No live profile update,
   client installation, signing or issue publication is claimed.

## Human-operated command

Build a current complete bundle first. In a **real human-controlled terminal**:

```sh
pnpm run build
node scripts/build-complete-bundle.mjs > .tmp/fovea-human-bundle.json
BUNDLE="$(node -p 'require("./.tmp/fovea-human-bundle.json").root')"
pnpm run qualify:fovea:human --authenticated --bundle "$BUNDLE"
```

The CLI requests the user's decision; it does not make it. Review only the owned
fixture actions. `/quit` after each completed turn (controls includes a read-only
resume turn). Use the explicit decline action, not cancellation. For rules/accept,
review and approve the deliberately stale-hash request too: Fabric must reject it
with its real hash-validation error and leave anchors unchanged. Modes test stored
settings and explicit navigation, **not** native hidden/UI presentation.

Each of six cases creates fresh private workspace/data. The matrix writes private
`checkpoint-N.json` files after attempts, validates native identities, reviewed
arguments, effects, unchanged fixtures and equal bundle digests, and stops on the
first failure. It does not import arbitrary reports or retry failed decisions.
Exit 0 means six observed cases, not complete human/revocation or H01–H12
qualification. Exit 2 means a blocked/incomplete case. Individual cases remain:

```sh
pnpm run qualify:fovea:controls --authenticated --bundle "$BUNDLE" --interactive --case rules --decision accept
pnpm run qualify:fovea:controls --authenticated --bundle "$BUNDLE" --interactive --case modes --decision decline
pnpm run qualify:fovea:controls --authenticated --bundle "$BUNDLE" --case lifecycle
```

Lifecycle diagnostics now return **3** for witnessed cross-chat focus retention,
**2** for an incomplete diagnostic and **0** for a completed diagnostic without a
witnessed focus-retention failure. **Even 0 is not complete isolation**: concurrent
chats, explicit retained results, settings and rule trust still require evidence.
The previous closeout's exit-0 lifecycle observation predates this failure gate.

## Current observations: Kiro CLI 2.22.1, Darwin arm64

- This tool session has no human TTY. The new operator command exits **2** before
  opening a bundle or a client: `Human qualification requires your terminal`.
  Evidence: `.tmp/fovea-followup-human.log` / `.exit`. No choice was synthesized.
- A fresh actual-Fabric native TUI approval diagnostic again observed one matched
  `_kiro/mcp/elicitation` missing-handler response. The exact fixture stayed
  unchanged; neither accepted nor declined effects were observed. **Host-blocked**,
  not just missing a terminal. `.tmp/fovea-followup-approval.log` / `.exit` (diagnostic
  exit **0**); raw scope `.tmp/fovea-approval-Lbb82d/` remains private.
- A new native hook/MCP fixture completed (exit **0**): hooks had `session_id`,
  but all three MCP calls carried only `name`/`arguments` and `meta:null`.
  `.tmp/fovea-followup-routing.log` / `.exit`, `.tmp/fovea-native-4upKSf/report.json`.
  All hook types and a continuation call were observed, not intended-model-input
  delivery. This fixture is **not** Fabric execution or an automatic gate pass.
- Fresh actual-Fabric lifecycle recheck completed all six exact calls, matched
  compact/swap/clear acknowledgments and same-MCP post-detach denial. Automatic
  readiness/delivery stayed off. **Isolation failed again:** a new native chat
  could dwell on the prior chat's exact seed focus in the same MCP instance.
  The CLI now correctly exits **3**, with `nativeSessionIsolation.status:"failed"`;
  this is a known unmet requirement, not a local unit-test failure or a repaired
  boundary. `.tmp/fovea-followup-lifecycle.log` / `.exit`; private scope
  `fovea-native-controls-XZvsYc` retains raw frames, plans and per-phase results.
  Bundle/fixture bytes stayed unchanged. Tested bundle digest:
  `c1c918ad6a4a50493e67dadb7c1e73e796a04d5994ffb4152b4a1e723d7541e4`.

## Local verification

- Latest changed-path regressions: **114 passed**, 3 files;
  `.tmp/fovea-followup-correlation.log`. Includes pre-call/late form rejection,
  exact normalized root/revision/hash/config checks and matrix anti-replay cases.
- Earlier broader targeted run: **137 passed**, 6 files;
  `.tmp/fovea-followup-verification.log` (includes delivery boundaries, unchanged
  qualification records and package/audit checks). Counts overlap; do not add them.
- The separate public native-status cases also passed in the initial four-file
  run, `.tmp/fovea-followup-tests.log`. These verify both trusted-embedder modes
  still report native integration unqualified, not native client functionality.
- Both typechecks and dead-code lint passed; the registered human CLI help and
  non-TTY refusal were exercised directly. Fresh `dist/` and a complete native
  bundle were built. Final build follows documentation closeout.
- Working-tree structural review flagged diagnostic validation complexity and
  test/script coupling; witnesses were inspected. No correctness certification
  is inferred from structural metrics or generated-file coverage gaps.
- **Fresh full `pnpm run check`: exit 0**, using the trusted standalone Node.
  **3,349 passed / 63 skipped**, **208 files passed / 5 skipped**; test duration
  **1,386.21 s**. Evidence: `.tmp/fovea-publication-check.log` / `.exit`; the full
  report is `.tmp/vitest-report.json`. Typechecks, build, dead-code lint, staging,
  component certification and SBOM generation also completed successfully.
  This is the current run, not the prior 3,294-pass result. Skips and component
  certification do not qualify authenticated native contracts.
- That full check covers the current runtime/scripts/tests. Only verification and
  reporting markdown was finalized afterward; the final production build follows
  this closeout. Commit/push state is recorded by Git, not inferred from a test pass.

`fabric.info().fovea.sessionIsolation` now warns that the MCP instance owns the
state and native clear has no guaranteed reset. `automaticQualification` says
`ready:false`, names all twelve required gates and lists no qualified native gates.
Neither is a repair or an enable switch. No client capability advertisement,
matching cwd, guest argument, hook-file rendezvous, process-count heuristic or
component test substitutes for the missing native contract.

Next upstream work: a functioning form UI/typed decision handler; documented,
authenticated native session/epoch/request binding shared with MCP; isolation and
revocation semantics; intended-turn delivery acknowledgment and the remaining
native gates. [Issue drafts](../upstream-client-issues.md) have fresh evidence but
are **unpublished**. Do not claim a newer client fixes these without rerunning the
positive and negative cases on that exact version.

## Publication checkpoint (2026-09-21)

The official stable manifest lists **2.22.1**, matching the observed client.
Targeted duplicate searches distinguish the CLI handler failure from IDE Power
elicitation, and native chat ownership from HTTP MCP transport-session headers.
The latter is a supported-contract/API request, not a base-MCP violation.

Sanitized report bodies are ready in [upstream-approval-report.md](upstream-approval-report.md)
and [upstream-session-report.md](upstream-session-report.md). They do not assume
public access to the checkout or contain private recordings, paths or session IDs.
Reduced recipes are not misrepresented as separately executed standalone probes.

**Filing is still blocked:** GitHub CLI authentication is absent (`gh api user`
exits 4). No issue was created. The owner must run `gh auth login` and recheck
potential duplicates before the documented filing commands can be used. See
[filing and closure](../upstream-client-issues.md#filing-and-closure).

After the client contract is fixed/documented, run the genuine human matrix and
native `/clear` isolation probe, then qualify all remaining automatic gates.
Until then, automatic hooks remain off; no navigation rewrite, guessed identity,
blanket approval, or green component test is substituted for those gates.
