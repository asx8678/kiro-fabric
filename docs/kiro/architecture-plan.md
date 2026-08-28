# Pi Fabric for Kiro CLI — Architecture and Implementation Plan

> **Execution directive for the implementation agent**
>
> Implement this plan incrementally in the existing `monotykamary/pi-fabric` repository. Treat the architectural decisions marked **Binding** as approved. Preserve all existing Pi behavior and tests. Do not modify or fork Kiro CLI. Do not introduce a runtime dependency on Pi for the Kiro path. Complete one phase and its exit criteria before moving to the next phase. Keep this file updated by checking completed tasks and recording any deliberate deviations in the decision log.
>
> **Implemented namespace deviation (2026-08-25):** references below to exposing
> `pi.*` inside Kiro are superseded by ADR-006: managed Kiro exposes `k.*`.
> The original Pi extension remains `pi.*` without aliases or behavior changes.

## Document status

- **Status:** implementation-ready proposal
- **Baseline repository:** `monotykamary/pi-fabric`
- **Baseline release:** `0.62.2`
- **Baseline commit:** `64b70fa7ebbbaabab447fcc4ecf2328e1284681c`
- **Baseline date:** 2026-08-24
- **Target host:** Kiro CLI 3.x and newer capability-compatible releases
- **Existing host that must remain supported:** Pi
- **Primary language/runtime:** TypeScript, Node.js 24+, QuickJS for guest execution
- **License constraint:** retain the existing MIT license and update third-party notices for new SDKs

Before implementation begins, rebase this plan against the then-current `main` branch and run:

```bash
pnpm install
pnpm check
```

All paths in this plan refer to the baseline above and may move as the repository evolves.

---

## 1. Objective

Add first-class Kiro CLI support to Pi Fabric without embedding Fabric into Kiro internals and without requiring a Pi process or Pi packages at runtime.

The Kiro experience must preserve Fabric’s main value proposition:

1. The main model sees one programmable tool: `fabric_exec`.
2. The model writes checked TypeScript with branching, loops, fan-out, and data flow.
3. QuickJS remains the default isolation boundary.
4. All effects pass through Fabric providers, approvals, audits, cancellation, and budgets.
5. Kiro can be used as a Fabric child-agent runner through ACP.
6. Long-lived agents, actors, mesh state, and MCP connections can outlive one Kiro TUI process.
7. The existing Pi extension remains functional and behaviorally compatible.

The target is a **multi-host Fabric runtime**, not a Kiro-specific rewrite and not a fork of Kiro CLI.

---

## 2. Binding architectural decisions

### ADR-001 — Preserve Pi and add Kiro as another host

**Binding:** Do not replace `src/index.ts` or remove the Pi extension. Extract host-neutral boundaries, then add separate Pi and Kiro adapters.

### ADR-002 — Use MCP northbound and ACP southbound

**Binding:**

- Kiro Main calls Fabric through a thin stdio MCP adapter exposing `fabric_exec`.
- Fabric launches Kiro workers through `kiro-cli acp`.
- MCP is only the Kiro-facing transport. It is not the Fabric orchestration runtime.
- ACP is the agent-runner transport. Do not implement child Kiro agents as nested MCP calls.

### ADR-003 — Run orchestration in a persistent local daemon

**Binding:** A persistent `fabricd` owns project runtimes, QuickJS execution, MCP client pools, agent/actor state, approvals, audit data, and durable coordination.

The Kiro MCP process is a lightweight session adapter that connects to `fabricd`. It must not duplicate the full runtime in every Kiro session.

### ADR-004 — Do not depend on undocumented Kiro internals

**Binding:** Use only documented Kiro surfaces:

- custom agents
- MCP
- MCP elicitation
- hooks
- ACP
- supported Kiro CLI commands and configuration

Do not patch Kiro binaries, read private in-memory state, inject code into the TUI, or depend on undocumented session database formats.

### ADR-005 — Keep TypeScript and QuickJS

**Binding:** Do not combine this port with a Rust, Go, or other language rewrite. Retain the existing checked-TypeScript guest language and execution kernel.

A language rewrite may be evaluated only after the host-neutral contract and Kiro implementation are stable.

### ADR-006 — Use a Kiro-only `k.*` guest namespace

**Binding for managed Kiro:** Expose `k.read`, `k.grep`, `k.find`, `k.ls`, `k.write`, `k.edit`, and `k.bash` in Kiro-backed `fabric_exec` programs. Do not declare `pi.*` in that guest.

The shared engine and provider are namespace-parameterized, defaulting to `pi` for the original Pi extension. Only `src/kiro/runtime.ts` selects `k`, so Pi behavior and existing Pi skills remain unchanged. Kiro profiles and examples must use `k.*`.

### ADR-007 — Approvals remain inside Fabric

**Binding:** Kiro approves the outer `fabric_exec` tool. Fabric remains authoritative for nested read, write, execute, network, and agent approvals.

Interactive Kiro sessions use MCP elicitation. CLI and headless clients use the same daemon approval broker through `fabric approve`.

### ADR-008 — Exact Pi trajectory handoff is not required for Kiro v1

**Binding:** Kiro handoff and prewalk initially use a semantic trajectory envelope, not a byte-identical fork of Kiro Main’s private transcript.

Expose fidelity explicitly:

- `native` for existing Pi trajectory forks
- `semantic` for Kiro envelopes

Do not claim exact transcript identity where Kiro’s public APIs do not provide it.

---

## 3. Scope

### 3.1 In scope

- Host-neutral execution and provider contracts
- Persistent `fabricd`
- Operator CLI named `fabric`
- Stdio Kiro MCP adapter named `fabric-mcp`
- One model-facing MCP tool named `fabric_exec`
- Kiro custom-agent installer and profile
- Fabric skills packaged for Kiro
- Fabric-owned filesystem, search, edit, write, and shell providers
- Existing MCP, schema, state, components, mesh, audit, and QuickJS functionality where host-independent
- `KiroAcpRunner`
- Foreground, background, and durable Kiro agents
- Actor integration through the daemon
- Interactive nested approvals through MCP elicitation
- CLI approval fallback
- Cancellation and timeout propagation
- Kiro-compatible progress and image results
- Standalone status/log interfaces
- Compatibility and security tests
- Documentation and migration tooling

### 3.2 Out of scope for the first Kiro release

- Forking or modifying Kiro CLI
- Capturing arbitrary Kiro built-in tools from inside Kiro
- A custom in-process Kiro TUI dashboard
- Exact Kiro transcript branch materialization
- In-place Kiro Main model switching during a running `fabric_exec`
- Importing private Kiro session files as a supported contract
- Prompt-only enforcement of child-agent permissions
- Automatic modification of Kiro configuration during npm install
- A language rewrite of Fabric
- Removing or degrading Pi support
- Interactive OAuth forwarding for every nested MCP server in the first milestone

---

## 4. Current-state constraints in Pi Fabric

The implementation must account for these current couplings:

1. `package.json` declares Pi peer dependencies and exposes a Pi extension entry.
2. `src/index.ts` is a Pi extension using `ExtensionAPI`, events, tool registration, session APIs, commands, and Pi TUI rendering.
3. `src/protocol.ts` currently imports Pi’s `ExtensionContext`, and `FabricInvocationContext` exposes it as `extensionContext`.
4. `FabricExecutionService` currently accepts `ExtensionContext`.
5. `FabricRuntimeState` constructs Pi-specific providers, Main delivery, memory, prewalk, compaction, actor delivery, and residency.
6. `FabricAgentRunner` is currently `"pi" | "claude" | "veda"`.
7. `src/worker.ts` selects runners with hard-coded branches.
8. `AgentSessionSeed` contains Pi session-entry and native tool-result types.
9. Pi-specific UI and tool lifecycle behavior is mixed with otherwise reusable execution logic.
10. Existing skills use `pi.*` and assume Pi’s tool semantics.

The port must separate these dependencies without a flag day rewrite.

---

