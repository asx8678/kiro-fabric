# Fovea settings and native control/lifecycle follow-up

Current extension: [native controls/lifecycle closeout](native-controls-closeout.md).
The earlier verification below retains its original scope.

## Scope and implementation order

1. **Unsupported-setting presentation:** keep the strict `fovea.v1` storage schema
   and revision hashes unchanged. Settings/configure responses and status expose
   `settingSupport["sync.ackClean"]` with requested/effective values and a reason.
   The requested value remains round-trippable, but effective is always false.
   Do not imply any native UI notification or automatic model delivery exists.
2. **Port documentation:** correct the Linux-only and disconnected-provenance
   statements in `src/fovea/core/PORT.md`; preserve the original dated test evidence.
3. **Native qualification tooling:** replace the one-off read-only controls check
   with a reusable real-Fabric control/resume diagnostic in
   `scripts/fovea-controls-probe.mjs`. Require an explicitly trusted, validated,
   current native complete bundle and explicit authenticated opt-in. Use private
   workspace/data, normal ask-policy approvals, exact guest inputs/results,
   fresh nonces and native session identity. Never automate human approval.
4. **Verification:** settings/storage/provider regressions, probe evidence
   rejection tests, direct built behavioral checks, both typechecks, package
   registration checks and a final fresh build. A diagnostic completion is not
   an H08/H09 pass or a full-suite certificate.

## Acceptance ledger

| Check | Required evidence |
| --- | --- |
| Unsupported setting is visible | Defaults, session/project/global updates, reload and host status show requested versus effective; no metadata stored in config files or revision hashes |
| No core rewrite | Navigation/sync algorithms and automatic-hook registration unchanged |
| Real controls, not status substitutes | Configure then reread; reset rejects a previously replayable result; reload clears session config, restarts engine and expires retained results |
| Resume evidence is fresh | Exact native call/input/completed result, fresh phase nonce, same native session, new Fabric trace events; report host-instance identity separately |
| Approval remains authoritative | Ask policy unchanged; no auto-accept; errors/declines never count as successful mutations |
| Evidence is scoped | Wrong mode, replay, wrong tool/call/session/input, missing traces or dirty bundle/fixture fail closed |
| Local verification | Focused tests and direct probes, typecheck and fresh build; record actual outcomes below |

## Running the native diagnostic

Build the current checkout and its matching complete bundle first:

```sh
pnpm run build
node scripts/build-complete-bundle.mjs
pnpm run qualify:fovea:controls --authenticated --bundle /absolute/trusted/bundle
```

Use the exact bundle root printed by the builder (not the archive). The probe
validates its bytes, native target and current build-input digest before running
its private Node/runtime. It creates a canonical private temporary workspace
outside the checkout so Git ignore rules cannot hide the source fixture.
Authenticated Kiro uses the existing login and may record its usual client session;
probe profiles/configuration are disposable, never installed in the live home.

The default is bounded headless diagnostics and sends no approval response.
Kiro 2.22.1 headless emits stream events rather than writing the ACP recorder.
The probe validates those native events as `native-headless-stream`, separately
from interactive `native-acp-recorder` evidence. It never synthesizes protocol
requests or approval acknowledgments; Fabric-only cancel reasons cannot prove a
missing native handler or human decline.
For actual human review, append `--interactive` in your own terminal; inspect the
configure/reset/reload requests, then `/quit` after each of the two turns. This
mode deliberately waits for the human terminal and is not an unattended test.
Never change ask policy to manufacture a pass. Source and bundle must remain
unchanged. All private recorder output is retained; don't publish raw transcripts.

`report.json` separates `diagnosticCompleted`, per-effect `checks`,
`controlsObserved`, `resumedNewTurn` and host-instance observations. Exit 0 only
means the bounded diagnostic completed with intact fixture/bundle evidence.
`qualified` and `automatic` remain false even if every local control check passes.
Failed/denied actions are recorded, not silently replaced with status calls. A
fresh resumed native turn is not proof that its prior MCP-local state survives.

