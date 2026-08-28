# Baseline Report

> Historical Kiro v2 implementation record. See
> [capabilities-2.20.1-v3.md](capabilities-2.20.1-v3.md) for the current tuple.

- Repository: `monotykamary/kiro-fabric`
- Commit: `64b70fa7ebbbaabab447fcc4ecf2328e1284681c`
- OS: macOS 27.0 (arm64, Darwin 27.0.0)
- Node.js: `v24.19.0`
- pnpm: `11.20.0`
- npm: `12.0.2`
- Kiro CLI: `2.19.1`

## Test results

- `pnpm exec vitest run tests/skill-docs.test.ts` — pass (11/11)
- `pnpm exec vitest run tests/kiro-spike.test.ts` — pass (15/15: harness
  guards + fake-Kiro probe state machines, all non-billable)
- `node scripts/spike-kiro.mjs all` — pass (handshake, profile, mcp)
- `pnpm run typecheck` — pass
- `pnpm run build` — pass
- `pnpm run assert:lazy-graph` — pass
- `pnpm run test` — **pass (144 files / 1932 tests)**, including with the
  ambient leaking variables set, after isolating three suites (see below).
- `pnpm exec knip --no-gitignore` — pass (exit 0; the previously reported
  unresolved benchmark imports only occur on an unbuilt tree).

## Billable Phase 1 gate execution (real Kiro 2.19.1, `KIRO_PHASE0_BILLABLE=1`)

| Probe | Result |
|---|---|
| `acp-cancel` | Pass |
| `one-tool` | Pass (behavioral-only visibility claim) |
| `child-deny` | Pass |
| `long-request` | Pass (125002 ms with `requestTimeout=155000`) |
| `mcp-cancel` | **Fail** — no `notifications/cancelled` propagation (deterministic, 2 runs) |
| `mcp-elicit` | **Fail** — MCP form elicitation not advertised; preflight stopped before any prompt |

Full evidence and the resulting fail-closed decisions are recorded in
`docs/kiro/capabilities-2.19.1.md`.

## PR 8 Kiro ACP worker (fake, non-billable)

- `initialize` → `session/new` or `session/load` → `session/prompt`
- Managed profile required at the original installed repo root; `--trust-all-tools` never sent
- Each run gets an isolated `KIRO_HOME` profile while retaining the authenticated OS `HOME`; durable actors retain that Kiro home for local ACP session reloads. Worktree runs bind it to the generated worktree or effective worktree subdirectory cwd while the managed source profile remains authoritative
- Usage remains `availability: "unavailable"` / `runner-does-not-report`
- Worktrees are covered in fake tests; compact still fails closed
- Fake worker suite: `tests/kiro-worker.test.ts`

## Release B — session-resident Kiro turns (fake, non-billable)

- A run with a steering channel keeps one ACP process, session ID, and isolated `KIRO_HOME` lease alive across bounded next-turn activity.
- `steer` and `follow_up` queue entries issue additional `session/prompt` calls against the same live session; queue modes and pending-message status are preserved.
- Idle runs settle cleanly, while timeout, stop, permission, usage, and process-group fail-closed behavior is unchanged.
- Saved sessions resume through `session/load` before accepting resident turns.
- Fake coverage proves fresh-session steering/follow-up, idle settlement, loaded-session continuation, and managed-source/worktree cwd contracts. The double-gated real Kiro 2.19.1 certification passed on 2026-08-24.

## Environment-leakage diagnosis (fixed)

Three full-suite failures were deterministic ambient environment leakage, not
production bugs:

1. `tests/core-override-guidance.test.ts` — `src/index.ts` selects the
   `"participant"` guidance path whenever `KIRO_FABRIC_PARENT_RUN` is set, so the
   mocked `"main"`-targeted guidance was correctly filtered out. Fixed by
   explicitly establishing main-agent context in the test
   (`KIRO_FABRIC_PARENT_RUN=""` with save/restore).
2. `tests/worker-e2e.test.ts` — `AgentManager` reads inherited
   `KIRO_FABRIC_DEPTH`, so a depth-1 parent yields depth-2 children. Fixed by
   clearing/restoring `KIRO_FABRIC_DEPTH` and the budget variables around the
   suite (same isolation pattern as `tests/agent-manager.test.ts`).

