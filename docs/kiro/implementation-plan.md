# Kiro CLI Integration for Pi Fabric — Validated Implementation Plan

> This document converts `plan(20260824-075704).md` into an executable, evidence-based delivery plan for `monotykamary/pi-fabric` 0.62.2. The original remains the architecture/vision document; this file is the implementation control document.
>
> **Implemented namespace deviation (2026-08-25):** any older Kiro-path
> `pi.*` examples below are superseded by the managed profile's `k.*` API.
> Original Pi still uses `pi.*` unchanged.

## 1. Validated baseline

### Repository

- Working baseline: `/Users/adam2/projects/konstruct/pi-fabric`
- Upstream: `monotykamary/pi-fabric`
- Version: `0.62.2`
- Baseline commit from the architecture plan: `64b70fa7ebbbaabab447fcc4ecf2328e1284681c`
- Runtime: Node.js 24+, TypeScript, QuickJS
- Existing host: Pi; all existing Pi behavior remains supported
- Existing test inventory: 143 test files and approximately 1,928 tests

### Installed Kiro

- Binary: `/Users/adam2/.local/bin/kiro-cli`
- Version: `2.19.1`
- Publicly visible surfaces: custom agents, MCP, ACP, hooks in agent profiles, and skill resources
- ACP protocol advertised by the installed binary: version 1

### Baseline caveats

1. The architecture plan says Kiro CLI 3.x+, but the installed and probed release is 2.19.1. Support must be capability-based until a 3.x build is tested.
2. `pnpm check` is not currently a clean baseline under every local environment. Environment-sensitive tests and the npm 12 `npm pack --dry-run --json` shape must be fixed or explicitly waived before refactoring.
3. Current Fabric config is already version 3. Never add the plan's proposed `configVersion: 2`; use Fabric config v4 for shared changes or a separately named/versioned daemon schema.
4. `@earendil-works/pi-ai` is a direct dependency. Optional Pi peers alone do not prove a Pi-free Kiro installation.
5. The current resident host already owns durable agents/actors, locks, recovery, and queued delivery. A second daemon cannot be introduced safely without an ownership/migration ADR.

## 2. Delivery decisions

### Retained decisions

- Preserve the Pi extension and add Kiro as a separate host.
- Kiro Main calls one stdio MCP tool: `fabric_exec`.
- Kiro child agents use ACP, not nested MCP.
- Keep TypeScript and QuickJS.
- Preserve `pi.read`, `pi.grep`, `pi.find`, `pi.ls`, `pi.write`, `pi.edit`, and `pi.bash` as a compatibility namespace implemented by Fabric, without Pi imports.
- Fabric remains authoritative for nested approvals, audit, budgets, and cancellation.
- Do not use undocumented Kiro internals or private session storage.
- Kiro trajectory fidelity is `semantic`, never falsely reported as native.

### Required amendment to the original plan

The persistent global `fabricd` is **not an MVP prerequisite**. The first release uses an in-process runtime owned by `fabric-mcp`, one project and one Kiro session at a time. This creates the shortest end-to-end proof and avoids duplicating the current resident host before its ownership model is understood.

Before durability work, record an ADR choosing one of:

1. generalize the current per-project resident host into a host-neutral supervisor; or
2. replace it with `fabricd`, including migration, fencing, rollback, and upgrade compatibility.

If the global daemon remains a product requirement, implement it only after the foreground Kiro path and ACP worker path are proven. Prefer a per-project supervisor before a global multi-project daemon.

## 3. Release boundaries

### Release A — Experimental Kiro Main MVP

Included:

- one `fabric_exec` MCP tool
- checked TypeScript and QuickJS
- local `pi.*` compatibility tools
- read/write/execute approval mediation
- progress, bounded results, errors, media, and cancellation
- static nested MCP only where already host-neutral
- minimal install, doctor, and uninstall commands
- packaged execution without Pi runtime packages/imports

Deferred:

- Kiro child agents
- durable/background agents and actors
- global daemon and CLI approval broker
- hooks-based queued delivery
- trajectory handoff/prewalk
- Kiro memory/topology/councils/swarm parity

### Release B — Kiro ACP workers

Included:

- `runner: "kiro"`
- one-shot and session-resident child runs
- strict technical child-tool restrictions
- fake ACP CI and opt-in real Kiro tests
- cancellation, logs, worktrees, schema validation, and unavailable usage state

### Release C — Durability

