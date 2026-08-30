# Kiro Fabric

> **Native Kiro for ordinary work. Checked TypeScript for workflows.**

Kiro Fabric is an additive **Kiro Power**, an installable Kiro IDE add-on for coordinated workflows. Ask Kiro to use Fabric and Kiro writes a small, checked TypeScript program for parallel work, branches, loops, state, memory, or configured external tools. Those tool connections use MCP, the Model Context Protocol. Kiro's native tools remain available.

> **Release status:** the Power is source-installable for local Kiro IDE testing. Public GitHub import waits for publication of exact `kiro-fabric@0.63.0` and clean-machine certification. Kiro CLI v3 Power support and real-client elicitation are separate certification gates.

```text
+----------------------------------------+
| KIRO IDE                               |
|                                        |
| native tools -> ordinary work          |
|                                        |
| Fabric Power -> coordinated workflows  |
|       |                                |
| checked TypeScript                     |
|       |                                |
| memory | bound state | configured MCP  |
+----------------------------------------+
```

## When to use Fabric

Use native Kiro tools for one read, edit, shell command, web lookup, code search, or simple subagent. Use Fabric when a workflow needs parallel tasks, branches, loops, retained memory, workspace-bound state, or several configured MCP services.

Fabric adds checked composition, `Promise.all` fan-out, and deterministic result assembly. Power ACP agents are unavailable pending separate runtime qualification.

The Power exposes exactly three MCP tools:

| Tool | Purpose |
|---|---|
| `fabric_info` | Show runtime, workspace, ACP, and durability status. |
| `fabric_workspace` | Inspect or select validated roots; manual attachment needs one-time approval. |
| `fabric_exec` | Type-check and run a TypeScript workflow. |

Power does not expose `k.*` and cannot call backward into outer Kiro native tools. Do not invoke Fabric for one simple file or shell operation.

## How it works

An ordinary Kiro session keeps native read, edit, shell, code, web, subagents, other Powers, and MCP integrations. Fabric adds concise orchestration skills and one MCP server beside them. `fabric_exec` validates TypeScript, then normally runs it in QuickJS. Effects cross the host boundary and follow the configured approval policy, deadlines, cancellation, output bounds, and provider capability view. `node-process`, external MCP servers, and Strict shell execution use host privileges; they are trusted execution, not sandboxes.

Workspace identity never comes from process CWD. The server validates MCP client roots, auto-binds one safe root, requires selection for multiple roots, and uses elicitation for approve-once manual attachment. Missing, ambiguous, changed, unsafe, declined, or unsupported attachment paths fail closed.

## Install locally in Kiro IDE

Requirements: Kiro IDE, Node.js 24+, and pnpm 11.20.0. Download or clone this repository, open a terminal at the repository root, then run:

```bash
pnpm install --frozen-lockfile
pnpm run power:dev
```

The second command prints the absolute path to the generated Power. In Kiro:

1. Open the **Powers** panel using the Ghosty lightning icon.
2. Choose **Add Custom Power**.
3. Choose **Import power from a folder**.
4. Select the printed path, which ends in `.tmp/kiro-fabric-power/`.
5. Click **Install**.

After installation, paste this first prompt into Kiro:

> **Use the Kiro Fabric Power to run `fabric_info` and explain what is available.**

If it reports one safe workspace root, Fabric can bind it automatically. Use `fabric_workspace` only when the workspace is unbound or Kiro presents multiple roots.

For non-billable troubleshooting after `power:dev`, run:

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
npm install --global kiro-fabric@0.63.0   # only after this exact release is published
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

Read [Power security and limitations](docs/kiro/power.md#data-and-security) and the repository [security replay model](docs/security-replay.md) before enabling trusted execution paths.

## Development

```bash
pnpm run power:validate   # manifests, versions, skills, package boundary
pnpm run certify:power    # generated package + three-tool MCP smoke test
pnpm run check            # typecheck, build, tests, dead-code lint, Power validation
```

Key paths: `src/kiro/mcp-server.ts` owns the mode-specific MCP surface, `src/kiro/runtime.ts` assembles providers, `skills/` contains Power guidance, and `strict/skills/` contains managed-profile guidance.

Documentation: [Power](docs/kiro/power.md) · [Strict installer](docs/kiro/installer.md) · [Current Kiro records](docs/kiro/README.md) · [Security](docs/security-replay.md)

MIT licensed. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
