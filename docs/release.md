# Release

Run `pnpm run check`, `pnpm run agent:archive`, and `pnpm pack --dry-run --json --config.ignore-scripts=true`. Agent staging, closure, archive, and SBOM are deterministic and digest-bound. Real-client evidence contains session-specific PIDs, timestamps, and transcripts; it is not reproducible output, but it is bound to the exact commit, archive, installed profile/runtime, Kiro binary, and qualification driver. `pnpm run certify:agent:real` is a separate authenticated user-owned Kiro gate; ordinary CI cannot claim it.

A release requires objective profile validation/listing/selection, native tool visibility, one three-tool Fabric set, roots and form elicitation, QuickJS execution, durable memory/state across processes, denied side effects, compaction continuity, and orphan-free shutdown. Kiro binary path/version/digest are recorded before and after. Model-authored claims are not lifecycle evidence.

The real-client driver obtains native-tool evidence from Kiro's documented `/tools` system view and requires the installed profile's exact `read`, `write`, `shell`, `web`, `subagent`, `todo_list`, and `@fabric` surface plus all three Fabric tools. Before the main lifecycle session, a separate TUI process runs with Fabric writes set to `ask`, reaches one traced MCP form request, submits/dismisses the default-false form through the PTY, and must record one non-approved response and one fail-closed execution. Its ACP recording, terminal transcript, trace identity, graceful exit, and orphan check are mandatory. Only after that process exits does the isolated qualification config change to `write: allow` for nonce-bound lifecycle setup; this does not alter a user's installation or settings.

Resume evidence requires the same Kiro `/session-id` before exit and after `--resume-id`, plus a direct, successful ACP `session/load` request/response exchange for that session. Replayed nonce-bearing user-message frames are recorded as supplementary evidence but cannot replace the load exchange, and model prose cannot satisfy it. Qualification evidence binds whether authentication used an isolated subscription session verified by `kiro-cli whoami` or API-key automation. Subscription identity and login output are not recorded; when API-key mode is used, ACP recordings and every terminal transcript are scanned for the protected `KIRO_API_KEY` before evidence is written.

The compaction gate completes three manual cycles. Each starts a bounded ACP byte interval immediately before `/compact` and closes only after a direct `_kiro.dev/commands/execute` request for `/compact`, its started and single completed `_kiro.dev/compaction/status` notifications, and the matching successful command response. Interval offsets and request/status/response digests are evidence-bound, so a later automatic compaction cannot satisfy a manual cycle. Before every cycle, a distinct random conversation-only fact is placed in exactly one recorded user prompt and prohibited from structural tool data. After every cycle, an exact ACP-bound `fabric_exec` call rechecks durable memory/state and the same process-local artifact, receives the fact without the post-compaction prompt restating it, persists a matching durable state effect, and retains the OS-observed MCP PID, instance ID, and runtime generation.

Qualification reads `chat.disableAutoCompaction` before and after the lifecycle with `kiro-cli settings chat.disableAutoCompaction --format json`, accepts only `null` or `false`, requires the two structural values to match, and does not mutate the setting. After the manual series it sends at most twelve bounded 24,000-character opaque conversation-pressure turns. The automatic gate requires a direct pressure `session/prompt`, a subsequent started-to-completed `_kiro.dev/compaction/status` sequence for that session, no `/compact` command, and no tool call in the interval. It then performs another exact Fabric sentinel check with the unchanged MCP/runtime identity. Kiro exposes no supported threshold override in the qualified client contract; failure to observe natural automatic compaction within this bound blocks qualification rather than enabling a private or simulated compactor.

The post-compaction and resumed `fabric_exec` calls are bound to completed ACP tool-call frames: the session and tool-call IDs, exact input digest, normalized result digest, contributing frame digests, and recording digest must match independently computed expectations. For each of the three manual cycles and the natural automatic cycle, the driver independently binds a fresh conversation-only fact's source frame, no-tool-input condition, context-seed call, post-compaction payload/result, and durable Fabric state effect. Model prose cannot satisfy these gates.

Separately, hermetic stdio subprocess tests run two Fabric MCP processes against one verified workspace and check concurrent memory visibility plus compare-and-set state integrity. They also kill one MCP process abruptly, start a distinct process, verify exact durable memory/state restoration, and extend that state successfully. These component tests establish storage concurrency and crash durability; they do not establish Kiro's same-PID behavior across prompts or compaction.

For subscription-backed qualification, run Kiro's device flow inside the throwaway private qualification home:

```sh
KIRO_CLI_PATH="/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli" \
  pnpm run certify:agent:real -- --auth-mode subscription --subscription-login
```

The default `--subscription-license free` means Builder ID/social authentication in Kiro CLI terminology and works with a paid subscription on that identity. Identity Center users can add `--subscription-license pro --identity-provider <URL> --region <REGION>`. API-key automation remains available through `--auth-mode api-key` and `KIRO_API_KEY`.

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