3. `tests/fabric-settings.test.ts` — `KIRO_FABRIC_FULL_CODE_MODE` is a
   process-level config override (`src/config.ts`), so an outer session's
   inherited value defeated the settings-persistence assertion. Fixed by
   clearing/restoring it around the suite.

Verification: the full suite passes with `KIRO_FABRIC_PARENT_RUN=outer-run`,
`KIRO_FABRIC_DEPTH=1`, and `KIRO_FABRIC_FULL_CODE_MODE=false` all inherited,
proving the isolation works under the exact leaking conditions.

## Notes

- Harness hardening and all six billable probe state machines are
  regression-tested non-billably in `tests/kiro-spike.test.ts` against
  `tests/fixtures/kiro/fake-kiro.mjs` (scenario-driven fake) plus the shared
  MCP fixture `tests/fixtures/kiro/probe-mcp-server.mjs`: unknown probes,
  billing gates, version mismatch, malformed stdout, correct/ incorrect
  cancellation chains, hidden-tool leakage, denial bypass, and the elicitation
  preflight all covered. Real billable runs stay manual and explicit.

## PR 3 — host-neutral `fabric_exec` contract kernel

- New entry: `src/kernel/index.ts` → `src/kernel/fabric-exec-contract.ts`
  (package export `kiro-fabric/kernel`). Owns the model-facing input schema,
  `FABRIC_EXEC_RESULT_FORMATS`, and `prepareFabricExecArguments`.
- `src/fabric-exec-tool.ts` now assigns `parameters: fabricExecInputSchema`;
  the schema bytes are unchanged (golden-pinned in
  `tests/fabric-exec-schema.test.ts`, including descriptions, `anyOf`/`const`
  order, and the deliberate absence of `additionalProperties: false`).
- `src/fabric-exec-arguments.ts` shim deleted; the sole remaining caller
  (`tests/fabric-exec-arguments.test.ts`) imports the kernel directly.
- Built `dist/kernel/index.js` verified host-free: import succeeds with all
  `@earendil-works/*` and `@mariozechner/pi-*` resolution blocked.
- `pnpm check` — pass (typecheck, build, lazy-graph, 145 files / 1949 tests,
  knip clean).

Scope note: this PR extracted the **contract** only. `FabricExecutionService`
still takes Pi `ExtensionContext` (approval UI, model registry, handoffs);
full execution-engine extraction is a follow-up. The Kiro adapter design must
carry the two Phase 1 fail-closed constraints: no reliance on MCP
cancellation propagation (host-side process-group kill + late-frame discard),
and no elicitation — approval-requiring actions fail closed; never
`--trust-all-tools` on managed runs.

## PR 4 — Kiro MCP adapter

- `src/kiro/mcp-entry.ts` (bin `kiro-fabric-mcp`): stdio MCP server, one tool `fabric_exec` with the PR 3 kernel schema.
- `src/kiro/runtime.ts`: standalone `ActionRegistry` + `FabricExecutionService` against a fail-closed Kiro host (`src/kiro/host.ts`).
- `src/kiro/profile.ts`: deterministic Kiro v2 profile generator (`allowedTools` only with explicit `--allow-tools`, no `includePowers`, exactly `@fabric/fabric_exec`).
- `src/kiro/projection.ts`: host-neutral execution→text projection shared with the Pi adapter.
- Fail-closed constraints carried from Phase 1: no MCP-cancellation reliance; `ask`/`auto` approvals deny with a "no MCP elicitation" diagnostic; never `--trust-all-tools`.
- Verified: built `dist/kiro/mcp-entry.js` answers `initialize` and `tools/call` (`return 40+2;` → `42`) over stdio.

## PR 4 verification

- `pnpm check` — exit 0 (typecheck, build, lazy-graph, 147 test files / 1957 tests, knip clean).
- Built `dist/kiro/mcp-entry.js` answers `initialize`, `tools/list` (exactly `fabric_exec` with the kernel schema), and `tools/call` (`k.read` of package.json → `kiro-fabric@0.62.2`) over stdio.
- Static import graph of the built adapter contains zero `pi-tui`/`@mariozechner/pi-*` imports from adapter code (20 files scanned).
- Real non-billable Kiro startup: `kiro-cli acp --agent kiro-fabric --agent-engine v2` spawned the actual built Fabric MCP server and returned ACP session `8664644a-49ec-4101-afc2-69a522dfde78`. No `session/prompt` (no model turn) was sent.