Included only after the supervisor ADR:

- durable Kiro agents and actors
- ownership fencing, state migration, recovery, and rollback
- queued Main delivery and leases
- operator status/log/approval interfaces

### Release D — Advanced parity

- semantic trajectory/handoff/prewalk
- memory and topology
- workflows, councils, recursion, and swarm qualification
- broader cross-platform and long-running hardening

## 4. Acceptance ledger

Every PR must map to one or more checks below.

| ID | Requirement | Proof |
|---|---|---|
| K1 | Kiro sees exactly one Fabric tool | Real Kiro profile probe and MCP `tools/list` fixture |
| K2 | Kiro path has no Pi runtime dependency | import-graph assertion plus clean packed install |
| K3 | Existing `fabric_exec` schema remains flat and shared | schema snapshot used by Pi and MCP adapters |
| K4 | TypeScript checking and QuickJS behavior are preserved | host-neutral execution integration tests |
| K5 | Seven `pi.*` tools preserve documented result semantics | compatibility fixtures and golden tests |
| K6 | Denied mutation causes no effect | file hash/sentinel tests |
| K7 | Cancellation reaches QuickJS, shell descendants, MCP, and ACP | process-tree and protocol cancellation tests |
| K8 | Nested approvals are Fabric-owned | allow/deny/session isolation tests |
| K9 | Kiro child permissions are technical, not prompt-only | forbidden tool sentinel test |
| K10 | Pi behavior does not regress | sanitized `pnpm check` and existing suite |
| K11 | Persisted formats and config changes are versioned | migration/downgrade tests |
| K12 | Installer is reversible | managed manifest, backup, upgrade, uninstall tests |
| K13 | Unsupported Kiro capabilities fail explicitly | capability matrix and diagnostic tests |
| K14 | Usage is never fabricated | explicit `unavailable` state when ACP omits usage |

## 5. Phase 0 — Establish a trustworthy baseline

**Goal:** make later failures attributable to the integration, not the baseline.

### Work

- Rebase the selected repository on current `main` and record commit/version.
- Run tests with inherited `PI_FABRIC_*` and related Fabric variables removed.
- Make the npm pack test compatible with the supported npm versions, or pin/document the supported npm version.
- Capture `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm lint:dead`, and `pnpm check` results.
- Add a small environment-sanitizing test helper if required; do not hide genuine configuration tests.
- Write `docs/kiro/baseline.md` with exact Node, pnpm, npm, OS, Kiro, and repository versions.

### Exit gate

- Clean baseline passes `pnpm check`, or every pre-existing failure has a written, approved waiver.
- The selected working tree is clean.
- No Kiro implementation code has landed yet.

## 6. Phase 1 — Complete the Kiro capability spike

**Goal:** prove every public Kiro behavior required by Release A and B before depending on it.

### Add

- `scripts/spike-kiro.mjs`
- `tests/fixtures/fake-fabric-mcp.mjs`
- `tests/fixtures/fake-kiro-acp.mjs`
- `docs/kiro/capabilities-2.19.1.md`

### Non-billable checks

- version/help capability snapshot
- custom-agent discovery from `.kiro/agents`
- strict local validation wrapper; do not trust `kiro-cli agent validate` exit code alone
- MCP initialize/initialized/tools-list startup
- ACP initialize, `session/new`, `session/load`, mode selection, stdin close, and SIGTERM
- `agentSpawn` hook payload
- skill URI parsing

### Opt-in model checks

Guard all billable checks with `KIRO_PHASE0_BILLABLE=1`:

- complete ACP prompt stream and terminal turn event
- active ACP cancellation
- MCP cancellation propagation
- MCP progress, image, structured content, and error rendering
- MCP elicitation allow/deny behavior
- long-running MCP request limit
- exact child tool visibility and forbidden-tool enforcement
- concurrent ACP sessions
- hook lifecycle/stdout injection behavior
- actual skill body/reference loading

### Known expected behavior for 2.19.1

- Use `kiro-cli acp --model ...` for initial model selection.
- Do not call `session/set_model` unless advertised; it was not advertised and did not return a response in the probe.
- Use leases/heartbeat for session departure; no reliable shutdown hook was found.
- Treat profile `allowedTools` as a candidate mechanism only until the forbidden-tool test proves enforcement.
- Kiro's profile validator may print errors and still exit 0; parse diagnostics and run a startup probe.

### Release-A blockers

Do not proceed if any of these lacks either proof or an implemented fallback:

