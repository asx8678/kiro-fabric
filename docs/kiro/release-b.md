# Release B certification

> Historical v2 evidence. The current real-gate script targets the v3 tuple;
> no new authenticated result is claimed here.

Release B is the opt-in real Kiro CLI `2.19.1` / `--agent-engine v2` gate for
session-resident behavior.

## Supported tuple

- Node `>=24`
- `kiro-cli 2.19.1`
- `--agent-engine v2`
- Agent `kiro-fabric`
- Project-scoped managed profile with a temporary no-op MCP fixture

## Real opt-in gate

This path is fail-closed and is the only Release-B certification path allowed
to consume a real model turn.

```bash
KIRO_FABRIC_RELEASE_B_REAL=1 \
KIRO_FABRIC_RELEASE_B_BILLABLE_ALLOWED=1 \
pnpm certify:release-b:real
```

The script:

1. `npm pack --ignore-scripts` into a temporary directory
2. Installs the tarball into a clean consumer outside the repository
3. Runs packed `kiro-fabric install kiro` against a temporary project
4. Rewrites the managed profile + manifest to point at a temporary no-op MCP
   fixture so the gate proves ACP session behavior, not `fabric_exec`
5. Spawns `kiro-cli acp --agent kiro-fabric --agent-engine v2`
6. Proves claim 1: `initialize` → `session/new` → `session/prompt` →
   `session/prompt` on one live ACP process, with both prompts ending
   `stopReason: end_turn`
7. Stops the first ACP process, starts a later ACP process with the same
   retained isolated `KIRO_HOME`, then proves it can `session/load` the
   persisted `sessionId` and complete another `session/prompt` with
   `stopReason: end_turn`

## Claims proven

- One live Kiro ACP process accepts a second prompt on the same session after
  the first returned `end_turn`.
- A later ACP process using the same retained isolated `KIRO_HOME` can resume
  that locally persisted session via `session/load`. Kiro CLI 2.19.1 may omit
  `sessionId` from the successful load response; the requested ID remains
  authoritative unless a conflicting ID is returned.

## Refusal / fail-closed constraints

- Hard-fails unless `KIRO_FABRIC_RELEASE_B_REAL=1` is set.
- Hard-fails if `KIRO_PHASE0_BILLABLE=1` is set.
- Hard-fails before any `session/prompt` unless the additional explicit allow
  `KIRO_FABRIC_RELEASE_B_BILLABLE_ALLOWED=1` is set.
- No other certification path may use billable real turns; all others stay
  non-billable by default.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Both claims proved and the final summary line is `PASS: ...` |
| 1 | Refused, tuple mismatch, ACP/protocol failure, or either claim failed |

The script keeps stdout/stderr bounded and always emits a final `PASS:` or
`FAIL:` summary line.

## Recorded real result

On 2026-08-24, the double-gated command passed against authenticated
`kiro-cli 2.19.1`: `initialize → session/new → session/prompt → session/prompt`
on one process, then `initialize → session/load → session/prompt` on a new
process with the retained isolated `KIRO_HOME`.