## PR 5 — installer and doctor

- `src/kiro/install.ts` + `src/kiro/cli.ts` (bin `kiro-fabric`): project-scoped managed profile install. Canonical `realpath` roots, no Git ascent, atomic writes, content-addressed backups, fail-closed symlink/name-collision policy, `--dry-run` is zero-write on the project tree.
- `src/kiro/doctor.ts` + `src/kiro/supervisor.ts`: read-only non-billable doctor in an isolated temp workspace. Tuple pin, profile shape, `kiro-cli agent validate` plus negative control (exit 0 is not trusted), built MCP `initialize`/`tools/list`, ACP `initialize` + `session/new` only, process-group SIGTERM→SIGKILL.
- User docs: `docs/kiro/installer.md`.
- Fail-closed constraints carried forward: never `--trust-all-tools`; `ask`/`auto` deny; bounded adapter deadline (now 15 minutes for trusted-shell verification); doctor-owned children are reaped as a process group.

## PR 6 — uninstall and packed Release-A lifecycle

- `src/kiro/uninstall.ts`: hash-owned uninstall. No manifest → no-op. Matching managed profile without a user backup → remove. Verified displaced-user backup → restore exact bytes. Drifted content refuses; there is no uninstall `--force`.
- `src/kiro/managed.ts`: shared manifest authority, every managed symlink component, exclusive `operation.lock`, content-addressed backup helpers.
- Installer backup lineage: managed updates inherit the original displaced-user backup instead of replacing it with the previous Fabric profile.
- CLI: `kiro-fabric uninstall kiro [--project-root] [--dry-run] [--json]`.
- Packed gate: `pnpm certify:release-a`. Real opt-in: `KIRO_FABRIC_RELEASE_A_REAL=1 pnpm certify:release-a:real`.
- Docs: `docs/kiro/installer.md`, `docs/kiro/release-a.md`.

## PR 6 verification

- Targeted installer/uninstaller tests pass, including backup lineage, `.kiro-fabric` symlink refusal, lock collision, restore, drift refusal, and idempotent second uninstall.
- `pnpm certify:release-a` — packed tarball `kiro-fabric@0.62.2` (`sha512-iCwgNTS6IHDli[...]Fsto88A7J0ztA==`) install → doctor → MCP `fabric_exec` → uninstall → no-op.
- Real non-billable certification: `KIRO_FABRIC_RELEASE_A_REAL=1 pnpm certify:release-a:real` — doctor 11/11, ACP session `151d775c-ff4c-4523-b04f-82314ee9f272`, outbound methods `initialize, session/new`, `modelTurnsRequested: 0`, uninstall action `remove`.

## Release B — resident Kiro workers

- Kiro ACP workers retain one process/session across turns and consume `steer` / `follow_up` controls until bounded idle settlement.
- Durable Kiro actors persist `runnerSessionId` plus a per-actor isolated `KIRO_HOME` and resume through ACP `session/load`; Kiro worktrees bind isolated run profiles to a canonical generated worktree while retaining the original managed-profile authority.
- Real double-gated certification passed on authenticated `kiro-cli 2.19.1`: same-process second prompt, then process-restart `session/load` and another prompt using the retained Kiro home.

## Release C — durability and rollback rehearsal

- Resident state v2 supports in-memory v1 migration, future-version rejection without mutation, mesh-backed epoch fencing, stale-owner rejection, and persisted delivery cursor/deduplication state.
- Crash/restart tests use real filesystem-backed actor and mesh state with the fake Kiro ACP worker. They cover one surviving owner, no duplicate mailbox effects, durable `session/load` resume, and rollback/downgrade refusal.
- Aggregate non-billable gate: `REHEARSER_REAL=1 pnpm rehearse:release-c`.
- Verification: four reliability files / nine tests pass; `tests/actor-manager.test.ts` passes 62/62 after preserving Claude `runnerSessionId` propagation alongside the Kiro-specific resume gate.