- MCP cancellation
- nested interactive approval/elicitation
- request lifetime sufficient for supported executions
- one-tool model visibility

### Release-B blockers

- active ACP cancellation
- technical child-tool enforcement
- complete prompt/event normalization

### Exit gate

- Versioned capability matrix is committed.
- Production code gates optional behavior by advertised capability/version.
- No architecture claim depends on unverified Kiro behavior.

## 7. Phase 2 — Extract the minimum host-neutral execution seam

**Goal:** execute Fabric under a test host without importing Pi, while preserving Pi behavior.

### First extract shared model-facing contracts

Add pure modules such as:

- `src/fabric-exec-schema.ts`
- `src/fabric-exec-result.ts`
- `src/host/types.ts`
- `src/host/model-catalog.ts`
- `src/host/approval-channel.ts`

Move the canonical flat schema and pure result formatting out of `src/fabric-exec-tool.ts`. Pi and MCP must import the same definitions.

### Refactor exact hotspots

- `src/protocol.ts`: remove `ExtensionContext` from public invocation types.
- `src/execution-service.ts`: inject model catalog, approval channel, Fabric-owned usage/media types, and host-neutral context.
- `src/core/approval-controller.ts`: separate policy/state from Pi TUI interaction.
- `src/core/auto-approval-classifier.ts`: keep Pi/model inference behind an adapter.
- `src/providers/pi-tools-provider.ts`: inject native Pi executor only in the Pi adapter.
- `src/providers/agents-provider.ts`: isolate Pi model inheritance/thinking/trajectory services.
- `src/main-agent.ts`: remove the hard-coded Pi identity from host-neutral information.
- `src/components/supervisor.ts`: stop fabricating Pi `ExtensionContext`.
- `src/execution-service.ts`: move UI title-generation dependency out of the core path.

Do not re-extract already available seams: progress/activity/media callbacks are optional, and `ActionRegistry` already accepts an optional nested result proxy.

### Minimal kernel

Create a small host-neutral assembly owning only:

- `ActionRegistry`
- `FabricComponentCatalog`
- `FabricComponentSupervisor`
- `FabricComponentLoader`
- `FabricExecutionService`
- supplied `FabricProviderComponent[]`

Keep Pi Main delivery, native compaction, native trajectory, memory sources, agents, actors, residency, extension capture, and TUI in the Pi runtime until separately extracted.

### Build and tests

- Add a host-free test entry and import-graph assertion immediately.
- Ensure emitted declarations do not import Pi types.
- Add repeated create/execute/close leak tests.
- Keep `src/index.ts` behavior unchanged.

### Exit gate

- A test host type-checks and executes a trivial QuickJS program.
- Core build/declarations contain no Pi imports.
- Existing Pi tests pass.
- Runtime close leaves no timers, processes, sockets, or locks.

## 8. Phase 3 — Implement Fabric-owned `pi.*` compatibility tools

**Goal:** run representative existing Fabric programs with no Pi code loaded.

### Contract first

Create a versioned `piCompatVersion: 1` fixture from current behavior:

- read/grep/find/ls return strings
- write/edit/bash return `{ ok, output, details }`
- `edit({all:true})` and exact-anchor atomic failure behavior
- shell nonzero behavior and `settle: true`
- argument normalization before registry validation
- bounded output and media behavior

Implement a separate local provider; do not wrap Pi's tool constructors.

### Provider work

Suggested modules:

- `src/providers/local-core-tools-provider.ts`
- `src/providers/local-read.ts`
- `src/providers/local-search.ts`
- `src/providers/local-write.ts`
- `src/providers/local-edit.ts`
- `src/providers/local-shell.ts`

### Security contract

- File providers are confined to the canonical project root by default.
- Validate canonical parent and target paths; cover symlink/junction replacement races.
- Writes are atomic and preserve intended permissions.
- Shell executes only after approval and cancellation kills the process tree.
- Be explicit: approved shell commands run with the host user's ambient OS filesystem privileges unless a real OS sandbox is added. File-provider confinement does not sandbox shell.
- Pass child processes an allowlisted environment. Never expose Fabric auth/session tokens.

### Exit gate

- Read/list/search and write/edit/bash behavioral suites pass.
- Denial leaves sentinel hashes unchanged.
- Cancellation leaves no descendants.
- Representative checked TypeScript runs without Pi installed or imported.

## 9. Phase 4 — Ship the in-process `fabric-mcp` vertical slice

