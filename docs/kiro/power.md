# Kiro Fabric Power

## Overview

Kiro Fabric Power is the additive integration and initial IDE target. It uses
the Agent Plugins 1.0.0 package root (`plugin.json`, `mcp.json`, and immediate
`skills/*/SKILL.md` children) and exposes `fabric_info`, `fabric_workspace`, and
`fabric_exec`. It does not install or select a custom Kiro agent, so ordinary
Kiro native tools and other Powers remain available.

Use native Kiro reads, edits, shell, code intelligence, web tools, and native
subagents for ordinary work. Use Fabric for checked programmable composition,
independent configured-provider fan-out and aggregation, branches/loops,
Fabric memory/state, or configured MCP federation. The current Power release
does not mount `agents.*`; the MCP process also cannot call backward into outer
Kiro native tools.

## Local development import

```bash
pnpm install --frozen-lockfile
pnpm power:dev
```

Import the printed `.tmp/kiro-fabric-power` folder as a custom Power in Kiro
IDE. The generated package contains a relative local runtime closure and no
checkout-specific absolute path. Re-running the command replaces it
deterministically. `kiro-fabric doctor power --json` is read-only,
non-billable, and sends no model prompt.

## GitHub installation

The repository root is a valid package layout. Release `mcp.json` launches the
checked-in `dist/kiro-closure` directly, so Power activation performs no npm
resolution, package download, or lifecycle-script execution. A release remains
blocked until `pnpm check` has rebuilt and certified that closure and a
clean-machine Kiro CLI v3 import/activation/deactivation gate has passed.

## Activation

Narrow keywords cover `fabric_exec`, checked TypeScript workflows,
programmable aggregation, state, memory, and configured MCP federation. Do not
activate Fabric for a single read, grep, edit, test, shell command, or subagent
call. Kiro may namespace the Power MCP server; guidance never assumes a fixed
prefix.

## Workspace binding

Power process CWD is plugin storage, never source-workspace identity. Discovery
order is MCP `roots/list`, then explicit `fabric_workspace` selection. One
validated client root may bind automatically; multiple roots require selection.
Manual `attach` canonicalizes the path and requires approve-once MCP form
elicitation displaying that path. Missing/unsupported elicitation, unsafe broad
roots, filesystem root, Kiro home, plugin root/data, symlinks, deleted roots,
or changed filesystem identity fail closed. Manual attachments are not
persisted across MCP sessions.

Before binding, only checked pure execution and safe Power-scoped capabilities
are usable. Power mode intentionally does not mount `k.*`; native Kiro owns
normal repository operations. Truncated results remain process-local and can be
read in a later call through `tools.call` with the returned `artifacts.read` ID.

## Data and security

Package assets are immutable. Mutable directories are mode `0700` beneath
`${PLUGIN_DATA}/fabric`; workspace directories use a stable SHA-256 identity
rather than raw paths. Power configuration is loaded only from
`${PLUGIN_DATA}/fabric/config`; ambient Pi, Mcporter, workspace MCP
configuration, and Strict-only grants are ignored. Network federation always
requires approve-once elicitation and fails closed when elicitation is absent. Paths, environment values, credentials, ACP payloads, and private
session IDs are omitted from `fabric_info`.

Nested approvals use standards-compliant MCP elicitation only where the client
advertises it. Requests are approve-once/deny, bounded, redacted, non-secret,
and cancellation-aware. Decline, dismiss, timeout, malformed response, or an
unsupported client denies. The current real-Kiro elicitation path remains an
explicit certification gate; unsupported paths retain Fabric's deny fallback.

Kiro ACP children are unavailable in the current Power release. `fabric_info`
reports `kiroAcp.status: "unavailable"` and no `agents.*` provider is mounted.
Use Kiro native subagents outside Fabric. ACP qualification remains a separate
future release gate and its absence does not prevent the base Power from
loading.

## Lifecycle and durability

Kiro dynamically activates and deactivates Power MCP servers. Power v1 permits
only synchronous work owned by the current process. Shutdown aborts active MCP
calls and closes runtime providers and child process trees. Detached actors,
durable agents, and guaranteed cross-deactivation completion are not exposed or
claimed. A cancelled or indeterminate effect is never reported as successful.

## Troubleshooting, update, and uninstall

Use Kiro MCP logs plus `kiro-fabric doctor power --json`. Verify Node 24+,
`PLUGIN_ROOT`, writable `PLUGIN_DATA`, manifest/version synchronization, and
workspace status. Updating a local Power means regenerate and re-import it;
public updates are client-managed after publication. Disable/remove the Power
through Kiro's Power UI; mutable Power state remains client-owned under
`PLUGIN_DATA` according to Kiro's uninstall behavior.

If additive operation is unsuitable, use [Strict mode](installer.md):

```bash
kiro-fabric install kiro --user --project-root /canonical/project
kiro-cli --v3 --agent kiro-fabric
```

Strict keeps its exact one-tool permissions, project-identity binding,
installer/doctor/update/uninstall semantics, and certified ACP resume behavior.
