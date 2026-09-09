# Coding readiness investigation — 2026-09-09

## Decision

**Installation healthy; full interactive coding readiness BLOCKED.** A healthy doctor, valid agent profile, successful build, and passing component tests do not establish that a human-approved shell command or file edit works through the real Kiro v3 UI.

This report records an operator-authorized local investigation, not release certification. Existing uncommitted work was preserved. No credentials, raw conversation contents, or complete private logs are copied into the repository. No issue, PR, commit, or release was created by this investigation.

## Observed setup and ownership

- Repository HEAD at diagnosis: `5010a2c177b5d65b948ad75ea21f548c44f123de`, plus existing local changes. A fetch during the earlier update found HEAD equal to `origin/main`; this is a dated observation, not a continuing freshness guarantee.
- Fabric package: `0.64.0`; local source build on macOS ARM64.
- Kiro CLI: `2.21.2`. `kiro-cli update --non-interactive` reported `No updates available, 2.21.2 is the latest version.` on the investigation date.
- Fabric profile: `~/.kiro/agents/kiro-fabric.json`.
- Managed launcher: `~/.kiro/kiro-fabric/bin/kiro-fabric`.
- Persistent Fabric configuration: `~/.kiro/kiro-fabric/data/fabric/config/config.json`.
- Active generation at diagnosis: `30c293ee717a3e03c30a3cd59e1db4fcbd4873182b55aacf68a95c27a6b5bf97`. A later source refresh may activate a different immutable generation; inspect `install-owner.json` for current identity.

The Kiro application binary is separate from the Fabric runtime in `~/.kiro`. Updating Fabric cannot add a missing handler to Kiro's own terminal UI. Do not manually edit integrity-tracked installed profile/runtime files; use the source installer.

The private Fabric config contained only tracing settings, with no approval overrides. Consequently the installed defaults are `read: allow`, `write: ask`, `execute: ask`, `network: ask`. Outer permission for `fabric_exec` does not authorize nested shell commands or edits. Shell commands have host authority even if their text looks read-only; write/network settings do not confine an approved shell.

## Four reported failures

| Failed batch | Cause | Interpretation and response |
|---|---|---|
| Read limit | The agent requested 10,000–15,000 lines; `local.read` allows at most 2,000 per call. | Agent argument mistake; correct the limit and follow `nextOffset` only within the requested range. |
| Missing file | A guessed deployment compose-file path did not exist. | Recoverable discovery failure; list/search before reading a speculative path. This batch also attempted shell commands. |
| Shell approval | No successful nested authorization was obtained. | Effects remain blocked; inspect the client approval path instead of weakening policy. |
| Repeated shell approval | Another shell command was attempted without resolving the blocker. | Avoidable retry; stop affected effects until approval is functional. |

The `Promise.all` batches allow some independent calls to complete before another rejects. The partial-call summary records those outcomes; successful reads are not additional errors. The outer response repeats the error under `response` and `message`. Failure is not rollback: inspect partial effects before retrying, and do not blindly replay effectful batches.

A separate review-quality problem did not necessarily throw: `local.find` accepts **globs**, not regular expressions. Use `**/*_test.exs` rather than `_test\.exs$`. Check truncation and inspect matches before presenting file counts. The original review's counts are not established by those incorrect patterns.

## Confirmed approval blocker

Private client evidence: `~/.kiro/logs/20260909T144910833/kiro.log`, lines 161–162, 175–176, and 201–202. Kiro requested form elicitation, then reported:

```text
[ACP Elicitation] extMethod _kiro/mcp/elicitation failed:
No handler registered for method: _kiro/mcp/elicitation
```

Corresponding Fabric evidence: `~/.kiro/kiro-fabric/data/fabric/traces/fabric-60723-mtu7s7lv.jsonl`, sequences 118/122, 138/141, and 177/181. The first form response was recorded as an error; subsequent responses were cancellations within milliseconds, without approval. The first batch also had a missing-file failure, so its timing alone is not the root-cause proof; the explicit Kiro client error establishes the missing handler.