## 5. Target architecture

```text
┌───────────────────────────────────────────────────────────────────────┐
│                              Kiro CLI                                 │
│                                                                       │
│  Custom agent: fabric                                                 │
│  - tools: @fabric/fabric_exec only                                    │
│  - includeMcpJson: false                                              │
│  - Fabric skills                                                      │
│  - optional lifecycle hooks                                           │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ MCP over stdio
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                         fabric-mcp adapter                            │
│                                                                       │
│  - exposes the flat fabric_exec schema                               │
│  - maps Kiro cancellation to daemon cancellation                      │
│  - maps daemon approvals to MCP elicitation                           │
│  - maps daemon progress to MCP progress notifications                 │
│  - maps images and structured results to MCP tool results             │
│  - contains no QuickJS runtime and no Pi imports                      │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ authenticated local JSON-RPC
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                              fabricd                                  │
│                                                                       │
│  Project runtime registry                                             │
│  ├─ Fabric kernel                                                     │
│  │  ├─ TypeScript checker                                             │
│  │  ├─ QuickJS / node-process executor                                │
│  │  ├─ ActionRegistry                                                 │
│  │  ├─ approvals, audit, budgets, cancellation                        │
│  │  ├─ components and capability views                                │
│  │  └─ activity                                                       │
│  ├─ Providers                                                         │
│  │  ├─ pi.* compatibility core tools implemented locally             │
│  │  ├─ mcp.*                                                          │
│  │  ├─ schema.*, state.*, mesh.*, components.*, compact.*             │
│  │  └─ agents.*                                                       │
│  ├─ Agent and actor managers                                          │
│  ├─ Session registry and delivery queues                              │
│  └─ Persistent project state                                          │
└──────────────┬──────────────────────────────┬─────────────────────────┘
               │                              │
               │ provider effects             │ ACP over stdio
               ▼                              ▼
┌───────────────────────────┐     ┌─────────────────────────────────────┐
│ Filesystem / shell / MCP  │     │          KiroAcpRunner              │
│                           │     │                                     │
│ - confined paths          │     │ spawn: kiro-cli acp --agent ...     │
│ - process-group cancel    │     │ initialize / session/new            │
│ - atomic writes           │     │ session/prompt / session/cancel     │
│ - nested MCP pools        │     │ session/load / session/set_model    │
└───────────────────────────┘     │ stream messages and tool activity   │
                                  └─────────────────────────────────────┘

                   ┌────────────────────────────────┐
                   │          fabric CLI            │
                   │ exec/check/status/approve/...  │
                   └───────────────┬────────────────┘
                                   └── same daemon protocol
```

---

## 6. Component responsibilities

### 6.1 Fabric kernel

The kernel contains only host-neutral logic:

- action registration and discovery
- provider descriptors and schema validation
- TypeScript checking
- guest declaration generation
- QuickJS and optional Node-process execution
- execution traces
- bounded results
- effects and conflict detection
- capability views and components
- workflow accounting
- provider-level activity
- cancellation and timeout handling

The kernel must not import:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- Kiro-specific modules
- MCP server transport modules
- ACP transport modules

### 6.2 Pi host adapter

The Pi adapter preserves current behavior:

- Pi extension registration
- Pi tool capture
- Pi native core tool replay
- Pi commands and dashboard
- Pi session-aware memory
- native Pi trajectory fork
- Pi in-place prewalk
- Pi compaction integration
- Pi Main delivery
- existing resident-host behavior

This adapter may import Pi packages. No Kiro or daemon bundle may reach it through an eager or lazy import graph.

### 6.3 Daemon project runtime

One daemon may serve multiple projects. A project runtime is keyed by the canonical project root and owns:

- resolved Fabric configuration
- provider registry
- MCP descriptor cache and live MCP clients
- QuickJS runtime cache
- agent and actor managers
- mesh and state stores
- execution records
- approval records
- active host sessions
- queued completion and actor messages

Project runtimes are lazily created and may be evicted only when they have no active executions, live durable participants, or active client sessions.

### 6.4 Kiro MCP adapter

The adapter is intentionally thin. It must:

- connect to or auto-start `fabricd`
- register the current Kiro-facing session
- expose only `fabric_exec`
- send invocation context out of band, not in the model-facing schema
- bridge progress, elicitation, cancellation, image blocks, and result formatting
- leave durable execution ownership in the daemon
- write protocol data only to stdout
- write diagnostics only to stderr or log files

### 6.5 Kiro ACP runner

The runner acts as an ACP client and Kiro acts as the ACP agent. It must:

- spawn the configured Kiro binary
- perform ACP initialization and capability negotiation
- create or load a session
- optionally set agent mode and model
- send text and image prompts
- stream assistant chunks and tool activity into `AgentRunRecord`
- support cancellation and process-group termination
- preserve runner session IDs for actors
- validate structured final results
- retain raw wire logs with restrictive permissions
- never copy or persist Kiro credentials

### 6.6 Fabric CLI

The CLI is the operator and fallback surface:

```text
fabric daemon start
fabric daemon status
fabric daemon stop

fabric exec
fabric check
fabric schema
fabric describe
fabric status
fabric approve
fabric deny
fabric cancel
fabric logs
fabric agents
fabric actors
fabric install kiro
fabric uninstall kiro
fabric doctor kiro
fabric trust
fabric untrust
```

All machine-readable commands support `--json`. Human diagnostics go to stderr; requested result data goes to stdout.

---

## 7. Runtime flows

### 7.1 Main `fabric_exec` flow

```text
1. Kiro model calls @fabric/fabric_exec.
2. fabric-mcp receives the flat tool arguments.
3. fabric-mcp joins or refreshes the host session in fabricd.
4. fabric-mcp sends execution.run with:
   - project root
   - cwd
   - Kiro session identity
   - client capabilities
   - abort/correlation IDs
   - original fabric_exec arguments
5. fabricd obtains the project runtime.
6. Fabric type-checks the code.
7. QuickJS runs the checked program.
8. Every effect crosses ActionRegistry.
9. Providers execute after authorization and approval.
10. Activity and partial results stream to fabric-mcp.
11. fabric-mcp emits MCP progress.
12. The final value, audits, trace ID, and media return as one MCP tool result.
13. Kiro receives only the compact returned value and bounded diagnostics.
```

### 7.2 Interactive nested approval flow

```text
Kiro            fabric-mcp             fabricd             provider
 │                   │                    │                    │
 │ fabric_exec       │                    │                    │
 ├──────────────────>│ execution.run      │                    │
 │                   ├───────────────────>│ invoke action      │
 │                   │                    ├───────────────────>│
 │                   │ approval.required  │                    │
 │                   │<───────────────────┤                    │
 │ elicitation form  │                    │                    │
 │<──────────────────┤                    │                    │
 │ allow/deny        │                    │                    │
 ├──────────────────>│ approval.decide    │                    │
 │                   ├───────────────────>│ resume or reject   │
 │                   │                    ├───────────────────>│
```

Approval forms expose only a redacted, bounded argument preview. Decisions supported initially:

- allow once
- allow for this Fabric host session
- deny

Project-wide permanent allow rules must be changed through configuration or `fabric trust`; they must not be created by model output.

### 7.3 Non-interactive approval flow

When the connected client cannot elicit:

1. `fabricd` creates a pending approval record.
2. The foreground execution waits with a configured timeout.
3. Progress exposes the approval ID.
4. An operator runs `fabric approve <id>` or `fabric deny <id>`.
5. The daemon resolves the live approval promise.

The QuickJS continuation is live in memory; it is not serializable across daemon restart. If the daemon exits while an approval is pending, mark the execution `indeterminate` and never replay the effect automatically.

### 7.4 Kiro child-agent flow