**Goal:** deliver Release A before introducing durability infrastructure.

### Runtime and adapter

Add:

- `src/kiro/mcp-server.ts`
- `src/kiro/runtime.ts`
- `src/kiro/approval-adapter.ts`
- `src/kiro/profile.ts`
- `src/kiro/installer.ts`
- `src/kiro/doctor.ts`
- `src/bin/fabric-mcp.ts`
- `src/bin/fabric.ts` with only `install kiro`, `doctor kiro`, and `uninstall kiro` initially

`fabric-mcp` owns one in-process project runtime. It must:

- write protocol frames only to stdout
- expose only the shared `fabric_exec` schema
- derive project/cwd/session context outside model-visible arguments
- bridge Kiro cancellation into one `AbortSignal`
- bridge Fabric progress/media/errors according to proven Kiro capabilities
- mediate nested approval through proven elicitation or fail closed with a clear diagnostic
- bound output exactly once using shared formatting
- close all providers/processes on stdio disconnect

### Kiro profile and installer

- Generate a custom agent using `includeMcpJson: false`, embedded `mcpServers`, and `tools: ["@fabric/fabric_exec"]`. Emit `includePowers: false` only for profile engines where Phase 1 proves the field is recognized and effective.
- Use only fields proven by Phase 1. Do not rely on the unproven `permissions.rules` shape or on validators accepting a field.
- Validate with Fabric's strict versioned schema, inspect Kiro validator output, then run a startup probe.
- Write managed files atomically.
- Record hashes and backups in a managed manifest.
- Never alter Kiro configuration during npm install.
- Uninstall only exact managed hashes; preserve user-modified files and report them.

### Packaging now, not later

- Add build entry, package bin, artifact assertion, shebang/mode checks, and host-free graph assertion in this phase.
- Decide packaging by proof. Either split a Kiro/core package or make all Pi dependencies optional/lazy so a clean Kiro installation resolves no Pi runtime packages.
- Test `npm pack`, clean install, launch from packed artifact, upgrade, downgrade, and uninstall.

### Exit gate — Release A

From a real Kiro custom agent:

- exactly one Fabric tool is visible
- a read-only program succeeds
- a denied write has no effect
- an approved write succeeds
- cancellation stops a long shell and descendants
- progress/errors are bounded and correctly rendered
- nested MCP works if enabled
- packed Kiro path has no Pi import/runtime dependency
- Pi's complete release checks remain green

Release only under an experimental npm dist-tag.

## 10. Phase 5 — Add Kiro ACP workers inside the existing worker boundary

**Goal:** deliver Release B without rewriting Pi/Claude/Veda runners simultaneously.

### Data and migration first

- Add `"kiro"` through Fabric config migration `3 -> 4`.
- Version agent run records.
- Preserve unknown runner values as unsupported; never coerce them to `"pi"`.
- Add an explicit `usage: available | unavailable` representation.
- Version residency/worker messages that carry runner-specific fields.
- Ensure downgrade rejects newer state without mutating it.

### Implementation seam

Implement ACP within the current manager/worker/status-file/transport architecture:

- `src/agents/kiro-acp.ts`
- targeted branches in `src/worker.ts` and `src/worker/options.ts`
- config/parser/guest type/provider updates
- actor restore must not map non-Claude runners to Pi

Preserve current manager, transport, status, steering, follow-up, log, and stop contracts. Do not first refactor all existing runners behind a speculative driver interface. Extract a general interface only after Kiro and an existing implementation demonstrate a stable common shape.

### ACP behavior

- capability-negotiate every optional method
- initial model via ACP process argument when required
- normalize session/message/tool/turn/error events
- enforce child tools using the mechanism proven in Phase 1
- use a generated exact child profile if needed
- redact logs by default; raw wire logs are opt-in and permission-restricted
- allowlist child environment while retaining only required Kiro authentication context
- process-group cancellation with grace then force kill
- fake ACP fixture for CI; real Kiro tests remain opt-in

### Exit gate — Release B

- `agents.run`, `spawn`, `wait`, `status`, `log`, `steer`, `followUp`, and `stop` work for Kiro where semantics are supported.
- Unsupported operations return capability diagnostics.
- Forbidden child tool attempt leaves sentinel unchanged.
- Active cancellation terminates the turn and process tree.
- Unknown usage is reported as unavailable, not zero.
- Pi, Claude, and Veda regression tests pass.

