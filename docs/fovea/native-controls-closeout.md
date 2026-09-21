# Native controls and lifecycle closeout

Follow-up to [the settings/control plan](control-lifecycle-plan.md). This work
extends diagnostics, not core navigation or automatic native integration.

## Ordered implementation / acceptance ledger

1. **Approval evidence.** Correlate form request and typed response ID with the
   exact native session/tool call, operation, decision and resulting state. Expose
   separate accept/decline observations for configure/reset/reload. Human-terminal
   execution is explicit; no automated approval, fallback permission or invented
   cancellation-to-decline mapping. A terminal prerequisite failure stays pending.
2. **Actual Fabric lifecycle.** Reuse the validated complete bundle and private
   workspace. Drive supported native TUI compact, profile swap and clear commands;
   require matched native acknowledgments and fresh exact Fabric calls after each.
   Record native chat, MCP instance and Fovea host identities separately. Same
   identity is not isolation/restoration proof; resume remains a separate case.
3. **Remaining controls.** Add exact-hash rule adoption with before/after anchor
   evidence and a stale-hash rejection check; enabled/hidden/disabled settings
   with explicit navigation and default-off capability checks. Native UI delivery
   remains unqualified. Detach is deferred: require committed transition evidence
   and a later execution in the same MCP instance that cannot access the workspace.
4. **Finish.** Regressions must reject replay/wrong identity/input, generic errors,
   prepared-only detach and false control effects. Run native diagnostics where
   possible, both typechecks, review, full trusted-Node serial `pnpm run check`,
   fresh build, conventional commit and ordinary push. Preserve failed evidence.

## Boundaries

Only owned temporary fixtures, diagnostic profiles and data are changed. No live
profile installation/update, partition/disk administration, native approval
responses, production timeout changes, automatic hooks or signing/release actions.
The interactive approval cases require the user's terminal and genuine choices;
a pseudo-terminal driven by the agent cannot certify human approval. All reports
remain `qualified:false` and `automatic:false`. Rule and mode settings successes
are distinct from native UI presentation qualification. Full-check success is
local implementation evidence, not an H-gate pass.

## Operator runbook

Build a current native complete bundle as described in the earlier plan. Substitute
its absolute root for `BUNDLE` below; no installation is required. All cases use
owned private fixtures and the normal ask policy.

```sh
# Run these two cases in a real human-controlled terminal; choose separately.
pnpm run qualify:fovea:controls --authenticated --bundle BUNDLE --interactive --decision accept
pnpm run qualify:fovea:controls --authenticated --bundle BUNDLE --interactive --decision decline
# Review only these fixture controls. Exit each turn using /quit.

# Bounded real-client diagnostics (never respond to approval forms):
pnpm run qualify:fovea:controls --authenticated --bundle BUNDLE --case lifecycle
pnpm run qualify:fovea:controls --authenticated --bundle BUNDLE --case rules
pnpm run qualify:fovea:controls --authenticated --bundle BUNDLE --case modes
```

Rules/modes can also use `--interactive` for genuine human review. The rules case
requests trust for the exact `local.read` hash, inspects the added fixture anchor,
then requests a deliberately stale hash. A cancelled stale-hash request is **not**
a validation pass. Files and bundle must remain byte-identical. Modes test settings
and explicit navigation, never claim supported hidden/native UI delivery.

Lifecycle runs use a bounded, non-approving Expect driver, not a protocol fixture.
The driver sends only supported TUI inputs: `/compact`, `/agent swap`, `/clear`,
then explicit Fabric workspace detach and a fresh post-detach call. It waits on
recorder-backed completion/acknowledgment signals, not fixed sleeps or assistant
claims. Native IDs, MCP process IDs and Fovea host IDs are recorded separately.
No profile is installed in the live home. The existing controls case independently
tests headless resume. Isolation/restoration and in-flight revocation remain
separate unqualified obligations even when the diagnostic completes.

`approvalObservations` requires native form session/call/typed-response identity,
operation, choice and effect. `--decision` only tells the human what case to run;
it never grants permission or generates a response. Reports and raw transcripts
stay private; publish only reviewed bounded summaries. Exit 0 means diagnostic
completion, not complete feature qualification. Preserve nonzero attempts.

## Results

### Implemented and locally checked

The controls CLI now has separate human accept/decline observations, rules and
mode cases, and actual-Fabric native lifecycle/deferred-detach probes. Checked
programs, strict option parsing, session/tool/typed-response correlation, effect
checks, native command acknowledgments and false/replayed receipt rejection are
covered by regression tests. Core navigation, production deadlines, approval
policy and automatic-hook registration are unchanged.