```text
fabric_exec guest
    │ agents.run / agents.spawn / agents.create
    ▼
AgentsProvider
    ▼
AgentManager
    ▼
KiroAcpRunner
    ├─ spawn kiro-cli acp --agent <configured-agent>
    ├─ initialize
    ├─ session/new or session/load
    ├─ optional session/set_model
    ├─ session/prompt
    ├─ receive AgentMessageChunk
    ├─ receive ToolCall / ToolCallUpdate
    ├─ receive TurnEnd
    └─ session/cancel on stop or timeout
```

### 7.5 Durable actor flow

1. `agents.create({ residency: "durable", runner: "kiro" })` creates an actor record in the daemon-owned project runtime.
2. The daemon owns the ACP process/session, not the Kiro Main TUI.
3. Kiro Main may disconnect.
4. Actor mailboxes, session IDs, subscriptions, and logs remain.
5. On daemon restart, actors with persisted Kiro session IDs are restored with `session/load`.
6. Completion or mailbox output is queued for Main.
7. Kiro hooks may drain queued messages on the next user prompt or stop boundary.
8. The same messages remain accessible through `agents.status`, `agents.log`, and the CLI even if hook delivery is unavailable.

### 7.6 Cancellation flow

Cancellation must propagate through every layer:

```text
Kiro cancel
  → MCP request AbortSignal
    → fabric-mcp execution.cancel
      → daemon execution AbortController
        → QuickJS interrupt / Node child termination
        → provider cancellation
        → nested MCP cancellation
        → ACP session/cancel
        → process-group SIGTERM, then SIGKILL after grace
```

No layer may convert cancellation into a successful result.

---

## 8. Public contracts

### 8.1 Host-neutral invocation context

Replace the Pi type in `FabricInvocationContext` with a host-neutral contract.

Proposed shape:

```ts
export type FabricHostKind = "pi" | "kiro" | "cli" | "daemon-test";

export interface FabricHostIdentity {
  kind: FabricHostKind;
  clientId: string;
  sessionId: string;
  projectRoot: string;
  cwd: string;
  interactive: boolean;
  trusted: boolean;
  capabilities: ReadonlySet<
    | "approval"
    | "progress"
    | "images"
    | "message-delivery"
    | "native-compaction"
    | "native-trajectory"
  >;
}

export interface FabricApprovalRequest {
  id: string;
  executionId: string;
  ref: string;
  risk: FabricRisk;
  argsPreview: Record<string, unknown>;
  reason?: string;
  expiresAt: number;
}

export type FabricApprovalDecision =
  | { decision: "allow_once" }
  | { decision: "allow_session" }
  | { decision: "deny"; reason?: string };

export interface FabricHostServices {
  identity: FabricHostIdentity;
  requestApproval(
    request: FabricApprovalRequest,
    signal: AbortSignal,
  ): Promise<FabricApprovalDecision>;
  progress(update: FabricHostProgress): void;
  deliver?(message: FabricHostMessage): Promise<void>;
  proxyResult?(event: FabricNestedResultEvent): Promise<FabricNestedResultPatch | undefined>;
  attachMedia?(blocks: FabricMediaBlock[], note?: string): void;
}

export interface FabricInvocationContext {
  cwd: string;
  signal: AbortSignal | undefined;
  parentToolCallId: string;
  nestedToolCallId: string;
  host: FabricHostServices;
  update(message: string): void;
  activity?(update: FabricInvocationActivityUpdate): void;
  deferHandoff?(args: Record<string, unknown>): Record<string, unknown>;
  attachMedia?(blocks: FabricMediaBlock[], note?: string): void;
  updateArguments?(args: Record<string, unknown>): void;
  attachPreview?(preview: unknown): void;
  capabilityView?: FabricCommittedCapabilityView;
  effectPolicy?: "advisory" | "strict";
}
```

Pi-only code may wrap native `ExtensionContext` inside an implementation module, but the native object must not appear in the public kernel protocol.

### 8.2 Host-neutral kernel factory

Introduce a factory instead of duplicating runtime construction:

```ts
export interface FabricKernelOptions {
  projectRoot: string;
  cwd: string;
  config: FabricConfig;
  paths: FabricRuntimePaths;
  providers: FabricProviderComponent[];
  agents: AgentManager;
  mesh: MeshStore;
  activity: FabricActivityStore;
  sessionApprovals: FabricSessionApprovals;
}

export interface FabricKernel {
  readonly registry: ActionRegistry;
  readonly execution: FabricExecutionService;
  readonly components: FabricComponentLoader;
  readonly activity: FabricActivityStore;
  execute(options: FabricKernelExecutionOptions): Promise<FabricExecutionResult>;
  close(): Promise<void>;
}
```

The existing Pi runtime and the new daemon runtime both construct this kernel with different host services and provider sets.

### 8.3 Runner driver contract

Refactor hard-coded runner branches behind a driver interface before adding Kiro:

```ts
export interface FabricRunnerDriver {
  readonly kind: FabricAgentRunner;

  available(config: FabricAgentConfig): Promise<boolean>;

  start(
    request: AgentRunRequest,
    context: FabricRunnerContext,
  ): Promise<FabricRunnerSession>;
}

export interface FabricRunnerSession {
  readonly runnerSessionId?: string;
  readonly attachCommand?: string;

  events(): AsyncIterable<FabricRunnerEvent>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  compact?(request: AgentCompactRequest): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}
```

Normalize all runner output into:

```ts
export type FabricRunnerEvent =
  | { type: "session"; sessionId: string; model?: string }
  | { type: "assistant_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; input?: unknown }
  | { type: "tool_update"; id: string; status: string; output?: unknown }
  | { type: "tool_end"; id: string; success: boolean; output?: unknown }
  | { type: "usage"; usage: AgentUsage; model?: string; provider?: string }
  | { type: "turn_end"; text?: string; value?: unknown }
  | { type: "error"; error: string };
```

Port Pi, Claude, and Veda behind this interface without changing their externally observed behavior. Then add `KiroAcpRunner`.

### 8.4 Daemon protocol

Use versioned JSON-RPC 2.0 over:

- Unix domain socket on macOS/Linux
- named pipe on Windows

The protocol is full duplex and supports notifications.

Required methods:

```text
daemon.ping
daemon.shutdown
session.join
session.heartbeat
session.leave
execution.run
execution.cancel
execution.status
approval.list
approval.decide
runtime.describe
runtime.schema
agent.list
agent.status
agent.log
agent.message
agent.stop
actor.list
actor.status
actor.message
actor.stop
```

Required notifications:

```text
execution.progress
execution.audit
approval.required
agent.update
actor.delivery
runtime.catalog_changed
```

Every mutating request carries:

- `protocolVersion`
- `requestId`
- `clientId`
- `sessionId`
- `projectRoot`

`requestId` is an idempotency key. A repeated request must return the existing result or existing in-flight handle, not repeat side effects.

### 8.5 Model-facing MCP schema

Keep the current flat tool schema:

```ts
{
  code: string;
  strings?: Record<string, string>;
  resultFormat?: "auto" | "yaml" | "json" | "text";
  tokenBudget?: number;
  agentBudget?: number;
  display?: string | {
    name?: string;
    description?: string;
  };
}
```

Do not add project paths, session IDs, approval policy, or host details to this schema. The adapter supplies those out of band.

### 8.6 Execution result envelope

The daemon returns:

```ts
export interface FabricDaemonExecutionResult {
  executionId: string;
  success: boolean;
  value: unknown;
  formatted: string;
  error?: string;
  media?: FabricMediaBlock[];
  auditSummary: {
    calls: number;
    failed: number;
    truncated: number;
  };
  traceId: string;
  elapsedMs: number;
  handoffFidelity?: "native" | "semantic";
}
```

The MCP adapter returns `formatted` as text, `value` as structured content when supported, image blocks as MCP image content, and `isError: true` when `success` is false.

### 8.7 Project state layout

Default layout:

```text
~/.fabric/
├─ fabric.json
├─ run/
│  ├─ fabricd.sock or Windows pipe metadata
│  ├─ fabricd.pid
│  ├─ auth-token
│  └─ daemon.log
└─ projects/
   └─ <sha256(canonical-project-root)>/
      ├─ metadata.json
      ├─ sessions/
      ├─ approvals/
      ├─ runs/
      ├─ artifacts/
      └─ locks/

<project>/.fabric/
├─ fabric.json
├─ mesh/
├─ actors/
├─ state/
└─ cache/
```

