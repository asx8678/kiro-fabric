# Kiro Fabric

Kiro Fabric is a **native Kiro CLI V3 custom agent** with native Kiro coding tools and one private stdio MCP backend. When Kiro selects `kiro-fabric`, it starts the inline backend; no Power activation or separately started server is required.

## Architecture

The profile exposes `read`, `write`, `shell`, `web`, `subagent`, `todo_list`, and `@fabric`. Fabric exposes exactly `fabric_info`, `fabric_workspace`, and `fabric_exec`. `fabric_exec` strictly type-checks TypeScript and runs it only in QuickJS. It has no filesystem, process, environment, timer, import, shell, native Kiro tool, or unrestricted network access. Side effects remain behind exact inner ActionRegistry approvals; allowing the three outer wrappers never approves a nested effect.

## Requirements and commands

Node.js 24 or newer and an authenticated Kiro CLI with V3 harness support are required.

```sh
pnpm install
pnpm run agent:stage:local
pnpm run agent:validate
pnpm run agent:install
kiro-cli agent validate --path "${KIRO_HOME:-$HOME/.kiro}/agents/kiro-fabric.json"
kiro-cli agent list
kiro-cli --v3 --agent kiro-fabric
kiro-cli agent set-default kiro-fabric   # explicit opt-in only
kiro-cli --v3                            # only after that explicit opt-in
pnpm run agent:update
pnpm run agent:uninstall
# permanent deletion:
pnpm run agent:uninstall -- --purge-data
```

The GitHub release archive is self-installing and does not depend on this checkout or its `.tmp` tree. Extract it into a private directory, then run its bundled installer from any unrelated working directory:

```sh
mkdir -p /absolute/private/kiro-fabric-agent
chmod 700 /absolute/private/kiro-fabric-agent
tar -xzf kiro-fabric-agent.tar.gz -C /absolute/private/kiro-fabric-agent
node /absolute/private/kiro-fabric-agent/scripts/install-agent-user.mjs
```

The interactive TUI and headless runner have different V3 selectors. For a noninteractive structural check, pass the prompt positionally and grant only the capabilities the check needs:

```sh
kiro-cli chat --agent-engine v3 --agent kiro-fabric --no-interactive \
  --require-mcp-startup --output-format stream-json \
  "<qualification prompt>"
```

Headless authentication uses `KIRO_API_KEY`. Check only that it is present before invoking Kiro; never print, persist, or upload its value. Release qualification must not use `--trust-all-tools`.

The current [official command reference](https://kiro.dev/docs/reference/cli-commands/) shows the validation path positionally, but the installed qualification client, `kiro-cli 2.21.0`, requires `agent validate --path <PATH>` in its own help. The [official headless page](https://kiro.dev/docs/cli/headless/) shows `--engine v3`, while this installed client's `chat --help` exposes `--agent-engine <v1|v2|v3>` and no `--engine`. Installed help is authoritative for this client, so the commands above use `--path` and `--agent-engine v3`. Its top-level `--help-all` confirms `--v3 --agent <AGENT>` for the interactive TUI. The Fabric wrappers are already narrowly allowed by the profile; no native tools are pre-trusted by this headless example.

Migrate an explicitly known legacy Power data root without home-directory scanning:

```sh
node scripts/install-agent-user.mjs .tmp/kiro-fabric-agent --migrate-power-data /absolute/legacy/PLUGIN_DATA
```

## Locations and lifecycle

The global profile is `$KIRO_HOME/agents/kiro-fabric.json` (`KIRO_HOME` defaults to `~/.kiro`). Immutable generations are under `$KIRO_HOME/kiro-fabric/runtime/<digest>`, the exact skill under `$KIRO_HOME/kiro-fabric/skills/fabric-exec`, and durable config/memory/state under `$KIRO_HOME/kiro-fabric/data/fabric`. Traces are under that data tree. Installation and normal use do not create a project `.kiro/agents/kiro-fabric.*`, `.fabric`, runtime, data, memory, state, or log path. Memory, state, and configuration are durable; TTL artifacts and in-process values are not durable session memory.

For a long-running `kiro-cli --v3 --agent kiro-fabric` process, Kiro owns conversation auto-save and context compaction. Kiro normally compacts automatically as a conversation approaches its compaction threshold, and `/compact` triggers it manually. To inspect whether automatic compaction was explicitly disabled, run `kiro-cli settings chat.disableAutoCompaction --format json`; to explicitly keep it enabled, run `kiro-cli settings chat.disableAutoCompaction false`. The Fabric installer never changes this user setting.

Fabric does not launch once per prompt. Its contract is one private stdio MCP process and one runtime for the unchanged workspace throughout ordinary turns and a Kiro compaction, even if Kiro represents compaction as a new logical chat session inside the same CLI process. `fabric_info` exposes the PID, `mcpInstanceId`, start time, and runtime generation so this can be checked objectively. Kiro retains its saved conversation state or compacted summary; Fabric memory/state retains only intentional workspace-scoped durable data. The required resume behavior is a new Fabric PID in the later CLI process while Kiro restores that saved conversation state and Fabric restores durable memory/state. These behaviors remain release-blocking real-client gates rather than unverified guarantees.

Single roots bind automatically after identity verification. Multiple roots require explicit `fabric_workspace` selection. Missing roots or form elicitation fails closed. Ambient MCP and Powers are disabled (`includeMcpJson: false`, `includePowers: false`); configured federation lives only in private `data/fabric/config/mcp.json`.

Native reads may follow Kiro policy. Native writes, shell, web, and subagents retain Kiro's normal policy. The exact Fabric wrappers are outer-allowed to avoid duplicate prompts, while nested Fabric write/execute/network effects still require exact form elicitation.

## Migration and troubleshooting

The installer never edits Power registries or installs global steering. Explicit migration accepts only a private known directory and preserves compatible config/projects. Legacy workspace salts remain private compatibility identifiers so existing identity, memory, and state are not orphaned. Remove a digest-owned old steering file manually only after checking its ownership marker; modified/unowned files must be preserved.

If the agent is missing, validate the global profile and inspect `agent list`. This repository intentionally contains no `.kiro/agents/kiro-fabric.*`, so it cannot shadow the installed global agent. If `@fabric` is missing or duplicated, verify `includePowers: false` and disable any leftover Power under `$KIRO_HOME/powers/kiro-fabric` or `$KIRO_HOME/powers/installed/kiro-fabric`. Node mismatch, unsafe paths, modified ownership files, unavailable roots/elicitation, and MCP startup timeout all fail closed. Authenticated real-client release qualification is **not passing** until the interactive lifecycle, compaction, shutdown, and resume gate succeeds on the exact release commit.

[Kiro custom agents inherit default resources](https://kiro.dev/docs/custom-agents/configuration-reference/#disabling-default-resource-inheritance)—steering, skills, and `AGENTS.md`—unless the user has explicitly enabled `chat.disableInheritingDefaultResources`. The installer does not change that global or workspace-overridable setting. To opt into a profile-only resource set, run `kiro-cli settings chat.disableInheritingDefaultResources true`; remove it with `kiro-cli settings --delete chat.disableInheritingDefaultResources`. This inheritance means the complete prompt envelope depends on the user's Kiro settings and workspace resources.