### Native observations (Kiro 2.22.1, Darwin arm64)

| Requested work | Actual result |
| --- | --- |
| Human approvals | **Pending human terminal.** Interactive entry refused with `--interactive requires a human terminal` (exit 2). No pseudo-terminal or automated choice was substituted for a person. |
| Configure/reset/reload accept/decline | Correlated decision/effect collector implemented. Earlier headless controls/resume evidence remains separately recorded in the prior plan; no new human choice is claimed. |
| Compact/profile swap/clear | **Six fresh exact Fabric turns** and matched native acknowledgments observed. Same MCP instance throughout this run; clear created a different native chat. |
| Navigation-state isolation | **Not qualified; cross-chat retention observed.** `repo.dwell()` after clear returned the previous chat's exact focus ID (matching the preceding focus seed). Compact and profile swap also retained it. These are MCP-local states, not native-chat isolation. Reliable native session association is still needed; do not infer it from cwd or fabricate a reset hook. |
| Workspace detach | Host commit suffix observed, then a later execution in the **same MCP instance** reported unbound and `Unknown Fabric provider: repo`. This verifies post-commit denial, not cancellation of in-flight work or every revocation obligation. |
| Exact-hash rule adoption | Exact read hash verified; both real adoption requests cancelled **before dispatch**. No adoption, added-anchor or stale-hash validation pass. |
| Mode settings | Explicit navigation and automatic-off capability checks passed; all three configure requests cancelled before dispatch. No setting-change or native UI presentation qualification. |

All three completed diagnostics retained `qualified:false`, `automatic:false`
and unchanged bundle/fixture bytes. Lifecycle exit **0** means diagnostic
completion, not isolation. Rules/modes exits **0** likewise do not certify their
cancelled mutations. No missing-handler diagnosis or human decline is inferred
from headless cancellation alone.

Evidence is private and retained:

- Human prerequisite: `.tmp/fovea-native-closeout-human-prerequisite.log`.
- Rules: `.tmp/fovea-native-closeout-rules.log` / `.exit`; private report scope
  `fovea-native-controls-XXJ0k5`.
- Modes: `.tmp/fovea-native-closeout-modes.log` / `.exit`; scope
  `fovea-native-controls-hcynEz`.
- Lifecycle: `.tmp/fovea-native-closeout-lifecycle-v2.log` / `.exit`; scope
  `fovea-native-controls-wn1Z3t` contains `session-runs.json`, `native-acp.jsonl`,
  exact inputs, profile/build identities and `report.json`.
- The first lifecycle setup failed before native launch because its harness
  request exceeded the existing runner ceiling. The failed **exit 2** log remains
  `.tmp/fovea-native-closeout-lifecycle.log`. The diagnostic was corrected to the
  existing 300-second ceiling and regression-tested; no production bound changed.
- Tested local-source bundle digest:
  `c4a1d0b31727088c59accaf02a3e841fbcdf66ecfada562cd69e24b40efef3ec`.

### Full verification / commit gate

Trusted-Node **`pnpm run check` exited 0**: **3,294 passed / 63 skipped / 0 failed**;
207 passing files / 5 skipped files, 1,368.00 seconds in the test phase. All **15**
pinned lifecycle cases executed and passed. Guidance, both typechecks, fresh
build/staging, Knip, component MCP certification and 30-package SBOM passed.
Component certification is explicitly **not** authenticated Kiro qualification.

- Log/exit: `.tmp/fovea-native-closeout-check.log` and
  `.tmp/fovea-native-closeout-check.exit`.
- Preserved full report: `.tmp/fovea-native-closeout-full.json`, SHA-256
  `d9367b09488883aa0e5ee1abf74843379a811b03a0876a21b1855bbd37725a59`.
- The run used the trusted private Node and exact reference/parser environment
  documented in the prior closeout. No skipped test is counted as a pass.
- Structural review exposed complexity/coupling advisories in diagnostic evidence
  validation; source witnesses were inspected. It is not a correctness certificate.

Remaining gates: real human choices, supported native chat-to-MCP binding and
state isolation/restoration, actual rule/mode effects, native UI delivery,
in-flight revocation and old-generation retention. No H-gate or production release
claim was promoted. The completed local implementation is ready for conventional
commit/push; no installed profile was updated.