Rules:

- Runtime-created files use `0600`; directories use `0700` where supported.
- The installer adds runtime state to `.git/info/exclude`, not the repository’s tracked `.gitignore`, unless explicitly requested.
- Project configuration is read only after explicit Fabric project trust.
- Untrusted projects use global defaults and user-scoped runtime storage.
- Canonical paths and symlink targets are validated before any file effect.

### 8.8 Configuration precedence

For the daemon/Kiro host:

1. built-in defaults
2. `~/.fabric/fabric.json`
3. trusted `<project>/.fabric/fabric.json`
4. environment overrides
5. explicit CLI or invocation overrides

Pi keeps its existing configuration locations and behavior. A later migration may unify config roots, but that is not required for the first Kiro release.

Additive configuration proposal:

```json
{
  "configVersion": 2,
  "daemon": {
    "autoStart": true,
    "socketPath": "",
    "idleShutdownMs": 0,
    "approvalTimeoutMs": 300000
  },
  "hosts": {
    "kiro": {
      "enabled": true,
      "compatPiNamespace": true,
      "deliverQueuedMessagesWithHooks": true
    }
  },
  "agents": {
    "runner": "kiro",
    "kiro": {
      "binary": "kiro-cli",
      "agent": "fabric-child",
      "startupTimeoutMs": 60000,
      "useClientCapabilities": true
    }
  }
}
```

Environment overrides:

```text
FABRIC_DAEMON_SOCKET
FABRIC_PROJECT_ROOT
FABRIC_MESH_ROOT
FABRIC_KIRO_BINARY
FABRIC_LOG_LEVEL
FABRIC_CONFIG
```

Continue accepting existing `PI_FABRIC_*` variables in the Pi adapter.

---

## 9. Guest API and provider strategy

### 9.1 Kiro core-tools provider

Implement a Fabric-owned provider registered as `pi` in Kiro mode.

Required actions:

```text
pi.read
pi.grep
pi.find
pi.ls
pi.write
pi.edit
pi.bash
```

The implementation should match existing Pi Fabric argument and result behavior closely enough that current Fabric skills work unchanged.

Required properties:

- deterministic JSON schemas
- exact risk classification
- effect metadata
- bounded output
- cancellation
- path confinement
- atomic writes
- process-group termination
- stable error text
- audit previews
- compatibility normalization already supported by Fabric

Do not import Pi implementations.

### 9.2 Filesystem requirements

- Resolve relative paths from invocation `cwd`.
- Enforce the project root unless an explicit allowlist grants another root.
- Reject symlink escapes for writes.
- Use atomic replace for write/edit.
- Preserve file mode where possible.
- Detect binary files before text operations.
- Bound reads by lines and bytes.
- Support offset/limit continuation.
- Make edit operations fail when anchors are missing or ambiguous unless `all` is explicitly set.
- Return the same success shape expected by current guest code.

### 9.3 Shell requirements

- Use a fresh child process group.
- Support timeout and `settle`.
- Stream bounded progress.
- Capture exit code and signal.
- Kill the entire process group on cancel.
- Do not interpolate arguments added by Fabric itself through a shell.
- Treat the model-provided command as an execute-risk effect.
- Redact secrets from previews and logs.
- Record possible filesystem drift for Kiro trajectory prewalk.

### 9.4 Nested MCP

Reuse the existing MCP provider after removing Pi result-middleware coupling.

Kiro mode must use Fabric’s MCP configuration, not Kiro Main’s MCP tool registry. The Kiro custom agent sets `includeMcpJson: false` to avoid duplicate model-facing tools.

The first release supports static stdio and HTTP servers already supported by the existing provider. Interactive nested OAuth propagation may remain disabled until it has a tested approval and browser flow.

### 9.5 Providers unavailable in Kiro v1

Return explicit, actionable unavailability diagnostics rather than silently omitting behavior:

- `extensions.*` captured Pi extension tools
- Pi-native session memory until a Kiro transcript store exists
- Pi-native in-place compaction
- Pi-native transcript fork

---

## 10. Kiro integration artifacts

### 10.1 Main custom agent

`fabric install kiro` generates a project or global agent similar to:

```json
{
  "name": "fabric",
  "description": "Checked TypeScript tool and agent orchestration through Fabric",
  "includeMcpJson": false,
  "includePowers": false,
  "mcpServers": {
    "fabric": {
      "command": "fabric-mcp",
      "args": ["--stdio"],
      "timeout": 60000,
      "requestTimeout": 3600000
    }
  },
  "tools": [
    "@fabric/fabric_exec"
  ],
  "allowedTools": [
    "@fabric/fabric_exec"
  ],
  "permissions": {
    "rules": [
      {
        "capability": "mcp",
        "match": ["fabric/fabric_exec"],
        "effect": "allow"
      }
    ]
  },
  "resources": [
    "skill://.kiro/skills/fabric-*/SKILL.md"
  ],
  "prompt": "Use fabric_exec for effectful work. Load the fabric-exec skill before the first call. Batch independent operations, return compact final values, and let Fabric enforce nested approvals."
}
```

The installer must validate the generated profile against the installed Kiro schema and must not overwrite an existing profile without an explicit flag.

### 10.2 Child-agent profile

Provide a minimal `fabric-child` profile. Per-run tool restrictions must be enforced by one of these mechanisms, selected in Phase 0:

**Preferred:** ACP client-vended filesystem/terminal capabilities plus permission responses controlled by Fabric.

**Fallback:** generate an ephemeral Kiro custom-agent profile with the exact tools and permissions for that run, launch `kiro-cli acp --agent <generated-name>`, then remove the profile after the process exits.

**Forbidden:** relying only on prompt instructions to prevent unapproved tools.

### 10.3 Skills

Copy or generate Kiro-compatible versions of:

- `fabric-exec`
- `fabric-guide`
- `fabric-workflow`
- `fabric-rlm`
- `fabric-supervisor`
- `fabric-spec`
- `fabric-advisor`
- `fabric-council`
- `fabric-fusion`
- `fabric-ambient`
- `fabric-swarm`
- `fabric-schema`

For the first release:

- preserve `pi.*` examples
- remove instructions that require Pi slash commands or Pi TUI
- replace `/fabric ...` operational instructions with `fabric ...` CLI commands where necessary
- mark unsupported Pi-native behavior explicitly
- retain progressive loading and reference files
- add host metadata only if Kiro’s skill schema supports it

### 10.4 Hooks

Hooks are optional for the MVP and required for queued Main delivery parity.

The installer must generate hook syntax compatible with the installed Kiro CLI instead of assuming one historical schema.

Required lifecycle events:

- session/agent start: register Main
- user prompt: publish an `input` lifecycle event and drain queued actor messages
- stop/settle: publish a settled event and drain completion notices
- shutdown where available: leave the session

Privacy rules:

- do not persist full user prompts by default
- publish metadata unless `hosts.kiro.hooks.includePromptText` is explicitly enabled
- redact secrets
- bound injected actor/completion messages
- preserve queued messages if hook delivery fails

---

## 11. Repository and file-layout plan

Do not begin with a monorepo migration. First create import-graph boundaries inside the current package.

Proposed additions:

