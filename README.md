# Kiro Fabric

> **Native Kiro for ordinary work. Checked TypeScript for workflows.**

Kiro Fabric is an additive **Kiro Power** for programmable composition: parallel work, branches, loops, state, memory, and configured MCP federation. Kiro's native tools remain available.

> **Release status:** the Power is source-installable for local Kiro IDE testing. Public GitHub import waits for publication of exact `kiro-fabric@0.63.0` and clean-machine certification. Kiro CLI v3 Power support and real-client elicitation are separate certification gates.

```text
+----------------------------- KIRO IDE -----------------------------+
|                                                                    |
|  NATIVE KIRO                         KIRO FABRIC POWER              |
|  read · edit · shell · web           info · workspace · exec       |
|        |                                      |                    |
|        +--------- ordinary work               v                    |
|                                      checked TypeScript            |
|                                      +------+-------+------+        |
|                                      | flow | state | MCP  |        |
|                                      +------+-------+------+        |
|                                                                    |
+--------------------------------------------------------------------+
```

## What is Kiro Fabric?

Kiro Fabric adds one checked workflow lane to an ordinary Kiro session. Use native Kiro tools for a single read, grep, edit, shell command, web lookup, code-intelligence query, or simple native subagent. Use Fabric when several operations need programmatic coordination or compact aggregation.

The Power exposes exactly three MCP tools:

| Tool | Purpose |
|---|---|
| `fabric_info` | Report bounded runtime, workspace, ACP, and durability status. |
| `fabric_workspace` | Inspect or select validated client roots; manual attachment is approve-once. |
| `fabric_exec` | Type-check and execute a TypeScript workflow through the Fabric runtime. |

Power deliberately does not expose `k.*` and cannot call backward into outer Kiro native tools.

## What does it do?

Fabric gives a model normal programming constructs around mounted capabilities:

- **Checked composition:** variables, functions, conditions, loops, and typed results.
- **Controlled fan-out:** `Promise.all` for independent work, followed by deterministic aggregation.
- **Workflow state:** Power-scoped memory before binding and isolated workspace state after binding.
- **MCP federation:** call configured Fabric MCP servers from one checked program.
- **Bounded orchestration:** Kiro ACP agents are currently unavailable in Power pending separate runtime qualification; their absence does not break the base Power.

Illustrative workflow using a configured MCP review server:

```ts
const areas = ["security", "tests", "architecture"];
const reviews = await Promise.all(
  areas.map((area) =>
    mcp.call({ server: "review", tool: "inspect", args: { area } }),
  ),
);
return Object.fromEntries(areas.map((area, index) => [area, reviews[index]]));
```

Do not invoke Fabric for one simple file or shell operation. That remains native Kiro work.

## How it works

```text
ordinary Kiro session
├── native read / edit / shell / code / web / subagents
├── other Powers and MCP integrations
└── Kiro Fabric Power
    ├── concise orchestration skills
    └── Fabric MCP server
        ├── checked TypeScript → QuickJS by default
        ├── workspace binding → isolated memory and state
        ├── configured MCP federation
        └── optional ACP lane → unavailable until qualified
```

`fabric_exec` validates TypeScript, then normally runs it in QuickJS. Effects cross the host boundary and follow the configured approval policy, deadlines, cancellation, output bounds, and provider capability view. `node-process`, external MCP servers, and Strict shell execution use host privileges; they are trusted execution, not sandboxes.

Workspace identity never comes from process CWD. The server validates MCP client roots, auto-binds one safe root, requires selection for multiple roots, and uses elicitation for approve-once manual attachment. Missing, ambiguous, changed, unsafe, declined, or unsupported attachment paths fail closed.

## Why use it?

Use Fabric when TypeScript makes the workflow smaller and clearer than repeated tool calls:

1. independent reviews need parallel execution and one aggregate result;
2. a workflow needs branching, loops, or reusable data flow;
3. facts must be retained in Fabric memory or workspace state;
4. several configured MCP services must be composed consistently.

The benefit is not “more tools.” It is a checked control plane around the tools already appropriate for orchestration.

## How to use the Power

Requirements: Node.js 24+, pnpm 11.20.0, and Kiro IDE.

```bash
pnpm install --frozen-lockfile
pnpm run power:dev
```

Import the generated local folder into Kiro IDE:

```text
.tmp/kiro-fabric-power/
```

Then check `fabric_info`. If workspace status is unbound, use `fabric_workspace` to list or select client roots. Before using a workspace-dependent workflow, confirm the binding and advertised capabilities.

A non-billable source-checkout diagnosis is available after the build performed by `power:dev`:

```bash
node dist/kiro/cli-entry.js doctor power --json
```

See the complete [Power guide](docs/kiro/power.md) for lifecycle, multi-root behavior, approval gates, updates, and troubleshooting.

## Choose a mode

| Mode | Best for | Outer Kiro tools | Workspace interface |
|---|---|---|---|
| **Power** | Additive orchestration in Kiro IDE | Preserved | Native Kiro outside Fabric; validated binding for Fabric state/MCP |
| **Strict mode** | One managed, auditable custom-agent boundary | Replaced by exactly `@fabric/fabric_exec` | Project-confined `k.*` inside Fabric |
| **internal-child** | Hermetic implementation profile for qualified ACP workers | Not user-selected | Scoped, non-recursive `k.*` |

Strict mode retains the managed installation, exact permission rule, project-identity binding, immutable runtime closure, and update/repair/uninstall lifecycle:

```bash
npm install --global kiro-fabric   # available after npm publication
kiro-fabric doctor kiro
kiro-fabric install kiro --user --project-root "$(pwd -P)"
kiro-cli --v3 --agent kiro-fabric
```

Strict shell and ACP children are explicit trusted grants. Shell is not a sandbox. Until npm publication, follow the [Strict installer guide](docs/kiro/installer.md) from a source checkout.

## Security and lifecycle

- Mutable Power data lives beneath `PLUGIN_DATA`; workspace directories use path-derived hashes.
- Manual bindings and overflow artifacts are process-local. Declined, malformed, timed-out, cancelled, or unsupported elicitation denies access.
- Power shutdown aborts tracked calls and closes owned runtime resources on a best-effort basis. Completed effects are not rolled back.
- Stored memory may survive, but Power v1 makes **no durability guarantee across deactivation**, restart, update, uninstall, or crash. Detached and durable agents are not exposed.
- `fabric_info` omits raw plugin-data paths, credentials, ACP payloads, and private session IDs.

Read [Power security and limitations](docs/kiro/power.md#security-model) and the repository [security replay model](docs/security-replay.md) before enabling trusted execution paths.

## Development

```bash
pnpm run power:validate   # manifests, versions, skills, package boundary
pnpm run certify:power    # generated package + three-tool MCP smoke test
pnpm run check            # typecheck, build, tests, dead-code lint, Power validation
```

Key paths: `src/kiro/mcp-server.ts` owns the mode-specific MCP surface, `src/kiro/runtime.ts` assembles providers, `skills/` contains Power guidance, and `strict/skills/` contains managed-profile guidance.

Documentation: [Power](docs/kiro/power.md) · [Strict installer](docs/kiro/installer.md) · [Current Kiro records](docs/kiro/README.md) · [Security](docs/security-replay.md)

MIT licensed. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