## 11. Phase 6 — Decide and implement durability architecture

**Goal:** avoid two competing durable owners.

### ADR required before code

Compare the existing `src/residency/*` host with the proposed daemon. Decide:

- generalize/rename existing per-project resident host, or replace it
- one project per supervisor versus global multi-project daemon
- ownership fencing and duplicate-owner prevention
- state/config/protocol versioning
- Pi migration and coexistence
- upgrade, drain, rollback, and downgrade
- Unix sockets and Windows named pipes
- trust source and project canonicalization

### Minimum protocol if a daemon is chosen

- bounded, explicitly framed messages
- hello with major/minor ranges and feature negotiation
- server-issued client/session identity
- stable error codes and strict schemas
- `execution.start` plus sequenced subscription/reconnect cursor
- idempotency scoped to client instance and payload hash
- durable states including `accepted`, `running`, `completed`, and `indeterminate`
- crash injection before/after claim and before/after effects
- server-derived trust; never accept client `trusted: true`
- per-session approval isolation, expiry, cancellation, and decision-race handling

### Exit gate — Release C

- one durable owner after crashes/restarts
- no duplicate mailbox delivery
- Kiro actor resumes through supported ACP session loading
- Pi residency migration/compatibility tests pass
- incompatible old/new client, daemon, and state combinations fail without mutation
- rollback rehearsal succeeds

## 12. Phase 7 — Hooks, semantic trajectory, and advanced parity

Implement independently releasable increments:

1. lease-based Kiro Main registration and queued delivery
2. command hooks only where payload/output behavior is proven
3. semantic trajectory envelope with explicit `handoffFidelity: "semantic"`
4. prewalk using Fabric-owned mutation/shell-drift evidence
5. host-neutral transcript store and Kiro memory
6. topology records
7. workflow/council/recursion/swarm qualification

Each increment needs fake-protocol CI, opt-in real Kiro E2E, documented limitations, and a rollback path. Never parse private Kiro session databases.

## 13. PR sequence

| PR | Deliverable | Must pass before merge |
|---|---|---|
| 1 | baseline hermeticity and version record | clean/waived `pnpm check` |
| 2 | Kiro capability harness and matrix | Release-A blockers resolved or fail-closed fallback |
| 3 | shared `fabric_exec` schema/result modules | Pi schema snapshots |
| 4 | host-neutral invocation/model/approval/media/usage contracts | host-free declaration/import check |
| 5 | minimal execution kernel and test host | QuickJS execution without Pi |
| 6 | local read/search/list compatibility tools | golden read-only suite |
| 7 | local write/edit/shell compatibility tools | approval, atomicity, cancellation, security suite |
| 8 | in-process `fabric-mcp` adapter | fake MCP integration suite |
| 9 | Kiro installer/doctor/uninstaller and packed artifact | real Kiro Release-A gate |
| 10 | config/run-record migrations for `kiro` | upgrade/downgrade suite |
| 11 | ACP implementation in worker boundary | fake ACP suite |
| 12 | strict child profile, logs, worktrees, real Kiro tests | Release-B gate |
| 13 | durability ADR only | approved ownership/migration design |
| 14+ | supervisor/daemon, actors, hooks, trajectory, memory, parity | feature-specific Release-C/D gates |

Keep each PR behaviorally complete, reviewable, and revertible. Build entries and graph assertions land in the same PR as each executable.

## 14. Parallel work lanes

Safe parallelization after Phase 1:

- **Lane A — host-neutral contracts:** schema/result/context/approval/model/usage extraction
- **Lane B — Kiro fixtures:** fake MCP/ACP, custom-agent fixtures, opt-in harness
- **Lane C — local tools:** read/search/list first; write/edit/shell after shared contract
- **Lane D — packaging/installer:** manifest, backup, validator wrapper, packed-install fixture
- **Lane E — security:** threat model, path race fixtures, process-tree cancellation, environment allowlist

Merge order remains contracts -> kernel -> local providers -> MCP adapter -> installer -> ACP worker. Agents working in parallel must not edit shared contract files without coordination.

## 15. Required test matrix

### Every PR

```bash
pnpm typecheck
pnpm exec vitest run <targeted tests>
pnpm build
pnpm run assert:lazy-graph
```

### Phase/release gates

```bash
pnpm check
npm pack --dry-run --json
```

Also run:

- Linux, macOS, and Windows CI where affected
- clean packed installation with no Pi packages for Kiro artifacts
- fake MCP/ACP tests in standard CI
- real Kiro tests only when explicitly enabled and authenticated
- malformed/oversized protocol fuzzing for every new IPC surface
- process leak checks after cancellation and runtime close
- installer upgrade/downgrade/uninstall tests through symlinked paths

## 16. Security and operational requirements

- Default deny on unavailable approval channels.
- No self-reported trust from MCP/CLI clients.
- No Fabric auth/session secrets in shell, MCP server, ACP, or hook environments.
- File paths canonicalized and checked at effect time, not only validation time.
- Atomic writes and restrictive permissions for state, logs, profiles, and tokens.
- Raw ACP logs off by default; all normal logs redacted and bounded.
- Per-execution output, process, artifact, and retention quotas.
- Cancellation and approval decisions are race-tested.
- Client disconnect behavior is explicit: cancel immediately for MVP unless a later durable protocol supports safe reattachment.
- Project MCP configuration is loaded only under explicit trust.
- Installer never overwrites unknown/user-modified content silently.

## 17. Rollback policy

- Release A is opt-in and experimental.
- Existing `.pi/fabric` state is untouched by the Kiro MVP.
- New state roots and records carry format versions.
- Disable/uninstalling Kiro leaves Pi behavior unchanged.
- Config v4 migration has a tested reverse/read-only downgrade strategy.
- Newer persisted state is rejected, not guessed or coerced.
- Installer restores backups only when managed hashes prove ownership.
- A future supervisor/daemon supports drain-and-stop before upgrade.

## 18. Definition of done by release

### Release A

- Acceptance K1-K8 and K10-K13 pass where applicable.
- Real Kiro Main can safely use one `fabric_exec` tool.
- Packed Kiro path runs without Pi runtime dependencies.

### Release B

- K7, K9, K11, and K14 pass for ACP workers.
- Kiro child agents support the documented lifecycle without weakening existing runners.

### Release C

- Durability survives restart without duplicate ownership/effects.
- Migration, protocol compatibility, and rollback gates pass.

### Release D

- Advanced features are either qualified on Kiro or explicitly unavailable with accurate diagnostics.
- No claim of native Kiro transcript fidelity is made.

## 19. Pre-implementation compatibility addendum

The live documentation review identified the following requirements that must be incorporated into PR 1–2. These refine the existing phases; they do not change the release architecture.

### Kiro version and agent-engine matrix

Kiro CLI semantic version alone is not enough. The installed 2.19.1 exposes `--agent-engine v1|v2|v3`, while Kiro's current v3 documentation changes agent configuration semantics.

- Declare the first supported tuple as **Kiro CLI 2.19.1, agent engine v2** unless Phase 1 proves more. Every managed chat/ACP launch must explicitly pass `--agent-engine v2`; do not rely on Kiro's mutable default. Record the selected engine in Fabric diagnostics and run metadata.
- Test and record `(cliVersion, agentEngine, agentFormat)` as separate capability dimensions.
- Implement versioned profile renderers rather than one permissive JSON template:
  - v2 JSON renderer using only fields proven on v2;
  - v3 JSON/Markdown renderer only after v3 tests.
- Do not emit v2 `toolsSettings` into v3; v3 moves per-tool rules into `permissions`.
- Do not assume v3 `permissions` secures v2. Use `tools` for visibility and `allowedTools` only for permission-prompt behavior where proven.
- Include `kiro-cli diagnostic --format json` and a startup run using `--require-mcp-startup` in `fabric doctor kiro` where supported.
- Detect Kiro binary/version/engine drift and tell the user to rerun doctor after Kiro updates.

Primary references:

- <https://kiro.dev/docs/custom-agents/configuration-reference/>
- <https://kiro.dev/docs/cli/v3/agent-config/>
- <https://kiro.dev/docs/cli/v3/migration-guide>
- <https://kiro.dev/docs/cli/reference/cli-commands/>

### MCP protocol and SDK contract