```text
src/
├─ host/
│  ├─ types.ts
│  ├─ approval-channel.ts
│  ├─ progress-sink.ts
│  ├─ pi/
│  │  ├─ context.ts
│  │  ├─ services.ts
│  │  └─ runtime-adapter.ts
│  └─ daemon/
│     ├─ context.ts
│     └─ services.ts
├─ kernel/
│  ├─ fabric-kernel.ts
│  ├─ factory.ts
│  └─ project-runtime.ts
├─ daemon/
│  ├─ main.ts
│  ├─ server.ts
│  ├─ client.ts
│  ├─ protocol.ts
│  ├─ socket.ts
│  ├─ authentication.ts
│  ├─ project-registry.ts
│  ├─ session-registry.ts
│  ├─ approval-broker.ts
│  └─ execution-registry.ts
├─ cli/
│  ├─ main.ts
│  └─ commands/
├─ kiro/
│  ├─ mcp-server.ts
│  ├─ installer.ts
│  ├─ profile.ts
│  ├─ hooks.ts
│  ├─ doctor.ts
│  └─ templates/
├─ agents/
│  └─ runners/
│     ├─ types.ts
│     ├─ pi.ts
│     ├─ claude.ts
│     ├─ veda.ts
│     └─ kiro-acp.ts
├─ providers/
│  ├─ local-core-tools-provider.ts
│  ├─ local-read.ts
│  ├─ local-search.ts
│  ├─ local-edit.ts
│  └─ local-shell.ts
└─ transcript/
   ├─ store.ts
   └─ trajectory-envelope.ts

scripts/
├─ assert-kernel-host-free.mjs
├─ assert-kiro-graph-host-free.mjs
└─ spike-kiro-acp.mjs

tests/
├─ host/
├─ daemon/
├─ kiro/
├─ runners/
└─ fixtures/
   └─ fake-kiro-acp/
```

Package outputs:

```text
dist/index.js                 # existing Pi extension
dist/bin/fabric.js            # operator CLI
dist/bin/fabricd.js           # daemon
dist/bin/fabric-mcp.js        # Kiro MCP adapter
dist/worker.js                # agent worker
```

Proposed `package.json` bins:

```json
{
  "bin": {
    "fabric": "./dist/bin/fabric.js",
    "fabricd": "./dist/bin/fabricd.js",
    "fabric-mcp": "./dist/bin/fabric-mcp.js"
  }
}
```

Make Pi peer dependencies optional for non-Pi installation, and add build assertions proving that daemon, CLI, MCP, and Kiro runner entry graphs contain no Pi imports.

A later package split may create `@pi-fabric/core` and `@pi-fabric/kiro`, but only after the Kiro release passes end-to-end tests.

---

## 12. Implementation phases

## Phase 0 — Kiro ACP and hook capability spike

**Goal:** eliminate unknowns before core refactoring.

### Tasks

- [ ] Add `scripts/spike-kiro-acp.mjs`.
- [ ] Spawn `kiro-cli acp --agent fabric-child`.
- [ ] Perform ACP `initialize`.
- [ ] Record advertised capabilities.
- [ ] Verify `session/new`.
- [ ] Verify `session/prompt`.
- [ ] Verify `session/cancel`.
- [ ] Verify `session/load`.
- [ ] Verify `session/set_model` behavior.
- [ ] Verify image prompts.
- [ ] Record `AgentMessageChunk`, `ToolCall`, `ToolCallUpdate`, and `TurnEnd`.
- [ ] Determine whether Kiro requests ACP client-vended filesystem and terminal operations.
- [ ] Determine whether all tool permissions can be enforced by the ACP client.
- [ ] Verify whether one ACP process supports multiple sessions safely.
- [ ] Verify Kiro process behavior on stdin close and SIGTERM.
- [ ] Verify current hook input/output and whether hook stdout can inject bounded context.
- [ ] Write `docs/kiro-capability-spike.md` with captured, redacted wire examples.
- [ ] Select the child permission mechanism: ACP client capabilities or generated profile fallback.

### Exit criteria

- A non-billable handshake/session test runs locally.
- A separately opt-in billable prompt test streams a complete turn.
- Cancellation is proven.
- Child tool enforcement has a non-prompt-only implementation path.
- Unsupported capabilities are explicitly documented.
- No production architecture decision remains dependent on an unverified Kiro behavior.

---

## Phase 1 — Remove Pi types from kernel protocols

**Goal:** make execution and provider contracts host-neutral without changing Pi behavior.

### Tasks

- [ ] Add `src/host/types.ts`.
- [ ] Replace `FabricInvocationContext.extensionContext` with `host`.
- [ ] Change `FabricExecutionOptions.context` to a host-neutral execution context.
- [ ] Refactor `ApprovalController` to depend on an approval channel.
- [ ] Refactor nested result proxying to an optional host service.
- [ ] Refactor media attachment and progress to host services.
- [ ] Add `PiHostServices` wrapping the current `ExtensionContext`.
- [ ] Update Pi providers and execution call sites.
- [ ] Keep Pi-specific types out of `src/protocol.ts`.
- [ ] Add `assert-kernel-host-free.mjs`.
- [ ] Add type-level tests preventing Pi imports in kernel contracts.
- [ ] Preserve current public `pi-fabric/protocol` behavior where possible; version any breaking protocol types.

### Exit criteria

- `pnpm check` passes.
- Existing Pi tests pass unchanged or with mechanical host-adapter updates.
- `src/protocol.ts`, `src/execution-service.ts`, and `src/core/action-registry.ts` contain no Pi type imports.
- No user-visible Pi behavior changes.

---

## Phase 2 — Extract a reusable Fabric kernel

**Goal:** share runtime construction between Pi and daemon hosts.

### Tasks

- [ ] Introduce `FabricKernel`.
- [ ] Extract host-independent provider/component installation from `FabricRuntimeState`.
- [ ] Parameterize project root, mesh root, session identity, activity, and provider set.
- [ ] Keep Pi Main delivery, memory, native prewalk, and TUI in the Pi adapter.
- [ ] Add a daemon/test host that can initialize the kernel without Pi.
- [ ] Add deterministic close order for providers, agents, actors, components, and MCP clients.
- [ ] Add project-runtime lifecycle tests.
- [ ] Add leak tests for repeated create/close cycles.
- [ ] Add import-graph checks.

### Exit criteria

- A test constructs and executes the kernel without Pi installed.
- Pi uses the same kernel and passes all existing tests.
- Provider registration is not duplicated between hosts.
- Runtime close leaves no child processes, timers, sockets, or file locks.

---

## Phase 3 — Implement Fabric-owned `pi.*` core tools

**Goal:** make existing Fabric programs work under Kiro without Pi.

### Tasks

- [ ] Implement local `pi.read`.
- [ ] Implement local `pi.grep`.
- [ ] Implement local `pi.find`.
- [ ] Implement local `pi.ls`.
- [ ] Implement local `pi.write`.
- [ ] Implement local `pi.edit`.
- [ ] Implement local `pi.bash`.
- [ ] Reuse current schemas or create compatible schema fixtures.
- [ ] Reuse current argument normalization.
- [ ] Match success/error result contracts.
- [ ] Add effect metadata and risk classes.
- [ ] Add root confinement and symlink tests.
- [ ] Add binary-file tests.
- [ ] Add atomic-write and interrupted-write tests.
- [ ] Add process-group cancellation tests.
- [ ] Add output truncation tests.
- [ ] Add golden behavior comparisons against Pi fixtures where practical.
- [ ] Add shell drift tracking for trajectory prewalk.

### Exit criteria

This program runs without Pi:

```ts
const [manifest, sources] = await Promise.all([
  pi.read({ path: "package.json" }),
  pi.find({ pattern: "src/**/*.ts" }),
]);
return {
  package: JSON.parse(manifest).name,
  sourceCount: sources.split("\n").filter(Boolean).length,
};
```

Write, edit, shell, timeout, cancellation, and approval tests pass.

---

## Phase 4 — Build `fabricd` and the `fabric` CLI

**Goal:** establish the persistent runtime and stable local protocol.

### Tasks

