# Kiro CLI 2.20.1 / v3 capability and integration record

## Supported tuple

- Node.js `>=24`
- `kiro-cli 2.20.1`
- agent engine `v3`
- ACP protocol version `1`
- ACP authentication owner `cli`

Fabric pins this tuple instead of following Kiro's mutable default engine. The
interactive entry point is:

```bash
kiro-cli --v3 --agent kiro-fabric
```

Fabric ACP children use the equivalent explicit process contract:

```bash
kiro-cli acp --agent-engine v3 --auth-method cli
```

`--auth-method cli` is important: the Kiro process resolves and refreshes its
own credentials instead of asking the Fabric ACP client to receive bearer
tokens.

Kiro v3 rejects ACP's older spawn-time `--agent`, `--model`, and `--effort`
flags. Fabric injects its custom-agent descriptor and MCP server on
`session/new`, verifies that KAS advertises the injected `kiro-fabric` mode,
activates it with `session/set_mode`, and applies model, effort, and supervised
execution with `session/set_config_option` before any prompt.

## What v3 adds

Kiro v3 uses the unified agent harness shared by Kiro surfaces. Its relevant
features include default chat, spec mode, read-only planning, tangent side
conversations, custom agents, capability permissions, steering, hooks, MCP
OAuth and per-tool controls, Skills, Powers, subagents, automatic compaction,
portable session export, trusted workspaces, code intelligence, and knowledge.
See Kiro's [3.0 overview](https://kiro.dev/docs/cli/v3/),
[agent-config migration](https://kiro.dev/docs/cli/v3/agent-config/), and
[ACP reference](https://kiro.dev/docs/cli/acp/).

The authenticated, zero-prompt ACP probe against Kiro CLI 2.20.1/KAS 0.54.3
advertised:

- session load, list, and fork; local and remote session sources;
- image and embedded-context prompts plus HTTP and SSE MCP transports;
- Default, Spec, Quick Spec, Bug Fix, Plan, Autonomous, and Semantic Reviewer
  modes, in addition to injected custom agents;
- checkpoints, policy notifications, context compaction/export/history,
  workflows, source providers, code intelligence, knowledge, and replay marks;
- local and cloud-sandbox execution targets; and
- session configuration for model, effort, supervised/autopilot execution, and
  content collection. Model availability and credit multipliers remain
  account-dependent and are discovered at runtime.

The v3 profile format separates visibility from authorization:

- `tools` controls what the model can see.
- `permissions.rules` controls whether an invocation is allowed, denied, or
  asks for confirmation.
- `includeMcpJson` and `includePowers` control ambient capability inheritance.

The exact syntax is documented in Kiro's
[custom-agent configuration reference](https://kiro.dev/docs/custom-agents/configuration-reference/).

## Fabric compatibility decisions

| Surface | Managed v3 behavior |
| --- | --- |
| Model-visible tools | Exactly `@fabric/fabric_exec` |
| Workspace MCP servers | Disabled with `includeMcpJson: false` |
| Powers | Disabled with `includePowers: false` |
| Default permissions | `permissions: { rules: [] }` |
| `--allow-tools` | One exact `mcp` allow rule for `fabric/fabric_exec` |
| ACP auth | CLI-owned; Fabric never handles the Kiro access token |
| ACP agent binding | `_meta.kiro.customAgents` plus fail-closed `session/set_mode` activation |
| Effort | Preserves `low`, `medium`, `high`, `xhigh`, and `max`; maps Fabric `off`/`minimal` to Kiro `low` |
| Models | Probed from v3 JSON output; text parsing is fallback only; unavailable explicit routes fall back to Kiro `auto` |
| Cancellation | An MCP cancellation signal aborts the active Fabric execution; a hard deadline remains |
| Nested approval | No managed MCP elicitation bridge; approval-requiring Fabric effects fail closed |
| Session resume | ACP `session/load`; v3 provenance plus a `kiro-runtime-v3` marker prevents v2 reuse, while KAS 0.54.3 keeps the transcript in the authenticated OS home's `.kiro` store |
| Usage accounting | Unavailable until a trustworthy real v3 ACP usage trace is qualified |

The single-tool boundary is intentional. Enabling v3 builtin file/shell tags,
Powers, or native subagents beside Fabric would create a second, less visible
effect path and bypass Fabric's checked execution, project scoping, deadlines,
and audit projection.

## Efficient use with Fabric

1. Use default mode for ordinary review and implementation. Prefer Kiro
   `auto` for most tasks so Kiro selects model and effort together.
2. Use spec mode for requirements, design, and task decomposition:
   `kiro-cli chat --v3 --agent kiro-fabric --mode spec`.
3. Use plan mode when exploration must remain read-only, and tangent mode for
   a side question that should not consume the main trajectory.
4. Put related operations in one `fabric_exec` program. Locate with
   `k.find`/`k.grep`, read narrow ranges, and return only decision-relevant
   results. Use `Promise.all` only for calls that are genuinely independent.
5. Leave `--subagents` off unless parallel verification will repay the extra
   turns. When enabled, give Fabric children narrow non-overlapping tasks;
   Fabric caps fan-out at four and prevents recursion.
6. Keep `--allow-tools` off when a human should confirm every outer Fabric
   invocation. It is a convenience grant, not a performance requirement.

## Migration and verification status

Kiro documents v3 sessions as incompatible with v2 sessions. Fabric therefore
does not reuse the old unversioned `kiro-runtime` marker, records v3 engine
provenance on new run records, and rejects a saved session that lacks that v3
provenance and marker. Recreate a durable Kiro actor whose only state predates
this migration.

The repository's deterministic fixtures verify the profile shape, explicit
ACP argv, permission correlation, session new/load flow, effort mapping,
model-list parsing, cancellation handling, process-group cleanup, and the
doctor's zero-prompt contract. On 2026-08-28, the authenticated local
`kiro-cli 2.20.1` passed the non-billable version/profile/MCP probe and the
built doctor, including real custom-agent injection, supervised mode binding,
the SDK-backed `fabric_exec` MCP lifecycle, and cross-process reload of an
empty v3 session. Session model and effort configuration also succeeded without
a prompt. A model-authored `session/prompt` and its live permission round trip
remain explicit billable qualification gates; neither was requested while
preparing this record.