- Pin one stable MCP specification revision and official TypeScript SDK version after the Phase 1 handshake; never code against `draft` or an uncited latest branch.
- Record negotiated MCP protocol version in test snapshots and diagnostics.
- Advertise only implemented capabilities. A static one-tool server should not advertise list-change, roots, completion, prompts, resources, logging, or subscriptions unless implemented and tested.
- Preserve the current flat `inputSchema`; record the JSON Schema dialect accepted by Kiro and test unsupported keywords.
- If `outputSchema` is advertised, validate `structuredContent` against it and return equivalent text content for older clients. Otherwise omit `outputSchema` and treat structured output as optional enhancement.
- Emit progress only when the request supplied a progress token, correlate cancellation to the exact request, make cancellation idempotent, and discard late completion after cancellation.
- Treat stdin EOF as graceful shutdown, stop accepting work, abort active executions, close resources within a bounded grace period, then exit.
- Keep stdout protocol-only for the entire process lifetime, including startup failures and uncaught exceptions; stderr logs must be bounded/redacted.
- Define the supported elicitation mode from the negotiated client capabilities. Approval elicitation must be session-bound, reject sensitive credential collection, fail closed when unsupported, and cover cancel/timeout/disconnect races.
- Add protocol conformance fixtures for wrong versions, unknown capabilities, duplicate IDs, malformed frames, oversized frames, out-of-order cancellation, and client disconnect.

Primary references:

- <https://modelcontextprotocol.io/specification/>
- <https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle>
- <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- <https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/cancellation>
- <https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress>
- <https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation>
- <https://modelcontextprotocol.io/specification/2025-06-18/server/tools>

### Project-root and execution-mode contract

- Define project root deterministically: managed interactive sessions use the canonical MCP process cwd (where `kiro-cli chat` launched), while isolated internal children use their explicit validated cwd; do not silently walk into an unrelated parent repository.
- Include canonical root in the runtime identity and reject root changes during an execution.
- Test spaces, Unicode, symlinked cwd, deleted cwd, nested repositories, bare directories, and simultaneous projects.
- Explicitly enable Fabric full-code mode for the Kiro compatibility runtime so `pi.*` is available; add a direct test for this path.
- Disable the unsafe Node-process executor for the experimental Kiro MVP. Re-enable only through separately trusted configuration with prominent diagnostics and tests; Node `vm` is not a hostile-code sandbox.

### MCP startup, auth, and nested-server policy

- Require the managed `fabric-mcp` server to start successfully; a dangling `@fabric/fabric_exec` selector must be a doctor/startup failure, not a session with no tool.
- Use embedded agent-level `mcpServers` for the managed server and `includeMcpJson: false` to avoid accidental workspace/global MCP exposure.
- Specify that Release A does not broker OAuth for nested MCP unless implemented. Kiro-specific `_kiro.dev/mcp/oauth_request` is an ACP extension and must not be assumed for the northbound standard MCP path.
- Never place credentials directly in generated profiles or command arguments. Preserve environment placeholders only when supported and avoid logging expanded values.

Primary references:

- <https://kiro.dev/docs/cli/mcp/>
- <https://kiro.dev/docs/mcp/security/>
- <https://kiro.dev/docs/cli/acp/>

### Portability, supply chain, and operational budgets

- Add Windows Job Object or equivalent descendant-process termination tests; POSIX process groups are not sufficient on Windows.
- Test path/argument quoting in generated stdio commands on macOS, Linux, and Windows.
- Pin new MCP/ACP SDK dependencies and record licenses in `THIRD_PARTY_NOTICES.md`.
- Add dependency audit, lockfile review, packed-file allowlist, secret scan, and SBOM/provenance generation to the release checklist.
- Define experimental budgets before Release A: MCP startup timeout, runtime-close grace period, maximum frame/result/log/artifact sizes, maximum concurrent executions, and idle memory/process limits.
- Add trace IDs and local structured diagnostics, but no new telemetry by default. Document every persisted/logged field and retention rule.
- Check `fabric`, `fabric-mcp`, and future `fabricd` binary-name collisions during installation and never replace an unrelated executable silently.

### Addendum exit gate

PR 2 is complete only when:

- the supported Kiro CLI/engine/profile tuple is explicit;
- the MCP spec and SDK revisions are pinned;
- root resolution and execution mode are specified;
- profile renderer behavior is versioned;
- unsupported auth/OAuth and elicitation behavior fails closed;
- operational limits and supply-chain checks are recorded.

## 20. First implementation action

Start with **PR 1 and PR 2 only**:

1. make the baseline reproducibly green;
2. commit the Kiro capability harness and matrix;
3. resolve MCP cancellation, elicitation, request lifetime, and one-tool visibility;
4. resolve ACP active cancellation and technical tool enforcement before beginning Release B work.

Do not start the kernel extraction, daemon, or runner refactor until these gates are recorded.