- [ ] Implement authenticated local socket/named-pipe transport.
- [ ] Generate a `0600` daemon auth token.
- [ ] Implement PID/lock handling and stale-lock recovery.
- [ ] Implement daemon auto-start.
- [ ] Implement protocol version negotiation.
- [ ] Implement project runtime registry.
- [ ] Implement session join/heartbeat/leave.
- [ ] Implement execution registry.
- [ ] Implement idempotent `execution.run`.
- [ ] Implement cancellation.
- [ ] Implement approval broker.
- [ ] Implement status and log methods.
- [ ] Implement large-result artifact handles.
- [ ] Implement structured daemon logging.
- [ ] Implement graceful and forced shutdown.
- [ ] Implement Windows named-pipe support.
- [ ] Implement `fabric daemon ...`.
- [ ] Implement `fabric exec`, `check`, `schema`, and `describe`.
- [ ] Implement `fabric approve`, `deny`, and `cancel`.
- [ ] Implement `fabric status`, `logs`, `agents`, and `actors`.
- [ ] Add `--json` and stable exit codes.
- [ ] Add crash-conservative indeterminate states.
- [ ] Add concurrent execution and restart tests.

### Exit criteria

- The CLI can start the daemon and run checked TypeScript.
- Two CLI clients can execute concurrently.
- A separate CLI can approve a waiting execution.
- A cancelled shell command leaves no child process.
- Repeating the same `requestId` does not repeat effects.
- Restarted daemon reports interrupted live executions as indeterminate.

---

## Phase 5 — Add `fabric-mcp` and the Kiro Main profile

**Goal:** provide the one-tool Kiro experience.

### Tasks

- [ ] Add the official MCP TypeScript SDK.
- [ ] Implement stdio MCP server startup.
- [ ] Expose only `fabric_exec`.
- [ ] Preserve the current flat schema and argument preparation.
- [ ] Connect to or auto-start `fabricd`.
- [ ] Map MCP cancellation to daemon cancellation.
- [ ] Map daemon progress to MCP progress.
- [ ] Map approval requests to MCP elicitation.
- [ ] Map image media to MCP image blocks.
- [ ] Map structured results and errors correctly.
- [ ] Ensure stdout contains protocol frames only.
- [ ] Add `fabric install kiro`.
- [ ] Generate project and global profile modes.
- [ ] Copy Kiro-compatible skills.
- [ ] Add safe update, backup, and uninstall behavior.
- [ ] Add `fabric doctor kiro`.
- [ ] Validate the generated agent against the installed Kiro schema.
- [ ] Confirm Kiro’s tool list contains only `@fabric/fabric_exec`.
- [ ] Confirm the outer tool can be pre-approved while nested writes still ask through Fabric.

### Exit criteria

From Kiro’s `fabric` agent:

- the model sees one Fabric tool
- a read-only `fabric_exec` succeeds without Pi
- a write causes a nested Fabric approval
- denial causes no file mutation
- MCP cancellation stops execution
- nested MCP calls work through Fabric
- existing workspace MCP servers are not duplicated into model context

---

## Phase 6 — Refactor runners and implement `KiroAcpRunner`

**Goal:** support Kiro as a first-class Fabric worker.

### Tasks

- [ ] Add `"kiro"` to `FabricAgentRunner`.
- [ ] Add `agents.kiro` configuration and migration defaults.
- [ ] Introduce the runner-driver interface.
- [ ] Move Pi behavior behind `PiRunnerDriver`.
- [ ] Move Claude behavior behind `ClaudeRunnerDriver`.
- [ ] Move Veda behavior behind `VedaRunnerDriver`.
- [ ] Keep existing runner event semantics and tests.
- [ ] Add the official ACP TypeScript SDK.
- [ ] Implement `KiroAcpRunner`.
- [ ] Spawn `kiro-cli acp --agent <agent>`.
- [ ] Negotiate capabilities.
- [ ] Implement new/load/prompt/cancel.
- [ ] Map message and tool updates.
- [ ] Map model selection when supported.
- [ ] Map images.
- [ ] Persist `runnerSessionId`.
- [ ] Enforce exact child tool permissions using the Phase 0 decision.
- [ ] Add worktree support.
- [ ] Add schema-result validation.
- [ ] Add timeout and process-group termination.
- [ ] Add raw and redacted logs.
- [ ] Mark usage unavailable when Kiro does not provide it; do not fabricate token or cost numbers.
- [ ] Add a fake Kiro ACP fixture for zero-cost CI.
- [ ] Add an opt-in real Kiro integration suite.

### Exit criteria

These work with `runner: "kiro"`:

```ts
await agents.run(...)
await agents.spawn(...)
await agents.wait(...)
await agents.status(...)
await agents.log(...)
await agents.steer(...)
await agents.followUp(...)
await agents.stop(...)
```

A child cannot use a tool outside the approved run allowlist.

---

## Phase 7 — Durable agents, actors, and Kiro Main delivery

**Goal:** make daemon-owned participants survive Kiro TUI shutdown.

### Tasks

- [ ] Move Kiro durable ownership to `fabricd`.
- [ ] Persist Kiro ACP session IDs.
- [ ] Restore actors through `session/load`.
- [ ] Persist mailboxes, subscriptions, and replay cursors.
- [ ] Add host session leases and expiry.
- [ ] Queue Main delivery when no Kiro client is active.
- [ ] Implement Kiro hook generation.
- [ ] Drain bounded queued messages on supported hook boundaries.
- [ ] Preserve messages when hook delivery fails.
- [ ] Add CLI message delivery and inspection.
- [ ] Add duplicate-owner prevention.
- [ ] Add daemon restart/adoption tests.
- [ ] Add concurrent Kiro Main session tests.
- [ ] Add actor stop, remove, and cleanup tests.
- [ ] Preserve existing Pi residency behavior.

### Exit criteria

- A durable Kiro actor continues after the parent Kiro TUI exits.
- A new Kiro session can inspect and message it.
- Actor output is delivered through hooks or remains queued and inspectable.
- Restart converges on one actor owner.
- No mailbox item runs twice.

---

## Phase 8 — Advanced Fabric semantics on Kiro

**Goal:** restore higher-level workflows after the Kiro runner is stable.

### Tasks

- [ ] Verify workflow helpers with Kiro workers.
- [ ] Verify councils.
- [ ] Verify RLM recursion and depth limits.
- [ ] Verify swarm and mesh coordination.
- [ ] Implement semantic Kiro trajectory envelopes.
- [ ] Add `handoffFidelity`.
- [ ] Implement Kiro trajectory-mode `agents.handoff`.
- [ ] Implement Kiro trajectory prewalk.
- [ ] Reuse mutation and shell-drift detection.
- [ ] Run the executor only after the full outer program settles.
- [ ] Return executor completion through the current `fabric_exec`.
- [ ] Keep Kiro in-place prewalk unavailable with a clear diagnostic.
- [ ] Reuse deterministic Fabric compaction for trajectory envelopes.
- [ ] Optionally call Kiro native compaction through documented ACP extensions after capability detection.
- [ ] Add a host-neutral transcript store.
- [ ] Implement Kiro-compatible `memory.*` from Fabric and ACP logs.
- [ ] Add topology records for Kiro Main and ACP children.

### Exit criteria

- Workflow, council, recursion, and swarm tests pass with fake and real opt-in Kiro runners.
- Handoff explicitly reports semantic fidelity.
- No private Kiro session format is required.
- Unsupported native behavior fails clearly instead of pretending parity.

---

## Phase 9 — Packaging, observability, hardening, and release

**Goal:** ship a supportable Kiro integration.

### Tasks

- [ ] Add package bins and build entries.
- [ ] Make Pi peers optional for Kiro-only installation.
- [ ] Add `assert:kiro-graph`.
- [ ] Prove daemon/MCP/CLI bundles contain no Pi imports.
- [ ] Add third-party notices for MCP and ACP SDKs.
- [ ] Add `docs/kiro.md`.
- [ ] Add installation, upgrade, and uninstall docs.
- [ ] Add troubleshooting and security docs.
- [ ] Add protocol compatibility docs.
- [ ] Add `fabric status --watch`.
- [ ] Add activity summaries suitable for Kiro MCP progress.
- [ ] Add log redaction tests.
- [ ] Add Linux, macOS, and Windows CI.
- [ ] Add Node 24 CI.
- [ ] Add release smoke tests from a clean npm install.
- [ ] Add feature flags and experimental release notes.
- [ ] Add migration tests for config version 2.
- [ ] Run the complete Pi and Kiro matrices.

