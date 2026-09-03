# Kiro Fabric

Kiro Fabric is a **native Kiro CLI 3 custom agent** with native Kiro coding tools and one private stdio MCP backend. Selecting `kiro-fabric` starts that backend for the session; no Power activation or separate server command is required.

## Architecture

The profile exposes `read`, `write`, `shell`, `web`, `subagent`, `todo_list`, and `@fabric`. Fabric exposes exactly `fabric_info`, `fabric_workspace`, and `fabric_exec`. `fabric_exec` strictly type-checks TypeScript and runs it only in QuickJS. It has no filesystem, process, environment, timer, import, shell, native Kiro tool, or unrestricted network access. Side effects remain behind exact inner ActionRegistry approvals; allowing the three outer wrappers never approves a nested effect.

## Requirements and commands

Node.js 24 or newer and an authenticated Kiro CLI 3 installation are required.

```sh
pnpm install
pnpm run agent:stage:local
pnpm run agent:validate
pnpm run agent:install
kiro-cli agent validate --path "${KIRO_HOME:-$HOME/.kiro}/agents/kiro-fabric.json"
kiro-cli agent list
kiro-cli chat --agent kiro-fabric --v3
kiro-cli agent set-default kiro-fabric   # explicit opt-in only
pnpm run agent:update
pnpm run agent:uninstall
# permanent deletion:
pnpm run agent:uninstall -- --purge-data
```

Migrate an explicitly known legacy Power data root without home-directory scanning:

```sh
node scripts/install-agent-user.mjs .tmp/kiro-fabric-agent --migrate-power-data /absolute/legacy/PLUGIN_DATA
```

## Locations and lifecycle

The global profile is `$KIRO_HOME/agents/kiro-fabric.json` (`KIRO_HOME` defaults to `~/.kiro`). Immutable generations are under `$KIRO_HOME/kiro-fabric/runtime/<digest>`, the exact skill under `$KIRO_HOME/kiro-fabric/skills/fabric-exec`, and durable config/memory/state under `$KIRO_HOME/kiro-fabric/data/fabric`. Traces are under that data tree. The MCP process lives only for the selected Kiro session and drains on cancellation, stdin close, or signals. Memory, state, and configuration survive process restarts; TTL artifacts do not promise cross-session survival.

Single roots bind automatically after identity verification. Multiple roots require explicit `fabric_workspace` selection. Missing roots or form elicitation fails closed. Ambient MCP and Powers are disabled (`includeMcpJson: false`, `includePowers: false`); configured federation lives only in private `data/fabric/config/mcp.json`.

Native reads may follow Kiro policy. Native writes, shell, web, and subagents retain Kiro's normal policy. The exact Fabric wrappers are outer-allowed to avoid duplicate prompts, while nested Fabric write/execute/network effects still require exact form elicitation.

## Migration and troubleshooting

The installer never edits Power registries or installs global steering. Explicit migration accepts only a private known directory and preserves compatible config/projects. Legacy workspace salts remain private compatibility identifiers so existing identity, memory, and state are not orphaned. Remove a digest-owned old steering file manually only after checking its ownership marker; modified/unowned files must be preserved.

If the agent is missing, validate the profile and inspect `agent list`; a checkout-local profile can shadow the global profile. If `@fabric` is missing or duplicated, verify `includePowers: false` and disable the legacy Power. Node mismatch, unsafe paths, modified ownership files, unavailable roots/elicitation, and MCP startup timeout all fail closed. Kiro CLI 2.21.0 currently rejects the top-level union in the preserved `fabric_workspace` schema before model execution; therefore authenticated real-client release qualification is **not yet passing**.

Tradeoff: native-agent selection provides a deterministic session-long prompt/tool/permission envelope and explicit default selection. It loses Power keyword activation/deactivation, Power context savings, Power MCP namespacing, and one-click Agent Plugins portability.
