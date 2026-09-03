# Release

Run `pnpm run check`, `pnpm run agent:archive`, and `pnpm pack --dry-run --json --config.ignore-scripts=true`. Agent staging, closure, archive, and SBOM are deterministic and digest-bound. Real-client evidence contains session-specific PIDs, timestamps, and transcripts; it is not reproducible output, but it is bound to the exact commit, archive, installed profile/runtime, Kiro binary, and qualification driver. `pnpm run certify:agent:real` is a separate authenticated user-owned Kiro gate; ordinary CI cannot claim it.

A release requires objective profile validation/listing/selection, native tool visibility, one three-tool Fabric set, roots and form elicitation, QuickJS execution, durable memory/state across processes, denied side effects, compaction continuity, and orphan-free shutdown. Kiro binary path/version/digest are recorded before and after. Model-authored claims are not lifecycle evidence.

The real-client driver obtains native-tool evidence from Kiro's documented `/tools` system view and requires the installed profile's exact `read`, `write`, `shell`, `web`, `subagent`, `todo_list`, and `@fabric` surface plus all three Fabric tools. Before the main lifecycle session, a separate TUI process runs with Fabric writes set to `ask`, reaches one traced MCP form request, submits/dismisses the default-false form through the PTY, and must record one non-approved response and one fail-closed execution. Its ACP recording, terminal transcript, trace identity, graceful exit, and orphan check are mandatory. Only after that process exits does the isolated qualification config change to `write: allow` for nonce-bound lifecycle setup; this does not alter a user's installation or settings.

Resume evidence requires the same Kiro `/session-id` before exit and after `--resume-id`, plus structural ACP evidence of that session being loaded. If the client does not record a load/resume operation, the fail-closed fallback requires a nonce-bearing prior user-message frame in both the original and resumed ACP recordings; model prose cannot satisfy either path. ACP recordings and every terminal transcript are scanned for the protected `KIRO_API_KEY` before qualification evidence is written.

For the installed `kiro-cli 2.21.0` qualification client, the supported commands reported by its own help are:

```sh
kiro-cli agent validate --path "${KIRO_HOME:-$HOME/.kiro}/agents/kiro-fabric.json"
kiro-cli agent list
kiro-cli --v3 --agent kiro-fabric
kiro-cli chat --agent-engine v3 --agent kiro-fabric --no-interactive \
  --require-mcp-startup --output-format stream-json "<qualification prompt>"
```

The current [official command reference](https://kiro.dev/docs/reference/cli-commands/) instead shows a positional validation path, and the [official headless page](https://kiro.dev/docs/cli/headless/) uses `--engine v3`. Version 2.21.0 exposes neither installed form that way: `agent validate --help` requires `--path`, while `chat --help` exposes `--agent-engine <v1|v2|v3>`. Qualification follows the installed help and records it verbatim. The interactive and real-client lifecycle gates remain blocked until the exact final commit passes them with an authenticated client.

Version 2.21.0's `agent list` has no path or structured-output option. The real-client driver therefore runs `agent validate` and `agent list` from an empty workspace, an unrelated directory, and its nested directory; hashes the exact global profile and runtime; rejects a same-name local profile; and binds the observed MCP command to that runtime path. It does not infer a source path from name-only list prose.

Kiro defaults to inheriting steering, skills, and `AGENTS.md` for custom agents. Qualification must record the effective `chat.disableInheritingDefaultResources` setting and use an isolated workspace and Kiro home. Installation must never change that user setting.