### Exit criteria

A clean machine can:

```bash
npm install -g pi-fabric
fabric install kiro --global
fabric doctor kiro
kiro-cli --agent fabric
```

The Kiro path works without installing or launching Pi, and the existing Pi extension still passes its full release checks.

---

## 13. Testing strategy

### 13.1 Unit tests

Cover:

- host context contracts
- approval decisions
- daemon protocol validation
- idempotency
- config precedence and migration
- path canonicalization
- symlink escapes
- file reads and truncation
- exact edits
- atomic writes
- shell timeouts and cancellation
- runner event normalization
- ACP frame parsing
- MCP result mapping
- hook message bounding
- log redaction

### 13.2 Fixture-based integration tests

Create:

- fake MCP servers
- fake Kiro ACP agent
- fake approval client
- fake Kiro Main MCP client
- crashable provider
- slow/cancellable shell fixtures
- actor restart fixtures

The fake Kiro agent must support deterministic:

- initialization
- session creation/loading
- message chunks
- tool-call updates
- cancellation
- malformed events
- process crash
- delayed completion

### 13.3 Real Kiro opt-in tests

Real Kiro tests must be gated by an environment variable and separated into:

1. non-billable capability tests
2. explicitly opt-in model invocation tests

Never run billable Kiro prompts in default CI.

### 13.4 Pi regression tests

Every phase runs the existing Pi suite. Add golden tests for:

- tool schema
- result shape
- approvals
- provider refs
- agent records
- activity
- config defaults
- build import graphs

### 13.5 End-to-end acceptance scenarios

1. **Single-tool surface:** Kiro `fabric` agent lists only `fabric_exec`.
2. **Read:** Fabric reads and summarizes project files.
3. **Write approval:** write waits for Fabric approval.
4. **Denied write:** file hash remains unchanged.
5. **Shell cancellation:** process group is gone.
6. **Nested MCP:** Fabric discovers, describes, and invokes a server.
7. **Parallel calls:** independent reads run concurrently.
8. **Type failure:** invalid guest code returns line-numbered diagnostics without effects.
9. **Kiro worker:** `agents.run` streams and completes.
10. **Tool restriction:** Kiro child cannot exceed its allowlist.
11. **Worktree:** child edits remain isolated.
12. **Durability:** actor survives Main exit.
13. **Restart:** daemon restores durable state and marks interrupted foreground work indeterminate.
14. **No Pi dependency:** remove Pi packages and run Kiro E2E.
15. **Pi preservation:** install as Pi extension and run current E2E.

---

## 14. Security requirements

### 14.1 Local daemon boundary

- Socket or pipe accessible only to the current user.
- Authentication token required even on the local socket.
- Token and lock files are `0600`.
- Reject peer identity mismatches where the platform exposes peer credentials.
- Version and size-check every frame.
- Limit request and notification queues.
- Reject duplicate IDs with conflicting payloads.
- Do not trust project-provided socket paths by default.

### 14.2 Project trust

Because Kiro trust is not exposed as a stable MCP field, Fabric maintains its own trust record.

Untrusted default:

- project config ignored
- durable actors disabled
- Node-process executor disabled
- write, execute, network, and agent effects ask or deny according to global policy
- state remains user-scoped

`fabric trust <project>` records the canonical root and must be an explicit user action.

### 14.3 Filesystem

- Canonicalize roots.
- Reject traversal.
- Reject write-through symlink escapes.
- Bound file size.
- Detect binaries.
- Avoid following attacker-controlled links between check and write.
- Use atomic replace.
- Preserve backups only when explicitly configured.

### 14.4 Shell

- Treat every model command as untrusted.
- Use approval and policy matching.
- Kill process groups.
- Bound output and runtime.
- Redact environment secrets.
- Do not pass daemon auth tokens to child processes.
- Pass only required Kiro authentication environment variables to Kiro children.

### 14.5 Logs and traces

Raw logs may contain prompts, arguments, tool results, paths, and secrets.

- use `0600`
- redact previews
- keep raw logs out of UI by default
- implement retention
- never place raw actor messages in shared mesh topology metadata
- do not persist Kiro credentials or OAuth tokens
- make artifact paths unguessable and root-confined

### 14.6 Node-process executor

Retain current unsafe classification.

For Kiro:

- default off
- unavailable in untrusted projects
- disabled in schema enforce mode
- explicit config and approval required
- process killed on timeout/cancel

---

## 15. Compatibility matrix

| Capability | Existing Pi | Kiro MVP | Kiro advanced |
|---|---:|---:|---:|
| `fabric_exec` | Full | Full | Full |
| TypeScript checking | Full | Full | Full |
| QuickJS isolation | Full | Full | Full |
| `pi.*` core tools | Native adapter | Local compatibility provider | Full |
| Tool discovery | Full | Full | Full |
| Nested MCP | Full | Full, static auth first | Fuller OAuth after hardening |
| Approvals | Pi UI | MCP elicitation / CLI | Full |
| Audit and traces | Full | Full | Full |
| One-shot agents | Pi/Claude/Veda | Kiro ACP | Full |
| Background agents | Full | Full after daemon | Full |
| Durable agents | Full | Phase 7 | Full |
| Actors | Full | Phase 7 | Full |
| Mesh/state/schema | Full | Host-neutral subset | Full |
| Workflows/councils | Full | After Kiro runner | Full |
| RLM recursion | Full | After Kiro runner | Full |
| Native trajectory fork | Full | No | No public Kiro API |
| Semantic trajectory handoff | N/A | Phase 8 | Full |
| In-place prewalk | Full | No | No until public support |
| Trajectory prewalk | Full | Phase 8 | Full semantic fidelity |
| Pi session memory | Full | No | Host-neutral transcript memory |
| Native TUI dashboard | Full | No | Standalone/Kiro progress |
| MCP progress | N/A | Full | Full |
| Captured extension tools | Full | Not applicable | Fabric-native providers only |

---

## 16. Failure handling

### Daemon unavailable

- MCP adapter attempts one bounded auto-start.
- On failure, return a clear MCP tool error with the daemon log path.
- Do not repeatedly spawn daemons in a loop.

### Protocol mismatch

- Fail during handshake.
- Report client and server protocol versions.
- Never attempt best-effort execution with incompatible mutation semantics.

### Kiro ACP unavailable

- `agents.models({ runner: "kiro" })` and Kiro runs return an actionable error.
- Main `fabric_exec` remains usable for non-agent work.

### Kiro authentication failure

- Surface Kiro’s error.
- Do not request or store credentials through Fabric.
- `fabric doctor kiro` should identify that local Kiro authentication is required.

### Approval timeout

- Fail the nested call as denied/timed out.
- Do not execute the effect.
- Record the approval outcome in the audit.

### Client disconnect

- Foreground execution cancels after a short disconnect grace unless another client reattaches with the same request ID.
- Durable agents and actors continue.
- Completion remains queued.

### Daemon crash

- Live QuickJS and shell work is not replayed.
- Mark it indeterminate.
- Recover durable actor definitions and Kiro session IDs.
- Reconcile ownership under a lock.

### Oversized output

- Persist a `0600` artifact.
- Return a bounded preview and artifact handle.
- Do not send multi-megabyte values through Kiro context.

---

## 17. Observability

Every execution has:

- execution ID
- host/client/session IDs
- project ID
- start/end/outcome
- display intent
- call count
- failed call count
- agent count
- approval count
- trace artifact
- bounded activity feed

Required CLI views:

```bash
fabric status
fabric status --watch
fabric logs <execution-or-agent-id>
fabric agents
fabric actors
fabric approvals
```

Kiro receives:

- MCP progress messages
- approval elicitation
- compact final result
- bounded error details
- image blocks where supported