This is **not evidence of a deliberate user refusal**. Kiro advertised enough capability for Fabric to send the form, but the UI-side ACP handler was absent in the observed session. Capability advertisement is not end-to-end approval evidence. The generic `approval was denied or unavailable` message also covers other causes; do not infer this exact client defect from that message alone.

Relevant implementation: `src/kiro/mcp-server.ts` sends MCP form elicitation; `src/kiro/power/approver.ts` requires an accepted response with `approved: true` and otherwise fails closed. There is no supported local permission setting established by this investigation that supplies Kiro's missing UI handler.

## Readiness ledger

| Gate | Evidence/status at diagnosis |
|---|---|
| Build artifacts | `node scripts/assert-build-artifacts.mjs` passed. |
| Managed installation | Source-manager and installed-launcher doctors reported healthy; no pending journal/lock. |
| Profile schema | `kiro-cli agent validate --path "$HOME/.kiro/agents/kiro-fabric.json"` succeeded. |
| Read-only review | Real Kiro v3 `local.read`, `local.list`, and searches returned results; this does not validate the final review's accuracy. |
| Approval policy | Safe defaults retained; no blanket allow, automatic approval, or native-tool fallback added. |
| Explicitly approved shell | **BLOCKED — no successful human-approved live shell result recorded.** |
| Explicitly approved file edit | **BLOCKED / NOT RUN successfully through the live v3 UI.** |
| Negative approval controls | Component coverage exists; real-v3 decline/no-effect evidence remains required. |
| Signed release and lifecycle certification | Separate gates remain unqualified; the production trust root is absent. |

Earlier session reporting recorded `pnpm run check` with 77 files, 1,213 tests passed and four skipped. Those are historical component-gate results, not a fresh live-approval test or release certification. The four skipped tests are unrelated to the four failed tool batches above. An interrupted earlier reinstall left a healthy installation with no pending journal/lock. That snapshot and an unchanged activation ID do not prove that no transaction was ever started; do not infer exact interrupted control flow from them.

## Required retest after a client fix

1. Obtain a Kiro v3 client/UI that actually handles `_kiro/mcp/elicitation`; check the normal updater. Keep write/execute/network at `ask`. A different ACP client is not proof that the native Kiro TUI works.
2. Start a **new** conversation in a disposable, verified workspace using the managed launcher. Prepare a non-sensitive fixture file containing `before\n` yourself; fixture creation is not Fabric approval evidence.
3. Request only `local.shell({command:"printf 'FABRIC_SHELL_OK\n'",timeoutMs:5000})` through `fabric_exec`. Inspect the exact command/cwd in the UI and approve once. Require the actual sentinel, exit code zero, and matching successful approval/result evidence.
4. Separately read the fixture, request `local.edit` replacing the unique `before\n` with `after\n`, review the complete diff and approve once. Read back through Fabric and independently verify exact bytes.
5. Exercise a declined edit and declined shell request; verify no corresponding effects occurred. Do not treat fixture auto-approvers, mocked clients, a headless run, or outer-tool trust as human approval evidence.
6. Clean up only the disposable fixture and record actual passed, failed, and blocked checks. Stop if the handler error persists; do not retry effects or switch to blanket allow.

Only after both live approvals and verified effects succeed should the local setup be called coding-ready. Full release qualification still requires its independent gates.

## Source refresh procedure

```sh
# Rebuild after changing canonical bundled guidance; include generated source.
pnpm run build
pnpm exec vitest run tests/guidance.test.ts tests/strict-bootstrap.test.ts
bash ./install.sh --source --kiro-home "$HOME/.kiro" --yes --non-interactive --json
"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" doctor --json
kiro-cli agent validate --path "$HOME/.kiro/agents/kiro-fabric.json"
```

The source installer performs frozen dependency installation, a fresh build, bundle validation and managed activation. Preserve unrelated settings, sessions, data and existing working-tree edits. Restart existing Kiro conversations to load the new profile/resources. Installation completion does not close the approval blocker.