## Explicitly deferred gates

Actual native controls may remain blocked by the missing Kiro form handler. A
missing handler is not a human decline. Resume observations do not prove native
session-to-MCP routing or state restoration. Clear/compact/profile-swap isolation,
all UI presentation modes, exact-hash rule-adoption approval, workspace revocation,
and old-generation retention across an authorized update remain separate next
qualification cases. No installer or installed profile is changed by this work.
Automatic hooks, hidden delivery and continuation remain disabled. No production
timeout, reference assertion, ownership check or approval policy is relaxed.

## Verification results

### Local implementation

- Storage/host modules: **33 passed**, including defaults and all configuration
  layers, hash/storage compatibility, configure/settings/status presentation and
  lazy-engine behavior (`.tmp/fovea-controls-tests.log`; its initial probe-module
  failures are preserved, not counted as passes).
- Checked guest focus/read and grep modules: **14 passed**
  (`.tmp/fovea-controls-guest-tests.log`; earlier probe-module failures retained).
- Native probe evidence module: **32 passed**, including both actual recorder
  envelopes, exact input/nonce/call/session/mode checks, out-of-order/replay
  rejection and generated guest typechecking
  (`.tmp/fovea-controls-evidence-final-tests.log`).
- Package/guidance/profile/native-status/qualification-record modules: **38 passed**
  (`.tmp/fovea-controls-boundaries.log`). No existing native gate was promoted.
- Both TypeScript checks, dead-code lint, guidance check, `git diff --check`, fresh
  build and native complete-bundle build passed. These are focused checks, not a
  new full-suite certificate. The structural review's complexity/coupling findings
  were advisory; source witnesses were inspected, not treated as defect verdicts.

### Real Kiro 2.22.1 diagnostic

Fresh headless initial and resumed turns both completed with exact
`@fabric/fabric_exec` input/result, distinct nonces/call IDs, the same native chat
ID, selected probe profile and fresh Fabric execution traces. Source/hash and
unsupported-setting presentation checks passed; automatic remained false.

All three mutation approval waits returned cancellation before dispatch. Therefore
configure/reset/reload effect checks remain **unqualified**, not passes or human
declines. No native handler diagnosis is inferred from these headless cancel
responses. The resumed turn used a **different Fabric host instance** and could
not replay the previous retained result. This is actual Fabric evidence, unlike
the earlier protocol-only resume fixture, but still not state restoration or
native session-to-MCP association qualification.

- Evidence directory: `/private/var/folders/h9/04n59szn6793rg31xhy64b400000gp/T/fovea-native-controls-mh6m8a`.
- Summary/exit: `.tmp/fovea-controls-native-final.log` and
  `.tmp/fovea-controls-native-final.exit` (**0**, diagnostic completion only).
- `report.json`: `diagnosticCompleted:true`, `resumedNewTurn:true`,
  `controlsObserved:false`, `qualified:false`, `automatic:false`;
  bundle and source fixture unchanged.
- Tested bundle digest:
  `bdbbeb8cf9f97b67555575f6570e4f74eb4da469fbc04d11c4e731433cb5c0a5`.
  It is a local-source artifact, not a signed production release or installed update.
- The first attempt incorrectly expected a headless ACP recorder; its **exit 2**
  report is preserved separately in `.tmp/fovea-controls-native.log` and the
  `fovea-native-controls-Ho8a1P` private evidence directory. The diagnostic was
  corrected to validate witnessed headless stream events separately, with new
  regression tests; no protocol acknowledgments were fabricated.

Next: run the documented interactive mode in a human terminal once native forms
work; retain genuine accepts/declines and effect checks. Then extend native
clear/compact/profile-swap and old-generation retention cases. Existing H08/H09
and other automatic/native release gates remain unchanged.