Do not attempt to reproduce the Pi dashboard inside Kiro’s TUI in the first release.

---

## 18. Packaging and installation

### 18.1 Build graph

Add build assertions:

- `dist/bin/fabricd.js` graph has no Pi imports
- `dist/bin/fabric-mcp.js` graph has no Pi imports
- `dist/bin/fabric.js` graph has no Pi imports
- Kiro ACP runner graph has no Pi imports
- Pi extension may import Pi packages
- shared kernel may not import host packages

### 18.2 Optional Pi peers

Mark Pi peer dependencies optional for Kiro-only installations while keeping version requirements for the Pi extension.

A clean Kiro installation must not require downloading or resolving Pi packages at runtime.

### 18.3 Installer behavior

`fabric install kiro`:

1. detects Kiro
2. performs a capability handshake
3. chooses project or global scope
4. writes the main Fabric agent
5. writes the child profile
6. copies skills
7. optionally writes compatible hooks
8. writes default Fabric config if absent
9. validates all generated files
10. runs doctor checks

It must be idempotent and must create backups before replacing managed files.

### 18.4 Uninstall behavior

`fabric uninstall kiro` removes only files carrying Fabric-managed metadata or exact known hashes. It must not delete user-modified agent profiles or skills without confirmation.

---

## 19. Release gates

### Gate A — Kernel isolation

- host-neutral kernel executes without Pi
- existing Pi tests pass
- import-graph assertions pass

### Gate B — Kiro Main MVP

- Kiro sees one tool
- local core tools work
- approvals work
- cancellation works
- nested MCP works
- no Pi runtime dependency

### Gate C — Kiro agents

- Kiro ACP runner works
- strict tool restriction works
- background agents work
- worktrees work
- fake ACP suite passes in CI

### Gate D — Durability

- daemon restart tests pass
- actors and durable agents restore
- queued Main delivery is reliable
- duplicate ownership is prevented

### Gate E — Advanced parity

- workflows, councils, RLM, swarm pass
- semantic handoff/prewalk pass
- fidelity is accurately reported
- memory and topology have Kiro implementations or explicit limitations

### Gate F — Release

- clean npm install smoke test
- Linux/macOS/Windows matrix
- security review
- documentation complete
- Pi release suite green
- Kiro E2E green

---

## 20. Main risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Kiro ACP behavior changes | Runner breakage | capability negotiation, versioned adapter, fake fixture, doctor |
| Child tool permissions cannot be enforced through ACP | Security blocker | generated exact custom-agent profile fallback |
| Kiro does not expose token/cost usage | Partial budgets | report unavailable; never estimate as fact; enforce time/call budgets |
| Host refactor regresses Pi | High | incremental adapter, golden tests, Pi suite every phase |
| Daemon becomes a local privilege amplifier | High | socket auth, project trust, nested approvals, root confinement |
| Exact Kiro transcript fork unavailable | Parity gap | semantic envelope and explicit fidelity |
| Hooks change across Kiro versions | Delivery gap | installer generates against installed schema; queue remains authoritative |
| MCP client disconnects during execution | Orphaned work | disconnect grace, cancellation, request reattach |
| Multiple daemons start | State corruption | lock, socket probe, authenticated ownership |
| Windows process and pipe differences | Portability gap | platform adapters and CI |
| Package still pulls Pi into Kiro graph | Deployment failure | optional peers and import-graph assertions |
| Existing skills assume Pi UI commands | Confusing UX | Kiro skill variants and host-specific operational references |

---

## 21. Definition of done

The project is complete when all of the following are true:

- [ ] Kiro CLI uses Fabric through one `fabric_exec` MCP tool.
- [ ] The Kiro path runs without a Pi binary or Pi runtime packages.
- [ ] Existing Fabric TypeScript programs using `pi.*` work under Kiro.
- [ ] QuickJS remains the default runtime.
- [ ] Nested effects use Fabric approvals and audits.
- [ ] MCP elicitation supports interactive approvals.
- [ ] CLI approvals support non-eliciting clients.
- [ ] Cancellation reaches shell, MCP, QuickJS, and ACP children.
- [ ] Kiro is available as `runner: "kiro"`.
- [ ] Child tools are enforced technically, not by prompt only.
- [ ] Kiro sessions can be resumed for durable actors.
- [ ] Durable state is owned by `fabricd`.
- [ ] Semantic Kiro handoff is implemented and labeled accurately.
- [ ] Unsupported native Pi semantics produce clear diagnostics.
- [ ] `fabric install kiro` and `fabric doctor kiro` work.
- [ ] The daemon, CLI, MCP adapter, and Kiro runner import no Pi packages.
- [ ] Existing Pi behavior and release checks remain green.
- [ ] Security, crash, concurrency, and cross-platform tests pass.
- [ ] Documentation describes configuration, trust, logs, limitations, and recovery.

---

## 22. Ordered PR sequence

Use small, reviewable PRs in this order:

1. **PR 1: Kiro capability spike and ADR documentation**
2. **PR 2: host-neutral protocol and approval interfaces**
3. **PR 3: reusable kernel factory with Pi adapter**
4. **PR 4: local `pi.*` compatibility provider**
5. **PR 5: daemon protocol, project registry, and CLI**
6. **PR 6: MCP adapter and Kiro Main installer**
7. **PR 7: runner-driver refactor for existing runners**
8. **PR 8: Kiro ACP runner**
9. **PR 9: durable Kiro agents and actors**
10. **PR 10: Kiro hooks and queued Main delivery**
11. **PR 11: semantic handoff, trajectory prewalk, and compaction**
12. **PR 12: Kiro transcript memory and topology**
13. **PR 13: packaging, import-graph assertions, docs, and release hardening**

Each PR must contain:

- tests
- migration notes if schemas change
- no unrelated refactor
- updated documentation
- a compatibility statement for Pi
- a rollback path

---

## 23. Implementation-agent operating rules

1. Read this plan and the current repository architecture docs before editing.
2. Preserve the current public behavior unless a phase explicitly changes it.
3. Do not implement Kiro support by copying the entire Pi runtime.
4. Prefer dependency inversion over host checks spread through the kernel.
5. Keep host-specific code in host adapters.
6. Do not use `any` to bridge host boundaries without a validated wrapper.
7. Version every new persisted format and IPC message.
8. Make all writes atomic.
9. Make cancellation explicit and test it.
10. Do not fabricate usage, costs, capabilities, or parity.
11. Keep raw data out of model context unless deliberately returned.
12. Do not silently fall back to broader permissions.
13. Do not ship prompt-only security.
14. Run focused tests after each change and `pnpm check` before considering a phase complete.
15. Update this file’s checkboxes and decision log as implementation progresses.

---

## 24. Decision log

Record deviations here.

| Date | Decision | Reason | Consequence |
|---|---|---|---|
| 2026-08-24 | MCP northbound, ACP southbound, persistent daemon | Best supported Kiro surfaces while preserving Fabric ownership | Adds three entry points: `fabricd`, `fabric-mcp`, `fabric` |
| 2026-08-24 | Preserve `pi.*` under Kiro as a compatibility namespace | Avoid rewriting all current skills and guest programs | Naming remains Pi-flavored but no Pi runtime is used |
| 2026-08-24 | Semantic rather than native Kiro trajectory handoff | Public Kiro APIs do not expose exact Main branch construction | Fidelity must be reported explicitly |
| 2026-08-24 | Keep implementation in TypeScript first | Avoid combining host port and language rewrite | Rust or other rewrites deferred |

---

## 25. Reference baseline

Implementation should verify against the latest versions of these primary sources before coding:

- Pi Fabric repository, architecture, configuration, agents, providers, and interface documentation
- Kiro CLI ACP documentation
- Kiro custom-agent configuration reference
- Kiro MCP configuration and MCP elicitation documentation
- Kiro hooks documentation
- Agent Client Protocol specification and official TypeScript SDK
- Model Context Protocol specification and official TypeScript SDK
